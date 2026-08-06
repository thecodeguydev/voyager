# Voyager — API Reference

Complete endpoint inventory for the `api` service. For running the stack, see `README.md`; for what's being built, see `PLAN.md`; for settings/pipeline/metrics deep-dives and worked examples, see `SETTINGS_GUIDE.md`, `PIPELINE_GUIDE.md`, `METRICS_GUIDE.md`, and `TESTING_GUIDE.md`.

Base URL: `http://localhost:3000/api/v1` (local dev). Every path below omits this prefix for brevity — `GET /groups` means `GET /api/v1/groups`.

---

## Conventions

**Error envelope** — every non-2xx response (except the two health checks) is shaped:
```json
{ "error": { "message": "string", "code": "STRING_CODE", "details": [ { "path": "field.path", "message": "..." } ] } }
```
- `details` only appears for validation errors, or for a small number of hand-thrown errors that attach structured context (e.g. manual reassign's `warnings`).
- Zod validation failures → `400 VALIDATION_ERROR`, `details: [{ path, message }, ...]` (one per Zod issue).
- `ApiError` subtypes: `notFound` → `404 NOT_FOUND`; `badRequest` → `400 VALIDATION_ERROR` (custom message, optional `details`); `conflict` → `409 CONFLICT`; `forbidden` → `403 FORBIDDEN`; `unauthorized` → `401 UNAUTHORIZED`.
- Uncaught errors → `500 INTERNAL_ERROR`.
- Unmatched route → `404`, message `"No route for GET /api/v1/whatever"`.

**Headers**
- `X-Actor` (optional, default `"unknown"`) — stamps `audit_log.actor`. Used by: order lifecycle events, reassign, unassign, settings upsert/rollback, pipeline upsert. There is **no authentication/authorization** enforced anywhere yet (deferred per `PLAN.md`) — this header is a convenience label, not a credential.
- `X-Voyager-Signature` (required on `POST /webhooks/:slug` only) — hex HMAC-SHA256 of the raw body.

**Geo fields** — every point in a request/response body is `{ "lng": number, "lat": number }` (**lng first**), and every polygon is `{ "points": [{lng,lat}, ...] }` (closed ring, ≥4 points). Internally these become PostGIS `GEOGRAPHY` (`SRID 4326`); the API always converts back to `{lng,lat}` in responses.

**IDs** — every `id` and foreign key is a UUID (`z.uuid()` validated on path params and body fields).

**No pagination** anywhere in this API yet — list endpoints return the full matching set.

---

## Groups (clients)

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/groups` | — | `200` array of Group |
| POST | `/groups` | `{ name, code, description?, status? }` | `201` Group |
| GET | `/groups/:id` | — | `200` Group / `404` |
| PUT | `/groups/:id` | partial of create body | `200` Group |
| DELETE | `/groups/:id` | — | `204` |

```ts
// create body
{ name: string(min1), code: string(min1, unique), description?: string|null, status?: "active"|"inactive" }
```
```json
// Group row
{ "id":"uuid","name":"Aurora Field Services","code":"AURORA","description":null,"status":"active","createdAt":"...","updatedAt":"..." }
```

---

## Jurisdictions

| Method | Path | Notes |
|---|---|---|
| GET | `/groups/:gid/jurisdictions` | list under a group |
| POST | `/groups/:gid/jurisdictions` | `201`, `404` if group missing |
| GET | `/jurisdictions/:id` | |
| PUT | `/jurisdictions/:id` | partial update |
| DELETE | `/jurisdictions/:id` | `204` |

```ts
// create body
{ name: string(min1), code: string(min1), timezone: string(min1) /* IANA, e.g. "America/Toronto" */, status?: "active"|"inactive" }
```
```json
// Jurisdiction row
{ "id":"uuid","groupId":"uuid","name":"Central Metro","code":"CENTRAL","timezone":"America/Toronto","status":"active","settingsVersion":1,"createdAt":"...","updatedAt":"..." }
```
`settingsVersion` is read-only — it increments whenever a setting or pipeline config affecting this jurisdiction changes (see `SETTINGS_GUIDE.md`). It's what the engine polls cheaply to hot-reload config with no restart.

---

## Zones

| Method | Path | Notes |
|---|---|---|
| GET | `/jurisdictions/:jid/zones` | |
| POST | `/jurisdictions/:jid/zones` | `201`, `404` if jurisdiction missing |
| GET | `/zones/:id` | |
| PUT | `/zones/:id` | partial update |
| DELETE | `/zones/:id` | `204` |

```ts
// create body
{
  name: string(min1),
  status?: "active"|"inactive",
  boundary: { points: [{lng,lat}, ...] }  // min 4, closed ring
  centroid: { lng, lat }
}
```
```json
{
  "id":"uuid","jurisdictionId":"uuid","name":"Downtown",
  "boundary": { "points": [{"lng":-79.40,"lat":43.64},{"lng":-79.38,"lat":43.64},{"lng":-79.38,"lat":43.66},{"lng":-79.40,"lat":43.66},{"lng":-79.40,"lat":43.64}] },
  "centroid": { "lng": -79.39, "lat": 43.65 },
  "status":"active","createdAt":"...","updatedAt":"..."
}
```

---

## Workers

| Method | Path | Notes |
|---|---|---|
| GET | `/workers?jurisdictionId=` | optional filter |
| POST | `/workers` | `201`, `404` if jurisdiction missing |
| GET | `/workers/:id` | |
| PUT | `/workers/:id` | partial update |
| DELETE | `/workers/:id` | `204` |
| PUT | `/workers/:id/status` | `{ status }` only |
| PUT | `/workers/:id/location` | `{ location }` only |

```ts
// create body
{
  jurisdictionId: uuid,
  externalId: string(min1),           // caller-owned id, unique per (jurisdictionId, externalId)
  name: string(min1),
  type: "utility"|"delivery"|"cab",
  skills?: string[],
  maxConcurrent?: number(int,positive)|null,  // null = inherit resolved default (see SETTINGS_GUIDE.md)
  location?: { lng, lat }|null,
  status?: "available"|"busy"|"offline"       // default "available"
}
```
```json
{
  "id":"uuid","jurisdictionId":"uuid","externalId":"AURORA-W-001","name":"Ava Chen",
  "type":"utility","skills":["electrical","metering"],"maxConcurrent":2,
  "location":{"lng":-79.39,"lat":43.65},"status":"available","createdAt":"...","updatedAt":"..."
}
```
`PUT /workers/:id/status` body: `{ "status": "available"|"busy"|"offline" }`.
`PUT /workers/:id/location` body: `{ "location": { "lng": number, "lat": number } }`.

---

## Schedules

| Method | Path | Notes |
|---|---|---|
| GET | `/workers/:id/schedules` | |
| POST | `/workers/:id/schedules` | `201`, `400` if neither `dayOfWeek` nor `date` set |
| PUT | `/schedules/:id` | partial update |
| DELETE | `/schedules/:id` | `204` |

```ts
// create body — at least one of dayOfWeek/date required (enforced in the route, not Zod)
{
  dayOfWeek?: number(0-6)|null,  // 0=Sunday..6=Saturday, recurring weekly
  date?: string("YYYY-MM-DD")|null,  // one-off
  startTime: string("HH:MM"),
  endTime: string("HH:MM"),
  type: "shift"|"timeoff",
  recurring?: boolean
}
```
Overnight shifts (e.g. `22:00`–`06:00`) are handled correctly by the matcher's on-duty check (see `PLAN.md`'s Phase 2 notes) — day-of-week attribution keys off the shift's *start* day.

---

## Orders (ingestion + lifecycle)

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/orders?jurisdictionId=&state=` | `200` | list |
| POST | `/orders` | `202` new / `200` idempotent resubmit | writes order + `dispatch_queue` row transactionally |
| GET | `/orders/:id` | `200` | `404` if missing |
| POST | `/orders/:id/cancel` | `200` | no body; `400` if already terminal |
| POST | `/orders/:id/accept` | `200` | worker-reported |
| POST | `/orders/:id/reject` | `200` | re-queues the order |
| POST | `/orders/:id/progress` | `200` | |
| POST | `/orders/:id/complete` | `200` | |
| GET | `/orders/:id/assignments` | `200` | full assignment history, newest first |
| POST | `/orders/:id/reassign` | `200` | manual override |
| POST | `/orders/:id/unassign` | `200` | manual override → re-queue |
| GET | `/orders/:id/audit` | `200` | assignment audit trail |

`OrderState`: `created | queued | dispatched | accepted | in_progress | completed | cancelled | failed` (terminal: `completed`, `cancelled`, `failed`). Orders enter at `queued` (ingestion sets this explicitly).
`OrderPriorityTier`: `critical | high | normal | low`.

### `POST /orders`
```json
{
  "jurisdictionId": "uuid",
  "externalId": "AURORA-O-001",
  "type": "metering",
  "priorityTier": "normal",
  "payload": { "address": "10 Downtown St", "skillsRequired": ["electrical"] },
  "pickup": { "lng": -79.39, "lat": 43.65 },
  "slaDueAt": "2026-08-05T14:15:00Z"
}
```
- `payload` is **fully free-form JSONB** — there's no schema for `address`/`skillsRequired`/time-window sub-fields; whatever object you send is stored as-is (`skillsRequired` above is a convention used in the seed data, not an enforced field).
- `pickup` is required; `priorityTier` and `slaDueAt` are optional/nullable.
- **Idempotent** on `(jurisdictionId, externalId)` — resubmitting the same pair returns the existing order (`200`) instead of creating a duplicate (`202`).
- Response is the serialized order; a `dispatch_queue` row is enqueued in the same transaction, and an `orders.created` metric point is emitted for genuinely new orders.

### Lifecycle events — `accept` / `reject` / `progress` / `complete`
```json
{ "reason": "Worker confirmed via app" }   // optional for all four
```
Response: the raw **Assignment** row (not the order) reflecting the new state. Errors: `404` order missing; `400` "Order has no active assignment"; `400` "Cannot apply "<event>" to an assignment in state "<state>"" if the transition is illegal (see state table below).

### `POST /orders/:id/cancel`
No body. `400` if the order is already terminal. Response: serialized order with `state: "cancelled"`; pending/claimed queue rows marked `done`.

### `POST /orders/:id/reassign` (manual dispatch)
```json
{ "workerId": "uuid", "reason": "Original worker went offline", "force": false }
```
- `workerId`, `reason` required; `force` optional (default falsy).
- Soft constraints (capacity, off-duty, out-of-zone) are returned as `warnings`, **not** hard failures — pass `force: true` to push through anyway. Without `force`, any warnings produce `400` with `details: { warnings: [...] }`.
- Hard failure regardless of `force`: worker's jurisdiction ≠ order's jurisdiction (`400`).
- Response (`200`):
```json
{ "assignment": { "state": "dispatched", "source": "manual", "overriddenBy": "<actor>", "overrideReason": "...", "...": "..." }, "warnings": [] }
```

### `POST /orders/:id/unassign`
```json
{ "reason": "Duplicate dispatch, releasing" }
```
`400` if no active assignment. Overrides the current assignment, sets order back to `queued`, re-enqueues dispatch. Response: the serialized **order**.

### `GET /orders/:id/audit`
Array of `AuditLog` rows (`entity: "assignment"`) for every assignment the order has ever had, newest first.

### State machines (`shared/src/dispatch/lifecycle.ts`)

| Event | Valid `from` (assignment) | `to` (assignment) | `order.state` after |
|---|---|---|---|
| `accept` | `dispatched` | `accepted` | `accepted` |
| `reject` | `dispatched` | `rejected` | `queued` (re-dispatched) |
| `progress` | `accepted` | `in_progress` | `in_progress` |
| `complete` | `accepted`, `in_progress` | `completed` | `completed` |
| `expire`* | `dispatched`, `accepted`, `in_progress` | `expired` | `queued` (re-dispatched) |

\* `expire` has no HTTP endpoint — it's driven only by the engine's SLA-expiry scheduler sweep.

Manual `reassign` moves the current assignment to `overridden` and creates a new one (`source: "manual"`); manual `unassign` moves it to `overridden` and returns the order to `queued`. `Assignment.state` full enum: `dispatched | accepted | rejected | in_progress | completed | cancelled | expired | overridden` (`cancelled` is reserved in the model but not reachable via any current code path).

---

## Assignments

| Method | Path | Notes |
|---|---|---|
| GET | `/assignments?workerId=&jurisdictionId=` | no order/state filter, no pagination |
| GET | `/orders/:id/assignments` | all assignments for one order, `dispatchedAt DESC` |

```json
{
  "id":"uuid","orderId":"uuid","workerId":"uuid","jurisdictionId":"uuid",
  "state":"dispatched","source":"auto","score":"0.87",
  "pipelineTrace": { "stages":[{"stage":"scoring","candidateCount":3}], "candidate": { "scoring": { "score":0.87, "...":"..." } } },
  "overriddenBy":null,"overrideReason":null,
  "dispatchedAt":"...","respondedAt":null,"completedAt":null,"expiresAt":"...",
  "createdAt":"...","updatedAt":"..."
}
```
`AssignmentSource`: `auto | manual`. `score` is `null` for manual assignments (no pipeline ran).

---

## Settings

See `SETTINGS_GUIDE.md` for the resolution algorithm and worked examples. Route summary:

| Method | Path | Notes |
|---|---|---|
| GET | `/settings?scope=&groupId=&jurisdictionId=` | filtered row list — **not** a cascade/effective lookup |
| PUT | `/settings/:key` | upsert at an exact scope |
| GET | `/settings/:key/audit?scope=&groupId=&jurisdictionId=` | `scope` required here |
| POST | `/settings/:key/rollback` | `{ auditLogId }` |

```ts
// PUT body
{ scope: "global"|"group"|"jurisdiction", groupId?: uuid|null, jurisdictionId?: uuid|null, value: any, dataType?: string, description?: string|null }
```
`groupId` is required when `scope: "group"`; `jurisdictionId` is required when `scope: "jurisdiction"` (a Zod `superRefine` enforces this and rejects otherwise with a `400`).

**There is no `GET /settings/effective` endpoint.** Resolving the jurisdiction→group→global cascade over HTTP today means calling `GET /settings?scope=jurisdiction&jurisdictionId=X`, then `?scope=group&groupId=Y`, then `?scope=global`, and picking the most specific non-empty result yourself (the list endpoint doesn't even filter by `key`, so filter the array client-side). Inside `api`/`engine` process code, use `db.settingsService.resolve(key, { jurisdictionId })` directly.

---

## Pipeline

See `PIPELINE_GUIDE.md` for stage schemas, presets, and worked examples.

| Method | Path | Notes |
|---|---|---|
| GET | `/jurisdictions/:jid/pipeline` | `200` always — `{ stored: false, ... }` sentinel if unconfigured, never `404` |
| PUT | `/jurisdictions/:jid/pipeline` | create/replace; `404` if jurisdiction missing |
| GET | `/jurisdictions/:jid/pipeline/audit` | array of `AuditLog` (`entity: "pipeline_config"`) |
| GET | `/pipeline/presets` | static catalog: `simple`, `balanced`, `advanced` (no `custom` entry) |

```ts
// PUT body
{ preset: "simple"|"balanced"|"advanced"|"custom", stages: StageDefinition[], enabled: boolean }
```

---

## Metrics

See `METRICS_GUIDE.md` for the full built-in metric list and query examples.

| Method | Path | Notes |
|---|---|---|
| GET | `/metrics/definitions?jurisdictionId=` | dictionary list (builtin + custom) |
| POST | `/metrics/definitions` | `201`; `409` on duplicate `key`; `builtin` is always forced `false` server-side |
| GET | `/metrics/query?metric=&jurisdictionId=&from=&to=&groupBy=` | aggregation comes from the metric's own definition, never caller-chosen |

`groupBy` whitelist: `jurisdictionId | workerId | hour | day`.

---

## Webhooks (inbound push transport)

An alternative to calling the REST endpoints directly — same ingestion logic, different transport, HMAC-authenticated per source.

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/:slug` | receive; see below |
| GET/POST | `/groups/:gid/webhook-sources` | list / create a source |
| GET/PUT/DELETE | `/webhook-sources/:id` | `slug` is immutable after create |
| POST | `/webhook-sources/:id/rotate-secret` | new secret returned once |
| GET | `/webhook-sources/:id/events?status=` | receipt log, no pagination |

### Signing
```
signature = hex(HMAC-SHA256(rawRequestBodyBytes, source.secret))
header:    X-Voyager-Signature: <signature>     // no "sha256=" prefix
```
Compared via `timingSafeEqual`. Sign the **exact raw bytes** you send — re-serializing JSON differently than what you signed will fail verification.

### Payload shapes (discriminated on `eventType`)
```json
// order.create
{ "eventId":"evt-1","eventType":"order.create","jurisdictionId":"uuid","externalId":"EXT-1",
  "type":"delivery","priorityTier":"high","payload":{},"pickup":{"lng":-79.39,"lat":43.65},"slaDueAt":"2026-08-06T18:00:00Z" }

// order.cancel
{ "eventId":"evt-2","eventType":"order.cancel","jurisdictionId":"uuid","externalId":"EXT-1" }

// worker.status
{ "eventId":"evt-3","eventType":"worker.status","jurisdictionId":"uuid","externalId":"AURORA-W-001","status":"busy" }

// worker.location
{ "eventId":"evt-4","eventType":"worker.location","jurisdictionId":"uuid","externalId":"AURORA-W-001","location":{"lng":-79.39,"lat":43.65} }
```
`eventId` doubles as the idempotency/dedupe key (stored as `webhook_events.dedupeKey`). Only these 4 event types exist — order accept/reject/progress/complete are REST-only (worker-app-driven), not webhook-triggerable.

### Response codes
| Scenario | Status |
|---|---|
| Unknown `:slug` | `404` |
| Bad/missing signature, or source `disabled` | `401` (a `failed` receipt is still logged if the source itself was found) |
| Body isn't valid JSON | `400` |
| Body fails the payload schema | `400` with Zod `details` |
| `eventType` not in the source's `allowedEvents` allow-list | `403` |
| Duplicate `(sourceId, eventId)` | `200`, returns the prior receipt's outcome, not reprocessed |
| New delivery, applied successfully | `202`, `{ "status":"processed","targetEntity":"order"\|"worker","targetId":"uuid","error":null }` |
| New delivery, apply failed (e.g. unknown order, jurisdiction mismatch) | **still `202`** — `{ "status":"failed","targetEntity":null,"error":"<message>" }`; check `webhook_events` for the failure detail and replay later |

### Webhook sources
```json
// POST /groups/:gid/webhook-sources
{ "name": "Field Ops CRM", "slug": "field-ops-crm", "allowedEvents": ["order.create","order.cancel"], "status": "active" }
```
`slug` must match `/^[a-z0-9-]+$/` and is immutable after creation. `secret` (64-char hex, server-generated) is only ever returned by `POST` (create) and `POST /:id/rotate-secret` — every other read strips it.

---

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","checks":{"db":"ok"},"ts":"..."}` / `503` on DB failure — bespoke shape, not the error envelope |
| GET | `/health/engine` | engine liveness via `engine_instances` heartbeat rows |

```json
// GET /health/engine
{
  "status": "ok",
  "instances": [ { "instanceId": "engine-1", "state": "healthy", "lastHeartbeatAt": "...", "claimedInFlight": 3 } ],
  "healthyCount": 1,
  "ts": "..."
}
```
`status` is `"degraded"` (HTTP `503`) when every instance's heartbeat is stale past `engine.heartbeat.staleness_ms` (default `15000`, a global setting).

---

## Full route list

```
GET    /groups                              POST   /groups
GET    /groups/:id                          PUT    /groups/:id                  DELETE /groups/:id
GET    /groups/:gid/jurisdictions           POST   /groups/:gid/jurisdictions
GET    /jurisdictions/:id                   PUT    /jurisdictions/:id           DELETE /jurisdictions/:id
GET    /jurisdictions/:jid/zones            POST   /jurisdictions/:jid/zones
GET    /zones/:id                           PUT    /zones/:id                   DELETE /zones/:id
GET    /workers                             POST   /workers
GET    /workers/:id                         PUT    /workers/:id                 DELETE /workers/:id
PUT    /workers/:id/status                  PUT    /workers/:id/location
GET    /workers/:id/schedules               POST   /workers/:id/schedules
PUT    /schedules/:id                       DELETE /schedules/:id
GET    /orders                              POST   /orders
GET    /orders/:id
POST   /orders/:id/cancel
POST   /orders/:id/accept    POST /orders/:id/reject    POST /orders/:id/progress    POST /orders/:id/complete
GET    /orders/:id/assignments
POST   /orders/:id/reassign  POST /orders/:id/unassign  GET /orders/:id/audit
GET    /assignments
GET    /settings                            PUT    /settings/:key
GET    /settings/:key/audit                 POST   /settings/:key/rollback
GET    /jurisdictions/:jid/pipeline         PUT    /jurisdictions/:jid/pipeline
GET    /jurisdictions/:jid/pipeline/audit   GET    /pipeline/presets
GET    /metrics/definitions                 POST   /metrics/definitions
GET    /metrics/query
POST   /webhooks/:slug
GET    /groups/:gid/webhook-sources         POST   /groups/:gid/webhook-sources
GET    /webhook-sources/:id                 PUT    /webhook-sources/:id          DELETE /webhook-sources/:id
POST   /webhook-sources/:id/rotate-secret
GET    /webhook-sources/:id/events
GET    /health                              GET    /health/engine
```
