"""One-off backfill: scrape real historical arbitration settlement outcomes
(service time + actual salary) from MLB Trade Rumors, for the multi-year arb
comp pool and the year-over-year raise-pct comp. Two sources, each keyed
directly by PLATFORM SEASON (the year the salary was decided on):
  - the transactions-widget table (clean HTML, real settled amounts),
    populated for roughly 2011-2021
  - the yearly tracker blog posts (prose, needs $-parsing), populated for
    2022 onward
2020 is skipped deliberately -- the 60-game COVID season badly distorts any
rate/counting-stat comp, and its real-world arb cases were themselves
governed by ad hoc rules, not the normal CBA process.

Usage: py backfill_arb_outcomes.py
"""

import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import text

from app.db import engine
from app.pipeline import mlbtr_arbitration

WIDGET_PLATFORM_SEASONS = [2016, 2017, 2018, 2019, 2021]
# tracker_year = platform_season + 1 for this source (see mlbtr_arbitration.py)
TRACKER_YEARS = [2023, 2024, 2025, 2026]

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


def _process(conn, outcomes, platform_season, by_normalized, now):
    matched = no_salary = 0
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
    print(f"  total entries: {len(outcomes)}, no resolved salary: {no_salary}, "
          f"matched+inserted: {matched}, unmatched names: {len(unmatched_names)}")
    if unmatched_names:
        print(f"  (unmatched: {', '.join(unmatched_names[:10])}"
              f"{'...' if len(unmatched_names) > 10 else ''})")
    return matched


with engine.begin() as conn:
    all_players = conn.execute(text("SELECT player_id, full_name FROM players")).all()
    by_normalized = {_normalize_name(name): pid for pid, name in all_players}

    now = datetime.now(timezone.utc)
    total_inserted = 0

    for platform_season in WIDGET_PLATFORM_SEASONS:
        print(f"[widget, platform season {platform_season}] fetching...")
        outcomes = mlbtr_arbitration.fetch_widget_outcomes(platform_season)
        total_inserted += _process(conn, outcomes, platform_season, by_normalized, now)

    for tracker_year in TRACKER_YEARS:
        platform_season = tracker_year - 1
        print(f"[tracker {tracker_year}, platform season {platform_season}] fetching...")
        outcomes = mlbtr_arbitration.fetch_historical_outcomes(tracker_year)
        total_inserted += _process(conn, outcomes, platform_season, by_normalized, now)

print(f"done. total rows inserted/updated: {total_inserted}")
