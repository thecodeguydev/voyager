import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams } from "../middleware/validate.js";

const createGroupSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateGroupSchema = createGroupSchema.partial();

export function createGroupsRouter(db: AppDb): Router {
  const router = Router();
  const { Group } = db.models;

  router.get("/", async (_req, res) => {
    res.json(await Group.findAll());
  });

  router.post("/", validateBody(createGroupSchema), async (req, res) => {
    const group = await Group.create(req.body);
    res.status(201).json(group);
  });

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const group = await findOrNotFound(
      () => Group.findByPk(req.params.id),
      `Group ${req.params.id} not found`,
    );
    res.json(group);
  });

  router.put<{ id: string }>(
    "/:id",
    validateParams(idParamsSchema),
    validateBody(updateGroupSchema),
    async (req, res) => {
      const group = await findOrNotFound(
        () => Group.findByPk(req.params.id),
        `Group ${req.params.id} not found`,
      );
      await group.update(req.body);
      res.json(group);
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const group = await findOrNotFound(
      () => Group.findByPk(req.params.id),
      `Group ${req.params.id} not found`,
    );
    await group.destroy();
    res.status(204).end();
  });

  return router;
}
