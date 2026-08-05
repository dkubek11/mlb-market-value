from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import (
    BatterStats,
    FieldingStats,
    League,
    PitcherStats,
    Player,
    PlayerSalary,
    PlayerSeason,
    PlayerType,
    Position,
    Team,
)
from app.pipeline import (
    fangraphs_batting,
    fangraphs_pitching,
    fangraphs_salary,
    fielding_metrics,
    mlb_stats_api,
    statcast_extension,
    statcast_metrics,
)

SOURCE_STATS = "mlb_api+statcast"
SOURCE_FIELDING = "statcast+fangraphs"
SOURCE_SALARY = "fangraphs_rr"

BATTER_POSITIONS = {"C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"}


def _clean_stat(value):
    """The MLB Stats API returns sentinel strings like '-.--' for undefined
    rate stats (e.g. ERA when a pitcher has 0.0 IP). Treat those as NULL."""
    if isinstance(value, str) and not any(ch.isdigit() for ch in value):
        return None
    return value


def _parse_ip_to_decimal_outs(ip_str: str) -> Decimal:
    """MLB's innings-pitched notation uses .1/.2 for thirds of an inning, not true
    decimal. Converts e.g. '104.1' (104 and 1/3 IP) to true decimal 104.333..."""
    whole_str, _, frac_str = ip_str.partition(".")
    whole = int(whole_str or 0)
    frac = int(frac_str or 0)  # 0, 1, or 2 (thirds of an inning)
    outs = whole * 3 + frac
    return Decimal(outs) / Decimal(3)


def _classify_pitcher_position(games_started: int, games_pitched: int) -> Position:
    if games_pitched == 0:
        return Position.RP
    return Position.SP if (games_started / games_pitched) >= 0.5 else Position.RP


def _compute_fip_constant(pitching_splits: list[dict]) -> Decimal:
    total_hr = total_bb = total_hbp = total_k = total_er = 0
    total_true_ip = Decimal(0)
    for split in pitching_splits:
        stat = split["stat"]
        total_hr += stat.get("homeRuns", 0)
        total_bb += stat.get("baseOnBalls", 0)
        total_hbp += stat.get("hitBatsmen", 0)
        total_k += stat.get("strikeOuts", 0)
        total_er += stat.get("earnedRuns", 0)
        total_true_ip += _parse_ip_to_decimal_outs(stat.get("inningsPitched", "0.0"))

    if total_true_ip == 0:
        return Decimal("3.10")  # fallback: typical recent-era FIP constant

    league_era = Decimal(9) * Decimal(total_er) / total_true_ip
    raw_component = (
        Decimal(13) * total_hr + Decimal(3) * (total_bb + total_hbp) - Decimal(2) * total_k
    ) / total_true_ip
    return league_era - raw_component


def _resolve_team_id(split: dict, season: int, group: str) -> int | None:
    if split.get("numTeams", 1) <= 1:
        return split["team"]["id"]
    return mlb_stats_api.resolve_traded_player_team(split["player"]["id"], season, group)


def _upsert_teams(db: Session, season: int) -> None:
    for t in mlb_stats_api.fetch_teams(season):
        db.merge(
            Team(
                team_id=t["team_id"],
                abbreviation=t["abbreviation"],
                name=t["name"],
                league=League(t["league"]),
                division=t["division"],
            )
        )


def _upsert_players(db: Session, player_ids: set[int]) -> None:
    bios = mlb_stats_api.fetch_people_bio(sorted(player_ids))
    for pid in player_ids:
        bio = bios.get(pid, {})
        db.merge(
            Player(
                player_id=pid,
                full_name=bio.get("full_name") or f"Unknown ({pid})",
                birthdate=bio.get("birthdate"),
                bats=bio.get("bats"),
                throws=bio.get("throws"),
                debut_date=bio.get("debut_date"),
            )
        )


def _ingest_salaries(
    db: Session,
    season: int,
    now: datetime,
    resolved_teams: dict[int, int],
    salary_rows: list[dict],
    abbreviation_to_team_id: dict[str, int],
) -> tuple[int, int]:
    rows_by_player: dict[int, list[dict]] = {}
    for row in salary_rows:
        if row["salary"] is None or row["aav"] is None:
            continue
        rows_by_player.setdefault(row["player_id"], []).append(row)

    ingested = skipped = 0
    for pid, rows in rows_by_player.items():
        total_salary = sum(Decimal(str(r["salary"])) for r in rows)

        # A player traded mid-season (or dropped by one club and picked up by
        # another) can show up with multiple contract rows in the same
        # season -- usually one substantial deal plus a small incremental
        # pickup. For "what's this player's real contractual value" purposes
        # we want the substantial one, so pick by highest AAV rather than by
        # whichever team happens to match their current playing team (that
        # previously picked, e.g., a $780K rounding-error stint over a real
        # $20M guaranteed deal for a player traded mid-season).
        final_team_id = resolved_teams.get(pid)
        chosen = max(rows, key=lambda r: r["aav"] or 0)
        team_id = final_team_id or abbreviation_to_team_id.get(chosen["team_abbreviation"])
        if team_id is None:
            skipped += 1
            continue

        db.merge(
            PlayerSalary(
                player_id=pid,
                season=season,
                team_id=team_id,
                salary=total_salary,
                aav=Decimal(str(chosen["aav"])),
                contract_years_total=chosen["contract_years_total"],
                contract_type=chosen["contract_type"],
                source=SOURCE_SALARY,
                scraped_at=now,
            )
        )
        ingested += 1

    return ingested, skipped


def ingest_season(db: Session, season: int, include_salary: bool = True) -> None:
    """include_salary=False skips the RosterResource salary fetch -- useful for
    historical backfills, since RosterResource only exposes *current* rosters
    and re-running it for a past season would just mislabel today's salaries
    under the wrong year, not recover what players actually earned back then."""
    now = datetime.now(timezone.utc)

    print(f"[{season}] fetching teams...")
    _upsert_teams(db, season)
    db.commit()

    print(f"[{season}] fetching bulk hitting/pitching stats...")
    hitting_splits = mlb_stats_api.fetch_bulk_stats(season, "hitting")
    pitching_splits = mlb_stats_api.fetch_bulk_stats(season, "pitching")

    all_player_ids = {s["player"]["id"] for s in hitting_splits} | {
        s["player"]["id"] for s in pitching_splits
    }
    print(f"[{season}] fetching bio data for {len(all_player_ids)} players...")
    _upsert_players(db, all_player_ids)
    db.commit()

    print(f"[{season}] fetching Statcast advanced metrics...")
    batter_advanced = statcast_metrics.fetch_batter_advanced(season)
    pitcher_advanced = statcast_metrics.fetch_pitcher_advanced(season)
    plate_discipline = fangraphs_batting.fetch_plate_discipline(season)
    pitcher_discipline = fangraphs_pitching.fetch_plate_discipline(season)
    print(f"[{season}] fetching pitch-by-pitch Statcast data for release extension...")
    pitcher_extension = statcast_extension.fetch_extension(season)

    fip_constant = _compute_fip_constant(pitching_splits)
    print(f"[{season}] computed FIP constant: {fip_constant:.3f}")

    resolved_teams: dict[int, int] = {}

    skipped_batters = 0
    for split in hitting_splits:
        stat = split["stat"]
        pos_abbrev = split.get("position", {}).get("abbreviation")
        if pos_abbrev not in BATTER_POSITIONS:
            skipped_batters += 1
            continue

        pid = split["player"]["id"]
        team_id = _resolve_team_id(split, season, "hitting")
        if team_id is None:
            skipped_batters += 1
            continue

        pa = stat.get("plateAppearances") or 0
        adv = batter_advanced.get(pid, {})
        pd_row = plate_discipline.get(pid, {})
        resolved_teams[pid] = team_id

        db.merge(
            PlayerSeason(
                player_id=pid,
                season=season,
                player_type=PlayerType.BATTER,
                team_id=team_id,
                position=Position(pos_abbrev),
            )
        )
        db.merge(
            BatterStats(
                player_id=pid,
                season=season,
                team_id=team_id,
                pa=pa,
                ba=_clean_stat(stat.get("avg")),
                obp=_clean_stat(stat.get("obp")),
                slg=_clean_stat(stat.get("slg")),
                ops=_clean_stat(stat.get("ops")),
                xba=adv.get("xba"),
                xslg=adv.get("xslg"),
                xwoba=adv.get("xwoba"),
                woba=adv.get("woba"),
                hr=stat.get("homeRuns"),
                rbi=stat.get("rbi"),
                sb=stat.get("stolenBases"),
                hits=stat.get("hits"),
                games=stat.get("gamesPlayed"),
                barrel_rate=adv.get("barrel_rate"),
                hard_hit_rate=adv.get("hard_hit_rate"),
                avg_exit_velo=adv.get("avg_exit_velo"),
                sprint_speed=adv.get("sprint_speed"),
                k_rate=(Decimal(stat["strikeOuts"]) / pa) if pa else None,
                bb_rate=(Decimal(stat["baseOnBalls"]) / pa) if pa else None,
                chase_rate=pd_row.get("chase_rate"),
                whiff_rate=pd_row.get("whiff_rate"),
                source=SOURCE_STATS,
                scraped_at=now,
            )
        )

    skipped_pitchers = 0
    for split in pitching_splits:
        stat = split["stat"]
        pid = split["player"]["id"]
        team_id = _resolve_team_id(split, season, "pitching")
        if team_id is None:
            skipped_pitchers += 1
            continue

        games_started = stat.get("gamesStarted", 0)
        games_pitched = stat.get("gamesPitched", 0)
        position = _classify_pitcher_position(games_started, games_pitched)

        true_ip = _parse_ip_to_decimal_outs(stat.get("inningsPitched", "0.0"))
        fip = None
        if true_ip > 0:
            fip = (
                Decimal(13) * stat.get("homeRuns", 0)
                + Decimal(3) * (stat.get("baseOnBalls", 0) + stat.get("hitBatsmen", 0))
                - Decimal(2) * stat.get("strikeOuts", 0)
            ) / true_ip + fip_constant

        adv = pitcher_advanced.get(pid, {})
        pd_row = pitcher_discipline.get(pid, {})
        resolved_teams[pid] = team_id

        db.merge(
            PlayerSeason(
                player_id=pid,
                season=season,
                player_type=PlayerType.PITCHER,
                team_id=team_id,
                position=position,
            )
        )
        db.merge(
            PitcherStats(
                player_id=pid,
                season=season,
                team_id=team_id,
                ip=_clean_stat(stat.get("inningsPitched")),
                era=_clean_stat(stat.get("era")),
                whip=_clean_stat(stat.get("whip")),
                fip=fip,
                k_9=_clean_stat(stat.get("strikeoutsPer9Inn")),
                bb_9=_clean_stat(stat.get("walksPer9Inn")),
                wins=stat.get("wins"),
                saves=stat.get("saves"),
                games_started=games_started,
                xera=adv.get("xera"),
                xwoba_against=adv.get("xwoba_against"),
                xba_against=adv.get("xba_against"),
                hard_hit_rate_against=adv.get("hard_hit_rate_against"),
                barrel_rate_against=adv.get("barrel_rate_against"),
                avg_exit_velo_against=adv.get("avg_exit_velo_against"),
                k_rate=pd_row.get("k_rate"),
                bb_rate=pd_row.get("bb_rate"),
                chase_rate=pd_row.get("chase_rate"),
                whiff_rate=pd_row.get("whiff_rate"),
                z_swing_rate=pd_row.get("z_swing_rate"),
                extension=pitcher_extension.get(pid),
                stuff_plus=pd_row.get("stuff_plus"),
                location_plus=pd_row.get("location_plus"),
                source=SOURCE_STATS,
                scraped_at=now,
            )
        )

    print(f"[{season}] fetching fielding metrics (OAA/FRV from Statcast, DRS from FanGraphs)...")
    oaa_frv = fielding_metrics.fetch_oaa_frv(season)
    drs = fielding_metrics.fetch_drs(season)
    fielding_player_ids = set(oaa_frv) | set(drs)

    skipped_fielders = 0
    for pid in fielding_player_ids:
        team_id = resolved_teams.get(pid)
        if team_id is None:
            skipped_fielders += 1
            continue

        oaa_row = oaa_frv.get(pid, {})
        drs_row = drs.get(pid, {})

        db.merge(
            FieldingStats(
                player_id=pid,
                season=season,
                team_id=team_id,
                innings=drs_row.get("innings"),
                oaa=oaa_row.get("oaa"),
                frv=oaa_row.get("frv"),
                drs=drs_row.get("drs"),
                source=SOURCE_FIELDING,
                scraped_at=now,
            )
        )

    db.commit()

    if include_salary:
        print(f"[{season}] fetching salaries from FanGraphs RosterResource...")
        teams = mlb_stats_api.fetch_teams(season)
        abbreviation_to_team_id = {t["abbreviation"]: t["team_id"] for t in teams}
        salary_rows = fangraphs_salary.fetch_all_salaries(season)

        salary_player_ids = {r["player_id"] for r in salary_rows}
        new_player_ids = salary_player_ids - all_player_ids
        if new_player_ids:
            print(f"[{season}] found {len(new_player_ids)} salaried players with no stats yet, adding bios...")
            _upsert_players(db, new_player_ids)
            db.commit()

        ingested_salaries, skipped_salaries = _ingest_salaries(
            db, season, now, resolved_teams, salary_rows, abbreviation_to_team_id
        )
        db.commit()
    else:
        ingested_salaries, skipped_salaries = 0, 0

    print(
        f"[{season}] done. batters: {len(hitting_splits) - skipped_batters} "
        f"({skipped_batters} skipped), pitchers: {len(pitching_splits) - skipped_pitchers} "
        f"({skipped_pitchers} skipped), fielders: {len(fielding_player_ids) - skipped_fielders} "
        f"({skipped_fielders} skipped), salaries: {ingested_salaries} ({skipped_salaries} skipped)"
    )
