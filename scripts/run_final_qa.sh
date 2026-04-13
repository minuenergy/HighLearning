#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WITH_SERVER="$ROOT/../.agents/skills/webapp-testing/scripts/with_server.py"

cd "$ROOT"
npm run supabase:env:start >/dev/null

cd "$ROOT/frontend"
npm run build >/dev/null
cd "$ROOT"

python3 "$WITH_SERVER" \
  --server "cd $ROOT/backend && ./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000" --port 8000 \
  --server "cd $ROOT/frontend && npm run start -- --hostname 127.0.0.1 --port 3000" --port 3000 \
  -- "$ROOT/backend/.venv/bin/python" "$ROOT/backend/scripts/final_demo_smoke.py"
