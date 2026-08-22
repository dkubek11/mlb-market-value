import requests

BASE_URL = "https://statsapi.mlb.com/api/v1"
SPORT_ID = 1  # MLB


def fetch_teams(season: int) -> list[dict]:
    resp = requests.get(
        f"{BASE_URL}/teams",
        params={"sportId": SPORT_ID, "season": season, "activeStatus": "Yes"},
        timeout=30,
    )
    resp.raise_for_status()

    teams = []
    for t in resp.json()["teams"]:
        league = "AL" if t["league"]["name"].startswith("American") else "NL"
        division = f"{league} {t['division']['name'].split()[-1]}"
        teams.append(
            {
                "team_id": t["id"],
                "abbreviation": t["abbreviation"],
                "name": t["name"],
                "league": league,
                "division": division,
            }
        )
    return teams


def fetch_bulk_stats(season: int, group: str) -> list[dict]:
    """group is 'hitting' or 'pitching'. Returns raw split dicts from the API."""
    resp = requests.get(
        f"{BASE_URL}/stats",
        params={
            "stats": "season",
            "group": group,
            "season": season,
            "sportId": SPORT_ID,
            "playerPool": "all",
            "limit": 5000,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["stats"][0]["splits"]


def resolve_traded_player_team(player_id: int, season: int, group: str) -> int | None:
    """For players with numTeams > 1 in the bulk pull, look up their per-team
    splits and return the team_id they accumulated the most real playing time
    with that season (plate appearances for hitters, outs recorded for
    pitchers) -- not simply their most recent stint. A player traded in the
    season's final weeks should still be attributed to (and have their
    season's value counted toward) whichever team actually got the bulk of
    their year, not whoever currently has them on the active roster."""
    resp = requests.get(
        f"{BASE_URL}/people/{player_id}/stats",
        params={"stats": "season", "season": season, "sportId": SPORT_ID, "group": group},
        timeout=30,
    )
    resp.raise_for_status()
    splits = resp.json()["stats"][0]["splits"]
    team_splits = [s for s in splits if "team" in s]
    if not team_splits:
        return None
    playing_time_key = "plateAppearances" if group == "hitting" else "outs"
    return max(team_splits, key=lambda s: s["stat"].get(playing_time_key) or 0)["team"]["id"]


def fetch_people_bio(player_ids: list[int]) -> dict[int, dict]:
    """Bulk-fetch bio fields (birthdate, bats, throws, debut date) for a list of player ids."""
    bio_by_id: dict[int, dict] = {}
    chunk_size = 100
    for i in range(0, len(player_ids), chunk_size):
        chunk = player_ids[i : i + chunk_size]
        resp = requests.get(
            f"{BASE_URL}/people",
            params={"personIds": ",".join(str(p) for p in chunk)},
            timeout=30,
        )
        resp.raise_for_status()
        for person in resp.json().get("people", []):
            bio_by_id[person["id"]] = {
                "full_name": person.get("fullName"),
                "birthdate": person.get("birthDate"),
                "bats": person.get("batSide", {}).get("code"),
                "throws": person.get("pitchHand", {}).get("code"),
                "debut_date": person.get("mlbDebutDate"),
            }
    return bio_by_id
