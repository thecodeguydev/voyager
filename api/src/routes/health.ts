import { Router } from "express";
import type { AppDb } from "../db.js";
import { getEngineHealth } from "../services/engineHealthService.js";

export function createHealthRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      await db.sequelize.query("SELECT 1");
      res.json({ status: "ok", checks: { db: "ok" }, ts: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "error", checks: { db: "error" }, ts: new Date().toISOString() });
    }
  });

  router.get("/engine", async (_req, res) => {
    const report = await getEngineHealth(db);
    res.status(report.status === "ok" ? 200 : 503).json(report);
  });

  return router;
}
