import math

import pybaseball as pb


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def fetch_batter_advanced(season: int) -> dict[int, dict]:
    expected = pb.statcast_batter_expected_stats(season, minPA=0)
    exitvelo = pb.statcast_batter_exitvelo_barrels(season, minBBE=0)
    sprint = pb.statcast_sprint_speed(season, min_opp=0)

    advanced: dict[int, dict] = {}
    for _, row in expected.iterrows():
        advanced[int(row["player_id"])] = {
            "xba": _clean(row["est_ba"]),
            "xslg": _clean(row["est_slg"]),
            "xwoba": _clean(row["est_woba"]),
            "woba": _clean(row["woba"]),
        }
    for _, row in exitvelo.iterrows():
        pid = int(row["player_id"])
        advanced.setdefault(pid, {})
        advanced[pid].update(
            {
                "barrel_rate": _clean(row["brl_percent"]),
                "hard_hit_rate": _clean(row["ev95percent"]),
                "avg_exit_velo": _clean(row["avg_hit_speed"]),
            }
        )
    for _, row in sprint.iterrows():
        pid = int(row["player_id"])
        advanced.setdefault(pid, {})
        advanced[pid]["sprint_speed"] = _clean(row["sprint_speed"])

    return advanced


def fetch_pitcher_advanced(season: int) -> dict[int, dict]:
    expected = pb.statcast_pitcher_expected_stats(season, minPA=0)
    exitvelo = pb.statcast_pitcher_exitvelo_barrels(season, minBBE=0)

    advanced: dict[int, dict] = {}
    for _, row in expected.iterrows():
        advanced[int(row["player_id"])] = {
            "xera": _clean(row["xera"]),
            "xwoba_against": _clean(row["est_woba"]),
        }
    for _, row in exitvelo.iterrows():
        pid = int(row["player_id"])
        advanced.setdefault(pid, {})
        advanced[pid].update(
            {
                "barrel_rate_against": _clean(row["brl_percent"]),
                "hard_hit_rate_against": _clean(row["ev95percent"]),
                "avg_exit_velo_against": _clean(row["avg_hit_speed"]),
            }
        )

    return advanced
