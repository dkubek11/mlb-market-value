"""Fetches and locally caches team logos from MLB's own official static CDN
(the same source MLB.com itself uses), keyed directly by MLBAM team_id -- no
name matching, no separate data source. Only 30 teams, so unlike headshots
there's no meaningful "missing" case to tolerate.

SVGs (a few KB each) since these end up base64-embedded directly in the
published HTML: a published Claude Artifact's CSP blocks requests to any
external host, including remote images, so a plain <img src="https://...">
would just show broken images once published -- everything has to be a
data: URI, same as the headshots/fonts/textures already baked into this site.

Cached to disk by team_id -- a team's logo essentially never changes
mid-season, so a nightly refresh only fetches teams not already cached.
"""

import base64
from pathlib import Path

import requests

LOGO_URL = "https://www.mlbstatic.com/team-logos/{team_id}.svg"
CACHE_DIR = Path(__file__).parent / "logos_cache"


def _cache_path(team_id: int) -> Path:
    return CACHE_DIR / f"{team_id}.svg"


def get_team_logo_data_uri(team_id: int) -> str | None:
    """Returns a data: URI for this team's logo, or None on a fetch failure.
    Uses the local disk cache when available; only hits the network for
    teams not yet cached."""
    path = _cache_path(team_id)
    if not path.exists():
        try:
            resp = requests.get(LOGO_URL.format(team_id=team_id), timeout=15)
        except requests.RequestException:
            return None
        if resp.status_code != 200 or not resp.content:
            return None
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_bytes(resp.content)

    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"
