# Voyager — Dispatch Engine

## Vision

Voyager is a powerful, flexible, smart and universal dispatch engine that dispatches orders to utility workers, delivery drivers, and cab drivers. Voyager has a visually stunning interface that provides telemetry for each case dispatch, case statuses, and an interface to adjust global and jurisdictional settings. Telemetry is a first-class concern.

Agents interact through files in `planning/`.

---

## Product Requirements

- **Groups & jurisdictions** — a **group** is the client/tenant; it houses one or more **jurisdictions** (geographic regions), which in turn hold zones, workers, and schedules.
- **Availability** — via schedules (on-duty windows) and zoning (geographic coverage).
- **Universal/flexible settings** — a settings system that manages settings globally, per group, and per jurisdiction, with inheritance and overrides.
- **Order priorities & matching** — a **composable dispatch pipeline** (see below) handling universal and per-jurisdiction logic for priority, worker matching, scoring, and tiebreaking.
- **Manual override** — dispatchers can override or reassign any dispatch by hand, with a full audit trail.
- **Metric dictionaries** — predefined and user-defined metrics with a flexible telemetry system.

---

## Confirmed Decisions

These decisions were confirmed with the product owner and drive the architecture below.

| Area | Decision |
|---|---|
| **Database** | **PostgreSQL only**, with the **PostGIS** extension for geospatial. Postgres-specific features are permitted (native geo types, GiST indexes, `SKIP LOCKED`, `LISTEN/NOTIFY`, `JSONB`). |
| **Engine mode** | **Real-time, long-running service.** Reacts to new orders promptly and runs periodic rebalancing. |
| **Group (client)** | The **client / tenant** at the top of the hierarchy. Houses one or more jurisdictions; can carry client-level setting defaults. |
| **Jurisdiction** | A **geographic region** belonging to a group, with independent settings, workers, zones, schedules, and dispatch rules. |
| **Auth** | **Deferred.** Built without auth initially; API and data model leave room to layer RBAC in later. |
| **Telemetry** | **Full suite** — dispatch performance + workforce metrics + **custom metric dictionaries**. |
| **Worker interaction** | **API-only.** Workers are managed by external systems that call Voyager's API. No worker portal. |
| **Priorities** | **Composable pipeline** — ordered, toggleable, reorderable stages (Tier / Scoring / Tiebreak) per jurisdiction, with presets. |
| **Settings changes** | **Instant + full audit log** (who / when / old → new) with rollback. |

---

## System Architecture

Three cooperating services plus a shared PostgreSQL database. **The shared database is also the message bus** between the API and the engine — no Redis/Kafka dependency. Because the stack is Postgres-only, the queue uses `SKIP LOCKED` for crash-safe claiming and `LISTEN/NOTIFY` for low-latency wake-ups.

```
   External Sources                       Operators / Dispatchers
        │  (orders, workers,                     │  (dashboard, settings)
        │   status updates)                      │
        ▼                                        ▼
┌──────────────────┐                    ┌──────────────────────┐
│   api (Express)  │                    │  interface (Next.js) │
│  ingestion +     │◄───────REST───────►│  telemetry + admin   │
│  CRUD + settings │                    └──────────────────────┘
└───────┬──────────┘
        │ writes orders + dispatch_queue rows
        ▼
┌───────────────────────────────────────────────┐
│      Shared DB (PostgreSQL + PostGIS)          │
│  orders · dispatch_queue · assignments ·       │
│  workers · zones · schedules · settings ·      │
│  pipeline_config · audit_log · metrics         │
└───────────────────────────────────────────────┘
        ▲ claims work via SKIP LOCKED,
        │ woken by LISTEN/NOTIFY
┌───────┴──────────┐
│  engine (Node)   │
│  queue-consumer  │
│  pipeline runner │
│  lifecycle + SLA │
│  telemetry emit  │
└──────────────────┘
```

### Why a DB-backed queue (not Redis/Kafka)

- **No extra infrastructure** — the queue lives in the DB we already run. Row-claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`, expressed in Sequelize via `lock` + `skipLocked` transaction options.
- **Low latency** — `LISTEN/NOTIFY` wakes idle engine instances the instant a `dispatch_queue` row is inserted, so dispatch isn't bounded by the poll interval. A short poll remains as a safety net for missed notifications.
- **Crash-safe, at-least-once** delivery.
- **Horizontally scalable** — multiple engine instances claim disjoint rows via `SKIP LOCKED`, so no double-dispatch and no coordinator needed.

### Queue notification mechanism

The queue combines three cooperating parts: a **notify** on insert (low latency), a **poll** loop (safety net), and **`SKIP LOCKED` claiming** (the source of truth). NOTIFY only *hints* that work exists; it never carries the work itself.

**1. Fire on insert — a DB trigger.** A trigger on `dispatch_queue` fires `pg_notify` after each insert, so the signal happens in the same transaction that enqueues the work — nothing can enqueue without notifying. The payload is small: just the `jurisdictionId` (the engine looks up the actual rows via `SKIP LOCKED`, so the payload is a hint, not data).

```sql
CREATE FUNCTION notify_dispatch() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dispatch_new', NEW."jurisdictionId"::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dispatch_queue_notify
  AFTER INSERT ON dispatch_queue
  FOR EACH ROW EXECUTE FUNCTION notify_dispatch();
```

Firing from a trigger (not from API code) guarantees the notify can't be forgotten and stays consistent even for rows inserted by re-queue/rebalance paths.

**2. Listen in the engine.** Each engine instance holds one dedicated Postgres connection running `LISTEN dispatch_new`. On a notification it runs a claim cycle immediately. Because `pg_notify` payloads are deduplicated within a transaction and delivered per-connection, a burst of inserts collapses into a small number of wake-ups.

```
onNotification('dispatch_new'):   → claimCycle()
every POLL_INTERVAL_MS (e.g. 5s): → claimCycle()   // safety net, see below
```

**3. Claim — the source of truth.** Every wake-up (notify *or* poll) runs the same `queue.claim()`:

```sql
UPDATE dispatch_queue SET status = 'claimed', "claimedBy" = :instanceId, "claimedAt" = now()
WHERE id IN (
  SELECT id FROM dispatch_queue
  WHERE status = 'pending' AND "nextAttemptAt" <= now()
  ORDER BY "nextAttemptAt"
  FOR UPDATE SKIP LOCKED
  LIMIT :batchSize
)
RETURNING *;
```

`SKIP LOCKED` guarantees two instances never grab the same row, so correctness never depends on notification delivery — NOTIFY only changes *how fast* a pending row is picked up, never *whether* it is.

**Why the poll is mandatory, not optional.** `LISTEN/NOTIFY` is fire-and-forget: an instance that is down, restarting, or has a dropped LISTEN connection at the moment of `pg_notify` **never receives that signal**. The periodic poll is what recovers those rows (and rows whose `nextAttemptAt` is a future retry time that no insert will re-announce). Notify optimizes the hot path; poll guarantees liveness.

**Tuning & caveats.**
- `POLL_INTERVAL_MS` is the worst-case pickup latency if a notification is missed — keep it short (a few seconds). It's cheap: the claim query is a single indexed statement.
- The LISTEN connection must **auto-reconnect and re-issue `LISTEN`**; on reconnect, run one immediate `claimCycle()` to catch anything enqueued while disconnected.
- After claiming a full batch, loop `claimCycle()` again immediately (don't wait for the next signal) until a cycle returns fewer than `batchSize` rows — this drains backlogs without relying on one-notify-per-row.
- This is Postgres-native and needs no broker; if throughput ever outgrows a single DB, the same `queue.claim()` seam can front a dedicated broker without touching dispatch logic.

---

## Key Design Decisions

Three architectural decisions carry the most weight. Each is recorded here with its rationale, trade-offs, and the alternative that was rejected.

### 1. The database is the message bus (DB-backed queue)

**Decision:** The API and engine communicate through a `dispatch_queue` table rather than Redis, Kafka, or a broker. Mechanics — trigger-fired `NOTIFY`, poll safety net, and `SKIP LOCKED` claiming — are detailed in [Queue notification mechanism](#queue-notification-mechanism) above.

- **Trade-off:** The DB absorbs the queue load rather than a purpose-built broker. Acceptable for the real-time-but-not-microsecond dispatch domain; if throughput ever outgrows this, a broker can be introduced behind the same `queue.claim()` seam.
- **Rejected alternative:** A dedicated broker (Redis Streams / Kafka) — faster at very high throughput, but adds an operational dependency for a load this design comfortably handles in-DB.

### 2. Pipeline configuration is stored as JSONB, not normalized rows

**Decision:** Each jurisdiction's composable pipeline lives in a single `pipeline_configs.stages` `JSONB` column (an ordered array of stage objects) rather than in `stages` / `stage_params` tables.

- **Why:** The pipeline is always read as one whole unit per dispatch, is versioned and audited atomically (one `before`/`after` snapshot in `audit_log`), and its shape varies by stage type (a Scoring stage's config is nothing like a Tiebreak stage's). A `JSONB` column matches the access pattern and the variable schema, and stays queryable if cross-config analytics are ever needed.
- **Trade-off:** Cross-config analytics (e.g. "every jurisdiction weighting distance > 0.5") need `JSONB` operators or GIN indexing rather than plain columns — still doable, just less ergonomic than normalized rows.
- **Rejected alternative:** Fully normalized stage tables — better for cross-config SQL analytics, but heavier to read, harder to reorder, and awkward to snapshot atomically for audit/rollback.

### 3. `api` and `engine` share models and settings logic via `shared/`

**Decision:** Sequelize models and the `SettingsService` (global → group → jurisdiction resolution) live in a `shared/` package imported by both the API and the engine — one source of truth, not duplicated per service.

- **Why:** Both services read the same tables and must resolve effective settings identically. Duplicating models invites drift where the engine and API disagree on schema or resolution rules — a class of bug that's expensive to diagnose.
- **Trade-off:** The two services are coupled to a shared library, so a model change is a coordinated release. Preferable to silent divergence.
- **Rejected alternative:** Each service owns its own models — looser coupling, independent deploys, but guaranteed drift over time and no single settings-resolution authority.

---

## Data Model (Sequelize)

PostgreSQL-native types. Money as `DECIMAL`, geospatial as PostGIS `GEOGRAPHY` (SRID 4326) with GiST indexes, flexible config as `JSONB`, states as `STRING` enums validated in the model layer (kept app-level for easy mutation rather than native `ENUM`). All tables carry `id` (UUID), `createdAt`, `updatedAt`.

### Core entities

**`groups`** — the **client / tenant** at the top of the hierarchy; houses jurisdictions.
- `name`, `code` (unique), `description`, `status` (`active`/`inactive`).

**`jurisdictions`** — geographic regions belonging to a group (client).
- `groupId` → groups, `name`, `code` (unique within group), `timezone`, `status` (`active`/`inactive`), `settingsVersion` (INT, bumped on any settings change — drives engine hot-reload).

**`zones`** — geographic coverage areas within a jurisdiction.
- `jurisdictionId`, `name`, `boundary` (`GEOGRAPHY(POLYGON, 4326)`), `centroid` (`GEOGRAPHY(POINT, 4326)`), `status`.
- GiST index on `boundary`. Point-in-zone via `ST_Covers`, distance via `ST_Distance` / `ST_DWithin` — all in-DB.

**`workers`** — dispatch targets, managed via API.
- `jurisdictionId` (→ jurisdiction → group, so the client is derived, not stored twice), `externalId` (caller-supplied by the external system; **unique on (`jurisdictionId`, `externalId`)**), `name`, `type` (`utility`/`delivery`/`cab`), `skills` (`JSONB` array), `maxConcurrent` (INT, nullable — null inherits the resolved capacity default), `location` (`GEOGRAPHY(POINT, 4326)`, GiST-indexed), `status` (`available`/`busy`/`offline`).

**`zone_workers`** — many-to-many worker ↔ zone coverage. (`workerId`, `zoneId`).

**`schedules`** — worker availability windows.
- `workerId`, `dayOfWeek` (0–6) or `date` (for one-offs), `startTime`, `endTime`, `type` (`shift`/`timeoff`), `recurring` (BOOL).

### Orders & dispatch

**`orders`** — incoming work items.
- `jurisdictionId`, `externalId` (caller-supplied by the external system; **unique on (`jurisdictionId`, `externalId`)** — also the idempotency key for re-submitted orders), `type`, `priorityTier` (`critical`/`high`/`normal`/`low`, nullable — pipeline may compute), `payload` (`JSONB`: address, skills required, time window), `pickup` (`GEOGRAPHY(POINT, 4326)`, GiST-indexed), `state` (`created`/`queued`/`dispatched`/`accepted`/`in_progress`/`completed`/`cancelled`/`failed`), `slaDueAt` (DATE), `createdAt`.
- Index: (`jurisdictionId`, `state`), (`slaDueAt`).

**`dispatch_queue`** — the work queue / outbox the engine claims from.
- `orderId`, `jurisdictionId`, `status` (`pending`/`claimed`/`done`/`error`), `claimedBy` (engine instance id), `claimedAt`, `attempts` (INT), `nextAttemptAt`, `lastError`.
- Index: (`status`, `nextAttemptAt`) — the claim query.

**`engine_instances`** — engine heartbeat / liveness registry (backs `GET /health/engine`).
- `instanceId` (unique — the id used in `dispatch_queue.claimedBy`), `state` (`healthy`/`stopped`), `lastHeartbeatAt` (DATE), `claimedInFlight` (INT — rows currently claimed but not yet done), `startedAt`, `version` (build/commit, nullable).
- Written via `UPSERT` on startup and every heartbeat interval (`≤ POLL_INTERVAL_MS`). Health = `now() - lastHeartbeatAt` under a staleness threshold. No FK to other tables; it is a standalone liveness record read across the shared-DB boundary.

**`assignments`** — order ↔ worker dispatch records (lifecycle).
- `orderId`, `workerId`, `jurisdictionId`, `state` (`dispatched`/`accepted`/`rejected`/`in_progress`/`completed`/`cancelled`/`expired`/`overridden`), `source` (`auto`/`manual`), `score` (DECIMAL, from pipeline; null for manual), `pipelineTrace` (`JSONB` — which stages ran, why this worker won), `overriddenBy` (actor, nullable), `overrideReason` (text, nullable), `dispatchedAt`, `respondedAt`, `completedAt`, `expiresAt`.
- Index: (`workerId`, `state`) for capacity checks; (`orderId`).

### Inbound webhooks

An alternative **push** transport in front of the same ingestion logic the REST API uses — external systems POST events to Voyager instead of calling each endpoint directly. The webhook maps every payload to the identical internal action (`order.create`, order lifecycle, `worker.status`/`worker.location`), so there is one ingestion path and two transports.

**`webhook_sources`** — registered external senders allowed to push.
- `groupId` → groups (**scope: a source belongs to one client and may push for any jurisdiction under that group**), `name`, `slug` (unique — the identifier in the receive URL, e.g. `/webhooks/:slug`), `secret` (HMAC signing secret; write-only, never returned in reads), `allowedEvents` (`JSONB` array of event types, or null = all supported), `status` (`active`/`disabled`), `lastReceivedAt` (DATE, nullable).
- Voyager verifies each request's `X-Voyager-Signature` HMAC against `secret`; a disabled source is rejected.

**`webhook_events`** — receipt log for every inbound delivery (idempotency + audit + replay).
- `sourceId` → webhook_sources, `groupId`, `eventType`, `dedupeKey` (sender-supplied event id), `signatureValid` (BOOL), `payload` (`JSONB` — raw body as received), `status` (`received`/`processed`/`failed`/`skipped`), `targetEntity` (`order`/`assignment`/`worker`, nullable), `targetId` (nullable — the row created/updated), `error` (text, nullable), `receivedAt` (DATE), `processedAt` (DATE, nullable).
- **Unique (`sourceId`, `dedupeKey`)** — the idempotency guard: a redelivered event (webhooks retry) is recognized and short-circuited to `skipped` rather than double-applied.
- Index: (`status`, `receivedAt`) for the retry/replay sweep and a failed-delivery view in the UI.

### Settings & configuration

**`settings`** — universal/flexible key-value settings with inheritance.
- `scope` (`global`/`group`/`jurisdiction`), `groupId` (nullable), `jurisdictionId` (nullable), `key`, `value` (`JSONB`), `dataType`, `description`.
- Unique on (`scope`, `groupId`, `jurisdictionId`, `key`).
- **Resolution:** effective value cascades **jurisdiction → group → global** (most specific wins). Resolved in a `SettingsService` shared by API and engine.
- **Example — worker capacity default:** `worker.max_concurrent` is seeded globally, optionally overridden per group (client) or jurisdiction; a worker's own `maxConcurrent` is the final override. So effective capacity = `worker.maxConcurrent ?? jurisdiction ?? group ?? global`.

**`pipeline_configs`** — the composable dispatch pipeline per jurisdiction.
- `jurisdictionId` (unique), `preset` (`simple`/`balanced`/`advanced`/`custom`), `stages` (`JSONB` — ordered array; see below), `enabled`.

Pipeline `stages` JSON shape:
```json
[
  { "type": "tier",     "enabled": true,  "config": { "tiers": ["critical","high","normal","low"], "sla": { "critical": 15, "high": 60 } } },
  { "type": "scoring",  "enabled": true,  "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } },
  { "type": "tiebreak", "enabled": true,  "config": { "strategy": "round_robin" } }
]
```
Stored as `JSONB` (not normalized rows) because the config is read as a whole unit per dispatch, is versioned/audited atomically, and its shape varies by stage type.

**`audit_log`** — every settings, pipeline, and manual-dispatch change.
- `entity` (`setting`/`pipeline_config`/`assignment`), `entityId`, `groupId` (nullable — set for group-scope changes), `jurisdictionId` (nullable), `action` (`create`/`update`/`delete`/`reassign`/`override`/`unassign`), `actor` (string — placeholder until auth), `reason` (text, nullable — required for manual dispatch actions), `before` (`JSONB`), `after` (`JSONB`), `createdAt`.
- Rollback = apply a prior `before` snapshot as a new change (also audited).

### Telemetry / metric dictionaries

**`metric_definitions`** — the metric dictionary (predefined + custom).
- `key` (unique), `name`, `description`, `unit`, `type` (`counter`/`gauge`/`duration`/`rate`), `builtin` (BOOL), `aggregation` (`sum`/`avg`/`p95`/`max`), `jurisdictionId` (nullable — custom metrics can be jurisdiction-scoped).

**`metric_points`** — emitted time-series data. The highest-volume table (one row per dispatch decision), so growth is managed by partitioning + retention rather than left unbounded.
- `metricKey`, `jurisdictionId`, `workerId` (nullable), `orderId` (nullable), `value` (DECIMAL), `dimensions` (`JSONB` — flexible tags), `ts` (DATE).
- Index: (`metricKey`, `jurisdictionId`, `ts`) for dashboard queries.
- **Partitioning:** native **declarative range partitioning by `ts`** (monthly), so the hot index stays small and old data drops cheaply. Partitions are created ahead of time by the scheduler.
- **Retention:** raw points are kept for a configurable window (a resolved setting, default **90 days**); partitions older than the window are `DROP`ped (a metadata-only operation — far cheaper than row-by-row `DELETE`). Rollup/aggregate tables for longer-range dashboards are a deferred add (see Suggestions) — only build them if dashboards need history beyond the raw window.

**Built-in metrics** (seeded into `metric_definitions`): dispatch response time, time-to-assign, assignment duration, acceptance rate, rejection rate, SLA compliance %, queue depth, worker utilization, active/idle worker counts, orders/hour, manual override rate.

---

## Dispatch Engine

A real-time Node.js service. Modules with tight boundaries:

| Module | Responsibility |
|---|---|
| `queue-consumer` | Claims `dispatch_queue` rows via row-locking; owns the poll loop and backoff. |
| `resolver` | Resolves jurisdiction from the order; loads pipeline config + effective settings (from cache). |
| `matcher` | Finds candidate workers within the order's jurisdiction: zone (`ST_Covers`/`ST_DWithin`) ∩ on-duty (schedule) ∩ under effective capacity. |
| `pipeline` | Loads and composes stages; runs candidates through them (strategy pattern). |
| `assigner` | Transactionally writes the winning `assignment`; **locks the chosen worker row (`SELECT … FOR UPDATE`) and re-checks capacity inside that lock** so two instances can't over-assign the same worker. |
| `lifecycle` | Assignment state machine; handles accept/reject/complete/expire and manual override/reassign transitions. |
| `scheduler` | Periodic sweep: expired assignments, SLA-breach warnings, workload rebalance. |
| `telemetry` | Emits `metric_points` for every decision. |
| `settings-cache` | In-memory effective settings + pipeline config per jurisdiction; hot-reload. |
| `heartbeat` | Upserts this instance's `engine_instances` row on startup and every interval (`≤ POLL_INTERVAL_MS`); marks `stopped` on graceful shutdown. Backs `GET /health/engine`. |

### Dispatch flow

1. API ingests an order → writes `orders` row (`state=queued`) + `dispatch_queue` row (`status=pending`) in one transaction.
2. `queue-consumer` (woken by `NOTIFY` or a short poll) claims a batch: `SELECT ... FOR UPDATE SKIP LOCKED`, marks `claimed` + `claimedBy`.
3. `resolver` loads the jurisdiction's pipeline config and effective settings from `settings-cache`.
4. `matcher` builds the candidate worker set via the filter chain.
5. `pipeline` runs candidates through enabled stages in order (see below).
6. `assigner` opens a transaction, **locks the top worker's row with `SELECT … FOR UPDATE` and re-checks capacity under that lock** (falling to the next candidate if the worker filled up since matching), writes the `assignment` (`state=dispatched`), sets `order.state=dispatched`, marks the queue row `done`.
7. `telemetry` emits response-time, queue-depth, and decision metrics.
8. External system reports back (accept/reject/progress/complete) via API → `lifecycle` advances the assignment; rejects/expiries re-queue the order.

### State invariants

An order's lifecycle spans three tables — `orders.state`, `dispatch_queue.status`, and `assignments.state` — each with its own machine. These must stay consistent; the following invariants hold at every transaction boundary and are what the re-queue / expire / unassign paths must preserve:

| Order `state` | `dispatch_queue` | Active assignment* |
|---|---|---|
| `queued` | exactly one `pending` or `claimed` row | none |
| `dispatched` / `accepted` / `in_progress` | the row is `done` | exactly one, in the matching state |
| `completed` / `cancelled` | `done` (or no row) | at most one terminal (`completed`/`cancelled`) |
| `failed` | one `error` row (dead-letter) | none active |

\* "active" = not in a terminal state (`rejected`/`expired`/`overridden`/`completed`/`cancelled`).

- **Re-queue** (reject / expire / unassign) transitions the current assignment to a terminal state **and** inserts a fresh `pending` `dispatch_queue` row **and** sets `order.state=queued`, all in one transaction — never a partial move.
- An order never has two active assignments simultaneously; the `assigner` capacity lock (above) plus this invariant guarantee it.
- Manual `unassign` is the only path that returns a non-terminal order to `queued` by hand; it follows the same all-in-one-transaction rule.

### Composable pipeline (strategy pattern)

Each stage implements a common interface:

```js
// run(candidates, ctx) -> candidates   (filtered and/or ranked)
class Stage { run(candidates, ctx) { /* ... */ } }
```

The runner is a reduce over enabled stages, in configured order:

```js
const finalCandidates = enabledStages.reduce(
  (candidates, stage) => stage.run(candidates, ctx),
  initialCandidates
);
const winner = finalCandidates[0];
```

- **TierFilter** — assigns/reads the order's priority tier, applies SLA (`slaDueAt`), and can gate which workers are eligible for high tiers.
- **Scoring** — computes a weighted score per candidate (distance via PostGIS `ST_Distance`, skill match, wait time, …); sorts descending.
- **Tiebreak** — resolves equal scores via `fifo` / `round_robin` / `nearest` (`ST_Distance`).

Stages are **optional and reorderable**; a jurisdiction may run only Scoring, or Tier→Scoring→Tiebreak. **Presets** seed common configs; **Custom** unlocks full per-stage editing. Each dispatch records a `pipelineTrace` in the assignment for full explainability in the telemetry UI.

### Manual override & reassignment

Dispatchers can intervene on any dispatch by hand — reassign to a chosen worker, or unassign back into the queue — bypassing the pipeline. Every action is audited.

**Workflow:**
1. Dispatcher picks an order/assignment in the UI (or calls the API) and chooses a target worker, or "unassign".
2. The API validates the target (jurisdiction match). Soft constraints — off-duty, out-of-zone, at capacity — are surfaced as **warnings**, not hard blocks; overriding them requires an explicit `force` flag and a reason.
3. The current assignment (if any) transitions to `overridden`; a new assignment is created with `source=manual`, `overriddenBy=actor`, `overrideReason`, and `score=null` (no pipeline ran).
4. The engine **does not auto-re-dispatch** a `manual` assignment — a deliberate human decision is not silently undone by the pipeline or rebalancer. Manual assignments still follow the normal accept/reject/complete/expire lifecycle.
5. An `audit_log` row is written (`entity=assignment`, `action=reassign`/`override`/`unassign`, `before`/`after`, `actor`, `reason`), and a `manual_override` metric is emitted.

**Unassign** re-queues the order (`dispatch_queue.status=pending`) so the pipeline runs again — the escape hatch back to automatic dispatch.

### Settings hot-reload

- `settings-cache` holds effective settings + pipeline config keyed by jurisdiction, tagged with `settingsVersion`.
- Every settings/pipeline write via the API bumps `jurisdictions.settingsVersion` (and audits the change). A **group-scope** change bumps `settingsVersion` on every jurisdiction under that group, so client-level defaults propagate to all affected jurisdictions.
- The engine cheaply checks `settingsVersion` per jurisdiction each cycle (and can subscribe via `NOTIFY` on change); on change it reloads that jurisdiction's config. No restart.

### Resilience & scale

- **No double-dispatch** — two independent guards: `SKIP LOCKED` row-claiming stops two instances processing the same *queue row*, and a `SELECT … FOR UPDATE` lock on the chosen worker row (with an in-lock capacity re-check) in `assigner` stops two instances over-assigning the same *worker* from different orders. The queue lock alone does not cover the second case.
- **No-response** — assignments have `expiresAt`; the scheduler expires them and re-queues the order with incremented `attempts`.
- **Retries** — `dispatch_queue.attempts` + `nextAttemptAt` exponential backoff; dead-letter (`status=error`) after N attempts, surfaced in the UI.
- **Horizontal scale** — run N engine instances; `SKIP LOCKED` guarantees disjoint claims.

---

## Backend API (Express)

REST, JSON. Versioned under `/api/v1`. No **user auth / RBAC** yet (middleware seam left in place — see Suggestions). Note this is distinct from webhook **payload authentication**: inbound `POST /webhooks/:slug` requests are HMAC-signature-verified against a per-source secret regardless of the deferred RBAC. Signing authenticates the *sender of a payload*; RBAC authorizes a *human operator* — the two are independent concerns.

| Resource | Endpoints |
|---|---|
| Groups (clients) | `GET/POST /groups`, `GET/PUT/DELETE /groups/:id` |
| Jurisdictions | `GET/POST /groups/:gid/jurisdictions`, `GET/PUT/DELETE /jurisdictions/:id` |
| Zones | `GET/POST /jurisdictions/:jid/zones`, `GET/PUT/DELETE /zones/:id` |
| Workers | `GET/POST /workers`, `GET/PUT/DELETE /workers/:id`, `PUT /workers/:id/status`, `PUT /workers/:id/location` |
| Schedules | `GET/POST /workers/:id/schedules`, `PUT/DELETE /schedules/:id` |
| **Orders (ingestion)** | `POST /orders` (external submit → queues dispatch), `GET /orders`, `GET /orders/:id` |
| Order lifecycle | `POST /orders/:id/accept`, `/reject`, `/progress`, `/complete`, `/cancel` (called by external worker systems) |
| **Manual dispatch** | `POST /orders/:id/reassign` (`{ workerId, reason, force? }`), `POST /orders/:id/unassign` (`{ reason }` → re-queue), `GET /orders/:id/audit` (dispatch audit trail) |
| Assignments | `GET /assignments`, `GET /orders/:id/assignments` |
| Settings | `GET /settings?scope=&groupId=&jurisdictionId=`, `PUT /settings/:key`, `GET /settings/:key/audit`, `POST /settings/:key/rollback` |
| Pipeline | `GET/PUT /jurisdictions/:jid/pipeline`, `GET /pipeline/presets`, `GET .../pipeline/audit` |
| Metrics | `GET /metrics/definitions`, `POST /metrics/definitions` (custom), `GET /metrics/query?metric=&jurisdictionId=&from=&to=&groupBy=` |
| **Webhooks (inbound)** | `POST /webhooks/:slug` (external push → same ingestion path), `GET/POST /groups/:gid/webhook-sources`, `GET/PUT/DELETE /webhook-sources/:id`, `POST /webhook-sources/:id/rotate-secret`, `GET /webhook-sources/:id/events` (receipt log) |
| Health | `GET /health`, `GET /health/engine` |

Order ingestion writes the order + queue row transactionally, then returns `202 Accepted` — the engine dispatches asynchronously.

### Inbound webhooks

`POST /webhooks/:slug` is the single receive endpoint; the `:slug` resolves the `webhook_source` (and therefore its group scope). Processing:

1. **Verify** the `X-Voyager-Signature` HMAC against the source's `secret`; reject a bad signature or a `disabled` source with `401`. Record `signatureValid` on the receipt regardless.
2. **Deduplicate** on (`sourceId`, `dedupeKey`) — a redelivery returns `200` immediately with the prior result (`status=skipped`), so senders can safely retry.
3. **Map & apply** — the payload's `eventType` (e.g. `order.create`, `order.accept`, `worker.status`) is dispatched to the **same service call the matching REST endpoint uses**; the affected jurisdiction must belong to the source's group or the event is `failed` with `403`-class detail. For `order.create` this writes the order + `dispatch_queue` row transactionally, identical to `POST /orders`.
4. **Respond** `202 Accepted` on success (dispatch is async), and always write a `webhook_events` row capturing outcome, `targetEntity`/`targetId`, and any error — the audit and replay trail.

Because every delivery is logged and idempotent, a `failed` event can be **replayed** from the receipt log once the underlying issue is fixed, without the sender resending.

### Health checks

Two endpoints, both dependency-light so a monitor or load balancer can poll them cheaply.

- **`GET /health` — API liveness + readiness.** Returns `200` when the process is up and a trivial DB probe (`SELECT 1`) succeeds within a short timeout; `503` otherwise. Body reports each checked dependency:
  ```json
  { "status": "ok", "checks": { "db": "ok" }, "ts": "2026-08-05T12:00:00Z" }
  ```

- **`GET /health/engine` — engine liveness, seen through the shared DB.** The API has no direct link to the engine, so it reads the engine's **heartbeat** rows (see `engine_instances` below). For each instance it compares `lastHeartbeatAt` against a staleness threshold (a resolved setting, default `3 × POLL_INTERVAL_MS`). Response:
  ```json
  {
    "status": "ok",
    "instances": [
      { "instanceId": "engine-7f3a", "state": "healthy", "lastHeartbeatAt": "2026-08-05T11:59:58Z", "claimedInFlight": 4 }
    ],
    "healthyCount": 1,
    "ts": "2026-08-05T12:00:00Z"
  }
  ```
  `status` is `ok` when at least one instance is fresh, `degraded` when every instance is stale (dispatch has effectively stalled), and the endpoint returns `503` in the `degraded` case so external monitors alarm on it. Stale rows older than a retention window are ignored (they represent instances that have permanently exited).

**Heartbeat mechanism.** Each engine instance `UPSERT`s a row into `engine_instances` on startup and then on a fixed interval (`≤ POLL_INTERVAL_MS`), updating `lastHeartbeatAt` and lightweight liveness counters. This is the single source of truth for engine health across the shared-DB boundary — no direct API↔engine channel is introduced, staying consistent with the DB-as-message-bus decision. On graceful shutdown an instance marks itself `stopped`; a crashed instance simply goes stale and is detected by the threshold.

---

## Interface (Next.js)

Desktop-first, data-dense, professional. App Router + TypeScript. Server Components for data-heavy reads, client components for live telemetry.

### Screens

1. **Command Dashboard** — global telemetry: live queue depth, active dispatches, SLA compliance gauges, worker utilization, orders/hour, **manual override rate** (health signal — a sustained rise flags pipeline config that needs tuning), map of active assignments. The visual centerpiece.
2. **Dispatch Telemetry** — per-case timeline: order → pipeline trace (which stages ran, why this worker won) → lifecycle events, including manual overrides shown distinctly. Full explainability. **Reassign/unassign** action here: worker picker with availability warnings, required reason.
3. **Orders** — filterable table of orders and their states, drill into any order; inline reassign/unassign with audit history.
4. **Workers** — roster, availability (schedule + zone), current status, utilization.
5. **Groups (Clients) & Jurisdictions** — a group (client) list, drilling into its jurisdictions; jurisdiction detail is the entry point to zones, workers, settings, and pipeline. Settings can be edited at group or jurisdiction scope.
6. **Pipeline Editor** — visual, drag-to-reorder stage builder with per-stage config; preset picker; live preview.
7. **Settings** — global, per-group, and per-jurisdiction key/value editor with inline audit history and one-click rollback.
8. **Metrics Dictionary** — browse built-in metrics, define custom ones.

### Design system

Implements the palette below as CSS variables / Tailwind theme tokens. Charts use the secondary palette per the `dataviz` conventions. Live data via polling (SWR) initially; WebSocket/SSE upgrade path later.

---

## Repository Layout

```
Voyager/
├── api/        # Express + Sequelize — ingestion, CRUD, settings, metrics query
│   ├── src/{models,routes,services,middleware,db}/
│   └── migrations/ · seeders/
├── engine/     # Node service — queue-consumer, pipeline, lifecycle, telemetry
│   └── src/{consumer,resolver,matcher,pipeline/stages,assigner,lifecycle,scheduler,telemetry,cache}/
├── interface/  # Next.js — dashboard, telemetry, editors, settings
│   └── app/ · components/ · lib/
├── shared/     # Shared Sequelize models + SettingsService (used by api + engine)
└── planning/   # Agent coordination docs (this file)
```

`api` and `engine` share models and the settings-resolution logic via `shared/` to guarantee one source of truth.

---

## Build Roadmap

**Phase 0 — Foundations** ✅ Done
- Monorepo scaffolding; `shared/` Sequelize setup for PostgreSQL; enable the PostGIS extension (migration); migrations + seeders; `queue.claim()` using `SKIP LOCKED` + `LISTEN/NOTIFY`.
- Core models: groups (clients), jurisdictions, zones, workers, schedules, orders — with PostGIS `GEOGRAPHY` columns and GiST indexes.

**Implementation notes (for later phases building on `shared/`):**
- **Migrations run via `umzug`, not `sequelize-cli`.** The CLI's `.sequelizerc`/config loading is CommonJS-only and conflicts with `shared/`'s native-ESM (`"type": "module"`) package. Migrations are TS files in `shared/migrations/*.ts`; run with `npm run migrate` / `npm run migrate:undo` (workspace `shared`). New migrations should follow the existing `up`/`down` export shape.
- **`tsx` is a runtime dependency, not dev-only** — the `migrate` and `seed` scripts execute TS directly via `tsx` in any environment (dev, CI, or a future production migration job), not only in local dev.
- **Enum-style `STRING` columns are validated at the model layer** per this doc's "app-level enums" decision (Data Model intro) — every status/type/state column carries a Sequelize `validate: { isIn: [...] }`, built with the `isInValidator` helper in `shared/src/models/base.ts` (which also holds the shared `id`/`createdAt`/`updatedAt` column trio).
- **Test suite:** Vitest + `@testcontainers/postgresql` (`postgis/postgis:16-3.4`), one container per run (`shared/vitest.global-setup.ts`), tables truncated between tests (real commits, not transaction rollback — matches TESTING.md's exception for concurrency tests). The seed-world loader is `shared/src/seed/loadSeedWorld.ts`; reusable factory functions (`makeGroup`, `makeWorker`, `makeOrder`, `makeSchedule`, `makeZoneWorker`, …) live in `shared/src/test/factories.ts` and are re-exported at the `@voyager/shared/test` subpath for `api`/`engine` to reuse.
- **Known flake:** the `queue.claim()` concurrency test has under-claimed (returned fewer rows than pending) in roughly 2 of ~25 runs, both times correlated with heavy host load (a first-ever cold container start; immediately after a large rebuild). Clock skew between Node and the container was measured and ruled out (~3ms, and in the wrong direction to explain it). The claim SQL matches the `SKIP LOCKED` pattern documented above exactly, and rerunning always passes. Root cause unconfirmed — if this recurs, investigate rather than dismiss it as environmental.
- Deferred to later phases per TESTING.md's own phase alignment (not a Phase 0 gap): a crash-recovery/stale-claim reclaim test (needs the `scheduler`/expiry mechanism, which doesn't exist yet) and transaction-rollback test isolation (only matters once non-concurrency integration tests exist in volume).

**Phase 1 — Ingestion & CRUD API** ✅ Done
- Express app; CRUD for all core entities; order ingestion (`POST /orders`) writing order + `dispatch_queue`.
- `SettingsService` with global→group→jurisdiction resolution; settings + audit endpoints.
- Inbound webhooks: `webhook_sources` + `webhook_events`, `POST /webhooks/:slug` with HMAC verification + idempotency, mapping to the shared ingestion path.
- `GET /health` (API + DB probe).
- **Pulled forward from Phase 3** (product owner call): the `assignments` table plus manual assignment — `POST /orders/:id/reassign`, `POST /orders/:id/unassign`, `GET /assignments`, `GET /orders/:id/assignments`, `GET /orders/:id/audit`. Dispatchers can manually assign/reassign/unassign orders to workers before the auto-engine exists; every action is transactional and audited. The capacity check is real (via `SettingsService`); off-duty/zone soft-constraint warnings are deferred to Phase 2 since they need the matcher's geospatial/schedule logic.

**Implementation notes (for later phases):**
- New `shared/` tables (migrations 0011-0015): `assignments`, `settings` (3 partial unique indexes, one per scope — avoids the classic gotcha where a plain multi-column unique index lets NULLs coexist), `audit_log` (FKs to `groups`/`jurisdictions` use `SET NULL` — an audit trail must outlive the thing it audited, unlike every other FK in this schema which cascades), `webhook_sources`, `webhook_events`.
- **`api/` has no `models/`/`migrations/` of its own**, despite the Repository Layout diagram showing them — Key Design Decision #3 (shared owns models) is the authoritative call and is what Phase 0 already built. `api/` imports everything from `@voyager/shared`.
- **Build ordering matters:** `shared/` must be built (`npm run build`) before `api/` can import it — `dist/` is git-ignored and there are no TS project references. Both the root and `api/`'s own `package.json` now have a `pretest` script that builds `shared` first, so `npm test` works from a clean checkout whether run at the root or from inside `api/`.
- **Express 5 breaking change:** `req.query` is getter-only (`req.query = x` throws `TypeError`); the validation middleware (`api/src/middleware/validate.ts`) works around this with `Object.defineProperty` for the query case only (`body`/`params` stay directly assignable). Also confirmed empirically: Express 5 auto-forwards a rejected promise from an async route handler to the error middleware, so no `asyncHandler` wrapper is needed anywhere.
- **Route params typing:** Express's types make `req.params.xyz` come out as `string | string[]` even after Zod validation narrows it at runtime. The fix used throughout is an explicit generic on the router call — `router.get<{ id: string }>("/:id", validateParams(idParamsSchema), ...)` — not a cast. Apply this to any new `:param` route.
- Idempotency (orders' `(jurisdictionId, externalId)`, webhooks' `(sourceId, dedupeKey)`) is enforced by a DB unique index but the check-then-act code path isn't atomic; both `createOrder` and the webhook receiver catch `SequelizeUniqueConstraintError` on the losing insert and return the winner's row instead of a 500. Follow this pattern for any new idempotent-write endpoint.
- Zod v4 idioms used throughout: top-level `z.uuid()`/`z.iso.datetime()` (not `z.string().uuid()`), `z.record(keyType, valueType)` (two args, not one).

**Phase 2 — Engine MVP**
- `queue-consumer` with row-claiming; `matcher`; single-stage pipeline (Scoring); `assigner` with transactional claim; lifecycle basics.
- `heartbeat` writer + `GET /health/engine`.
- Emit first telemetry metrics.
- Order lifecycle transitions (`accept`/`reject`/`progress`/`complete`) — deliberately deferred from Phase 1 since they represent a worker responding to an auto-dispatch, which doesn't exist until this phase.
- Off-duty/zone soft-constraint warnings for manual reassignment (Phase 1 only checks capacity) once the matcher's geospatial/schedule logic exists.

**Phase 3 — Composable pipeline & manual override**
- TierFilter + Tiebreak stages; `pipeline_configs`; presets; reorder/toggle; `pipelineTrace`.
- ~~Manual reassign/unassign endpoints~~ — built in Phase 1 (see above). Remaining here: wiring `manual` assignments to be excluded from auto-re-dispatch once the Phase 2 engine/rebalancer exists.
- Settings hot-reload via `settingsVersion` — the write side (bumping `settingsVersion` on jurisdiction/group/global changes) is done in Phase 1's `SettingsService`; what's left is the engine actually watching it and reloading its cache, which needs the engine to exist first.

**Phase 4 — Telemetry & metric dictionary**
- Full built-in metric seed; `metric_points` emission everywhere; `metrics/query` aggregation; custom metric definitions.
- `metric_points` range partitioning by `ts`; scheduler creates future partitions ahead of time and drops partitions past the retention window.
- SLA sweep + rebalancing scheduler.

**Phase 5 — Interface**
- Design system + palette; Command Dashboard; Dispatch Telemetry; Orders/Workers; Groups (Clients) & Jurisdictions; Pipeline Editor; Settings with audit/rollback; Metrics Dictionary.

**Phase 6 — Hardening**
- Multi-instance engine tests (no double-dispatch); retry/dead-letter; geospatial query performance (GiST index tuning); load testing.

**Later (post-MVP)**
@SUGGESTIONS

---

## Technical Standards

- **Stack:** Next.js (interface), Node.js + Express (api), Node.js (engine), Sequelize ORM, PostgreSQL with the PostGIS extension.
- **TypeScript everywhere** (`shared`/`api`/`engine`/`interface`), native ESM (`"type": "module"`, `NodeNext` module resolution) — no CommonJS, no decorator-based ORM libraries (plain Sequelize `InferAttributes`/`InferCreationAttributes` style, not `sequelize-typescript`).
- **npm workspaces** for the monorepo (no Turborepo/Nx at this scale); each service is added as a workspace when its phase starts rather than scaffolded empty ahead of time.
- **Vitest + `@testcontainers/postgresql`** for the test suite across all packages, per `planning/TESTING.md`.
- Use **latest stable** versions of all libraries and idiomatic APIs.
- Data fed in from outside sources via the API.
- **Postgres-native:** PostGIS `GEOGRAPHY` types with GiST indexes for all geo (`ST_DWithin`/`ST_Covers`/`ST_Distance`); `JSONB` for flexible config; `SKIP LOCKED` + `LISTEN/NOTIFY` for the queue; app-level string enums.
- Clear, concise docstrings; short modules, methods, and functions; names that explain themselves.
- Identify root causes with evidence before fixing; no workarounds.
- Use readable and clean proper coding standards.

---

## Visual Design

- **Professional, data-dense layout** — every pixel earns its place.
- **Responsive but desktop-first** — optimized for wide screens, functional on tablet.

### Primary Color Scheme

Vivid; greatest contrast. Used for primary UI, key actions, and emphasis.

- Vega Blue: `#002EE5`
- Reach Blue: `#050533`
- Dust White: `#F7EDE5`
- Betel Orange: `#FF7A00`
- Aldebaran Yellow: `#FCCF0D`

### Secondary Color Scheme

Accent colors and data visualization.

- Archenary Grey: `#DEDEDB`
- Rigel Green: `#405259`
- Black: `#000000`
- White: `#FFFFFF`
- Canopus Violet: `#B379F6`
- Procyan Green: `#54F2A3`
- Antares Yellow: `#F5EAAD`
- Arcturus Red: `#E73443`
