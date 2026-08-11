"""Regenerates the dashboard's data snapshot (dashboard_data.json) from the live
database. Run this any time after the backend pipeline (run_ingest.py /
run_compute_value.py) refreshes, then run splice_dashboard.py to bake it into a
publishable HTML file.

This script is a thin wrapper around
``app.dashboard_data.build_dashboard_payload`` -- the same function the FastAPI
``GET /api/dashboard`` endpoint uses -- so the offline snapshot and the live API
can never diverge.

Usage: py build_dashboard.py [season]  (defaults to current year)
"""

import datetime
import json
import os
import sys
from pathlib import Path

# Make the backend package importable regardless of where this script is run
# from (local Windows dev box, WSL, or the Docker container). The old version
# hardcoded a Windows path, which broke inside the container image.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))

from app.dashboard_data import build_dashboard_payload  # noqa: E402

HERE = Path(__file__).parent
season = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("SEASON", datetime.date.today().year))


def main() -> None:
    out = build_dashboard_payload(season)
    with open(HERE / "dashboard_data.json", "w", encoding="utf-8") as f:
        json.dump(out, f)

    all_players = out["allPlayers"]
    with_proj_batters = sum(1 for p in all_players if p["isBatter"] and p["projected"]["xba"] is not None)
    with_proj_pitchers = sum(1 for p in all_players if not p["isBatter"] and p["projected"]["xera"] is not None)
    with_comps_batters = sum(1 for p in all_players if p["isBatter"] and p["nComps"] > 0)
    with_comps_pitchers = sum(1 for p in all_players if not p["isBatter"] and p["nComps"] > 0)
    batters = sum(1 for p in all_players if p["isBatter"])
    pitchers = len(all_players) - batters
    print(f"batters: {batters}, pitchers: {pitchers}, total: {len(all_players)}")
    print(f"batters with projection: {with_proj_batters}/{batters}, pitchers with projection: {with_proj_pitchers}/{pitchers}")
    print(f"batters with comps: {with_comps_batters}/{batters}, pitchers with comps: {with_comps_pitchers}/{pitchers}")
    print(f"teams: {len(out['teams'])}, contracts: {len(out['contracts'])}")
    print("wrote", HERE / "dashboard_data.json")


if __name__ == "__main__":
    main()
