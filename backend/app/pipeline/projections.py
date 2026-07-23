"""Marcel-style true-talent projections.

"Marcel the Monkey" (Tom Tango) is the standard baseline projection method in
sabermetrics: a weighted average of the last three seasons, regressed toward
the league average based on playing time, with a small age adjustment. It's
deliberately simple -- not a machine-learning model -- but it's a real,
well-established statistical technique and a stronger baseline than most
ad-hoc projections.

This uses each player's *expected*/process stats (xBA, xwOBA, barrel rate,
chase rate, etc.) as the historical input rather than raw outcome stats,
since process stats already strip out most batted-ball luck -- so the
resulting projection is a true-talent estimate, not a luck-weighted one.
Comparing a projection to a player's *actual* current-season outcome stat
(done elsewhere, in the dashboard) is what surfaces over/underperformance.

Every stat here gets the same treatment -- weighted 3-year history, regressed
to the league mean by an amount roughly matched to how fast that stat's
signal stabilizes (drawn from published stabilization-point research, not
precisely fit), with a small age adjustment. Regression constants are
reasonable estimates, not empirically calibrated to this dataset.
"""

from datetime import date

import pandas as pd
from sqlalchemy import text

from app.db import engine

# Most-recent-to-oldest weights for the last 3 completed seasons.
MARCEL_WEIGHTS = [5, 4, 3]

PEAK_AGE = 29
AGE_ADJUSTMENT_PER_YEAR = 0.003  # ~0.3% per year away from peak

# stat_key -> (regression constant in PA/IP-equivalent league-average
# performance, higher_is_better). Roughly ordered fastest- to slowest-
# stabilizing within each group.
BATTER_PROJECTION_STATS = {
    "k_rate": (60, False),
    "sprint_speed": (50, True),
    "whiff_rate": (100, False),
    "chase_rate": (100, False),
    "bb_rate": (120, True),
    "hard_hit_rate": (150, True),
    "barrel_rate": (200, True),
    "xwoba": (250, True),
    "xslg": (300, True),
    "xba": (400, True),
}
PITCHER_PROJECTION_STATS = {
    "k_rate": (40, True),
    "chase_rate": (50, True),
    "whiff_rate": (50, True),
    "z_swing_rate": (50, False),
    "hard_hit_rate_against": (60, False),
    "barrel_rate_against": (60, False),
    "bb_rate": (60, False),
    "avg_exit_velo_against": (60, False),
    "xera": (70, False),
    "xba_against": (70, False),
}

_BATTER_HISTORY_QUERY = text(
    """
    SELECT bs.player_id, bs.season, bs.pa, p.birthdate,
           bs.xba, bs.xwoba, bs.xslg, bs.barrel_rate, bs.hard_hit_rate,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate, bs.sprint_speed
    FROM batter_stats bs
    JOIN players p ON p.player_id = bs.player_id
    WHERE bs.season BETWEEN :start_season AND :end_season
    """
)

_PITCHER_HISTORY_QUERY = text(
    """
    SELECT ps.player_id, ps.season, ps.ip, p.birthdate,
           ps.xera, ps.xba_against, ps.avg_exit_velo_against, ps.hard_hit_rate_against,
           ps.barrel_rate_against, ps.chase_rate, ps.whiff_rate, ps.k_rate, ps.bb_rate, ps.z_swing_rate
    FROM pitcher_stats ps
    JOIN players p ON p.player_id = ps.player_id
    WHERE ps.season BETWEEN :start_season AND :end_season
    """
)


def _league_avg_by_season(df: pd.DataFrame, value_col: str, weight_col: str) -> dict[int, float]:
    out = {}
    for season, grp in df.groupby("season"):
        w = grp[weight_col].astype(float)
        v = grp[value_col].astype(float)
        mask = v.notna() & (w > 0)
        out[int(season)] = float((v[mask] * w[mask]).sum() / w[mask].sum()) if mask.any() else None
    return out


def _age_as_of(birthdate: date | None, season: int) -> float | None:
    if birthdate is None:
        return None
    ref = date(season, 7, 1)
    years = ref.year - birthdate.year
    if (ref.month, ref.day) < (birthdate.month, birthdate.day):
        years -= 1
    return float(years)


def _weighted_regressed_projection(
    rows: list[dict], value_col: str, weight_col: str, league_avg: float | None, regression_pt: float
) -> float | None:
    if league_avg is None:
        return None
    weighted_pt = 0.0
    weighted_sum = 0.0
    for weight, row in zip(MARCEL_WEIGHTS, rows):
        pt = row.get(weight_col) or 0
        val = row.get(value_col)
        if val is None or pt <= 0:
            continue
        weighted_pt += weight * float(pt)
        weighted_sum += weight * float(pt) * float(val)
    if weighted_pt == 0:
        return league_avg
    return (weighted_sum + regression_pt * league_avg) / (weighted_pt + regression_pt)


def _apply_age_adjustment(value: float, age: float | None, higher_is_better: bool) -> float:
    if age is None:
        return value
    years_from_peak = PEAK_AGE - age
    sign = 1 if higher_is_better else -1
    factor = 1 + sign * AGE_ADJUSTMENT_PER_YEAR * years_from_peak
    return value * factor


def _compute_projections(
    history_query, season: int, weight_col: str, stat_defs: dict[str, tuple[float, bool]]
) -> dict[int, dict]:
    start, end = season - 3, season - 1
    df = pd.read_sql(history_query, engine, params={"start_season": start, "end_season": end})
    if df.empty:
        return {}

    league_avgs = {stat: _league_avg_by_season(df, stat, weight_col) for stat in stat_defs}
    anchor_avgs = {stat: league_avgs[stat].get(end) for stat in stat_defs}

    results: dict[int, dict] = {}
    for pid, grp in df.groupby("player_id"):
        grp = grp.sort_values("season", ascending=False)
        rows = grp.to_dict("records")[:3]
        age = _age_as_of(rows[0]["birthdate"], season)

        projected = {}
        for stat, (regression_pt, higher_is_better) in stat_defs.items():
            val = _weighted_regressed_projection(rows, stat, weight_col, anchor_avgs[stat], regression_pt)
            if val is not None:
                val = _apply_age_adjustment(val, age, higher_is_better)
                val = round(val, 5)
            projected[stat] = val
        projected["age"] = age
        results[int(pid)] = projected
    return results


def compute_batter_projections(current_season: int) -> dict[int, dict]:
    """Returns {player_id: {age, xba, xwoba, xslg, barrel_rate, hard_hit_rate,
    chase_rate, whiff_rate, k_rate, bb_rate, sprint_speed}} projected from the
    3 seasons preceding current_season. Players with no history at all project
    to league average (fully regressed); players with partial history use
    whatever seasons they have."""
    return _compute_projections(_BATTER_HISTORY_QUERY, current_season, "pa", BATTER_PROJECTION_STATS)


def compute_pitcher_projections(current_season: int) -> dict[int, dict]:
    """Returns {player_id: {age, xera, xba_against, avg_exit_velo_against,
    hard_hit_rate_against, barrel_rate_against, chase_rate, whiff_rate,
    k_rate, bb_rate, z_swing_rate}} projected from the 3 seasons preceding
    current_season."""
    return _compute_projections(_PITCHER_HISTORY_QUERY, current_season, "ip", PITCHER_PROJECTION_STATS)


# Weight given to the comp-based (nearest-neighbor) projection vs. the Marcel
# regression projection when both are available for a player.
COMP_BLEND_WEIGHT = 0.5


def blend_projections(
    marcel: dict[int, dict], comps: dict[int, dict], stat_cols: list[str]
) -> dict[int, dict]:
    """Combines the two independent signals into one final projection per
    player: Marcel (self-regression) and comp-based (what similar historical
    players at the same age/level actually did next). When a player has no
    usable comps (e.g. no position peers at their exact career stage), this
    falls back to the Marcel projection alone rather than dropping the stat."""
    blended: dict[int, dict] = {}
    for pid, marcel_row in marcel.items():
        comp_row = comps.get(pid)
        out = {"age": marcel_row.get("age"), "nComps": comp_row.get("n_comps") if comp_row else 0}
        for stat in stat_cols:
            m_val = marcel_row.get(stat)
            c_val = comp_row.get(stat) if comp_row else None
            if m_val is not None and c_val is not None:
                out[stat] = round((1 - COMP_BLEND_WEIGHT) * m_val + COMP_BLEND_WEIGHT * c_val, 5)
            elif m_val is not None:
                out[stat] = m_val
            else:
                out[stat] = c_val
        blended[pid] = out
    return blended
