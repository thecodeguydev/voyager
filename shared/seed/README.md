# Voyager — Canonical Seed World

`seed-world.json` is the shared, ORM-independent test dataset described in [`planning/TESTING.md`](../../planning/TESTING.md). It is the single small world that:

- **drives the automated suite** — factories (`makeWorker(...)`, etc.) start from these records and override only the fields a test cares about, and
- **feeds the docker-compose local environment** — the seeder loads it so you can click through the dashboard and watch real dispatches flow.

It is deliberately **decoupled from the ORM**: pure data with real coordinates, no Sequelize dependency. A Phase 0 seeder maps the string ids to stable UUIDs (uuid v5) and inserts via the models. Because the file is data, it stays valid whether the model wiring lands this week or next phase.

---

## Reference clock

Time-dependent behavior (schedules, SLA, expiry) is evaluated against a fixed instant so tests are deterministic:

- **`2026-08-05T14:00:00Z`** = **Wed 2026-08-05 10:00 America/Toronto** (EDT, UTC−4), `dayOfWeek = 3`.

Tests should pin the clock here (e.g. `@sinonjs/fake-timers`) rather than reading the wall clock.

---

## Geography

Coordinates are `(lng lat)`, SRID 4326. At latitude ~43.65°: **0.01° lng ≈ 0.805 km**, **0.01° lat ≈ 1.11 km**.

```
  lat
43.74 ┌─────────┐                                  North Region
      │ Hilltop │  (jur-north-region)              (~9 km north)
43.72 └─────────┘
        -79.42..-79.40

43.66 ┌───────────┬──┬────────────┐
      │ Downtown  │▓▓│  Riverside  │   ▓▓ = overlap strip
      │           │▓▓│             │        lng -79.385..-79.38
43.64 └───────────┴──┴────────────┘
       -79.40   -79.385 -79.38  -79.365      Central Metro

43.62         ┌─────────┐
              │ Airport │   detached, ~8–9 km SE of Downtown
43.60         └─────────┘
               -79.30..-79.28
```

- **Downtown** and **Riverside** share a genuine 2-D **overlap** (lng −79.385..−79.38): a pickup there is `ST_Covers`-ed by *both* zones.
- **Airport** is detached — no overlap, useful for "far candidate" and negative geospatial tests.
- **Hilltop** sits in a **different jurisdiction** (North Region), driving the isolation test.

---

## Cast & what each entity exercises

### Workers (all in group Aurora)

| Worker | Jurisdiction | Location | Skills | Cap | Status | Exercises |
|---|---|---|---|---|---|---|
| Ava Chen | Central Metro | Downtown centroid | electrical, metering | 2 | available | distance winner; only `metering` skill |
| Ben Ortiz | Central Metro | Riverside centroid | plumbing, electrical | 3 | available | only `plumbing` skill (skill-narrowing) |
| Carol Diaz | Central Metro | **overlap** | electrical | 1 | available | covers two zones; overlap winner |
| Dan Petrov | Central Metro | outside all zones | electrical | null | **offline** | never a candidate; `null` cap → inherits default |
| Elin Novak | North Region | Hilltop centroid | electrical | 2 | available | sole candidate for North Region |
| Farah Idris | Central Metro | Downtown | electrical | 1 | **busy** | **at capacity** → capacity exclusion |

### Orders

| Order | Pickup | Requires | Expected outcome |
|---|---|---|---|
| `ord-preexisting` | Downtown | electrical | already assigned to Farah (in_progress) → makes her at-capacity |
| `ord-downtown-metering` | Downtown (−79.39, 43.65) | electrical | **Ava** (0 m) beats Carol (644 m); Farah excluded |
| `ord-riverside-leak` | Riverside | plumbing | **Ben** only (skill-narrowing) |
| `ord-overlap-job` | overlap (−79.382, 43.65) | electrical | **Carol** (0 m) beats Ben (564 m), Ava (644 m) |
| `ord-out-of-area` | outside all zones | electrical | **no candidates** → retry / dead-letter path |
| `ord-hilltop-inspection` | Hilltop | electrical | **Elin** only; skilled Central Metro workers excluded by **jurisdiction** |
| `ord-critical-outage` | Downtown | electrical | **critical tier**, 15-min SLA → TierFilter + SLA path; Ava/Carol candidates |

### Distances used above (reason-by-eye)

For `ord-downtown-metering` at (−79.39, 43.65): Ava = 0 m; Carol at (−79.382, 43.65) → Δlng 0.008° × 80.5 km/° ≈ **644 m**.
For `ord-overlap-job` at (−79.382, 43.65): Carol = 0 m; Ben at (−79.375, 43.65) → Δlng 0.007° ≈ **564 m**; Ava → **644 m**.

### Settings cascade (worker capacity)

`global = 3` → `group Aurora = 4` → (no jurisdiction override) → worker override wins where set.

- A Central Metro worker with `maxConcurrent = null` (Dan) resolves to **4** (group).
- Workers with an explicit cap use their own value (Ava 2, Ben 3, Carol 1, Farah 1).

### Pipelines

- **Central Metro** — `balanced`: Tier → Scoring → Tiebreak(`nearest`).
- **North Region** — `simple`: Scoring only (distance-weighted).

---

## Loading (Phase 0)

The seeder is written in Phase 0 alongside the models/migrations. It should:

1. Resolve each slug id to a deterministic uuid v5 (stable across runs).
2. Insert in FK order: groups → jurisdictions → zones → workers → zoneWorkers → schedules → settings → pipelineConfigs → orders → assignments → dispatchQueue.
3. Expand each schedule's `daysOfWeek` array into one row per day (the model stores a single `dayOfWeek`).
4. Convert WKT strings to PostGIS `GEOGRAPHY` via `ST_GeogFromText`.

Note: **built-in metric definitions** are seeded by their own builtin seeder, not this world; this file covers the operational entities that dispatch needs.
