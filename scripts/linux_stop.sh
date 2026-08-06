#!/usr/bin/env bash
# Stops everything started by linux_start.sh: the api/engine/interface dev process groups
# (by PID file), then the Postgres container (stopped, not removed — data is preserved).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PID_DIR="$ROOT/.pids"

for name in api engine interface; do
  pid_file="$PID_DIR/$name.pid"
  if [ ! -f "$pid_file" ]; then
    echo "    $name: no pid file, skipping"
    continue
  fi
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    echo "    $name: stopped (pid $pid)"
  else
    echo "    $name: process $pid already exited"
  fi
  rm -f "$pid_file"
done

echo "==> Stopping Postgres (container preserved, data intact)..."
docker compose stop postgres

echo "Voyager stack stopped."
