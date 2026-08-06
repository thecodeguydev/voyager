import { UniqueConstraintError } from "sequelize";
import {
  queryMetrics,
  type MetricAggregation,
  type MetricDefinition,
  type MetricQueryGroupBy,
  type MetricType,
} from "@voyager/shared";
import type { AppDb } from "../db.js";
import { conflict, notFound } from "../lib/httpErrors.js";

export interface ListMetricDefinitionsFilter {
  jurisdictionId?: string;
}

export async function listMetricDefinitions(
  db: AppDb,
  filters: ListMetricDefinitionsFilter = {},
): Promise<MetricDefinition[]> {
  const where: Record<string, unknown> = {};
  if (filters.jurisdictionId) where.jurisdictionId = filters.jurisdictionId;
  return db.models.MetricDefinition.findAll({ where });
}

export interface CreateMetricDefinitionInput {
  key: string;
  name: string;
  description?: string | null;
  unit: string;
  type: MetricType;
  aggregation: MetricAggregation;
  jurisdictionId?: string | null;
}

/**
 * Creates a custom metric dictionary entry. Not audited — `metric_definitions` rows are
 * dictionary metadata (name/unit/aggregation), not operational config that changes dispatch
 * behavior, and `AuditLog.entity`'s union deliberately excludes them.
 */
export async function createMetricDefinition(
  db: AppDb,
  input: CreateMetricDefinitionInput,
): Promise<MetricDefinition> {
  try {
    return await db.models.MetricDefinition.create({
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      unit: input.unit,
      type: input.type,
      aggregation: input.aggregation,
      builtin: false,
      jurisdictionId: input.jurisdictionId ?? null,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw conflict(`A metric definition with key "${input.key}" already exists`);
    }
    throw err;
  }
}

export interface MetricQueryInput {
  metric: string;
  jurisdictionId?: string;
  from: Date;
  to: Date;
  groupBy?: MetricQueryGroupBy;
}

export interface MetricQueryResultRow {
  bucket: string | null;
  value: number;
  count: number;
}

export interface MetricQueryResult {
  metric: string;
  aggregation: MetricAggregation;
  unit: string;
  rows: MetricQueryResultRow[];
}

/** Looks up the metric's configured aggregation so callers can't accidentally average a metric
 * defined as a p95, then delegates the actual SQL to shared/telemetry/queryMetrics.ts. */
export async function queryMetric(db: AppDb, input: MetricQueryInput): Promise<MetricQueryResult> {
  const definition = await db.models.MetricDefinition.findOne({ where: { key: input.metric } });
  if (!definition) throw notFound(`No metric definition found for key "${input.metric}"`);

  const rows = await queryMetrics(db.sequelize, {
    metricKey: input.metric,
    aggregation: definition.aggregation,
    jurisdictionId: input.jurisdictionId,
    from: input.from,
    to: input.to,
    groupBy: input.groupBy,
  });

  return {
    metric: input.metric,
    aggregation: definition.aggregation,
    unit: definition.unit,
    rows: rows.map((row) => ({ bucket: row.bucket, value: Number(row.value), count: Number(row.count) })),
  };
}
