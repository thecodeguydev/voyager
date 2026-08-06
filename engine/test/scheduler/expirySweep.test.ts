import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  makeAssignment,
  makeDispatchQueue,
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeWorker,
  truncateAll,
} from "@voyager/shared/test";
import { sweepExpiredAssignments } from "../../src/scheduler/expirySweep.js";
import { getTestDb } from "../testDb.js";

const db = getTestDb();

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

async function seedJurisdiction() {
  const group = await db.models.Group.create(makeGroup());
  return db.models.Jurisdiction.create(makeJurisdiction(group.id));
}

describe("scheduler.sweepExpiredAssignments", () => {
  it("expires a dispatched assignment past its expiresAt, re-queues the order, and audits it", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    const assignment = await db.models.Assignment.create(
      makeAssignment(order.id, worker.id, jurisdiction.id, {
        state: "dispatched",
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    const count = await sweepExpiredAssignments(db);
    expect(count).toBe(1);

    await assignment.reload();
    expect(assignment.state).toBe("expired");

    await order.reload();
    expect(order.state).toBe("queued");

    const pendingRow = await db.models.DispatchQueue.findOne({ where: { orderId: order.id, status: "pending" } });
    expect(pendingRow).not.toBeNull();

    const audit = await db.models.AuditLog.findOne({
      where: { entity: "assignment", entityId: assignment.id },
    });
    expect(audit).toMatchObject({ action: "update", actor: "system:scheduler" });

    const outcomeMetrics = await db.models.MetricPoint.findAll({ where: { orderId: order.id } });
    const acceptance = outcomeMetrics.find((m) => m.metricKey === "assignment.acceptance_rate");
    const rejection = outcomeMetrics.find((m) => m.metricKey === "assignment.rejection_rate");
    expect(Number(acceptance?.value)).toBe(0);
    expect(Number(rejection?.value)).toBe(0);
  });

  it("leaves an assignment whose expiresAt is still in the future untouched", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    const assignment = await db.models.Assignment.create(
      makeAssignment(order.id, worker.id, jurisdiction.id, {
        state: "dispatched",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );

    const count = await sweepExpiredAssignments(db);
    expect(count).toBe(0);

    await assignment.reload();
    expect(assignment.state).toBe("dispatched");
  });

  it("ignores an assignment with no expiresAt set", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create(
      makeAssignment(order.id, worker.id, jurisdiction.id, { state: "dispatched", expiresAt: null }),
    );

    const count = await sweepExpiredAssignments(db);
    expect(count).toBe(0);
  });

  it("skips an already-terminal assignment even if a stale expiresAt is in the past", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "completed" }));
    await db.models.DispatchQueue.create(makeDispatchQueue(order.id, jurisdiction.id, { status: "done" }));
    const assignment = await db.models.Assignment.create(
      makeAssignment(order.id, worker.id, jurisdiction.id, {
        state: "completed",
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    const count = await sweepExpiredAssignments(db);
    expect(count).toBe(0);

    await assignment.reload();
    expect(assignment.state).toBe("completed");
  });
});
