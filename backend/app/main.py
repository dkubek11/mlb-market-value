import datetime
import json
import sys
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

app = FastAPI(title="MLB Market Value API")

# The dashboard is served live at /: build_dashboard_data() computes the full
# snapshot from the DB (data inlined via __DATA_JSON__) and the route inlines
# the fonts into dashboard_template.html at request time. There is no offline
# HTML build step and no generated dashboard_final.html anymore.
_DASHBOARD_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "frontend"
    / "dashboard"
)
_DASHBOARD_TEMPLATE = _DASHBOARD_DIR / "dashboard_template.html"

if str(_DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(_DASHBOARD_DIR))
from build_dashboard import build_dashboard_data  # noqa: E402

_FONT_PLACEHOLDERS = {
    "__RYE_FONT__": "rye.b64",
    "__COURIER_REGULAR_FONT__": "courier-regular.b64",
    "__COURIER_BOLD_FONT__": "courier-bold.b64",
    "__NOISE_TEXTURE__": "noise.b64",
}

# A snapshot build runs DB queries, projections, and best-effort live scrapes,
# so the rendered page is cached per season. The cache expires after a short
# TTL and can be bypassed with ?refresh=1.
_DASHBOARD_CACHE_TTL_SECONDS = 30 * 60
_dashboard_cache: dict[int, tuple[float, str]] = {}
_fonts_cache: dict[str, str] | None = None
_template_cache: str | None = None


def _render_dashboard(season: int) -> str:
    global _fonts_cache, _template_cache
    if _template_cache is None:
        _template_cache = _DASHBOARD_TEMPLATE.read_text(encoding="utf-8")
    if _fonts_cache is None:
        _fonts_cache = {
            ph: (_DASHBOARD_DIR / fn).read_text(encoding="utf-8").strip()
            for ph, fn in _FONT_PLACEHOLDERS.items()
        }
    html = _template_cache
    html = html.replace("__DATA_JSON__", json.dumps(build_dashboard_data(season)))
    for ph, value in _fonts_cache.items():
        html = html.replace(ph, value)
    return html

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


@app.get("/", include_in_schema=False)
def dashboard(
    season: int = Query(default=datetime.date.today().year),
    refresh: bool = Query(default=False, description="Force a fresh snapshot instead of serving the cached page"),
):
    """Serve the dashboard at the root: render dashboard_template.html with
    the season's data and fonts inlined at request time. Rendered pages are
    cached per season (30-minute TTL); pass ?refresh=1 to force a rebuild."""
    cached = _dashboard_cache.get(season)
    if cached and not refresh and (time.time() - cached[0]) < _DASHBOARD_CACHE_TTL_SECONDS:
        return HTMLResponse(cached[1])
    html = _render_dashboard(season)
    _dashboard_cache[season] = (time.time(), html)
    return HTMLResponse(html)


@app.get("/api/dashboard")
def api_dashboard(
    season: int = Query(default=datetime.date.today().year),
    fetch_live_contracts: bool = Query(default=True),
):
    """Return the full dashboard data payload (players, projections, teams,
    rosters, contracts) computed live from the database, for any client that
    wants the same data the dashboard is served with as JSON."""
    from app.dashboard_data import build_dashboard_payload

    return build_dashboard_payload(season, fetch_live_contracts=fetch_live_contracts)


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
