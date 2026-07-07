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

_BATTER_QUERY = text(
    """
    SELECT bs.player_id, ps.position AS position, bs.xwoba, sal.salary
    FROM batter_stats bs
    JOIN player_seasons ps
        ON ps.player_id = bs.player_id AND ps.season = bs.season AND ps.player_type = 'BATTER'
    JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    WHERE bs.season = :season AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
    """
)

_PITCHER_QUERY = text(
    """
    SELECT ps_stats.player_id, ps.position AS position, ps_stats.fip, sal.salary
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


def _percentiles(df: pd.DataFrame, stat_col: str, higher_is_better: bool) -> pd.DataFrame:
    df = df.copy()
    df["composite_percentile"] = (
        df.groupby("position")[stat_col].rank(pct=True, ascending=higher_is_better) * 100
    )
    df["salary_percentile"] = df.groupby("position")["salary"].rank(pct=True) * 100
    df["value_score"] = df["composite_percentile"] - df["salary_percentile"]
    return df


def compute_player_value(db: Session, season: int) -> int:
    now = datetime.now(timezone.utc)

    batters = pd.read_sql(_BATTER_QUERY, engine, params={"season": season, "min_pa": MIN_BATTER_PA})
    pitchers = pd.read_sql(_PITCHER_QUERY, engine, params={"season": season, "min_ip": MIN_PITCHER_IP})

    batters = _percentiles(batters, "xwoba", higher_is_better=True)
    pitchers = _percentiles(pitchers, "fip", higher_is_better=False)

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
                    salary_percentile=round(row.salary_percentile, 2),
                    value_score=round(row.value_score, 2),
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
