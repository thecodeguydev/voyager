import {
  ACTIVE_ASSIGNMENT_STATES,
  METRIC_KEYS,
  TERMINAL_ORDER_STATES,
  emitMetric,
  enqueueDispatch,
  isWorkerInZoneFor,
  isWorkerOnDuty,
  recordAssignmentAudit,
  resolveEffectiveCapacity,
  resolveResponseTimeoutMs,
  type Assignment,
  type AuditLog,
} from "@voyager/shared";
import type { AppDb } from "../db.js";
import { badRequest, notFound } from "../lib/httpErrors.js";

export interface ReassignInput {
  workerId: string;
  reason: string;
  force?: boolean;
  actor: string;
}

export interface ReassignResult {
  assignment: Assignment;
  warnings: string[];
}

/**
 * Manually assigns (or reassigns) an order to a worker, bypassing the dispatch pipeline.
 * Capacity, off-duty, and out-of-zone are soft constraints — they surface as warnings rather
 * than blocking, unless `force` is set.
 */
export async function reassignOrder(
  db: AppDb,
  orderId: string,
  input: ReassignInput,
): Promise<ReassignResult> {
  const { Order, Worker, Assignment, DispatchQueue } = db.models;

  const result = await db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);
    if (TERMINAL_ORDER_STATES.includes(order.state)) {
      throw badRequest(`Order ${orderId} is already terminal (${order.state})`);
    }

    const worker = await Worker.findByPk(input.workerId, { transaction });
    if (!worker) throw notFound(`Worker ${input.workerId} not found`);
    if (worker.jurisdictionId !== order.jurisdictionId) {
      throw badRequest("Worker's jurisdiction does not match the order's jurisdiction");
    }

    const effectiveCapacity = await resolveEffectiveCapacity(worker, db.settingsService);
    const activeCount = await Assignment.count({
      where: { workerId: worker.id, state: ACTIVE_ASSIGNMENT_STATES },
      transaction,
    });

    const warnings: string[] = [];
    if (activeCount >= effectiveCapacity) {
      warnings.push(
        `Worker is at or over capacity (${activeCount}/${effectiveCapacity} active assignments)`,
      );
    }
    if (!(await isWorkerOnDuty(db.sequelize, worker.id))) {
      warnings.push("Worker is off duty right now");
    }
    if (!(await isWorkerInZoneFor(db.sequelize, worker.id, order.pickup))) {
      warnings.push("Worker does not cover a zone containing the order's pickup point");
    }

    if (warnings.length > 0 && !input.force) {
      throw badRequest("Worker has one or more soft-constraint warnings; pass force=true to override", {
        warnings,
      });
    }

    // Locked so a concurrent scheduler expiry sweep can't be silently overwritten by this
    // override — mirrors lifecycleService.ts's identical recheck-under-lock discipline.
    const current = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const before = current ? current.toJSON() : null;
    if (current) {
      await current.update({ state: "overridden" }, { transaction });
    }

    const dispatchedAt = new Date();
    const responseTimeoutMs = await resolveResponseTimeoutMs(db.settingsService, order.jurisdictionId);
    const assignment = await Assignment.create(
      {
        orderId: order.id,
        workerId: worker.id,
        jurisdictionId: order.jurisdictionId,
        state: "dispatched",
        source: "manual",
        overriddenBy: input.actor,
        overrideReason: input.reason,
        dispatchedAt,
        expiresAt: new Date(dispatchedAt.getTime() + responseTimeoutMs),
      },
      { transaction },
    );

    await order.update({ state: "dispatched" }, { transaction });
    await DispatchQueue.update(
      { status: "done" },
      { where: { orderId: order.id, status: ["pending", "claimed"] }, transaction },
    );

    await recordAssignmentAudit(db, {
      assignment,
      jurisdictionId: order.jurisdictionId,
      action: "reassign",
      actor: input.actor,
      reason: input.reason,
      before,
      transaction,
    });

    return { assignment, warnings };
  });

  // Emitted after commit, in its own try/catch — telemetry can never fail the reassign response.
  try {
    await emitMetric(db, {
      metricKey: METRIC_KEYS.ASSIGNMENT_MANUAL_OVERRIDE_RATE,
      jurisdictionId: result.assignment.jurisdictionId,
      workerId: result.assignment.workerId,
      orderId: result.assignment.orderId,
      value: 1, // every assignment reaching this path is manual (source="manual")
    });
  } catch (err) {
    console.error(`[api] manual-override telemetry failed for assignment ${result.assignment.id}`, err);
  }

  return result;
}

export interface UnassignInput {
  reason: string;
  actor: string;
}

/** Overrides the current active assignment and re-queues the order for automatic dispatch. */
export async function unassignOrder(db: AppDb, orderId: string, input: UnassignInput) {
  const { Order, Assignment } = db.models;

  return db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);

    // Locked for the same reason as reassignOrder above — a concurrent expiry sweep on this
    // exact assignment must not be silently overwritten by an unassign racing it.
    const current = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!current) throw badRequest(`Order ${orderId} has no active assignment to unassign`);

    const before = current.toJSON();
    await current.update({ state: "overridden" }, { transaction });
    await order.update({ state: "queued" }, { transaction });
    await enqueueDispatch(db.models, { orderId: order.id, jurisdictionId: order.jurisdictionId }, transaction);

    await recordAssignmentAudit(db, {
      assignment: current,
      jurisdictionId: order.jurisdictionId,
      action: "unassign",
      actor: input.actor,
      reason: input.reason,
      before,
      transaction,
    });

    return order;
  });
}

export async function listOrderAssignments(db: AppDb, orderId: string): Promise<Assignment[]> {
  return db.models.Assignment.findAll({
    where: { orderId },
    order: [["dispatchedAt", "DESC"]],
  });
}

export async function listAssignments(
  db: AppDb,
  filters: { workerId?: string; jurisdictionId?: string } = {},
): Promise<Assignment[]> {
  const where: Record<string, string> = {};
  if (filters.workerId) where.workerId = filters.workerId;
  if (filters.jurisdictionId) where.jurisdictionId = filters.jurisdictionId;
  return db.models.Assignment.findAll({ where });
}

/** The dispatch audit trail for an order: audit_log entries for every assignment it has had. */
export async function getOrderAudit(db: AppDb, orderId: string): Promise<AuditLog[]> {
  const { Order, Assignment, AuditLog } = db.models;
  const order = await Order.findByPk(orderId);
  if (!order) throw notFound(`Order ${orderId} not found`);

  const assignments = await Assignment.findAll({ where: { orderId }, attributes: ["id"] });
  const assignmentIds = assignments.map((a) => a.id);
  if (assignmentIds.length === 0) return [];

  return AuditLog.findAll({
    where: { entity: "assignment", entityId: assignmentIds },
    order: [["createdAt", "DESC"]],
  });
}
