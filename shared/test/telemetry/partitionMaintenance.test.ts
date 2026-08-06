import { afterAll, describe, expect, it } from "vitest";
import { QueryTypes } from "sequelize";
import { getTestSequelize } from "../../src/test/db.js";
import { dropExpiredPartitions, ensureFuturePartitions } from "../../src/telemetry/partitionMaintenance.js";

const sequelize = getTestSequelize();

afterAll(async () => {
  await sequelize.close();
});

async function metricPointsPartitionNames(): Promise<string[]> {
  const rows = await sequelize.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE tablename LIKE 'metric_points_%'`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((r) => r.tablename);
}

describe("telemetry/partitionMaintenance", () => {
  it("ensureFuturePartitions creates the current month plus monthsAhead future partitions, idempotently", async () => {
    const now = new Date("2027-01-15T00:00:00Z");
    const created = await ensureFuturePartitions(sequelize, 2, now);
    expect(created).toEqual(["metric_points_2027_01", "metric_points_2027_02", "metric_points_2027_03"]);

    const names = await metricPointsPartitionNames();
    expect(names).toEqual(expect.arrayContaining(created));

    // Idempotent: re-running the same range doesn't error or duplicate.
    await expect(ensureFuturePartitions(sequelize, 2, now)).resolves.toEqual(created);
  });

  it("dropExpiredPartitions drops only partitions fully past the retention window, never the DEFAULT catch-all", async () => {
    const staleMonth = new Date("2020-01-15T00:00:00Z");
    await ensureFuturePartitions(sequelize, 0, staleMonth);
    const before = await metricPointsPartitionNames();
    expect(before).toContain("metric_points_2020_01");
    expect(before).toContain("metric_points_default");

    const dropped = await dropExpiredPartitions(sequelize, 90, new Date());
    expect(dropped).toContain("metric_points_2020_01");

    const after = await metricPointsPartitionNames();
    expect(after).not.toContain("metric_points_2020_01");
    expect(after).toContain("metric_points_default");
  });

  it("does not drop a partition still inside the retention window", async () => {
    const now = new Date();
    const created = await ensureFuturePartitions(sequelize, 0, now);
    const dropped = await dropExpiredPartitions(sequelize, 90, now);
    expect(dropped).not.toContain(created[0]);

    const after = await metricPointsPartitionNames();
    expect(after).toContain(created[0]);
  });
});
