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
