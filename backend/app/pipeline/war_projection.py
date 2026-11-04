"""Five-year fWAR outlook and open-market contract estimate.

A Marcel-style projection (Tom Tango's baseline method) applied to FanGraphs
fWAR rather than to process stats:

    1. Put each of the player's last three seasons of fWAR on a full-season
       scale (per 600 PA for hitters, 180 IP for starters, 65 IP for relievers).
    2. Weight the seasons 5-4-3 (most recent heaviest), each also multiplied by
       the playing time behind it, so a short season counts for less.
    3. Regress toward league average by adding one full season of
       league-average performance to the weighted sum -- the guard against one
       fluky year.
    4. Scale to a realistic workload (560 PA / 165 IP / 60 IP).
    5. Walk the result forward five seasons with a per-year aging step in WAR.
    6. Price each season at DOLLARS_PER_WAR, inflating INFLATION a year.

The contract estimate guarantees a year only while the projected WAR stays at
or above EXTEND_MIN_WAR (a team won't commit a roster spot to a player it
expects to be near replacement level, and not past MAX_END_AGE), and totals
the dollar value of exactly those years. The projection window is HORIZON
seasons, so no estimated deal runs longer than that. It is a model output, not a forecast of what a team will sign --
the rounding and negotiating judgment a human adds is not in here.

Why fWAR and not the bWAR the Score uses: fWAR is the better forward-looking
number for the same player (it credits catcher framing and uses FIP-based
pitcher value), and the dashboard's Score deliberately ranks what a player
produced, not what he is projected to do.

The rates below are assumptions, not values fit to this database; they are
named constants so they are easy to change.
"""

import pandas as pd
from sqlalchemy import text

from app.db import engine
from app.pipeline.projections import _age_as_of

MARCEL_WEIGHTS = [5, 4, 3]
SKIP_SEASONS = {2020}  # 60-game season

# Roles: hitters, starters, relievers.
FULL_SEASON = {"batter": 600.0, "SP": 180.0, "RP": 65.0}  # PA / IP of a full season
EXPECTED_WORKLOAD = {"batter": 560.0, "SP": 165.0, "RP": 60.0}  # what a healthy player actually logs
LEAGUE_AVG_WAR = {"batter": 2.4, "SP": 2.0, "RP": 0.5}  # fWAR per full season; RP ~ data (0.52)

HORIZON = 5
DOLLARS_PER_WAR = 11.23e6  # FanGraphs research on $/WAR (market average)
INFLATION = 0.04  # per year, compounding from the second season
# Keep guaranteeing years while projected WAR is at least this.
EXTEND_MIN_WAR = {"batter": 1.2, "SP": 1.2, "RP": 0.6}
MAX_END_AGE = 38  # the last guaranteed season is at or before the year he turns this age


def _age_step(role: str, age: int) -> float:
    """Change in projected WAR going from the season at `age` to the next one."""
    if role == "batter":
        if age <= 26:
            return 0.3
        if age <= 29:
            return 0.0
        if age <= 31:
            return -0.25
        return -0.5
    # SP and RP age alike
    if age <= 26:
        return 0.2
    if age <= 30:
        return 0.0
    return -0.3


_BATTER_Q = text(
    """
    SELECT bs.player_id, bs.season, bs.pa AS vol, bs.war, p.birthdate
    FROM batter_stats bs JOIN players p ON p.player_id = bs.player_id
    WHERE bs.season <= :season AND bs.war IS NOT NULL AND bs.pa > 0
    """
)
_PITCHER_Q = text(
    """
    SELECT ps.player_id, ps.season, ps.ip AS vol, ps.war, p.birthdate
    FROM pitcher_stats ps JOIN players p ON p.player_id = ps.player_id
    WHERE ps.season <= :season AND ps.war IS NOT NULL AND ps.ip > 0
    """
)


def project(rows: list[dict], role: str, age_next: float | None) -> dict | None:
    """rows: this player's seasons, most recent first, each {season, vol, war}.
    age_next: age during the first projected season. None if no usable history."""
    rows = rows[: len(MARCEL_WEIGHTS)]
    if not rows:
        return None
    full, lg = FULL_SEASON[role], LEAGUE_AVG_WAR[role]
    num = den = 0.0
    for weight, r in zip(MARCEL_WEIGHTS, rows):
        rate = r["war"] / r["vol"] * full
        num += weight * r["vol"] * rate
        den += weight * r["vol"]
    regressed = (num + full * lg) / (den + full)  # one league-average season of ballast
    base = regressed * EXPECTED_WORKLOAD[role] / full

    war: list[float] = []
    cur, age = base, int(age_next) if age_next is not None else 29
    for _ in range(HORIZON):
        war.append(max(cur, 0.0))
        cur += _age_step(role, age)
        age += 1

    years = 0
    for w in war:
        if w >= EXTEND_MIN_WAR[role]:
            years += 1
        else:
            break
    if years == 0 and war[0] > 0:
        years = 1  # a one-year deal for anyone still projected above zero
    # No team guarantees a deal that runs deep into a player's late 30s, however
    # smoothly the WAR curve declines: cap the length so the last season is at
    # or before MAX_END_AGE.
    age_capped = False
    if age_next is not None:
        cap = max(1, MAX_END_AGE - int(age_next) + 1)
        if years > cap:
            years, age_capped = cap, True
    values = [w * DOLLARS_PER_WAR * (1 + INFLATION) ** i for i, w in enumerate(war)]
    total = sum(values[:years])
    return {
        "war": [round(w, 2) for w in war],
        "war5": round(sum(war), 2),
        "values": [round(v) for v in values],
        "years": years,
        "ageCapped": age_capped,
        "total": round(total),
        "aav": round(total / years) if years else 0,
        "baseWar": round(base, 2),
        "keepWar": EXTEND_MIN_WAR[role],
        # Under three-quarters of one full season of MLB playing time behind the
        # projection: the one-season-of-ballast regression is light, so this
        # outlook is rougher for these players and the card says so.
        "thin": sum(r["vol"] for r in rows) < 0.75 * full,
        "hist": [{"season": int(r["season"]), "war": round(float(r["war"]), 2), "vol": round(float(r["vol"]), 1)} for r in rows],
    }


def _history(query, season: int) -> dict[int, tuple[list[dict], object]]:
    df = pd.read_sql(query, engine, params={"season": season})
    df = df[~df["season"].isin(SKIP_SEASONS)]
    out: dict[int, tuple[list[dict], object]] = {}
    for pid, grp in df.sort_values("season", ascending=False).groupby("player_id"):
        recs = [
            {"season": int(r.season), "vol": float(r.vol), "war": float(r.war)}
            for r in grp.itertuples()
        ]
        out[int(pid)] = (recs, grp.iloc[0]["birthdate"])
    return out


def build(season: int, pitcher_roles: dict[int, str]) -> dict[str, dict[int, dict]]:
    """{"batter": {player_id: outlook}, "pitcher": {player_id: outlook}} for the
    five seasons after `season`, using fWAR through `season` inclusive.
    pitcher_roles maps player_id -> "SP" | "RP" (default RP)."""
    result: dict[str, dict[int, dict]] = {"batter": {}, "pitcher": {}}
    for group, query in (("batter", _BATTER_Q), ("pitcher", _PITCHER_Q)):
        for pid, (rows, birthdate) in _history(query, season).items():
            role = "batter" if group == "batter" else pitcher_roles.get(pid, "RP")
            out = project(rows, role, _age_as_of(birthdate, season + 1))
            if out is not None:
                out["role"] = role
                result[group][pid] = out
    return result
