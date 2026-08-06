#!/usr/bin/env bash
# Starts the full Voyager stack on Linux: Postgres (docker compose), then api/engine/interface
# as background dev processes. Run linux_stop.sh to tear everything back down.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_DIR="$ROOT/.pids"
LOG_DIR="$ROOT/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

echo "==> Starting Postgres (docker compose)..."
docker compose up -d postgres

echo "==> Waiting for Postgres to become healthy..."
deadline=$((SECONDS + 60))
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q postgres)" 2>/dev/null)" = "healthy" ]; do
  if [ "$SECONDS" -gt "$deadline" ]; then
    echo "Postgres did not become healthy within 60s" >&2
    exit 1
  fi
  sleep 1
done
echo "    Postgres is healthy."

echo "==> Running migrations..."
npm run migrate

start_service() {
  local name="$1" workspace="$2"
  local log="$LOG_DIR/$name.log"
  # setsid gives this dev server its own process group so linux_stop.sh can kill the
  # whole tree (npm -> tsx/next child) with one `kill -- -PID`, not just the npm wrapper.
  setsid npm run dev --workspace="$workspace" >"$log" 2>&1 &
  echo $! >"$PID_DIR/$name.pid"
  echo "    $name started (pid $!, log: $log)"
}

echo "==> Starting api, engine, interface..."
start_service "api" "api"
start_service "engine" "engine"
start_service "interface" "interface"

cat <<EOF

Voyager is starting up:
  API        http://localhost:3000/api/v1
  Interface  http://localhost:3001
  Logs       $LOG_DIR

Run scripts/linux_stop.sh to stop everything.
EOF
