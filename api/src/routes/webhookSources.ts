import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { WebhookSource } from "@voyager/shared";
import type { AppDb } from "../db.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";

const groupIdParamsSchema = z.object({ gid: z.uuid() });

const createSourceSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, and hyphens only"),
  allowedEvents: z.array(z.string()).nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
const updateSourceSchema = createSourceSchema.partial().omit({ slug: true });
const eventsQuerySchema = z.object({
  status: z.enum(["received", "processed", "failed", "skipped"]).optional(),
});

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/** `secret` is write-only — omitted from every response except creation and rotate-secret. */
function serializeSource(source: WebhookSource, includeSecret = false): Record<string, unknown> {
  const json = source.toJSON() as Record<string, unknown>;
  if (!includeSecret) delete json.secret;
  return json;
}

/** GET/POST /groups/:gid/webhook-sources */
export function createWebhookSourcesNestedRouter(db: AppDb): Router {
  const router = Router({ mergeParams: true });
  const { Group, WebhookSource } = db.models;

  router.get<{ gid: string }>("/", validateParams(groupIdParamsSchema), async (req, res) => {
    const sources = await WebhookSource.findAll({ where: { groupId: req.params.gid } });
    res.json(sources.map((s) => serializeSource(s)));
  });

  router.post<{ gid: string }>(
    "/",
    validateParams(groupIdParamsSchema),
    validateBody(createSourceSchema),
    async (req, res) => {
      const group = await findOrNotFound(
        () => Group.findByPk(req.params.gid),
        `Group ${req.params.gid} not found`,
      );
      const source = await WebhookSource.create({
        ...req.body,
        groupId: group.id,
        secret: generateSecret(),
      });
      res.status(201).json(serializeSource(source, true));
    },
  );

  return router;
}

/** GET/PUT/DELETE /webhook-sources/:id, rotate-secret, events log */
export function createWebhookSourcesRouter(db: AppDb): Router {
  const router = Router();
  const { WebhookSource, WebhookEvent } = db.models;

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const source = await findOrNotFound(
      () => WebhookSource.findByPk(req.params.id),
      `Webhook source ${req.params.id} not found`,
    );
    res.json(serializeSource(source));
  });

  router.put<{ id: string }>(
    "/:id",
    validateParams(idParamsSchema),
    validateBody(updateSourceSchema),
    async (req, res) => {
      const source = await findOrNotFound(
        () => WebhookSource.findByPk(req.params.id),
        `Webhook source ${req.params.id} not found`,
      );
      await source.update(req.body);
      res.json(serializeSource(source));
    },
  );

  router.delete<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    const source = await findOrNotFound(
      () => WebhookSource.findByPk(req.params.id),
      `Webhook source ${req.params.id} not found`,
    );
    await source.destroy();
    res.status(204).end();
  });

  router.post<{ id: string }>("/:id/rotate-secret", validateParams(idParamsSchema), async (req, res) => {
    const source = await findOrNotFound(
      () => WebhookSource.findByPk(req.params.id),
      `Webhook source ${req.params.id} not found`,
    );
    await source.update({ secret: generateSecret() });
    res.json(serializeSource(source, true));
  });

  router.get<{ id: string }>(
    "/:id/events",
    validateParams(idParamsSchema),
    validateQuery(eventsQuerySchema),
    async (req, res) => {
      const source = await findOrNotFound(
        () => WebhookSource.findByPk(req.params.id),
        `Webhook source ${req.params.id} not found`,
      );
      const { status } = req.query as z.infer<typeof eventsQuerySchema>;
      const events = await WebhookEvent.findAll({
        where: { sourceId: source.id, ...(status ? { status } : {}) },
        order: [["receivedAt", "DESC"]],
      });
      res.json(events);
    },
  );

  return router;
}
