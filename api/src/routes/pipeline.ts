import { Router } from "express";
import { z } from "zod";
import { pipelineConfigDocSchema, PRESET_CATALOG } from "@voyager/shared";
import type { AppDb } from "../db.js";
import { actorFrom } from "../lib/actor.js";
import { findOrNotFound } from "../lib/findOrNotFound.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  getPipelineConfig,
  getPipelineConfigAuditTrail,
  upsertPipelineConfig,
} from "../services/pipelineConfigService.js";

const jurisdictionIdParamsSchema = z.object({ jid: z.uuid() });

/** GET/PUT /jurisdictions/:jid/pipeline, GET /jurisdictions/:jid/pipeline/audit */
export function createPipelineNestedRouter(db: AppDb): Router {
  const router = Router({ mergeParams: true });
  const { Jurisdiction } = db.models;

  router.get<{ jid: string }>("/", validateParams(jurisdictionIdParamsSchema), async (req, res) => {
    res.json(await getPipelineConfig(db, req.params.jid));
  });

  router.put<{ jid: string }>(
    "/",
    validateParams(jurisdictionIdParamsSchema),
    validateBody(pipelineConfigDocSchema),
    async (req, res) => {
      await findOrNotFound(
        () => Jurisdiction.findByPk(req.params.jid),
        `Jurisdiction ${req.params.jid} not found`,
      );
      const config = await upsertPipelineConfig(db, req.params.jid, req.body, actorFrom(req));
      res.json(config);
    },
  );

  router.get<{ jid: string }>("/audit", validateParams(jurisdictionIdParamsSchema), async (req, res) => {
    res.json(await getPipelineConfigAuditTrail(db, req.params.jid));
  });

  return router;
}

/** GET /pipeline/presets — the static preset catalog; no DB read. */
export function createPipelinePresetsRouter(): Router {
  const router = Router();
  router.get("/presets", (_req, res) => {
    res.json(PRESET_CATALOG);
  });
  return router;
}
