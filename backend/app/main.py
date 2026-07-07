from fastapi import Depends, FastAPI, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

app = FastAPI(title="MLB Market Value API")


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
    query = text(
        f"""
        SELECT p.full_name, t.abbreviation AS team, pv.player_type, pv.position,
               sal.salary, sal.aav, pv.composite_percentile, pv.salary_percentile, pv.value_score
        FROM player_value pv
        JOIN players p ON p.player_id = pv.player_id
        JOIN player_salaries sal ON sal.player_id = pv.player_id AND sal.season = pv.season
        JOIN teams t ON t.team_id = sal.team_id
        WHERE pv.season = :season
          AND (:position IS NULL OR pv.position = :position)
        ORDER BY pv.{sort} {order}
        LIMIT :limit
        """
    )
    rows = db.execute(query, {"season": season, "position": position, "limit": limit}).mappings().all()
    return [dict(r) for r in rows]


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
