import {
  ACTIVE_ASSIGNMENT_STATES,
  canTransition,
  emitAssignmentOutcomeMetrics,
  enqueueDispatch,
  nextAssignmentState,
  nextOrderState,
  recordAssignmentAudit,
  type AppDb,
  type Assignment,
} from "@voyager/shared";
import { Op, type Transaction } from "sequelize";

const SCHEDULER_ACTOR = "system:scheduler";

export interface ExpirySweepOptions {
  batchSize?: number;
}

/**
 * Expires assignments that have gone unanswered past their `expiresAt` and re-queues their
 * orders for another automatic dispatch attempt — the SLA-sweep half of PLAN.md's Phase 4
 * scheduler. Uses `SKIP LOCKED` so multiple engine instances never double-expire the same row,
 * mirroring the main dispatch queue's own multi-instance-safe claiming (`shared/src/queue/claim.ts`).
 */
export async function sweepExpiredAssignments(db: AppDb, options: ExpirySweepOptions = {}): Promise<number> {
  const { batchSize = 50 } = options;

  const expired = await db.sequelize.transaction(async (transaction) => {
    const candidates = await db.models.Assignment.findAll({
      where: { state: ACTIVE_ASSIGNMENT_STATES, expiresAt: { [Op.lte]: new Date() } },
      limit: batchSize,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });

    const swept: Assignment[] = [];
    for (const assignment of candidates) {
      if (await expireOne(db, assignment, transaction)) swept.push(assignment);
    }
    return swept;
  });

  // Telemetry is emitted after the transaction commits, in its own try/catch — a telemetry
  // failure can never roll back or fail the primary expiry, matching consumer.ts's convention.
  for (const assignment of expired) {
    try {
      await emitAssignmentOutcomeMetrics(
        db,
        { jurisdictionId: assignment.jurisdictionId, workerId: assignment.workerId, orderId: assignment.orderId },
        "expired",
      );
    } catch (err) {
      console.error(`[engine] expiry telemetry failed for assignment ${assignment.id}`, err);
    }
  }

  return expired.length;
}

/**
 * Re-checks the transition is still legal under lock (a concurrent accept/reject/unassign may
 * have already resolved this assignment between the claiming SELECT and this point) before
 * expiring it, mirroring assigner.ts's own recheck-under-lock discipline.
 */
async function expireOne(db: AppDb, assignment: Assignment, transaction: Transaction): Promise<boolean> {
  if (!canTransition(assignment.state, "expire")) return false;

  const order = await db.models.Order.findByPk(assignment.orderId, { transaction });
  if (!order) return false;

  const before = assignment.toJSON();
  await assignment.update({ state: nextAssignmentState(assignment.state, "expire")! }, { transaction });
  await order.update({ state: nextOrderState("expire") }, { transaction });
  await enqueueDispatch(db.models, { orderId: order.id, jurisdictionId: order.jurisdictionId }, transaction);

  await recordAssignmentAudit(db, {
    assignment,
    jurisdictionId: order.jurisdictionId,
    action: "update",
    actor: SCHEDULER_ACTOR,
    reason: "assignment expired (no response within timeout)",
    before,
    transaction,
  });

  return true;
}
