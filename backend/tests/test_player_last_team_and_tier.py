import pytest
from sqlalchemy import text
from app.db import engine


def test_nick_castellanos_last_team_is_san_diego():
    """Nick Castellanos was with the Padres in 2026 before release, not Phillies."""
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT ps.team_id, t.abbreviation
            FROM player_seasons ps
            JOIN teams t ON t.team_id = ps.team_id
            WHERE ps.player_id = 592206 AND ps.season = 2026
        """)).mappings().first()
    assert row is not None, "Nick Castellanos (592206) missing in player_seasons for 2026"
    assert row["abbreviation"] == "SD", f"Expected SD, got {row['abbreviation']}"


def test_no_discrepancy_between_player_seasons_and_salaries_team():
    """All 2026 player_seasons teams must match player_salaries authoritative latest team."""
    with engine.connect() as conn:
        mismatches = conn.execute(text("""
            SELECT ps.player_id, p.full_name, t_ps.abbreviation AS ps_team, t_sal.abbreviation AS sal_team
            FROM player_seasons ps
            JOIN players p ON p.player_id = ps.player_id
            JOIN player_salaries sal ON sal.player_id = ps.player_id AND sal.season = ps.season
            JOIN teams t_ps ON t_ps.team_id = ps.team_id
            JOIN teams t_sal ON t_sal.team_id = sal.team_id
            WHERE ps.season = 2026 AND ps.team_id != sal.team_id
        """)).mappings().all()
    assert len(mismatches) == 0, f"Found {len(mismatches)} team mismatches, e.g.: {mismatches[:3]}"



def test_tier_for_player_classification_js():
    """Verify tierForPlayer returns Tier D/Below Avg and Tier F/Poor with proper cls."""
    import subprocess
    node_code = """
    const fs = require('fs');
    const vm = require('vm');
    const coreJs = fs.readFileSync('frontend/dashboard/parts/js/core.js', 'utf8')
      .replace('const DATA = __DATA_JSON__;', 'const DATA = { allPlayers: [], teams: [], capturedAt: \"2026-11-12 12:00:00 UTC\" };');
    const sandbox = { window: {}, console, document: { getElementById: () => ({ textContent: '', classList: { toggle: () => {} } }) } };
    vm.createContext(sandbox);
    vm.runInContext(coreJs, sandbox);
    
    const t95 = sandbox.tierForPlayer({ compPct: 95 });
    const t80 = sandbox.tierForPlayer({ compPct: 80 });
    const t60 = sandbox.tierForPlayer({ compPct: 60 });
    const t40 = sandbox.tierForPlayer({ compPct: 40 });
    const t10 = sandbox.tierForPlayer({ compPct: 10 });
    
    if (t95.cls !== 'a' || t95.label !== 'Great') throw new Error('Tier A mismatch');
    if (t80.cls !== 'b' || t80.label !== 'Good') throw new Error('Tier B mismatch');
    if (t60.cls !== 'c' || t60.label !== 'Avg') throw new Error('Tier C mismatch');
    if (t40.cls !== 'd' || t40.label !== 'Below Avg') throw new Error('Tier D mismatch: ' + JSON.stringify(t40));
    if (t10.cls !== 'f' || t10.label !== 'Poor') throw new Error('Tier F mismatch: ' + JSON.stringify(t10));
    console.log('TIER_TEST_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node test failed: {res.stderr}\\n{res.stdout}"
    assert "TIER_TEST_OK" in res.stdout


def test_nick_castellanos_card_renders_tier_f_and_san_diego():
    """Verify Nick Castellanos player card renders Tier F/Poor and San Diego Padres."""
    import subprocess
    node_code = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const snapshotData = JSON.parse(fs.readFileSync('frontend/dashboard/.snapshot_cache/dashboard_2026.json'));
    let renderedCardHtml = '';
    const mockElement = {
      textContent: '',
      innerHTML: '',
      value: '',
      style: { removeProperty: () => {}, setProperty: () => {} },
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {},
      appendChild: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
      scrollTo: () => {},
    };
    const sandbox = {
      console,
      CURRENT_SEASON: 2026,
      SNAPSHOT_DATA: snapshotData,
      document: {
        getElementById: (id) => {
          if (id === 'card-root' || id === 'card-body') {
            return {
              set innerHTML(val) { renderedCardHtml = val; },
              get innerHTML() { return renderedCardHtml; },
              style: {},
              scrollTop: 0,
              addEventListener: () => {},
              setAttribute: () => {},
              classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            };
          }
          return mockElement;
        },
        querySelector: () => mockElement,
        querySelectorAll: () => [],
        documentElement: mockElement,
        body: { classList: { add: () => {}, remove: () => {} } },
        addEventListener: () => {}
      },
      setTimeout: (fn) => fn(),
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    const partsDir = path.resolve('frontend/dashboard/parts/js');
    const jsParts = ['core.js', 'player-card.js', 'scoring.js'];
    let combinedCode = '';
    for (const file of jsParts) {
      let code = fs.readFileSync(path.join(partsDir, file), 'utf8');
      if (file === 'core.js') {
        code = code.replace('const DATA = __DATA_JSON__;', 'const DATA = SNAPSHOT_DATA;');
      }
      combinedCode += code + '\\n';
    }
    vm.runInContext(combinedCode, context);
    vm.runInContext('recomputeAll()', context);
    const nick = vm.runInContext('allPlayers.find(p => p.id === 592206)', context);
    if (!nick) throw new Error('Nick Castellanos not found in allPlayers');
    if (nick.team !== 'SD') throw new Error('Nick Castellanos team expected SD, got ' + nick.team);
    
    context.openPlayerCard(nick);
    const html = renderedCardHtml;
    if (!html.includes('SAN DIEGO PADRES')) {
      throw new Error('Player card does not include SAN DIEGO PADRES: ' + html.slice(0, 300));
    }
    if (!html.includes('Tier F/Poor')) {
      throw new Error('Player card does not include Tier F/Poor: ' + html.slice(0, 500));
    }
    if (!html.includes('tier-f')) {
      throw new Error('Player card missing tier-f class');
    }
    console.log('E2E_NICK_TEST_OK');
    """
    res = subprocess.run(["node", "-e", node_code], capture_output=True, text=True)
    assert res.returncode == 0, f"Node E2E test failed: {res.stderr}\\n{res.stdout}"
    assert "E2E_NICK_TEST_OK" in res.stdout
