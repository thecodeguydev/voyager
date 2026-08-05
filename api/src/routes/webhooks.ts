import { Router, raw } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { badRequest } from "../lib/httpErrors.js";
import { validateParams } from "../middleware/validate.js";
import { receiveWebhook } from "../services/webhookService.js";

const slugParamsSchema = z.object({ slug: z.string().min(1) });

/**
 * POST /webhooks/:slug — mounted before the app's express.json() so this handler sees the
 * raw request bytes, required to verify the X-Voyager-Signature HMAC before trusting the body.
 */
export function createWebhooksRouter(db: AppDb): Router {
  const router = Router();

  router.post<{ slug: string }>(
    "/:slug",
    raw({ type: "*/*", limit: "1mb" }),
    validateParams(slugParamsSchema),
    async (req, res) => {
      const rawBody = req.body as Buffer;

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw badRequest("Request body is not valid JSON");
      }

      const result = await receiveWebhook(db, {
        slug: req.params.slug,
        rawBody,
        signatureHeader: req.header("X-Voyager-Signature"),
        parsedBody,
      });
      res.status(result.status).json(result.body);
    },
  );

  return router;
}
