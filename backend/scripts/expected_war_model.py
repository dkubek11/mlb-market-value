"""Same-season "expected bWAR" model: given the process stats a player posted
(xwOBA, barrel rate, K%, xERA, Stuff+, ...) plus the playing time and position
they got, what bWAR should they have produced?  actual - expected is the
over/under-performance gap that would replace the current regression arrow.

This is NOT a forecast of next season (projections are a separate step) --
the target is the same season's bWAR, so what's being tested is how much of
what a player actually produced is explained by repeatable, process-based
inputs vs. results-based luck, defense we can't see, etc.

Groups: batters, SP (GS/G >= .5), RP.  Per group we compare:
    playing_time_only  : volume (+position for batters) alone -- the floor
    additive           : bWAR ~ volume + position + process stats
    rate_x_volume      : (bWAR / volume) ~ process stats, weighted by volume,
                         then multiplied back by volume (WAR is ~quality x playing
                         time, which an additive model can't express)
    results_ceiling    : same as rate_x_volume but fed actual outcome stats
                         (wOBA/OBP/SLG..., ERA/WHIP/..) -- how well results
                         explain WAR, for reference
All numbers are out-of-sample R^2 (5-fold, folds assigned by PLAYER so a
player never appears in both train and test).  Ridge, features z-scored
within season to remove league-wide drift.  Seasons 2015-2025 excl. 2020.

Run from backend/:  PYTHONPATH=. ../venv/Scripts/python.exe scripts/expected_war_model.py
"""

import numpy as np
import pandas as pd
from pybaseball import bwar_bat, bwar_pitch

from app.db import engine

LAST_FULL_SEASON = 2025
SKIP = {2020}
MIN_PA, MIN_IP = 100, 40
ALPHAS = [0.1, 1, 10, 100, 1000]

BAT_PROCESS = ["xwoba", "xslg", "xba", "barrel_rate", "hard_hit_rate", "avg_exit_velo",
               "k_rate", "bb_rate", "chase_rate", "whiff_rate", "sprint_speed", "sb",
               "oaa", "frv", "drs"]
BAT_RESULTS = ["woba", "obp", "slg", "ba", "hr", "sb", "oaa", "frv", "drs", "sprint_speed"]
PIT_PROCESS = ["xera", "xba_against", "xwoba_against", "k_rate", "bb_rate", "whiff_rate", "chase_rate",
               "z_swing_rate", "barrel_rate_against", "hard_hit_rate_against", "avg_exit_velo_against",
               "stuff_plus", "location_plus", "extension"]
PIT_RESULTS = ["era", "whip", "fip", "k_9", "bb_9"]


def load():
    bb = bwar_bat(return_all=True)
    bb = bb[bb.mlb_ID.notna()].copy()
    bb["player_id"] = bb.mlb_ID.astype(int)
    bat = bb.groupby(["player_id", "year_ID"], as_index=False).agg(bwar=("WAR", "sum"), bpa=("PA", "sum"))
    bat = bat.rename(columns={"year_ID": "season"})

    bp = bwar_pitch(return_all=True)
    bp = bp[bp.mlb_ID.notna()].copy()
    bp["player_id"] = bp.mlb_ID.astype(int)
    pit = bp.groupby(["player_id", "year_ID"], as_index=False).agg(
        bwar=("WAR", "sum"), ipouts=("IPouts", "sum"), g=("G", "sum"), gs=("GS", "sum"))
    pit = pit.rename(columns={"year_ID": "season"})
    pit["bip"] = pit.ipouts / 3.0

    f = pd.read_sql("select player_id, season, oaa, frv, drs from fielding_stats", engine)
    b = pd.read_sql("select * from batter_stats", engine).merge(f, on=["player_id", "season"], how="left")
    p = pd.read_sql("select * from pitcher_stats", engine)
    pos = (pd.read_sql("select player_id, season, position from player_seasons where player_type='BATTER'", engine)
           .drop_duplicates(["player_id", "season"]))
    b = b.merge(pos, on=["player_id", "season"], how="left")
    for df in (b, p):
        for c in df.columns:
            if c not in ("source", "scraped_at", "position"):
                df[c] = pd.to_numeric(df[c], errors="coerce")
    b = b.merge(bat, on=["player_id", "season"], how="inner")
    p = p.merge(pit, on=["player_id", "season"], how="inner")
    keep = lambda d: d[(d.season <= LAST_FULL_SEASON) & ~d.season.isin(SKIP)].copy()
    b, p = keep(b), keep(p)
    b = b[b.bpa >= MIN_PA].copy()
    p = p[p.bip >= MIN_IP].copy()
    return b, p


def zs(df, cols):
    g = df.groupby("season")[cols]
    return (df[cols] - g.transform("mean")) / g.transform("std")


def design(df, cols, volume, extra=None):
    """z-scored features within season; missing -> 0 (the mean) plus a missing flag
    for columns that are absent for a meaningful share of rows."""
    cols = [c for c in cols if df[c].notna().mean() > 0.3]
    z = zs(df, cols)
    X = {}
    for c in cols:
        X[c] = z[c].fillna(0)
        if z[c].isna().mean() > 0.05:
            X[c + "_missing"] = z[c].isna().astype(float)
    X = pd.DataFrame(X, index=df.index)
    if extra is not None:
        X = pd.concat([X, extra], axis=1)
    return X


def ridge_fit(X, y, w, alpha):
    mu, sd = np.average(X, axis=0, weights=w), X.std(axis=0).replace(0, 1).values
    Xs = (X.values - mu) / sd
    sw = np.sqrt(w)[:, None]
    ym = np.average(y, weights=w)
    A = (Xs * sw).T @ (Xs * sw) + alpha * np.eye(Xs.shape[1])
    beta = np.linalg.solve(A, (Xs * sw).T @ ((y - ym) * sw[:, 0]))
    return beta, mu, sd, ym


def ridge_pred(model, X):
    beta, mu, sd, ym = model
    return ((X.values - mu) / sd) @ beta + ym


def cv_r2(X, y, vol, mode, folds, alpha):
    """Out-of-sample predictions of TOTAL bWAR. mode 'add': fit y directly.
    mode 'rate': fit y/vol weighted by vol, predict rate * vol."""
    pred = np.zeros(len(y))
    for k in range(5):
        tr, te = folds != k, folds == k
        if mode == "add":
            m = ridge_fit(X[tr], y[tr], np.ones(tr.sum()), alpha)
            pred[te] = ridge_pred(m, X[te])
        else:
            m = ridge_fit(X[tr], y[tr] / vol[tr], vol[tr], alpha)
            pred[te] = ridge_pred(m, X[te]) * vol[te]
    ss_res, ss_tot = ((y - pred) ** 2).sum(), ((y - y.mean()) ** 2).sum()
    return 1 - ss_res / ss_tot, pred


def best_alpha(X, y, vol, mode, folds):
    scores = {a: cv_r2(X, y, vol, mode, folds, a)[0] for a in ALPHAS}
    a = max(scores, key=scores.get)
    return a, scores[a]


def run_group(name, df, vol_col, vol_scale, process, results, extra_fn=None):
    df = df.reset_index(drop=True)
    y = df["bwar"].values
    vol = (df[vol_col] / vol_scale).values
    folds = (df["player_id"].values % 5)
    extra = extra_fn(df) if extra_fn else pd.DataFrame(index=df.index)
    vol_df = pd.DataFrame({"volume": vol}, index=df.index)

    out = {"group": name, "n": len(df), "bwar_sd": y.std()}
    X0 = pd.concat([vol_df, extra], axis=1)
    out["playing_time_only"] = best_alpha(X0, y, vol, "add", folds)[1]

    Xp = design(df, process, vol_col, extra)
    Xa = pd.concat([vol_df, Xp], axis=1)
    a_add, r_add = best_alpha(Xa, y, vol, "add", folds)
    a_rate, r_rate = best_alpha(Xp, y, vol, "rate", folds)
    out["additive"], out["rate_x_volume"] = r_add, r_rate

    Xr = design(df, results, vol_col, extra)
    out["results_ceiling"] = best_alpha(Xr, y, vol, "rate", folds)[1]

    # residuals + coefficients from the better process model, fit on all data
    mode = "rate" if r_rate >= r_add else "add"
    X, a = (Xp, a_rate) if mode == "rate" else (Xa, a_add)
    r2, oof = cv_r2(X, y, vol, mode, folds, a)
    out["best_mode"] = mode
    out["resid_sd_war"] = (y - oof).std()
    if mode == "rate":
        beta, mu, sd, ym = ridge_fit(X, y / vol, vol, a)
    else:
        beta, mu, sd, ym = ridge_fit(X, y, np.ones(len(y)), a)
    coefs = pd.Series(beta, index=X.columns).sort_values(key=abs, ascending=False)
    res = df[["player_id", "season", "bwar"]].copy()
    res["group"], res["expected_war"] = name, oof
    res["gap"] = res["bwar"] - res["expected_war"]
    return out, coefs, res


if __name__ == "__main__":
    b, p = load()
    p["role"] = np.where(p.gs / p.g.replace(0, np.nan) >= 0.5, "SP", "RP")
    posdum = lambda d: pd.get_dummies(d["position"].fillna("DH"), prefix="pos", dtype=float)
    groups = [
        run_group("batters", b, "bpa", 600.0, BAT_PROCESS, BAT_RESULTS, posdum),
        run_group("SP", p[p.role == "SP"], "bip", 180.0, PIT_PROCESS, PIT_RESULTS),
        run_group("RP", p[p.role == "RP"], "bip", 65.0, PIT_PROCESS, PIT_RESULTS),
    ]
    summary = pd.DataFrame([g[0] for g in groups]).set_index("group")
    pd.set_option("display.width", 200)
    print("\nOut-of-sample R^2 for same-season bWAR (5-fold by player)")
    print(summary.round(3).to_string())
    for g, (_, coefs, _) in zip(["batters", "SP", "RP"], groups):
        print(f"\nTop standardized coefficients -- {g}")
        print(coefs.head(12).round(3).to_string())
    pd.concat([g[2] for g in groups]).to_csv("expected_war_results.csv", index=False)
