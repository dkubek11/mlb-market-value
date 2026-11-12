"""Tests for player contract classification and free-agency determination.

Verifies that players with active multi-year contract extensions (like Luis Torrens,
who is under contract with the Mets through 2028) are NOT classified as free agents,
are not listed in the Free Agents view, and are correctly recognized as under an extension
rather than arbitration-eligible.
"""

from pathlib import Path
import subprocess
import pytest


def test_extended_players_not_classified_as_free_agents():
    """Verify in the frontend JavaScript environment that players under contract beyond
    CURRENT_SEASON are never classified as nearing free agency.
    """
    script = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const root = path.resolve(__dirname, '../../');
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'frontend/dashboard/.snapshot_cache/dashboard_2026.json'), 'utf8'));

    const elements = {};
    function getEl(id) {
      if (!elements[id]) {
        elements[id] = {
          id,
          innerHTML: '',
          textContent: '',
          value: '',
          classList: { toggle: () => {}, remove: () => {}, add: () => {} },
          style: {},
          addEventListener: () => {},
          querySelectorAll: () => [],
          querySelector: () => null,
          scrollTo: () => {},
          dataset: {}
        };
      }
      return elements[id];
    }

    global.document = {
      getElementById: (id) => getEl(id),
      querySelector: (sel) => getEl(sel),
      querySelectorAll: () => [],
      addEventListener: () => {},
      documentElement: { style: { removeProperty: () => {}, setProperty: () => {} } }
    };
    global.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
    global.location = { hash: '', search: '' };

    const parts = ['core.js', 'player-card.js', 'home.js', 'tables.js', 'teams.js', 'team-view.js', 'free-agents.js', 'scoring.js', 'weights.js', 'custom.js', 'nav.js'];
    let code = '';
    for (const p of parts) {
      let c = fs.readFileSync(path.join(root, 'frontend/dashboard/parts/js', p), 'utf8');
      if (p === 'core.js') c = c.replace('__DATA_JSON__', JSON.stringify(snapshot));
      code += c + '\\n';
    }
    vm.runInThisContext(code);

    const torrens = allPlayers.find(p => p.id === 620443);
    if (!torrens) throw new Error('Luis Torrens (620443) not found in allPlayers');

    const luzardo = allPlayers.find(p => p.id === 666200);
    if (!luzardo) throw new Error('Jesús Luzardo (666200) not found in allPlayers');

    // 1. isNearingFreeAgency must be false for Torrens (under contract through 2028)
    const torrensIsFa = isNearingFreeAgency(torrens);
    if (torrensIsFa) {
      throw new Error('FAIL: Luis Torrens (under contract through 2028) was classified as nearing free agency');
    }

    // 2. isNearingFreeAgency must be false for Luzardo (under contract through 2032)
    const luzardoIsFa = isNearingFreeAgency(luzardo);
    if (luzardoIsFa) {
      throw new Error('FAIL: Jesús Luzardo (under contract through 2032) was classified as nearing free agency');
    }

    // 3. Free Agents view rows must not include Torrens or Luzardo
    renderFreeAgents();
    const inFaRows = faRowsCurrent.some(r => r.p.id === 620443 || r.p.id === 666200);
    if (inFaRows) {
      throw new Error('FAIL: Free Agents view includes Luis Torrens or Jesús Luzardo');
    }

    // 4. Contract label and arb eligibility
    if (isArbEligible(torrens)) {
      throw new Error('FAIL: Luis Torrens should not be isArbEligible when signed to an extension');
    }
    const lbl = contractLabel(torrens);
    if (lbl.label === 'Arb') {
      throw new Error('FAIL: Luis Torrens contract label should not be Arb');
    }

    console.log('OK: Contract classification tests passed');
    """

    res = subprocess.run(["node", "-e", script], cwd=Path(__file__).parent, capture_output=True, text=True)
    assert res.returncode == 0, f"Test failed with output:\n{res.stderr}\n{res.stdout}"
    assert "OK: Contract classification tests passed" in res.stdout
