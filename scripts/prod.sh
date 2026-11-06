#!/usr/bin/env bash
# Prod script — run the backend in production mode.
#
#   scripts/prod.sh
#
# In production the backend serves BOTH the API and the dashboard from a
# single process on :8000 — no separate frontend server needed. This script:
#   1. Applies migrations (idempotent).
#   2. Runs uvicorn (no reload) on :8000.
#
# The dashboard is rendered live by the API (the / route assembles
# frontend/dashboard/parts/ and inlines the current data snapshot + fonts on
# request) — there is no offline HTML build step.
#
# Database: SQLite by default. Override with DATABASE_URL.
# Requires: backend/.venv.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PYTHON="$BACKEND/.venv/bin/python"

export PYTHONPATH="$BACKEND"
# Absolute SQLite path so the same DATABASE_URL works from any cwd (migrations
# and uvicorn each run from a different directory).
export DATABASE_URL="${DATABASE_URL:-sqlite:///${BACKEND}/mlb_market_value.db}"

# --- sanity checks -----------------------------------------------------------
[ -x "$VENV_PYTHON" ] || { echo "ERROR: $VENV_PYTHON not found — create the venv first (see README.local.md)"; exit 1; }

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
