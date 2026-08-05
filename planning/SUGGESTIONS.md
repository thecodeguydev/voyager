# Voyager — Suggestions

Ideas considered but not yet adopted into `PLAN.md`. Each records the trade-offs so a decision can be made deliberately later.

---

## 1. Weighted load units for worker capacity

**Status:** Proposed (not in plan). The plan currently uses **count-based** capacity — `workers.maxConcurrent` caps the number of simultaneous assignments, and every order counts as 1.

**The idea:** Measure capacity in **load units** instead of a job count. Each order carries a `loadCost` reflecting its size/effort, and a worker is "full" when the sum of active `loadCost` reaches their capacity.

- Count-based: `maxConcurrent = 3` → any 3 jobs fill the worker, whether a 10-minute meter read or an all-day repair.
- Weighted: `capacity = 10` units, big repair = 6, inspection = 3, meter read = 1 → the worker fills based on real workload, not job count.

**Suggested shape:** opt-in per jurisdiction — a setting like `capacity.mode` (`count` | `weighted`). Add an optional `orders.loadCost` (INT, default 1) and treat `maxConcurrent` / the resolved capacity default as units when weighted. The capacity check stays where it is today (matcher filter + `assigner` re-check); it just sums `loadCost` instead of counting rows.

### Pros
- **Accurate for mixed workloads** — prevents a worker being swamped by three huge jobs or starved by three tiny ones.
- **Non-breaking to adopt** — count-based is just the special case where every `loadCost = 1`; existing data and logic keep working.
- **Fits the existing model** — reuses the settings cascade (`capacity.mode`, capacity default resolve global → group → jurisdiction → worker) and the current capacity-check seam; no schema upheaval.
- **Better utilization telemetry** — utilization becomes `used units / capacity`, a truer load signal than job count.

### Cons
- **More configuration** — someone must assign a sensible `loadCost` to each order type, and pick per-worker/group capacities in units. Bad costs give worse results than a simple count.
- **Added engine math and edge cases** — partial capacity, an order whose `loadCost` exceeds any worker's capacity (must be handled, not silently unassignable), rebalancing on unit boundaries.
- **Harder to reason about at a glance** — "3 of 3 jobs" is obvious to a dispatcher; "9 of 10 units" needs the cost model in their head.
- **Cross-jurisdiction comparison** — if some jurisdictions run `count` and others `weighted`, utilization metrics aren't directly comparable without normalization.

### Recommendation
Keep **count-based** as the default. Add weighted load as an **opt-in per jurisdiction** only if/when real mixed-effort workloads (e.g. utility work ranging from minutes to a full day) show that job-count capacity is mis-loading workers. The migration path is clean, so deferring costs nothing.

---

## 2. WebSocket / SSE live telemetry

**Status:** Deferred to post-MVP in `PLAN.md`. The MVP interface refreshes telemetry via **SWR polling** (the dashboard re-fetches on an interval); this suggestion is the push-based upgrade.

**The idea:** Stream telemetry and dispatch-status changes to the interface in real time instead of polling. The Command Dashboard, Dispatch Telemetry timeline, and Orders/Workers tables update the instant something changes, rather than on the next poll tick.

**Two transport options:**
- **SSE (Server-Sent Events)** — one-way server→browser stream over plain HTTP. Simple, auto-reconnecting, proxy-friendly. Sufficient because telemetry is read-only for the browser (commands still go through the REST API).
- **WebSocket** — full duplex. More capable, but the extra upstream channel isn't needed for a dashboard that only *consumes* telemetry.

**Suggested shape:** a `GET /api/v1/stream` SSE endpoint on the API, scoped by jurisdiction/metric. The engine already writes `metric_points` and advances assignment state; the API tails those changes (via Postgres `LISTEN/NOTIFY` on a `telemetry` channel, reusing the notify pattern already in the plan) and fans them out to subscribed SSE clients. The interface swaps SWR polling for an `EventSource` subscription, keeping the same data shapes.

### Pros
- **True real-time** — dispatch decisions, SLA breaches, and status flips appear instantly; matches the "telemetry is a first-class concern" vision better than polling.
- **Less redundant load** — replaces N clients polling every few seconds with one push per actual change; scales better as dashboards multiply.
- **Reuses existing plumbing** — the `LISTEN/NOTIFY` mechanism and `metric_points` emission are already in the plan; this adds a fan-out layer, not a new data path.
- **SSE is low-cost** — no new protocol infra, works through standard HTTP/proxies, auto-reconnects natively.

### Cons
- **Stateful connections** — long-lived streams complicate horizontal scaling of the API (sticky sessions or a shared pub/sub fan-out across API instances); polling is stateless and trivially load-balanced.
- **More moving parts** — backpressure, slow-consumer handling, reconnect/replay-gap semantics, and per-jurisdiction authorization on the stream (matters once auth lands).
- **Marginal benefit at low change rates** — if telemetry changes slowly, a short poll interval already feels live for far less complexity.
- **Proxy/timeout tuning** — idle-connection timeouts and buffering on some proxies/load balancers need configuration for streams to stay open.

### Recommendation
Ship **SWR polling** for the MVP (already the plan). Adopt **SSE** — not WebSocket — as the first upgrade once dashboards are in real use and polling latency or load becomes noticeable. Keep REST as the command path; SSE is read-only telemetry. Revisit WebSocket only if a genuine client→server real-time need appears (e.g. collaborative dispatching), which isn't in scope today.

---

## 3. Auth / RBAC (admin / dispatcher / viewer)

**Status:** Deferred in `PLAN.md`. Auth is intentionally **out of the MVP** — the API and data model are built to layer it in later. The plan leaves a **middleware seam** (a no-op auth middleware slot in the Express chain) and placeholder `actor` fields on `audit_log` and manual-override records specifically so RBAC can drop in without reshaping the schema.

**The idea:** Add authentication plus **role-based access control** at the existing middleware seam, with three roles matched to how the system is used:
- **admin** — full control: manage groups/jurisdictions, edit settings and pipeline configs, manage workers, everything below.
- **dispatcher** — operate dispatch: view telemetry, manually reassign/unassign orders, but **not** change global/group settings or pipeline structure.
- **viewer** — read-only: dashboards, telemetry, orders/workers, audit trails; no mutations.

**Suggested shape:** an auth middleware that authenticates the request (session/JWT/OIDC — provider TBD), resolves the caller's role(s), and attaches an `actor` + role to the request. Route-level guards enforce role per endpoint (e.g. `PUT /settings/:key` → admin; `POST /orders/:id/reassign` → dispatcher+; all `GET` → viewer+). The **placeholder `actor` strings already threaded through `audit_log` and override records** get populated with the real authenticated identity — no audit-schema change needed. Scope roles by **group and/or jurisdiction** so a dispatcher for one client can't act on another (the hierarchy already supports this partitioning).

### Pros
- **Seam already exists** — the middleware slot, `actor` fields, and audit trail were designed for this; adoption is additive, not a refactor.
- **Matches real operational roles** — admin/dispatcher/viewer mirror who touches the system (operators configure, dispatchers intervene, stakeholders watch).
- **Turns the audit trail real** — every settings/override action already records an `actor`; auth makes that identity trustworthy and non-repudiable.
- **Enables multi-tenant safety** — group/jurisdiction-scoped roles keep clients isolated, important as more groups onboard.

### Cons
- **Non-trivial surface** — auth provider choice, session/token lifecycle, credential storage, per-route guard coverage, and tests for every endpoint's role matrix.
- **Scoping complexity** — group/jurisdiction-scoped RBAC (not just flat global roles) needs a role-assignment model and resolution logic against the hierarchy.
- **External-caller impact** — worker systems and order sources hit the API too; they need service credentials/keys, a distinct concern from human roles.
- **Cross-cuts the whole API** — once on, every new endpoint must declare its required role, an ongoing discipline rather than a one-time add.

### Recommendation
Keep auth **deferred** for the MVP as planned, but **do not let the seam rot** — keep the no-op middleware and `actor` placeholders honest so the later drop-in stays clean. When adopting, start with **flat global roles** (admin/dispatcher/viewer) for the human UI, add **group/jurisdiction scoping** second, and treat **external API callers** (worker/order systems) as a separate service-credential track rather than bending human RBAC to fit them.

---

## 4. Routing metrics as a dispatch rule (traffic, construction, accidents)

**Status:** Proposed (not in plan). The plan's Scoring stage ranks candidates by `ST_Distance` (great-circle) and Tiebreak's `nearest` does the same — both are **as-the-crow-flies** and know nothing about roads, traffic, construction, or accidents.

**The core reframe:** distance is already a *proxy* for the real quantity — how expensive it is to get a worker to an order. Traffic/construction/accidents aren't a brand-new rule so much as a **correction to that cost function**. The quantity you actually want is **estimated time-to-arrival (ETA)**; road conditions are inputs that inflate it. So the design replaces/augments the `distance` scoring input with a **travel-cost (ETA)** input and lets road conditions raise that cost.

**Suggested shape:**

- **A `RouteCost` annotator stage** in the composable pipeline, run *before* Scoring. It enriches (does not filter) each candidate with `{ etaSeconds, distanceMeters, incidentPenalty }` into `ctx`. **Scoring** then weights `travelTime` in place of raw `distance`; **Tiebreak** `nearest` becomes nearest-*by-ETA* for free. Optionally a **hard SLA gate** in TierFilter drops candidates whose ETA exceeds the order's remaining SLA time. Keeping "compute the cost" separate from "weight the cost" is the key seam — the cost computation can be async/batched/cached without Scoring caring how the number was produced.

- **A `RoutingProvider` adapter interface** (same strategy discipline as the stages): `matrix(origins, destinations, at) -> [{ etaSeconds, distanceMeters }]`. Three implementations, built in order of increasing accuracy/cost, provider chosen per jurisdiction via the settings cascade:
  1. **`StraightLine`** (PostGIS `ST_Distance`) — the default and always-available fallback; what the plan does today.
  2. **`IncidentOverlay`** — PostGIS-native, no routing engine. Test whether the straight path (or a buffered corridor) intersects active incidents via `ST_DWithin`/`ST_Intersects` and add a penalty scaled by severity. Cheap; captures most of the value with zero new infrastructure.
  3. **`ExternalRouting`** — a traffic-aware provider (Mapbox / HERE / Google, or self-hosted **Valhalla / OSRM**). Real road ETAs with live traffic; feed owned closures in where supported.

- **An `incidents` (road_conditions) table** — traffic/construction/accidents are time-and-space-bounded events, modeled as first-class ingested data: `jurisdictionId`, `type` (`traffic`/`construction`/`accident`/`closure`), `geometry` (`GEOGRAPHY` — point/linestring/polygon), `severity`, `speedFactor`, `validFrom`/`validUntil`, `source`, `payload` (`JSONB`). GiST index on `geometry` plus a validity-window index, so "active incidents near this route" is one indexed PostGIS query. Natural fit for the **inbound-webhook** path — a city traffic feed or maps provider pushes incidents in, exactly like orders.

### Pros
- **Fixes a real accuracy gap** — a nearer worker stuck behind a closure is genuinely farther; ETA-based ranking dispatches the worker who actually arrives first.
- **Fits the composable pipeline** — a new annotator stage + a heavier Scoring input; no new architectural concepts, and it's toggleable/reorderable per jurisdiction like every other stage.
- **Tiered, infra-light adoption** — the adapter seam lets `StraightLine` ship now and `IncidentOverlay` follow with **zero external dependencies**, honoring the plan's "no extra infrastructure" bias; external routing is a later drop-in behind the same interface.
- **Reuses existing plumbing** — settings cascade for provider/weights/timeouts, inbound webhooks for incident ingestion, `pipelineTrace` for explainability, the metric dictionary for new telemetry.

### Cons
- **Hot-path latency** — routing/ETA calls are slow and dispatch is real-time. Needs **matrix requests** (one call for N candidates → 1 order), a **cache** keyed by `(origin-cell, dest-cell, time-bucket)` (snap to H3/geohash + ~5-min buckets), and a **per-dispatch timeout with fallback to `StraightLine`** so a slow provider degrades instead of stalling the queue.
- **Data freshness & sourcing** — incident/traffic data is only as good as its feed; stale `validUntil` windows or a dead feed silently revert quality toward straight-line (acceptable, but must be observable).
- **External-provider cost & coupling** — `ExternalRouting` adds a paid dependency, rate limits, and an availability risk on the dispatch path; the fallback matters.
- **Explainability burden** — "farther worker won" needs the provider, ETA, and incident penalties recorded in `pipelineTrace` or dispatchers won't trust it.

### Recommendation
Adopt in tiers behind the adapter seam. Ship the **`RoutingProvider` interface + `StraightLine` default** first (near-zero cost, unblocks the stage). Add **`IncidentOverlay`** as the first real routing rule since it's fully PostGIS-native and needs no new infrastructure, with incidents ingested via the existing webhook path. Defer **`ExternalRouting`** until a jurisdiction's density justifies the cost and coupling — and only with matrix batching, cell/time-bucket caching, and straight-line fallback in place. Emit routing telemetry (provider latency, cache hit-rate, ETA-vs-straight-line delta, fallback count, incident-penalty applications) from day one so the accuracy gains are measurable.
