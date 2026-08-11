"""One-off backfill: populate hits/games/war (batters) and wins/saves/
games_started/war (pitchers) for historical seasons 2021-2025. These columns
were added mid-project (after the original historical backfill ran with
--skip-salary), so existing rows have them NULL. Targeted UPDATE only --
does not touch Statcast/FanGraphs plate-discipline/extension data, which is
already correct, so no need to re-run the full (slow) ingest pipeline.

Usage: py backfill_traditional_stats.py
"""

from sqlalchemy import text

from app.db import engine
from app.pipeline import fangraphs_batting, fangraphs_pitching, mlb_stats_api

SEASONS = [2021, 2022, 2023, 2024, 2025]

BATTER_UPDATE = text("""
    UPDATE batter_stats SET hits=:hits, games=:games, war=:war
    WHERE player_id=:player_id AND season=:season
""")
PITCHER_UPDATE = text("""
    UPDATE pitcher_stats SET wins=:wins, saves=:saves, games_started=:games_started, war=:war
    WHERE player_id=:player_id AND season=:season
""")

with engine.begin() as conn:
    for season in SEASONS:
        print(f"[{season}] fetching MLB Stats API bulk stats + FanGraphs WAR...")
        hitting_splits = mlb_stats_api.fetch_bulk_stats(season, "hitting")
        pitching_splits = mlb_stats_api.fetch_bulk_stats(season, "pitching")
        batter_war = fangraphs_batting.fetch_plate_discipline(season)
        pitcher_war = fangraphs_pitching.fetch_plate_discipline(season)

        existing_batters = {
            r[0] for r in conn.execute(
                text("SELECT player_id FROM batter_stats WHERE season=:season"), {"season": season}
            )
        }
        existing_pitchers = {
            r[0] for r in conn.execute(
                text("SELECT player_id FROM pitcher_stats WHERE season=:season"), {"season": season}
            )
        }

        b_updated = 0
        for split in hitting_splits:
            pid = split["player"]["id"]
            if pid not in existing_batters:
                continue
            stat = split["stat"]
            conn.execute(BATTER_UPDATE, {
                "hits": stat.get("hits"),
                "games": stat.get("gamesPlayed"),
                "war": batter_war.get(pid, {}).get("war"),
                "player_id": pid,
                "season": season,
            })
            b_updated += 1

        p_updated = 0
        for split in pitching_splits:
            pid = split["player"]["id"]
            if pid not in existing_pitchers:
                continue
            stat = split["stat"]
            conn.execute(PITCHER_UPDATE, {
                "wins": stat.get("wins"),
                "saves": stat.get("saves"),
                "games_started": stat.get("gamesStarted"),
                "war": pitcher_war.get(pid, {}).get("war"),
                "player_id": pid,
                "season": season,
            })
            p_updated += 1

        print(f"[{season}] updated batters: {b_updated}/{len(existing_batters)}, "
              f"pitchers: {p_updated}/{len(existing_pitchers)}")

print("done.")
