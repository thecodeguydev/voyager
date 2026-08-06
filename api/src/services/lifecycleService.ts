import {
  ACTIVE_ASSIGNMENT_STATES,
  canTransition,
  emitAssignmentOutcomeMetrics,
  emitMetric,
  enqueueDispatch,
  METRIC_KEYS,
  nextAssignmentState,
  nextOrderState,
  recordAssignmentAudit,
  requeuesOrder,
  type Assignment,
  type AssignmentEvent,
} from "@voyager/shared";
import type { AppDb } from "../db.js";
import { badRequest, notFound } from "../lib/httpErrors.js";

export interface ApplyLifecycleEventInput {
  reason?: string;
  actor: string;
}

/**
 * Applies a worker-reported lifecycle event (accept/reject/progress/complete) to an order's
 * active assignment, per shared/dispatch/lifecycle.ts's transition rules. Reject re-queues the
 * order for another automatic dispatch attempt, exactly like a dispatcher's manual unassign.
 */
async function applyLifecycleEvent(
  db: AppDb,
  orderId: string,
  event: AssignmentEvent,
  input: ApplyLifecycleEventInput,
): Promise<Assignment> {
  const { Order, Assignment } = db.models;

  const assignment = await db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);

    // Locks the row so a concurrent scheduler expiry sweep (or another lifecycle call) can't be
    // silently overwritten: this blocks until any such transaction commits, then re-evaluates the
    // WHERE clause against the committed row (Postgres's READ COMMITTED semantics for SELECT ...
    // FOR UPDATE) — if the sweep already moved the assignment out of ACTIVE_ASSIGNMENT_STATES,
    // it simply won't match here and the 404/400 below fires instead of a stale-state overwrite.
    const assignment = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!assignment) throw badRequest(`Order ${orderId} has no active assignment`);
    if (!canTransition(assignment.state, event)) {
      throw badRequest(`Cannot apply "${event}" to an assignment in state "${assignment.state}"`);
    }

    const before = assignment.toJSON();
    const now = new Date();
    const responseTimestamps =
      event === "accept" || event === "reject"
        ? { respondedAt: now }
        : event === "complete"
          ? { completedAt: now }
          : {};

    await assignment.update(
      { state: nextAssignmentState(assignment.state, event)!, ...responseTimestamps },
      { transaction },
    );
    await order.update({ state: nextOrderState(event) }, { transaction });

    if (requeuesOrder(event)) {
      await enqueueDispatch(db.models, { orderId: order.id, jurisdictionId: order.jurisdictionId }, transaction);
    }

    await recordAssignmentAudit(db, {
      assignment,
      jurisdictionId: order.jurisdictionId,
      action: "update",
      actor: input.actor,
      reason: input.reason ?? null,
      before,
      transaction,
    });

    return assignment;
  });

  // Emitted after the transaction commits, in its own try/catch — telemetry can never fail the
  // lifecycle transition itself, matching engine/src/consumer.ts's existing convention.
  try {
    await emitLifecycleMetrics(db, assignment, event);
  } catch (err) {
    console.error(`[api] lifecycle telemetry failed for assignment ${assignment.id}`, err);
  }

  return assignment;
}

async function emitLifecycleMetrics(db: AppDb, assignment: Assignment, event: AssignmentEvent): Promise<void> {
  if (event === "accept" || event === "reject") {
    await emitAssignmentOutcomeMetrics(
      db,
      { jurisdictionId: assignment.jurisdictionId, workerId: assignment.workerId, orderId: assignment.orderId },
      event === "accept" ? "accepted" : "rejected",
    );
    return;
  }

  if (event === "complete") {
    const completedAt = assignment.completedAt ?? new Date();
    await emitMetric(db, {
      metricKey: METRIC_KEYS.ASSIGNMENT_DURATION_MS,
      jurisdictionId: assignment.jurisdictionId,
      workerId: assignment.workerId,
      orderId: assignment.orderId,
      value: completedAt.getTime() - assignment.dispatchedAt.getTime(),
    });

    const order = await db.models.Order.findByPk(assignment.orderId);
    if (order?.slaDueAt) {
      await emitMetric(db, {
        metricKey: METRIC_KEYS.SLA_COMPLIANCE_RATE,
        jurisdictionId: assignment.jurisdictionId,
        workerId: assignment.workerId,
        orderId: assignment.orderId,
        value: completedAt.getTime() <= order.slaDueAt.getTime() ? 1 : 0,
      });
    }
  }
}

export const acceptOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "accept", input);

export const rejectOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "reject", input);

export const progressOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "progress", input);

export const completeOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "complete", input);
