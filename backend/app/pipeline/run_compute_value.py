import argparse

from app.db import SessionLocal
from app.pipeline.compute_value import compute_player_value, compute_team_payroll_summary

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        n_players = compute_player_value(db, args.season)
        print(f"[{args.season}] computed player_value for {n_players} players")
        n_teams = compute_team_payroll_summary(db, args.season)
        print(f"[{args.season}] computed team_payroll_summary for {n_teams} teams")
    finally:
        db.close()
