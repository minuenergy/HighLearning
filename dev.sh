#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SYNC_SCRIPT="$ROOT_DIR/scripts/sync_local_supabase_env.py"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"
FRONTEND_ENV_FILE="$FRONTEND_DIR/.env.local"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_NODE_MAX_OLD_SPACE_SIZE="${FRONTEND_NODE_MAX_OLD_SPACE_SIZE:-4096}"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"
ACTUAL_BACKEND_PORT="$BACKEND_PORT"
BACKEND_REUSED=0

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed."
  exit 1
fi

if [ ! -x "$BACKEND_PYTHON" ]; then
  echo "Missing backend virtual environment at $BACKEND_DIR/.venv"
  echo "Run: cd backend && uv venv && source .venv/bin/activate && uv pip install -r requirements.txt"
  exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Missing frontend dependencies at $FRONTEND_DIR/node_modules"
  echo "Run: cd frontend && npm install"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to probe dev server ports."
  exit 1
fi

read_env_value() {
  local file_path="$1"
  local key="$2"

  python3 - "$file_path" "$key" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]

if not path.exists():
    raise SystemExit(0)

for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    current_key, value = line.split("=", 1)
    if current_key.strip() == key:
        cleaned = value.strip()
        if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
            cleaned = cleaned[1:-1]
        print(cleaned)
        raise SystemExit(0)
PY
}

is_local_url() {
  local value="$1"
  [[ "$value" == http://localhost:* || "$value" == http://127.0.0.1:* || "$value" == https://localhost:* || "$value" == https://127.0.0.1:* ]]
}

ensure_local_supabase_env() {
  local backend_supabase_url
  local frontend_supabase_url

  backend_supabase_url="$(read_env_value "$BACKEND_ENV_FILE" "SUPABASE_URL")"
  frontend_supabase_url="$(read_env_value "$FRONTEND_ENV_FILE" "NEXT_PUBLIC_SUPABASE_URL")"

  if [ "${ALLOW_REMOTE_SUPABASE:-0}" = "1" ]; then
    return 0
  fi

  if [ -z "$backend_supabase_url" ] || [ -z "$frontend_supabase_url" ]; then
    echo "Local-only mode requires $BACKEND_ENV_FILE and $FRONTEND_ENV_FILE with localhost Supabase values."
    echo "Recommended: python3 $SYNC_SCRIPT --start"
    exit 1
  fi

  if ! is_local_url "$backend_supabase_url" || ! is_local_url "$frontend_supabase_url"; then
    echo "Remote Supabase values were detected."
    echo "  backend SUPABASE_URL=$backend_supabase_url"
    echo "  frontend NEXT_PUBLIC_SUPABASE_URL=$frontend_supabase_url"
    echo "SocraTeach is now configured for local-only Supabase by default."
    echo "Run: python3 $SYNC_SCRIPT --start"
    echo "If you intentionally need the old remote behavior, set ALLOW_REMOTE_SUPABASE=1 for that session."
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

healthcheck_ok() {
  local url="$1"
  python3 - "$url" <<'PY'
import json
import sys
import urllib.request

url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=1.5) as response:
        payload = json.loads(response.read().decode("utf-8"))
except Exception:
    raise SystemExit(1)

raise SystemExit(0 if payload.get("status") == "ok" else 1)
PY
}

find_available_port() {
  local start_port="$1"
  local port="$start_port"

  while port_in_use "$port"; do
    port=$((port + 1))
  done

  printf '%s\n' "$port"
}

cleanup() {
  local exit_code=$?
  trap - INT TERM EXIT

  if [ "$BACKEND_REUSED" -eq 0 ] && [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup INT TERM EXIT

ensure_local_supabase_env

if port_in_use "$BACKEND_PORT"; then
  if healthcheck_ok "http://localhost:$BACKEND_PORT/health"; then
    BACKEND_REUSED=1
    echo "Backend already running on http://localhost:$BACKEND_PORT, reusing it."
  else
    ACTUAL_BACKEND_PORT="$(find_available_port "$BACKEND_PORT")"
    echo "Port $BACKEND_PORT is already in use and not serving SocraTeach health checks."
    echo "Starting backend on http://localhost:$ACTUAL_BACKEND_PORT instead."
  fi
fi

if [ "$BACKEND_REUSED" -eq 0 ]; then
  if [ "$ACTUAL_BACKEND_PORT" = "$BACKEND_PORT" ]; then
    echo "Starting backend on http://localhost:$ACTUAL_BACKEND_PORT"
  fi
  (
    cd "$BACKEND_DIR"
    exec "$BACKEND_PYTHON" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$ACTUAL_BACKEND_PORT"
  ) &
  BACKEND_PID=$!
fi

echo "Starting frontend on http://localhost:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR"
  NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${FRONTEND_NODE_MAX_OLD_SPACE_SIZE}" \
  NEXT_PUBLIC_API_URL="http://localhost:$ACTUAL_BACKEND_PORT" \
  exec npm run dev -- --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "SocraTeach dev servers are running. Press Ctrl+C to stop both."

while true; do
  if [ "$BACKEND_REUSED" -eq 0 ] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID"
    break
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID"
    break
  fi

  sleep 1
done
