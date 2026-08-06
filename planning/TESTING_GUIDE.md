# Voyager — Testing & Walkthrough Guide

Hands-on scenarios for exercising the running stack end-to-end: a simple happy-path dispatch, then progressively more complex flows covering manual override, custom pipelines, settings cascades, and inbound webhooks. Pairs with `API_REFERENCE.md` (endpoint shapes), `SETTINGS_GUIDE.md`, `PIPELINE_GUIDE.md`, and `METRICS_GUIDE.md` (deep dives).

Assumes the stack is up per `README.md` (`api` on `:3000`, `interface` on `:3001`) and you've run `npm run migrate` at least once. Examples use `curl` + `jq`; swap for Postman/httpie as you like. Every path below already includes the `/api/v1` prefix.

---

## 0. Load the reference seed world (recommended starting point)

```bash
npm run seed
```
This loads `shared/seed/seed-world.json` — a deliberately-constructed dataset (one client, two jurisdictions, four zones, six workers, six orders) designed so every geospatial/skill/capacity edge case is exercisable by inspection. Its own `meta.description`/per-entity `note` fields document exactly what each row is for — worth reading directly if you want to understand *why* a given worker or order was placed where it is.

**Caveat:** the seeder currently loads `groups`, `jurisdictions`, `zones`, `workers`, `zoneWorkers`, `schedules`, `orders`, and `dispatchQueue` — it does **not** yet load that same file's `settings`, `pipelineConfigs`, or `assignments` blocks (those are reference/planning data for now; see `SETTINGS_GUIDE.md`). Sections below that need those recreate them explicitly via the API.

The reference clock the seed data is written against is `2026-08-05T14:00:00Z` (Wed 10:00 America/Toronto) — schedules/on-duty checks in the walkthroughs below assume you're running close to that, or that you're not relying on time-of-day gating.

Look up the real UUIDs the seeder generated (it maps human-readable slugs like `grp-aurora` to deterministic `uuid v5` values):
```bash
export GROUP_ID=$(curl -s http://localhost:3000/api/v1/groups | jq -r '.[] | select(.code=="AURORA") | .id')
export CENTRAL_METRO_ID=$(curl -s "http://localhost:3000/api/v1/groups/$GROUP_ID/jurisdictions" | jq -r '.[] | select(.code=="CENTRAL") | .id')
export NORTH_REGION_ID=$(curl -s "http://localhost:3000/api/v1/groups/$GROUP_ID/jurisdictions" | jq -r '.[] | select(.code=="NORTH") | .id')
export AVA_ID=$(curl -s "http://localhost:3000/api/v1/workers?jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[] | select(.externalId=="AURORA-W-001") | .id')
```

---

## 1. Simple — create-to-dispatch, from scratch

Skip the seed world entirely and build the minimum viable hierarchy by hand, to understand the shape of every write.

```bash
# 1. A client
GROUP_ID=$(curl -s -X POST http://localhost:3000/api/v1/groups \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test Client", "code": "TESTCO" }' | jq -r '.id')

# 2. A jurisdiction under it
JUR_ID=$(curl -s -X POST http://localhost:3000/api/v1/groups/$GROUP_ID/jurisdictions \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test Region", "code": "TESTR", "timezone": "America/Toronto" }' | jq -r '.id')

# 3. A zone covering a point
ZONE_ID=$(curl -s -X POST http://localhost:3000/api/v1/jurisdictions/$JUR_ID/zones \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Zone",
    "boundary": { "points": [ {"lng":-79.40,"lat":43.64}, {"lng":-79.38,"lat":43.64}, {"lng":-79.38,"lat":43.66}, {"lng":-79.40,"lat":43.66}, {"lng":-79.40,"lat":43.64} ] },
    "centroid": { "lng": -79.39, "lat": 43.65 }
  }' | jq -r '.id')

# 4. A worker inside that zone, on duty all week
WORKER_ID=$(curl -s -X POST http://localhost:3000/api/v1/workers \
  -H "Content-Type: application/json" \
  -d "{ \"jurisdictionId\": \"$JUR_ID\", \"externalId\": \"TEST-W-1\", \"name\": \"Test Worker\", \"type\": \"utility\", \"skills\": [\"electrical\"], \"maxConcurrent\": 2, \"location\": {\"lng\":-79.39,\"lat\":43.65}, \"status\": \"available\" }" | jq -r '.id')
```
Zone coverage (`zone_workers`) has no dedicated API endpoint yet (a known gap — see `PLAN.md`'s Phase 5 notes); for a from-scratch worker to actually be matched by zone, you'd need that link created some other way (e.g. seed data, or directly in the DB during development). If you just want to confirm ingestion mechanics without full auto-dispatch, that's fine — continue below and inspect the queue row instead of expecting an assignment.

```bash
# 5. A schedule so the worker is on duty
curl -s -X POST http://localhost:3000/api/v1/workers/$WORKER_ID/schedules \
  -H "Content-Type: application/json" \
  -d '{ "dayOfWeek": null, "date": null, "startTime": "00:00", "endTime": "23:59", "type": "shift", "recurring": true }'
# NOTE: at least one of dayOfWeek/date is required — this exact call 400s; see the corrected version:
curl -s -X POST http://localhost:3000/api/v1/workers/$WORKER_ID/schedules \
  -H "Content-Type: application/json" \
  -d '{ "dayOfWeek": 3, "startTime": "00:00", "endTime": "23:59", "type": "shift", "recurring": true }'

# 6. Submit an order
ORDER=$(curl -s -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "{ \"jurisdictionId\": \"$JUR_ID\", \"externalId\": \"TEST-O-1\", \"type\": \"inspection\", \"payload\": {}, \"pickup\": {\"lng\":-79.39,\"lat\":43.65} }")
echo "$ORDER" | jq
ORDER_ID=$(echo "$ORDER" | jq -r '.id')
```
`POST /orders` returns `202` for this first submission (state `queued`) and enqueues a `dispatch_queue` row transactionally. Resubmitting the identical `{jurisdictionId, externalId}` pair returns `200` with the same order — this is the idempotency guarantee, verify it:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "{ \"jurisdictionId\": \"$JUR_ID\", \"externalId\": \"TEST-O-1\", \"type\": \"inspection\", \"payload\": {}, \"pickup\": {\"lng\":-79.39,\"lat\":43.65} }"
# -> 200, not 202 or a duplicate row
```

```bash
# 7. Poll for the engine's auto-dispatch (a few seconds, per POLL_INTERVAL_MS / LISTEN-NOTIFY)
sleep 3
curl -s http://localhost:3000/api/v1/orders/$ORDER_ID | jq '.state'
curl -s http://localhost:3000/api/v1/orders/$ORDER_ID/assignments | jq
```
If the engine process isn't running (only `api` is up), the order will sit in `queued` indefinitely with a `pending` `dispatch_queue` row — start `engine` (`npm run dev --workspace=engine`) to see it actually get claimed and dispatched.

```bash
# 8. Simulate the worker's response
ASSIGNMENT_ID=$(curl -s http://localhost:3000/api/v1/orders/$ORDER_ID/assignments | jq -r '.[0].id')
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/accept \
  -H "Content-Type: application/json" -H "X-Actor: worker-app:TEST-W-1" \
  -d '{ "reason": "Accepted via worker app" }' | jq '.state'
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/progress -H "X-Actor: worker-app:TEST-W-1" | jq '.state'
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/complete -H "X-Actor: worker-app:TEST-W-1" | jq '.state'
curl -s http://localhost:3000/api/v1/orders/$ORDER_ID | jq '.state'   # -> "completed"
```

---

## 2. Using the seed world — geospatial and skill-matching in action

The seed world's `note` fields spell out expected outcomes; here's how to actually observe them via the API (assumes §0's env vars are set and `engine` is running).

```bash
# ord-downtown-metering: Ava (0m, has metering) and Carol (644m) both qualify;
# Farah is excluded (at capacity from the pre-seeded asg-preexisting). Distance -> Ava should win.
ORDER_ID=$(curl -s "http://localhost:3000/api/v1/orders?jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[] | select(.externalId=="AURORA-O-001") | .id')
sleep 3
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID/assignments" | jq '.[0] | {workerId, score, pipelineTrace}'
```

```bash
# ord-riverside-leak requires "plumbing" — only Ben has it. Skill match should narrow the field to Ben
# even though Carol is geographically closer (she covers Riverside too, but lacks the skill).
ORDER_ID=$(curl -s "http://localhost:3000/api/v1/orders?jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[] | select(.externalId=="AURORA-O-002") | .id')
sleep 3
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID/assignments" | jq '.[0].workerId'
```

```bash
# ord-out-of-area sits outside every zone in Central Metro -> zero candidates -> the engine
# should retry/backoff rather than assign. Inspect the dispatch_queue behavior via repeated state checks:
ORDER_ID=$(curl -s "http://localhost:3000/api/v1/orders?jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[] | select(.externalId=="AURORA-O-004") | .id')
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID" | jq '.state'   # stays "queued", never "dispatched"
```

```bash
# ord-hilltop-inspection is in North Region -- Central Metro's skilled workers must never be candidates
# even though several of them have "electrical". Only Elin (North Region) can win.
ORDER_ID=$(curl -s "http://localhost:3000/api/v1/orders?jurisdictionId=$NORTH_REGION_ID" | jq -r '.[] | select(.externalId=="AURORA-O-005") | .id')
sleep 3
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID/assignments" | jq '.[0].workerId'
```

---

## 3. Manual override — reassign with soft-constraint warnings, then force

`wkr-farah` in the seed world is at capacity (`maxConcurrent: 1`, one active `in_progress` assignment already). Try to manually assign a new order to her and observe the soft-constraint guard:

```bash
NEW_ORDER=$(curl -s -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d "{ \"jurisdictionId\": \"$CENTRAL_METRO_ID\", \"externalId\": \"TEST-MANUAL-1\", \"type\": \"inspection\", \"payload\": {}, \"pickup\": {\"lng\":-79.39,\"lat\":43.65} }")
ORDER_ID=$(echo "$NEW_ORDER" | jq -r '.id')
FARAH_ID=$(curl -s "http://localhost:3000/api/v1/workers?jurisdictionId=$CENTRAL_METRO_ID" | jq -r '.[] | select(.externalId=="AURORA-W-006") | .id')

# Without force -- expect 400 with capacity warning
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/reassign \
  -H "Content-Type: application/json" -H "X-Actor: dispatcher@aurora" \
  -d "{ \"workerId\": \"$FARAH_ID\", \"reason\": \"Testing override guard\" }" | jq
# -> { "error": { "message": "...", "code": "VALIDATION_ERROR", "details": { "warnings": ["Worker is at or over capacity ..."] } } }

# With force -- the assignment goes through, warnings echoed back for visibility
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/reassign \
  -H "Content-Type: application/json" -H "X-Actor: dispatcher@aurora" \
  -d "{ \"workerId\": \"$FARAH_ID\", \"reason\": \"Testing override guard\", \"force\": true }" | jq
```
Confirm the audit trail and that the assignment's `source` is `manual` with no `score`:
```bash
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID/audit" | jq
curl -s "http://localhost:3000/api/v1/orders/$ORDER_ID/assignments" | jq '.[0] | {source, score, overriddenBy, overrideReason}'
```
Then release it back to the pipeline:
```bash
curl -s -X POST http://localhost:3000/api/v1/orders/$ORDER_ID/unassign \
  -H "Content-Type: application/json" -H "X-Actor: dispatcher@aurora" \
  -d '{ "reason": "Releasing back to auto-dispatch" }' | jq '.state'   # -> "queued"
```

---

## 4. Settings cascade in practice

Set up the global → group → jurisdiction override chain and confirm `worker.max_concurrent` resolves differently per jurisdiction. Full walkthrough with expected values in `SETTINGS_GUIDE.md` §"Example 2". Quick version:

```bash
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent -H "Content-Type: application/json" -d '{ "scope": "global", "value": 3 }'
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent -H "Content-Type: application/json" -d "{ \"scope\": \"group\", \"groupId\": \"$GROUP_ID\", \"value\": 4 }"
curl -s -X PUT http://localhost:3000/api/v1/settings/worker.max_concurrent -H "Content-Type: application/json" -d "{ \"scope\": \"jurisdiction\", \"jurisdictionId\": \"$CENTRAL_METRO_ID\", \"value\": 2 }"
```
The easiest place to *observe* this cascade over HTTP is `POST /orders/:id/reassign`'s capacity warning: a worker with `maxConcurrent: null` in Central Metro now gets flagged over-capacity at **2** active assignments, while the same worker's counterpart in North Region isn't flagged until **4** (the group default, since North Region has no jurisdiction override).

---

## 5. Custom pipeline — before/after comparison

1. Read the current (fallback) behavior for a jurisdiction with no stored pipeline:
   ```bash
   curl -s "http://localhost:3000/api/v1/jurisdictions/$NORTH_REGION_ID/pipeline" | jq
   # { "stored": false, "preset": null, "stages": [], "enabled": false }
   ```
2. Dispatch an order there and note its `pipelineTrace` only ever has a `scoring` stage (Phase 2's fallback — see `PIPELINE_GUIDE.md`).
3. Adopt the `advanced` preset (tier + scoring + round-robin tiebreak):
   ```bash
   curl -s -X PUT http://localhost:3000/api/v1/jurisdictions/$NORTH_REGION_ID/pipeline \
     -H "Content-Type: application/json" \
     -d '{
       "preset": "advanced",
       "enabled": true,
       "stages": [
         { "type": "tier", "enabled": true, "config": { "tiers": ["critical","high","normal","low"], "sla": { "critical": 15, "high": 60 } } },
         { "type": "scoring", "enabled": true, "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } },
         { "type": "tiebreak", "enabled": true, "config": { "strategy": "round_robin" } }
       ]
     }'
   ```
4. Dispatch another order to the same jurisdiction and compare `pipelineTrace.stages` — it now shows `tier`, `scoring`, `tiebreak` in sequence, and the assignment's `pipelineTrace.candidate.tier` shows the resolved priority. See `PIPELINE_GUIDE.md` for a fully worked tier-and-tiebreak scenario using `ord-critical-outage`.

---

## 6. Inbound webhooks — end-to-end delivery

Register a source, sign a payload, and deliver an order through the push transport instead of the plain REST endpoint.

```bash
SOURCE=$(curl -s -X POST http://localhost:3000/api/v1/groups/$GROUP_ID/webhook-sources \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test CRM", "slug": "test-crm", "allowedEvents": ["order.create","order.cancel"] }')
echo "$SOURCE" | jq
SLUG=$(echo "$SOURCE" | jq -r '.slug')
SECRET=$(echo "$SOURCE" | jq -r '.secret')   # only returned here and on rotate-secret -- save it now
```

Sign and send a payload (raw bytes must match exactly what you sign):
```bash
BODY=$(cat <<EOF
{"eventId":"evt-test-1","eventType":"order.create","jurisdictionId":"$CENTRAL_METRO_ID","externalId":"WEBHOOK-TEST-1","type":"delivery","priorityTier":"normal","payload":{},"pickup":{"lng":-79.39,"lat":43.65}}
EOF
)
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -s -X POST "http://localhost:3000/api/v1/webhooks/$SLUG" \
  -H "Content-Type: application/json" \
  -H "X-Voyager-Signature: $SIGNATURE" \
  -d "$BODY" | jq
# -> 202 { "status": "processed", "targetEntity": "order", "targetId": "uuid", "error": null }
```
Note `printf '%s'` (not `echo`) to avoid a trailing newline sneaking into the signed bytes — a mismatched byte-for-byte body is the most common cause of a 401 here.

Verify the receipt log and that the order actually landed:
```bash
SOURCE_ID=$(echo "$SOURCE" | jq -r '.id')
curl -s "http://localhost:3000/api/v1/webhook-sources/$SOURCE_ID/events" | jq
curl -s "http://localhost:3000/api/v1/orders?jurisdictionId=$CENTRAL_METRO_ID" | jq '.[] | select(.externalId=="WEBHOOK-TEST-1")'
```

Redeliver the identical payload/signature — expect **200** (not 202), with the prior receipt's outcome, no new order:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3000/api/v1/webhooks/$SLUG" \
  -H "Content-Type: application/json" -H "X-Voyager-Signature: $SIGNATURE" -d "$BODY"
```

Try a bad signature (expect `401`):
```bash
curl -s -X POST "http://localhost:3000/api/v1/webhooks/$SLUG" \
  -H "Content-Type: application/json" -H "X-Voyager-Signature: deadbeef" \
  -d "$BODY" | jq
```

Try an event type not on the allow-list (expect `403` — this source only allows `order.create`/`order.cancel`):
```bash
BAD_BODY='{"eventId":"evt-test-2","eventType":"worker.status","jurisdictionId":"'"$CENTRAL_METRO_ID"'","externalId":"AURORA-W-001","status":"busy"}'
BAD_SIG=$(printf '%s' "$BAD_BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -s -X POST "http://localhost:3000/api/v1/webhooks/$SLUG" \
  -H "Content-Type: application/json" -H "X-Voyager-Signature: $BAD_SIG" -d "$BAD_BODY" | jq
```

---

## 7. Metrics — end-to-end

After running a handful of orders through §1/§2/§3 above, query what got emitted:
```bash
FROM="2026-08-01T00:00:00Z"; TO="2026-08-10T00:00:00Z"
curl -s "http://localhost:3000/api/v1/metrics/query?metric=orders.created&from=$FROM&to=$TO" | jq
curl -s "http://localhost:3000/api/v1/metrics/query?metric=dispatch.response_time_ms&from=$FROM&to=$TO&groupBy=day" | jq
curl -s "http://localhost:3000/api/v1/metrics/query?metric=assignment.manual_override_rate&jurisdictionId=$CENTRAL_METRO_ID&from=$FROM&to=$TO" | jq
```
See `METRICS_GUIDE.md` for the full built-in list and a custom-metric-definition walkthrough.

---

## Troubleshooting this walkthrough

- **Orders stay `queued` forever** — confirm `engine` is actually running (`npm run dev --workspace=engine`), and check `GET /health/engine` isn't `degraded`.
- **`400` on schedule creation** — you must supply exactly one of `dayOfWeek`/`date`, not neither (both `null`/omitted 400s; this isn't Zod-enforced, it's a route-level check).
- **Reassign always warns off-duty/out-of-zone even for a seeded worker** — confirm your test's current time overlaps the worker's schedule window relative to the seed's reference clock (`2026-08-05T14:00:00Z`), and that `zone_workers` coverage actually exists for that worker/zone pair.
- **Webhook signature always 401s** — you're almost certainly signing a re-serialized JSON string that differs byte-for-byte from what you POST (extra whitespace, key reordering, a trailing newline). Sign the literal bytes you're about to send, nothing regenerated after.
