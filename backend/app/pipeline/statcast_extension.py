import requests
import pybaseball as pb

MLB_SEASONS_API = "https://statsapi.mlb.com/api/v1/seasons"


def _season_date_range(season: int) -> tuple[str, str]:
    resp = requests.get(MLB_SEASONS_API, params={"sportId": 1, "season": season}, timeout=15)
    resp.raise_for_status()
    info = resp.json()["seasons"][0]
    start = info["regularSeasonStartDate"]
    end = min(info["regularSeasonEndDate"], _today())
    return start, end


def _today() -> str:
    import datetime

    return datetime.date.today().isoformat()


def fetch_extension(season: int) -> dict[int, float]:
    """Average release extension per pitcher, in feet.

    Not available on any per-season leaderboard (Statcast/FanGraphs only expose
    it per-pitch), so this pulls the full season's pitch-by-pitch Statcast feed
    and averages it -- much heavier than the other pipeline fetches.
    """
    start, end = _season_date_range(season)
    df = pb.statcast(start_dt=start, end_dt=end, verbose=False)
    df = df.dropna(subset=["release_extension", "pitcher"])
    grouped = df.groupby("pitcher")["release_extension"].mean()
    return {int(pid): round(float(val), 2) for pid, val in grouped.items()}
