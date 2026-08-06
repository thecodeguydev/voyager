import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeSchedule,
  makeWorker,
  makeZone,
  makeZoneWorker,
  truncateAll,
} from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

/** Every dayOfWeek, all day — deterministically "on duty" regardless of when the test runs. */
async function putOnDutyAllDay(workerId: string): Promise<void> {
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    await db.models.Schedule.create(
      makeSchedule(workerId, { dayOfWeek, startTime: "00:00:00", endTime: "23:59:59", type: "shift" }),
    );
  }
}

/** A worker on duty, covering the (default) order pickup's zone, with no off-duty/zone warnings. */
async function seedOrderAndWorker(overrides: { maxConcurrent?: number | null } = {}) {
  const group = await db.models.Group.create(makeGroup());
  const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
  const worker = await db.models.Worker.create(
    makeWorker(jurisdiction.id, { maxConcurrent: overrides.maxConcurrent ?? 2 }),
  );
  const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
  await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
  await putOnDutyAllDay(worker.id);
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

  it("sets dispatchedAt/expiresAt and emits manual_override_rate=1 on reassign", async () => {
    const { worker, order } = await seedOrderAndWorker();

    const res = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "manual dispatch for testing" });
    expect(res.status).toBe(200);

    const assignment = await db.models.Assignment.findByPk(res.body.assignment.id);
    expect(assignment?.expiresAt).not.toBeNull();
    expect(assignment!.expiresAt!.getTime()).toBeGreaterThan(assignment!.dispatchedAt.getTime());

    const metric = await db.models.MetricPoint.findOne({
      where: { orderId: order.id, metricKey: "assignment.manual_override_rate" },
    });
    expect(Number(metric?.value)).toBe(1);
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

  it("blocks reassignment to an off-duty, out-of-zone worker unless force is set", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    // No zone link, no shift schedule at all.
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const blocked = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "should be blocked" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details.warnings).toEqual(
      expect.arrayContaining([
        "Worker is off duty right now",
        "Worker does not cover a zone containing the order's pickup point",
      ]),
    );

    const forced = await request(app)
      .post(`/api/v1/orders/${order.id}/reassign`)
      .send({ workerId: worker.id, reason: "override warnings", force: true });
    expect(forced.status).toBe(200);
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
