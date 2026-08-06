import type { AppDb } from "../db/createDb.js";
import { emitMetric } from "./emitMetric.js";
import { METRIC_KEYS } from "./metricKeys.js";

export type AssignmentOutcome = "accepted" | "rejected" | "expired";

export interface AssignmentOutcomeContext {
  jurisdictionId: string;
  workerId: string;
  orderId: string;
}

/**
 * Emits the acceptance/rejection-rate pair for a terminal assignment outcome. Both `api`'s
 * accept/reject endpoints and `engine`'s expiry sweep need this identical 0/1 branching, so it
 * lives once here rather than duplicated per caller. An "expired" outcome contributes 0 to both —
 * it's neither an explicit accept nor an explicit reject.
 */
export async function emitAssignmentOutcomeMetrics(
  db: AppDb,
  context: AssignmentOutcomeContext,
  outcome: AssignmentOutcome,
): Promise<void> {
  await emitMetric(db, {
    metricKey: METRIC_KEYS.ASSIGNMENT_ACCEPTANCE_RATE,
    jurisdictionId: context.jurisdictionId,
    workerId: context.workerId,
    orderId: context.orderId,
    value: outcome === "accepted" ? 1 : 0,
  });
  await emitMetric(db, {
    metricKey: METRIC_KEYS.ASSIGNMENT_REJECTION_RATE,
    jurisdictionId: context.jurisdictionId,
    workerId: context.workerId,
    orderId: context.orderId,
    value: outcome === "rejected" ? 1 : 0,
  });
}
