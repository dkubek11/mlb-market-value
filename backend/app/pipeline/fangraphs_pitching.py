import requests

from app.pipeline.utils import clean_nan

# Same undocumented internal API used for DRS and batting plate discipline.
# The pitching leaderboard carries K%/BB% (computed off batters faced, not
# available from the MLB Stats API's per-9 rates), induced plate-discipline
# rates (O-Swing%/chase, Z-Swing%, SwStr%/whiff), and FanGraphs' own pitch-
# modeling grades (sp_stuff/sp_location, i.e. "Stuff+"/"Location+") -- none of
# which are in Statcast or the MLB Stats API at all. Rate stats come back as
# fractions (0-1), not percentages; Stuff+/Location+ are scaled to 100=average.
FANGRAPHS_PITCHING_API = "https://www.fangraphs.com/api/leaders/major-league/data"


def fetch_plate_discipline(season: int) -> dict[int, dict]:
    resp = requests.get(
        FANGRAPHS_PITCHING_API,
        params={
            "pos": "all",
            "stats": "pit",
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
        result[int(pid)] = {
            "k_rate": clean_nan(row.get("K%")),
            "bb_rate": clean_nan(row.get("BB%")),
            "chase_rate": clean_nan(row.get("O-Swing%")),
            "whiff_rate": clean_nan(row.get("SwStr%")),
            "z_swing_rate": clean_nan(row.get("Z-Swing%")),
            "stuff_plus": clean_nan(row.get("sp_stuff")),
            "location_plus": clean_nan(row.get("sp_location")),
            "war": clean_nan(row.get("WAR")),
        }
    return result
