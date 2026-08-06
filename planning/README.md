# Voyager — Running the Stack

How to bring up all three services (`api`, `engine`, `interface`) plus Postgres/PostGIS for local development. For what's being built, see `PLAN.md`; for how it's tested (automated test suite), see `TESTING.md`.

**Using the API once it's running:**
- `API_REFERENCE.md` — every endpoint, request/response shape, and error envelope.
- `SETTINGS_GUIDE.md` — the global → group → jurisdiction settings cascade, with worked examples.
- `PIPELINE_GUIDE.md` — configuring the composable dispatch pipeline (stages, presets, custom configs).
- `METRICS_GUIDE.md` — the built-in metric dictionary, querying, and defining custom metrics.
- `TESTING_GUIDE.md` — hands-on walkthroughs (simple dispatch, manual override, custom pipeline, settings cascade, webhooks) to exercise and understand the running stack.

---

## Prerequisites

- **Node.js ≥ 20** and npm (this is an npm-workspaces monorepo — `shared`, `api`, `engine`, `interface`).
- **Docker** (with `docker compose`) — Postgres runs as the `postgis/postgis:16-3.4` image via `docker-compose.yml` at the repo root; nothing to install locally for the database.

## One-time setup

```bash
npm install                       # installs all four workspaces from the repo root
cp .env.example .env               # local dev defaults — Postgres creds, DATABASE_URL, PORT, NEXT_PUBLIC_API_BASE_URL
```

`.env` lives at the **repo root**, not inside any workspace. `api`, `engine`, and `shared` all resolve it explicitly against their own file location (see PLAN.md's Phase 5 implementation notes) specifically so it's found no matter which workspace's script is currently running.

---

## Option A — the start/stop scripts (recommended)

`scripts/` has one pair per OS. Each start script brings up Postgres, waits for its healthcheck, runs migrations, then launches all three services as background dev processes with logs and PIDs tracked under `logs/` and `.pids/` (both gitignored).

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows_start.ps1
# ...
powershell -ExecutionPolicy Bypass -File scripts/windows_stop.ps1
```

**Linux / macOS (bash):**
```bash
./scripts/linux_start.sh
# ...
./scripts/linux_stop.sh
```

The stop script kills the full process tree it started (not just the top-level PID — `npm run dev` is a few hops from the real server process) and stops (does **not** remove) the Postgres container, so the data volume survives between sessions.

Once started:

| Service | URL |
|---|---|
| API | http://localhost:3000/api/v1 |
| Interface | http://localhost:3001 |
| API health | http://localhost:3000/api/v1/health |
| Engine health | http://localhost:3000/api/v1/health/engine |

## Option B — run it by hand

Useful for running one service at a time, or when iterating on the start scripts themselves.

```bash
docker compose up -d postgres       # start Postgres+PostGIS
npm run migrate                     # apply migrations (shared/migrations, via umzug) — idempotent, safe to rerun
npm run seed                        # optional: load the canonical seed world (groups/jurisdictions/zones/workers/orders)

npm run dev --workspace=api         # http://localhost:3000
npm run dev --workspace=engine      # no HTTP port — polls/claims the dispatch_queue, writes heartbeats
npm run dev --workspace=interface   # http://localhost:3001
```

Each `dev` script watches its own workspace (`tsx watch` for `api`/`engine`, `next dev` for `interface`) — run each in its own terminal, or let the start scripts back them in one call.

To stop the manual route: `Ctrl+C` each dev process, then `docker compose stop postgres` (or `docker compose down` if you also want to remove the container — add `-v` only if you intend to discard the seeded data too).

---

## Building for production

```bash
npm run build   # builds shared -> api -> engine -> interface, in that order
```

`shared/` must build before `api`/`engine` can import it (`dist/` is gitignored, no TS project references) — the root `build` script and each workspace's own `pretest` script both enforce this ordering.

---

## Troubleshooting

- **"DATABASE_URL is not set"** — `.env` is missing at the repo root, or you're running a script from inside a workspace directory with no root `.env` reachable. Confirm `.env` exists at `Voyager/.env` (copy it from `.env.example` if not).
- **Port conflicts** — `api` listens on `3000` (`PORT` in `.env`), `interface` on `3001` (hardcoded in `interface/package.json`'s `dev`/`start` scripts to avoid colliding with `api`). Postgres is on `5432` (`POSTGRES_PORT`).
- **Migrations fail / schema looks stale** — `npm run migrate` is safe to rerun (umzug only applies pending migrations); if something looks wrong, check `docker compose logs postgres` and confirm the container is the one your `.env` points at (`POSTGRES_PORT`/`DATABASE_URL` must match).
- **Windows: `Start-Process` errors on `npm`** — already handled in `windows_start.ps1` (it shells through `cmd.exe /c`), but if you're adapting the script, remember `npm` resolves to `npm.cmd`, not a directly launchable executable.
- **Stale engine instance rows in `GET /health/engine`** — a crashed (not gracefully stopped) engine process leaves a `healthy`-looking row until its heartbeat goes stale past the threshold; this is expected and self-heals, not a bug.
