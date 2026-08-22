"""Container entrypoint: migrations + conditional ingest + compute, then boot
the API.

This is what the api container runs on startup (see docker-compose.yml). It
replaces the old two-line `alembic upgrade head && uvicorn ...` command, which
left the dashboard and API pointing at an empty database.

Flow:
  1. alembic upgrade head            (idempotent; schema already applied -> no-op)
  2. ingest current season (with salaries)     -- skipped if already present
  3. ingest prior N seasons (skip-salary)      -- projection history; skipped if present
  4. compute player_value + team_payroll_summary for each ingested season
  5. build the offline dashboard (build_dashboard.py + splice_dashboard.py)
  6. exec uvicorn (the running server)

The dashboard is a self-contained offline HTML file (data spliced in at build
time by splice_dashboard.py) served at /; build_dashboard.py also queries the
DB fresh, so no live-fetch or build step is needed at request time. Container
restarts are fast because every step is idempotent and guarded by a cheap
"is this season already in the DB?" check.

Usage:
  python -m app.pipeline.run_all [--season 2026] [--history-seasons 3] [--migrate-only]
"""

import argparse
import os
import subprocess
import sys
from datetime import date

from pathlib import Path

from sqlalchemy import text

from app.db import engine

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # /app/backend
DASHBOARD_DIR = BACKEND_DIR.parent / "frontend" / "dashboard"


def run_dashboard_build(season: int) -> None:
    """Regenerates the served dashboard file (dashboard_final.html) from the
    freshly computed DB: build_dashboard.py writes dashboard_data.json,
    splice_dashboard.py bakes it into the single-file HTML. Both scripts live
    in frontend/dashboard/ and import the backend via PYTHONPATH."""
    for script, args in (("build_dashboard.py", [str(season)]), ("splice_dashboard.py", [])):
        print(f"==> python {script} {' '.join(args)}")
        result = subprocess.run(
            [sys.executable, str(DASHBOARD_DIR / script), *args],
            cwd=BACKEND_DIR,
            env={**os.environ, "PYTHONPATH": str(BACKEND_DIR)},
        )
        if result.returncode != 0:
            raise SystemExit(f"{script} failed with exit code {result.returncode}")


def run_migrations() -> None:
    """Apply alembic migrations (idempotent). Reads DATABASE_URL from env via
    app.db, same as alembic/env.py.

    Runs `python -m alembic` rather than the `alembic` console script so it
    works regardless of activation state / PATH (a venv invoked directly won't
    have its bin/ on PATH; the console script needs the venv active)."""
    print("==> running alembic upgrade head")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "PYTHONPATH": str(BACKEND_DIR)},
    )
    if result.returncode != 0:
        raise SystemExit(f"alembic upgrade head failed with exit code {result.returncode}")


def season_already_ingested(season: int) -> bool:
    """Cheap existence check so restarts don't re-fetch a full season from the
    network. A season counts as ingested if it has player_seasons rows."""
    with engine.connect() as conn:
        count = conn.execute(
            text("SELECT COUNT(*) FROM player_seasons WHERE season = :season"),
            {"season": season},
        ).scalar_one()
    return count > 0


def run_pipeline_step(module: str, *args: str) -> None:
    """Runs a pipeline module as a subprocess so it behaves exactly like the
    documented manual commands (`python -m app.pipeline.run_ingest ...`)."""
    print(f"==> python -m app.pipeline.{module} {' '.join(args)}")
    result = subprocess.run(
        [sys.executable, "-m", f"app.pipeline.{module}", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, "PYTHONPATH": str(BACKEND_DIR)},
    )
    if result.returncode != 0:
        raise SystemExit(f"app.pipeline.{module} failed with exit code {result.returncode}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=date.today().year,
                        help="Primary season to ingest with salaries (default: current year)")
    parser.add_argument("--history-seasons", type=int, default=0,
                        help="Number of prior seasons to backfill (skip-salary) for projection history. "
                             "Default 0: the Statcast pitch-by-pitch backfill of prior seasons is memory-hungry "
                             "and OOM-kills the container on hosts with limited RAM; pass e.g. --history-seasons 3 "
                             "on a machine with headroom. (The current season's projection history is computed from "
                             "the stats already present, so a 0 history is fine for a single-season dashboard.)")
    parser.add_argument("--migrate-only", action="store_true",
                        help="Run migrations and exit without ingesting or booting the server (for init jobs)")
    args = parser.parse_args()

    run_migrations()
    if args.migrate_only:
        print("migrate-only: schema is up to date")
        return

    # Ingestion order matters: the current season (with salaries) first, then
    # older seasons (skip-salary) so RosterResource's current-roster scrape is
    # never pointed at a past season.
    seasons = [args.season] + list(range(args.season - 1, args.season - args.history_seasons - 1, -1))
    for season in seasons:
        if season_already_ingested(season):
            print(f"[{season}] already ingested, skipping")
            continue
        include_salary = season == args.season
        print(f"[{season}] ingesting (salary={include_salary})...")
        run_pipeline_step("run_ingest", "--season", str(season), *(["--skip-salary"] if not include_salary else []))

    # Compute player values + payroll for every season that has data (not just
    # newly-ingested ones), so the dashboard/API are fully populated even if a
    # previous run left compute half-done.
    for season in seasons:
        run_pipeline_step("run_compute_value", "--season", str(season))

    # Build the served dashboard from the fresh DB.
    run_dashboard_build(args.season)

    # Boot the API (same as the original container CMD).
    print("==> starting uvicorn")
    os.execv(
        sys.executable,
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
    )


if __name__ == "__main__":
    main()
