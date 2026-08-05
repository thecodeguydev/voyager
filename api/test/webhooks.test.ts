import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function seedSource() {
  const group = await db.models.Group.create(makeGroup());
  const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
  const source = await db.models.WebhookSource.create({
    groupId: group.id,
    name: "Test Source",
    slug: `src-${randomUUID().slice(0, 8)}`,
    secret: "test-secret",
  });
  return { jurisdiction, source };
}

describe("inbound webhooks", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("rejects a bad signature with 401", async () => {
    const { source } = await seedSource();
    const body = JSON.stringify({ eventId: "evt-1", eventType: "order.create" });

    const res = await request(app)
      .post(`/api/v1/webhooks/${source.slug}`)
      .set("Content-Type", "application/json")
      .set("X-Voyager-Signature", "deadbeef")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("maps a signed order.create event to the same ingestion path as POST /orders", async () => {
    const { source, jurisdiction } = await seedSource();
    const body = JSON.stringify({
      eventId: "evt-order-1",
      eventType: "order.create",
      jurisdictionId: jurisdiction.id,
      externalId: "WEBHOOK-ORD-1",
      type: "outage",
      pickup: { lng: -79.39, lat: 43.65 },
    });

    const res = await request(app)
      .post(`/api/v1/webhooks/${source.slug}`)
      .set("Content-Type", "application/json")
      .set("X-Voyager-Signature", sign(source.secret, body))
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "processed", targetEntity: "order" });

    const order = await db.models.Order.findOne({
      where: { jurisdictionId: jurisdiction.id, externalId: "WEBHOOK-ORD-1" },
    });
    expect(order).not.toBeNull();
  });

  it("deduplicates a redelivered event, returning 200 without reprocessing", async () => {
    const { source, jurisdiction } = await seedSource();
    const body = JSON.stringify({
      eventId: "evt-dup-1",
      eventType: "order.create",
      jurisdictionId: jurisdiction.id,
      externalId: "WEBHOOK-ORD-DUP",
      type: "outage",
      pickup: { lng: -79.39, lat: 43.65 },
    });
    const signature = sign(source.secret, body);

    const first = await request(app)
      .post(`/api/v1/webhooks/${source.slug}`)
      .set("Content-Type", "application/json")
      .set("X-Voyager-Signature", signature)
      .send(body);
    expect(first.status).toBe(202);

    const second = await request(app)
      .post(`/api/v1/webhooks/${source.slug}`)
      .set("Content-Type", "application/json")
      .set("X-Voyager-Signature", signature)
      .send(body);
    expect(second.status).toBe(200);

    const orderCount = await db.models.Order.count({
      where: { jurisdictionId: jurisdiction.id, externalId: "WEBHOOK-ORD-DUP" },
    });
    expect(orderCount).toBe(1);
  });
});
