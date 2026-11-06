"""Contract tests for the five-year fWAR outlook exposed on player records."""

from app.pipeline import war_projection


def test_war_outlook_payload_contract(dashboard_snapshot):
    players = dashboard_snapshot.get("allPlayers", [])
    assert players, "Dashboard snapshot returned no players"

    with_outlook = [p for p in players if p.get("warOutlook")]
    assert with_outlook, "Expected at least one player with a warOutlook record"

    for player in with_outlook:
        outlook = player["warOutlook"]
        assert set(outlook) >= {
            "war", "war5", "values", "years", "total", "aav", "role", "hist",
        }

        assert len(outlook["war"]) == war_projection.HORIZON
        assert len(outlook["values"]) == war_projection.HORIZON
        assert outlook["role"] in {"batter", "SP", "RP"}
        assert 0 <= outlook["years"] <= war_projection.HORIZON
        assert abs(outlook["war5"] - sum(outlook["war"])) <= 0.05 * len(outlook["war"])
        rounded_total = sum(outlook["values"][: outlook["years"]])
        assert abs(outlook["total"] - rounded_total) <= len(outlook["values"])
        if outlook["years"]:
            assert abs(outlook["aav"] - round(outlook["total"] / outlook["years"])) <= 1
        else:
            assert outlook["aav"] == 0
        assert len(outlook["hist"]) <= len(war_projection.MARCEL_WEIGHTS)


def test_pitchers_use_role_specific_outlook(dashboard_snapshot):
    pitchers = [
        p for p in dashboard_snapshot.get("allPlayers", [])
        if not p.get("isBatter") and p.get("warOutlook")
    ]
    assert pitchers, "Expected at least one pitcher with a warOutlook record"
    assert all(
        p["warOutlook"]["role"] in {"SP", "RP"} for p in pitchers
    ), "Pitcher outlooks must use SP/RP roles"


def test_hitters_use_batter_role(dashboard_snapshot):
    hitters = [
        p for p in dashboard_snapshot.get("allPlayers", [])
        if p.get("isBatter") and p.get("warOutlook")
    ]
    assert hitters, "Expected at least one hitter with a warOutlook record"
    assert all(p["warOutlook"]["role"] == "batter" for p in hitters)
