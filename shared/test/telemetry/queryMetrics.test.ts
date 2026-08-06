import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getTestSequelize, truncateAll } from "../../src/test/db.js";
import { initModels } from "../../src/models/index.js";
import { makeGroup, makeJurisdiction, makeMetricPoint } from "../../src/test/factories.js";
import { queryMetrics } from "../../src/telemetry/queryMetrics.js";

const sequelize = getTestSequelize();
const models = initModels(sequelize);

afterEach(async () => {
  await truncateAll(sequelize);
});

afterAll(async () => {
  await sequelize.close();
});

describe("telemetry/queryMetrics", () => {
  it("aggregates with sum across the full range when no groupBy is given", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.sum", value: 3, ts: new Date("2027-01-01T00:00:00Z") }),
    );
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.sum", value: 4, ts: new Date("2027-01-02T00:00:00Z") }),
    );

    const rows = await queryMetrics(sequelize, {
      metricKey: "test.sum",
      aggregation: "sum",
      from: new Date("2027-01-01T00:00:00Z"),
      to: new Date("2027-01-03T00:00:00Z"),
    });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].value)).toBe(7);
    expect(rows[0].count).toBe(2);
  });

  it("excludes points at or after `to` (exclusive upper bound)", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.bounds", value: 1, ts: new Date("2027-01-01T00:00:00Z") }),
    );
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.bounds", value: 100, ts: new Date("2027-01-05T00:00:00Z") }),
    );

    const rows = await queryMetrics(sequelize, {
      metricKey: "test.bounds",
      aggregation: "sum",
      from: new Date("2027-01-01T00:00:00Z"),
      to: new Date("2027-01-02T00:00:00Z"),
    });

    expect(Number(rows[0].value)).toBe(1);
  });

  it("groups by day and returns one bucket per day", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.daily", value: 1, ts: new Date("2027-02-01T10:00:00Z") }),
    );
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.daily", value: 2, ts: new Date("2027-02-01T18:00:00Z") }),
    );
    await models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, { metricKey: "test.daily", value: 5, ts: new Date("2027-02-02T04:00:00Z") }),
    );

    const rows = await queryMetrics(sequelize, {
      metricKey: "test.daily",
      aggregation: "sum",
      from: new Date("2027-02-01T00:00:00Z"),
      to: new Date("2027-02-03T00:00:00Z"),
      groupBy: "day",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => Number(r.value))).toEqual([3, 5]);
  });

  it("filters by jurisdictionId", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdictionA = await models.Jurisdiction.create(makeJurisdiction(group.id));
    const jurisdictionB = await models.Jurisdiction.create(makeJurisdiction(group.id));
    await models.MetricPoint.create(makeMetricPoint(jurisdictionA.id, { metricKey: "test.filter", value: 10 }));
    await models.MetricPoint.create(makeMetricPoint(jurisdictionB.id, { metricKey: "test.filter", value: 20 }));

    const rows = await queryMetrics(sequelize, {
      metricKey: "test.filter",
      aggregation: "sum",
      jurisdictionId: jurisdictionA.id,
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });

    expect(Number(rows[0].value)).toBe(10);
  });
});
