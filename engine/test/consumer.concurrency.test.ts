import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  makeDispatchQueue,
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeWorker,
  makeZone,
  makeZoneWorker,
  truncateAll,
} from "@voyager/shared/test";
import { claimCycle } from "../src/consumer.js";
import { SettingsCache } from "../src/settingsCache.js";
import { getTestDb } from "./testDb.js";
import { putOnDutyAllDay } from "./scheduleHelpers.js";

const db = getTestDb();
const cache = new SettingsCache(db);

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

describe("consumer.claimCycle — no double-dispatch under concurrency", () => {
  it("assigns exactly one of two competing orders to a single-capacity worker and re-queues the other", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id, { timezone: "UTC" }));
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    await putOnDutyAllDay(db, worker.id);

    const orderA = await db.models.Order.create(makeOrder(jurisdiction.id, { externalId: "CONC-A" }));
    const orderB = await db.models.Order.create(makeOrder(jurisdiction.id, { externalId: "CONC-B" }));
    await db.models.DispatchQueue.create(makeDispatchQueue(orderA.id, jurisdiction.id));
    await db.models.DispatchQueue.create(makeDispatchQueue(orderB.id, jurisdiction.id));

    // Two simulated engine instances race the same claim cycle concurrently.
    await Promise.all([
      claimCycle({ db, cache, instanceId: "engine-a", batchSize: 1 }),
      claimCycle({ db, cache, instanceId: "engine-b", batchSize: 1 }),
    ]);

    const activeAssignments = await db.models.Assignment.count({
      where: { workerId: worker.id, state: "dispatched" },
    });
    expect(activeAssignments).toBe(1);

    const dispatchedOrders = await db.models.Order.count({ where: { state: "dispatched" } });
    expect(dispatchedOrders).toBe(1);

    const stillQueuedOrders = await db.models.Order.count({ where: { state: "queued" } });
    expect(stillQueuedOrders).toBe(1);

    const requeuedRow = await db.models.DispatchQueue.findOne({ where: { status: "pending" } });
    expect(requeuedRow).not.toBeNull();
    expect(requeuedRow?.attempts).toBe(1);
  });
});
