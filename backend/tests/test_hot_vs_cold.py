"""Tests for trailing stats pipeline and Hot vs Cold section."""

import datetime
import json
import subprocess
from pathlib import Path
import pytest

from app.pipeline.trailing_stats import (
    configure_cache_dir,
    fetch_last30,
    get_trailing_window_end_date,
)


@pytest.fixture(autouse=True)
def setup_cache():
    cache_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard" / ".snapshot_cache"
    configure_cache_dir(cache_dir)


def test_get_trailing_window_end_date_2026():
    """Verify that 2026 resolves to the conclusion of the 2026 regular season."""
    end = get_trailing_window_end_date(2026)
    assert end == datetime.date(2026, 9, 27)


def test_get_trailing_window_end_date_future_2030():
    """Verify that future season 2030 returns None safely."""
    end = get_trailing_window_end_date(2030)
    assert end is None


def test_get_trailing_window_end_date_none_defaults_to_today():
    """Verify that passing None defaults to today."""
    end = get_trailing_window_end_date(None)
    assert end == datetime.date.today()


def test_fetch_last30_future_season_returns_empty():
    """Verify that future season 2030 returns empty dicts without crashing."""
    batting, pitching = fetch_last30(season=2030)
    assert batting == {}
    assert pitching == {}


def test_fetch_last30_2026_season_populated():
    """Verify that season 2026 trailing stats are non-empty and clear the playing-time floor."""
    batting, pitching = fetch_last30(season=2026)
    assert len(batting) >= 200, f"Expected >=200 qualifying batters, got {len(batting)}"
    assert len(pitching) >= 200, f"Expected >=200 qualifying pitchers, got {len(pitching)}"


def test_snapshot_has_last30_populated():
    """Verify that the dashboard snapshot has last30 populated for hundreds of players."""
    cache_path = Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard" / ".snapshot_cache" / "dashboard_2026.json"
    assert cache_path.exists(), "dashboard_2026.json must exist"
    with cache_path.open(encoding="utf-8") as f:
        data = json.load(f)

    all_players = data.get("allPlayers", [])
    assert len(all_players) > 0

    with_last30 = [p for p in all_players if p.get("last30") is not None]
    assert len(with_last30) >= 400, f"Expected >=400 players with last30, got {len(with_last30)}"

    batters_with_l30 = [p for p in with_last30 if p.get("isBatter")]
    pitchers_with_l30 = [p for p in with_last30 if not p.get("isBatter")]

    assert len(batters_with_l30) >= 200
    assert len(pitchers_with_l30) >= 200

    # Batters last30 is batting average (0.000 to 0.500)
    for b in batters_with_l30[:10]:
        assert 0.05 <= b["last30"] <= 0.500, f"Invalid batter last30 AVG: {b['last30']}"

    # Pitchers last30 is ERA (0.00 to 20.00+)
    for p in pitchers_with_l30[:10]:
        assert 0.0 <= p["last30"] <= 25.0, f"Invalid pitcher last30 ERA: {p['last30']}"


def test_frontend_hot_vs_cold_dom_render():
    """Run Node.js DOM rendering of renderHotCold and verify 10 Hot and 10 Cold players."""
    script = """
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');

    const root = path.resolve(__dirname, '../../');
    const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'frontend/dashboard/.snapshot_cache/dashboard_2026.json'), 'utf8'));
    const coreJs = fs.readFileSync(path.join(root, 'frontend/dashboard/parts/js/core.js'), 'utf8').replace('__DATA_JSON__', JSON.stringify(snapshot));
    const homeJs = fs.readFileSync(path.join(root, 'frontend/dashboard/parts/js/home.js'), 'utf8');

    let hotColdHtml = '';
    const mockEl = { innerHTML: '', classList: { toggle: () => {}, add: () => {}, remove: () => {} }, textContent: '', addEventListener: () => {} };
    const elements = {
      'explore-hot-cold': {
        set innerHTML(val) { hotColdHtml = val; },
        get innerHTML() { return hotColdHtml; }
      }
    };

    const sandbox = {
      console, Math, Object, Array,
      document: { getElementById: (id) => elements[id] || mockEl, querySelectorAll: () => [] }
    };

    vm.createContext(sandbox);
    vm.runInContext(coreJs, sandbox);
    vm.runInContext(homeJs, sandbox);
    sandbox.renderHotCold();

    const cleanHtml = hotColdHtml.replace(/data:image\\/[^;]+;base64,[^\\"]+/g, '[IMG]');
    const rowRegex = /<tr class="player-roster-row"[^>]*>([\\s\\S]*?)<\\/tr>/g;
    let m;
    const rows = [];
    while ((m = rowRegex.exec(cleanHtml)) !== null) {
      const rowHtml = m[1];
      const nameM = /<span class="player-name-text">([^<]+)<\\/span>/.exec(rowHtml);
      const posM = /<span class="pos-badge">([^<]+)<\\/span>/.exec(rowHtml);
      const deltaM = /<td class="mono font-bold (surplus-[^"]+)">([^<]+)<span class="regression-tag ([^"]+)">([▲▼])<\\/span><\\/td>/.exec(rowHtml);
      if (nameM && posM && deltaM) {
        rows.push({ name: nameM[1], pos: posM[1], cls: deltaM[1], delta: deltaM[2].trim(), arrow: deltaM[4] });
      }
    }

    if (rows.length !== 20) {
      console.error('Expected exactly 20 players rendered, got ' + rows.length);
      process.exit(1);
    }

    const hot = rows.slice(0, 10);
    const cold = rows.slice(10, 20);

    const hotBatters = hot.filter(r => !['SP', 'RP'].includes(r.pos));
    const hotPitchers = hot.filter(r => ['SP', 'RP'].includes(r.pos));
    const coldBatters = cold.filter(r => !['SP', 'RP'].includes(r.pos));
    const coldPitchers = cold.filter(r => ['SP', 'RP'].includes(r.pos));

    if (hotBatters.length !== 5 || hotPitchers.length !== 5) {
      console.error('Expected 5 batters and 5 pitchers in Hot, got ' + hotBatters.length + ' and ' + hotPitchers.length);
      process.exit(1);
    }
    if (coldBatters.length !== 5 || coldPitchers.length !== 5) {
      console.error('Expected 5 batters and 5 pitchers in Cold, got ' + coldBatters.length + ' and ' + coldPitchers.length);
      process.exit(1);
    }

    console.log('OK');
    """

    res = subprocess.run(["node", "-e", script], cwd=Path(__file__).parent, capture_output=True, text=True)
    assert res.returncode == 0, f"Node script failed: {res.stderr}\n{res.stdout}"
    assert "OK" in res.stdout

