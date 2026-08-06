/**
 * Single source of truth for built-in `metric_points` key strings, so emission call sites across
 * `api`/`engine` can't drift from each other or from the seed migration. Migrations can't import
 * `shared/src` (Umzug's dynamic `import()` isn't TS-aware-loader-routed), so the seed migration
 * duplicates these as literals — this module is for runtime emission/query call sites only.
 */
export const METRIC_KEYS = {
  DISPATCH_RESPONSE_TIME_MS: "dispatch.response_time_ms",
  DISPATCH_TIME_TO_ASSIGN_MS: "dispatch.time_to_assign_ms",
  ASSIGNMENT_DURATION_MS: "assignment.duration_ms",
  ASSIGNMENT_ACCEPTANCE_RATE: "assignment.acceptance_rate",
  ASSIGNMENT_REJECTION_RATE: "assignment.rejection_rate",
  ASSIGNMENT_MANUAL_OVERRIDE_RATE: "assignment.manual_override_rate",
  SLA_COMPLIANCE_RATE: "sla.compliance_rate",
  DISPATCH_QUEUE_DEPTH: "dispatch.queue_depth",
  WORKER_UTILIZATION: "worker.utilization",
  WORKER_ACTIVE_COUNT: "worker.active_count",
  WORKER_IDLE_COUNT: "worker.idle_count",
  ORDERS_CREATED: "orders.created",
} as const;

export type MetricKey = (typeof METRIC_KEYS)[keyof typeof METRIC_KEYS];
