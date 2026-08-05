import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

describe("settings cascade + audit + rollback", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("resolves jurisdiction -> group -> global, most-specific-wins", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    await request(app)
      .put("/api/v1/settings/worker.max_concurrent")
      .send({ scope: "global", value: 3 });
    await request(app)
      .put("/api/v1/settings/worker.max_concurrent")
      .send({ scope: "group", groupId: group.id, value: 4 });

    const resolved = await db.settingsService.resolve("worker.max_concurrent", {
      jurisdictionId: jurisdiction.id,
    });
    expect(resolved).toBe(4);

    await request(app)
      .put("/api/v1/settings/worker.max_concurrent")
      .send({ scope: "jurisdiction", jurisdictionId: jurisdiction.id, value: 2 });

    const resolvedAfterJurisdictionOverride = await db.settingsService.resolve("worker.max_concurrent", {
      jurisdictionId: jurisdiction.id,
    });
    expect(resolvedAfterJurisdictionOverride).toBe(2);
  });

  it("bumps every jurisdiction's settingsVersion on a group-scope change", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jur1 = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const jur2 = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    await request(app)
      .put("/api/v1/settings/dispatch.expiry_seconds")
      .send({ scope: "group", groupId: group.id, value: 120 });

    await jur1.reload();
    await jur2.reload();
    expect(jur1.settingsVersion).toBe(2);
    expect(jur2.settingsVersion).toBe(2);
  });

  it("audits every change and rolls back to a prior value", async () => {
    const created = await request(app)
      .put("/api/v1/settings/dispatch.expiry_seconds")
      .send({ scope: "global", value: 60 });
    await request(app)
      .put("/api/v1/settings/dispatch.expiry_seconds")
      .send({ scope: "global", value: 120 });

    const audit = await request(app)
      .get("/api/v1/settings/dispatch.expiry_seconds/audit")
      .query({ scope: "global" });
    expect(audit.status).toBe(200);
    expect(audit.body).toHaveLength(2);

    // audit.body is ordered newest-first; entry [0] is the 60 -> 120 update, whose
    // `before` snapshot is the value we want rollback to restore.
    const lastChangeId = audit.body[0].id;
    const rolledBack = await request(app)
      .post("/api/v1/settings/dispatch.expiry_seconds/rollback")
      .send({ auditLogId: lastChangeId });

    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.value).toBe(created.body.value);
  });
});
