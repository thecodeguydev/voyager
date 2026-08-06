# Voyager — Pipeline Configuration Guide

How to configure the composable dispatch pipeline per jurisdiction: stage types, presets, custom pipelines, and what runs when nothing is configured. See `API_REFERENCE.md` for the raw endpoint shapes.

---

## Model

A jurisdiction's pipeline is one `pipeline_configs` row: `{ preset, stages, enabled }`. `stages` is an ordered array — each stage runs in sequence, filtering and/or ranking candidates (`run(candidates, ctx) -> candidates`), and the array's order **is** execution order.

```ts
{
  preset: "simple" | "balanced" | "advanced" | "custom",
  stages: StageDefinition[],
  enabled: boolean
}
```

Every stage entry has exactly 3 keys:
```ts
{ type: "tier"|"scoring"|"tiebreak", enabled: boolean, config: {...} }  // config shape depends on type
```
A stage with `enabled: false` is kept in the stored document (so a toggle in the UI can be reverted later) but is filtered out before the engine builds the runnable pipeline — it contributes nothing at dispatch time.

### `tier` stage

```ts
config: {
  tiers: ("critical"|"high"|"normal"|"low")[],  // min 1, list most-urgent-first
  sla?: { critical?: number, high?: number, normal?: number, low?: number }  // minutes-until-slaDueAt cutoff per tier, default {}
}
```
Resolution logic (`resolveTier`):
1. If the order already has an explicit `priorityTier`, that wins outright — no computation.
2. Otherwise, walk `tiers` in the given order; the first tier whose `sla[tier]` cutoff is set **and** the order's minutes-until-`slaDueAt` is at or under that cutoff is the resolved tier.
3. If nothing matches (or `slaDueAt` is unset), falls back to the **last** entry in `tiers` (your catch-all/default tier).

This stage **tags, it does not filter or persist** — it stamps `candidate.trace.tier = { tier, minutesUntilDue, source }` on every candidate (visible in the assignment's `pipelineTrace`), but never writes the tier back onto `order.priorityTier` and never removes/reorders candidates. Hard eligibility gating by tier is deliberately not implemented yet.

### `scoring` stage

```ts
config: {
  weights: { distance: number(>=0), skillMatch: number(>=0), waitTime: number(>=0) }
}
```
Computes a weighted score per candidate (PostGIS `ST_Distance` for distance, order/worker skill overlap for `skillMatch`, worker idle time as a proxy for `waitTime`), sorts candidates descending by score. Weights don't need to sum to 1 — there's no such constraint in the schema.

### `tiebreak` stage

```ts
config: { strategy: "fifo" | "round_robin" | "nearest" }
```
Groups candidates within a small score epsilon (`0.0001`) of the group's top scorer, then reorders **within each tied group only** (the ordering across groups is untouched):
- `nearest` — ascending distance.
- `round_robin` — ascending "time since this worker was last dispatched" (never-dispatched sorts first).
- `fifo` — no reorder; a stable pass-through of the candidates' existing (matcher) order, since there's no cross-order queue to draw "first" from at this point in a single dispatch.

---

## Presets — `GET /api/v1/pipeline/presets`

Exact static catalog (no DB read):

```json
{
  "simple": [
    { "type": "scoring", "enabled": true, "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } }
  ],
  "balanced": [
    { "type": "scoring", "enabled": true, "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } },
    { "type": "tiebreak", "enabled": true, "config": { "strategy": "nearest" } }
  ],
  "advanced": [
    { "type": "tier", "enabled": true, "config": { "tiers": ["critical","high","normal","low"], "sla": { "critical": 15, "high": 60 } } },
    { "type": "scoring", "enabled": true, "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } },
    { "type": "tiebreak", "enabled": true, "config": { "strategy": "round_robin" } }
  ]
}
```
`custom` has no catalog entry — it's a label a jurisdiction's document carries once its `stages` diverge from a template, not something the API validates against.

---

## What runs when nothing is configured

`GET /jurisdictions/:jid/pipeline` **never 404s** — a jurisdiction with no row yet returns:
```json
{ "jurisdictionId": "uuid", "stored": false, "preset": null, "stages": [], "enabled": false }
```
`stored: false` is the Interface's Pipeline Editor's explicit signal to show an "initialize" / "restore to preset" action, not a blank builder.

At dispatch time, the engine falls back — silently, no error — to **Phase 2's original behavior**: a single `ScoringStage`, with weights resolved through the Settings cascade (`pipeline.scoring.weights.distance|skillMatch|waitTime`, default `{0.5, 0.3, 0.2}` if unset anywhere — see `SETTINGS_GUIDE.md`). This fallback also applies if a stored row exists but has `enabled: false`, or if its stored `{preset, stages, enabled}` fails schema validation (defense against a hand-edited row). This is deliberate: adopting the new pipeline is an explicit per-jurisdiction `PUT`, never an automatic behavior change for a jurisdiction that's already running.

---

## Example 1 — simple: adopt the `balanced` preset

```bash
curl -s -X PUT http://localhost:3000/api/v1/jurisdictions/$CENTRAL_METRO_ID/pipeline \
  -H "Content-Type: application/json" -H "X-Actor: ops@aurora" \
  -d '{
    "preset": "balanced",
    "enabled": true,
    "stages": [
      { "type": "scoring", "enabled": true, "config": { "weights": { "distance": 0.5, "skillMatch": 0.3, "waitTime": 0.2 } } },
      { "type": "tiebreak", "enabled": true, "config": { "strategy": "nearest" } }
    ]
  }'
```
This is exactly `PRESET_CATALOG.balanced` — you copy the preset's stage array verbatim into the `PUT` body (the API doesn't accept a bare `{"preset":"balanced"}` shorthand; the Interface's "restore to preset" action does this copy for you).

Verify:
```bash
curl -s http://localhost:3000/api/v1/jurisdictions/$CENTRAL_METRO_ID/pipeline | jq
# { "jurisdictionId": "...", "stored": true, "preset": "balanced", "stages": [...], "enabled": true }
```

---

## Example 2 — complex: a custom pipeline with tier-gated SLAs and round-robin tiebreak

Scenario: Central Metro wants critical outages triaged within 15 minutes, high-priority jobs within an hour, and ties broken by rotation (fairness) rather than pure distance.

```bash
curl -s -X PUT http://localhost:3000/api/v1/jurisdictions/$CENTRAL_METRO_ID/pipeline \
  -H "Content-Type: application/json" -H "X-Actor: ops@aurora" \
  -d '{
    "preset": "custom",
    "enabled": true,
    "stages": [
      { "type": "tier", "enabled": true, "config": {
          "tiers": ["critical", "high", "normal", "low"],
          "sla": { "critical": 15, "high": 60 }
      }},
      { "type": "scoring", "enabled": true, "config": {
          "weights": { "distance": 0.4, "skillMatch": 0.4, "waitTime": 0.2 }
      }},
      { "type": "tiebreak", "enabled": true, "config": { "strategy": "round_robin" } }
    ]
  }'
```

Trace through the seed world's `ord-critical-outage` (`priorityTier: "critical"`, `slaDueAt` 15 minutes out, pickup in Downtown, requires `electrical`):
1. **TierFilter** — order already has an explicit `priorityTier: "critical"`, so it's tagged `{ tier: "critical", source: "explicit" }` without consulting `sla` at all.
2. **Scoring** — candidates `wkr-ava` (0m away, has `electrical`+`metering`) and `wkr-carol` (644m away, has `electrical`) are scored; `wkr-farah` is excluded upstream by the matcher (at capacity). Ava's shorter distance and skill match push her score higher.
3. **Tiebreak** — only invoked if two candidates land within `0.0001` of each other; with distinct distances here, this is a no-op pass-through.
4. Winner: `wkr-ava`. Check `GET /assignments?workerId=$AVA_ID` afterward — the assignment's `pipelineTrace.candidate.tier`/`.scoring`/`.tiebreak` show exactly this reasoning, which is what the Interface's Dispatch Telemetry screen renders per-case.

To see the tier stage actually *compute* rather than pass through an explicit tier, submit an order with `priorityTier` omitted and a `slaDueAt` 10 minutes out — it'll resolve to `critical` via the `sla.critical: 15` cutoff (10 ≤ 15) even though nobody set the tier explicitly.

### Disabling a stage without losing its config

Toggle a stage off by flipping `enabled` on that one entry — you don't need to remove it from the array:
```json
{ "type": "tier", "enabled": false, "config": { "tiers": ["critical","high","normal","low"], "sla": { "critical": 15, "high": 60 } } }
```
The engine filters this out before building the runtime pipeline, but a later `PUT` re-enabling it restores the same config with no data loss — this is exactly what the Pipeline Editor's stage toggle does.

### Auditing pipeline changes

```bash
curl -s http://localhost:3000/api/v1/jurisdictions/$CENTRAL_METRO_ID/pipeline/audit | jq
```
Every `PUT` writes one `audit_log` row (`entity: "pipeline_config"`) with a full `before`/`after` snapshot of the stored document — there's no separate rollback endpoint for pipelines (unlike settings); to revert, `PUT` the prior document back.
