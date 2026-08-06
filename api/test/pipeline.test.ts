import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

const advancedDoc = {
  preset: "advanced",
  enabled: true,
  stages: [
    {
      type: "tier",
      enabled: true,
      config: { tiers: ["critical", "high", "normal", "low"], sla: { critical: 15, high: 60 } },
    },
    { type: "scoring", enabled: true, config: { weights: { distance: 0.5, skillMatch: 0.3, waitTime: 0.2 } } },
    { type: "tiebreak", enabled: true, config: { strategy: "round_robin" } },
  ],
};

describe("pipeline config API", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("reports stored: false for a jurisdiction with no pipeline config yet", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    const res = await request(app).get(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stored: false, preset: null, stages: [] });
  });

  it("creates a pipeline config, audits it, and bumps settingsVersion", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const versionBefore = jurisdiction.settingsVersion;

    const put = await request(app)
      .put(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`)
      .send(advancedDoc);
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ stored: true, preset: "advanced" });

    await jurisdiction.reload();
    expect(jurisdiction.settingsVersion).toBeGreaterThan(versionBefore);

    const get = await request(app).get(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`);
    expect(get.body.stages).toHaveLength(3);

    const audit = await request(app).get(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline/audit`);
    expect(audit.status).toBe(200);
    expect(audit.body).toHaveLength(1);
    expect(audit.body[0]).toMatchObject({ entity: "pipeline_config", action: "create" });
  });

  it("audits a second write as an update, not a create", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    await request(app).put(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`).send(advancedDoc);
    await request(app)
      .put(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`)
      .send({ ...advancedDoc, enabled: false });

    const audit = await request(app).get(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline/audit`);
    expect(audit.body).toHaveLength(2);
    expect(audit.body[0]).toMatchObject({ action: "update" });
  });

  it("rejects a body that doesn't match the stage schema", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    const res = await request(app)
      .put(`/api/v1/jurisdictions/${jurisdiction.id}/pipeline`)
      .send({ preset: "advanced", enabled: true, stages: [{ type: "not-a-stage", enabled: true, config: {} }] });
    expect(res.status).toBe(400);
  });

  it("404s a PUT for a jurisdiction that doesn't exist", async () => {
    const res = await request(app)
      .put("/api/v1/jurisdictions/00000000-0000-0000-0000-000000000000/pipeline")
      .send(advancedDoc);
    expect(res.status).toBe(404);
  });

  it("serves the static preset catalog", async () => {
    const res = await request(app).get("/api/v1/pipeline/presets");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(["simple", "balanced", "advanced"]));
  });
});
