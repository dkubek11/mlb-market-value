"""Shared Hot vs Cold data: real trailing-window AVG (batters) / ERA
(pitchers) pulled from the MLB Stats API, parsed to ``{player_id: value}``
with a playing-time floor, and disk-cached per day so repeated snapshot/API
builds only hit the network at most once per day per group.

Both the served HTML snapshot (``build_dashboard_data``) and the JSON API
payload (``build_dashboard_payload``) consume this, so the two can never
diverge and a JSON client gets the same raw ``last30`` values the rendered
page uses.
"""

import datetime
import json
import time
from pathlib import Path

from app.pipeline import mlb_stats_api

# Playing-time floor for the trailing 30-day window (real AVG/ERA is
# meaningless on a handful of PA/outs).
MIN_LAST30_PA = 40
MIN_LAST30_OUTS = 24  # 8 IP

# Expired copies are kept and used as a fallback so an MLB Stats API outage
# degrades freshness instead of breaking the build.
_CACHE_TTL_SECONDS = 6 * 3600
_CACHE_DIR: Path | None = None


def configure_cache_dir(path: Path) -> None:
    """Point at the shared snapshot-cache directory (must be called before
    fetch_last30; callers co-locate it with their other caches)."""
    global _CACHE_DIR
    _CACHE_DIR = Path(path)


def _cache_dir() -> Path:
    if _CACHE_DIR is None:
        raise RuntimeError("trailing_stats.configure_cache_dir() must be called before use")
    return _CACHE_DIR


def _load(path: Path, max_age_seconds: int) -> tuple[dict[int, float] | None, str]:
    try:
        if path.exists():
            age = time.time() - path.stat().st_mtime
            with path.open(encoding="utf-8") as f:
                data = json.load(f)
            if data:
                # JSON keys come back as strings; normalize so consumers can
                # always look up by int player id regardless of cache origin.
                data = {int(k): v for k, v in data.items()}
                return data, ("fresh" if age <= max_age_seconds else "stale")
    except Exception:
        pass
    return None, "none"


def _save(path: Path, data: dict[int, float]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception as exc:  # noqa: BLE001 -- a cache write must never break the build
        print(f"  (trailing-stats cache write failed: {exc!r})")


def _parse(splits: list[dict], stat_key: str, pt_key: str, min_pt: int) -> dict[int, float]:
    out: dict[int, float] = {}
    for s in splits:
        stat = s.get("stat", {})
        pt = stat.get(pt_key)
        raw_val = stat.get(stat_key)
        pid = s.get("player", {}).get("id")
        if pid is None or pt is None or pt < min_pt or raw_val is None:
            continue
        try:
            out[int(pid)] = float(raw_val)
        except (TypeError, ValueError):
            continue
    return out


def fetch_last30(end_date: datetime.date | None = None) -> tuple[dict[int, float], dict[int, float]]:
    """Return ``({pid: AVG}, {pid: ERA})`` over the 30 real days ending on
    end_date (defaults to today), disk-cached per day (6h TTL)."""
    end = end_date or datetime.date.today()
    day = end.strftime("%Y%m%d")
    cache_dir = _cache_dir()

    batting, _ = _load(cache_dir / f"last30_hitting_{day}.json", _CACHE_TTL_SECONDS)
    if batting is None:
        batting = _parse(mlb_stats_api.fetch_trailing_stats(end, 30, "hitting"), "avg", "plateAppearances", MIN_LAST30_PA)
        _save(cache_dir / f"last30_hitting_{day}.json", batting)

    pitching, _ = _load(cache_dir / f"last30_pitching_{day}.json", _CACHE_TTL_SECONDS)
    if pitching is None:
        pitching = _parse(mlb_stats_api.fetch_trailing_stats(end, 30, "pitching"), "era", "outs", MIN_LAST30_OUTS)
        _save(cache_dir / f"last30_pitching_{day}.json", pitching)

    return batting, pitching
