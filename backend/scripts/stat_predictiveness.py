"""Simple-linear-regression predictiveness of every stat in the Score/projection
model, one stat at a time, against a player's FUTURE production.

For each stat x measured in season t, regress future outcome y on x:
    y_z = r * x_z        (both z-scored within their own season, so league-wide
                          drift -- e.g. rising whiff rates -- doesn't leak in)
Because both sides are standardized, the slope is the correlation r and R^2 =
r^2 is the share of next-season outcome variance that one stat explains.

Horizons: t+1, t+2, t+3, and "next3" = mean of the z-scored outcome over
whichever of t+1..t+3 exist and qualify (needs >= 2).

Outcomes (oriented so higher = better):
    batters  : wOBA (offense only, 2015+), WAR (everything incl. defense, 2021+)
    pitchers : ERA and FIP (negated), WAR (2021+)

Predictors are oriented by the direction the Score model assumes
(higherBetter), so a NEGATIVE r means the model has the direction backwards.

Method notes
  * 2020 (60-game season) is dropped as source and target.
  * Only complete seasons are used (<= LAST_FULL_SEASON); the DB's 2026 is a
    partial snapshot.
  * Same player appears in several (t, t+h) pairs, so rows aren't independent.
    CIs come from a cluster bootstrap that resamples PLAYERS, not rows.
  * Playing-time floor at both ends so tiny samples don't dominate.

Run from backend/:  PYTHONPATH=. ../venv/Scripts/python.exe scripts/stat_predictiveness.py
"""

import numpy as np
import pandas as pd

from app.db import engine

LAST_FULL_SEASON = 2025
SKIP_SEASONS = {2020}
MIN_PA = 200
MIN_IP = 50
MIN_IP_SP = 100
N_BOOT = 300
rng = np.random.default_rng(7)

# key: (label, higherBetter per Score model, in_score_model)
BATTER_PREDICTORS = {
    "xwoba": True, "xba": True, "xslg": True, "barrel_rate": True, "hard_hit_rate": True,
    "chase_rate": False, "whiff_rate": False, "k_minus_bb": False,
    "oaa": True, "frv": True, "drs": True,
    "sprint_speed": True, "k_rate": False, "bb_rate": True,
    "ba": True, "obp": True, "slg": True, "hr": True, "rbi": True, "sb": True, "hits": True, "games": True,
    # benchmarks (not in Score): how well does last year's outcome itself persist?
    "woba": True, "ops": True, "avg_exit_velo": True, "war": True,
}
PITCHER_PREDICTORS = {
    "xera": False, "xba_against": False, "avg_exit_velo_against": False,
    "hard_hit_rate_against": False, "barrel_rate_against": False,
    "k_rate": True, "bb_rate": False, "chase_rate": True, "whiff_rate": True, "z_swing_rate": False,
    "extension": True, "stuff_plus": True, "location_plus": True,
    "era": False, "whip": False, "k_9": True, "wins": True, "saves": True, "ip": True, "games_started": True,
    "fip": False, "bb_9": False, "xwoba_against": False, "war": True,
}
NOT_IN_SCORE = {"woba", "ops", "avg_exit_velo", "war", "fip", "bb_9", "xwoba_against"}

BATTER_TARGETS = {"woba": True, "war": True}
PITCHER_TARGETS = {"era": False, "fip": False, "war": True}


def load():
    b = pd.read_sql("select * from batter_stats", engine)
    f = pd.read_sql("select player_id, season, oaa, frv, drs from fielding_stats", engine)
    b = b.merge(f, on=["player_id", "season"], how="left")
    b["k_minus_bb"] = b["k_rate"].astype(float) - b["bb_rate"].astype(float)
    p = pd.read_sql("select * from pitcher_stats", engine)
    for df in (b, p):
        for c in df.columns:
            if c not in ("source", "scraped_at"):
                df[c] = pd.to_numeric(df[c], errors="coerce")
    ok = lambda d: d[(d.season <= LAST_FULL_SEASON) & ~d.season.isin(SKIP_SEASONS)]
    return ok(b), ok(p)


def zscore_by_season(df, cols):
    g = df.groupby("season")[cols]
    return (df[cols] - g.transform("mean")) / g.transform("std")


def build_pairs(df, pt_col, min_pt, predictors, targets):
    """One row per (player, source season t) with z-scored predictors at t and
    z-scored outcomes at t+1, t+2, t+3, and the next3 mean."""
    q = df[df[pt_col] >= min_pt].copy()
    pcols = [c for c in predictors if c in q.columns]
    tcols = list(targets)
    zs = zscore_by_season(q, list(dict.fromkeys(pcols + tcols)))
    zs = zs.rename(columns=lambda c: c + "_z")
    q = pd.concat([q[["player_id", "season"]], zs], axis=1)
    # Targets live in their own columns (y_<name>) so orienting an outcome
    # (e.g. negating ERA) can't also flip the same stat used as a predictor.
    for t, hb in targets.items():
        q["y_" + t] = q[t + "_z"] * (1 if hb else -1)
    base = q[["player_id", "season"] + [c + "_z" for c in pcols]]
    out = base.copy()
    horizon_cols = {t: [] for t in tcols}
    for h in (1, 2, 3):
        fut = q[["player_id", "season"] + ["y_" + t for t in tcols]].copy()
        fut["season"] = fut["season"] - h
        fut = fut.rename(columns={"y_" + t: f"{t}_h{h}" for t in tcols})
        out = out.merge(fut, on=["player_id", "season"], how="left")
        for t in tcols:
            horizon_cols[t].append(f"{t}_h{h}")
    for t in tcols:
        cols = horizon_cols[t]
        n_avail = out[cols].notna().sum(axis=1)
        out[f"{t}_next3"] = out[cols].mean(axis=1).where(n_avail >= 2)
    return out, pcols


def corr_with(df, pcols, ycol):
    x = df[[c + "_z" for c in pcols]]
    return x.corrwith(df[ycol]).rename(lambda c: c[:-2])


def persistence(df, pt_col, min_pt, pcols):
    """Year-over-year correlation of each stat with itself (t vs t+1): how
    much of a player's stat is repeatable skill vs. season-to-season noise."""
    q = df[df[pt_col] >= min_pt]
    z = zscore_by_season(q, pcols)
    z = pd.concat([q[["player_id", "season"]], z], axis=1)
    nxt = z.copy()
    nxt["season"] -= 1
    m = z.merge(nxt, on=["player_id", "season"], suffixes=("", "_next"))
    return pd.Series({c: m[c].corr(m[c + "_next"]) for c in pcols})


def analyze(kind, df, pt_col, min_pt, predictors, targets):
    pairs, pcols = build_pairs(df, pt_col, min_pt, predictors, targets)
    players = pairs["player_id"].values
    uniq = np.unique(players)
    idx_by_player = {p: np.where(players == p)[0] for p in uniq}
    rows = []
    for t in targets:
        for hz in ("h1", "h2", "h3", "next3"):
            ycol = f"{t}_{hz}"
            d = pairs[pairs[ycol].notna()]
            if len(d) < 100:
                continue
            r = corr_with(d, pcols, ycol)
            n = d[[c + "_z" for c in pcols]].notna().mul(d[ycol].notna(), axis=0).sum()
            n.index = [c[:-2] for c in n.index]
            # cluster bootstrap over players
            d = d.reset_index(drop=True)
            gidx = {p: np.where(d["player_id"].values == p)[0] for p in d["player_id"].unique()}
            keys = list(gidx)
            boots = []
            for _ in range(N_BOOT):
                pick = rng.choice(len(keys), len(keys))
                ii = np.concatenate([gidx[keys[k]] for k in pick])
                boots.append(corr_with(d.iloc[ii], pcols, ycol))
            bt = pd.concat(boots, axis=1)
            lo, hi = bt.quantile(0.025, axis=1), bt.quantile(0.975, axis=1)
            for s in pcols:
                if pd.isna(r[s]) or n[s] < 100:
                    continue
                sign = 1 if predictors[s] else -1
                rows.append({
                    "kind": kind, "target": t, "horizon": hz, "stat": s,
                    "in_score": s not in NOT_IN_SCORE,
                    "n": int(n[s]), "r": sign * r[s], "r2": r[s] ** 2,
                    "ci_lo": sign * (lo[s] if sign == 1 else hi[s]),
                    "ci_hi": sign * (hi[s] if sign == 1 else lo[s]),
                })
    out = pd.DataFrame(rows)
    out["yoy_persistence"] = out["stat"].map(persistence(df, pt_col, min_pt, pcols))
    return out


if __name__ == "__main__":
    b, p = load()
    res = pd.concat([
        analyze("batter", b, "pa", MIN_PA, BATTER_PREDICTORS, BATTER_TARGETS),
        analyze("pitcher", p, "ip", MIN_IP, PITCHER_PREDICTORS, PITCHER_TARGETS),
        # Starter-only proxy (games_started only exists 2021+, so IP >= 100 at
        # both ends stands in for "starter"): strips the reliever-vs-starter
        # role effect that otherwise inflates K%, Stuff+, saves, IP, GS.
        analyze("pitcher_SP", p, "ip", MIN_IP_SP, PITCHER_PREDICTORS, PITCHER_TARGETS),
    ])
    res.to_csv("stat_predictiveness_results.csv", index=False)
    print(res.groupby(["kind", "target", "horizon"]).n.agg(["min", "max"]).to_string())
