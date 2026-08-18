import requests

from app.pipeline.utils import clean_nan

# Same undocumented internal API used for DRS in fangraphs_salary.py -- FanGraphs'
# newer React leaderboards. Their batting leaderboard carries plate-discipline
# rates (O-Swing%/chase, SwStr%/whiff) that aren't available from Statcast or the
# MLB Stats API. Values come back as fractions (0-1), not percentages.
FANGRAPHS_BATTING_API = "https://www.fangraphs.com/api/leaders/major-league/data"


def fetch_plate_discipline(season: int) -> dict[int, dict]:
    resp = requests.get(
        FANGRAPHS_BATTING_API,
        params={
            "pos": "all",
            "stats": "bat",
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
            "chase_rate": clean_nan(row.get("O-Swing%")),
            "whiff_rate": clean_nan(row.get("SwStr%")),
            "war": clean_nan(row.get("WAR")),
            "wrc_plus": clean_nan(row.get("wRC+")),
        }
    return result
