/**
 * Verification script for player card DOM rendering integrity.
 * 
 * Verifies that openPlayerCard() renders complete, accurate HTML with zero NaN,
 * undefined, null, or corrupted tokens for the top 50 highest AAV players.
 * Also tests time-invariance by validating 2030 season card generation.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const snapshotPath = path.resolve(__dirname, '../../frontend/dashboard/.snapshot_cache/dashboard_2026.json');
const coreJsPath = path.resolve(__dirname, '../../frontend/dashboard/parts/js/core.js');
const playerCardJsPath = path.resolve(__dirname, '../../frontend/dashboard/parts/js/player-card.js');

const rawSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

// Filter and sort top 50 players by AAV descending
const allPlayers = rawSnapshot.allPlayers || [];
const top50Players = [...allPlayers]
  .sort((a, b) => {
    const aavDiff = (b.aav || 0) - (a.aav || 0);
    if (aavDiff !== 0) return aavDiff;
    return (b.salary || 0) - (a.salary || 0);
  })
  .slice(0, 50);

console.log(`Loaded ${allPlayers.length} total players. Top 50 AAV range: $${(top50Players[0].aav/1e6).toFixed(1)}M to $${(top50Players[49].aav/1e6).toFixed(1)}M`);

function createRenderEnvironment(snapshotData, customSeason = null) {
  let renderedCardHtml = '';
  const mockElement = {
    value: '',
    innerHTML: '',
    style: { removeProperty: () => {}, setProperty: () => {} },
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
    setAttribute: () => {},
    addEventListener: () => {},
    scrollTo: () => {},
    querySelector: () => mockElement,
    querySelectorAll: () => []
  };

  const sandbox = {
    console,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    JSON,
    location: { hash: '', search: '' },
    URLSearchParams,
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    scrollTo: () => {},
    removeEventListener: () => {},
    document: {
      getElementById: (id) => {
        if (id === 'card-root') {
          return {
            get innerHTML() { return renderedCardHtml; },
            set innerHTML(val) { renderedCardHtml = val; },
            addEventListener: () => {}
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
    getRenderedHtml: () => renderedCardHtml,
  };
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);

  const partsDir = path.resolve(__dirname, '../../frontend/dashboard/parts/js');
  const jsParts = [
    'core.js',
    'player-card.js',
    'home.js',
    'tables.js',
    'teams.js',
    'team-view.js',
    'free-agents.js',
    'scoring.js',
    'weights.js',
    'custom.js',
    'nav.js'
  ];

  let combinedCode = '';
  for (const file of jsParts) {
    let code = fs.readFileSync(path.join(partsDir, file), 'utf8');
    if (file === 'core.js') {
      let dataJsonStr = JSON.stringify(snapshotData);
      code = code.replace('const DATA = __DATA_JSON__;', `const DATA = ${dataJsonStr};`);
      if (customSeason) {
        code = code.replace(
          'const CURRENT_SEASON = DATA.season || 2026;',
          `const CURRENT_SEASON = ${customSeason};`
        );
      }
    }
    combinedCode += code + '\n';
  }

  // Execute entire dashboard script in VM exactly as main.py assembles it
  vm.runInContext(combinedCode, context);

  return context;
}

// 1. Test top 50 in present season (2026)
console.log('\n--- Testing Top 50 Players in Present Season (2026) ---');
const ctx2026 = createRenderEnvironment(rawSnapshot, 2026);

let passedCount = 0;
for (let i = 0; i < top50Players.length; i++) {
  const p = top50Players[i];
  ctx2026.openPlayerCard(p);
  const html = ctx2026.getRenderedHtml();

  // Integrity assertions
  if (!html || html.length < 500) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Rendered HTML is suspiciously short (${html.length} chars)`);
  }

  // Corrupted tokens check
  const badPatterns = [
    { regex: />\s*NaN/g, label: 'NaN text' },
    { regex: />\s*undefined/g, label: 'undefined text' },
    { regex: />\s*null/g, label: 'null text' },
    { regex: /\[object Object\]/g, label: '[object Object]' }
  ];
  for (const { regex, label } of badPatterns) {
    if (regex.test(html)) {
      throw new Error(`[Rank #${i+1}] ${p.name}: Rendered HTML contains corrupted token "${label}"`);
    }
  }

  // Hero section checks
  if (!html.includes(p.name)) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Hero banner missing player name`);
  }
  if (!html.includes('in 2026')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Hero banner missing season tag "in 2026"`);
  }
  if (!html.includes('card-tier-pill')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing card-tier-pill`);
  }

  // Score section checks
  if (!html.includes('SCORE') || !html.includes('Fair Market Value') || !html.includes('Net Surplus')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing SCORE section components`);
  }

  // Contract Status section checks
  if (!html.includes('CONTRACT STATUS') || !html.includes('Next 5 years · 2026–2030')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing CONTRACT STATUS header or incorrect years 2026-2030`);
  }
  for (const yr of [2026, 2027, 2028, 2029, 2030]) {
    if (!html.includes(`>${yr}<`)) {
      throw new Error(`[Rank #${i+1}] ${p.name}: Missing contract status year row for ${yr}`);
    }
  }

  // Five-year fWAR outlook checks
  if (p.warOutlook) {
    if (!html.includes('5-YEAR WAR &amp; CONTRACT ESTIMATE')) {
      throw new Error(`[Rank #${i+1}] ${p.name}: Missing 5-year fWAR outlook section`);
    }
    if (!html.includes('Projected fWAR')) {
      throw new Error(`[Rank #${i+1}] ${p.name}: Missing projected fWAR label`);
    }
    if (!html.includes('war-bar-fill')) {
      throw new Error(`[Rank #${i+1}] ${p.name}: Missing fWAR projection bars`);
    }
  }

  // Gauges checks
  const expectedGauge = p.isBatter ? 'BATTING' : 'PITCHING';
  if (!html.includes(expectedGauge)) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing ${expectedGauge} gauge header`);
  }
  if (!html.includes('gauge-slider-row')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing gauge sliders`);
  }
  if (!html.includes('gauge-fill') || !html.includes('background: rgb(')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing dynamic background color on gauge-fill`);
  }
  if (!html.includes('gauge-bubble') || !html.includes('style="background: rgb(')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing dynamic background color on gauge-bubble`);
  }

  // Salary peers checks
  if (!html.includes('POSITION RANK AMONG SALARY PEERS')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Missing salary peers section`);
  }
  if (!html.includes('active-peer-row')) {
    throw new Error(`[Rank #${i+1}] ${p.name}: Active player not highlighted in peer cohort`);
  }

  passedCount++;
}
console.log(`✓ All 50 players passed 2026 render integrity checks (${passedCount}/50)`);

// 2. Test 2030 season time-invariance
console.log('\n--- Testing 2030 Season Time-Invariance ---');
const ctx2030 = createRenderEnvironment(rawSnapshot, 2030);

let passed2030Count = 0;
for (let i = 0; i < top50Players.length; i++) {
  const p = top50Players[i];
  ctx2030.openPlayerCard(p);
  const html = ctx2030.getRenderedHtml();

  // Must show 2030 in hero banner
  if (!html.includes('in 2030')) {
    throw new Error(`[2030 Rank #${i+1}] ${p.name}: Hero banner did not adapt to 2030`);
  }

  // Contract timeline must shift to 2030-2034
  if (!html.includes('Next 5 years · 2030–2034')) {
    throw new Error(`[2030 Rank #${i+1}] ${p.name}: Contract timeline subtitle failed to shift to 2030-2034`);
  }
  for (const yr of [2030, 2031, 2032, 2033, 2034]) {
    if (!html.includes(`>${yr}<`)) {
      throw new Error(`[2030 Rank #${i+1}] ${p.name}: Missing 2030 contract status year row for ${yr}`);
    }
  }

  // Active row in contract status must be 2030
  if (!html.includes('current-active-row')) {
    throw new Error(`[2030 Rank #${i+1}] ${p.name}: Missing current active row highlight`);
  }

  passed2030Count++;
}
console.log(`✓ All 50 players passed 2030 time-invariance render checks (${passed2030Count}/50)`);
console.log('\nAll render integrity verifications completed successfully!');
