import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

# Default to credential-free SQLite for local development. Production and
# Docker deployments must provide DATABASE_URL explicitly.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./mlb_market_value.db")

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
