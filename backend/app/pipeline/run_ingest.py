import argparse

from app.db import SessionLocal
from app.pipeline.ingest import ingest_season

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument(
        "--skip-salary",
        action="store_true",
        help="Skip the RosterResource salary fetch (only current rosters are available there, "
        "so this is meant for historical backfills, not the current season).",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        ingest_season(db, args.season, include_salary=not args.skip_salary)
    finally:
        db.close()
