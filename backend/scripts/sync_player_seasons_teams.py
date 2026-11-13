"""Synchronize player_seasons.team_id with authoritative latest team.

Updates player_seasons rows so every player is attributed to the last team they
were with in each season, matching player_salaries / stats tables.
"""

from sqlalchemy import text
from app.db import engine


def sync_teams(season: int | None = None) -> int:
    season_clause = "WHERE ps.season = :season" if season is not None else ""
    params = {"season": season} if season is not None else {}
    
    with engine.begin() as conn:
        # 1. Synchronize from player_salaries (authoritative current/last team)
        res_sal = conn.execute(text(f"""
            UPDATE player_seasons
            SET team_id = (
                SELECT sal.team_id
                FROM player_salaries sal
                WHERE sal.player_id = player_seasons.player_id
                  AND sal.season = player_seasons.season
                  AND sal.team_id IS NOT NULL
            )
            WHERE EXISTS (
                SELECT 1 FROM player_salaries sal
                WHERE sal.player_id = player_seasons.player_id
                  AND sal.season = player_seasons.season
                  AND sal.team_id IS NOT NULL
                  AND sal.team_id != player_seasons.team_id
            )
            {"AND season = :season" if season else ""}
        """), params)
        updated_sal = res_sal.rowcount

        # 2. Synchronize batters without salary row from batter_stats
        res_bat = conn.execute(text(f"""
            UPDATE player_seasons
            SET team_id = (
                SELECT bs.team_id
                FROM batter_stats bs
                WHERE bs.player_id = player_seasons.player_id
                  AND bs.season = player_seasons.season
                  AND bs.team_id IS NOT NULL
            )
            WHERE player_type = 'BATTER'
              AND NOT EXISTS (
                  SELECT 1 FROM player_salaries sal
                  WHERE sal.player_id = player_seasons.player_id AND sal.season = player_seasons.season
              )
              AND EXISTS (
                  SELECT 1 FROM batter_stats bs
                  WHERE bs.player_id = player_seasons.player_id
                    AND bs.season = player_seasons.season
                    AND bs.team_id IS NOT NULL
                    AND bs.team_id != player_seasons.team_id
              )
              {"AND season = :season" if season else ""}
        """), params)
        updated_bat = res_bat.rowcount

        # 3. Synchronize pitchers without salary row from pitcher_stats
        res_pitch = conn.execute(text(f"""
            UPDATE player_seasons
            SET team_id = (
                SELECT pss.team_id
                FROM pitcher_stats pss
                WHERE pss.player_id = player_seasons.player_id
                  AND pss.season = player_seasons.season
                  AND pss.team_id IS NOT NULL
            )
            WHERE player_type = 'PITCHER'
              AND NOT EXISTS (
                  SELECT 1 FROM player_salaries sal
                  WHERE sal.player_id = player_seasons.player_id AND sal.season = player_seasons.season
              )
              AND EXISTS (
                  SELECT 1 FROM pitcher_stats pss
                  WHERE pss.player_id = player_seasons.player_id
                    AND pss.season = player_seasons.season
                    AND pss.team_id IS NOT NULL
                    AND pss.team_id != player_seasons.team_id
              )
              {"AND season = :season" if season else ""}
        """), params)
        updated_pitch = res_pitch.rowcount

    total = updated_sal + updated_bat + updated_pitch
    print(f"Synchronized {total} player_seasons rows (salaries: {updated_sal}, batters: {updated_bat}, pitchers: {updated_pitch})")
    return total


if __name__ == "__main__":
    sync_teams()

