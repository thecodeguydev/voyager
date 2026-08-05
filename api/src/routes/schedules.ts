import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { badRequest } from "../lib/httpErrors.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { validateBody, validateParams } from "../middleware/validate.js";

const workerIdParamsSchema = z.object({ id: z.uuid() });
const scheduleIdParamsSchema = z.object({ id: z.uuid() });

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const createScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  date: dateSchema.nullable().optional(),
  startTime: timeSchema,
  endTime: timeSchema,
  type: z.enum(["shift", "timeoff"]),
  recurring: z.boolean().optional(),
});
const updateScheduleSchema = createScheduleSchema.partial();

/** GET/POST /workers/:id/schedules */
export function createSchedulesNestedRouter(db: AppDb): Router {
  const router = Router({ mergeParams: true });
  const { Worker, Schedule } = db.models;

  router.get<{ id: string }>("/", validateParams(workerIdParamsSchema), async (req, res) => {
    res.json(await Schedule.findAll({ where: { workerId: req.params.id } }));
  });

  router.post<{ id: string }>(
    "/",
    validateParams(workerIdParamsSchema),
    validateBody(createScheduleSchema),
    async (req, res) => {
      const worker = await findOrNotFound(
        () => Worker.findByPk(req.params.id),
        `Worker ${req.params.id} not found`,
      );
      if (req.body.dayOfWeek == null && req.body.date == null) {
        throw badRequest("Either dayOfWeek or date must be provided");
      }
      const schedule = await Schedule.create({ ...req.body, workerId: worker.id });
      res.status(201).json(schedule);
    },
  );

  return router;
}

/** PUT/DELETE /schedules/:id */
export function createSchedulesRouter(db: AppDb): Router {
  const router = Router();
  const { Schedule } = db.models;

  router.put<{ id: string }>(
    "/:id",
    validateParams(scheduleIdParamsSchema),
    validateBody(updateScheduleSchema),
    async (req, res) => {
      const schedule = await findOrNotFound(
        () => Schedule.findByPk(req.params.id),
        `Schedule ${req.params.id} not found`,
      );
      await schedule.update(req.body);
      res.json(schedule);
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(scheduleIdParamsSchema), async (req, res) => {
    const schedule = await findOrNotFound(
      () => Schedule.findByPk(req.params.id),
      `Schedule ${req.params.id} not found`,
    );
    await schedule.destroy();
    res.status(204).end();
  });

  return router;
}
