import { randomUUID } from "node:crypto";
import type { CreationAttributes } from "sequelize";
import type { GeoJSONPoint, GeoJSONPolygon } from "../models/geo.js";
import type { Group } from "../models/Group.js";
import type { Jurisdiction } from "../models/Jurisdiction.js";
import type { Zone } from "../models/Zone.js";
import type { Worker } from "../models/Worker.js";
import type { ZoneWorker } from "../models/ZoneWorker.js";
import type { Schedule } from "../models/Schedule.js";
import type { Order } from "../models/Order.js";

/** A GeoJSON Point at (lng, lat) — the shape Sequelize expects for a GEOGRAPHY(POINT) column. */
export function point(lng: number, lat: number): GeoJSONPoint {
  return { type: "Point", coordinates: [lng, lat] };
}

/** A GeoJSON Polygon from a ring of (lng, lat) pairs — first and last should match to close it. */
export function polygon(ring: Array<[number, number]>): GeoJSONPolygon {
  return { type: "Polygon", coordinates: [ring.map(([lng, lat]) => [lng, lat])] };
}

export function makeGroup(
  overrides: Partial<CreationAttributes<Group>> = {},
): CreationAttributes<Group> {
  return {
    name: "Test Group",
    code: `GRP-${randomUUID().slice(0, 8)}`,
    description: null,
    status: "active",
    ...overrides,
  };
}

export function makeJurisdiction(
  groupId: string,
  overrides: Partial<CreationAttributes<Jurisdiction>> = {},
): CreationAttributes<Jurisdiction> {
  return {
    groupId,
    name: "Test Jurisdiction",
    code: `JUR-${randomUUID().slice(0, 8)}`,
    timezone: "America/Toronto",
    status: "active",
    settingsVersion: 1,
    ...overrides,
  };
}

export function makeZone(
  jurisdictionId: string,
  overrides: Partial<CreationAttributes<Zone>> = {},
): CreationAttributes<Zone> {
  return {
    jurisdictionId,
    name: "Test Zone",
    status: "active",
    boundary: polygon([
      [-79.4, 43.64],
      [-79.38, 43.64],
      [-79.38, 43.66],
      [-79.4, 43.66],
      [-79.4, 43.64],
    ]),
    centroid: point(-79.39, 43.65),
    ...overrides,
  };
}

export function makeWorker(
  jurisdictionId: string,
  overrides: Partial<CreationAttributes<Worker>> = {},
): CreationAttributes<Worker> {
  return {
    jurisdictionId,
    externalId: `W-${randomUUID().slice(0, 8)}`,
    name: "Test Worker",
    type: "utility",
    skills: ["electrical"],
    maxConcurrent: 2,
    location: point(-79.39, 43.65),
    status: "available",
    ...overrides,
  };
}

export function makeZoneWorker(
  workerId: string,
  zoneId: string,
  overrides: Partial<CreationAttributes<ZoneWorker>> = {},
): CreationAttributes<ZoneWorker> {
  return { workerId, zoneId, ...overrides };
}

export function makeSchedule(
  workerId: string,
  overrides: Partial<CreationAttributes<Schedule>> = {},
): CreationAttributes<Schedule> {
  return {
    workerId,
    dayOfWeek: 3, // Wednesday — matches the seed world's reference clock
    date: null,
    startTime: "08:00",
    endTime: "17:00",
    type: "shift",
    recurring: true,
    ...overrides,
  };
}

export function makeOrder(
  jurisdictionId: string,
  overrides: Partial<CreationAttributes<Order>> = {},
): CreationAttributes<Order> {
  return {
    jurisdictionId,
    externalId: `O-${randomUUID().slice(0, 8)}`,
    type: "inspection",
    priorityTier: "normal",
    payload: {},
    pickup: point(-79.39, 43.65),
    state: "queued",
    slaDueAt: null,
    ...overrides,
  };
}
