import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  makeDispatchQueue,
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeWorker,
  truncateAll,
} from "@voyager/shared/test";
import type { Worker } from "@voyager/shared";
import { assign } from "../src/assigner.js";
import type { Candidate } from "../src/pipeline/stage.js";
import { getTestDb } from "./testDb.js";

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

async function seedQueuedOrder(jurisdictionId: string, overrides: Parameters<typeof makeOrder>[1] = {}) {
  const order = await db.models.Order.create(makeOrder(jurisdictionId, overrides));
  const queueRow = await db.models.DispatchQueue.create(makeDispatchQueue(order.id, jurisdictionId));
  return { order, queueRow };
}

function candidateFor(worker: Worker): Candidate {
  return { worker, distanceMeters: 100, score: 1, trace: {} };
}

describe("assigner.assign — transactional capacity recheck", () => {
  it("lets exactly one of two concurrent assignments win a worker with capacity for only one", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));
    const { order: orderA, queueRow: queueRowA } = await seedQueuedOrder(jurisdiction.id);
    const { order: orderB, queueRow: queueRowB } = await seedQueuedOrder(jurisdiction.id);

    const [resultA, resultB] = await Promise.all([
      assign(db, { order: orderA, ranked: [candidateFor(worker)], pipelineTrace: [], dispatchQueueRowId: queueRowA.id }),
      assign(db, { order: orderB, ranked: [candidateFor(worker)], pipelineTrace: [], dispatchQueueRowId: queueRowB.id }),
    ]);

    expect([resultA, resultB].filter(Boolean)).toHaveLength(1);

    const activeCount = await db.models.Assignment.count({
      where: { workerId: worker.id, state: "dispatched" },
    });
    expect(activeCount).toBe(1);
  });

  it("falls to the next candidate when the top-ranked one lost capacity since matching", async () => {
    const jurisdiction = await seedJurisdiction();
    const fullWorker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));
    const openWorker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));

    const otherOrder = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create({
      orderId: otherOrder.id,
      workerId: fullWorker.id,
      jurisdictionId: jurisdiction.id,
      state: "dispatched",
      source: "auto",
    });

    const { order, queueRow } = await seedQueuedOrder(jurisdiction.id);
    const assignment = await assign(db, {
      order,
      ranked: [candidateFor(fullWorker), candidateFor(openWorker)],
      pipelineTrace: [],
      dispatchQueueRowId: queueRow.id,
    });

    expect(assignment?.workerId).toBe(openWorker.id);
  });

  it("returns null when every candidate is out of capacity", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));
    const otherOrder = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create({
      orderId: otherOrder.id,
      workerId: worker.id,
      jurisdictionId: jurisdiction.id,
      state: "dispatched",
      source: "auto",
    });

    const { order, queueRow } = await seedQueuedOrder(jurisdiction.id);
    const assignment = await assign(db, {
      order,
      ranked: [candidateFor(worker)],
      pipelineTrace: [],
      dispatchQueueRowId: queueRow.id,
    });
    expect(assignment).toBeNull();
  });

  it("returns null without creating a second assignment when the order already has an active one", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const otherWorker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const { order, queueRow } = await seedQueuedOrder(jurisdiction.id, { state: "dispatched" });

    // Simulates a race with a manual reassign that already gave this order an active assignment.
    await db.models.Assignment.create({
      orderId: order.id,
      workerId: otherWorker.id,
      jurisdictionId: jurisdiction.id,
      state: "dispatched",
      source: "manual",
    });

    const assignment = await assign(db, {
      order,
      ranked: [candidateFor(worker)],
      pipelineTrace: [],
      dispatchQueueRowId: queueRow.id,
    });

    expect(assignment).toBeNull();
    const totalAssignments = await db.models.Assignment.count({ where: { orderId: order.id } });
    expect(totalAssignments).toBe(1);
  });

  it("writes the winning candidate's score and pipelineTrace onto the assignment and marks the queue row done", async () => {
    const jurisdiction = await seedJurisdiction();
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const { order, queueRow } = await seedQueuedOrder(jurisdiction.id);

    const candidate: Candidate = { worker, distanceMeters: 250, score: 0.75, trace: { scoring: { score: 0.75 } } };
    const assignment = await assign(db, {
      order,
      ranked: [candidate],
      pipelineTrace: [{ stage: "scoring", candidateCount: 1 }],
      dispatchQueueRowId: queueRow.id,
    });

    expect(Number(assignment?.score)).toBeCloseTo(0.75);
    expect(assignment?.pipelineTrace).toMatchObject({
      stages: [{ stage: "scoring", candidateCount: 1 }],
      candidate: { scoring: { score: 0.75 } },
    });
    expect(assignment?.source).toBe("auto");

    await order.reload();
    expect(order.state).toBe("dispatched");

    await queueRow.reload();
    expect(queueRow.status).toBe("done");
  });
});
