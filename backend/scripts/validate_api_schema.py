"""Validate the GET /api/dashboard payload contract with Pydantic models that
mirror the exact shape ``app.dashboard_data.build_dashboard_payload`` returns
(which is the same contract the browser-side dashboard code consumes).

Two modes:

* Live (default): builds the payload against the database via
  ``app.dashboard_data.build_dashboard_payload`` and validates it. No web
  server is launched; the builder exercises the same SQL + serialization the
  HTTP endpoint uses (minus only the FastAPI wrapper).

* Fixture: ``--fixture <path>`` reads a JSON file (e.g. a previously built
  ``frontend/dashboard/dashboard_data.json``) and validates it with the same
  models. No DB/network needed.

Run from backend/:

    DATABASE_URL="sqlite:///./mlb_market_value.db" \
        .venv/bin/python -m scripts.validate_api_schema --season 2026
    .venv/bin/python -m scripts.validate_api_schema \
        --fixture ../frontend/dashboard/dashboard_data.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

# Number of team color mappings expected for a fully-populated season (30 MLB
# clubs). Only enforced in live mode unless --allow-empty is passed.
EXPECTED_TEAM_COLORS = 30


class PlayerRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    team: str
    position: str
    isBatter: bool
    isPreArb: bool
    salary: float
    aav: float
    contractType: str | None
    stats: dict[str, Any]
    age: float | None
    projected: dict[str, Any]
    nComps: int


class TeamRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    abbr: str
    name: str
    league: str
    division: str
    payroll: float


class PositionStatSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    mean: float
    std: float


class RosterEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str


class ContractYear(BaseModel):
    model_config = ConfigDict(extra="allow")

    season: int
    salary: float | None
    aav: float | None
    type: str | None


class ContractEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    contractType: str | None
    yearsTotal: float | int | None
    startSeason: float | int | None
    endSeasonAll: float | int | None
    totalGuaranteed: float | None
    signingBonus: float | None
    years: list[ContractYear]


class DashboardPayload(BaseModel):
    """Top-level /api/dashboard contract (mirrors the payload produced by
    build_dashboard_payload in app/dashboard_data.py). extra="forbid" so a
    drifted backend that adds/renames a top-level key fails loudly instead of
    passing silently."""

    model_config = ConfigDict(extra="forbid")

    allPlayers: list[PlayerRecord]
    positionStats: dict[str, dict[str, PositionStatSummary | None]]
    teams: list[TeamRecord]
    rosters: dict[str, dict[str, RosterEntry]]
    teamColors: dict[str, list[str]]
    contracts: dict[str, ContractEntry]
    capturedAt: str


def validate_live(season: int, allow_empty: bool) -> DashboardPayload:
    try:
        from app.dashboard_data import build_dashboard_payload
    except ImportError as exc:
        print(f"Error importing app.dashboard_data: {exc}")
        print("Run this script from the backend directory: python -m scripts.validate_api_schema")
        raise SystemExit(1)

    print(f"Fetching dashboard payload for season {season}...")
    data = build_dashboard_payload(season, fetch_live_contracts=False)
    return validate_payload(data, allow_empty=allow_empty, mode="live")


def validate_fixture(path: Path, allow_empty: bool) -> DashboardPayload:
    print(f"Validating fixture {path}...")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as exc:
        print(f"Error reading fixture: {exc}")
        raise SystemExit(1)
    return validate_payload(data, allow_empty=allow_empty, mode="fixture")


def validate_payload(data: dict, *, allow_empty: bool, mode: str) -> DashboardPayload:
    try:
        validated = DashboardPayload(**data)
    except ValidationError as exc:
        print("Schema Validation Failed:")
        print(exc.json(indent=2))
        raise SystemExit(1)

    n_players = len(validated.allPlayers)
    n_teams = len(validated.teams)
    n_rosters = len(validated.rosters)
    n_contracts = len(validated.contracts)
    n_colors = len(validated.teamColors)

    print(f"Schema validation passed: payload matches the expected API contract.")
    print(
        f"Verified {n_players} player records, {n_teams} team records, "
        f"{n_rosters} roster maps, {n_contracts} contract entries, "
        f"{n_colors} team color mappings, capturedAt={validated.capturedAt!r}."
    )

    if mode == "live" and not allow_empty:
        problems = []
        if n_players == 0:
            problems.append("allPlayers is empty (season not ingested? run the pipeline first)")
        if n_teams == 0:
            problems.append("teams is empty")
        if n_colors != EXPECTED_TEAM_COLORS:
            problems.append(f"teamColors has {n_colors} entries (expected {EXPECTED_TEAM_COLORS})")
        if problems:
            print("Data-presence validation failed:")
            for p in problems:
                print(f"  - {p}")
            print("(pass --allow-empty to skip these thresholds for a schema-only check)")
            raise SystemExit(1)

    return validated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=date.today().year,
                        help="Season to validate (live mode only; default: current year)")
    parser.add_argument("--fixture", type=Path, default=None,
                        help="Validate a JSON file instead of the live database")
    parser.add_argument("--allow-empty", action="store_true",
                        help="Skip the data-presence thresholds (schema-only check)")
    args = parser.parse_args()

    if args.fixture is not None:
        validate_fixture(args.fixture, allow_empty=args.allow_empty)
    else:
        validate_live(args.season, allow_empty=args.allow_empty)
    print("Schema Validation Passed: payload matches expected frontend interface types.")


if __name__ == "__main__":
    main()
