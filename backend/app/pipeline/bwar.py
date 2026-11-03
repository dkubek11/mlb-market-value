"""Baseball-Reference WAR (bWAR), pulled from Baseball-Reference's public
daily WAR files via pybaseball and keyed by MLBAM id (the same player_id the
rest of the schema uses).

bWAR is what the dashboard's Score ranks on: it's cumulative (so playing time
counts), position- and park-adjusted, and the pitcher version is built on runs
allowed rather than FIP. Players traded mid-season appear once per stint, so
each season's value is the sum across stints. Two-way players get their
batting WAR from the batting file and their pitching WAR from the pitching
file, so neither side double counts the other.
"""

from decimal import Decimal

import pandas as pd
from pybaseball import bwar_bat, bwar_pitch
from sqlalchemy import text
from sqlalchemy.orm import Session

_cache: dict[str, pd.DataFrame] = {}


def _load() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Both files download the full multi-decade history, so fetch once per process."""
    if not _cache:
        _cache["bat"] = bwar_bat(return_all=True)
        _cache["pit"] = bwar_pitch(return_all=True)
    return _cache["bat"], _cache["pit"]


def _sum_by_player(df: pd.DataFrame, season: int) -> dict[int, Decimal]:
    d = df[(df["year_ID"] == season) & df["mlb_ID"].notna() & df["WAR"].notna()]
    sums = d.groupby(d["mlb_ID"].astype(int))["WAR"].sum()
    return {int(pid): Decimal(str(round(float(war), 2))) for pid, war in sums.items()}


def fetch_season(season: int) -> dict[str, dict[int, Decimal]]:
    """{'bat': {player_id: bWAR}, 'pit': {player_id: bWAR}} for one season."""
    bat, pit = _load()
    return {"bat": _sum_by_player(bat, season), "pit": _sum_by_player(pit, season)}


def backfill_season(db: Session, season: int) -> tuple[int, int]:
    """Write bWAR onto existing batter_stats/pitcher_stats rows for a season.
    Returns (batter rows updated, pitcher rows updated)."""
    data = fetch_season(season)
    n_bat = n_pit = 0
    for table, key in (("batter_stats", "bat"), ("pitcher_stats", "pit")):
        rows = [{"pid": pid, "season": season, "w": float(w)} for pid, w in data[key].items()]
        if not rows:
            continue
        result = db.execute(
            text(f"UPDATE {table} SET bwar = :w WHERE player_id = :pid AND season = :season"), rows
        )
        if key == "bat":
            n_bat = result.rowcount
        else:
            n_pit = result.rowcount
    db.commit()
    return n_bat, n_pit
