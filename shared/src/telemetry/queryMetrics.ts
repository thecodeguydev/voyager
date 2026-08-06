import { QueryTypes, type Sequelize } from "sequelize";
import type { MetricAggregation } from "../models/MetricDefinition.js";

export type MetricQueryGroupBy = "jurisdictionId" | "workerId" | "hour" | "day";

export interface MetricQueryInput {
  metricKey: string;
  aggregation: MetricAggregation;
  jurisdictionId?: string;
  from: Date;
  to: Date;
  groupBy?: MetricQueryGroupBy;
}

export interface MetricQueryRow {
  bucket: string | null;
  value: number;
  count: number;
}

const AGGREGATE_EXPRESSIONS: Record<MetricAggregation, string> = {
  sum: "SUM(value)",
  avg: "AVG(value)",
  max: "MAX(value)",
  p95: "PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)",
};

const GROUP_EXPRESSIONS: Record<MetricQueryGroupBy, string> = {
  jurisdictionId: `"jurisdictionId"::text`,
  workerId: `"workerId"::text`,
  hour: `to_char(date_trunc('hour', ts), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  day: `to_char(date_trunc('day', ts), 'YYYY-MM-DD')`,
};

/**
 * Aggregates `metric_points` for `GET /metrics/query`, using raw SQL (this codebase's idiom for
 * non-trivial queries — see `dispatch/eligibility.ts`). `aggregation` and `groupBy` are only ever
 * drawn from fixed whitelists (a metric_definitions row's own validated column, and a Zod enum at
 * the route layer) — never interpolated from free-form request text.
 */
export async function queryMetrics(sequelize: Sequelize, input: MetricQueryInput): Promise<MetricQueryRow[]> {
  const aggExpr = AGGREGATE_EXPRESSIONS[input.aggregation];
  const groupExpr = input.groupBy ? GROUP_EXPRESSIONS[input.groupBy] : null;

  const conditions = [`"metricKey" = :metricKey`, `ts >= :from`, `ts < :to`];
  if (input.jurisdictionId) conditions.push(`"jurisdictionId" = :jurisdictionId`);

  const sql = `
    SELECT ${groupExpr ? `${groupExpr} AS bucket` : "NULL AS bucket"}, ${aggExpr} AS value, COUNT(*)::int AS count
    FROM metric_points
    WHERE ${conditions.join(" AND ")}
    ${groupExpr ? `GROUP BY ${groupExpr} ORDER BY ${groupExpr}` : ""}
  `;

  return sequelize.query<MetricQueryRow>(sql, {
    replacements: {
      metricKey: input.metricKey,
      from: input.from,
      to: input.to,
      jurisdictionId: input.jurisdictionId ?? null,
    },
    type: QueryTypes.SELECT,
  });
}
