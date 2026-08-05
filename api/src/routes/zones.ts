import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  fromGeoJSONPoint,
  fromGeoJSONPolygon,
  pointInputSchema,
  polygonInputSchema,
  toGeoJSONPoint,
  toGeoJSONPolygon,
} from "../lib/geo.js";
import type { Zone } from "@voyager/shared";

const jurisdictionIdParamsSchema = z.object({ jid: z.uuid() });

const createZoneSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["active", "inactive"]).optional(),
  boundary: polygonInputSchema,
  centroid: pointInputSchema,
});
const updateZoneSchema = createZoneSchema.partial();

function serializeZone(zone: Zone) {
  const json = zone.toJSON();
  return { ...json, boundary: fromGeoJSONPolygon(json.boundary), centroid: fromGeoJSONPoint(json.centroid) };
}

/** GET/POST /jurisdictions/:jid/zones */
export function createZonesNestedRouter(db: AppDb): Router {
  const router = Router({ mergeParams: true });
  const { Jurisdiction, Zone } = db.models;

  router.get<{ jid: string }>("/", validateParams(jurisdictionIdParamsSchema), async (req, res) => {
    const zones = await Zone.findAll({ where: { jurisdictionId: req.params.jid } });
    res.json(zones.map(serializeZone));
  });

  router.post<{ jid: string }>(
    "/",
    validateParams(jurisdictionIdParamsSchema),
    validateBody(createZoneSchema),
    async (req, res) => {
      const jurisdiction = await findOrNotFound(
        () => Jurisdiction.findByPk(req.params.jid),
        `Jurisdiction ${req.params.jid} not found`,
      );
      const zone = await Zone.create({
        name: req.body.name,
        status: req.body.status,
        jurisdictionId: jurisdiction.id,
        boundary: toGeoJSONPolygon(req.body.boundary),
        centroid: toGeoJSONPoint(req.body.centroid),
      });
      res.status(201).json(serializeZone(zone));
    },
  );

  return router;
}

/** GET/PUT/DELETE /zones/:id */
export function createZonesRouter(db: AppDb): Router {
  const router = Router();
  const { Zone } = db.models;

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const zone = await findOrNotFound(() => Zone.findByPk(req.params.id), `Zone ${req.params.id} not found`);
    res.json(serializeZone(zone));
  });

  router.put<{ id: string }>(
    "/:id",
    validateParams(idParamsSchema),
    validateBody(updateZoneSchema),
    async (req, res) => {
      const zone = await findOrNotFound(
        () => Zone.findByPk(req.params.id),
        `Zone ${req.params.id} not found`,
      );
      const { boundary, centroid, ...rest } = req.body;
      await zone.update({
        ...rest,
        ...(boundary ? { boundary: toGeoJSONPolygon(boundary) } : {}),
        ...(centroid ? { centroid: toGeoJSONPoint(centroid) } : {}),
      });
      res.json(serializeZone(zone));
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const zone = await findOrNotFound(
      () => Zone.findByPk(req.params.id),
      `Zone ${req.params.id} not found`,
    );
    await zone.destroy();
    res.status(204).end();
  });

  return router;
}
