import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeGroup, makeJurisdiction, makeOrder, makeWorker, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

async function seedOrderAndWorker(overrides: { maxConcurrent?: number | null } = {}) {
  const group = await db.models.Group.create(makeGroup());
  const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
  const worker = await db.models.Worker.create(
    makeWorker(jurisdiction.id, { maxConcurrent: overrides.maxConcurrent ?? 2 }),
  );
  const order = await db.models.Order.create(makeOrder(jurisdiction.id));
  return { jurisdiction, worker, order };
}

describe("manual assignment (reassign/unassign/audit)", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("reassigns an order to a worker, dispatching it and auditing the change", async () => {
    const { worker, order } = await seedOrderAndWorker();

    const res = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "manual dispatch for testing" });

    expect(res.status).toBe(200);
    expect(res.body.assignment).toMatchObject({
      orderId: order.id,
      workerId: worker.id,
      state: "dispatched",
      source: "manual",
    });

    const updatedOrder = await db.models.Order.findByPk(order.id);
    expect(updatedOrder?.state).toBe("dispatched");

    const audit = await request(app).get(`/api/v1/orders/${order.id}/audit`);
    expect(audit.status).toBe(200);
    expect(audit.body).toHaveLength(1);
    expect(audit.body[0]).toMatchObject({ action: "reassign", entity: "assignment" });
  });

  it("blocks reassignment at capacity unless force is set, surfacing a warning", async () => {
    const { worker, order } = await seedOrderAndWorker({ maxConcurrent: 1 });
    const otherOrder = await db.models.Order.create(
      makeOrder(order.jurisdictionId, { externalId: "OTHER-1" }),
    );
    await db.models.Assignment.create({
      orderId: otherOrder.id,
      workerId: worker.id,
      jurisdictionId: order.jurisdictionId,
      state: "dispatched",
      source: "manual",
    });

    const blocked = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "should be blocked" });
    expect(blocked.status).toBe(400);

    const forced = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "override capacity", force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.warnings.length).toBeGreaterThan(0);
  });

  it("unassigns an order back to queued and re-queues it for dispatch", async () => {
    const { worker, order } = await seedOrderAndWorker();
    await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "initial dispatch" });

    const res = await request(app)
      .post(`/api/v1/orders/${order.id}/unassign`)
      .send({ reason: "wrong worker" });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe("queued");

    const pending = await db.models.DispatchQueue.count({
      where: { orderId: order.id, status: "pending" },
    });
    expect(pending).toBe(1);
  });
});
