import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  makeAssignment,
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeWorker,
  truncateAll,
} from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

async function seedDispatchedOrder() {
  const group = await db.models.Group.create(makeGroup());
  const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
  const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
  const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
  const assignment = await db.models.Assignment.create(
    makeAssignment(order.id, worker.id, jurisdiction.id, { state: "dispatched" }),
  );
  return { jurisdiction, worker, order, assignment };
}

describe("order lifecycle events", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("accept: dispatched -> accepted on both the assignment and the order", async () => {
    const { order } = await seedDispatchedOrder();

    const res = await request(app).post(`/api/v1/orders/${order.id}/accept`).send({});
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("accepted");

    await order.reload();
    expect(order.state).toBe("accepted");
  });

  it("progress then complete walks accepted -> in_progress -> completed", async () => {
    const { order } = await seedDispatchedOrder();
    await request(app).post(`/api/v1/orders/${order.id}/accept`).send({});

    const progressed = await request(app).post(`/api/v1/orders/${order.id}/progress`).send({});
    expect(progressed.status).toBe(200);
    expect(progressed.body.state).toBe("in_progress");

    const completed = await request(app).post(`/api/v1/orders/${order.id}/complete`).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.state).toBe("completed");

    await order.reload();
    expect(order.state).toBe("completed");
  });

  it("reject: re-queues the order with a fresh pending dispatch_queue row", async () => {
    const { order } = await seedDispatchedOrder();

    const res = await request(app).post(`/api/v1/orders/${order.id}/reject`).send({ reason: "too far" });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("rejected");

    await order.reload();
    expect(order.state).toBe("queued");

    const pendingRow = await db.models.DispatchQueue.findOne({
      where: { orderId: order.id, status: "pending" },
    });
    expect(pendingRow).not.toBeNull();
  });

  it("rejects an illegal transition (progress before accept)", async () => {
    const { order } = await seedDispatchedOrder();

    const res = await request(app).post(`/api/v1/orders/${order.id}/progress`).send({});
    expect(res.status).toBe(400);
  });

  it("404s when the order has no active assignment", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "queued" }));

    const res = await request(app).post(`/api/v1/orders/${order.id}/accept`).send({});
    expect(res.status).toBe(400);
  });
});
