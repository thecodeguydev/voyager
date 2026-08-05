import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { validateQuery } from "../middleware/validate.js";
import { listAssignments } from "../services/assignmentService.js";

const listQuerySchema = z.object({ workerId: z.uuid().optional(), jurisdictionId: z.uuid().optional() });

export function createAssignmentsRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", validateQuery(listQuerySchema), async (req, res) => {
    res.json(await listAssignments(db, req.query as z.infer<typeof listQuerySchema>));
  });

  return router;
}
