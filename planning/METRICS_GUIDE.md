# Voyager — Metrics Guide

How Voyager's metric dictionary works, the 12 built-in metrics, how to query them, and how to define your own. See `API_REFERENCE.md` for raw endpoint shapes.

---

## Model

Two tables:
- **`metric_definitions`** — the dictionary: `key` (unique), `name`, `description`, `unit`, `type` (`counter|gauge|duration|rate`), `builtin`, `aggregation` (`sum|avg|p95|max`), `jurisdictionId` (nullable — `null` = global metric, applies system-wide).
- **`metric_points`** — the time series: one row per emitted data point (`metricKey`, `jurisdictionId`, `workerId?`, `orderId?`, `value`, `dimensions` JSONB, `ts`). This is the highest-volume table in the system (one row per dispatch decision), so it's monthly range-partitioned by `ts` with a 90-day default retention (see "Partitioning & retention" below) — not something you manage by hand.

**Aggregation is fixed per metric, not caller-chosen.** When you query a metric, the aggregation function used is whatever that metric's own `metric_definitions.aggregation` column says — there's no way for a caller to ask for a different rollup (e.g. you can't request `p95` on a metric defined as `avg`). This is deliberate: it keeps a dashboard from silently misinterpreting a metric it doesn't fully understand.

---

## The 12 built-in metrics

All seeded with `builtin: true`, `jurisdictionId: null` (system-wide).

| key | name | unit | type | aggregation | what it measures |
|---|---|---|---|---|---|
| `dispatch.response_time_ms` | Dispatch Response Time | `ms` | `duration` | `avg` | order creation → first auto-dispatch |
| `dispatch.time_to_assign_ms` | Time to Assign | `ms` | `duration` | `avg` | queue claim → assignment written |
| `assignment.duration_ms` | Assignment Duration | `ms` | `duration` | `avg` | dispatch → completion |
| `assignment.acceptance_rate` | Acceptance Rate | `ratio` | `rate` | `avg` | share of dispatches a worker accepts |
| `assignment.rejection_rate` | Rejection Rate | `ratio` | `rate` | `avg` | share of dispatches a worker rejects |
| `assignment.manual_override_rate` | Manual Override Rate | `ratio` | `rate` | `avg` | share of assignments created by manual reassign vs. the pipeline — a sustained rise flags a pipeline needing tuning |
| `sla.compliance_rate` | SLA Compliance Rate | `ratio` | `rate` | `avg` | share of completed orders finished before `slaDueAt` |
| `dispatch.queue_depth` | Queue Depth | `count` | `gauge` | `max` | pending/claimed `dispatch_queue` rows per jurisdiction |
| `worker.utilization` | Worker Utilization | `ratio` | `gauge` | `avg` | active assignments ÷ effective capacity |
| `worker.active_count` | Active Worker Count | `count` | `gauge` | `max` | workers with ≥1 active assignment |
| `worker.idle_count` | Idle Worker Count | `count` | `gauge` | `max` | `status: available` workers with 0 active assignments |
| `orders.created` | Orders Created | `count` | `counter` | `sum` | new (non-idempotent-replay) orders — basis for orders/hour |

Rate metrics (`acceptance_rate`, `rejection_rate`, `manual_override_rate`, `sla.compliance_rate`) are modeled as a **0/1 value per event, aggregated with `avg`** — averaging 0s and 1s over a time window *is* the rate, so there's no separate "ratio of two counters" mechanism.

`worker.utilization` excludes workers whose effective capacity resolves to `Infinity` (nothing set anywhere in the settings cascade — dividing by infinity is meaningless). `worker.active_count` counts any worker with an active assignment regardless of its `status` column; `worker.idle_count` requires **both** `status: "available"` and zero active assignments — a `busy`/`offline` worker with no active assignment counts as neither.

**On `dimensions`**: the `MetricPoint` model and `emitMetric()` both accept an optional `dimensions` JSONB blob for flexible tagging, but no shipped emitter in this codebase populates it today — every real call site (`engine/src/consumer.ts`, `api/src/services/{orderService,lifecycleService,assignmentService}.ts`, `engine/src/scheduler/gaugeSampler.ts`) omits it, so it's always stored as `{}`. Treat it as a forward-looking extensibility field for your own custom metrics, not something built-ins use.

---

## Querying metrics

```
GET /api/v1/metrics/query?metric=<key>&jurisdictionId=<uuid>&from=<ISO>&to=<ISO>&groupBy=<jurisdictionId|workerId|hour|day>
```
- `metric`, `from`, `to` are required; `jurisdictionId` and `groupBy` are optional.
- `from`/`to` form a half-open interval (`ts >= from AND ts < to`).
- `404` if `metric` doesn't match any `metric_definitions.key`.

Response:
```json
{
  "metric": "dispatch.response_time_ms",
  "aggregation": "avg",
  "unit": "ms",
  "rows": [
    { "bucket": "2026-08-05", "value": 4213.7, "count": 18 }
  ]
}
```
`bucket` is `null` (single row) when no `groupBy` is given.

### Example 1 — simple: system-wide average dispatch response time, last 24h

```bash
curl -s "http://localhost:3000/api/v1/metrics/query?metric=dispatch.response_time_ms&from=2026-08-05T00:00:00Z&to=2026-08-06T00:00:00Z" | jq
```

### Example 2 — complex: SLA compliance per jurisdiction, grouped by day, over a week

```bash
curl -s "http://localhost:3000/api/v1/metrics/query?metric=sla.compliance_rate&jurisdictionId=$CENTRAL_METRO_ID&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z&groupBy=day" | jq
```
```json
{
  "metric": "sla.compliance_rate",
  "aggregation": "avg",
  "unit": "ratio",
  "rows": [
    { "bucket": "2026-08-01", "value": 1.0, "count": 6 },
    { "bucket": "2026-08-02", "value": 0.83, "count": 12 },
    { "bucket": "2026-08-05", "value": 0.9, "count": 10 }
  ]
}
```
Days with no completed-SLA orders simply don't appear as a row (no zero-fill). Swap `groupBy=day` for `groupBy=workerId` to see the same rate broken out per worker instead, or drop `jurisdictionId` entirely to compare across every jurisdiction (add `groupBy=jurisdictionId` to see it broken out that way).

### Example 3 — manual override rate as a pipeline-health check

Per `PLAN.md`, a sustained rise in this metric is the signal that a jurisdiction's pipeline config needs tuning (dispatchers are routinely overriding what the pipeline picked):
```bash
curl -s "http://localhost:3000/api/v1/metrics/query?metric=assignment.manual_override_rate&jurisdictionId=$CENTRAL_METRO_ID&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z&groupBy=day" | jq
```

---

## Defining a custom metric

```
POST /api/v1/metrics/definitions
```
```json
{
  "key": "assignment.travel_distance_m",
  "name": "Assignment Travel Distance",
  "description": "Great-circle distance from worker to pickup at time of dispatch.",
  "unit": "m",
  "type": "gauge",
  "aggregation": "avg",
  "jurisdictionId": null
}
```
- `key`, `name`, `unit`, `type`, `aggregation` are required; `description` and `jurisdictionId` are optional/nullable.
- `builtin` is **not** an accepted input — even if you send `"builtin": true`, the server forces it to `false` for any metric created through this endpoint.
- A duplicate `key` returns `409 Conflict`.
- Custom definitions are **not audited** (`audit_log.entity` deliberately excludes `metric_definitions` — it's descriptive dictionary metadata, not operational config that changes dispatch behavior).
- Setting `jurisdictionId` to a specific UUID scopes the metric as jurisdiction-specific (useful if only one client tracks something bespoke); `null` makes it a global metric queryable the same way as any built-in.

Once defined, emitting points for it from your own integration (if you're extending `api`/`engine` code) uses the same `emitMetric()` helper every built-in uses:
```ts
await emitMetric(db, {
  metricKey: "assignment.travel_distance_m",
  jurisdictionId: order.jurisdictionId,
  workerId: assignment.workerId,
  orderId: order.id,
  value: distanceMeters,
});
```
There's no HTTP endpoint for emitting a raw metric point directly — points are written internally by `api`/`engine` service code as a side effect of real events (order created, assignment dispatched/completed, periodic gauge sampling), not pushed by external callers. If you need external systems to contribute a custom metric, that has to go through new code in `api`/`engine`, not a generic ingestion route.

Query it exactly like a built-in:
```bash
curl -s "http://localhost:3000/api/v1/metrics/query?metric=assignment.travel_distance_m&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z" | jq
```

---

## Partitioning & retention

`metric_points` is natively range-partitioned by `ts` (monthly), primary key `(id, ts)` (Postgres requires the partition key in the PK). The engine's scheduler (`maintainPartitions()`, `engine/src/scheduler/partitionMaintenance.ts`) runs daily by default:
- **Pre-creates** the current month plus 3 months ahead (4 partitions maintained at any time) — so a telemetry write never fails waiting on a partition to exist.
- **Drops** partitions whose entire range falls before `now - metrics.retention_days` (resolved globally, default `90`) — a metadata-only `DROP TABLE`, far cheaper than row-by-row deletion.
- A `metric_points_default` catch-all partition exists as a safety net for any `ts` outside the maintained monthly ranges and is never dropped by retention.

To change retention, `PUT` the global setting (see `SETTINGS_GUIDE.md`):
```bash
curl -s -X PUT http://localhost:3000/api/v1/settings/metrics.retention_days \
  -H "Content-Type: application/json" \
  -d '{ "scope": "global", "value": 180, "description": "Keep 6 months of raw metric points" }'
```
This is a global-only setting in practice — retention is resolved with no jurisdiction scoping (`db.settingsService.resolve("metrics.retention_days")`, no `jurisdictionId` context passed), so a jurisdiction/group-scope override wouldn't be consulted by the scheduler even if you set one.
