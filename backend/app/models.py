import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class League(str, enum.Enum):
    AL = "AL"
    NL = "NL"


class Position(str, enum.Enum):
    C = "C"
    FIRST_BASE = "1B"
    SECOND_BASE = "2B"
    THIRD_BASE = "3B"
    SS = "SS"
    LF = "LF"
    CF = "CF"
    RF = "RF"
    DH = "DH"
    SP = "SP"
    RP = "RP"


class PlayerType(str, enum.Enum):
    BATTER = "batter"
    PITCHER = "pitcher"


# Postgres column/type names are unquoted by default, and "position" collides
# with the POSITION() SQL keyword -- so these enum types need explicit names.
league_enum = Enum(League, name="league_enum")
position_enum = Enum(Position, name="position_enum")
player_type_enum = Enum(PlayerType, name="player_type_enum")


class Team(Base):
    __tablename__ = "teams"

    team_id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    abbreviation: Mapped[str] = mapped_column(String(3), unique=True)
    name: Mapped[str] = mapped_column(String(50))
    league: Mapped[League] = mapped_column(league_enum)
    division: Mapped[str] = mapped_column(String(20))

    players: Mapped[list["PlayerSeason"]] = relationship(back_populates="team")


class Player(Base):
    __tablename__ = "players"

    player_id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100))
    birthdate: Mapped[date | None] = mapped_column(Date)
    bats: Mapped[str | None] = mapped_column(String(1))
    throws: Mapped[str | None] = mapped_column(String(1))
    debut_date: Mapped[date | None] = mapped_column(Date)

    seasons: Mapped[list["PlayerSeason"]] = relationship(back_populates="player")


class PlayerSeason(Base):
    __tablename__ = "player_seasons"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    player_type: Mapped[PlayerType] = mapped_column(player_type_enum, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    position: Mapped[Position] = mapped_column(position_enum)

    player: Mapped["Player"] = relationship(back_populates="seasons")
    team: Mapped["Team"] = relationship(back_populates="players")


class PlayerSalary(Base):
    __tablename__ = "player_salaries"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    aav: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    contract_years_total: Mapped[int | None] = mapped_column(SmallInteger)
    contract_type: Mapped[str | None] = mapped_column(String(40))
    # Real accrued MLB service time (years.days, e.g. 3.159 = 3 years, 159
    # days) as of that season's arbitration cycle, scraped from MLB Trade
    # Rumors' arbitration tracker -- the authoritative figure MLB itself uses
    # to determine Arb1/2/3 and Super Two status. Only populated for players
    # who appear in that season's tracker (i.e. actually arbitration-
    # eligible that year); null otherwise.
    service_time: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    source: Mapped[str] = mapped_column(String(20))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BatterStats(Base):
    __tablename__ = "batter_stats"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    pa: Mapped[int | None]
    ba: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    obp: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    slg: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    ops: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    xba: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    xslg: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    xwoba: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    woba: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    hr: Mapped[int | None] = mapped_column(SmallInteger)
    rbi: Mapped[int | None] = mapped_column(SmallInteger)
    sb: Mapped[int | None] = mapped_column(SmallInteger)
    hits: Mapped[int | None] = mapped_column(SmallInteger)
    games: Mapped[int | None] = mapped_column(SmallInteger)
    barrel_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    hard_hit_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    avg_exit_velo: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    sprint_speed: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    k_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    bb_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    chase_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    whiff_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    war: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    source: Mapped[str] = mapped_column(String(20))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PitcherStats(Base):
    __tablename__ = "pitcher_stats"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    ip: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    era: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    whip: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    fip: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    k_9: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    bb_9: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    wins: Mapped[int | None] = mapped_column(SmallInteger)
    saves: Mapped[int | None] = mapped_column(SmallInteger)
    games_started: Mapped[int | None] = mapped_column(SmallInteger)
    xera: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    xwoba_against: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    xba_against: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    hard_hit_rate_against: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    barrel_rate_against: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    avg_exit_velo_against: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    k_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    bb_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    chase_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    whiff_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    z_swing_rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    # Release extension in feet -- not on any per-season leaderboard, so this is
    # averaged from a full-season pitch-by-pitch Statcast pull (statcast_extension.py).
    extension: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    # FanGraphs pitch-modeling grades, scaled to 100 = league average.
    stuff_plus: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    location_plus: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    war: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    source: Mapped[str] = mapped_column(String(20))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FieldingStats(Base):
    __tablename__ = "fielding_stats"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    innings: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    oaa: Mapped[int | None] = mapped_column(SmallInteger)
    frv: Mapped[int | None] = mapped_column(SmallInteger)
    drs: Mapped[int | None] = mapped_column(SmallInteger)
    source: Mapped[str] = mapped_column(String(20))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlayerValue(Base):
    __tablename__ = "player_value"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    player_type: Mapped[PlayerType] = mapped_column(player_type_enum, primary_key=True)
    position: Mapped[Position] = mapped_column(position_enum)
    composite_percentile: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    salary_percentile: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    value_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    # Set only for pre-arbitration players, who are excluded from value_score
    # (their salary is fixed near the league minimum by rule, not the market, so
    # comparing it to performance isn't a meaningful signal). Estimated as the
    # median AAV of comparable-performing market-priced peers at their position.
    projected_salary: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TeamPayrollSummary(Base):
    __tablename__ = "team_payroll_summary"

    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    total_payroll: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    avg_value_score: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ArbOutcome(Base):
    """Real, historical arbitration settlement/award outcomes scraped from MLB
    Trade Rumors' yearly arbitration tracker posts -- used to comp pre-arb/
    arb-eligible players against real multi-year peer outcomes instead of
    just the current season's ~150-player pool. platform_season is the
    performance season the salary/service_time were decided on (tracker
    year minus 1); service_time is MLB's own real accrued-days figure, the
    actual CBA input (not the debut-year proxy used as a fallback elsewhere)."""

    __tablename__ = "arb_outcomes"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    platform_season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    service_time: Mapped[Decimal] = mapped_column(Numeric(5, 3))
    actual_salary: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    source: Mapped[str] = mapped_column(String(20))
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlayerAward(Base):
    """Real major-league awards/honors per player-season, from the MLB Stats
    API's own awards endpoint (MVP, Cy Young, Rookie of the Year, All-Star,
    Silver Slugger, Gold Glove). Real arbitration panels explicitly credit
    these as "special accomplishments" on top of the raw stat line -- this
    table is what lets the dashboard do the same instead of only ever
    comping off traditional stats."""

    __tablename__ = "player_awards"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.player_id"), primary_key=True)
    season: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    award_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
