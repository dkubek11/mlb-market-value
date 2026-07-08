from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.models import PlayerType, PlayerValue, Position, TeamPayrollSummary

# Minimum sample size to be included in a percentile ranking. Below this, a
# single lucky/unlucky stretch swings the rate stats too much to compare fairly.
MIN_BATTER_PA = 50
MIN_PITCHER_IP = 15

# Pre-arbitration (and minor-league) players are paid at or near the league
# minimum by CBA rule, almost regardless of performance -- so comparing their
# salary to their performance isn't a market-inefficiency signal, it just
# measures "is this player good." They're excluded from the salary comparison
# and given a projected market salary instead. Arbitration salaries do move
# with performance (via comp-based arbitration hearings), so they stay in.
# FanGraphs' ContractType values include prefixed variants like
# "Pre-Arbitration (Guaranteed Section)" (sometimes truncated at the source to
# "...Sect"), so this checks a prefix, not an exact match.
NON_MARKET_PREFIXES = ("Pre-Arbitration", "MiLB")


def _is_pre_arb(contract_type: str | None) -> bool:
    return contract_type is not None and contract_type.startswith(NON_MARKET_PREFIXES)


# Minimum number of comparable-performance market-priced peers required for a
# pre-arb player's salary projection (also the fallback threshold for whether a
# position has enough market comps on its own, vs. falling back to the whole
# batter/pitcher pool).
PROJECTION_COMPS = 10

_BATTER_QUERY = text(
    """
    SELECT bs.player_id, ps.position AS position, bs.xwoba, sal.salary, sal.aav, sal.contract_type
    FROM batter_stats bs
    JOIN player_seasons ps
        ON ps.player_id = bs.player_id AND ps.season = bs.season AND ps.player_type = 'BATTER'
    JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    WHERE bs.season = :season AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
    """
)

_PITCHER_QUERY = text(
    """
    SELECT ps_stats.player_id, ps.position AS position, ps_stats.fip, sal.salary, sal.aav, sal.contract_type
    FROM pitcher_stats ps_stats
    JOIN player_seasons ps
        ON ps.player_id = ps_stats.player_id AND ps.season = ps_stats.season AND ps.player_type = 'PITCHER'
    JOIN player_salaries sal ON sal.player_id = ps_stats.player_id AND sal.season = ps_stats.season
    WHERE ps_stats.season = :season AND ps_stats.ip >= :min_ip AND ps_stats.fip IS NOT NULL
    """
)

_TEAM_PAYROLL_QUERY = text(
    """
    -- player_value can have 2 rows per player (two-way players: batter + pitcher),
    -- so collapse to one value_score per player before joining, or SUM(salary)
    -- below would double-count them.
    WITH player_value_avg AS (
        SELECT player_id, season, AVG(value_score) AS value_score
        FROM player_value
        WHERE season = :season
        GROUP BY player_id, season
    )
    SELECT sal.team_id, SUM(sal.salary) AS total_payroll, AVG(pv.value_score) AS avg_value_score
    FROM player_salaries sal
    LEFT JOIN player_value_avg pv ON pv.player_id = sal.player_id AND pv.season = sal.season
    WHERE sal.season = :season
    GROUP BY sal.team_id
    """
)


def _project_salaries(pre_arb: pd.DataFrame, market: pd.DataFrame) -> pd.DataFrame:
    """Projects a market salary for each pre-arb player as the median AAV of
    comparable-performing market-priced peers at the same position (falling back
    to the whole market pool for that stat type if the position doesn't have
    enough market comps).

    Real contracts (especially for pitchers) have huge AAV variance even among
    similarly-performing players this season, since they're priced on track
    record and multi-year projections too, not just this year's stat line. A
    strict "5 nearest by percentile" comp set is noisy enough that one or two
    outlier mega-contracts can swing the median a lot, so this widens the
    percentile window until it has a reasonably stable sample instead.
    """
    pre_arb = pre_arb.copy()
    projections = []
    for row in pre_arb.itertuples():
        pool = market[market["position"] == row.position]
        if len(pool) < PROJECTION_COMPS:
            pool = market
        if len(pool) == 0:
            projections.append(None)
            continue
        window = 10
        comps = pool[(pool["composite_percentile"] - row.composite_percentile).abs() <= window]
        while len(comps) < PROJECTION_COMPS and window < 100:
            window += 10
            comps = pool[(pool["composite_percentile"] - row.composite_percentile).abs() <= window]
        if len(comps) == 0:
            comps = pool
        projections.append(comps["aav"].median())
    pre_arb["projected_salary"] = projections
    return pre_arb


def _compute_group(df: pd.DataFrame, stat_col: str, higher_is_better: bool) -> pd.DataFrame:
    df = df.copy()
    df["composite_percentile"] = (
        df.groupby("position")[stat_col].rank(pct=True, ascending=higher_is_better) * 100
    )

    is_pre_arb = df["contract_type"].apply(_is_pre_arb)
    market = df[~is_pre_arb].copy()
    pre_arb = df[is_pre_arb].copy()

    market["salary_percentile"] = market.groupby("position")["salary"].rank(pct=True) * 100
    market["value_score"] = market["composite_percentile"] - market["salary_percentile"]
    market["projected_salary"] = None

    pre_arb["salary_percentile"] = None
    pre_arb["value_score"] = None
    pre_arb = _project_salaries(pre_arb, market)

    return pd.concat([market, pre_arb], ignore_index=True)


def compute_player_value(db: Session, season: int) -> int:
    now = datetime.now(timezone.utc)

    batters = pd.read_sql(_BATTER_QUERY, engine, params={"season": season, "min_pa": MIN_BATTER_PA})
    pitchers = pd.read_sql(_PITCHER_QUERY, engine, params={"season": season, "min_ip": MIN_PITCHER_IP})

    batters = _compute_group(batters, "xwoba", higher_is_better=True)
    pitchers = _compute_group(pitchers, "fip", higher_is_better=False)

    count = 0
    for df, player_type in ((batters, PlayerType.BATTER), (pitchers, PlayerType.PITCHER)):
        for row in df.itertuples():
            db.merge(
                PlayerValue(
                    player_id=row.player_id,
                    season=season,
                    player_type=player_type,
                    position=Position[row.position],
                    composite_percentile=round(row.composite_percentile, 2),
                    salary_percentile=(
                        round(row.salary_percentile, 2) if pd.notna(row.salary_percentile) else None
                    ),
                    value_score=round(row.value_score, 2) if pd.notna(row.value_score) else None,
                    projected_salary=(
                        round(row.projected_salary, 2) if pd.notna(row.projected_salary) else None
                    ),
                    computed_at=now,
                )
            )
            count += 1

    db.commit()
    return count


def compute_team_payroll_summary(db: Session, season: int) -> int:
    now = datetime.now(timezone.utc)
    teams = pd.read_sql(_TEAM_PAYROLL_QUERY, engine, params={"season": season})

    for row in teams.itertuples():
        db.merge(
            TeamPayrollSummary(
                team_id=row.team_id,
                season=season,
                total_payroll=row.total_payroll,
                avg_value_score=(
                    round(row.avg_value_score, 2) if pd.notna(row.avg_value_score) else None
                ),
                computed_at=now,
            )
        )
    db.commit()
    return len(teams)
