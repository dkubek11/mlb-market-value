"""Regenerates the dashboard's data snapshot entirely fresh from the live
database plus a couple of live scrapes (FanGraphs contract detail) -- no
dependency on any earlier hand-captured JSON snapshot. Run this any time
after the backend pipeline (run_ingest.py / run_compute_value.py) refreshes,
then run splice_dashboard.py to bake it into a publishable HTML file.

Usage: py build_dashboard.py [season]  (defaults to 2026)
"""

import datetime
import json
import sys

sys.path.insert(0, r"C:\Users\dylan\Desktop\mlb-market-value\backend")
import pandas as pd
from sqlalchemy import text, bindparam
from app.db import engine
from app.pipeline.compute_value import _is_pre_arb
from app.pipeline.projections import (
    compute_batter_projections, compute_pitcher_projections,
    BATTER_PROJECTION_STATS, PITCHER_PROJECTION_STATS, blend_projections,
)
from app.pipeline.comp_projections import compute_batter_comp_projections, compute_pitcher_comp_projections
from app.pipeline.fangraphs_salary import TEAM_SLUG_TO_ABBREVIATION, fetch_team_contracts
from app.pipeline import mlbtr_arbitration
from app.pipeline.ingest import _normalize_name
from headshots import get_headshot_data_uri

HERE = __import__("pathlib").Path(__file__).parent
season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
MIN_BATTER_PA = 150
MIN_IP_SP = 50
MIN_IP_RP = 25
POS_MAP = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}

# Real CBA-set league minimums (Article VI, 2022-2026 agreement) -- used only
# to fill in a real dollar figure for rostered players verified as pre-arb
# (see _fill_verified_pre_arb below) who FanGraphs RosterResource has no
# salary row for at all. The CBA expires after 2026 with no confirmed
# schedule beyond it, so an unknown future season falls back to the latest
# known value rather than guessing at an escalation.
LEAGUE_MINIMUM_BY_SEASON = {2022: 700_000, 2023: 720_000, 2024: 740_000, 2025: 760_000, 2026: 780_000}
LEAGUE_MINIMUM = LEAGUE_MINIMUM_BY_SEASON.get(season, LEAGUE_MINIMUM_BY_SEASON[max(LEAGUE_MINIMUM_BY_SEASON)])

BATTER_STATS = ["ba", "obp", "slg", "xwoba", "xba", "xslg", "hr", "rbi", "sb",
                 "barrel_rate", "hard_hit_rate", "sprint_speed",
                 "chase_rate", "whiff_rate", "k_rate", "bb_rate", "oaa", "frv", "drs",
                 "hits", "games", "war"]
PITCHER_STATS = ["era", "whip", "fip", "xera", "k_9", "bb_9",
                  "hard_hit_rate_against", "barrel_rate_against", "xba_against",
                  "avg_exit_velo_against", "chase_rate", "whiff_rate", "k_rate", "bb_rate",
                  "z_swing_rate", "extension", "stuff_plus", "location_plus",
                  "wins", "saves", "games_started", "ip", "war"]

BATTER_Q = text("""
    SELECT bs.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, sal.service_time, bs.pa, p.debut_date,
           bs.ba, bs.obp, bs.slg, bs.xwoba, bs.xba, bs.xslg, bs.hr, bs.rbi, bs.sb,
           bs.barrel_rate, bs.hard_hit_rate, bs.sprint_speed,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate,
           fs.oaa, fs.frv, fs.drs,
           bs.hits, bs.games, bs.war
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    JOIN teams t ON t.team_id = ps.team_id
    LEFT JOIN player_salaries sal ON sal.player_id = bs.player_id AND sal.season = bs.season
    LEFT JOIN fielding_stats fs ON fs.player_id=bs.player_id AND fs.season=bs.season
    WHERE bs.season=:season AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
""")

PITCHER_Q = text("""
    SELECT ps_s.player_id, p.full_name, t.abbreviation AS team, ps.position AS position,
           sal.salary, sal.aav, sal.contract_type, sal.service_time, ps_s.ip, p.debut_date,
           ps_s.era, ps_s.whip, ps_s.fip, ps_s.xera, ps_s.k_9, ps_s.bb_9,
           ps_s.hard_hit_rate_against, ps_s.barrel_rate_against, ps_s.xba_against,
           ps_s.avg_exit_velo_against, ps_s.chase_rate, ps_s.whiff_rate, ps_s.k_rate, ps_s.bb_rate,
           ps_s.z_swing_rate, ps_s.extension, ps_s.stuff_plus, ps_s.location_plus,
           ps_s.wins, ps_s.saves, ps_s.games_started, ps_s.war
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    JOIN teams t ON t.team_id = ps.team_id
    LEFT JOIN player_salaries sal ON sal.player_id = ps_s.player_id AND sal.season = ps_s.season
    WHERE ps_s.season=:season AND ps_s.fip IS NOT NULL
      AND (
        (ps.position = 'SP' AND ps_s.ip >= :min_ip_sp) OR
        (ps.position = 'RP' AND ps_s.ip >= :min_ip_rp)
      )
""")

# Last 5 completed seasons' worth of qualifying stat lines, for the player
# card's history table. No salary join -- RosterResource only exposes
# *current* rosters, so there's no way to recover what a player actually
# earned in a past season, which is why history only ever shows performance,
# never a pay-based Score.
HISTORY_SEASONS = list(range(season - 5, season))

HISTORY_BATTER_Q = text("""
    SELECT bs.player_id, t.abbreviation AS team, ps.position AS position, bs.season, bs.pa,
           bs.ba, bs.obp, bs.slg, bs.xwoba, bs.xba, bs.xslg, bs.hr, bs.rbi, bs.sb,
           bs.barrel_rate, bs.hard_hit_rate, bs.sprint_speed,
           bs.chase_rate, bs.whiff_rate, bs.k_rate, bs.bb_rate,
           fs.oaa, fs.frv, fs.drs,
           bs.hits, bs.games, bs.war
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN teams t ON t.team_id = ps.team_id
    LEFT JOIN fielding_stats fs ON fs.player_id=bs.player_id AND fs.season=bs.season
    WHERE bs.season IN :seasons AND bs.pa >= :min_pa AND bs.xwoba IS NOT NULL
""").bindparams(bindparam("seasons", expanding=True))

HISTORY_PITCHER_Q = text("""
    SELECT ps_s.player_id, t.abbreviation AS team, ps.position AS position, ps_s.season, ps_s.ip,
           ps_s.era, ps_s.whip, ps_s.fip, ps_s.xera, ps_s.k_9, ps_s.bb_9,
           ps_s.hard_hit_rate_against, ps_s.barrel_rate_against, ps_s.xba_against,
           ps_s.avg_exit_velo_against, ps_s.chase_rate, ps_s.whiff_rate, ps_s.k_rate, ps_s.bb_rate,
           ps_s.z_swing_rate, ps_s.extension, ps_s.stuff_plus, ps_s.location_plus,
           ps_s.wins, ps_s.saves, ps_s.games_started, ps_s.war
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN teams t ON t.team_id = ps.team_id
    WHERE ps_s.season IN :seasons AND ps_s.fip IS NOT NULL
      AND (
        (ps.position = 'SP' AND ps_s.ip >= :min_ip_sp) OR
        (ps.position = 'RP' AND ps_s.ip >= :min_ip_rp)
      )
""").bindparams(bindparam("seasons", expanding=True))

# Every rostered player's playing time at their position, regardless of
# whether they clear the scoring-qualification bar -- used only to pick who
# occupies each position on the Teams-tab diamond view.
ROSTER_BATTER_Q = text("""
    SELECT t.abbreviation AS team, ps.position AS position, bs.player_id, p.full_name, bs.pa AS pt
    FROM batter_stats bs
    JOIN player_seasons ps ON ps.player_id=bs.player_id AND ps.season=bs.season AND ps.player_type='BATTER'
    JOIN players p ON p.player_id = bs.player_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE bs.season=:season
""")
ROSTER_PITCHER_Q = text("""
    SELECT t.abbreviation AS team, ps.position AS position, ps_s.player_id, p.full_name, ps_s.ip AS pt
    FROM pitcher_stats ps_s
    JOIN player_seasons ps ON ps.player_id=ps_s.player_id AND ps.season=ps_s.season AND ps.player_type='PITCHER'
    JOIN players p ON p.player_id = ps_s.player_id
    JOIN teams t ON t.team_id = ps.team_id
    WHERE ps_s.season=:season
""")

ARB_HISTORY_STAT_KEYS = {"batter": ["ba", "obp", "slg", "hr", "rbi", "sb", "hits", "games"],
                          "pitcher": ["era", "whip", "k_9", "wins", "saves", "ip", "games_started"]}

# Real historical arbitration settlements (see backfill_arb_outcomes.py) --
# service_time is MLB's own accrued-days figure and actual_salary is what
# the player actually got paid, joined back to their platform-season stat
# line so the dashboard can comp arb-eligible/pre-arb players against real
# multi-year peer outcomes instead of just the current season's ~150-player
# pool. No salary join needed here (unlike BATTER_Q/PITCHER_Q) since
# actual_salary already comes from arb_outcomes itself.
ARB_HISTORY_BATTER_Q = text(f"""
    SELECT ao.player_id, ao.platform_season AS season, ao.service_time, ao.actual_salary,
           ps.position AS position, {", ".join("bs." + k for k in ARB_HISTORY_STAT_KEYS["batter"])}
    FROM arb_outcomes ao
    JOIN batter_stats bs ON bs.player_id = ao.player_id AND bs.season = ao.platform_season
    JOIN player_seasons ps ON ps.player_id=ao.player_id AND ps.season=ao.platform_season AND ps.player_type='BATTER'
""")
ARB_HISTORY_PITCHER_Q = text(f"""
    SELECT ao.player_id, ao.platform_season AS season, ao.service_time, ao.actual_salary,
           ps.position AS position, {", ".join("ps_s." + k for k in ARB_HISTORY_STAT_KEYS["pitcher"])}
    FROM arb_outcomes ao
    JOIN pitcher_stats ps_s ON ps_s.player_id = ao.player_id AND ps_s.season = ao.platform_season
    JOIN player_seasons ps ON ps.player_id=ao.player_id AND ps.season=ao.platform_season AND ps.player_type='PITCHER'
""")

TEAMS_Q = text("SELECT team_id, abbreviation, name, league, division FROM teams")
PAYROLL_Q = text("SELECT team_id, SUM(salary) AS payroll FROM player_salaries WHERE season=:season GROUP BY team_id")

# Players who clear the PA/IP bar but have no player_salaries row at all --
# RosterResource doesn't itemize every rookie-minimum player, so a real chunk
# of qualifying playing time (this season: pitchers with 60-90+ IP, batters
# with 200+ PA) was silently falling out of scoring entirely. Most of these
# genuinely are pre-arb (whose real salary barely matters for scoring anyway
# -- see the isPreArb path in dashboard_template.html, which ignores pay and
# scores on performance alone), but "missing a salary row" isn't proof of
# that by itself, so this cross-checks two independent real signals before
# assuming it: (1) MLBTR's own CURRENT-season arbitration tracker -- if a
# missing-salary player is on it, they're confirmed arb-eligible this year,
# not pre-arb, and (2) a real settled arb_outcomes record from any EARLIER
# season -- service time only accrues, so a player who already had a case
# can't have reverted to pre-arb. Anyone flagged by either signal, or with no
# debut_date to estimate service time from, or whose apparent service (years
# since debut) is already 3+, is left out entirely rather than guessed at --
# same as today, just for a now-understood reason instead of a silent one.
print(f"[{season}] cross-checking missing-salary players against arb signals...")
try:
    _mlbtr_names = mlbtr_arbitration.fetch_service_times(season)
except Exception as exc:
    print(f"  (MLBTR arbitration tracker unavailable: {exc})")
    _mlbtr_names = {}
_normalized_mlbtr_names = {_normalize_name(n) for n in _mlbtr_names}
_prior_arb_ids = set(
    pd.read_sql(
        text("SELECT DISTINCT player_id FROM arb_outcomes WHERE platform_season < :season"),
        engine, params={"season": season},
    )["player_id"]
)


def _fill_verified_pre_arb(df: pd.DataFrame, label: str) -> pd.DataFrame:
    missing = df[df["salary"].isna()]
    if missing.empty:
        return df

    normalized_name = missing["full_name"].map(_normalize_name)
    service_years = missing["debut_date"].apply(lambda d: season - d.year if pd.notna(d) else None)
    flagged_arb_eligible = normalized_name.isin(_normalized_mlbtr_names) | missing["player_id"].isin(_prior_arb_ids)
    verified = ~flagged_arb_eligible & service_years.notna() & (service_years < 3)

    verified_idx = missing.index[verified]
    flagged_idx = missing.index[flagged_arb_eligible]
    print(f"  {label} missing salary: {len(missing)} -- {len(verified_idx)} verified pre-arb "
          f"(filled at {season} league minimum ${LEAGUE_MINIMUM:,}), {len(flagged_idx)} flagged as "
          f"arb-eligible with an unmatched real salary (excluded), "
          f"{len(missing) - len(verified_idx) - len(flagged_idx)} excluded (insufficient evidence)")

    df.loc[verified_idx, "salary"] = LEAGUE_MINIMUM
    df.loc[verified_idx, "aav"] = LEAGUE_MINIMUM
    df.loc[verified_idx, "contract_type"] = "Pre-Arbitration (est.)"
    # service_time stays null -- to_record()'s existing fallback (years since
    # debut, serviceYearsExact=False) already computes the same proxy honestly;
    # setting it here would mislabel it as MLB's real, exact accrued-days figure.
    return df.drop(index=missing.index.difference(verified_idx))


print(f"[{season}] querying qualified batters/pitchers...")
batters = pd.read_sql(BATTER_Q, engine, params={"season": season, "min_pa": MIN_BATTER_PA})
pitchers = pd.read_sql(PITCHER_Q, engine, params={"season": season, "min_ip_sp": MIN_IP_SP, "min_ip_rp": MIN_IP_RP})
batters = _fill_verified_pre_arb(batters, "batters")
pitchers = _fill_verified_pre_arb(pitchers, "pitchers")
batters["position"] = batters["position"].map(lambda p: POS_MAP.get(p, p))
batters["is_pre_arb"] = batters["contract_type"].apply(_is_pre_arb)
pitchers["is_pre_arb"] = pitchers["contract_type"].apply(_is_pre_arb)

print(f"[{season}] computing Marcel-style projections...")
batter_marcel = compute_batter_projections(season)
pitcher_marcel = compute_pitcher_projections(season)

print(f"[{season}] computing comparable-player (nearest-neighbor) projections...")
batter_comp = compute_batter_comp_projections(season)
pitcher_comp = compute_pitcher_comp_projections(season)

batter_proj = blend_projections(batter_marcel, batter_comp, list(BATTER_PROJECTION_STATS.keys()))
pitcher_proj = blend_projections(pitcher_marcel, pitcher_comp, list(PITCHER_PROJECTION_STATS.keys()))

positionStats = {}
for pos, grp in batters.groupby("position"):
    positionStats[pos] = {}
    for stat in BATTER_STATS:
        vals = grp[stat].dropna()
        positionStats[pos][stat] = (
            {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
            if len(vals) >= 2 else None
        )
for pos, grp in pitchers.groupby("position"):
    positionStats[pos] = {}
    for stat in PITCHER_STATS:
        vals = grp[stat].dropna()
        positionStats[pos][stat] = (
            {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
            if len(vals) >= 2 else None
        )


def clean(v):
    if v is None or pd.isna(v):
        return None
    return round(float(v), 5)


print(f"[{season}] querying {len(HISTORY_SEASONS)}-season history ({HISTORY_SEASONS[0]}-{HISTORY_SEASONS[-1]})...")
hist_batters = pd.read_sql(
    HISTORY_BATTER_Q, engine, params={"seasons": HISTORY_SEASONS, "min_pa": MIN_BATTER_PA}
)
hist_pitchers = pd.read_sql(
    HISTORY_PITCHER_Q, engine,
    params={"seasons": HISTORY_SEASONS, "min_ip_sp": MIN_IP_SP, "min_ip_rp": MIN_IP_RP},
)
hist_batters["position"] = hist_batters["position"].map(lambda p: POS_MAP.get(p, p))

# Wider window (matches arb_outcomes' real coverage -- see
# backfill_arb_outcomes.py -- 2016-2025 excluding the 60-game 2020 season)
# used ONLY to build positionStatsHistory below, so computeHistoricalArbGrade
# can grade a platform season all the way back to 2016, not just
# hist_batters/hist_pitchers' 5-year card-display window above.
ARB_STATS_SEASONS = [s for s in range(season - 10, season) if s != 2020]
print(f"[{season}] querying {len(ARB_STATS_SEASONS)}-season position stats for arb grading "
      f"({ARB_STATS_SEASONS[0]}-{ARB_STATS_SEASONS[-1]}, excl. 2020)...")
arb_stats_hist_batters = pd.read_sql(
    HISTORY_BATTER_Q, engine, params={"seasons": ARB_STATS_SEASONS, "min_pa": MIN_BATTER_PA}
)
arb_stats_hist_pitchers = pd.read_sql(
    HISTORY_PITCHER_Q, engine,
    params={"seasons": ARB_STATS_SEASONS, "min_ip_sp": MIN_IP_SP, "min_ip_rp": MIN_IP_RP},
)
arb_stats_hist_batters["position"] = arb_stats_hist_batters["position"].map(lambda p: POS_MAP.get(p, p))

print(f"[{season}] querying awards history...")
AWARDS_Q = text("""
    SELECT player_id, season, award_id FROM player_awards
    WHERE season BETWEEN :start_season AND :end_season
""")
awards_df = pd.read_sql(AWARDS_Q, engine, params={"start_season": season - 5, "end_season": season})
awards_by_player = {}
for pid, grp in awards_df.groupby("player_id"):
    awards_by_player[int(pid)] = [
        {"season": int(row.season), "awardId": row.award_id}
        for row in grp.sort_values("season", ascending=False).itertuples()
    ]

print(f"[{season}] querying real arb-salary history (for the CBA max-cut floor)...")
# The CBA caps how much a team can cut an arb-eligible player's pay: no more
# than 20% below last year's salary, and no more than 30% below the salary
# from two years before that. arb_outcomes.actual_salary for platform_season
# P is what the player was actually PAID in calendar year P+1 (decided off
# performance in P) -- rekey by the season it was paid so the frontend can
# just look up "what did this player make in season Y".
ARB_SALARY_HISTORY_Q = text("""
    SELECT player_id, platform_season, actual_salary FROM arb_outcomes
    WHERE platform_season BETWEEN :start_platform AND :end_platform
""")
arb_salary_hist_df = pd.read_sql(
    ARB_SALARY_HISTORY_Q, engine, params={"start_platform": season - 3, "end_platform": season - 2}
)
arb_salary_history_by_player = {}
for pid, grp in arb_salary_hist_df.groupby("player_id"):
    arb_salary_history_by_player[int(pid)] = {
        str(int(row.platform_season) + 1): float(row.actual_salary)
        for row in grp.itertuples()
    }

# Real arb-eligible pay raises/cuts almost never happen: in this dataset's
# actual consecutive-year settlements, only ~3% were cuts, and those hit
# almost exactly the legal 20% floor -- tier progression (Arb1 -> Arb2 ->
# Arb3 pays a bigger % of the same underlying value each year) means most
# returning arb players get a real raise even off a mediocre platform
# season. The bare CBA floor above only stops an illegal cut; it doesn't
# reflect how rarely teams actually go anywhere near it. This computes the
# empirical "worst realistic case" raise (a low percentile, not the median,
# so it doesn't overwrite a comp-based case that's genuinely earned more)
# directly from real year-over-year settlements, so it updates on its own
# as more seasons of real data come in rather than being a hand-picked number.
RAISE_PAIRS_Q = text("""
    SELECT a.actual_salary AS s1, b.actual_salary AS s2
    FROM arb_outcomes a
    JOIN arb_outcomes b ON a.player_id = b.player_id AND b.platform_season = a.platform_season + 1
""")
raise_pairs = pd.read_sql(RAISE_PAIRS_Q, engine)
if len(raise_pairs) >= 20:
    raises = sorted((raise_pairs["s2"] - raise_pairs["s1"]) / raise_pairs["s1"])
    arb_raise_floor_pct = float(raises[int(len(raises) * 0.10)])
else:
    arb_raise_floor_pct = 0.0
print(f"[{season}] empirical arb raise floor (10th percentile of {len(raise_pairs)} real year-over-year settlements): {arb_raise_floor_pct*100:.1f}%")

# {season: {position: {stat: {mean, std}}}} -- same shape and method as the
# current-season positionStats, just computed separately per historical
# season (over the wider ARB_STATS_SEASONS window) so a player's history is
# scored against *that* season's peers -- this is what lets
# computeHistoricalArbGrade grade an arb_outcomes record from any season
# 2016 onward, not just the 5 years hist_batters/hist_pitchers cover.
positionStatsHistory = {}
for season_key, season_grp in arb_stats_hist_batters.groupby("season"):
    positionStatsHistory[str(season_key)] = {}
    for pos, grp in season_grp.groupby("position"):
        positionStatsHistory[str(season_key)][pos] = {}
        for stat in BATTER_STATS:
            vals = grp[stat].dropna()
            positionStatsHistory[str(season_key)][pos][stat] = (
                {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
                if len(vals) >= 2 else None
            )
for season_key, season_grp in arb_stats_hist_pitchers.groupby("season"):
    positionStatsHistory.setdefault(str(season_key), {})
    for pos, grp in season_grp.groupby("position"):
        positionStatsHistory[str(season_key)][pos] = {}
        for stat in PITCHER_STATS:
            vals = grp[stat].dropna()
            positionStatsHistory[str(season_key)][pos][stat] = (
                {"mean": round(float(vals.mean()), 5), "std": round(float(vals.std()), 5)}
                if len(vals) >= 2 else None
            )


def _history_rows(df, stat_keys):
    """{(player_id, ) -> [{season, position, stats}, ...]}, most recent first."""
    out = {}
    for pid, grp in df.groupby("player_id"):
        grp = grp.sort_values("season", ascending=False)
        out[int(pid)] = [
            {
                "season": int(row.season),
                "position": row.position,
                "stats": {s: clean(getattr(row, s)) for s in stat_keys},
            }
            for row in grp.itertuples()
        ]
    return out


batter_history_by_player = _history_rows(hist_batters, BATTER_STATS)
pitcher_history_by_player = _history_rows(hist_pitchers, PITCHER_STATS)


def to_record(r, is_batter, stat_keys, proj_map, proj_stat_keys, history_map):
    proj = proj_map.get(int(r.player_id), {})
    debut_date = getattr(r, "debut_date", None)
    # Real accrued MLB service time (years.days) -- the actual figure the
    # CBA's Arb1/2/3 and Super Two rules are based on. Sourced primarily from
    # FanGraphs RosterResource's own contract data (joined by MLBAM ID,
    # covers pre-arb through guaranteed-contract players), with MLB Trade
    # Rumors' arbitration tracker as a secondary source for anyone RosterResource
    # missed. For the remainder (a rare miss in both, or a player off any
    # tracked roster), fall back to an approximate proxy: years since MLB
    # debut. That proxy won't account for time on optional assignment, injury
    # rehab stints, etc., so it can misclassify -- serviceYearsExact tells the
    # frontend which case it's looking at.
    real_service = getattr(r, "service_time", None)
    if real_service is not None and pd.notna(real_service):
        service_years = float(real_service)
        service_years_exact = True
    else:
        service_years = season - debut_date.year if debut_date is not None and pd.notna(debut_date) else None
        service_years_exact = False
    return {
        "id": int(r.player_id),
        "name": r.full_name,
        "team": r.team,
        "position": r.position,
        "isBatter": is_batter,
        "isPreArb": bool(r.is_pre_arb),
        "serviceYears": service_years,
        "serviceYearsExact": service_years_exact,
        "salary": round(float(r.salary)),
        "aav": round(float(r.aav)),
        "contractType": r.contract_type,
        "stats": {s: clean(getattr(r, s)) for s in stat_keys},
        "age": clean(proj.get("age")),
        # Projected true-talent values, keyed the same as "stats" so any stat
        # can be compared 1:1 against its own projection (blend of Marcel
        # regression + comparable-player projections; see projections.py).
        "projected": {s: clean(proj.get(s)) for s in proj_stat_keys},
        "nComps": proj.get("nComps", 0),
        # Last 5 completed seasons the player qualified in (may be shorter or
        # empty for young players) -- no salary, see HISTORY_BATTER_Q comment.
        "history": history_map.get(int(r.player_id), []),
        # Real MVP/Cy Young/ROY/All-Star/Silver Slugger/Gold Glove wins from
        # the last 5 seasons (see mlb_awards.py) -- the "special
        # accomplishments" real arbitration panels credit beyond the stat
        # line, most recent first.
        "awards": awards_by_player.get(int(r.player_id), []),
        # {season: actual salary paid} for the last 2 seasons this player had
        # a real, resolved arb settlement -- powers the CBA's max-cut floor
        # (can't drop more than 20% below last year's pay, 30% below two
        # years ago). Missing entries just mean no resolved settlement exists
        # for that season (a rare unresolved-at-publication tracker case, or
        # the player wasn't arb-eligible yet) -- the frontend skips the floor
        # rather than guessing.
        "arbSalaryHistory": arb_salary_history_by_player.get(int(r.player_id), {}),
        # Real MLB headshot, base64-embedded (see headshots.py) -- None for
        # the rare player MLB hasn't published a photo for yet (very new
        # call-ups), which the frontend falls back to an initials avatar for.
        "headshot": get_headshot_data_uri(int(r.player_id)),
    }


print(f"[{season}] fetching headshots (only players missing from the local cache hit the network)...")
all_players = (
    [to_record(r, True, BATTER_STATS, batter_proj, BATTER_PROJECTION_STATS.keys(), batter_history_by_player)
     for r in batters.itertuples()]
    + [to_record(r, False, PITCHER_STATS, pitcher_proj, PITCHER_PROJECTION_STATS.keys(), pitcher_history_by_player)
       for r in pitchers.itertuples()]
)
with_headshot = sum(1 for p in all_players if p["headshot"])
print(f"  headshots: {with_headshot}/{len(all_players)}")

print(f"[{season}] building team payroll + rosters (all rostered players, not just qualifiers)...")
teams_df = pd.read_sql(TEAMS_Q, engine)
payroll_df = pd.read_sql(PAYROLL_Q, engine, params={"season": season})
teams_df = teams_df.merge(payroll_df, on="team_id", how="left")
teams_out = [
    {
        "abbr": r.abbreviation,
        "name": r.name,
        "league": r.league,
        "division": r.division,
        "payroll": round(float(r.payroll)) if pd.notna(r.payroll) else 0,
    }
    for r in teams_df.itertuples()
]

roster_batters = pd.read_sql(ROSTER_BATTER_Q, engine, params={"season": season})
roster_batters["position"] = roster_batters["position"].map(lambda p: POS_MAP.get(p, p))
roster_pitchers = pd.read_sql(ROSTER_PITCHER_Q, engine, params={"season": season})
roster_all = pd.concat([roster_batters, roster_pitchers], ignore_index=True)

rosters = {}
for (team, pos), grp in roster_all.groupby(["team", "position"]):
    top = grp.loc[grp["pt"].idxmax()]
    rosters.setdefault(team, {})[pos] = {
        "id": int(top.player_id),
        "name": top.full_name,
        "headshot": get_headshot_data_uri(int(top.player_id)),
    }

print(f"[{season}] fetching current contract detail from FanGraphs RosterResource...")
contracts = {}
for slug in TEAM_SLUG_TO_ABBREVIATION:
    for contract in fetch_team_contracts(slug):
        summary = contract["contractSummary"]
        pid = summary.get("MLBAMID")
        if not pid:
            continue
        pid = int(pid)
        years = sorted(
            (
                {"season": y["Season"], "salary": y.get("Salary"), "aav": y.get("AAV"), "type": y.get("Type")}
                for y in contract["contractYears"]
            ),
            key=lambda y: y["season"],
        )
        entry = {
            "contractType": summary.get("ContractType"),
            "yearsTotal": summary.get("YearsTotal"),
            "startSeason": summary.get("startSeason"),
            "endSeasonAll": summary.get("endSeasonAll"),
            "totalGuaranteed": summary.get("ContractTotal"),
            "signingBonus": summary.get("SigningBonus"),
            "years": years,
        }
        # a player can have multiple contract rows (extensions, multiple stints);
        # keep whichever covers the most years of data
        existing = contracts.get(pid)
        if existing is None or len(entry["years"]) > len(existing["years"]):
            contracts[pid] = entry

print(f"[{season}] querying real historical arbitration outcomes...")
arb_hist_batters = pd.read_sql(ARB_HISTORY_BATTER_Q, engine)
arb_hist_pitchers = pd.read_sql(ARB_HISTORY_PITCHER_Q, engine)
arb_hist_batters["position"] = arb_hist_batters["position"].map(lambda p: POS_MAP.get(p, p))


def _arb_outcome_records(df, is_batter, stat_keys):
    return [
        {
            "playerId": int(r.player_id),
            "season": int(r.season),
            "position": r.position,
            "isBatter": is_batter,
            "serviceTime": clean(r.service_time),
            "actualSalary": clean(r.actual_salary),
            "stats": {s: clean(getattr(r, s)) for s in stat_keys},
        }
        for r in df.itertuples()
    ]


historical_arb_outcomes = (
    _arb_outcome_records(arb_hist_batters, True, ARB_HISTORY_STAT_KEYS["batter"])
    + _arb_outcome_records(arb_hist_pitchers, False, ARB_HISTORY_STAT_KEYS["pitcher"])
)
print(f"[{season}] historical arb outcomes: {len(historical_arb_outcomes)} "
      f"({len(arb_hist_batters)} batters, {len(arb_hist_pitchers)} pitchers)")

with open(HERE / "team_colors.json", encoding="utf-8") as f:
    team_colors = json.load(f)

out = {
    "allPlayers": all_players,
    "positionStats": positionStats,
    "positionStatsHistory": positionStatsHistory,
    "historicalArbOutcomes": historical_arb_outcomes,
    "teams": teams_out,
    "rosters": rosters,
    "teamColors": team_colors,
    "contracts": contracts,
    "arbRaiseFloorPct": arb_raise_floor_pct,
    "capturedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
}
with open(HERE / "dashboard_data.json", "w", encoding="utf-8") as f:
    json.dump(out, f)

with_proj_batters = sum(1 for p in all_players if p["isBatter"] and p["projected"]["xba"] is not None)
with_proj_pitchers = sum(1 for p in all_players if not p["isBatter"] and p["projected"]["xera"] is not None)
with_comps_batters = sum(1 for p in all_players if p["isBatter"] and p["nComps"] > 0)
with_comps_pitchers = sum(1 for p in all_players if not p["isBatter"] and p["nComps"] > 0)
print(f"batters: {len(batters)}, pitchers: {len(pitchers)}, total: {len(all_players)}")
print(f"batters with projection: {with_proj_batters}/{len(batters)}, pitchers with projection: {with_proj_pitchers}/{len(pitchers)}")
print(f"batters with comps: {with_comps_batters}/{len(batters)}, pitchers with comps: {with_comps_pitchers}/{len(pitchers)}")
print(f"teams: {len(teams_out)}, contracts: {len(contracts)}")
with_history = sum(1 for p in all_players if p["history"])
print(f"players with >=1 year of history: {with_history}/{len(all_players)}")
print("wrote", HERE / "dashboard_data.json")
