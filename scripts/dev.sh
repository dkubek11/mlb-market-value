#!/usr/bin/env bash
# Dev script — apply migrations, rebuild the dashboard, and run the backend API
# which serves the dashboard at http://localhost:8000/.
#
#   scripts/dev.sh
#
# Starts:
#   1. Migrations (alembic upgrade head, idempotent)
#   2. Dashboard build: build_dashboard.py + splice_dashboard.py -> dashboard_final.html
#   3. Backend: uvicorn app.main:app --reload -> http://localhost:8000  (API + docs + dashboard)
#
# Database: SQLite by default (backend/mlb_market_value.db). Override with DATABASE_URL.
# Requires: backend/.venv (python venv).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
DASHBOARD="$ROOT/frontend/dashboard"
VENV_PYTHON="$BACKEND/.venv/bin/python"

export PYTHONPATH="$BACKEND"
# Absolute SQLite path so the same DATABASE_URL works from any cwd (migrations,
# the dashboard build, and uvicorn each run from a different directory).
export DATABASE_URL="${DATABASE_URL:-sqlite:///${BACKEND}/mlb_market_value.db}"

# --- sanity checks -----------------------------------------------------------
[ -x "$VENV_PYTHON" ] || { echo "ERROR: $VENV_PYTHON not found — create the venv first (see README.local.md)"; exit 1; }

# --- migrations (idempotent) -------------------------------------------------
echo "==> applying migrations (alembic upgrade head)"
(
  cd "$BACKEND"
  "$VENV_PYTHON" -m alembic upgrade head
)

# --- rebuild the served dashboard --------------------------------------------
echo "==> rebuilding dashboard (build_dashboard.py + splice_dashboard.py)"
(
  cd "$DASHBOARD"
  "$VENV_PYTHON" build_dashboard.py
  "$VENV_PYTHON" splice_dashboard.py
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
