"""Nearest-neighbor "comparable player" projections.

Complements the Marcel-style regression in projections.py with a genuinely
different signal: instead of only regressing a player's own history toward
the mean, find historical players (2015-2024) who were at a similar age with
a similar recent performance level and short-term trend across the same stat
set, then look at what THOSE players actually did the following season. This
is a simplified version of the idea behind PECOTA's comparable-player
projections.

Comp search happens on position-and-season-relative z-scores (so a .280 xBA
catcher and a .280 xBA shortstop aren't treated as "the same" just because
the raw number matches -- what matters is how each did relative to their own
position that year). A fingerprint recency-weights the last two seasons
(2x most recent, 1x the one before) so it captures level *and* direction of
travel, not just a single-season snapshot.
"""

import numpy as np
import pandas as pd
from sqlalchemy import text

from app.db import engine
from app.pipeline.projections import BATTER_PROJECTION_STATS, PITCHER_PROJECTION_STATS, _age_as_of

POS_MAP = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}

# Same spirit as the dashboard's composite scoring weights: how much each stat
# should count when judging two players "similar."
BATTER_SIMILARITY_WEIGHTS = {
    "xwoba": 3.0, "xslg": 1.5, "xba": 1.0, "barrel_rate": 1.5, "hard_hit_rate": 1.0,
    "chase_rate": 1.0, "whiff_rate": 1.0, "k_rate": 1.0, "bb_rate": 1.0, "sprint_speed": 0.5,
}
PITCHER_SIMILARITY_WEIGHTS = {
    "xera": 2.5, "xba_against": 1.0, "avg_exit_velo_against": 0.8, "hard_hit_rate_against": 1.0,
    "barrel_rate_against": 1.2, "k_rate": 1.5, "bb_rate": 1.0, "chase_rate": 1.0, "whiff_rate": 1.0,
    "z_swing_rate": 0.5,
}

K_COMPS = 20
MAX_AGE_DIFF = 1.5
LAST_COMP_ANCHOR_SEASON = 2024  # needs a known "next season" (2025) to be usable as a comp

_BATTER_ALL_SEASONS_QUERY = text(
    """
    SELECT bs.player_id, bs.season, bs.pa, ps.position, p.birthdate,
           bs.xba, bs.xwoba, bs.xslg, bs.barrel_rate, bs.hard_hit_rate,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate, bs.sprint_speed
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    WHERE bs.season BETWEEN :start_season AND :end_season AND bs.pa >= 50
    """
)
_PITCHER_ALL_SEASONS_QUERY = text(
    """
    SELECT ps_s.player_id, ps_s.season, ps_s.ip, ps.position, p.birthdate,
           ps_s.xera, ps_s.xba_against, ps_s.avg_exit_velo_against, ps_s.hard_hit_rate_against,
           ps_s.barrel_rate_against, ps_s.chase_rate, ps_s.whiff_rate, ps_s.k_rate, ps_s.bb_rate,
           ps_s.z_swing_rate
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    WHERE ps_s.season BETWEEN :start_season AND :end_season AND ps_s.ip >= 15
    """
)


def _zscore_within_group(df: pd.DataFrame, stat_cols: list[str], group_cols: list[str]) -> pd.DataFrame:
    def z(group):
        out = group.copy()
        for stat in stat_cols:
            mean, std = group[stat].mean(), group[stat].std()
            out[stat] = (group[stat] - mean) / std if std and std > 0 else np.nan
        return out

    return df.groupby(group_cols, group_keys=False).apply(z)


def _build_fingerprints(zdf: pd.DataFrame, stat_cols: list[str]) -> pd.DataFrame:
    """One row per (player_id, season): a recency-weighted (2x most recent
    season, 1x the season before, when both exist) z-score per stat, plus age
    and position. This is the "career arc so far" snapshot used for comp
    search -- weighting recent seasons harder captures direction of travel
    without needing a separate trend dimension."""
    fingerprints = []
    for pid, grp in zdf.sort_values("season").groupby("player_id"):
        grp = grp.reset_index(drop=True)
        for i in range(len(grp)):
            row = grp.iloc[i]
            prev = grp.iloc[i - 1] if i > 0 and grp.iloc[i - 1]["season"] == row["season"] - 1 else None
            fp = {
                "player_id": pid,
                "season": int(row["season"]),
                "position": row["position"],
                "age": row["age"],
            }
            for stat in stat_cols:
                z_recent = row[stat]
                if prev is not None and pd.notna(prev[stat]) and pd.notna(z_recent):
                    fp[stat] = (2 * z_recent + prev[stat]) / 3
                else:
                    fp[stat] = z_recent
            fingerprints.append(fp)
    return pd.DataFrame(fingerprints)


def _next_season_lookup(raw_df: pd.DataFrame, stat_cols: list[str]) -> pd.DataFrame:
    """player_id/prev_season -> that player's actual stats the season after
    prev_season, for pulling "what the comp really did next.\""""
    nxt = raw_df[["player_id", "season", *stat_cols]].copy()
    nxt = nxt.rename(columns={c: f"{c}_next" for c in stat_cols})
    nxt["prev_season"] = nxt["season"] - 1
    return nxt.drop(columns=["season"])


def _project_one(
    target_row: pd.Series,
    fingerprints: pd.DataFrame,
    next_lookup: pd.DataFrame,
    stat_cols: list[str],
    weights: dict[str, float],
) -> dict | None:
    if target_row is None or pd.isna(target_row.get("age")):
        return None

    pool = fingerprints[
        (fingerprints["position"] == target_row["position"])
        & fingerprints["age"].notna()
        & ((fingerprints["age"] - target_row["age"]).abs() <= MAX_AGE_DIFF)
        & (fingerprints["season"] <= LAST_COMP_ANCHOR_SEASON)
        & (fingerprints["player_id"] != target_row["player_id"])
    ]
    if pool.empty:
        return None

    w = np.array([weights.get(s, 1.0) for s in stat_cols])
    target_vec = np.array([target_row.get(s, np.nan) for s in stat_cols], dtype=float)
    pool_vecs = pool[stat_cols].to_numpy(dtype=float)
    diffs = pool_vecs - target_vec
    # a stat missing on either side can't inform similarity there -- treat as
    # a moderate (2 SD) mismatch rather than silently ignoring or zeroing it.
    diffs = np.where(np.isnan(diffs), 2.0, diffs)
    dist = np.sqrt(((diffs**2) * w).sum(axis=1))

    pool = pool.assign(dist=dist).sort_values("dist").head(K_COMPS)
    joined = pool.merge(next_lookup, left_on=["player_id", "season"], right_on=["player_id", "prev_season"])
    if joined.empty:
        return None

    inv_dist = 1.0 / (joined["dist"].to_numpy() + 0.5)
    projected: dict = {}
    for stat in stat_cols:
        vals = joined[f"{stat}_next"].to_numpy(dtype=float)
        mask = ~np.isnan(vals)
        projected[stat] = float((vals[mask] * inv_dist[mask]).sum() / inv_dist[mask].sum()) if mask.any() else None
    projected["n_comps"] = int(len(joined))
    return projected


def _compute(all_seasons_query, current_season: int, stat_cols: list[str], weights: dict[str, float]) -> dict[int, dict]:
    df = pd.read_sql(all_seasons_query, engine, params={"start_season": 2015, "end_season": current_season - 1})
    if df.empty:
        return {}
    if "position" in df.columns:
        df["position"] = df["position"].map(lambda p: POS_MAP.get(p, p))
    df["age"] = df.apply(lambda r: _age_as_of(r["birthdate"], r["season"]), axis=1)

    zdf = _zscore_within_group(df, stat_cols, ["season", "position"])
    zdf["age"] = df["age"]
    zdf["position"] = df["position"]
    zdf["season"] = df["season"]
    zdf["player_id"] = df["player_id"]

    fingerprints = _build_fingerprints(zdf, stat_cols)
    next_lookup = _next_season_lookup(df, stat_cols)

    targets = fingerprints[fingerprints["season"] == current_season - 1]
    results: dict[int, dict] = {}
    for _, row in targets.iterrows():
        proj = _project_one(row, fingerprints, next_lookup, stat_cols, weights)
        if proj is not None:
            results[int(row["player_id"])] = proj
    return results


def compute_batter_comp_projections(current_season: int) -> dict[int, dict]:
    """Returns {player_id: {..stat: comp-based projection.., n_comps}} using
    each player's most recent completed season as the "as of" point."""
    stat_cols = list(BATTER_PROJECTION_STATS.keys())
    return _compute(_BATTER_ALL_SEASONS_QUERY, current_season, stat_cols, BATTER_SIMILARITY_WEIGHTS)


def compute_pitcher_comp_projections(current_season: int) -> dict[int, dict]:
    stat_cols = list(PITCHER_PROJECTION_STATS.keys())
    return _compute(_PITCHER_ALL_SEASONS_QUERY, current_season, stat_cols, PITCHER_SIMILARITY_WEIGHTS)
