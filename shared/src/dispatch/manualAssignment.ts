import type { Assignment } from "../models/Assignment.js";

/**
 * True for a manually-assigned/reassigned order (PLAN.md "Manual override & reassignment" step 4:
 * "the engine does not auto-re-dispatch a manual assignment"). Phase 4's scheduler must filter its
 * rebalance-candidate queries through `!isManualAssignment(a)` before touching an assignment — no
 * caller exists yet since the scheduler itself is Phase 4, but this is the one place the rule is
 * expressed so `api` and `engine` can't diverge on it later.
 */
export function isManualAssignment(assignment: Pick<Assignment, "source">): boolean {
  return assignment.source === "manual";
}
