"""Backtests the projection engine (Marcel + comp-based blend, see
projections.py/comp_projections.py) against real historical outcomes --
something this project built and tuned by feel, but never actually checked
for predictive accuracy.

For each target season Y, this calls the exact same production functions
(compute_batter_projections(Y), etc.) the live dashboard uses, which only
look at data from Y-3..Y-1 -- then compares the resulting projection against
what actually happened in season Y, and against a naive baseline (just the
player's raw Y-1 value, no regression/blend/aging) to see whether the
projection system adds real predictive value or is just an elaborate way of
restating last year's number.

Usage: py backtest_projections.py
"""

import sys
from collections import defaultdict

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.db import engine
from app.pipeline.projections import (
    compute_batter_projections, compute_pitcher_projections,
    BATTER_PROJECTION_STATS, PITCHER_PROJECTION_STATS, blend_projections,
)
from app.pipeline.comp_projections import compute_batter_comp_projections, compute_pitcher_comp_projections

# 2018 is the earliest target with a full 3-season (2015-2017) input window
# in our data; 2026 is the current in-progress season, not yet a real target.
TARGET_SEASONS = list(range(2018, 2026))
MIN_BATTER_PA = 150
MIN_PITCHER_IP = 20  # looser than the dashboard's own 25/50 split -- more data points, still excludes cameos

BATTER_STATS = list(BATTER_PROJECTION_STATS.keys())
PITCHER_STATS = list(PITCHER_PROJECTION_STATS.keys())

ACTUAL_BATTER_Q = text(f"""
    SELECT player_id, season, pa, {", ".join(BATTER_STATS)}
    FROM batter_stats WHERE season = :season
""")
ACTUAL_PITCHER_Q = text(f"""
    SELECT player_id, season, ip, {", ".join(PITCHER_STATS)}
    FROM pitcher_stats WHERE season = :season
""")


def _corr_and_mae(projected: pd.Series, actual: pd.Series) -> tuple[float | None, float | None, int]:
    mask = projected.notna() & actual.notna()
    n = int(mask.sum())
    if n < 10:
        return None, None, n
    p, a = projected[mask].astype(float), actual[mask].astype(float)
    corr = float(np.corrcoef(p, a)[0, 1]) if p.std() > 0 and a.std() > 0 else None
    mae = float((p - a).abs().mean())
    return corr, mae, n


def _run(kind: str, stats: list[str], min_playing_time_col: str, min_playing_time: float,
          compute_marcel, compute_comp, actual_query):
    print(f"\n{'='*70}\n{kind.upper()} PROJECTIONS\n{'='*70}")

    # {stat: [(projected, naive, actual), ...]} pooled across every target season
    pooled = defaultdict(list)
    per_season_rows = []

    for season in TARGET_SEASONS:
        marcel = compute_marcel(season)
        comp = compute_comp(season)
        blended = blend_projections(marcel, comp, stats)

        prior = pd.read_sql(actual_query, engine, params={"season": season - 1}).set_index("player_id")
        actual = pd.read_sql(actual_query, engine, params={"season": season})
        actual = actual[actual[min_playing_time_col] >= min_playing_time].set_index("player_id")

        for pid, row in actual.iterrows():
            proj_row = blended.get(pid)
            if proj_row is None:
                continue
            naive_row = prior.loc[pid] if pid in prior.index else None
            for stat in stats:
                proj_val = proj_row.get(stat)
                actual_val = row.get(stat)
                naive_val = naive_row[stat] if naive_row is not None else None
                if proj_val is not None and actual_val is not None:
                    pooled[stat].append((proj_val, naive_val, actual_val, season))

    for stat in stats:
        rows = pooled[stat]
        if not rows:
            continue
        df = pd.DataFrame(rows, columns=["projected", "naive", "actual", "season"])
        proj_corr, proj_mae, n = _corr_and_mae(df["projected"], df["actual"])
        naive_corr, naive_mae, _ = _corr_and_mae(df["naive"], df["actual"])
        higher_is_better = BATTER_PROJECTION_STATS.get(stat, PITCHER_PROJECTION_STATS.get(stat))
        higher_is_better = higher_is_better[1] if higher_is_better else True
        beat_naive = (proj_corr is not None and naive_corr is not None and proj_corr > naive_corr)
        print(f"\n{stat} (n={n}, higher_is_better={higher_is_better}):")
        print(f"  projection  -> corr={proj_corr:.3f} MAE={proj_mae:.4f}" if proj_corr is not None else "  projection  -> insufficient data")
        print(f"  naive (Y-1) -> corr={naive_corr:.3f} MAE={naive_mae:.4f}" if naive_corr is not None else "  naive (Y-1) -> insufficient data")
        if proj_corr is not None and naive_corr is not None:
            print(f"  {'BEATS' if beat_naive else 'DOES NOT BEAT'} naive carryover by {proj_corr - naive_corr:+.3f} correlation")
        per_season_rows.append({"kind": kind, "stat": stat, "n": n, "proj_corr": proj_corr, "naive_corr": naive_corr})

    return per_season_rows


all_rows = []
all_rows += _run("batter", BATTER_STATS, "pa", MIN_BATTER_PA,
                  compute_batter_projections, compute_batter_comp_projections, ACTUAL_BATTER_Q)
all_rows += _run("pitcher", PITCHER_STATS, "ip", MIN_PITCHER_IP,
                  compute_pitcher_projections, compute_pitcher_comp_projections, ACTUAL_PITCHER_Q)

print(f"\n{'='*70}\nSUMMARY\n{'='*70}")
summary = pd.DataFrame(all_rows)
summary_valid = summary.dropna(subset=["proj_corr", "naive_corr"])
beats = (summary_valid["proj_corr"] > summary_valid["naive_corr"]).sum()
print(f"Projection beats naive Y-1 carryover on {beats}/{len(summary_valid)} stats.")
print(f"Mean projection correlation: {summary_valid['proj_corr'].mean():.3f}")
print(f"Mean naive correlation:      {summary_valid['naive_corr'].mean():.3f}")
print(f"\nTarget seasons tested: {TARGET_SEASONS[0]}-{TARGET_SEASONS[-1]} (each using only data from the 3 seasons before it, exactly like the live dashboard)")

summary.to_csv("backtest_results.csv", index=False)
print("\nwrote backend/backtest_results.csv")
