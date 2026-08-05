import type { Assignment, AuditLog } from "@voyager/shared";
import type { AppDb } from "../db.js";
import { badRequest, notFound } from "../lib/httpErrors.js";
import { TERMINAL_ORDER_STATES } from "./orderService.js";

const ACTIVE_ASSIGNMENT_STATES = ["dispatched", "accepted", "in_progress"];

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
 * A capacity warning surfaces rather than blocks unless `force` is set — off-duty/zone
 * warnings need the Phase 2 matcher and aren't checked here yet.
 */
export async function reassignOrder(
  db: AppDb,
  orderId: string,
  input: ReassignInput,
): Promise<ReassignResult> {
  const { Order, Worker, Assignment, DispatchQueue, AuditLog } = db.models;

  return db.sequelize.transaction(async (transaction) => {
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

    const effectiveCapacity =
      worker.maxConcurrent ??
      (await db.settingsService.resolve("worker.max_concurrent", {
        jurisdictionId: worker.jurisdictionId,
      })) ??
      Infinity;
    const activeCount = await Assignment.count({
      where: { workerId: worker.id, state: ACTIVE_ASSIGNMENT_STATES },
      transaction,
    });

    const warnings: string[] = [];
    if (activeCount >= Number(effectiveCapacity)) {
      warnings.push(
        `Worker is at or over capacity (${activeCount}/${effectiveCapacity} active assignments)`,
      );
      if (!input.force) {
        throw badRequest("Worker is at capacity; pass force=true to override", { warnings });
      }
    }

    const current = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      transaction,
    });
    const before = current ? current.toJSON() : null;
    if (current) {
      await current.update({ state: "overridden" }, { transaction });
    }

    const assignment = await Assignment.create(
      {
        orderId: order.id,
        workerId: worker.id,
        jurisdictionId: order.jurisdictionId,
        state: "dispatched",
        source: "manual",
        overriddenBy: input.actor,
        overrideReason: input.reason,
      },
      { transaction },
    );

    await order.update({ state: "dispatched" }, { transaction });
    await DispatchQueue.update(
      { status: "done" },
      { where: { orderId: order.id, status: ["pending", "claimed"] }, transaction },
    );

    await AuditLog.create(
      {
        entity: "assignment",
        entityId: assignment.id,
        jurisdictionId: order.jurisdictionId,
        action: "reassign",
        actor: input.actor,
        reason: input.reason,
        before,
        after: assignment.toJSON(),
      },
      { transaction },
    );

    return { assignment, warnings };
  });
}

export interface UnassignInput {
  reason: string;
  actor: string;
}

/** Overrides the current active assignment and re-queues the order for automatic dispatch. */
export async function unassignOrder(db: AppDb, orderId: string, input: UnassignInput) {
  const { Order, Assignment, DispatchQueue, AuditLog } = db.models;

  return db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);

    const current = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      transaction,
    });
    if (!current) throw badRequest(`Order ${orderId} has no active assignment to unassign`);

    const before = current.toJSON();
    await current.update({ state: "overridden" }, { transaction });
    await order.update({ state: "queued" }, { transaction });
    await DispatchQueue.create(
      {
        orderId: order.id,
        jurisdictionId: order.jurisdictionId,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
      },
      { transaction },
    );

    await AuditLog.create(
      {
        entity: "assignment",
        entityId: current.id,
        jurisdictionId: order.jurisdictionId,
        action: "unassign",
        actor: input.actor,
        reason: input.reason,
        before,
        after: current.toJSON(),
      },
      { transaction },
    );

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
