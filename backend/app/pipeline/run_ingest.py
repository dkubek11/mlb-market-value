import argparse

from app.db import SessionLocal
from app.pipeline.ingest import ingest_season

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        ingest_season(db, args.season)
    finally:
        db.close()
