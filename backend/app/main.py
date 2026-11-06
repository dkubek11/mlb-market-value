import base64
import datetime
import json
import os
import sys
import threading
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
# the fonts into the assembled template at request time. The template source
# is split into frontend/dashboard/parts/ (head/topbar/views HTML plus one JS
# module per feature) and assembled into a single document here, so there is
# no offline HTML build step, no bundler, and no generated file in the repo.
_DASHBOARD_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "frontend"
    / "dashboard"
)
_DASHBOARD_PARTS_DIR = _DASHBOARD_DIR / "parts"
# Concatenated into one <script> in this order -- all modules share a single
# script scope, exactly like the original single-file template they came from.
_DASHBOARD_JS_PARTS = (
    "core.js",
    "player-card.js",
    "home.js",
    "tables.js",
    "teams.js",
    "team-view.js",
    "free-agents.js",
    "scoring.js",
    "weights.js",
    "custom.js",
    "nav.js",
)

if str(_DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(_DASHBOARD_DIR))
from build_dashboard import build_dashboard_data  # noqa: E402

# Fonts are loaded by the browser (Inter + Space Mono) so there are no
# remaining base64 placeholders to splice in.
_FONT_PLACEHOLDERS: dict[str, str] = {}

# League marks live outside parts/ and are embedded as data URIs so the page
# remains a single self-contained document.
_ASSET_PLACEHOLDERS = {
    "__NL_LEAGUE_LOGO__": "National_League_logo.svg",
    "__AL_LEAGUE_LOGO__": "American_League_logo.svg",
}


def _asset_data_uri(filename: str) -> str:
    path = _DASHBOARD_DIR / "assets" / filename
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return ""
    mime = "image/svg+xml" if path.suffix.lower() == ".svg" else "application/octet-stream"
    return f"data:{mime};base64,{encoded}"

# A snapshot build runs DB queries, projections, and best-effort live scrapes,
# so results are cached in two layers:
#   1. In-memory rendered HTML per season (fast path within the process).
#   2. The raw snapshot dict persisted to .snapshot_cache/dashboard_{season}.json
#      (survives restarts). On expiry the stale page is served immediately and
#      a fresh snapshot is computed in the background (stale-while-revalidate),
#      so a page load never blocks on a ~20s rebuild. ?refresh=1 forces a
#      synchronous rebuild. TTL defaults to 30 min; override with
#      DASHBOARD_CACHE_TTL_MINUTES.
_DASHBOARD_CACHE_TTL_SECONDS = int(os.environ.get("DASHBOARD_CACHE_TTL_MINUTES", "30")) * 60
_SNAPSHOT_CACHE_DIR = _DASHBOARD_DIR / ".snapshot_cache"
_dashboard_cache: dict[int, tuple[float, str]] = {}
_fonts_cache: dict[str, str] | None = None
_template_cache: str | None = None
_template_mtime: float = 0.0
_refresh_flags: dict[int, bool] = {}
_state_lock = threading.Lock()


def _parts_latest_mtime() -> float:
    try:
        paths = [f for f in _DASHBOARD_PARTS_DIR.rglob("*") if f.is_file()]
        paths += [_DASHBOARD_DIR / "assets" / name for name in _ASSET_PLACEHOLDERS.values()]
        return max(f.stat().st_mtime for f in paths if f.is_file())
    except Exception:
        return 0.0


def _snapshot_path(season: int) -> Path:
    _SNAPSHOT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _SNAPSHOT_CACHE_DIR / f"dashboard_{season}.json"


def _load_snapshot(season: int) -> tuple[dict | None, float]:
    try:
        p = _snapshot_path(season)
        if not p.exists():
            return None, 0.0
        with p.open(encoding="utf-8") as f:
            return json.load(f), p.stat().st_mtime
    except Exception as exc:  # noqa: BLE001 -- cache read failure must not break the page
        print(f"WARNING: could not read dashboard snapshot cache ({exc!r})")
        return None, 0.0


def _save_snapshot(season: int, data: dict) -> None:
    try:
        p = _snapshot_path(season)
        with p.open("w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: could not write dashboard snapshot cache ({exc!r})")


def _assemble_template() -> str:
    """Join parts/*.html and parts/js/*.js (in order) into the full dashboard
    document. The JS modules are wrapped in a single <script> tag so they keep
    the one shared scope the original single-file template had."""
    def read(rel: str) -> str:
        return (_DASHBOARD_PARTS_DIR / rel).read_text(encoding="utf-8")

    head = read("head.html").replace("__DASHBOARD_CSS__", read("styles.css"))
    views = read("views.html")
    for placeholder, filename in _ASSET_PLACEHOLDERS.items():
        views = views.replace(placeholder, _asset_data_uri(filename))
    html = (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
        + head
        + "</head>\n<body>\n<div class=\"app-layout\">\n"
        + read("topbar.html")
        + views
        + "</div>\n<script>\n"
    )
    for name in _DASHBOARD_JS_PARTS:
        html += read(f"js/{name}")
    return html + "</script>\n</body>\n</html>\n"


def _render_dashboard(season: int, data: dict | None = None, refresh: bool = False) -> str:
    global _fonts_cache, _template_cache, _template_mtime
    latest_mtime = _parts_latest_mtime()
    if _template_cache is None or refresh or latest_mtime > _template_mtime:
        _template_cache = _assemble_template()
        _template_mtime = latest_mtime
    if _fonts_cache is None or refresh:
        _fonts_cache = {
            ph: (_DASHBOARD_DIR / fn).read_text(encoding="utf-8").strip()
            for ph, fn in _FONT_PLACEHOLDERS.items()
        }
    if data is None:
        data = build_dashboard_data(season)
    html = _template_cache
    html = html.replace("__DATA_JSON__", json.dumps(data))
    for ph, value in _fonts_cache.items():
        html = html.replace(ph, value)
    return html


def _compute_render_save(season: int, refresh: bool = False) -> str:
    """Compute the snapshot, persist it to disk, and return the rendered HTML."""
    data = build_dashboard_data(season)
    _save_snapshot(season, data)
    html = _render_dashboard(season, data, refresh=refresh)
    _dashboard_cache[season] = (time.time(), html)
    return html


def _kick_off_refresh(season: int) -> None:
    with _state_lock:
        if _refresh_flags.get(season):
            return
        _refresh_flags[season] = True
    threading.Thread(target=_refresh_worker, args=(season,), daemon=True).start()


def _refresh_worker(season: int) -> None:
    try:
        _compute_render_save(season)
    except Exception as exc:  # noqa: BLE001 -- a background refresh must never kill the server
        print(f"WARNING: background dashboard refresh for {season} failed ({exc!r})")
    finally:
        with _state_lock:
            _refresh_flags[season] = False

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
    """Serve the dashboard at the root: render the assembled dashboard (parts/)
    with the season's data and fonts inlined. Snapshots are cached in memory and on disk
    (.snapshot_cache/dashboard_{season}.json), so loads are instant and survive
    restarts; on TTL expiry the stale page is served while a fresh snapshot is
    computed in the background. ?refresh=1 forces a synchronous rebuild."""
    now = time.time()
    parts_mtime = _parts_latest_mtime()
    cached = _dashboard_cache.get(season)
    if cached and not refresh and (now - cached[0]) < _DASHBOARD_CACHE_TTL_SECONDS and cached[0] >= parts_mtime:
        return HTMLResponse(cached[1])

    snapshot, mtime = _load_snapshot(season)
    if snapshot is not None and not refresh:
        html = _render_dashboard(season, snapshot, refresh=(parts_mtime > _template_mtime))
        _dashboard_cache[season] = (now, html)
        if (now - mtime) >= _DASHBOARD_CACHE_TTL_SECONDS:
            _kick_off_refresh(season)
        return HTMLResponse(html)

    html = _compute_render_save(season, refresh=refresh)
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
