import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sequelize } from "sequelize";
import {
  initModels,
  type DispatchQueueStatus,
  type GeoJSONPoint,
  type GeoJSONPolygon,
  type GroupStatus,
  type JurisdictionStatus,
  type OrderPriorityTier,
  type OrderState,
  type ScheduleType,
  type WorkerStatus,
  type WorkerType,
  type ZoneStatus,
} from "../models/index.js";
import { slugToId } from "./slugId.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_WORLD_PATH = path.join(__dirname, "../../seed/seed-world.json");

/** Wraps a WKT literal so Sequelize emits `ST_GeogFromText('...')` instead of GeoJSON conversion. */
function wkt(sequelize: Sequelize, literal: string) {
  return sequelize.fn("ST_GeogFromText", literal) as unknown as GeoJSONPoint & GeoJSONPolygon;
}

function expandScheduleDays(schedule: {
  id: string;
  workerId: string;
  daysOfWeek?: number[];
  date?: string;
  startTime: string;
  endTime: string;
  type: ScheduleType;
  recurring: boolean;
}) {
  if (schedule.daysOfWeek) {
    return schedule.daysOfWeek.map((dayOfWeek) => ({ ...schedule, dayOfWeek, date: undefined }));
  }
  return [{ ...schedule, dayOfWeek: undefined }];
}

/** Reads and parses shared/seed/seed-world.json. */
export function readSeedWorld() {
  return JSON.parse(readFileSync(SEED_WORLD_PATH, "utf-8")) as {
    groups: Array<{
      id: string;
      name: string;
      code: string;
      description?: string;
      status: GroupStatus;
    }>;
    jurisdictions: Array<{
      id: string;
      groupId: string;
      name: string;
      code: string;
      timezone: string;
      status: JurisdictionStatus;
      settingsVersion: number;
    }>;
    zones: Array<{
      id: string;
      jurisdictionId: string;
      name: string;
      status: ZoneStatus;
      boundary: string;
      centroid: string;
    }>;
    workers: Array<{
      id: string;
      jurisdictionId: string;
      externalId: string;
      name: string;
      type: WorkerType;
      skills: string[];
      maxConcurrent: number | null;
      location: string;
      status: WorkerStatus;
    }>;
    zoneWorkers: Array<{ workerId: string; zoneId: string }>;
    schedules: Array<{
      id: string;
      workerId: string;
      daysOfWeek?: number[];
      date?: string;
      startTime: string;
      endTime: string;
      type: ScheduleType;
      recurring: boolean;
    }>;
    orders: Array<{
      id: string;
      jurisdictionId: string;
      externalId: string;
      type: string;
      priorityTier: OrderPriorityTier;
      payload: Record<string, unknown>;
      pickup: string;
      state: OrderState;
      slaDueAt: string | null;
    }>;
    dispatchQueue: Array<{
      orderId: string;
      jurisdictionId: string;
      status: DispatchQueueStatus;
      attempts: number;
      nextAttemptAt: string;
    }>;
  };
}

/**
 * Loads the canonical seed world (shared/seed/seed-world.json) via the Sequelize models,
 * resolving slug ids to stable uuid v5 values. Phase 0 covers the core + dispatch_queue
 * tables only — settings/pipelineConfigs/assignments are seeded once their phases land.
 */
export async function loadSeedWorld(sequelize: Sequelize): Promise<void> {
  const { Group, Jurisdiction, Zone, Worker, ZoneWorker, Schedule, Order, DispatchQueue } =
    initModels(sequelize);
  const world = readSeedWorld();

  for (const g of world.groups) {
    await Group.create({
      id: slugToId(g.id),
      name: g.name,
      code: g.code,
      description: g.description ?? null,
      status: g.status,
    });
  }

  for (const j of world.jurisdictions) {
    await Jurisdiction.create({
      id: slugToId(j.id),
      groupId: slugToId(j.groupId),
      name: j.name,
      code: j.code,
      timezone: j.timezone,
      status: j.status,
      settingsVersion: j.settingsVersion,
    });
  }

  for (const z of world.zones) {
    await Zone.create({
      id: slugToId(z.id),
      jurisdictionId: slugToId(z.jurisdictionId),
      name: z.name,
      status: z.status,
      boundary: wkt(sequelize, z.boundary),
      centroid: wkt(sequelize, z.centroid),
    });
  }

  for (const w of world.workers) {
    await Worker.create({
      id: slugToId(w.id),
      jurisdictionId: slugToId(w.jurisdictionId),
      externalId: w.externalId,
      name: w.name,
      type: w.type,
      skills: w.skills,
      maxConcurrent: w.maxConcurrent,
      location: w.location ? wkt(sequelize, w.location) : null,
      status: w.status,
    });
  }

  for (const zw of world.zoneWorkers) {
    await ZoneWorker.create({ workerId: slugToId(zw.workerId), zoneId: slugToId(zw.zoneId) });
  }

  for (const s of world.schedules) {
    for (const day of expandScheduleDays(s)) {
      await Schedule.create({
        workerId: slugToId(s.workerId),
        dayOfWeek: day.dayOfWeek ?? null,
        date: day.date ?? null,
        startTime: s.startTime,
        endTime: s.endTime,
        type: s.type,
        recurring: s.recurring,
      });
    }
  }

  const orderIdBySlug = new Map<string, string>();
  for (const o of world.orders) {
    const id = slugToId(o.id);
    orderIdBySlug.set(o.id, id);
    await Order.create({
      id,
      jurisdictionId: slugToId(o.jurisdictionId),
      externalId: o.externalId,
      type: o.type,
      priorityTier: o.priorityTier ?? null,
      payload: o.payload,
      pickup: wkt(sequelize, o.pickup),
      state: o.state,
      slaDueAt: o.slaDueAt ? new Date(o.slaDueAt) : null,
    });
  }

  for (const q of world.dispatchQueue) {
    await DispatchQueue.create({
      orderId: orderIdBySlug.get(q.orderId) ?? slugToId(q.orderId),
      jurisdictionId: slugToId(q.jurisdictionId),
      status: q.status,
      attempts: q.attempts,
      nextAttemptAt: new Date(q.nextAttemptAt),
    });
  }
}
