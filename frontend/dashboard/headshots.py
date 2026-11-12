"""Fetches and locally caches player headshots from MLB's own official image
CDN (the same source MLB.com, Baseball Savant, and FanGraphs use), keyed
directly by MLBAM player_id -- no name matching, no separate data source.

Fetches official transparent cutout silhouettes (WebP format, ~3.2KB each)
with graceful fallback to standard headshots if a newly called-up rookie
lacks a silhouette cutout.
"""

import base64
from pathlib import Path

import requests

SILO_URL = "https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_75,f_webp/v1/people/{player_id}/headshot/silo/current"
FALLBACK_HEADSHOT_URL = "https://img.mlbstatic.com/mlb-photos/image/upload/w_60,q_60/v1/people/{player_id}/headshot/67/current"
HEADSHOT_URL = SILO_URL  # For backwards compatibility

CACHE_DIR = Path(__file__).parent / "headshots_cache"


def _cache_path_webp(player_id: int) -> Path:
    return CACHE_DIR / f"{player_id}.webp"


def _cache_path_jpg(player_id: int) -> Path:
    return CACHE_DIR / f"{player_id}.jpg"


def get_headshot_data_uri(player_id: int) -> str | None:
    """Returns a data: URI for this player's headshot, or None if MLB has no
    photo for them (a 404 -- common for very new call-ups). Uses the local
    disk cache when available; only hits the network for players not yet
    cached. Transparent WebP silhouettes take priority over fallback JPEGs."""
    webp_path = _cache_path_webp(player_id)
    if webp_path.exists():
        encoded = base64.b64encode(webp_path.read_bytes()).decode("ascii")
        return f"data:image/webp;base64,{encoded}"

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Try transparent WebP cutout silhouette
    try:
        resp = requests.get(SILO_URL.format(player_id=player_id), timeout=15)
        if resp.status_code == 200 and resp.content:
            webp_path.write_bytes(resp.content)
            encoded = base64.b64encode(resp.content).decode("ascii")
            return f"data:image/webp;base64,{encoded}"
    except requests.RequestException:
        pass

    # 2. If WebP silo not found, check existing fallback JPEG or fetch standard headshot
    jpg_path = _cache_path_jpg(player_id)
    if jpg_path.exists():
        encoded = base64.b64encode(jpg_path.read_bytes()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    try:
        resp = requests.get(FALLBACK_HEADSHOT_URL.format(player_id=player_id), timeout=15)
        if resp.status_code == 200 and resp.content:
            jpg_path.write_bytes(resp.content)
            encoded = base64.b64encode(resp.content).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"
    except requests.RequestException:
        pass

    return None
