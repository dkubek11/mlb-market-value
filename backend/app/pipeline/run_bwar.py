"""Backfill/refresh Baseball-Reference WAR onto batter_stats/pitcher_stats.

Usage: python -m app.pipeline.run_bwar [--first-season 2015] [--last-season 2026]
Safe to re-run any time (e.g. in-season, as bWAR updates daily)."""

import argparse
from datetime import date

from app.db import SessionLocal
from app.pipeline import bwar

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--first-season", type=int, default=2015)
    parser.add_argument("--last-season", type=int, default=date.today().year)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        for season in range(args.first_season, args.last_season + 1):
            n_bat, n_pit = bwar.backfill_season(db, season)
            print(f"[{season}] bWAR written: {n_bat} batter rows, {n_pit} pitcher rows")
    finally:
        db.close()
