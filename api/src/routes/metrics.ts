import { Router } from "express";
import { z } from "zod";
import type { AppDb } from "../db.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { createMetricDefinition, listMetricDefinitions, queryMetric } from "../services/metricsService.js";

const METRIC_TYPES = ["counter", "gauge", "duration", "rate"] as const;
const METRIC_AGGREGATIONS = ["sum", "avg", "p95", "max"] as const;
const GROUP_BY_VALUES = ["jurisdictionId", "workerId", "hour", "day"] as const;

const listDefinitionsQuerySchema = z.object({ jurisdictionId: z.uuid().optional() });

const createDefinitionSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  unit: z.string().min(1),
  type: z.enum(METRIC_TYPES),
  aggregation: z.enum(METRIC_AGGREGATIONS),
  jurisdictionId: z.uuid().nullable().optional(),
});

const queryMetricsSchema = z.object({
  metric: z.string().min(1),
  jurisdictionId: z.uuid().optional(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  groupBy: z.enum(GROUP_BY_VALUES).optional(),
});

export function createMetricsRouter(db: AppDb): Router {
  const router = Router();

  router.get("/definitions", validateQuery(listDefinitionsQuerySchema), async (req, res) => {
    const query = req.query as z.infer<typeof listDefinitionsQuerySchema>;
    res.json(await listMetricDefinitions(db, query));
  });

  router.post("/definitions", validateBody(createDefinitionSchema), async (req, res) => {
    const definition = await createMetricDefinition(db, req.body);
    res.status(201).json(definition);
  });

  router.get("/query", validateQuery(queryMetricsSchema), async (req, res) => {
    const query = req.query as z.infer<typeof queryMetricsSchema>;
    const result = await queryMetric(db, {
      metric: query.metric,
      jurisdictionId: query.jurisdictionId,
      from: new Date(query.from),
      to: new Date(query.to),
      groupBy: query.groupBy,
    });
    res.json(result);
  });

  return router;
}
