import requests

AWARDS_URL = "https://statsapi.mlb.com/api/v1/awards/{award_id}/recipients"

# Major-league awards real arbitration panels explicitly credit as "special
# accomplishments" beyond the raw stat line -- MVP/Cy Young/Rookie of the
# Year wins carry the most weight, All-Star/Silver Slugger/Gold Glove
# recognize sustained excellence. These are MLB Stats API's own
# award IDs (see /api/v1/awards); deliberately excludes the hundreds of
# minor-league, franchise-specific ("Twins MVP"), and international-league
# awards also listed there.
AWARD_IDS = [
    "ALMVP", "NLMVP",
    "ALCY", "NLCY",
    "ALROY", "NLROY",
    "ALAS", "NLAS",
    "ALSS", "NLSS",
    "ALGG", "NLGG",
]


def fetch_awards_for_season(season: int) -> list[dict]:
    """Returns [{player_id, award_id}] for every tracked award given out that
    season, across both leagues. Player id is MLBAM's own -- no name matching
    needed, unlike the MLBTR-sourced data elsewhere in this pipeline. Some
    award/season combos genuinely don't exist (e.g. no All-Star Game in the
    2020 COVID season) and 404 -- skipped individually rather than failing
    the whole season over one missing award.
    """
    rows: list[dict] = []
    for award_id in AWARD_IDS:
        resp = requests.get(
            AWARDS_URL.format(award_id=award_id),
            params={"season": season},
            timeout=30,
        )
        if resp.status_code == 404:
            continue
        resp.raise_for_status()
        data = resp.json()
        for entry in data.get("awards", []):
            player = entry.get("player")
            if player and player.get("id"):
                rows.append({"player_id": int(player["id"]), "award_id": award_id})
    return rows
