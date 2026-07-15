import requests

from app.pipeline.utils import clean_nan

# Same undocumented internal API used for DRS and batting plate discipline.
# The pitching leaderboard carries K%/BB% (computed off batters faced, not
# available from the MLB Stats API's per-9 rates) and induced plate-discipline
# rates (O-Swing%/chase, SwStr%/whiff) that aren't in Statcast or the MLB Stats
# API at all. Values come back as fractions (0-1), not percentages.
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
        }
    return result
