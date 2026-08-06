import { QueryTypes, type Sequelize } from "sequelize";
import type { GeoJSONPoint } from "../models/geo.js";
import { onScheduledDay, withinScheduleWindow } from "./scheduleWindow.js";

/** Whether `workerId` has an on-duty shift covering right now, with no timeoff overriding it. */
export async function isWorkerOnDuty(sequelize: Sequelize, workerId: string): Promise<boolean> {
  const [row] = await sequelize.query<{ onDuty: boolean }>(
    `
    SELECT (
      EXISTS (
        SELECT 1 FROM schedules s
        JOIN workers w ON w.id = s."workerId"
        JOIN jurisdictions j ON j.id = w."jurisdictionId"
        WHERE s."workerId" = :workerId AND s.type = 'shift'
          AND ${withinScheduleWindow("s")}
          AND ${onScheduledDay("s")}
      )
      AND NOT EXISTS (
        SELECT 1 FROM schedules s2
        JOIN workers w ON w.id = s2."workerId"
        JOIN jurisdictions j ON j.id = w."jurisdictionId"
        WHERE s2."workerId" = :workerId AND s2.type = 'timeoff'
          AND ${withinScheduleWindow("s2")}
          AND ${onScheduledDay("s2")}
      )
    ) AS "onDuty"
    `,
    { replacements: { workerId }, type: QueryTypes.SELECT },
  );
  return row?.onDuty ?? false;
}

/** Whether `workerId` covers an active zone containing `pickup`. */
export async function isWorkerInZoneFor(
  sequelize: Sequelize,
  workerId: string,
  pickup: GeoJSONPoint,
): Promise<boolean> {
  const [lng, lat] = pickup.coordinates;
  const [row] = await sequelize.query<{ inZone: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM zone_workers zw
      JOIN zones z ON z.id = zw."zoneId"
      WHERE zw."workerId" = :workerId AND z.status = 'active'
        AND ST_Covers(z.boundary, ST_GeogFromText(:pickupWkt))
    ) AS "inZone"
    `,
    { replacements: { workerId, pickupWkt: `POINT(${lng} ${lat})` }, type: QueryTypes.SELECT },
  );
  return row?.inZone ?? false;
}
