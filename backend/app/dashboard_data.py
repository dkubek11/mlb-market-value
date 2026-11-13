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
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard" / ".snapshot_cache"
_configure_trailing_cache(_CACHE_DIR)

MIN_BATTER_PA = 150
MIN_IP_SP = 50
MIN_IP_RP = 25
POS_MAP = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}

# Legitimate Two-Way Players (e.g. Shohei Ohtani) who have dual hitting/pitching functionality
TWO_WAY_PLAYER_IDS = {660271}


def fetch_fielding_positions(season: int) -> dict[int, list[str]]:
    """Return map of player_id -> list of non-pitcher positions played, ordered by games played.

    Mop-up pitching appearances ('P' / 'RP') are excluded for position players.
    """
    cache_path = _CACHE_DIR / f"fielding_positions_{season}.json"
    if cache_path.exists():
        try:
            with open(cache_path, encoding="utf-8") as f:
                cached = json.load(f)
                return {int(k): v for k, v in cached.items()}
        except Exception:
            pass

    try:
        from app.pipeline.mlb_stats_api import fetch_bulk_stats
        splits = fetch_bulk_stats(season, "fielding")
        positions_by_player: dict[int, dict[str, int]] = {}
        for s in splits:
            pid = s.get("player", {}).get("id")
            pos = s.get("position", {}).get("abbreviation")
            games = s.get("stat", {}).get("gamesPlayed", 0)
            if not pid or not pos or pos in {"P", "RP"}:
                continue
            positions_by_player.setdefault(pid, {})[pos] = games

        result = {
            pid: sorted(pos_dict.keys(), key=lambda p: pos_dict[p], reverse=True)
            for pid, pos_dict in positions_by_player.items()
        }
        try:
            _CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f)
        except Exception:
            pass
        return result
    except Exception as exc:
        print(f"WARNING: could not fetch fielding positions ({exc!r}); continuing without them")
        return {}


def merge_and_deduplicate_players(
    batter_records: list[dict],
    pitcher_records: list[dict],
    two_way_player_ids: set[int] = TWO_WAY_PLAYER_IDS,
    fielding_positions_by_player: dict[int, list[str]] | None = None,
) -> list[dict]:
    """Merge batter and pitcher records into all_players.

    Only legitimate Two-Way Players (TWO_WAY_PLAYER_IDS) retain dual records (one
    as batter, one as pitcher). For non-two-way players who appeared in both pools
    (e.g., position players pitching in blowouts like Carlos Cortes, or pitchers
    with rare plate appearances), keep only their primary record, designate their
    secondary position, and omit the duplicate entry. Mop-up pitching ('P'/'RP')
    is NEVER assigned to position players.
    """
    fielding_map = fielding_positions_by_player or {}
    batters_by_id = {p["id"]: p for p in batter_records}
    pitchers_by_id = {p["id"]: p for p in pitcher_records}
    all_ids = list(dict.fromkeys([p["id"] for p in batter_records] + [p["id"] for p in pitcher_records]))

    out = []
    for pid in all_ids:
        b = batters_by_id.get(pid)
        pit = pitchers_by_id.get(pid)
        player_fielding = fielding_map.get(pid, [])

        if b and pit:
            if pid in two_way_player_ids:
                # Two-way player (Shohei Ohtani): keep both records with two-way metadata
                b["isTwoWay"] = True
                b["primaryPosition"] = b["position"]
                b["secondaryPosition"] = pit["position"]
                b["positions"] = [b["position"], pit["position"]]

                pit["isTwoWay"] = True
                pit["primaryPosition"] = pit["position"]
                pit["secondaryPosition"] = b["position"]
                pit["positions"] = [pit["position"], b["position"]]

                out.append(b)
                out.append(pit)
            else:
                # Non-two-way player: compare playing time to decide primary vs secondary
                b_games = (b.get("stats") or {}).get("games") or 0
                pit_ip = (pit.get("stats") or {}).get("ip") or 0

                # If batter games >= 15 or pitcher IP < 20, dominant role is batter
                if b_games >= 15 or pit_ip < 20:
                    primary = b
                    # Emergency mop-up relief pitching is NOT a secondary position.
                    # Secondary position comes from real fielding/DH positions (excluding primary).
                    other_pos = [pos for pos in player_fielding if pos != primary["position"]]
                    sec_pos = ", ".join(other_pos) if other_pos else None
                    all_pos = [primary["position"]] + other_pos
                else:
                    primary = pit
                    sec_pos = b["position"]
                    all_pos = [primary["position"], sec_pos]

                primary["isTwoWay"] = False
                primary["primaryPosition"] = primary["position"]
                primary["secondaryPosition"] = sec_pos
                primary["positions"] = all_pos
                out.append(primary)
        elif b:
            b["isTwoWay"] = False
            b["primaryPosition"] = b["position"]
            other_pos = [pos for pos in player_fielding if pos != b["position"]]
            b["secondaryPosition"] = ", ".join(other_pos) if other_pos else None
            b["positions"] = [b["position"]] + other_pos
            out.append(b)
        elif pit:
            pit["isTwoWay"] = False
            pit["primaryPosition"] = pit["position"]
            pit["secondaryPosition"] = None
            pit["positions"] = [pit["position"]]
            out.append(pit)

    return out

BATTER_STATS = [
    "ba", "obp", "slg", "xwoba", "xba", "xslg", "hr", "rbi", "sb",
    "barrel_rate", "hard_hit_rate", "sprint_speed",
    "chase_rate", "whiff_rate", "k_rate", "bb_rate", "oaa", "frv", "drs",
    "bwar", "fwar", "hits", "games",
]
PITCHER_STATS = [
    "era", "whip", "fip", "xera", "k_9", "bb_9",
    "hard_hit_rate_against", "barrel_rate_against", "xba_against",
    "avg_exit_velo_against", "chase_rate", "whiff_rate", "k_rate", "bb_rate",
    "z_swing_rate", "extension", "stuff_plus", "location_plus",
    "bwar", "fwar", "wins", "saves", "games_started", "ip",
]

_BATTER_Q = text("""
    SELECT bs.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, bs.pa,
           bs.ba, bs.obp, bs.slg, bs.xwoba, bs.xba, bs.xslg, bs.hr, bs.rbi, bs.sb,
           bs.barrel_rate, bs.hard_hit_rate, bs.sprint_speed,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate,
           fs.oaa, fs.frv, fs.drs,
           bs.bwar, bs.war AS fwar, bs.hits, bs.games
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    JOIN teams t ON t.team_id = COALESCE(sal.team_id, bs.team_id, ps.team_id)
    LEFT JOIN fielding_stats fs ON fs.player_id=bs.player_id AND fs.season=bs.season
    WHERE bs.season=:season AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
""")

_PITCHER_Q = text("""
    SELECT ps_s.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, ps_s.ip,
           ps_s.era, ps_s.whip, ps_s.fip, ps_s.xera, ps_s.k_9, ps_s.bb_9,
           ps_s.hard_hit_rate_against, ps_s.barrel_rate_against, ps_s.xba_against,
           ps_s.avg_exit_velo_against, ps_s.chase_rate, ps_s.whiff_rate, ps_s.k_rate, ps_s.bb_rate,
           ps_s.z_swing_rate, ps_s.extension, ps_s.stuff_plus, ps_s.location_plus,
           ps_s.bwar, ps_s.war AS fwar, ps_s.wins, ps_s.saves, ps_s.games_started
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    JOIN player_salaries sal ON sal.player_id = ps_s.player_id AND sal.season = ps_s.season
    JOIN teams t ON t.team_id = COALESCE(sal.team_id, ps_s.team_id, ps.team_id)
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
    LEFT JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    JOIN teams t ON t.team_id = COALESCE(sal.team_id, bs.team_id, ps.team_id)
    WHERE bs.season=:season
""")
_ROSTER_PITCHER_Q = text("""
    SELECT t.abbreviation AS team, ps.position AS position, ps_s.player_id, p.full_name, ps_s.ip AS pt
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    LEFT JOIN player_salaries sal ON sal.player_id = ps_s.player_id AND sal.season = ps_s.season
    JOIN teams t ON t.team_id = COALESCE(sal.team_id, ps_s.team_id, ps.team_id)
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
    if contract_type and "Guaranteed Sect" in contract_type:
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

    batter_records = [
        _to_record(r, True, BATTER_STATS, batter_proj, BATTER_PROJECTION_STATS.keys(), last30_batting, war_outlook)
        for r in batters.itertuples()
    ]
    pitcher_records = [
        _to_record(r, False, PITCHER_STATS, pitcher_proj, PITCHER_PROJECTION_STATS.keys(), last30_pitching, war_outlook)
        for r in pitchers.itertuples()
    ]
    fielding_positions = fetch_fielding_positions(season)
    all_players = merge_and_deduplicate_players(
        batter_records, pitcher_records, fielding_positions_by_player=fielding_positions
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
        c = contracts.get(p["id"]) or contracts.get(str(p["id"]))
        if c:
            if c.get("contractType") == "Extension":
                p["contractType"] = "Extension"
            elif c.get("contractType") == "Free Agent":
                p["contractType"] = "Free Agent"
            elif c.get("endSeasonAll") and c["endSeasonAll"] > season and (
                p.get("contractType") in {"Arbitration", "Pre-Arbitration", "Free Agent/Arb"}
                or (p.get("contractType") and "Guaranteed Sect" in p["contractType"])
            ):
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
