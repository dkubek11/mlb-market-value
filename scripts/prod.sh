#!/usr/bin/env bash
# Prod script — build the React frontend and run the backend in production mode.
#
#   scripts/prod.sh
#
# In production the backend serves BOTH the API and the built dashboard bundle
# (frontend/dist/index.html) from a single process on :8000 — no separate
# frontend server needed. This script:
#   1. Runs the npm production build (guards: prebuild-guard + verify-build).
#   2. Applies migrations (idempotent).
#   3. Runs uvicorn (no reload) on :8000.
#
# Database: SQLite by default. Override with DATABASE_URL.
# Requires: backend/.venv, frontend/react node_modules.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PYTHON="$BACKEND/.venv/bin/python"

export DATABASE_URL="${DATABASE_URL:-sqlite:///./mlb_market_value.db}"

# --- sanity checks -----------------------------------------------------------
[ -x "$VENV_PYTHON" ] || { echo "ERROR: $VENV_PYTHON not found — create the venv first (see README.local.md)"; exit 1; }
[ -d "$FRONTEND/node_modules" ] || { echo "ERROR: frontend/react/node_modules missing — run 'npm install' in $FRONTEND first"; exit 1; }

# --- build frontend ----------------------------------------------------------
echo "==> building frontend (npm run build)"
(
  cd "$FRONTEND"
  npm run build
)

# --- migrations (idempotent) -------------------------------------------------
echo "==> applying migrations (alembic upgrade head)"
(
  cd "$BACKEND"
  "$VENV_PYTHON" -m alembic upgrade head
)

# --- run backend -------------------------------------------------------------
echo "==> starting backend (uvicorn) on :8000"
cd "$BACKEND"
exec "$VENV_PYTHON" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
