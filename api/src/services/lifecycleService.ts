import {
  ACTIVE_ASSIGNMENT_STATES,
  canTransition,
  enqueueDispatch,
  nextAssignmentState,
  nextOrderState,
  requeuesOrder,
  type Assignment,
  type AssignmentEvent,
} from "@voyager/shared";
import type { AppDb } from "../db.js";
import { badRequest, notFound } from "../lib/httpErrors.js";
import { recordAssignmentAudit } from "./assignmentAudit.js";

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

  return db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);

    const assignment = await Assignment.findOne({
      where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
      transaction,
    });
    if (!assignment) throw badRequest(`Order ${orderId} has no active assignment`);
    if (!canTransition(assignment.state, event)) {
      throw badRequest(`Cannot apply "${event}" to an assignment in state "${assignment.state}"`);
    }

    const before = assignment.toJSON();
    await assignment.update({ state: nextAssignmentState(assignment.state, event)! }, { transaction });
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
}

export const acceptOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "accept", input);

export const rejectOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "reject", input);

export const progressOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "progress", input);

export const completeOrder = (db: AppDb, orderId: string, input: ApplyLifecycleEventInput) =>
  applyLifecycleEvent(db, orderId, "complete", input);
