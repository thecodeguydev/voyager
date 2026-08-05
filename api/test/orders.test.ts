import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

async function seedJurisdiction() {
  const group = await db.models.Group.create(makeGroup());
  return db.models.Jurisdiction.create(makeJurisdiction(group.id));
}

describe("order ingestion", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("writes the order + a pending dispatch_queue row and returns 202", async () => {
    const jurisdiction = await seedJurisdiction();

    const res = await request(app)
      .post("/api/v1/orders")
      .send({
        jurisdictionId: jurisdiction.id,
        externalId: "EXT-001",
        type: "outage",
        pickup: { lng: -79.39, lat: 43.65 },
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ state: "queued", pickup: { lng: -79.39, lat: 43.65 } });

    const queueCount = await db.models.DispatchQueue.count({ where: { orderId: res.body.id } });
    expect(queueCount).toBe(1);
  });

  it("is idempotent on (jurisdictionId, externalId): a resubmission returns the same order with 200", async () => {
    const jurisdiction = await seedJurisdiction();
    const payload = {
      jurisdictionId: jurisdiction.id,
      externalId: "EXT-DUP",
      type: "outage",
      pickup: { lng: -79.39, lat: 43.65 },
    };

    const first = await request(app).post("/api/v1/orders").send(payload);
    expect(first.status).toBe(202);

    const second = await request(app).post("/api/v1/orders").send(payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const queueCount = await db.models.DispatchQueue.count({ where: { orderId: first.body.id } });
    expect(queueCount).toBe(1);
  });

  it("cancels a non-terminal order and marks its dispatch_queue row done", async () => {
    const jurisdiction = await seedJurisdiction();
    const created = await request(app).post("/api/v1/orders").send({
      jurisdictionId: jurisdiction.id,
      externalId: "EXT-CANCEL",
      type: "outage",
      pickup: { lng: -79.39, lat: 43.65 },
    });

    const cancelled = await request(app).post(`/api/v1/orders/${created.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe("cancelled");

    const queueRow = await db.models.DispatchQueue.findOne({ where: { orderId: created.body.id } });
    expect(queueRow?.status).toBe("done");
  });

  it("rejects cancelling an already-terminal order", async () => {
    const jurisdiction = await seedJurisdiction();
    const created = await request(app).post("/api/v1/orders").send({
      jurisdictionId: jurisdiction.id,
      externalId: "EXT-TERMINAL",
      type: "outage",
      pickup: { lng: -79.39, lat: 43.65 },
    });
    await request(app).post(`/api/v1/orders/${created.body.id}/cancel`);

    const secondCancel = await request(app).post(`/api/v1/orders/${created.body.id}/cancel`);
    expect(secondCancel.status).toBe(400);
  });
});
