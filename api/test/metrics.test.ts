import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, makeMetricDefinition, makeMetricPoint, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

describe("metrics dictionary + query API", () => {
  // Doesn't assert against migration-seeded built-ins: truncateAll's CASCADE on jurisdictions
  // (every test file's afterEach) also wipes metric_definitions via its FK, so no test can rely
  // on seeded rows surviving past the first truncate anywhere in the suite. Self-contained,
  // like every other test in this file.
  it("lists metric definitions, including ones created via the API", async () => {
    await request(app).post("/api/v1/metrics/definitions").send({
      key: "custom.list_check",
      name: "List Check",
      unit: "count",
      type: "counter",
      aggregation: "sum",
    });

    const res = await request(app).get("/api/v1/metrics/definitions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "custom.list_check", builtin: false })]),
    );
  });

  it("creates a custom metric definition, forcing builtin=false regardless of input", async () => {
    const res = await request(app).post("/api/v1/metrics/definitions").send({
      key: "custom.test_metric",
      name: "Custom Test Metric",
      unit: "count",
      type: "counter",
      aggregation: "sum",
      builtin: true,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: "custom.test_metric", builtin: false });
  });

  it("409s on a duplicate metric definition key", async () => {
    const body = {
      key: "custom.duplicate",
      name: "Duplicate",
      unit: "count",
      type: "counter",
      aggregation: "sum",
    };
    await request(app).post("/api/v1/metrics/definitions").send(body);
    const res = await request(app).post("/api/v1/metrics/definitions").send(body);
    expect(res.status).toBe(409);
  });

  it("does not write an audit_log row for a custom metric definition", async () => {
    await request(app).post("/api/v1/metrics/definitions").send({
      key: "custom.unaudited",
      name: "Unaudited",
      unit: "count",
      type: "counter",
      aggregation: "sum",
    });

    const auditCount = await db.models.AuditLog.count();
    expect(auditCount).toBe(0);
  });

  // These two tests create their own MetricDefinition row rather than relying on a migration-
  // seeded built-in — truncateAll's CASCADE on jurisdictions auto-truncates metric_definitions
  // too (it has an FK to jurisdictions), so built-in rows don't survive past the first test in
  // any file. Self-contained rows sidestep that entirely, matching how other tests here don't
  // depend on seeded settings surviving between tests either.
  it("aggregates metric_points for a known metric over a time range", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.MetricDefinition.create(makeMetricDefinition({ key: "test.orders_created", aggregation: "sum" }));
    await db.models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, {
        metricKey: "test.orders_created",
        value: 1,
        ts: new Date("2027-03-01T10:00:00Z"),
      }),
    );
    await db.models.MetricPoint.create(
      makeMetricPoint(jurisdiction.id, {
        metricKey: "test.orders_created",
        value: 1,
        ts: new Date("2027-03-01T12:00:00Z"),
      }),
    );

    const res = await request(app).get("/api/v1/metrics/query").query({
      metric: "test.orders_created",
      from: "2027-03-01T00:00:00Z",
      to: "2027-03-02T00:00:00Z",
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ metric: "test.orders_created", aggregation: "sum" });
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].value).toBe(2);
  });

  it("groups query results by jurisdiction", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdictionA = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const jurisdictionB = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.MetricDefinition.create(makeMetricDefinition({ key: "test.grouped", aggregation: "sum" }));
    await db.models.MetricPoint.create(makeMetricPoint(jurisdictionA.id, { metricKey: "test.grouped", value: 1 }));
    await db.models.MetricPoint.create(makeMetricPoint(jurisdictionB.id, { metricKey: "test.grouped", value: 1 }));

    const res = await request(app).get("/api/v1/metrics/query").query({
      metric: "test.grouped",
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
      groupBy: "jurisdictionId",
    });

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
  });

  it("404s a query for an unknown metric key", async () => {
    const res = await request(app).get("/api/v1/metrics/query").query({
      metric: "not.a.real.metric",
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date().toISOString(),
    });
    expect(res.status).toBe(404);
  });
});
