from fastapi import Depends, FastAPI, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

app = FastAPI(title="MLB Market Value API")

# position_enum stores "FIRST_BASE"/"SECOND_BASE"/"THIRD_BASE" as the literal
# DB value (a bare "1B" isn't a valid Postgres enum label), but every other
# position stores its plain abbreviation. Translate at the API boundary so
# clients only ever see "1B"/"2B"/"3B".
_ENUM_NAME_TO_ABBREV = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}
_ABBREV_TO_ENUM_NAME = {v: k for k, v in _ENUM_NAME_TO_ABBREV.items()}


def _to_db_position(position: str | None) -> str | None:
    if position is None:
        return None
    return _ABBREV_TO_ENUM_NAME.get(position.upper(), position.upper())


def _to_api_position(row: dict) -> dict:
    row = dict(row)
    if "position" in row:
        row["position"] = _ENUM_NAME_TO_ABBREV.get(row["position"], row["position"])
    return row


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/players/value")
def player_value(
    season: int,
    position: str | None = None,
    sort: str = Query("value_score", pattern="^(value_score|composite_percentile|salary_percentile)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Market-priced players only (Arbitration/Extension/Free Agent). Pre-arbitration
    and MiLB-contract players are excluded here -- see /players/projected instead."""
    query = text(
        f"""
        SELECT p.full_name, t.abbreviation AS team, pv.player_type, pv.position,
               sal.salary, sal.aav, sal.contract_type,
               pv.composite_percentile, pv.salary_percentile, pv.value_score
        FROM player_value pv
        JOIN players p ON p.player_id = pv.player_id
        JOIN player_salaries sal ON sal.player_id = pv.player_id AND sal.season = pv.season
        JOIN teams t ON t.team_id = sal.team_id
        WHERE pv.season = :season AND pv.value_score IS NOT NULL
          AND (:position IS NULL OR pv.position = :position)
        ORDER BY pv.{sort} {order}
        LIMIT :limit
        """
    )
    rows = db.execute(
        query, {"season": season, "position": _to_db_position(position), "limit": limit}
    ).mappings().all()
    return [_to_api_position(r) for r in rows]


@app.get("/players/projected")
def player_projected(
    season: int,
    position: str | None = None,
    sort: str = Query("surplus", pattern="^(surplus|projected_salary|composite_percentile)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Pre-arbitration and MiLB-contract players, whose salaries are fixed near the
    league minimum by rule rather than by performance. Instead of a value_score
    against real (uninformative) salary, shows a projected market salary based on
    comparable-performing market-priced peers at the same position."""
    query = text(
        f"""
        SELECT p.full_name, t.abbreviation AS team, pv.player_type, pv.position,
               sal.salary AS actual_salary, sal.contract_type, pv.composite_percentile,
               pv.projected_salary, (pv.projected_salary - sal.salary) AS surplus
        FROM player_value pv
        JOIN players p ON p.player_id = pv.player_id
        JOIN player_salaries sal ON sal.player_id = pv.player_id AND sal.season = pv.season
        JOIN teams t ON t.team_id = sal.team_id
        WHERE pv.season = :season AND pv.projected_salary IS NOT NULL
          AND (:position IS NULL OR pv.position = :position)
        ORDER BY {"(pv.projected_salary - sal.salary)" if sort == "surplus" else f"pv.{sort}"} {order}
        LIMIT :limit
        """
    )
    rows = db.execute(
        query, {"season": season, "position": _to_db_position(position), "limit": limit}
    ).mappings().all()
    return [_to_api_position(r) for r in rows]


@app.get("/teams/payroll")
def team_payroll(
    season: int,
    sort: str = Query("total_payroll", pattern="^(total_payroll|avg_value_score)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    query = text(
        f"""
        SELECT t.abbreviation AS team, t.name, tps.total_payroll, tps.avg_value_score
        FROM team_payroll_summary tps
        JOIN teams t ON t.team_id = tps.team_id
        WHERE tps.season = :season
        ORDER BY tps.{sort} {order}
        """
    )
    rows = db.execute(query, {"season": season}).mappings().all()
    return [dict(r) for r in rows]
