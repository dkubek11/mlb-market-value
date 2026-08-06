"""One-off backfill: scrape real historical arbitration settlement outcomes
(service time + actual salary) from MLB Trade Rumors' yearly tracker posts,
for the multi-year arb comp pool. Tracker year Y lists salaries decided on
year Y-1 performance (the "platform season").

Usage: py backfill_arb_outcomes.py
"""

import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from app.db import engine
from app.pipeline import mlbtr_arbitration

TRACKER_YEARS = [2023, 2024, 2025]

INSERT = text("""
    INSERT INTO arb_outcomes (player_id, platform_season, service_time, actual_salary, source, scraped_at)
    VALUES (:player_id, :platform_season, :service_time, :actual_salary, :source, :scraped_at)
    ON CONFLICT (player_id, platform_season) DO UPDATE SET
        service_time = EXCLUDED.service_time,
        actual_salary = EXCLUDED.actual_salary,
        scraped_at = EXCLUDED.scraped_at
""")


def _normalize_name(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z\s]", "", ascii_name.lower())).strip()


with engine.begin() as conn:
    all_players = conn.execute(text("SELECT player_id, full_name FROM players")).all()
    by_normalized = {_normalize_name(name): pid for pid, name in all_players}

    now = datetime.now(timezone.utc)
    total_inserted = 0
    for tracker_year in TRACKER_YEARS:
        platform_season = tracker_year - 1
        print(f"[tracker {tracker_year}] fetching (platform season {platform_season})...")
        outcomes = mlbtr_arbitration.fetch_historical_outcomes(tracker_year)

        matched = 0
        no_salary = 0
        unmatched_names = []
        for entry in outcomes:
            if entry["salary"] is None:
                no_salary += 1
                continue
            pid = by_normalized.get(_normalize_name(entry["name"]))
            if pid is None:
                unmatched_names.append(entry["name"])
                continue
            conn.execute(INSERT, {
                "player_id": pid,
                "platform_season": platform_season,
                "service_time": Decimal(str(entry["service_time"])),
                "actual_salary": Decimal(str(entry["salary"])),
                "source": "mlbtr",
                "scraped_at": now,
            })
            matched += 1

        total_inserted += matched
        print(f"  total entries: {len(outcomes)}, no resolved salary: {no_salary}, "
              f"matched+inserted: {matched}, unmatched names: {len(unmatched_names)}")
        if unmatched_names:
            print(f"  (unmatched: {', '.join(unmatched_names[:10])}"
                  f"{'...' if len(unmatched_names) > 10 else ''})")

print(f"done. total rows inserted/updated: {total_inserted}")
