#!/usr/bin/env bash
# Dev script — apply migrations and run the backend API which serves the
# dashboard at http://localhost:8000/.
#
#   scripts/dev.sh
#
# Starts:
#   1. Migrations (alembic upgrade head, idempotent)
#   2. Backend: uvicorn app.main:app --reload -> http://localhost:8000  (API + docs + dashboard)
#
# The dashboard is rendered live by the API: the / route inlines the current
# data snapshot and fonts into frontend/dashboard/dashboard_template.html on
# request, so there is no offline build step.
#
# Database: SQLite by default (backend/mlb_market_value.db). Override with DATABASE_URL.
# Requires: backend/.venv (python venv).
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

# --- run backend (serves API + dashboard) ------------------------------------
echo "==> starting backend (uvicorn --reload) on :8000"
echo
echo "Dashboard:  http://localhost:8000/"
echo "API docs:   http://localhost:8000/docs"
echo "Press Ctrl-C to stop."
echo
(
  cd "$BACKEND"
  exec "$VENV_PYTHON" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
)
