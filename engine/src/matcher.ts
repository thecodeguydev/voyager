import { QueryTypes } from "sequelize";
import {
  ACTIVE_ASSIGNMENT_STATES,
  onScheduledDay,
  resolveEffectiveCapacity,
  withinScheduleWindow,
  type AppDb,
  type Order,
} from "@voyager/shared";
import type { Candidate } from "./pipeline/stage.js";

interface CandidateRow {
  id: string;
  distanceMeters: string;
  activeCount: string;
}

/**
 * Candidate workers for `order`: available, covering an active zone that contains the pickup
 * point, on duty right now per their schedule (in the jurisdiction's timezone) and not on
 * timeoff. Capacity here is a soft filter — resolveEffectiveCapacity/ACTIVE_ASSIGNMENT_STATES is
 * the same cascade the assigner rechecks under lock, so the two can't diverge. See PLAN.md
 * "matcher".
 *
 * The eligibility query only selects `w.id` plus the computed distance/capacity figures, then
 * fetches full Worker instances via `findAll` — building a Model instance directly from a raw
 * query row (`Worker.build(rawRow, { isNewRecord: false })`) silently drops timestamp columns
 * (createdAt/updatedAt), so it isn't a safe way to hydrate from raw SQL results.
 */
export async function findCandidates(db: AppDb, order: Order): Promise<Candidate[]> {
  const rows = await db.sequelize.query<CandidateRow>(
    `
    SELECT
      w.id,
      ST_Distance(w.location, o.pickup) AS "distanceMeters",
      (
        SELECT COUNT(*) FROM assignments a
        WHERE a."workerId" = w.id AND a.state IN (:activeStates)
      ) AS "activeCount"
    FROM workers w
    JOIN orders o ON o.id = :orderId
    JOIN jurisdictions j ON j.id = w."jurisdictionId"
    WHERE w."jurisdictionId" = o."jurisdictionId"
      AND w.status = 'available'
      AND w.location IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM zone_workers zw
        JOIN zones z ON z.id = zw."zoneId"
        WHERE zw."workerId" = w.id AND z.status = 'active' AND ST_Covers(z.boundary, o.pickup)
      )
      AND EXISTS (
        SELECT 1 FROM schedules s
        WHERE s."workerId" = w.id AND s.type = 'shift'
          AND ${withinScheduleWindow("s")}
          AND ${onScheduledDay("s")}
      )
      AND NOT EXISTS (
        SELECT 1 FROM schedules s2
        WHERE s2."workerId" = w.id AND s2.type = 'timeoff'
          AND ${withinScheduleWindow("s2")}
          AND ${onScheduledDay("s2")}
      )
    `,
    {
      replacements: { orderId: order.id, activeStates: [...ACTIVE_ASSIGNMENT_STATES] },
      type: QueryTypes.SELECT,
    },
  );

  if (rows.length === 0) return [];

  const workers = await db.models.Worker.findAll({ where: { id: rows.map((row) => row.id) } });
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const worker = workerById.get(row.id);
    if (!worker) continue;

    const effectiveCapacity = await resolveEffectiveCapacity(worker, db.settingsService);
    if (Number(row.activeCount) >= effectiveCapacity) continue;

    candidates.push({ worker, distanceMeters: Number(row.distanceMeters), score: null, trace: {} });
  }
  return candidates;
}
