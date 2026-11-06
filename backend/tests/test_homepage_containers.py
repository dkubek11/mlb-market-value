import json
from pathlib import Path
import subprocess


def test_homepage_all_player_containers_and_rotation_styling():
    """Verify that all homepage containers render full player table rows matching
    the 9 columns from the players page, and Best/Worst Rotations uses team-page styling."""
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
    global.window = { addEventListener: () => {} };
    global.location = { hash: '', search: '' };

    const parts = ['core.js', 'player-card.js', 'home.js', 'tables.js', 'teams.js', 'team-view.js', 'scoring.js', 'weights.js', 'custom.js', 'nav.js'];
    let code = '';
    for (const p of parts) {
      let c = fs.readFileSync(path.join(root, 'frontend/dashboard/parts/js', p), 'utf8');
      if (p === 'core.js') c = c.replace('__DATA_JSON__', JSON.stringify(snapshot));
      code += c + '\\n';
    }
    vm.runInThisContext(code);

    const requiredCols = [
      'Player', 'Pos', 'Value Tier', 'Contract', 'Salary', 'Perf %',
      'Projected Market', 'Net Surplus / Deficit', 'Key Stat Driver'
    ];

    // 1. Carousels
    for (const cid of ['nl-bat', 'nl-pit', 'al-bat', 'al-pit']) {
      const slides = getEl('slides-' + cid).innerHTML;
      if (!slides.includes('roster-table')) throw new Error('Carousel ' + cid + ' missing roster-table');
      if (slides.includes('carousel-half-head')) throw new Error('Carousel ' + cid + ' should not have redundant carousel-half-head subtitles');
      for (const col of requiredCols) {
        if (!slides.includes(col)) throw new Error('Carousel ' + cid + ' missing column: ' + col);
      }
      if (!slides.includes('>Score<')) throw new Error('Carousel ' + cid + ' missing Score column');
    }

    // 2. Explore: Hot vs Cold
    const hotCold = getEl('explore-hot-cold').innerHTML;
    if (!hotCold.includes('roster-table')) throw new Error('Hot vs Cold missing roster-table');
    for (const col of requiredCols) {
      if (!hotCold.includes(col)) throw new Error('Hot vs Cold missing column: ' + col);
    }
    if (!hotCold.includes('Streak Delta')) throw new Error('Hot vs Cold missing Streak Delta');

    // 3. Explore: Bullpen overview
    const bullpen = getEl('explore-bullpen').innerHTML;
    if (!bullpen.includes('roster-table')) throw new Error('Bullpen missing roster-table');
    for (const col of requiredCols) {
      if (!bullpen.includes(col)) throw new Error('Bullpen missing column: ' + col);
    }
    if (!bullpen.includes('ERA') || !bullpen.includes('K-BB%')) {
      throw new Error('Bullpen missing ERA or K-BB% columns');
    }

    // 4. Explore: Best / Worst Rotations
    const rotations = getEl('explore-rotations').innerHTML;
    if (!rotations.includes('rotation-team-card')) throw new Error('Rotations missing rotation-team-card');
    if (!rotations.includes('team-hero-logo')) throw new Error('Rotations missing team-hero-logo');
    if (!rotations.includes('macro-metric-grid')) throw new Error('Rotations missing macro-metric-grid');
    if (!rotations.includes('macro-metric-card')) throw new Error('Rotations missing macro-metric-card');
    if (!rotations.includes('Rotation Score') || !rotations.includes('Rotation Payroll') || !rotations.includes('Avg FIP') || !rotations.includes('Total IP')) {
      throw new Error('Rotations missing team-page macro metric cards');
    }
    if (!rotations.includes('border-left: 4px solid')) {
      throw new Error('Rotations missing team brand color border accent (4px)');
    }
    if (!rotations.includes('rotation-rank-tag')) {
      throw new Error('Rotations missing rotation-rank-tag');
    }
    if (!rotations.includes('in MLB]')) {
      throw new Error('Rotations missing MLB ranking text format');
    }
    if (!rotations.includes('width="51" height="51"')) {
      throw new Error('Rotations logo should be downsized to 51px');
    }

    // 5. Expand a rotation team and verify pitcher roster table
    expandedRotationTeams.add('CLE');
    renderRotations();
    const expandedRotations = getEl('explore-rotations').innerHTML;
    if (!expandedRotations.includes('rotation-players-wrapper')) throw new Error('Expanded rotation missing wrapper');
    if (!expandedRotations.includes('roster-table')) throw new Error('Expanded rotation missing roster-table');
    for (const col of requiredCols) {
      if (!expandedRotations.includes(col)) throw new Error('Expanded rotation missing column: ' + col);
    }
    if (!expandedRotations.includes('>IP<') || !expandedRotations.includes('>Score<')) {
      throw new Error('Expanded rotation missing IP or Score columns');
    }

    // 6. Verify click indexing
    if (homeRowsCurrent.length < 50) throw new Error('Too few homeRowsCurrent indexed: ' + homeRowsCurrent.length);
    for (let i = 0; i < 20; i++) {
      const p = homeRowsCurrent[i];
      if (!p || !p.name || !p.position) throw new Error('Invalid player indexed at ' + i);
    }

    console.log('OK');
    """

    res = subprocess.run(["node", "-e", script], cwd=Path(__file__).parent, capture_output=True, text=True)
    assert res.returncode == 0, f"Node script failed: {res.stderr}\n{res.stdout}"
    assert "OK" in res.stdout


def test_homepage_styling_and_font_sizes():
    """Verify that homepage font sizes and element dimensions match user specifications:
    - 15% increase on homepage titles (.league-group-title, .carousel-title, .explore-heading, .preview-head h3, .preview-sub, .explore-subhead)
    - 15% decrease on hero section title/subtext (#home-view .team-hero-heading: 2.54rem, #home-view .team-hero-subtext: 0.81rem)
    - 20% downsize on Best/Worst Rotations containers (logo 51px, card radius 11px, header padding 0.92rem 1.08rem, title 1.16rem, metric cards padding 0.71rem 0.84rem, labels 0.57rem, values 0.97rem)
    - Rank tag styling present (.rotation-rank-tag)."""
    css_path = Path(__file__).resolve().parent.parent.parent / "frontend" / "dashboard" / "parts" / "styles.css"
    css = css_path.read_text(encoding="utf-8")

    # Hero section -15%
    assert "#home-view .team-hero-heading" in css
    assert "2.54rem" in css  # 2.99 * 0.85
    assert "#home-view .team-hero-subtext" in css
    assert "0.81rem" in css  # 0.95 * 0.85

    # Homepage titles +15%
    assert "0.92rem" in css  # .league-group-title (0.8 * 1.15)
    assert "1.21rem" in css  # .carousel-title (1.05 * 1.15)
    assert "1.73rem" in css  # .explore-heading (1.5 * 1.15)
    assert "1.15rem" in css  # .preview-head h3 (1.0 * 1.15)
    assert "0.83rem" in css  # .preview-sub (0.72 * 1.15)
    assert "0.78rem" in css  # .explore-subhead (0.68 * 1.15)

    # Best/Worst Rotations team container -20%
    assert "border-radius: 11px" in css  # 14 * 0.8
    assert "padding: 0.92rem 1.08rem" in css  # 1.15*0.8, 1.35*0.8
    assert "font-size: 1.04rem" in css  # .rotation-team-title (1.16 * 0.9)
    assert "font-size: 1.12rem" in css  # .rotation-toggle-chevron (1.4 * 0.8)
    assert "padding: 0.71rem 0.84rem" in css  # .macro-metric-card inside .rotation-metric-grid
    assert "font-size: 0.57rem" in css  # .macro-metric-label (0.71 * 0.8)
    assert "font-size: 0.97rem" in css  # .macro-metric-value (1.21 * 0.8)
    assert ".rotation-rank-tag" in css


