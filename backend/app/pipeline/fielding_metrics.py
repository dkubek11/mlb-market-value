import requests
import pybaseball as pb

from app.pipeline.utils import clean_nan

# Undocumented internal API backing FanGraphs' newer React leaderboards. Unlike
# leaders-legacy.aspx (blocked by Cloudflare), this endpoint is open -- but being
# unofficial/reverse-engineered, it's more likely to change without notice than
# RosterResource. DRS is Sports Info Solutions proprietary data; FanGraphs is the
# only practical public source.
FANGRAPHS_FIELDING_API = "https://www.fangraphs.com/api/leaders/major-league/data"


def fetch_oaa_frv(season: int) -> dict[int, dict]:
    """Outs Above Average and Fielding Run Value, both from Statcast. Already
    one row per player-season (pre-aggregated across positions by Baseball Savant)."""
    df = pb.statcast_outs_above_average(season, pos="all", min_att=0)
    result: dict[int, dict] = {}
    for _, row in df.iterrows():
        result[int(row["player_id"])] = {
            "oaa": clean_nan(row["outs_above_average"]),
            "frv": clean_nan(row["fielding_runs_prevented"]),
        }
    return result


def fetch_drs(season: int) -> dict[int, dict]:
    """Defensive Runs Saved, from FanGraphs. Returns one row per position played,
    so multi-position players are summed into a single player-season DRS total."""
    resp = requests.get(
        FANGRAPHS_FIELDING_API,
        params={
            "pos": "all",
            "stats": "fld",
            "lg": "all",
            "qual": 0,
            "season": season,
            "season1": season,
            "pageitems": 5000,
        },
        timeout=30,
    )
    resp.raise_for_status()

    result: dict[int, dict] = {}
    for row in resp.json()["data"]:
        pid = row.get("xMLBAMID")
        if not pid:
            continue
        pid = int(pid)
        entry = result.setdefault(pid, {"drs": 0, "innings": 0.0})
        entry["drs"] += row.get("DRS") or 0
        entry["innings"] += row.get("Inn") or 0.0
    return result
