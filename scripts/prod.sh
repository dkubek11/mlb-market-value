#!/usr/bin/env bash
# Prod script — build the dashboard and run the backend in production mode.
#
#   scripts/prod.sh
#
# In production the backend serves BOTH the API and the self-contained
# dashboard (frontend/dashboard/dashboard_final.html) from a single process on
# :8000 — no separate frontend server needed. This script:
#   1. Applies migrations (idempotent).
#   2. Builds the dashboard (build_dashboard.py + splice_dashboard.py).
#   3. Runs uvicorn (no reload) on :8000.
#
# Database: SQLite by default. Override with DATABASE_URL.
# Requires: backend/.venv.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
DASHBOARD="$ROOT/frontend/dashboard"
VENV_PYTHON="$BACKEND/.venv/bin/python"

export PYTHONPATH="$BACKEND"
# Absolute SQLite path so the same DATABASE_URL works from any cwd (the
# dashboard build and uvicorn each run from a different directory).
export DATABASE_URL="${DATABASE_URL:-sqlite:///${BACKEND}/mlb_market_value.db}"

# --- sanity checks -----------------------------------------------------------
[ -x "$VENV_PYTHON" ] || { echo "ERROR: $VENV_PYTHON not found — create the venv first (see README.local.md)"; exit 1; }

# --- build dashboard ---------------------------------------------------------
echo "==> building dashboard (build_dashboard.py + splice_dashboard.py)"
(
  cd "$DASHBOARD"
  "$VENV_PYTHON" build_dashboard.py
  "$VENV_PYTHON" splice_dashboard.py
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
