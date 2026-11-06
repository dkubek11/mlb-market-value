#!/usr/bin/env bash
# Nightly data refresh for mlb-market-value (Unix / macOS / Linux).
#
# Runs the full pipeline:
#   1. Re-ingests the current season
#   2. Recomputes player values and team payroll summaries
#
# The dashboard is rendered live by the API (no offline HTML build), so
# refreshed data is served on the next page load once the snapshot cache
# expires (or immediately with ?refresh=1).
#
# Can be scheduled via crontab (e.g. at 3:00 AM daily):
#   0 3 * * * /path/to/mlb-market-value/scripts/nightly_refresh.sh >> /path/to/mlb-market-value/scripts/logs/cron.log 2>&1
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
LOG_DIR="$ROOT/scripts/logs"
SEASON="${SEASON:-2026}"
TIMESTAMP="$(date +'%Y-%m-%d_%H%M%S')"
LOG_FILE="$LOG_DIR/refresh_${TIMESTAMP}.log"

mkdir -p "$LOG_DIR"

# Resolve python: use backend/.venv if present, otherwise system python3
if [ -x "$BACKEND/.venv/bin/python" ]; then
    PYTHON="$BACKEND/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="python3"
else
    PYTHON="python"
fi

export PYTHONPATH="$BACKEND"
export DATABASE_URL="${DATABASE_URL:-sqlite:///${BACKEND}/mlb_market_value.db}"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== Nightly refresh starting (season $SEASON) at $(date) ==="

echo ">>> python -m app.pipeline.run_ingest --season $SEASON"
(cd "$BACKEND" && "$PYTHON" -m app.pipeline.run_ingest --season "$SEASON")

echo ">>> python -m app.pipeline.run_compute_value --season $SEASON"
(cd "$BACKEND" && "$PYTHON" -m app.pipeline.run_compute_value --season "$SEASON")

echo "=== Nightly refresh completed successfully at $(date) ==="

# Prune older logs, keep the last 30
if [ -d "$LOG_DIR" ]; then
    ls -1t "$LOG_DIR"/refresh_*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
fi
