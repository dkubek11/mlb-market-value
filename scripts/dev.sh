#!/usr/bin/env bash
# Dev script — run the backend API and the Vite dev server together.
#
#   scripts/dev.sh
#
# Starts:
#   1. Backend: uvicorn app.main:app --reload  -> http://localhost:8000  (API + docs)
#   2. Frontend: Vite dev server                -> http://localhost:5173 (proxies /api -> :8000)
#
# Database: SQLite by default (backend/mlb_market_value.db). Override with DATABASE_URL.
# Requires: backend/.venv (python venv), frontend/react node_modules (npm install once).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PYTHON="$BACKEND/.venv/bin/python"

export DATABASE_URL="${DATABASE_URL:-sqlite:///./mlb_market_value.db}"

# --- sanity checks -----------------------------------------------------------
[ -x "$VENV_PYTHON" ] || { echo "ERROR: $VENV_PYTHON not found — create the venv first (see README.local.md)"; exit 1; }
[ -d "$FRONTEND/node_modules" ] || { echo "ERROR: frontend/react/node_modules missing — run 'npm install' in $FRONTEND first"; exit 1; }

# --- migrations (idempotent) -------------------------------------------------
echo "==> applying migrations (alembic upgrade head)"
(
  cd "$BACKEND"
  "$VENV_PYTHON" -m alembic upgrade head
)

# --- start both servers, kill both on Ctrl-C --------------------------------
cleanup() {
  echo
  echo "==> stopping backend + frontend"
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> starting backend (uvicorn --reload) on :8000"
(
  cd "$BACKEND"
  exec "$VENV_PYTHON" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &

echo "==> starting frontend (Vite) on :5173"
(
  cd "$FRONTEND"
  exec npm run dev
) &

echo
echo "Dashboard:  http://localhost:5173/"
echo "API docs:   http://localhost:8000/docs"
echo "Press Ctrl-C to stop both."
echo

# Wait for either process to exit, then the trap cleans up the other.
wait
