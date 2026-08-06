import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { actorFrom } from "../lib/actor.js";
import { badRequest, notFound } from "../lib/httpErrors.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";

const keyParamsSchema = z.object({ key: z.string().min(1) });

const listQuerySchema = z.object({
  scope: z.enum(["global", "group", "jurisdiction"]).optional(),
  groupId: z.uuid().optional(),
  jurisdictionId: z.uuid().optional(),
});

/** scope="group" requires groupId; scope="jurisdiction" requires jurisdictionId — otherwise
 * SettingsService's scoped WHERE clause hits Sequelize's "undefined" guard and 500s. */
function requireScopeId(
  data: { scope: "global" | "group" | "jurisdiction"; groupId?: string | null; jurisdictionId?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (data.scope === "group" && !data.groupId) {
    ctx.addIssue({ code: "custom", message: 'groupId is required when scope is "group"', path: ["groupId"] });
  }
  if (data.scope === "jurisdiction" && !data.jurisdictionId) {
    ctx.addIssue({
      code: "custom",
      message: 'jurisdictionId is required when scope is "jurisdiction"',
      path: ["jurisdictionId"],
    });
  }
}

const scopeQuerySchema = z
  .object({
    scope: z.enum(["global", "group", "jurisdiction"]),
    groupId: z.uuid().optional(),
    jurisdictionId: z.uuid().optional(),
  })
  .superRefine(requireScopeId);

const upsertBodySchema = z
  .object({
    scope: z.enum(["global", "group", "jurisdiction"]),
    groupId: z.uuid().nullable().optional(),
    jurisdictionId: z.uuid().nullable().optional(),
    value: z.unknown(),
    dataType: z.string().optional(),
    description: z.string().nullable().optional(),
  })
  .superRefine(requireScopeId);

const rollbackBodySchema = z.object({ auditLogId: z.uuid() });

const resolveQuerySchema = z.object({
  key: z.string().min(1),
  jurisdictionId: z.uuid().optional(),
  groupId: z.uuid().optional(),
});

export function createSettingsRouter(db: AppDb): Router {
  const router = Router();
  const { settingsService } = db;

  router.get("/", validateQuery(listQuerySchema), async (req, res) => {
    res.json(await settingsService.list(req.query as z.infer<typeof listQuerySchema>));
  });

  router.get("/effective", validateQuery(resolveQuerySchema), async (req, res) => {
    const { key, jurisdictionId, groupId } = req.query as z.infer<typeof resolveQuerySchema>;
    if (!jurisdictionId && !groupId) {
      throw badRequest("Either jurisdictionId or groupId must be provided");
    }

    const setting = await settingsService.resolveEntry(key, { jurisdictionId, groupId });
    if (!setting) throw notFound(`No effective setting found for key ${key}`);

    res.json(setting);
  });

  router.put<{ key: string }>(
    "/:key",
    validateParams(keyParamsSchema),
    validateBody(upsertBodySchema),
    async (req, res) => {
      const setting = await settingsService.upsert({ ...req.body, key: req.params.key }, actorFrom(req));
      res.json(setting);
    },
  );

  router.get<{ key: string }>(
    "/:key/audit",
    validateParams(keyParamsSchema),
    validateQuery(scopeQuerySchema),
    async (req, res) => {
      const { scope, groupId, jurisdictionId } = req.query as z.infer<typeof scopeQuerySchema>;
      const setting = await settingsService.findByScope({
        scope,
        groupId,
        jurisdictionId,
        key: req.params.key,
      });
      if (!setting) throw notFound(`No ${scope}-scoped setting ${req.params.key} found`);
      res.json(await settingsService.getAuditTrail(setting.id));
    },
  );

  router.post<{ key: string }>(
    "/:key/rollback",
    validateParams(keyParamsSchema),
    validateBody(rollbackBodySchema),
    async (req, res) => {
      const setting = await settingsService.rollback(req.body.auditLogId, actorFrom(req));
      res.json(setting);
    },
  );

  return router;
}
