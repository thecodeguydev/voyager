import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  makeGroup,
  makeJurisdiction,
  makeOrder,
  makeSchedule,
  makeWorker,
  makeZone,
  makeZoneWorker,
  point,
  polygon,
  truncateAll,
} from "@voyager/shared/test";
import { findCandidates } from "../src/matcher.js";
import { getTestDb } from "./testDb.js";
import { putOnDutyAllDay, putOnTimeoffAllDay } from "./scheduleHelpers.js";

const db = getTestDb();

const FAR_ZONE_BOUNDARY = polygon([
  [-74.02, 40.7],
  [-73.98, 40.7],
  [-73.98, 40.74],
  [-74.02, 40.74],
  [-74.02, 40.7],
]);

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

async function seedJurisdiction() {
  const group = await db.models.Group.create(makeGroup());
  return db.models.Jurisdiction.create(makeJurisdiction(group.id, { timezone: "UTC" }));
}

describe("matcher.findCandidates", () => {
  it("returns an available, zoned, on-duty, under-capacity worker with a computed distance", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    await putOnDutyAllDay(db, worker.id);
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const candidates = await findCandidates(db, order);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].worker.id).toBe(worker.id);
    expect(candidates[0].distanceMeters).toBeGreaterThanOrEqual(0);
  });

  it("excludes a worker whose only zone does not cover the order's pickup point", async () => {
    const jurisdiction = await seedJurisdiction();
    const farZone = await db.models.Zone.create(
      makeZone(jurisdiction.id, { boundary: FAR_ZONE_BOUNDARY, centroid: point(-74.0, 40.72) }),
    );
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, farZone.id));
    await putOnDutyAllDay(db, worker.id);
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const candidates = await findCandidates(db, order);
    expect(candidates).toHaveLength(0);
  });

  it("excludes a worker with no on-duty shift schedule", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    // No shift schedule at all.
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const candidates = await findCandidates(db, order);
    expect(candidates).toHaveLength(0);
  });

  it("excludes an on-duty worker who also has timeoff covering right now", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    await putOnDutyAllDay(db, worker.id);
    await putOnTimeoffAllDay(db, worker.id);
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const candidates = await findCandidates(db, order);
    expect(candidates).toHaveLength(0);
  });

  it("excludes a worker at or over effective capacity", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { maxConcurrent: 1 }));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    await putOnDutyAllDay(db, worker.id);

    const busyOrder = await db.models.Order.create(makeOrder(jurisdiction.id, { state: "dispatched" }));
    await db.models.Assignment.create({
      orderId: busyOrder.id,
      workerId: worker.id,
      jurisdictionId: jurisdiction.id,
      state: "dispatched",
      source: "auto",
    });

    const order = await db.models.Order.create(makeOrder(jurisdiction.id));
    const candidates = await findCandidates(db, order);
    expect(candidates).toHaveLength(0);
  });

  it("matches a worker on an overnight shift that wraps past midnight", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));

    // startTime > endTime forces the wraparound branch; the ~1-second gap makes this
    // effectively "on duty all day" without being a same-day (start <= end) window.
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      await db.models.Schedule.create(
        makeSchedule(worker.id, { dayOfWeek, startTime: "23:59:59", endTime: "23:59:58", type: "shift" }),
      );
    }

    const order = await db.models.Order.create(makeOrder(jurisdiction.id));
    const candidates = await findCandidates(db, order);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].worker.id).toBe(worker.id);
  });

  it("excludes an offline worker", async () => {
    const jurisdiction = await seedJurisdiction();
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id, { status: "offline" }));
    await db.models.ZoneWorker.create(makeZoneWorker(worker.id, zone.id));
    await putOnDutyAllDay(db, worker.id);
    const order = await db.models.Order.create(makeOrder(jurisdiction.id));

    const candidates = await findCandidates(db, order);
    expect(candidates).toHaveLength(0);
  });
});
