"""Fetches and locally caches player headshots from MLB's own official image
CDN (the same source MLB.com, Baseball Savant, and FanGraphs use), keyed
directly by MLBAM player_id -- no name matching, no separate data source.

Small (60px wide, ~4.5KB each) since these end up base64-embedded directly
in the published HTML: a published Claude Artifact's CSP blocks requests to
any external host, including remote images, so a plain <img src="https://...">
would just show broken images once published -- everything has to be a
data: URI, same as the fonts/textures already baked into this site.

Cached to disk by player_id so a nightly refresh only fetches players who
don't already have one cached (a real headshot never changes once it
exists) -- a rookie with no photo yet simply gets retried next time rather
than cached as a permanent miss, so they pick one up automatically the
first night MLB adds one.
"""

import base64
from pathlib import Path

import requests

HEADSHOT_URL = "https://img.mlbstatic.com/mlb-photos/image/upload/w_60,q_60/v1/people/{player_id}/headshot/67/current"
CACHE_DIR = Path(__file__).parent / "headshots_cache"


def _cache_path(player_id: int) -> Path:
    return CACHE_DIR / f"{player_id}.jpg"


def get_headshot_data_uri(player_id: int) -> str | None:
    """Returns a data: URI for this player's headshot, or None if MLB has no
    photo for them (a 404 -- common for very new call-ups). Uses the local
    disk cache when available; only hits the network for players not yet
    cached."""
    path = _cache_path(player_id)
    if not path.exists():
        try:
            resp = requests.get(HEADSHOT_URL.format(player_id=player_id), timeout=15)
        except requests.RequestException:
            return None
        if resp.status_code != 200 or not resp.content:
            return None
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)

    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"
