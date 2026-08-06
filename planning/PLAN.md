# Voyager — Dispatch Engine (Simplified Plan)

## 1) Vision

Voyager is a real-time dispatch platform for utility, delivery, and cab operations. It routes orders to workers, supports manual dispatcher intervention, and provides high-visibility telemetry.

---

## 2) Core Product Requirements

- **Tenant model:** Group (client) → Jurisdiction (region) → zones/workers/schedules.
- **Availability:** Worker eligibility is based on schedules + geographic coverage.
- **Settings inheritance:** Global → Group → Jurisdiction, with override support.
- **Dispatch logic:** Composable pipeline (tier, scoring, tiebreak), per jurisdiction.
- **Manual operations:** Reassign/unassign with mandatory audit trail.
- **Telemetry:** Built-in and custom metrics.

---

## 3) Confirmed Architecture Decisions

- **Database:** PostgreSQL + PostGIS only.
- **Runtime mode:** Always-on, real-time engine.
- **Messaging:** DB-backed queue (no Redis/Kafka) using:
  - `dispatch_queue` rows
  - `SELECT ... FOR UPDATE SKIP LOCKED` claims
  - `LISTEN/NOTIFY` wake-ups
  - short poll loop as liveness safety net
- **Config shape:** Pipeline configs stored as JSONB per jurisdiction.
- **Shared logic:** `api` and `engine` share models/settings logic via `shared/`.
- **Auth:** Deferred (leave seams for future RBAC).

---

## 4) System Overview

### Services

- **api (Express):** Ingestion, CRUD, settings, manual actions, metrics query, webhooks.
- **engine (Node):** Queue consumer, matcher, pipeline runner, lifecycle/scheduler, telemetry.
- **interface (Next.js):** Dashboard + operational tooling.
- **shared DB (Postgres/PostGIS):** Source of truth for data and queue state.

### Queue pattern

1. API writes `orders` + `dispatch_queue` in one transaction.
2. Trigger emits `pg_notify('dispatch_new', jurisdictionId)`.
3. Engine listens and immediately runs claim cycle.
4. Poll loop runs every few seconds to recover missed notifications/retry windows.
5. Claim SQL (`SKIP LOCKED`) prevents duplicate row claims across instances.

---

## 5) Data Model (High-Level)

### Core entities

- `groups`, `jurisdictions`
- `zones` (PostGIS polygon), `workers` (PostGIS point), `zone_workers`
- `schedules`

### Dispatch entities

- `orders`
- `dispatch_queue`
- `assignments`
- `engine_instances` (heartbeat registry)

### Config/audit

- `settings` (scope cascade: jurisdiction → group → global)
- `pipeline_configs` (`stages` JSONB)
- `audit_log`

### Telemetry

- `metric_definitions`
- `metric_points` (monthly range partitioned by timestamp)

### Webhooks

- `webhook_sources`
- `webhook_events` (idempotent receipt log)

---

## 6) Dispatch Engine Behavior

### Dispatch flow

1. Order queued.
2. Engine claims queue rows.
3. Resolve effective settings + pipeline config.
4. Match eligible workers (jurisdiction/zone/schedule/capacity).
5. Run enabled pipeline stages in configured order.
6. In transaction: lock winner worker row, re-check capacity, create assignment, mark queue done.
7. Emit telemetry.

### Invariants

- One active assignment per order.
- Re-queue operations are atomic (assignment transition + queue insert + order state change).
- No double-claim (`SKIP LOCKED`) and no over-assignment (worker row lock + in-lock capacity check).

### Manual override rules

- Reassign/unassign is always audited with actor + reason.
- Soft constraints (off-duty/out-of-zone/at-capacity) can be overridden with explicit force + reason.
- Manual assignment is not silently replaced by auto-rebalancing.

---

## 7) API Surface (Summary)

Versioned under `/api/v1`.

- **Groups/Jurisdictions/Zones/Workers/Schedules:** CRUD
- **Orders:** create/list/get + lifecycle (`accept/reject/progress/complete/cancel`)
- **Manual dispatch:** `reassign`, `unassign`, assignment history/audit
- **Settings:** list/update/audit/rollback
- **Pipeline:** get/update + presets + audit
- **Metrics:** definitions + query
- **Webhooks:** source management + `POST /webhooks/:slug` receive endpoint
- **Health:** `/health`, `/health/engine`

### Webhook processing

- HMAC signature validation per source
- Source-scoped authorization by group
- Idempotency via unique (`sourceId`, `dedupeKey`)
- Same internal ingestion/lifecycle path as REST endpoints
- Full receipt logging for replay and troubleshooting

---

## 8) Interface Scope (Summary)

Primary screens:

1. Command Dashboard
2. Dispatch Telemetry
3. Orders
4. Workers
5. Groups & Jurisdictions
6. Pipeline Editor
7. Settings (with audit + rollback)
8. Metrics Dictionary

Notes:

- Desktop-first, data-dense UX.
- Polling-first live updates (SWR), with future SSE/WebSocket upgrade path.
- For jurisdictions with no `pipeline_configs`, editor must show explicit initialize/restore action (not blank state).

---

## 9) Repository Layout

```text
Voyager/
├── api/
├── engine/
├── interface/
├── shared/
├── scripts/
└── planning/
```

`shared/` is the single source of truth for shared models and cross-service dispatch/settings logic.

---

## 10) Roadmap Status

- **Phase 0 — Foundations:** ✅
- **Phase 1 — Ingestion & CRUD API:** ✅
- **Phase 2 — Engine MVP:** ✅
- **Phase 3 — Composable pipeline:** ✅
- **Phase 4 — Telemetry & metric dictionary:** ✅
- **Phase 5 — Interface:** ✅
- **Phase 6 — Hardening:** ⏳ in progress (multi-instance stress, retry/dead-letter hardening, geo perf/load testing)

Post-MVP enhancements remain in `@SUGGESTIONS`.

---

## 11) Technical Standards

- TypeScript everywhere (`api`, `engine`, `shared`, `interface`), native ESM.
- Sequelize ORM with Postgres-native capabilities (PostGIS, JSONB, SKIP LOCKED, LISTEN/NOTIFY).
- Vitest + `@testcontainers/postgresql` for integration testing.
- Use latest stable libraries and idiomatic APIs.
- Keep modules/functions short and clearly named.
- Root-cause first: gather evidence before fixing.

---

## 12) Visual Design Tokens

### Primary

- Vega Blue `#002EE5`
- Reach Blue `#050533`
- Dust White `#F7EDE5`
- Betel Orange `#FF7A00`
- Aldebaran Yellow `#FCCF0D`

### Secondary

- Archenary Grey `#DEDEDB`
- Rigel Green `#405259`
- Black `#000000`
- White `#FFFFFF`
- Canopus Violet `#B379F6`
- Procyan Green `#54F2A3`
- Antares Yellow `#F5EAAD`
- Arcturus Red `#E73443`
