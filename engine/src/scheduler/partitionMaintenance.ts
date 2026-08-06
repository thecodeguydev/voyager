import { dropExpiredPartitions, ensureFuturePartitions, type AppDb } from "@voyager/shared";

const PARTITION_MONTHS_AHEAD = 3;
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Keeps `metric_points` partitioned ahead of writes and prunes partitions past the retention
 * window — see PLAN.md "Partitioning" / "Retention". Resolves `metrics.retention_days` globally
 * (no jurisdiction scoping — retention is a system-wide operational concern).
 */
export async function maintainPartitions(db: AppDb): Promise<void> {
  await ensureFuturePartitions(db.sequelize, PARTITION_MONTHS_AHEAD);

  const resolved = await db.settingsService.resolve("metrics.retention_days");
  const retentionDays = resolved != null ? Number(resolved) : DEFAULT_RETENTION_DAYS;
  await dropExpiredPartitions(db.sequelize, retentionDays);
}
