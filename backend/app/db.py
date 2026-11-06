import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from pathlib import Path

load_dotenv()

# Default to credential-free SQLite for local development. Production and
# Docker deployments must provide DATABASE_URL explicitly.
_DEFAULT_SQLITE_PATH = (Path(__file__).resolve().parent.parent / "mlb_market_value.db").as_posix()
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{_DEFAULT_SQLITE_PATH}")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
