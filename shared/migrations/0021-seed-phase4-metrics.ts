import { randomUUID } from "node:crypto";
import type { QueryInterface } from "sequelize";

const RESPONSE_TIMEOUT_KEY = "assignment.response_timeout_ms";
const RETENTION_DAYS_KEY = "metrics.retention_days";

// Only used by down() to bulk-delete this migration's rows by key — the up() inserts use literal
// strings per row (a positional array indexed by number was harder to verify than just reading
// each object), so this list is kept in sync with those literals by hand.
const METRIC_KEYS = [
  "assignment.duration_ms",
  "assignment.acceptance_rate",
  "assignment.rejection_rate",
  "assignment.manual_override_rate",
  "sla.compliance_rate",
  "dispatch.queue_depth",
  "worker.utilization",
  "worker.active_count",
  "worker.idle_count",
  "orders.created",
];

// Phase 4's remaining built-in metric_definitions + the two global settings the SLA-expiry
// sweep and partition-retention scheduler resolve. Combined into one migration, matching 0019's
// settings+metric_definitions shape. Plain queryInterface.bulkInsert — migrations are loaded via
// Umzug's own dynamic import(), not routed through a TS-aware loader, so importing shared/src
// models here fails at runtime (see 0019's note).
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  const now = new Date();

  await queryInterface.bulkInsert("settings", [
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: RESPONSE_TIMEOUT_KEY,
      value: JSON.stringify(300_000),
      dataType: "number",
      description: "How long (ms) a dispatched assignment waits for a worker response before the scheduler expires it.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: RETENTION_DAYS_KEY,
      value: JSON.stringify(90),
      dataType: "number",
      description: "How many days of metric_points partitions the scheduler keeps before dropping them.",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await queryInterface.bulkInsert("metric_definitions", [
    {
      id: randomUUID(),
      key: "assignment.duration_ms",
      name: "Assignment Duration",
      description: "Time from dispatch to completion for a fulfilled assignment.",
      unit: "ms",
      type: "duration",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "assignment.acceptance_rate",
      name: "Acceptance Rate",
      description: "Share of dispatched assignments a worker accepts (vs. rejects or lets expire).",
      unit: "ratio",
      type: "rate",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "assignment.rejection_rate",
      name: "Rejection Rate",
      description: "Share of dispatched assignments a worker explicitly rejects.",
      unit: "ratio",
      type: "rate",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "assignment.manual_override_rate",
      name: "Manual Override Rate",
      description: "Share of assignments created by a dispatcher's manual reassign rather than the pipeline.",
      unit: "ratio",
      type: "rate",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "sla.compliance_rate",
      name: "SLA Compliance Rate",
      description: "Share of completed orders finished before their slaDueAt deadline.",
      unit: "ratio",
      type: "rate",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "dispatch.queue_depth",
      name: "Queue Depth",
      description: "Count of pending or claimed dispatch_queue rows for a jurisdiction.",
      unit: "count",
      type: "gauge",
      builtin: true,
      aggregation: "max",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "worker.utilization",
      name: "Worker Utilization",
      description: "A worker's active assignment count over its effective capacity.",
      unit: "ratio",
      type: "gauge",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "worker.active_count",
      name: "Active Worker Count",
      description: "Count of workers with at least one active assignment, per jurisdiction.",
      unit: "count",
      type: "gauge",
      builtin: true,
      aggregation: "max",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "worker.idle_count",
      name: "Idle Worker Count",
      description: "Count of available workers with zero active assignments, per jurisdiction.",
      unit: "count",
      type: "gauge",
      builtin: true,
      aggregation: "max",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: "orders.created",
      name: "Orders Created",
      description: "Count of new (non-idempotent-replay) orders — the basis for orders/hour.",
      unit: "count",
      type: "counter",
      builtin: true,
      aggregation: "sum",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.bulkDelete("settings", { key: [RESPONSE_TIMEOUT_KEY, RETENTION_DAYS_KEY] });
  await queryInterface.bulkDelete("metric_definitions", { key: METRIC_KEYS });
};
