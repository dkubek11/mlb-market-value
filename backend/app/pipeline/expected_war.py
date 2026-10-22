"""Expected bWAR: what a player's process stats say their bWAR "should" have
been, given the playing time and position they actually had.

The dashboard's Score ranks actual bWAR (what the player produced). This is
the other half -- a predicted score built from the repeatable inputs
(xwOBA, xERA, barrel rate, K%, ...) -- and the gap between the two separates
production that the underlying quality supports from production that
looks like luck, defense the model can't see, or leverage.

Model (one per group: batters, pitchers):
    bWAR / volume  =  intercept + offset[position or role] + sum_i w_i * z_i
    expected bWAR  =  volume * that rate
where z_i is the stat standardized within its season (so league-wide drift
doesn't leak in) and oriented so higher always means better, volume is
PA/600 for batters and IP/100 for pitchers, and the weights are fit by
volume-weighted non-negative least squares on every completed season before
the one being scored (2020 excluded). Non-negative weights keep every stat
pushing in the direction baseball says it should and make the weights
directly usable as dashboard sliders: w_i is "bWAR per full season for a
one-standard-deviation-better <stat>".  Position/role offsets and the
intercept are unconstrained (they carry the position adjustment).

Out-of-sample R^2 (5-fold, folds by player) is exported with the weights so
the UI can state how much of WAR this explains.
"""

import numpy as np
import pandas as pd
from scipy.optimize import nnls

from app.db import engine

FIRST_SEASON = 2015
SKIP_SEASONS = {2020}  # 60-game season
MIN_PA = 100
MIN_IP = 40

# stat -> orientation (+1 higher is better, -1 lower is better)
BATTER_FEATURES = {
    "xwoba": 1, "xslg": 1, "xba": 1, "barrel_rate": 1, "hard_hit_rate": 1,
    "k_rate": -1, "bb_rate": 1, "chase_rate": -1, "whiff_rate": -1,
    "sprint_speed": 1, "sb": 1, "oaa": 1, "frv": 1, "drs": 1,
}
PITCHER_FEATURES = {
    "xera": -1, "xba_against": -1, "k_rate": 1, "bb_rate": -1, "whiff_rate": 1,
    "chase_rate": 1, "z_swing_rate": -1, "barrel_rate_against": -1,
    "hard_hit_rate_against": -1, "avg_exit_velo_against": -1,
    "stuff_plus": 1, "location_plus": 1, "extension": 1,
}
BATTER_VOLUME_SCALE = 600.0  # PA
PITCHER_VOLUME_SCALE = 100.0  # IP
POS_DISPLAY = {"FIRST_BASE": "1B", "SECOND_BASE": "2B", "THIRD_BASE": "3B"}


def _numeric(df: pd.DataFrame) -> pd.DataFrame:
    for c in df.columns:
        if c not in ("source", "scraped_at", "position"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _load_batters() -> pd.DataFrame:
    b = pd.read_sql("select * from batter_stats", engine)
    f = pd.read_sql("select player_id, season, oaa, frv, drs from fielding_stats", engine)
    pos = (pd.read_sql("select player_id, season, position from player_seasons where player_type='BATTER'", engine)
           .drop_duplicates(["player_id", "season"]))
    b = b.merge(f, on=["player_id", "season"], how="left").merge(pos, on=["player_id", "season"], how="left")
    b = _numeric(b)
    b["position"] = b["position"].map(lambda p: POS_DISPLAY.get(p, p) if isinstance(p, str) else "DH")
    b["volume"] = b["pa"] / BATTER_VOLUME_SCALE
    return b[b["pa"] >= MIN_PA].copy()


def _load_pitchers() -> pd.DataFrame:
    p = pd.read_sql("select * from pitcher_stats", engine)
    pos = (pd.read_sql("select player_id, season, position from player_seasons where player_type='PITCHER'", engine)
           .drop_duplicates(["player_id", "season"]))
    p = _numeric(p.merge(pos, on=["player_id", "season"], how="left"))
    p["role"] = np.where(p["position"] == "SP", "SP", "RP")
    p["volume"] = p["ip"] / PITCHER_VOLUME_SCALE
    return p[p["ip"] >= MIN_IP].copy()


def _zparams(df: pd.DataFrame, features: dict, season: int) -> dict:
    cur = df[df["season"] == season]
    return {s: (float(cur[s].mean()), float(cur[s].std())) for s in features if cur[s].notna().sum() > 1}


def _z_within_season(df: pd.DataFrame, features: dict) -> pd.DataFrame:
    out = {}
    for s, sign in features.items():
        g = df.groupby("season")[s]
        out[s] = (sign * (df[s] - g.transform("mean")) / g.transform("std")).fillna(0.0)
    return pd.DataFrame(out, index=df.index)


def _extra(df: pd.DataFrame, group: str) -> pd.DataFrame:
    if group == "batter":
        return pd.get_dummies(df["position"], prefix="o", dtype=float)
    return pd.DataFrame({"o_RP": (df["role"] == "RP").astype(float)}, index=df.index)


def _design(X: pd.DataFrame, E: pd.DataFrame, ex_cols: list[str]) -> np.ndarray:
    """[oriented z (>=0) | offsets (+/-) | intercept (+/-)] -- free-sign
    columns are represented as a (+col, -col) pair so NNLS can still fit them."""
    E = E.reindex(columns=ex_cols, fill_value=0.0)
    ones = np.ones((len(X), 1))
    return np.hstack([X.values, E.values, -E.values, ones, -ones])


def _fit(X, E, ex_cols, y, vol):
    A = _design(X, E, ex_cols)
    sw = np.sqrt(vol)
    beta, _ = nnls(A * sw[:, None], (y / vol) * sw, maxiter=10000)
    return beta


def _unpack(beta, feat_cols, ex_cols):
    n, m = len(feat_cols), len(ex_cols)
    weights = {c: float(beta[i]) for i, c in enumerate(feat_cols)}
    offsets = {c[2:]: float(beta[n + i] - beta[n + m + i]) for i, c in enumerate(ex_cols)}
    intercept = float(beta[n + 2 * m] - beta[n + 2 * m + 1])
    return weights, offsets, intercept


def _fit_group(df: pd.DataFrame, features: dict, group: str, season: int) -> dict:
    train = df[(df["season"] < season) & ~df["season"].isin(SKIP_SEASONS)
               & (df["season"] >= FIRST_SEASON) & df["bwar"].notna()].reset_index(drop=True)
    X = _z_within_season(train, features)
    E = _extra(train, group)
    ex_cols = list(E.columns)
    y, vol = train["bwar"].values, train["volume"].values
    folds = train["player_id"].values % 5
    pred = np.zeros(len(y))
    for k in range(5):
        tr, te = folds != k, folds == k
        beta = _fit(X[tr], E[tr], ex_cols, y[tr], vol[tr])
        pred[te] = _design(X[te], E[te], ex_cols) @ beta * vol[te]
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    beta = _fit(X, E, ex_cols, y, vol)
    weights, offsets, intercept = _unpack(beta, list(features), ex_cols)
    return {
        "weights": weights, "offsets": offsets, "intercept": intercept,
        "volumeScale": BATTER_VOLUME_SCALE if group == "batter" else PITCHER_VOLUME_SCALE,
        "cvR2": round(float(r2), 3), "nTrain": int(len(train)),
        "trainSeasons": f"{int(train['season'].min())}-{int(train['season'].max())} (excl. 2020)",
        "residSdWar": round(float((y - pred).std()), 2),
    }


def build(season: int) -> tuple[dict, dict]:
    """Returns (model, zparams): the fitted models for both groups, and the
    per-stat (mean, std) of `season`'s own qualifying population (the same
    PA>=100 / IP>=40 population the model was trained on) used to standardize
    each current-season player."""
    bat, pit = _load_batters(), _load_pitchers()
    model = {
        "batter": _fit_group(bat, BATTER_FEATURES, "batter", season),
        "pitcher": _fit_group(pit, PITCHER_FEATURES, "pitcher", season),
    }
    zparams = {
        "batter": _zparams(bat, BATTER_FEATURES, season),
        "pitcher": _zparams(pit, PITCHER_FEATURES, season),
    }
    return model, zparams


def player_inputs(row, is_batter: bool, zparams: dict) -> dict:
    """{volume, predZ} for one dashboard player row (a namedtuple from the
    BATTER_Q/PITCHER_Q frames): oriented z for every model stat the player
    has, standardized against the full qualifying population. Missing stats
    are simply omitted (the frontend treats them as 0 = league average,
    exactly how the training data handled them)."""
    feats = BATTER_FEATURES if is_batter else PITCHER_FEATURES
    params = zparams["batter" if is_batter else "pitcher"]
    z = {}
    for s, sign in feats.items():
        val = getattr(row, s, None)
        if val is None or pd.isna(val) or s not in params or not params[s][1] > 0:
            continue
        mean, std = params[s]
        z[s] = round(sign * (float(val) - mean) / std, 4)
    volume = (float(row.pa) / BATTER_VOLUME_SCALE) if is_batter else (float(row.ip) / PITCHER_VOLUME_SCALE)
    return {"volume": round(volume, 4), "predZ": z}
