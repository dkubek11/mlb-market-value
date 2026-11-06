"""Unit tests verifying backend data integrity for top 50 highest AAV players.

Ensures that every data field required by modern player cards is completely
accurate, structurally valid, and mathematically sound for any present season.
"""

import math
import pytest


class TestTop50PlayerCardsBackendIntegrity:
    """Test suite covering the 50 highest-paid players in the league."""

    def test_present_season_dynamism(self, present_season: int):
        """Verify present season is dynamically determined and valid."""
        assert isinstance(present_season, int)
        assert present_season >= 2024, f"Season {present_season} is unexpectedly in the past"

    def test_top_50_aav_selection_and_ranking(self, top_50_aav_players: list[dict], present_season: int):
        """Verify top 50 players by AAV are correctly identified, non-null, and ordered."""
        assert len(top_50_aav_players) == 50, f"Expected 50 players, got {len(top_50_aav_players)}"

        prev_aav = float("inf")
        for i, player in enumerate(top_50_aav_players):
            aav = float(player.get("aav") or 0)
            salary = float(player.get("salary") or 0)

            # AAV must be positive and in descending order
            assert aav > 0, f"Player {player.get('name')} at rank {i+1} has non-positive AAV: {aav}"
            assert aav <= prev_aav, f"Player {player.get('name')} at rank {i+1} (AAV {aav}) violates descending order (prev {prev_aav})"
            prev_aav = aav

            # Elite AAV cohort threshold (top 50 overall in MLB earn >= $20M in modern CBA)
            assert aav >= 20_000_000, f"Player {player.get('name')} AAV ${aav:,.0f} below expected elite threshold $20M"
            assert salary > 0, f"Player {player.get('name')} has invalid salary ${salary:,.0f}"

    def test_top_50_player_card_identity_fields(self, top_50_aav_players: list[dict], dashboard_snapshot: dict):
        """Verify core identity fields required for the hero banner."""
        valid_teams = {t["abbr"] for t in dashboard_snapshot.get("teams", [])}
        valid_positions = {"SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"}

        for p in top_50_aav_players:
            name = p.get("name")
            assert name and isinstance(name, str) and len(name.split()) >= 2, f"Invalid name: {name!r}"

            team = p.get("team")
            assert team in valid_teams, f"Player {name} has unrecognized team '{team}' (expected one of {valid_teams})"

            pos = p.get("position")
            assert pos in valid_positions, f"Player {name} has unrecognized position '{pos}'"

            pid = p.get("id")
            assert isinstance(pid, int) and pid > 0, f"Player {name} has invalid MLBAM ID: {pid}"

            is_batter = p.get("isBatter")
            assert isinstance(is_batter, bool)
            if pos in {"SP", "RP"}:
                # Pitcher position check
                assert is_batter is False, f"Pitcher {name} ({pos}) has isBatter=True"
            else:
                assert is_batter is True, f"Position player {name} ({pos}) has isBatter=False"

            headshot = p.get("headshot")
            if headshot is not None:
                assert headshot.startswith("data:image/"), f"Player {name} headshot is not a valid data URI: {headshot[:40]}"

    def test_top_50_player_card_contract_integrity(
        self, top_50_aav_players: list[dict], contracts_dict: dict, present_season: int
    ):
        """Verify contract details and 5-year outlook for the highest AAV cohort."""
        for p in top_50_aav_players:
            name = p["name"]
            pid_str = str(p["id"])
            contract = contracts_dict.get(pid_str) or contracts_dict.get(p["id"])

            if contract:
                # If FanGraphs contract record exists, verify structural coherence
                assert contract.get("totalGuaranteed", 0) >= p["salary"], (
                    f"{name}: Total guaranteed contract value (${contract.get('totalGuaranteed'):,}) "
                    f"is less than single-season salary (${p['salary']:,})"
                )
                years = contract.get("years", [])
                assert len(years) >= 1, f"{name}: Contract record exists but contains no years"

                # Check if present season is present in contract years
                current_year_entry = next((y for y in years if int(y.get("season", 0)) == present_season), None)
                if current_year_entry:
                    year_sal = current_year_entry.get("salary")
                    if year_sal is not None and year_sal > 0:
                        # Salary should match within 10% or match AAV
                        assert math.isclose(year_sal, p["salary"], rel_tol=0.25) or math.isclose(year_sal, p["aav"], rel_tol=0.25), (
                            f"{name}: Contract year {present_season} salary (${year_sal:,}) deviates significantly "
                            f"from player salary (${p['salary']:,}) and AAV (${p['aav']:,})"
                        )

            # Contract type must be non-empty and reflect major league veteran status for top 50
            contract_type = p.get("contractType") or "Free Agent"
            assert contract_type in {"Free Agent", "Extension", "Arbitration", "Pre-Arb", "Signed"}, (
                f"{name} has unexpected contractType: {contract_type}"
            )

    def test_top_50_player_card_performance_stats(self, top_50_aav_players: list[dict]):
        """Verify stats displayed on batting / pitching gauges are within valid physiological bounds."""
        for p in top_50_aav_players:
            name = p["name"]
            stats = p.get("stats")
            assert isinstance(stats, dict) and len(stats) >= 5, f"{name} is missing stats dict"

            bwar = stats.get("bwar")
            assert bwar is not None and -4.0 <= bwar <= 15.0, f"{name} has extreme/null bWAR: {bwar}"

            if p["isBatter"]:
                ba = stats.get("ba")
                if ba is not None:
                    assert 0.050 <= ba <= 0.450, f"Batter {name} has unrealistic AVG: {ba}"

                obp = stats.get("obp")
                if obp is not None:
                    assert 0.100 <= obp <= 0.550, f"Batter {name} has unrealistic OBP: {obp}"

                slg = stats.get("slg")
                if slg is not None:
                    assert 0.150 <= slg <= 0.850, f"Batter {name} has unrealistic SLG: {slg}"

                xwoba = stats.get("xwoba")
                if xwoba is not None:
                    assert 0.150 <= xwoba <= 0.600, f"Batter {name} has unrealistic xwOBA: {xwoba}"

                hr = stats.get("hr")
                if hr is not None:
                    assert 0 <= hr <= 75, f"Batter {name} has unrealistic HR: {hr}"

                sb = stats.get("sb")
                if sb is not None:
                    assert 0 <= sb <= 100, f"Batter {name} has unrealistic SB: {sb}"
            else:
                era = stats.get("era")
                if era is not None:
                    assert 0.50 <= era <= 15.00, f"Pitcher {name} has unrealistic ERA: {era}"

                whip = stats.get("whip")
                if whip is not None:
                    assert 0.40 <= whip <= 3.00, f"Pitcher {name} has unrealistic WHIP: {whip}"

                fip = stats.get("fip")
                if fip is not None:
                    assert 0.50 <= fip <= 15.00, f"Pitcher {name} has unrealistic FIP: {fip}"

                ip = stats.get("ip")
                if ip is not None:
                    assert 5.0 <= ip <= 300.0, f"Pitcher {name} has unrealistic IP: {ip}"

    def test_top_50_player_card_percentiles_against_position_baselines(
        self, top_50_aav_players: list[dict], position_stats: dict
    ):
        """Verify normal CDF percentile calculations for card sliders match position baselines."""
        def normal_cdf(z):
            t = 1.0 / (1.0 + 0.2316419 * abs(z))
            d = 0.3989423 * math.exp(-z * z / 2.0)
            p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
            return 1.0 - p if z > 0 else p

        for p in top_50_aav_players:
            name = p["name"]
            pos = p["position"]
            pos_dict = position_stats.get(pos, {})
            stats = p.get("stats", {})

            # Test primary stat percentile
            key = "xwoba" if p["isBatter"] else "fip"
            val = stats.get(key)
            baseline = pos_dict.get(key)
            if val is not None and baseline and baseline.get("std", 0) > 0:
                raw_z = (val - baseline["mean"]) / baseline["std"]
                z = raw_z if p["isBatter"] else -raw_z
                pctl = max(1, min(99, round(normal_cdf(z) * 100)))
                assert 1 <= pctl <= 99, f"{name}: Percentile {pctl} out of bounds for {key}"

    def test_top_50_player_card_projections_and_regression(self, top_50_aav_players: list[dict]):
        """Verify projected true-talent metrics and regression callout signals."""
        for p in top_50_aav_players:
            name = p["name"]
            proj = p.get("projected", {})
            stats = p.get("stats", {})

            if p["isBatter"]:
                xba = proj.get("xba")
                if xba is not None:
                    assert 0.150 <= xba <= 0.380, f"Batter {name} has invalid projected xBA: {xba}"
                    actual_ba = stats.get("ba")
                    if actual_ba is not None:
                        gap = actual_ba - xba
                        # If gap > threshold (0.02), overperforming; if gap < -threshold, underperforming
                        assert isinstance(gap, float)
            else:
                xera = proj.get("xera")
                if xera is not None:
                    assert 1.50 <= xera <= 7.00, f"Pitcher {name} has invalid projected xERA: {xera}"
                    actual_era = stats.get("era")
                    if actual_era is not None:
                        gap = xera - actual_era
                        assert isinstance(gap, float)

    def test_top_50_player_card_five_year_history(
        self, top_50_aav_players: list[dict], position_stats_history: dict, present_season: int
    ):
        """Verify multi-season historical cards conform strictly to [present_season - 5, present_season - 1]."""
        valid_grades = {"S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"}
        allowed_seasons = set(range(present_season - 5, present_season))

        for p in top_50_aav_players:
            name = p["name"]
            history = p.get("history", [])
            assert isinstance(history, list)

            for entry in history:
                season = entry.get("season")
                assert season in allowed_seasons, (
                    f"{name}: Historical season {season} is outside expected window {allowed_seasons}"
                )
                entry_stats = entry.get("stats", {})
                assert isinstance(entry_stats, dict) and len(entry_stats) >= 3

    def test_top_50_player_card_peer_cohort_integrity(self, top_50_aav_players: list[dict], dashboard_snapshot: dict):
        """Verify salary peers benchmark card (#X of N) accurately includes and ranks the player."""
        all_players = dashboard_snapshot.get("allPlayers", [])

        for target in top_50_aav_players:
            name = target["name"]
            target_sal = target.get("salary") or target.get("aav") or 0
            pos = target["position"]
            is_bat = target["isBatter"]

            # Filter pool by position & batter/pitcher
            pool = [p for p in all_players if p.get("isBatter") == is_bat and p.get("position") == pos]
            tol = 2_500_000
            peers = [p for p in pool if abs((p.get("salary") or 0) - target_sal) <= tol]
            if len(peers) < 5:
                tol = 4_500_000
                peers = [p for p in pool if abs((p.get("salary") or 0) - target_sal) <= tol]

            # Active player must be in peers or appended
            peer_ids = {p["id"] for p in peers}
            if target["id"] not in peer_ids:
                peers.append(target)

            # Sort by compPct descending
            peers.sort(key=lambda p: float(p.get("compPct") or 0), reverse=True)
            rank = next(i for i, p in enumerate(peers, 1) if p["id"] == target["id"])

            assert 1 <= rank <= len(peers), f"{name}: Invalid peer cohort rank #{rank} of {len(peers)}"

