import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { fromGeoJSONPoint, pointInputSchema, toGeoJSONPoint } from "../lib/geo.js";
import type { Worker } from "@voyager/shared";

const listQuerySchema = z.object({ jurisdictionId: z.uuid().optional() });

const createWorkerSchema = z.object({
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["utility", "delivery", "cab"]),
  skills: z.array(z.string()).optional(),
  maxConcurrent: z.number().int().positive().nullable().optional(),
  location: pointInputSchema.nullable().optional(),
  status: z.enum(["available", "busy", "offline"]).optional(),
});
const updateWorkerSchema = createWorkerSchema.partial();

const statusBodySchema = z.object({ status: z.enum(["available", "busy", "offline"]) });
const locationBodySchema = z.object({ location: pointInputSchema });

function serializeWorker(worker: Worker) {
  const json = worker.toJSON();
  return { ...json, location: fromGeoJSONPoint(json.location) };
}

export function createWorkersRouter(db: AppDb): Router {
  const router = Router();
  const { Jurisdiction, Worker } = db.models;

  router.get("/", validateQuery(listQuerySchema), async (req, res) => {
    const { jurisdictionId } = req.query as z.infer<typeof listQuerySchema>;
    const workers = await Worker.findAll({ where: jurisdictionId ? { jurisdictionId } : {} });
    res.json(workers.map(serializeWorker));
  });

  router.post("/", validateBody(createWorkerSchema), async (req, res) => {
    await findOrNotFound(
      () => Jurisdiction.findByPk(req.body.jurisdictionId),
      `Jurisdiction ${req.body.jurisdictionId} not found`,
    );
    const { location, ...rest } = req.body;
    const worker = await Worker.create({
      ...rest,
      location: location ? toGeoJSONPoint(location) : null,
    });
    res.status(201).json(serializeWorker(worker));
  });

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const worker = await findOrNotFound(
      () => Worker.findByPk(req.params.id),
      `Worker ${req.params.id} not found`,
    );
    res.json(serializeWorker(worker));
  });

  router.put<{ id: string }>(
    "/:id",
    validateParams(idParamsSchema),
    validateBody(updateWorkerSchema),
    async (req, res) => {
      const worker = await findOrNotFound(
        () => Worker.findByPk(req.params.id),
        `Worker ${req.params.id} not found`,
      );
      if (req.body.jurisdictionId) {
        await findOrNotFound(
          () => Jurisdiction.findByPk(req.body.jurisdictionId),
          `Jurisdiction ${req.body.jurisdictionId} not found`,
        );
      }
      const { location, ...rest } = req.body;
      await worker.update({
        ...rest,
        ...(location !== undefined ? { location: location ? toGeoJSONPoint(location) : null } : {}),
      });
      res.json(serializeWorker(worker));
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const worker = await findOrNotFound(
      () => Worker.findByPk(req.params.id),
      `Worker ${req.params.id} not found`,
    );
    await worker.destroy();
    res.status(204).end();
  });

  router.put<{ id: string }>(
    "/:id/status",
    validateParams(idParamsSchema),
    validateBody(statusBodySchema),
    async (req, res) => {
      const worker = await findOrNotFound(
        () => Worker.findByPk(req.params.id),
        `Worker ${req.params.id} not found`,
      );
      await worker.update({ status: req.body.status });
      res.json(serializeWorker(worker));
    },
  );

  router.put<{ id: string }>(
    "/:id/location",
    validateParams(idParamsSchema),
    validateBody(locationBodySchema),
    async (req, res) => {
      const worker = await findOrNotFound(
        () => Worker.findByPk(req.params.id),
        `Worker ${req.params.id} not found`,
      );
      await worker.update({ location: toGeoJSONPoint(req.body.location) });
      res.json(serializeWorker(worker));
    },
  );

  return router;
}
