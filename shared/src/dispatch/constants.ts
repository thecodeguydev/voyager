import type { AssignmentState } from "../models/Assignment.js";
import type { OrderState } from "../models/Order.js";

/** Orders in these states accept no further lifecycle transitions. */
export const TERMINAL_ORDER_STATES: readonly OrderState[] = ["completed", "cancelled", "failed"];

/** Assignments in these states count against a worker's capacity. */
export const ACTIVE_ASSIGNMENT_STATES: readonly AssignmentState[] = [
  "dispatched",
  "accepted",
  "in_progress",
];
