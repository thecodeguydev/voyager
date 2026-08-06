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
import { sampleGauges } from "../../src/scheduler/gaugeSampler.js";
import { getTestDb } from "../testDb.js";

const db = getTestDb();

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

async function latestMetric(jurisdictionId: string, metricKey: string) {
  return db.models.MetricPoint.findOne({
    where: { jurisdictionId, metricKey },
    order: [["ts", "DESC"]],
  });
}

describe("scheduler.sampleGauges", () => {
  it("samples queue depth from pending + claimed dispatch_queue rows", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const orderA = await db.models.Order.create(makeOrder(jurisdiction.id, { externalId: "A" }));
    const orderB = await db.models.Order.create(makeOrder(jurisdiction.id, { externalId: "B" }));
    const orderC = await db.models.Order.create(makeOrder(jurisdiction.id, { externalId: "C" }));
    await db.models.DispatchQueue.create(makeDispatchQueue(orderA.id, jurisdiction.id, { status: "pending" }));
    await db.models.DispatchQueue.create(makeDispatchQueue(orderB.id, jurisdiction.id, { status: "claimed" }));
    await db.models.DispatchQueue.create(makeDispatchQueue(orderC.id, jurisdiction.id, { status: "done" }));

    await sampleGauges(db);

    const depth = await latestMetric(jurisdiction.id, "dispatch.queue_depth");
    expect(Number(depth?.value)).toBe(2);
  });

  it("counts a worker with an active assignment toward active_count regardless of status", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const busyWorker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 2 }));
    const idleWorker = await db.models.Worker.create(
      makeWorker(jurisdiction.id, { maxConcurrent: 2, status: "available" }),
    );
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create(
      makeAssignment(order.id, busyWorker.id, jurisdiction.id, { state: "dispatched" }),
    );

    await sampleGauges(db);

    const active = await latestMetric(jurisdiction.id, "worker.active_count");
    const idle = await latestMetric(jurisdiction.id, "worker.idle_count");
    expect(Number(active?.value)).toBe(1);
    expect(Number(idle?.value)).toBe(1);
    expect(idleWorker.id).toBeTruthy(); // keeps the idle worker in scope for readability
  });

  it("does not count an offline worker with zero active assignments as idle", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.Worker.create(makeWorker(jurisdiction.id, { status: "offline" }));
    const availableWorker = await db.models.Worker.create(makeWorker(jurisdiction.id, { status: "available" }));

    await sampleGauges(db);

    const active = await latestMetric(jurisdiction.id, "worker.active_count");
    const idle = await latestMetric(jurisdiction.id, "worker.idle_count");
    expect(Number(active?.value)).toBe(0);
    expect(Number(idle?.value)).toBe(1); // only the available worker, not the offline one
    expect(availableWorker.id).toBeTruthy();
  });

  it("computes worker.utilization as active assignment count over effective capacity", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 4 }));
    const order = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create(makeAssignment(order.id, worker.id, jurisdiction.id, { state: "dispatched" }));

    await sampleGauges(db);

    const utilization = await latestMetric(jurisdiction.id, "worker.utilization");
    expect(Number(utilization?.value)).toBeCloseTo(0.25);
  });
});
