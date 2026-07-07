import json
import re

import requests

ROSTER_RESOURCE_URL = "https://www.fangraphs.com/roster-resource/payroll/{slug}"

# FanGraphs RosterResource team slugs -> our teams.abbreviation values.
TEAM_SLUG_TO_ABBREVIATION = {
    "angels": "LAA",
    "astros": "HOU",
    "athletics": "ATH",
    "blue-jays": "TOR",
    "braves": "ATL",
    "brewers": "MIL",
    "cardinals": "STL",
    "cubs": "CHC",
    "diamondbacks": "AZ",
    "dodgers": "LAD",
    "giants": "SF",
    "guardians": "CLE",
    "mariners": "SEA",
    "marlins": "MIA",
    "mets": "NYM",
    "nationals": "WSH",
    "orioles": "BAL",
    "padres": "SD",
    "phillies": "PHI",
    "pirates": "PIT",
    "rangers": "TEX",
    "rays": "TB",
    "red-sox": "BOS",
    "reds": "CIN",
    "rockies": "COL",
    "royals": "KC",
    "tigers": "DET",
    "twins": "MIN",
    "white-sox": "CWS",
    "yankees": "NYY",
}

_NEXT_DATA_RE = re.compile(
    r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.DOTALL
)


def fetch_team_contracts(slug: str) -> list[dict]:
    """Scrapes one team's RosterResource payroll page. The page is a Next.js app
    that embeds full contract data (including MLBAM IDs) as JSON in a
    __NEXT_DATA__ script tag -- no HTML table parsing or name matching needed."""
    resp = requests.get(ROSTER_RESOURCE_URL.format(slug=slug), timeout=30)
    resp.raise_for_status()
    resp.encoding = "utf-8"

    match = _NEXT_DATA_RE.search(resp.text)
    if not match:
        raise ValueError(f"__NEXT_DATA__ not found on RosterResource page for '{slug}'")

    data = json.loads(match.group(1))
    queries = data["props"]["pageProps"]["dehydratedState"]["queries"]
    return queries[0]["state"]["data"]["dataContract"]


def fetch_all_salaries(season: int) -> list[dict]:
    """Returns one row per (player, season, team) with MLBAM id, salary, AAV,
    and total contract years, for every team's current roster."""
    rows: list[dict] = []
    for slug, abbreviation in TEAM_SLUG_TO_ABBREVIATION.items():
        for contract in fetch_team_contracts(slug):
            summary = contract["contractSummary"]
            for year in contract["contractYears"]:
                if year["Season"] != season:
                    continue
                if not summary.get("MLBAMID"):
                    continue
                rows.append(
                    {
                        "player_id": int(summary["MLBAMID"]),
                        "team_abbreviation": abbreviation,
                        "salary": year.get("Salary"),
                        "aav": year.get("AAV") or summary.get("AAV"),
                        "contract_years_total": summary.get("YearsTotal"),
                    }
                )
    return rows
