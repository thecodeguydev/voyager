# Voyager — Settings Guide

How Voyager's global → group → jurisdiction settings cascade works, what's seeded out of the box, and worked examples you can run against a local stack. See `API_REFERENCE.md` for the raw endpoint shapes; this doc is about the *resolution model* and how to exercise it.

---

## The model

A **setting** is a `(scope, key)` pair with a JSON `value`. `scope` is one of:

| Scope | Identifying columns | Meaning |
|---|---|---|
| `global` | (none — `groupId`/`jurisdictionId` both `null`) | System-wide default |
| `group` | `groupId` | Override for one client/tenant, applies to every jurisdiction under it |
| `jurisdiction` | `jurisdictionId` | Override for one geographic region, wins over everything else |

**Resolution is most-specific-wins**, checked in this order (`SettingsService.resolve(key, { jurisdictionId, groupId? })`):

1. If a `jurisdictionId` is given, look for a `jurisdiction`-scope row for that key. If found, **return it — stop here.**
2. Otherwise look for a `group`-scope row (the `groupId` is either passed in, or auto-derived from the jurisdiction if you only passed `jurisdictionId`). If found, return it.
3. Otherwise fall back to the `global`-scope row. If nothing exists at any scope, resolution returns `undefined` — callers apply their own hardcoded default in that case (see "Fallback defaults" below).

You only ever need to pass `jurisdictionId` — the service derives the jurisdiction's `groupId` for you, so there's no way to accidentally check the wrong group.

**Uniqueness**: at most one row can exist per `(scope, key)` at global scope, per `(scope, groupId, key)` at group scope, and per `(scope, jurisdictionId, key)` at jurisdiction scope — enforced by three separate partial unique indexes (not one composite constraint, since Postgres treats `NULL` columns as distinct and would otherwise let duplicate globals slip through).

**Every write is audited.** `PUT /settings/:key` and `POST /settings/:key/rollback` both write an `audit_log` row with a `before`/`after` JSON snapshot, and bump `jurisdictions.settingsVersion`:
- a `jurisdiction`-scope write bumps that one jurisdiction,
- a `group`-scope write bumps **every jurisdiction under that group**,
- a `global`-scope write bumps **every jurisdiction in the system**.

This is how the engine's in-memory settings cache knows to hot-reload a jurisdiction's config without polling every key on every dispatch cycle — it just compares `settingsVersion`.

---

## What's actually seeded today

Only **global** defaults come from migrations (`shared/migrations/0019-seed-settings.ts`, `0021-seed-phase4-metrics.ts`). Group/jurisdiction overrides don't exist until you create them via `PUT /settings/:key`.

| key | scope | default value | dataType |
|---|---|---|---|
| `pipeline.scoring.weights.distance` | global | `0.5` | number |
| `pipeline.scoring.weights.skillMatch` | global | `0.3` | number |
| `pipeline.scoring.weights.waitTime` | global | `0.2` | number |
| `engine.heartbeat.staleness_ms` | global | `15000` | number |
| `assignment.response_timeout_ms` | global | `300000` | number |
| `metrics.retention_days` | global | `90` | number |

**`worker.max_concurrent` is *not* seeded by any migration**, even though it's the flagship example in `PLAN.md` and appears in `shared/seed/seed-world.json`'s `settings` block (global=3, Aurora group override=4). That JSON block is reference/planning data for documentation and tests — as of this writing, `shared/src/seed/loadSeedWorld.ts` (the loader `npm run seed` actually uses) only loads `groups`, `jurisdictions`, `zones`, `workers`, `zoneWorkers`, `schedules`, `orders`, and `dispatchQueue`; it does **not** loop over `settings`, `pipelineConfigs`, or `assignments` in that file yet. So a freshly-seeded dev database has **no** `worker.max_concurrent` row at any scope — every worker with `maxConcurrent: null` resolves to **unlimited capacity (`Infinity`)** until you `PUT` one in. The worked examples below create these rows explicitly for that reason, rather than assuming they exist.

---

## Fallback defaults (what happens when resolution finds nothing)

Every consumer in the codebase follows the same pattern: **resolve the cascade, then apply a hardcoded default if it comes back empty** — resolution never throws for a missing key.

| Setting | Resolved by | Hardcoded fallback if unset anywhere |
|---|---|---|
| `worker.max_concurrent` | `resolveEffectiveCapacity()` (`shared/src/dispatch/capacity.ts`) | `Infinity` (unlimited) |
| `assignment.response_timeout_ms` | `resolveResponseTimeoutMs()` (`shared/src/dispatch/responseTimeout.ts`) | `300000` (5 min) |
| `pipeline.scoring.weights.*` | `SettingsCache` (`engine/src/settingsCache.ts`) | `{ distance: 0.5, skillMatch: 0.3, waitTime: 0.2 }` |
| `metrics.retention_days` | `maintainPartitions()` (`engine/src/scheduler/partitionMaintenance.ts`) | `90` |
| `engine.heartbeat.staleness_ms` | `GET /health/engine` | (always seeded — `15000`) |

For worker capacity specifically, a worker's **own** `maxConcurrent` column always wins first, before the settings cascade is even consulted:
```
effective capacity = worker.maxConcurrent (if not null)
                   ?? resolve("worker.max_concurrent", { jurisdictionId })   // jurisdiction → group → global
                   ?? Infinity
```

---

## Endpoint quick reference

```
GET  /api/v1/settings?scope=&groupId=&jurisdictionId=     — filtered row list (not a cascade)
PUT  /api/v1/settings/:key                                 — upsert at one exact scope
GET  /api/v1/settings/:key/audit?scope=&groupId=&jurisdictionId=   — audit trail at one exact scope
POST /api/v1/settings/:key/rollback  { auditLogId }         — revert to a prior snapshot
```
Full body/query shapes are in `API_REFERENCE.md`. Two things worth calling out because they're easy to miss:
- `PUT /settings/:key` takes `key` from the **URL**, not the body — a `"key"` field in the JSON body is silently ignored.
- `POST /settings/:key/rollback`'s `:key` path segment is **cosmetic** — the setting actually mutated is whichever `entityId` the given `auditLogId` points to, independent of the URL.

---

## Example 1 — simple: set and read a global default

```bash
# No override anywhere yet — set the global default worker capacity to 3
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent \
  -H "Content-Type: application/json" -H "X-Actor: ops@aurora" \
  -d '{ "scope": "global", "value": 3 }' | jq

# Confirm it's there
curl -s "http://localhost:3000/api/v1/settings?scope=global" | jq
```
Any worker anywhere with `maxConcurrent: null` and no group/jurisdiction override now resolves to `3`.

---

## Example 2 — complex: full cascade with group and jurisdiction overrides

Uses the seed world's real hierarchy (`grp-aurora` → `jur-central-metro`, `jur-north-region`). Look up your local seed's actual UUIDs first (the seeder maps these human-readable slugs to deterministic `uuid v5` values):

```bash
curl -s http://localhost:3000/api/v1/groups | jq '.[] | select(.code=="AURORA")'
curl -s "http://localhost:3000/api/v1/groups/$GROUP_ID/jurisdictions" | jq
```
Set `GROUP_ID`, `CENTRAL_METRO_ID`, `NORTH_REGION_ID` from that output, then:

```bash
# 1. Global default: 3
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent \
  -H "Content-Type: application/json" \
  -d '{ "scope": "global", "value": 3, "description": "Global default worker capacity" }'

# 2. Aurora (the group/client) raises its default to 4
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent \
  -H "Content-Type: application/json" \
  -d "{ \"scope\": \"group\", \"groupId\": \"$GROUP_ID\", \"value\": 4, \"description\": \"Aurora raises default capacity to 4\" }"

# 3. Central Metro overrides down to 2 (e.g. this jurisdiction runs tighter shifts)
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent \
  -H "Content-Type: application/json" \
  -d "{ \"scope\": \"jurisdiction\", \"jurisdictionId\": \"$CENTRAL_METRO_ID\", \"value\": 2, \"description\": \"Central Metro caps at 2 per worker\" }"
```

Now, for a worker with `maxConcurrent: null`:
- in **Central Metro** → resolves to **2** (jurisdiction row wins)
- in **North Region** (same group, no jurisdiction override) → resolves to **4** (group row wins)
- in a jurisdiction under a **different** group entirely (no group/jurisdiction override) → resolves to **3** (global)

Verify with the manual-reassign endpoint, which is the one HTTP-visible place this cascade actually gets exercised today (see `worker.max_concurrent`'s capacity warning in `TESTING_GUIDE.md`), or trace it directly if you're working inside `api`/`engine` code:
```ts
await db.settingsService.resolve("worker.max_concurrent", { jurisdictionId: CENTRAL_METRO_ID }); // -> 2
await db.settingsService.resolve("worker.max_concurrent", { jurisdictionId: NORTH_REGION_ID });   // -> 4
```

### Audit trail for this key

```bash
curl -s "http://localhost:3000/api/v1/settings/worker.max_concurrent/audit?scope=jurisdiction&jurisdictionId=$CENTRAL_METRO_ID" | jq
```
Returns the (currently one-entry) history for the jurisdiction-scoped row, newest first, each with `before`/`after` snapshots.

### Rollback

```bash
# Suppose Central Metro's cap was 2, then someone changed it to 5, and you want to undo that specific change.
AUDIT_ID=$(curl -s ".../worker.max_concurrent/audit?scope=jurisdiction&jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[0].id')

curl -s -X POST http://localhost:3000/api/v1/settings/worker.max_concurrent/rollback \
  -H "Content-Type: application/json" \
  -d "{ \"auditLogId\": \"$AUDIT_ID\" }"
```
This restores the setting's `value`/`dataType`/`description` to whatever they were in that audit entry's `before` snapshot, and itself writes a **new** audit row (`reason: "rollback to audit entry <id>"`) — rollback never deletes history. You cannot roll back a `create` action (there's no `before` to restore).

---

## Effective lookup endpoint

The API now exposes `GET /settings/effective?key=&jurisdictionId=` (or `groupId=`) to return the single resolved setting row using the same jurisdiction → group → global precedence as `SettingsService.resolve()`.

Behavior:
- Requires `key` and at least one of `jurisdictionId` or `groupId`; otherwise `400 VALIDATION_ERROR`.
- Returns `200` with the effective `Setting` row (including its winning `scope`) when found.
- Returns `404 NOT_FOUND` when the key is unset at every scope reachable from the provided context.

Example:

```bash
curl -s "http://localhost:3000/api/v1/settings/effective?key=worker.max_concurrent&jurisdictionId=$CENTRAL_METRO_ID" | jq
```
