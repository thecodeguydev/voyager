# Voyager — Dispatch Engine

## Vision

Voyager is a powerful, flexible, smart and universal dispatch engine that dispatches orders to utility workers, delivery drivers, and cab drivers. Voyager has a visually stunning interface that provides telemetry for each case dispatch, case statuses, and an interface to adjust global and jurisdictional settings. Telemetry is a first-class concern.

Agents interact through files in `planning/`.

---

## Product Requirements

- **Groups & jurisdictions** — a **group** is the client/tenant; it houses one or more **jurisdictions** (geographic regions), which in turn hold zones, workers, and schedules.
- **Availability** — via schedules (on-duty windows) and zoning (geographic coverage).
- **Universal/flexible settings** — a settings system that manages settings globally and per jurisdiction, with inheritance and overrides.
- **Order priorities** — a **composable dispatch pipeline** (see below) handling universal and per-jurisdiction priority logic.
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
- `jurisdictionId` (→ jurisdiction → group, so the client is derived, not stored twice), `externalId` (unique per source), `name`, `type` (`utility`/`delivery`/`cab`), `skills` (`JSONB` array), `maxConcurrent` (INT, nullable — null inherits the resolved capacity default), `location` (`GEOGRAPHY(POINT, 4326)`, GiST-indexed), `status` (`available`/`busy`/`offline`).

**`zone_workers`** — many-to-many worker ↔ zone coverage. (`workerId`, `zoneId`).

**`schedules`** — worker availability windows.
- `workerId`, `dayOfWeek` (0–6) or `date` (for one-offs), `startTime`, `endTime`, `type` (`shift`/`timeoff`), `recurring` (BOOL).

### Orders & dispatch

**`orders`** — incoming work items.
- `jurisdictionId`, `externalId` (unique per source), `type`, `priorityTier` (`critical`/`high`/`normal`/`low`, nullable — pipeline may compute), `payload` (`JSONB`: address, skills required, time window), `pickup` (`GEOGRAPHY(POINT, 4326)`, GiST-indexed), `state` (`created`/`queued`/`dispatched`/`accepted`/`in_progress`/`completed`/`cancelled`/`failed`), `slaDueAt` (DATE), `createdAt`.
- Index: (`jurisdictionId`, `state`), (`slaDueAt`).

**`dispatch_queue`** — the work queue / outbox the engine claims from.
- `orderId`, `jurisdictionId`, `status` (`pending`/`claimed`/`done`/`error`), `claimedBy` (engine instance id), `claimedAt`, `attempts` (INT), `nextAttemptAt`, `lastError`.
- Index: (`status`, `nextAttemptAt`) — the claim query.

**`assignments`** — order ↔ worker dispatch records (lifecycle).
- `orderId`, `workerId`, `jurisdictionId`, `state` (`dispatched`/`accepted`/`rejected`/`in_progress`/`completed`/`cancelled`/`expired`/`overridden`), `source` (`auto`/`manual`), `score` (DECIMAL, from pipeline; null for manual), `pipelineTrace` (`JSONB` — which stages ran, why this worker won), `overriddenBy` (actor, nullable), `overrideReason` (text, nullable), `dispatchedAt`, `respondedAt`, `completedAt`, `expiresAt`.
- Index: (`workerId`, `state`) for capacity checks; (`orderId`).

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

**`metric_points`** — emitted time-series data.
- `metricKey`, `jurisdictionId`, `workerId` (nullable), `orderId` (nullable), `value` (DECIMAL), `dimensions` (`JSONB` — flexible tags), `ts` (DATE).
- Index: (`metricKey`, `jurisdictionId`, `ts`) for dashboard queries.

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
| `assigner` | Transactionally writes the winning `assignment`, prevents double-dispatch. |
| `lifecycle` | Assignment state machine; handles accept/reject/complete/expire and manual override/reassign transitions. |
| `scheduler` | Periodic sweep: expired assignments, SLA-breach warnings, workload rebalance. |
| `telemetry` | Emits `metric_points` for every decision. |
| `settings-cache` | In-memory effective settings + pipeline config per jurisdiction; hot-reload. |

### Dispatch flow

1. API ingests an order → writes `orders` row (`state=queued`) + `dispatch_queue` row (`status=pending`) in one transaction.
2. `queue-consumer` (woken by `NOTIFY` or a short poll) claims a batch: `SELECT ... FOR UPDATE SKIP LOCKED`, marks `claimed` + `claimedBy`.
3. `resolver` loads the jurisdiction's pipeline config and effective settings from `settings-cache`.
4. `matcher` builds the candidate worker set via the filter chain.
5. `pipeline` runs candidates through enabled stages in order (see below).
6. `assigner` opens a transaction, re-checks the top worker's capacity, writes the `assignment` (`state=dispatched`), sets `order.state=dispatched`, marks the queue row `done`.
7. `telemetry` emits response-time, queue-depth, and decision metrics.
8. External system reports back (accept/reject/progress/complete) via API → `lifecycle` advances the assignment; rejects/expiries re-queue the order.

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

- **No double-dispatch** — row-claiming + transactional capacity re-check in `assigner`.
- **No-response** — assignments have `expiresAt`; the scheduler expires them and re-queues the order with incremented `attempts`.
- **Retries** — `dispatch_queue.attempts` + `nextAttemptAt` exponential backoff; dead-letter (`status=error`) after N attempts, surfaced in the UI.
- **Horizontal scale** — run N engine instances; `SKIP LOCKED` guarantees disjoint claims.

---

## Backend API (Express)

REST, JSON. Versioned under `/api/v1`. No auth yet (middleware seam left in place).

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
| Health | `GET /health`, `GET /health/engine` |

Order ingestion writes the order + queue row transactionally, then returns `202 Accepted` — the engine dispatches asynchronously.

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

**Phase 0 — Foundations**
- Monorepo scaffolding; `shared/` Sequelize setup for PostgreSQL; enable the PostGIS extension (migration); migrations + seeders; `queue.claim()` using `SKIP LOCKED` + `LISTEN/NOTIFY`.
- Core models: groups (clients), jurisdictions, zones, workers, schedules, orders — with PostGIS `GEOGRAPHY` columns and GiST indexes.

**Phase 1 — Ingestion & CRUD API**
- Express app; CRUD for all core entities; order ingestion (`POST /orders`) writing order + `dispatch_queue`.
- `SettingsService` with global→group→jurisdiction resolution; settings + audit endpoints.

**Phase 2 — Engine MVP**
- `queue-consumer` with row-claiming; `matcher`; single-stage pipeline (Scoring); `assigner` with transactional claim; lifecycle basics.
- Emit first telemetry metrics.

**Phase 3 — Composable pipeline & manual override**
- TierFilter + Tiebreak stages; `pipeline_configs`; presets; reorder/toggle; `pipelineTrace`.
- Manual reassign/unassign endpoints + lifecycle transitions; dispatch audit trail; `manual` assignments excluded from auto-re-dispatch.
- Settings hot-reload via `settingsVersion`.

**Phase 4 — Telemetry & metric dictionary**
- Full built-in metric seed; `metric_points` emission everywhere; `metrics/query` aggregation; custom metric definitions.
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
- Use **latest stable** versions of all libraries and idiomatic APIs.
- Data fed in from outside sources via the API.
- **Postgres-native:** PostGIS `GEOGRAPHY` types with GiST indexes for all geo (`ST_DWithin`/`ST_Covers`/`ST_Distance`); `JSONB` for flexible config; `SKIP LOCKED` + `LISTEN/NOTIFY` for the queue; app-level string enums.
- Clear, concise docstrings; short modules, methods, and functions; names that explain themselves.
- Identify root causes with evidence before fixing; no workarounds.

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
