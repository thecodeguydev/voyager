# Voyager — Testing Strategy

How Voyager is tested. Unlike `SUGGESTIONS.md` (ideas considered but not adopted), this is a **standing plan**: the approach the codebase should follow as it is built out phase by phase.

The guiding principle: **test where this system can be subtly, expensively wrong.** Coverage percentage is secondary to hitting the handful of invariants the architecture rests on — no double-dispatch, correct geospatial matching, correct settings resolution, and an explainable pipeline.

---

## Test infrastructure

### A real Postgres + PostGIS is non-negotiable

The highest-risk parts of Voyager **cannot be faithfully mocked**: `ST_Covers` / `ST_Distance` / `ST_DWithin`, `SELECT ... FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY`, JSONB operators, and transaction semantics have no in-memory stand-in. Mocking them tests the mock, not the system. SQLite/in-memory is disqualified outright — no PostGIS, no `SKIP LOCKED`.

Every integration and concurrency test runs against a **real containerized Postgres with the PostGIS extension**, matching the production engine and extension versions.

### Two container patterns, two jobs

**1. Testcontainers — ephemeral, per-run, isolated → the automated suite.**
The test process starts the `postgis/postgis` image itself, gets a random port, runs migrations, executes tests, and tears the container down.

```js
// Start once per suite; migrate once; isolate tests via transaction rollback.
const pg = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
```

- **Ephemeral & isolated** — each CI run and each local `npm test` gets a pristine DB; no state leaks between runs.
- **Parallel-safe** — random ports let multiple suites/branches run concurrently without collision.
- **CI-native** — no "provision a database" step; the suite bootstraps its own. This is what makes the concurrency tests trustworthy: real locking against a real, uncontended primary.

**2. docker-compose — persistent, shared, seeded → local dev & manual QA.**
A `docker-compose.yml` brings up Postgres+PostGIS (plus `api`, `engine`, `interface`) once, seeded with the **canonical seed world** (below), so a developer can click through the dashboard, hit the API by hand, and watch real dispatches flow. A named volume persists the seed world across restarts. This doubles as the local dev environment, so "works locally" and "works in CI" converge on the **same image and version**.

| Pattern | Lifetime | Isolation | Purpose |
|---|---|---|---|
| **Testcontainers** | per test run | fully isolated | automated suite (correctness) |
| **docker-compose** | long-lived | shared, seeded | dev, manual QA, demos (convenience) |

**Rule:** both point at the same PostGIS image/version so tested behavior and observed behavior match.

### Startup-cost caveat

Spinning a fresh container **per test** is too slow. Start it **once per suite**, then isolate individual tests with **transaction rollback** at teardown — with one exception: **concurrency and `NOTIFY` tests need real commits** to exercise locking and triggers, so they run against a dedicated, serially-scheduled DB (or their own container) and clean up explicitly. Testcontainers' **reuse** flag keeps a warm container across local runs to cut the cold-start hit during tight dev loops.

---

## Test data strategy

- **Factory functions over static fixtures.** `makeWorker({ skills, location, maxConcurrent })`, `makeOrder({ pickup, tier })`, `makeZone({ boundary })` — each test declares only the fields it cares about, and geometry stays explicit rather than hidden in a fixture file.
- **A canonical seed world.** One group (client), two jurisdictions, a handful of zones with **real, hand-drawn polygons** (a "downtown" square, an adjacent zone, a detached zone), workers on varied schedules/skills, and a spread of orders inside/outside zones. Big enough to drive the dashboard and integration tests; small enough to reason about by eye.
- **Deterministic geometry.** Build geospatial fixtures from a known coordinate grid with WKT you can reason about — e.g. "worker A is 400 m, worker B is 900 m → A wins."
- **Deterministic time.** Use `@sinonjs/fake-timers` for everything touching SLA, expiry, backoff, and schedules. Real clocks make these flaky.
- **Deterministic "randomness".** Round-robin and tiebreak logic must not depend on wall clock or RNG — seed or inject them so tests reproduce exactly.

---

## Risk-area coverage

Ordered by how expensive a silent failure would be.

### 1. No double-dispatch under concurrency (the crown jewel)

The invariant the entire DB-as-message-bus design rests on, and the one thing unit tests structurally **cannot** catch — it requires genuine parallelism.

- Spin **N concurrent `queue.claim()` callers** (worker threads / parallel connections) against a queue of M rows. Assert every row is claimed **exactly once**: union of claims == M, intersection == ∅.
- Test the **`assigner` transactional re-check**: two instances race for the *same* worker at capacity → exactly one assignment wins, the other re-queues. Assert no worker ever exceeds effective `maxConcurrent`.
- **Crash recovery**: leave a row `claimed` with a stale `claimedAt` (owner died mid-flight) → assert the reclaim/expiry path recovers it.

### 2. Geospatial correctness

- Fixtures from a **known coordinate grid** with reason-by-eye WKT.
- Boundary cases: pickup **exactly on** a zone edge, inside an **overlap** of two zones, **just outside** an `ST_DWithin` radius.
- Assert `ST_Distance` ordering drives Scoring and the `nearest` Tiebreak as expected (golden distance sets).

### 3. Composable pipeline

The pipeline is a reduce over strategy objects — ideal for **table-driven** tests.

- Each stage **in isolation**: TierFilter gates eligibility + applies SLA; Scoring produces the expected weighted order; Tiebreak resolves ties deterministically (`fifo` / `round_robin` / `nearest`).
- **Composition**: the same candidate set through `Scoring only` vs `Tier→Scoring→Tiebreak` → assert both the winner **and the `pipelineTrace`** (which stages ran, why the winner won). The trace is a first-class output — test it, not just the winner.
- **Reorder / toggle**: disabling a stage or swapping order changes the outcome exactly as configured.

### 4. Settings cascade & hot-reload

`global → group → jurisdiction → worker` is pure logic and a classic "most-specific-wins" bug source.

- **Table-driven resolution matrix**: for each combination of which levels define a key, assert the resolved value. Include the capacity example directly: `worker.maxConcurrent ?? jurisdiction ?? group ?? global`.
- **Hot-reload**: bump `settingsVersion` → assert `settings-cache` reloads that jurisdiction; a **group-scope** change propagates to **all** jurisdictions under that group.

### 5. Lifecycle & manual override

- **State machine**: enumerate valid vs invalid transitions; assert illegal jumps (e.g. `completed → accepted`) are rejected.
- **Expiry**: an assignment past `expiresAt` is expired by the scheduler and its order re-queued with incremented `attempts`.
- **Retry / backoff / dead-letter**: `nextAttemptAt` follows the backoff curve; a row flips to `status=error` after N attempts.
- **Manual override**: the `force` flag **surfaces** (does not block) soft-constraint warnings; the `audit_log` row captures `before`/`after` + `reason`; and the key invariant — a `source=manual` assignment is **never** auto-re-dispatched by the pipeline or rebalancer.

### 6. Queue mechanics & NOTIFY

- **Claim query**: respects `status='pending'` + `nextAttemptAt <= now()`, `LIMIT batchSize`, ordering.
- **Trigger → NOTIFY**: inserting a `dispatch_queue` row fires `pg_notify('dispatch_new', …)`; a listening engine wakes and claims. Assert the enqueue-can't-happen-without-notify guarantee holds (trigger, not app code).
- **Reconnect**: drop the LISTEN connection → assert auto-reconnect, re-`LISTEN`, and one immediate `claimCycle()`; assert the poll safety net picks up anything enqueued during the blind window.

---

## Test layers

Roughly the test pyramid, weighted for where this system's risk actually lives.

| Layer | Scope | DB? | Examples |
|---|---|---|---|
| **Unit** | pure logic | no | pipeline stages, settings resolution, lifecycle transition rules |
| **Integration** | one module vs real DB | yes (Testcontainers) | matcher geospatial queries, `queue.claim()`, assigner transactions, audit writes |
| **Concurrency / E2E** | multi-instance & full flow | yes (real commits) | no-double-dispatch, ingest→dispatch→lifecycle happy path, NOTIFY wake-up |
| **API contract** | HTTP surface | yes | status codes, `202 Accepted` ingestion, role-guard matrix (once auth lands) |

**Weighting:** most *value* sits in the Integration and Concurrency layers here — the geospatial, queue, and locking behavior that can only be verified against a real Postgres. Unit tests stay fast and numerous for the pure logic; concurrency/E2E tests are few but essential.

---

## Tooling

- **Runner:** a fast modern runner (Vitest or Jest) across `shared/`, `api/`, and `engine/`; the `interface/` uses the same runner plus React Testing Library for components.
- **Containers:** `@testcontainers/postgresql` with the `postgis/postgis` image for the suite; `docker-compose.yml` for local dev/QA.
- **Time:** `@sinonjs/fake-timers` for SLA/expiry/backoff/schedule tests.
- **API:** `supertest` against the Express app for contract tests.
- **CI:** run the full suite on every PR against a Testcontainers Postgres; migrations run first so the schema under test is the production schema. Concurrency tests run in their own serially-scheduled job to avoid resource contention skewing timing.

---

## Alignment with the build roadmap

Testing is written **alongside** each phase, not deferred to the end:

| Phase | Tests introduced |
|---|---|
| **0 — Foundations** | Testcontainers harness; migration/seed smoke tests; `queue.claim()` + `SKIP LOCKED` concurrency test; factory functions. |
| **1 — Ingestion & CRUD** | API contract tests; `SettingsService` resolution matrix; `202 Accepted` ingestion path. |
| **2 — Engine MVP** | matcher geospatial integration; single-stage pipeline; assigner transactional re-check; first no-double-dispatch test. |
| **3 — Pipeline & override** | table-driven stage + composition + `pipelineTrace` tests; lifecycle state machine; manual-override audit + no-auto-re-dispatch invariant; hot-reload propagation. |
| **4 — Telemetry** | metric emission assertions; `metrics/query` aggregation; SLA/expiry sweep with fake timers. |
| **5 — Interface** | component tests; key screen data-loading; happy-path E2E through the seed world. |
| **6 — Hardening** | multi-instance concurrency at scale; retry/dead-letter; GiST index performance; load tests. |
