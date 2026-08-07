import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SETTING_KEYS } from "@voyager/shared";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

describe("ingestion policy setting", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("rejects order ingestion when skillsRequired is required and missing", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));

    await request(app)
      .put(`/api/v1/settings/${SETTING_KEYS.INGESTION_REQUIRE_SKILLS_REQUIRED}`)
      .send({
        scope: "jurisdiction",
        jurisdictionId: jurisdiction.id,
        value: { enabled: true, mode: "enforce", value: true },
      });

    const res = await request(app)
      .post("/api/v1/orders")
      .send({
        jurisdictionId: jurisdiction.id,
        externalId: "EXT-POLICY-1",
        type: "outage",
        payload: {},
        pickup: { lng: -79.39, lat: 43.65 },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("payload.skillsRequired is required");
  });
});
