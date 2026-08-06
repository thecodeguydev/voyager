import { QueryTypes, type Sequelize } from "sequelize";

const PARTITION_PREFIX = "metric_points_";
const PARTITION_NAME_PATTERN = /^metric_points_(\d{4})_(\d{2})$/;

/** "metric_points_2026_08" for the partition covering `monthStart`'s calendar month (UTC). */
export function partitionNameFor(monthStart: Date): string {
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${PARTITION_PREFIX}${year}_${month}`;
}

/** The `[from, to)` bounds for the calendar month containing `monthStart`, in UTC. */
export function partitionBounds(monthStart: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1));
  const to = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  return { from, to };
}

/**
 * Ensures the current month plus `monthsAhead` future months each have a concrete partition of
 * `metric_points`, so a late scheduler tick never leaves telemetry writes falling through to the
 * `DEFAULT` catch-all partition. Idempotent (`CREATE TABLE IF NOT EXISTS`).
 */
export async function ensureFuturePartitions(
  sequelize: Sequelize,
  monthsAhead: number,
  now: Date = new Date(),
): Promise<string[]> {
  const created: string[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const name = partitionNameFor(monthStart);
    const { from, to } = partitionBounds(monthStart);
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF metric_points FOR VALUES FROM (:from) TO (:to)`,
      { replacements: { from, to } },
    );
    created.push(name);
  }
  return created;
}

/**
 * Drops any monthly `metric_points` partition whose entire range is past `retentionDays` — a
 * metadata-only operation (see PLAN.md "Retention"). Partitions are discovered by naming
 * convention rather than parsing `pg_class` bounds, since `ensureFuturePartitions` is the only
 * creator of monthly partitions and the `DEFAULT` catch-all is deliberately never dropped here
 * (it has no bounded range).
 */
export async function dropExpiredPartitions(
  sequelize: Sequelize,
  retentionDays: number,
  now: Date = new Date(),
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const tables = await sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE tablename LIKE :pattern`,
    { replacements: { pattern: `${PARTITION_PREFIX}%` }, type: QueryTypes.SELECT },
  );

  const dropped: string[] = [];
  for (const { tablename } of tables) {
    const match = PARTITION_NAME_PATTERN.exec(tablename);
    if (!match) continue;
    const [, year, month] = match;
    const { to } = partitionBounds(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
    if (to <= cutoff) {
      await sequelize.query(`DROP TABLE IF EXISTS "${tablename}"`);
      dropped.push(tablename);
    }
  }
  return dropped;
}
