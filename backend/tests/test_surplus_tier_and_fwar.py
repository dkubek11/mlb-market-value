import sys
from pathlib import Path
import pytest
from app.dashboard_data import build_dashboard_payload

# Ensure frontend/dashboard is on sys.path for build_dashboard
dashboard_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard"
if str(dashboard_dir) not in sys.path:
    sys.path.insert(0, str(dashboard_dir))
from build_dashboard import build_dashboard_data


def test_fwar_present_in_batter_and_pitcher_stats():
    """Verify fwar is included in stats for batters and pitchers in dashboard data."""
    # Test in build_dashboard_data (authoritative for full dashboard snapshot)
    data = build_dashboard_data(2026)
    players = data["allPlayers"]

    cortes = next((p for p in players if p["id"] == 666126), None)
    assert cortes is not None, "Carlos Cortes missing from allPlayers"
    assert "fwar" in cortes["stats"], "fwar missing from Carlos Cortes stats"
    assert cortes["stats"]["fwar"] is not None
    assert round(float(cortes["stats"]["fwar"]), 2) == 0.19

    nick = next((p for p in players if p["id"] == 592206), None)
    assert nick is not None, "Nick Castellanos missing from allPlayers"
    assert "fwar" in nick["stats"], "fwar missing from Nick Castellanos stats"
    assert nick["stats"]["fwar"] is not None
    assert round(float(nick["stats"]["fwar"]), 2) == -0.86

    # Also test API payload for qualified players
    payload = build_dashboard_payload(2026)
    cortes_api = next((p for p in payload["allPlayers"] if p["id"] == 666126), None)
    assert cortes_api is not None
    assert "fwar" in cortes_api["stats"]
    assert round(float(cortes_api["stats"]["fwar"]), 2) == 0.19


def test_cortes_and_castellanos_fwar_performance_ranking_js():
    """Carlos Cortes should rank ~46th percentile (not 1st), Nick Castellanos ~2nd percentile."""
    import subprocess
    node_code = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    // Assemble mock snapshot with Cortes and Castellanos having fwar and bwar
    const mockPlayers = [
      { id: 666126, name: 'Carlos Cortes', isBatter: true, position: 'RF', team: 'OAK', salary: 780000, aav: 780000, isPreArb: true, stats: { fwar: 0.19, bwar: -1.05 } },
      { id: 592206, name: 'Nick Castellanos', isBatter: true, position: 'DH', team: 'SD', salary: 20780000, aav: 20000000, isPreArb: false, stats: { fwar: -0.86, bwar: -0.97 } }
    ];
    // Add realistic distribution where bottom 3% are below -0.86, ~45% <= 0.19, rest > 0.19
    for (let i = 0; i < 98; i++) {
      let fwarVal;
      if (i < 3) fwarVal = -1.5 + (i * 0.2); // below Nick (-0.86)
      else if (i < 45) fwarVal = -0.80 + ((i - 3) * 0.023); // between Nick and Carlos (0.19)
      else fwarVal = 0.25 + ((i - 45) * 0.1); // above Carlos
      mockPlayers.push({
        id: 1000 + i, name: 'Player ' + i, isBatter: true, position: 'OF', team: 'NYY', salary: 2000000, aav: 2000000, isPreArb: false,
        stats: { fwar: fwarVal, bwar: fwarVal }
      });
    }

    const partsDir = path.resolve('frontend/dashboard/parts/js');
    const sandbox = {
      console,
      SNAPSHOT_DATA: { allPlayers: mockPlayers, teams: [], season: 2026, capturedAt: '2026-11-12 12:00:00 UTC' },
      window: {},
      document: { getElementById: () => ({ textContent: '', classList: { toggle: () => {} }, addEventListener: () => {} }), querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} }
    };
    const context = vm.createContext(sandbox);
    const coreJs = fs.readFileSync(path.join(partsDir, 'core.js'), 'utf8')
      .replace('const DATA = __DATA_JSON__;', 'const DATA = SNAPSHOT_DATA;');
    const cardJs = fs.readFileSync(path.join(partsDir, 'player-card.js'), 'utf8');
    const scoringJs = fs.readFileSync(path.join(partsDir, 'scoring.js'), 'utf8');

    vm.runInContext(coreJs, context);
    vm.runInContext(cardJs, context);
    vm.runInContext(scoringJs, context);
    vm.runInContext('recomputeAll()', context);

    const cortes = vm.runInContext('allPlayers.find(p => p.id === 666126)', context);
    const nick = vm.runInContext('allPlayers.find(p => p.id === 592206)', context);

    if (cortes.compPct < 30) throw new Error('Cortes compPct too low: ' + cortes.compPct);
    if (nick.compPct > 10) throw new Error('Nick compPct too high: ' + nick.compPct);
    console.log('RANKING_TEST_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node ranking test failed: {res.stderr}\\n{res.stdout}"
    assert "RANKING_TEST_OK" in res.stdout


def test_tier_for_player_positive_surplus_never_poor():
    """No player with positive net surplus should ever be classified as Tier F/Poor."""
    import subprocess
    node_code = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const partsDir = path.resolve('frontend/dashboard/parts/js');
    const sandbox = {
      console,
      SNAPSHOT_DATA: { allPlayers: [], teams: [], season: 2026, capturedAt: '2026-11-12 12:00:00 UTC' },
      window: {},
      document: { getElementById: () => ({ textContent: '', classList: { toggle: () => {} }, addEventListener: () => {} }) }
    };
    const context = vm.createContext(sandbox);
    const coreJs = fs.readFileSync(path.join(partsDir, 'core.js'), 'utf8')
      .replace('const DATA = __DATA_JSON__;', 'const DATA = SNAPSHOT_DATA;');
    vm.runInContext(coreJs, context);

    // Player with 10th percentile performance but positive surplus (+4.2M)
    const pPositiveSurplus = { compPct: 10, paySurplus: 4220000, salary: 780000 };
    const tierPos = context.tierForPlayer(pPositiveSurplus);
    if (tierPos.cls === 'f' || tierPos.label === 'Poor') {
      throw new Error('Positive surplus player classified as Poor: ' + JSON.stringify(tierPos));
    }

    // Player with 10th percentile performance and modest positive surplus (+500K)
    const pModestSurplus = { compPct: 10, paySurplus: 500000, salary: 780000 };
    const tierModest = context.tierForPlayer(pModestSurplus);
    if (tierModest.cls === 'f' || tierModest.label === 'Poor') {
      throw new Error('Modest positive surplus player classified as Poor: ' + JSON.stringify(tierModest));
    }
    if (tierModest.cls !== 'd') {
      throw new Error('Modest positive surplus player expected Tier D: ' + JSON.stringify(tierModest));
    }

    // Player with 10th percentile performance and negative surplus (-16M)
    const pNegSurplus = { compPct: 10, paySurplus: -16000000, salary: 20000000 };
    const tierNeg = context.tierForPlayer(pNegSurplus);
    if (tierNeg.cls !== 'f' || tierNeg.label !== 'Poor') {
      throw new Error('Negative surplus low-pct player should be Poor: ' + JSON.stringify(tierNeg));
    }

    console.log('TIER_SURPLUS_TEST_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node surplus tier test failed: {res.stderr}\\n{res.stdout}"
    assert "TIER_SURPLUS_TEST_OK" in res.stdout


def test_snapshot_e2e_zero_positive_surplus_players_are_poor():
    """In the real snapshot, zero players with positive net surplus should be Tier F/Poor."""
    import subprocess
    node_code = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const snapshot = JSON.parse(fs.readFileSync('frontend/dashboard/.snapshot_cache/dashboard_2026.json'));

    const mockElement = {
      textContent: '', innerHTML: '', value: '',
      style: { removeProperty: () => {}, setProperty: () => {} },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {}, appendChild: () => {}, querySelectorAll: () => [],
      querySelector: () => null, addEventListener: () => {}, scrollTo: () => {},
    };
    const sandbox = {
      console, CURRENT_SEASON: 2026, SNAPSHOT_DATA: snapshot, window: {},
      document: { getElementById: () => mockElement, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} },
      localStorage: { getItem: () => null, setItem: () => {} }
    };
    const context = vm.createContext(sandbox);
    const partsDir = path.resolve('frontend/dashboard/parts/js');
    const jsParts = ['core.js', 'player-card.js', 'scoring.js'];
    for (const f of jsParts) {
      let code = fs.readFileSync(path.join(partsDir, f), 'utf8');
      if (f === 'core.js') code = code.replace('const DATA = __DATA_JSON__;', 'const DATA = SNAPSHOT_DATA;');
      vm.runInContext(code, context);
    }
    vm.runInContext('recomputeAll()', context);

    const players = vm.runInContext('allPlayers', context);
    const posPoor = players.filter(p => context.playerSurplus(p) > 0 && context.tierForPlayer(p).cls === 'f');
    if (posPoor.length > 0) {
      throw new Error(`Found ${posPoor.length} positive surplus players classified as Poor, e.g. ${posPoor[0].name}`);
    }

    const cortes = players.find(p => p.id === 666126);
    if (!cortes) throw new Error('Carlos Cortes missing');
    const cortesTier = context.tierForPlayer(cortes);
    if (cortesTier.cls === 'f') throw new Error('Carlos Cortes classified as Poor');
    if (cortes.compPct < 25) throw new Error('Carlos Cortes compPct too low (should not be at 1st percentile): ' + cortes.compPct);

    const nick = players.find(p => p.id === 592206);
    if (!nick) throw new Error('Nick Castellanos missing');
    const nickTier = context.tierForPlayer(nick);
    if (nickTier.cls !== 'f') throw new Error('Nick Castellanos should be Tier F/Poor: ' + JSON.stringify(nickTier));
    if (nick.compPct > 10) throw new Error('Nick Castellanos compPct should be low: ' + nick.compPct);

    console.log('SNAPSHOT_E2E_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node snapshot E2E failed: {res.stderr}\\n{res.stdout}"
    assert "SNAPSHOT_E2E_OK" in res.stdout

