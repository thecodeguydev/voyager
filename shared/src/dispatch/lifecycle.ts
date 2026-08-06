import type { AssignmentState } from "../models/Assignment.js";
import type { OrderState } from "../models/Order.js";

export type AssignmentEvent = "accept" | "reject" | "progress" | "complete" | "expire";

/**
 * Pure assignment/order state-machine rules — the one authority for what PLAN.md's "State
 * invariants" table allows, shared by api's HTTP lifecycle endpoints today and the engine's
 * scheduler-driven expiry later (Phase 4) so there is never a second copy of these rules.
 */
const ASSIGNMENT_TRANSITIONS: Record<
  AssignmentEvent,
  { from: readonly AssignmentState[]; to: AssignmentState }
> = {
  accept: { from: ["dispatched"], to: "accepted" },
  reject: { from: ["dispatched"], to: "rejected" },
  progress: { from: ["accepted"], to: "in_progress" },
  complete: { from: ["accepted", "in_progress"], to: "completed" },
  expire: { from: ["dispatched", "accepted", "in_progress"], to: "expired" },
};

/** True if `event` is a legal transition out of `state`. */
export function canTransition(state: AssignmentState, event: AssignmentEvent): boolean {
  return ASSIGNMENT_TRANSITIONS[event].from.includes(state);
}

/** The assignment state `event` produces, or null if `state` doesn't allow it. */
export function nextAssignmentState(state: AssignmentState, event: AssignmentEvent): AssignmentState | null {
  return canTransition(state, event) ? ASSIGNMENT_TRANSITIONS[event].to : null;
}

/** Whether `event` re-queues the order for another dispatch attempt, per the state invariants table. */
export function requeuesOrder(event: AssignmentEvent): boolean {
  return event === "reject" || event === "expire";
}

/** The order state that mirrors an assignment event — reject/expire re-queue rather than advance. */
export function nextOrderState(event: AssignmentEvent): OrderState {
  switch (event) {
    case "accept":
      return "accepted";
    case "progress":
      return "in_progress";
    case "complete":
      return "completed";
    case "reject":
    case "expire":
      return "queued";
  }
}
