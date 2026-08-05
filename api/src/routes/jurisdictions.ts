import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams } from "../middleware/validate.js";

const groupIdParamsSchema = z.object({ gid: z.uuid() });

const createJurisdictionSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  timezone: z.string().min(1),
  status: z.enum(["active", "inactive"]).optional(),
});
const updateJurisdictionSchema = createJurisdictionSchema.partial();

/** GET/POST /groups/:gid/jurisdictions */
export function createJurisdictionsNestedRouter(db: AppDb): Router {
  const router = Router({ mergeParams: true });
  const { Group, Jurisdiction } = db.models;

  router.get<{ gid: string }>("/", validateParams(groupIdParamsSchema), async (req, res) => {
    res.json(await Jurisdiction.findAll({ where: { groupId: req.params.gid } }));
  });

  router.post<{ gid: string }>(
    "/",
    validateParams(groupIdParamsSchema),
    validateBody(createJurisdictionSchema),
    async (req, res) => {
      const group = await findOrNotFound(
        () => Group.findByPk(req.params.gid),
        `Group ${req.params.gid} not found`,
      );
      const jurisdiction = await Jurisdiction.create({ ...req.body, groupId: group.id });
      res.status(201).json(jurisdiction);
    },
  );

  return router;
}

/** GET/PUT/DELETE /jurisdictions/:id */
export function createJurisdictionsRouter(db: AppDb): Router {
  const router = Router();
  const { Jurisdiction } = db.models;

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const jurisdiction = await findOrNotFound(
      () => Jurisdiction.findByPk(req.params.id),
      `Jurisdiction ${req.params.id} not found`,
    );
    res.json(jurisdiction);
  });

  router.put<{ id: string }>(
    "/:id",
    validateParams(idParamsSchema),
    validateBody(updateJurisdictionSchema),
    async (req, res) => {
      const jurisdiction = await findOrNotFound(
        () => Jurisdiction.findByPk(req.params.id),
        `Jurisdiction ${req.params.id} not found`,
      );
      await jurisdiction.update(req.body);
      res.json(jurisdiction);
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const jurisdiction = await findOrNotFound(
      () => Jurisdiction.findByPk(req.params.id),
      `Jurisdiction ${req.params.id} not found`,
    );
    await jurisdiction.destroy();
    res.status(204).end();
  });

  return router;
}
