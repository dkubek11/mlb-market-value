"""One-off backfill: pull real MVP/Cy Young/Rookie of the Year/All-Star/
Silver Slugger/Gold Glove winners from the MLB Stats API for recent seasons.
Player id is MLBAM's own, so no name matching -- only skips a winner if
they're not in our players table at all (extremely rare in this range).

Usage: py backfill_awards.py
"""

from datetime import datetime, timezone

from sqlalchemy import text

from app.db import engine
from app.pipeline import mlb_awards

# arbHistoryPct/arbTrackPct only ever look 3 seasons back from the current
# platform season, so this window comfortably covers every player whose
# accomplishments credit could actually matter right now without backfilling
# the full historical stat range for no benefit.
SEASONS = list(range(2018, 2027))

INSERT = text("""
    INSERT INTO player_awards (player_id, season, award_id, scraped_at)
    VALUES (:player_id, :season, :award_id, :scraped_at)
    ON CONFLICT (player_id, season, award_id) DO UPDATE SET
        scraped_at = EXCLUDED.scraped_at
""")

with engine.begin() as conn:
    known_player_ids = {row[0] for row in conn.execute(text("SELECT player_id FROM players")).all()}

    now = datetime.now(timezone.utc)
    total_inserted = 0
    for season in SEASONS:
        print(f"[{season}] fetching awards...")
        rows = mlb_awards.fetch_awards_for_season(season)

        matched = skipped = 0
        for row in rows:
            if row["player_id"] not in known_player_ids:
                skipped += 1
                continue
            conn.execute(INSERT, {
                "player_id": row["player_id"],
                "season": season,
                "award_id": row["award_id"],
                "scraped_at": now,
            })
            matched += 1

        total_inserted += matched
        print(f"  total awards: {len(rows)}, matched+inserted: {matched}, skipped (unknown player): {skipped}")

print(f"done. total rows inserted/updated: {total_inserted}")
