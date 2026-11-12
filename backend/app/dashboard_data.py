"""Builds the dashboard's data payload from the live database.

The dashboard is served live: the FastAPI ``/`` route (see app/main.py)
assembles ``frontend/dashboard/parts/`` and renders it with a snapshot computed by
``frontend/dashboard/build_dashboard.py``'s :func:`build_dashboard_data`,
while ``GET /api/dashboard`` exposes :func:`build_dashboard_payload` here as
JSON for any client that wants the data without the HTML. There is no offline
HTML build step.
"""

from __future__ import annotations

import datetime
import json
import math
import os
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from app.db import engine
from app.pipeline.comp_projections import (
    compute_batter_comp_projections,
    compute_pitcher_comp_projections,
)
from app.pipeline.compute_value import _is_pre_arb
from app.pipeline.fangraphs_salary import (
    TEAM_SLUG_TO_ABBREVIATION,
    fetch_team_contracts,
)
from app.pipeline.trailing_stats import (
    configure_cache_dir as _configure_trailing_cache,
    fetch_last30,
)
from app.pipeline.projections import (
    BATTER_PROJECTION_STATS,
    PITCHER_PROJECTION_STATS,
    blend_projections,
    compute_batter_projections,
    compute_pitcher_projections,
)
from app.pipeline import war_projection

# Co-locate the trailing-stats cache with the snapshot caches so the HTML
# snapshot (build_dashboard_data) and the JSON payload share one cached fetch.
_configure_trailing_cache(Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard" / ".snapshot_cache")

MIN_BATTER_PA = 150
MIN_IP_SP = 50
MIN_IP_RP = 25
POS_MAP = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}

BATTER_STATS = [
    "ba", "obp", "slg", "xwoba", "xba", "xslg", "hr", "rbi", "sb",
    "barrel_rate", "hard_hit_rate", "sprint_speed",
    "chase_rate", "whiff_rate", "k_rate", "bb_rate", "oaa", "frv", "drs",
]
PITCHER_STATS = [
    "era", "whip", "fip", "xera", "k_9", "bb_9",
    "hard_hit_rate_against", "barrel_rate_against", "xba_against",
    "avg_exit_velo_against", "chase_rate", "whiff_rate", "k_rate", "bb_rate",
    "z_swing_rate", "extension", "stuff_plus", "location_plus",
]

_BATTER_Q = text("""
    SELECT bs.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, bs.pa,
           bs.ba, bs.obp, bs.slg, bs.xwoba, bs.xba, bs.xslg, bs.hr, bs.rbi, bs.sb,
           bs.barrel_rate, bs.hard_hit_rate, bs.sprint_speed,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate,
           fs.oaa, fs.frv, fs.drs
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    JOIN teams t ON t.team_id = ps.team_id
    JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    LEFT JOIN fielding_stats fs ON fs.player_id=bs.player_id AND fs.season=bs.season
    WHERE bs.season=:season AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
""")

_PITCHER_Q = text("""
    SELECT ps_s.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, ps_s.ip,
           ps_s.era, ps_s.whip, ps_s.fip, ps_s.xera, ps_s.k_9, ps_s.bb_9,
           ps_s.hard_hit_rate_against, ps_s.barrel_rate_against, ps_s.xba_against,
           ps_s.avg_exit_velo_against, ps_s.chase_rate, ps_s.whiff_rate, ps_s.k_rate, ps_s.bb_rate,
           ps_s.z_swing_rate, ps_s.extension, ps_s.stuff_plus, ps_s.location_plus
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    JOIN teams t ON t.team_id = ps.team_id
    JOIN player_salaries sal ON sal.player_id = ps_s.player_id AND sal.season = ps_s.season
    WHERE ps_s.season=:season AND ps_s.fip IS NOT NULL
      AND (
        (ps.position = 'SP' AND ps_s.ip >= :min_ip_sp) OR
        (ps.position = 'RP' AND ps_s.ip >= :min_ip_rp)
      )
""")

# Every rostered player's playing time at their position, regardless of whether
# they clear the scoring-qualification bar -- used only to pick who occupies
# each position on the Teams-tab diamond view.
_ROSTER_BATTER_Q = text("""
    SELECT t.abbreviation AS team, ps.position AS position, bs.player_id, p.full_name, bs.pa AS pt
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE bs.season=:season
""")
_ROSTER_PITCHER_Q = text("""
    SELECT t.abbreviation AS team, ps.position AS position, ps_s.player_id, p.full_name, ps_s.ip AS pt
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE ps_s.season=:season
""")

_TEAMS_Q = text("SELECT team_id, abbreviation, name, league, division FROM teams")
_PAYROLL_Q = text(
    "SELECT team_id, SUM(salary) AS payroll FROM player_salaries WHERE season=:season GROUP BY team_id"
)

_TEAM_COLORS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "frontend" / "dashboard" / "team_colors.json"
)


def _clean(value: float | int | None) -> float | None:
    """Round a stat to 5 decimals, mapping NaN/None to JSON-safe None."""
    if value is None or pd.isna(value):
        return None
    return round(float(value), 5)


def _to_record(
    r,
    is_batter: bool,
    stat_keys: list[str],
    proj_map: dict[int, dict],
    proj_stat_keys: list[str],
    last30_map: dict[int, float] | None = None,
    war_outlook: dict[str, dict[int, dict]] | None = None,
) -> dict:
    proj = proj_map.get(int(r.player_id), {})
    contract_type = r.contract_type
    if contract_type and "Guaranteed Section" in contract_type:
        contract_type = "Extension"
    return {
        "id": int(r.player_id),
        "name": r.full_name,
        "team": r.team,
        "position": r.position,
        "isBatter": is_batter,
        "isPreArb": bool(r.is_pre_arb),
        "salary": round(float(r.salary)),
        "aav": round(float(r.aav)),
        "contractType": contract_type,
        "stats": {s: _clean(getattr(r, s)) for s in stat_keys},
        "age": _clean(proj.get("age")),
        # Projected true-talent values, keyed the same as "stats" so any stat
        # can be compared 1:1 against its own projection (blend of Marcel
        # regression + comparable-player projections; see projections.py).
        "projected": {s: _clean(proj.get(s)) for s in proj_stat_keys},
        "nComps": proj.get("nComps", 0),
        # Projected fWAR for each of the next 5 seasons plus the open-market
        # contract it implies (see war_projection.py). None without fWAR history.
        "warOutlook": (
            war_outlook["batter" if is_batter else "pitcher"].get(int(r.player_id))
            if war_outlook else None
        ),
        # Real AVG (batters) / ERA (pitchers) over the trailing 30 real days
        # (not season-to-date) -- None if the player didn't clear the
        # playing-time floor in that window. Powers the Home-tab Hot vs Cold
        # section (compared against stats.ba / stats.era).
        "last30": _clean(last30_map.get(int(r.player_id))) if last30_map else None,
    }


def _fetch_contracts() -> dict[int, dict]:
    """Best-effort live scrape of FanGraphs contract detail.

    Returns {} when skipped or on any network error so a container without
    outbound internet (or blocked by FanGraphs) never breaks the dashboard.
    """
    if os.environ.get("SKIP_LIVE_CONTRACTS"):
        print("SKIP_LIVE_CONTRACTS=1 set -- skipping live FanGraphs contract fetch")
        return {}
    try:
        contracts: dict[int, dict] = {}
        for slug in TEAM_SLUG_TO_ABBREVIATION:
            for contract in fetch_team_contracts(slug):
                summary = contract["contractSummary"]
                pid = summary.get("MLBAMID")
                if not pid:
                    continue
                pid = int(pid)
                years = sorted(
                    (
                        {
                            "season": y["Season"],
                            "salary": y.get("Salary"),
                            "aav": y.get("AAV"),
                            "type": y.get("Type"),
                        }
                        for y in contract["contractYears"]
                    ),
                    key=lambda y: y["season"],
                )
                entry = {
                    "contractType": summary.get("ContractType"),
                    "yearsTotal": summary.get("YearsTotal"),
                    "startSeason": summary.get("startSeason"),
                    "endSeasonAll": summary.get("endSeasonAll"),
                    "totalGuaranteed": summary.get("ContractTotal"),
                    "signingBonus": summary.get("SigningBonus"),
                    "years": years,
                }
                # A player can have multiple contract rows (extensions, multiple
                # stints); keep whichever covers the most years of data.
                existing = contracts.get(pid)
                if existing is None or len(entry["years"]) > len(existing["years"]):
                    contracts[pid] = entry
        return contracts
    except Exception as exc:  # noqa: BLE001 -- network scrape is best-effort
        print(f"WARNING: FanGraphs contract fetch failed ({exc!r}); continuing without contracts")
        return {}


def build_dashboard_payload(season: int, *, fetch_live_contracts: bool = True) -> dict:
    """Query the live DB and return the dashboard payload as a dict for the
    ``GET /api/dashboard`` endpoint:

    {
      "allPlayers": [...],       # qualified batters + pitchers with projections
      "positionStats": {...},    # mean/std of every stat per position
      "teams": [...],            # 30 teams with payroll
      "rosters": {...},          # best player per team/position for the diamond view
      "teamColors": {...},       # static brand colors (from team_colors.json)
      "contracts": {...},        # live FanGraphs contract detail (best-effort)
      "capturedAt": "...",       # UTC timestamp of the payload
    }
    """
    print(f"[{season}] querying qualified batters/pitchers...")
    batters = pd.read_sql(_BATTER_Q, engine, params={"season": season, "min_pa": MIN_BATTER_PA})
    pitchers = pd.read_sql(_PITCHER_Q, engine, params={"season": season, "min_ip_sp": MIN_IP_SP, "min_ip_rp": MIN_IP_RP})
    batters["position"] = batters["position"].map(lambda p: POS_MAP.get(p, p))
    batters["is_pre_arb"] = batters["contract_type"].apply(_is_pre_arb)
    pitchers["is_pre_arb"] = pitchers["contract_type"].apply(_is_pre_arb)

    print(f"[{season}] computing Marcel-style projections...")
    batter_marcel = compute_batter_projections(season)
    pitcher_marcel = compute_pitcher_projections(season)

    print(f"[{season}] computing comparable-player (nearest-neighbor) projections...")
    batter_comp = compute_batter_comp_projections(season)
    pitcher_comp = compute_pitcher_comp_projections(season)

    batter_proj = blend_projections(batter_marcel, batter_comp, list(BATTER_PROJECTION_STATS.keys()))
    pitcher_proj = blend_projections(pitcher_marcel, pitcher_comp, list(PITCHER_PROJECTION_STATS.keys()))

    # Five-year fWAR outlook + open-market contract estimate (see
    # war_projection.py). Separate from the process-stat projections above.
    print(f"[{season}] projecting 5-year fWAR and contract estimates...")
    war_outlook = war_projection.build(
        season, {int(pid): pos for pid, pos in zip(pitchers["player_id"], pitchers["position"])}
    )

    print(f"[{season}] fetching trailing 30-day stats for Hot vs Cold...")
    last30_batting, last30_pitching = fetch_last30(season=season)
    print(f"  last30: {len(last30_batting)} batters, {len(last30_pitching)} pitchers clear the playing-time floor")

    position_stats: dict[str, dict[str, dict]] = {}
    for pos, grp in batters.groupby("position"):
        position_stats[pos] = {}
        for stat in BATTER_STATS:
            vals = grp[stat].dropna()
            position_stats[pos][stat] = (
                {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
                if len(vals) >= 2 else None
            )
    for pos, grp in pitchers.groupby("position"):
        position_stats[pos] = {}
        for stat in PITCHER_STATS:
            vals = grp[stat].dropna()
            position_stats[pos][stat] = (
                {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
                if len(vals) >= 2 else None
            )

    all_players = (
        [ _to_record(r, True, BATTER_STATS, batter_proj, BATTER_PROJECTION_STATS.keys(), last30_batting, war_outlook) for r in batters.itertuples() ]
        + [ _to_record(r, False, PITCHER_STATS, pitcher_proj, PITCHER_PROJECTION_STATS.keys(), last30_pitching, war_outlook) for r in pitchers.itertuples() ]
    )

    print(f"[{season}] building team payroll + rosters (all rostered players, not just qualifiers)...")
    teams_df = pd.read_sql(_TEAMS_Q, engine)
    payroll_df = pd.read_sql(_PAYROLL_Q, engine, params={"season": season})
    teams_df = teams_df.merge(payroll_df, on="team_id", how="left")
    teams_out = [
        {
            "abbr": r.abbreviation,
            "name": r.name,
            "league": r.league,
            "division": r.division,
            "payroll": round(float(r.payroll)) if pd.notna(r.payroll) else 0,
        }
        for r in teams_df.itertuples()
    ]

    roster_batters = pd.read_sql(_ROSTER_BATTER_Q, engine, params={"season": season})
    roster_batters["position"] = roster_batters["position"].map(lambda p: POS_MAP.get(p, p))
    roster_pitchers = pd.read_sql(_ROSTER_PITCHER_Q, engine, params={"season": season})
    roster_all = pd.concat([roster_batters, roster_pitchers], ignore_index=True)

    rosters: dict[str, dict[str, dict]] = {}
    for (team, pos), grp in roster_all.groupby(["team", "position"]):
        top = grp.loc[grp["pt"].idxmax()]
        rosters.setdefault(team, {})[pos] = {"id": int(top.player_id), "name": top.full_name}

    contracts = _fetch_contracts() if fetch_live_contracts else {}

    for p in all_players:
        c = contracts.get(p["id"])
        if c and (c.get("contractType") == "Extension" or (c.get("endSeasonAll") and c["endSeasonAll"] > season)):
            p["contractType"] = "Extension"

    with open(_TEAM_COLORS_PATH, encoding="utf-8") as f:
        team_colors = json.load(f)

    return {
        "season": season,
        "allPlayers": all_players,
        "positionStats": position_stats,
        "teams": teams_out,
        "rosters": rosters,
        "teamColors": team_colors,
        "contracts": contracts,
        "capturedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
