"""Pytest fixtures for MLB Market Value test suite.

Provides dynamic, time-invariant fixtures so tests execute reliably for any
target season (including present season and future seasons such as 2030).
"""

import os
from pathlib import Path

# Ensure DATABASE_URL is set before importing app.db
_sqlite_path = (Path(__file__).resolve().parent.parent / "mlb_market_value.db").as_posix()
if "DATABASE_URL" not in os.environ or "localhost:5432" in os.environ.get("DATABASE_URL", ""):
    os.environ["DATABASE_URL"] = f"sqlite:///{_sqlite_path}"

import datetime
import pytest
from sqlalchemy import text
from app.db import engine as _default_engine
from build_dashboard import build_dashboard_data


@pytest.fixture(scope="session")
def db_engine():
    """Shared database engine."""
    return _default_engine


@pytest.fixture(scope="session")
def present_season(db_engine) -> int:
    """Dynamically determine the active present season from the database.
    
    If the database contains records up to 2030, this returns 2030.
    Falls back to current calendar year if no salary records exist.
    """
    with db_engine.connect() as conn:
        res = conn.execute(text("SELECT MAX(season) FROM player_salaries")).scalar()
    if res is not None and int(res) > 0:
        return int(res)
    return datetime.date.today().year


@pytest.fixture(scope="session")
def top_50_aav_db_records(present_season, db_engine) -> list[dict]:
    """Query the top 50 highest AAV player rows directly from the raw database."""
    query = text("""
        SELECT p.player_id, p.full_name, t.abbreviation AS team, ps.position,
               s.aav, s.salary, s.contract_type
        FROM player_salaries s
        JOIN players p ON p.player_id = s.player_id
        JOIN teams t ON t.team_id = s.team_id
        LEFT JOIN player_seasons ps ON ps.player_id = s.player_id AND ps.season = s.season
        WHERE s.season = :season AND s.aav IS NOT NULL
        ORDER BY s.aav DESC, s.salary DESC
        LIMIT 50
    """)
    with db_engine.connect() as conn:
        rows = conn.execute(query, {"season": present_season}).mappings().all()
    return [dict(r) for r in rows]


@pytest.fixture(scope="session")
def dashboard_snapshot(present_season) -> dict:
    """Compute and cache the full dashboard snapshot for the present season."""
    return build_dashboard_data(present_season)


@pytest.fixture(scope="session")
def contracts_dict(dashboard_snapshot) -> dict:
    """Return contracts mapping from dashboard snapshot."""
    return dashboard_snapshot.get("contracts", {})


@pytest.fixture(scope="session")
def position_stats(dashboard_snapshot) -> dict:
    """Return position statistics baseline."""
    return dashboard_snapshot.get("positionStats", {})


@pytest.fixture(scope="session")
def position_stats_history(dashboard_snapshot) -> dict:
    """Return multi-year historical position statistics."""
    return dashboard_snapshot.get("positionStatsHistory", {})


@pytest.fixture(scope="session")
def top_50_aav_players(dashboard_snapshot) -> list[dict]:
    """Extract top 50 players by AAV from the assembled allPlayers payload.
    
    Ties broken by current-season salary, then player ID.
    """
    all_players = dashboard_snapshot.get("allPlayers", [])
    assert len(all_players) >= 50, f"Expected at least 50 qualified players, found {len(all_players)}"
    
    # Sort descending by AAV, then salary
    sorted_players = sorted(
        all_players,
        key=lambda p: (float(p.get("aav") or 0), float(p.get("salary") or 0), int(p.get("id") or 0)),
        reverse=True,
    )
    return sorted_players[:50]
