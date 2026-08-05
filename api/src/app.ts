import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import type { AppDb } from "./db.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createGroupsRouter } from "./routes/groups.js";
import { createJurisdictionsNestedRouter, createJurisdictionsRouter } from "./routes/jurisdictions.js";
import { createZonesNestedRouter, createZonesRouter } from "./routes/zones.js";
import { createWorkersRouter } from "./routes/workers.js";
import { createSchedulesNestedRouter, createSchedulesRouter } from "./routes/schedules.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createAssignmentsRouter } from "./routes/assignments.js";
import { createSettingsRouter } from "./routes/settings.js";
import {
  createWebhookSourcesNestedRouter,
  createWebhookSourcesRouter,
} from "./routes/webhookSources.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createHealthRouter } from "./routes/health.js";

/** Assembles the Express app for a given DB context. Kept separate from server.ts so tests can build one without listening on a port. */
export function createApp(db: AppDb): Express {
  const app = express();
  app.use(helmet());
  app.use(cors());

  // Mounted before express.json() so this router sees the raw body for HMAC verification.
  app.use("/api/v1/webhooks", createWebhooksRouter(db));

  app.use(express.json());

  app.use("/api/v1/groups/:gid/jurisdictions", createJurisdictionsNestedRouter(db));
  app.use("/api/v1/groups/:gid/webhook-sources", createWebhookSourcesNestedRouter(db));
  app.use("/api/v1/groups", createGroupsRouter(db));

  app.use("/api/v1/jurisdictions/:jid/zones", createZonesNestedRouter(db));
  app.use("/api/v1/jurisdictions", createJurisdictionsRouter(db));

  app.use("/api/v1/zones", createZonesRouter(db));

  app.use("/api/v1/workers/:id/schedules", createSchedulesNestedRouter(db));
  app.use("/api/v1/workers", createWorkersRouter(db));

  app.use("/api/v1/schedules", createSchedulesRouter(db));

  app.use("/api/v1/orders", createOrdersRouter(db));
  app.use("/api/v1/assignments", createAssignmentsRouter(db));
  app.use("/api/v1/settings", createSettingsRouter(db));
  app.use("/api/v1/webhook-sources", createWebhookSourcesRouter(db));
  app.use("/api/v1/health", createHealthRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
