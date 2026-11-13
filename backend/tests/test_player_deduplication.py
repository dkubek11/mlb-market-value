import pytest
from app.dashboard_data import build_dashboard_payload, TWO_WAY_PLAYER_IDS
from build_dashboard import build_dashboard_data


def test_no_duplicate_player_records_except_two_way():
    """Verify that only designated two-way players have multiple records in allPlayers."""
    data = build_dashboard_data(2026)
    players = data["allPlayers"]

    seen = {}
    duplicates = []
    for p in players:
        pid = p["id"]
        if pid in seen:
            if pid not in TWO_WAY_PLAYER_IDS:
                duplicates.append((pid, p["name"], seen[pid]["position"], p["position"]))
        else:
            seen[pid] = p

    assert len(duplicates) == 0, f"Found unexpected duplicate player records: {duplicates}"


def test_carlos_cortes_deduplication_and_secondary_position():
    """Carlos Cortes is an Outfielder/DH, NOT a relief pitcher."""
    data = build_dashboard_data(2026)
    cortes_records = [p for p in data["allPlayers"] if p["id"] == 666126]
    assert len(cortes_records) == 1, f"Carlos Cortes has {len(cortes_records)} records, expected 1"

    cortes = cortes_records[0]
    assert cortes["position"] == "RF"
    # Must NOT be labeled as RP/Relief Pitcher
    assert cortes["secondaryPosition"] != "RP"
    assert "RP" not in cortes["positions"]
    # Real fielding/DH secondary positions (LF, DH)
    assert "LF" in cortes["positions"]
    assert "DH" in cortes["positions"]
    assert cortes["isBatter"] is True
    assert cortes.get("isTwoWay") is False


def test_position_players_who_pitched_in_blowouts_never_labeled_rp():
    """Position players pitching mop-up innings in blowouts must never have RP as a secondary position."""
    data = build_dashboard_data(2026)
    players = data["allPlayers"]

    blowout_hitters = {624428, 543510, 595978, 668670, 656716, 686475, 620443, 666126, 660710, 645302, 663494, 623168, 680474}
    for p in players:
        if p["id"] in blowout_hitters:
            assert p["secondaryPosition"] != "RP", f"{p['name']} unexpectedly has RP secondaryPosition"
            assert "RP" not in p["positions"], f"{p['name']} unexpectedly has RP in positions"


def test_shohei_ohtani_retains_two_way_functionality():
    """Shohei Ohtani should have DH and SP records with isTwoWay: True."""
    data = build_dashboard_data(2026)
    ohtani_records = [p for p in data["allPlayers"] if p["id"] == 660271]
    assert len(ohtani_records) == 2, f"Shohei Ohtani has {len(ohtani_records)} records, expected 2"

    positions = {p["position"] for p in ohtani_records}
    assert positions == {"DH", "SP"}
    for p in ohtani_records:
        assert p.get("isTwoWay") is True


def test_frontend_card_and_table_secondary_position_render():
    """Verify frontend card hero and table rendering shows secondary position and zero duplicate rows."""
    import subprocess
    node_code = r"""
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const mockPlayers = [
      {
        id: 666126, name: 'Carlos Cortes', isBatter: true, position: 'RF', secondaryPosition: 'LF, DH',
        positions: ['RF', 'LF', 'DH'], isTwoWay: false, team: 'OAK', salary: 780000, aav: 780000,
        isPreArb: true, stats: { fwar: 0.19, bwar: -1.05 }
      },
      {
        id: 660271, name: 'Shohei Ohtani', isBatter: true, position: 'DH', secondaryPosition: 'SP',
        positions: ['DH', 'SP'], isTwoWay: true, team: 'LAD', salary: 70000000, aav: 70000000,
        isPreArb: false, stats: { fwar: 7.2, bwar: 7.0 }
      },
      {
        id: 660271, name: 'Shohei Ohtani', isBatter: false, position: 'SP', secondaryPosition: 'DH',
        positions: ['SP', 'DH'], isTwoWay: true, team: 'LAD', salary: 70000000, aav: 70000000,
        isPreArb: false, stats: { fwar: 3.5, bwar: 3.2 }
      }
    ];

    let cardRootHtml = '';
    const mockElement = {
      textContent: '', innerHTML: '', value: '',
      style: { removeProperty: () => {}, setProperty: () => {} },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {}, appendChild: () => {}, querySelectorAll: () => [],
      querySelector: () => null, addEventListener: () => {}, scrollTo: () => {},
    };
    const cardRoot = {
      ...mockElement,
      set innerHTML(val) { cardRootHtml = val; },
      get innerHTML() { return cardRootHtml; }
    };
    const loc = { hash: '', pathname: '/', search: '', href: 'http://localhost:8000/' };
    const sandbox = {
      console, CURRENT_SEASON: 2026, URLSearchParams,
      window: { addEventListener: () => {}, location: loc },
      location: loc,
      document: {
        documentElement: mockElement, body: mockElement,
        getElementById: (id) => id === 'card-root' ? cardRoot : mockElement,
        querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}
      },
      localStorage: { getItem: () => null, setItem: () => {} }
    };
    const context = vm.createContext(sandbox);
    const partsDir = path.resolve('frontend/dashboard/parts/js');
    const jsParts = ['core.js', 'player-card.js', 'scoring.js', 'tables.js'];
    for (const f of jsParts) {
      let code = fs.readFileSync(path.join(partsDir, f), 'utf8');
      if (f === 'core.js') {
        code = code.replace('const DATA = __DATA_JSON__;', 'const DATA = ' + JSON.stringify({
          allPlayers: mockPlayers, teams: [{ abbr: 'OAK', name: 'Oakland Athletics' }, { abbr: 'LAD', name: 'Los Angeles Dodgers' }],
          teamColors: { OAK: ['#003831', '#EFB21E'], LAD: ['#005A9C', '#A5ACAF'] },
          capturedAt: '2026-11-12 12:00:00 UTC', season: 2026
        }) + ';');
      }
      vm.runInContext(code, context);
    }
    vm.runInContext('recomputeAll()', context);

    const players = vm.runInContext('allPlayers', context);
    const cortesMatches = players.filter(p => p.id === 666126);
    if (cortesMatches.length !== 1) throw new Error(`Expected 1 Cortes, found ${cortesMatches.length}`);

    const cortes = cortesMatches[0];
    if (cortes.position !== 'RF') throw new Error(`Expected RF, got ${cortes.position}`);
    if (cortes.secondaryPosition !== 'LF, DH') throw new Error(`Expected secondaryPosition LF, DH, got ${cortes.secondaryPosition}`);

    context.openPlayerCard(cortes);
    const heroMetaMatch = cardRootHtml.match(/<div class="card-hero-meta">([\s\S]*?)<\/div>/);
    if (!heroMetaMatch) {
      throw new Error('Could not find card-hero-meta in cardRootHtml: ' + cardRootHtml.slice(0, 500));
    }
    const heroMeta = heroMetaMatch[1];
    if (!heroMeta.includes('RF · Sec: LF, DH')) {
      throw new Error('Player card hero meta does not display secondary position: ' + heroMeta);
    }
    if (/\bRP\b/.test(heroMeta)) {
      throw new Error('Player card hero meta unexpectedly contains RP for Carlos Cortes: ' + heroMeta);
    }

    const nameCell = context.nameCellHtml(cortes);
    if (!nameCell.includes('sec-pos-pill') || !nameCell.includes('LF, DH')) {
      throw new Error('Table name cell does not display secondary position badge: ' + nameCell);
    }

    console.log('FRONTEND_DEDUP_TEST_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node frontend dedup test failed: {res.stderr}\\n{res.stdout}"
    assert "FRONTEND_DEDUP_TEST_OK" in res.stdout
