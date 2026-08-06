import type { AppDb } from "../db/createDb.js";

export interface EmitMetricInput {
  metricKey: string;
  jurisdictionId: string;
  workerId?: string | null;
  orderId?: string | null;
  value: number;
  dimensions?: Record<string, unknown>;
}

/**
 * Writes one telemetry data point. Lives in `shared/` (not just `engine/`) because both `api`
 * (lifecycle/manual-override events) and `engine` (dispatch/expiry events) emit metrics — see
 * PLAN.md "telemetry" / "Built-in metrics".
 */
export async function emitMetric(db: AppDb, input: EmitMetricInput): Promise<void> {
  await db.models.MetricPoint.create({
    metricKey: input.metricKey,
    jurisdictionId: input.jurisdictionId,
    workerId: input.workerId ?? null,
    orderId: input.orderId ?? null,
    value: input.value,
    dimensions: input.dimensions ?? {},
  });
}
