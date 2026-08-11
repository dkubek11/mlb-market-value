#!/usr/bin/env node
// Capture the legacy scoring engine's output as golden fixtures.
//
// The authoritative scoring engine lives in the ORIGINAL (pre-migration)
// template at frontend/dashboard/dashboard_template.html.bak. This script
// extracts the DOM-free engine section verbatim, runs it in a Node vm
// against the live /api/dashboard payload (plus a synthetic edge-case
// payload), and writes golden fixtures under src/__tests__/fixtures/:
//
//   dashboard-payload.json        raw live payload (input for the TS port)
//   legacy-scoring.json           default-weights engine output
//   legacy-scoring-weights.json   alternate slider-weights engine output
//   edge-payload.json             synthetic edge-case payload
//   legacy-scoring-edge.json      edge-case engine output
//
// scoring.parity.test.ts then runs the TS port (src/lib/scoring.ts) against
// the same inputs and asserts deep equality — so the fixture always comes
// from the literal legacy JavaScript, never from the port itself.
//
// Usage:
//   npm run capture:legacy                       # everything (backend on :8000)
//   npm run capture:legacy -- --edge-only        # skip the live payload
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BAK = path.resolve(ROOT, '../dashboard/dashboard_template.html.bak');
const FIXTURES = path.resolve(ROOT, 'src/__tests__/fixtures');
const EDGE_ONLY = process.argv.includes('--edge-only');

const apiBase = process.env.VITE_API_BASE || 'http://localhost:8000';
const season = process.env.VITE_SNAPSHOT_SEASON || String(new Date().getFullYear());
const url = `${apiBase}/api/dashboard?season=${season}&fetch_live_contracts=true`;

// ---- extract the engine from the legacy template ----
const html = readFileSync(BAK, 'utf8');
const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('no <script> block found in legacy template');

const startMark = '// --- Weighted composite scoring engine';
const endMark = 'function buildWeightPanel(containerId';
const s = script.indexOf(startMark);
const e = script.indexOf(endMark, s);
if (s < 0 || e < 0) throw new Error('scoring engine markers not found in legacy template');
const gradeFor = script.match(/function gradeFor\(pct\) \{[\s\S]*?\n  \}/)?.[0];
if (!gradeFor) throw new Error('gradeFor not found in legacy template');

// The engine section (configs, weights, constants, helpers, recomputeAll) is
// DOM-free; gradeFor is the only dependency defined outside the section.
const ENGINE_SOURCE = [
  'var allPlayers = [];',
  'var positionStats = {};',
  'var teams = [];',
  gradeFor,
  script.slice(s, e),
  `
function captureResults() {
  return {
    players: allPlayers.map(p => ({
      id: p.id,
      rawScore: p.rawScore,
      compPct: p.compPct,
      grade: p.grade,
      salPct: p.salPct == null ? null : p.salPct,
      score: p.score,
      projectedPct: p.projectedPct == null ? null : p.projectedPct,
      recommendedSalary: p.recommendedSalary == null ? null : p.recommendedSalary,
      paySurplus: p.paySurplus == null ? null : p.paySurplus,
      projectedSalary: p.projectedSalary == null ? null : p.projectedSalary,
      surplus: p.surplus == null ? null : p.surplus,
      breakdown: p.breakdown.map(b => ({
        key: b.key,
        // JSON.stringify turns -0 into 0; normalize here so the fixture and
        // the port's toEqual comparison see the same value (the legacy engine
        // itself produces -0 when a stat sits exactly on the position mean).
        value: b.value == null ? null : b.value === 0 ? 0 : b.value,
        z: b.z == null ? null : b.z === 0 ? 0 : b.z,
        contribution: b.contribution === 0 ? 0 : b.contribution
      }))
    })),
    teams: teams.map(t => ({ abbr: t.abbr, avgScore: t.avgScore }))
  };
}
function runJob(job) {
  if (job.weights && job.weights.bat) Object.assign(battingWeights, job.weights.bat);
  if (job.weights && job.weights.pit) Object.assign(pitchingWeights, job.weights.pit);
  if (job.payWeight != null) payWeight = job.payWeight;
  recomputeAll();
  return captureResults();
}
`,
].join('\n');

function runLegacy(payload, job) {
  const ctx = vm.createContext({});
  ctx.__payload = structuredClone(payload);
  ctx.__result = null;
  const run = `${ENGINE_SOURCE}
allPlayers = __payload.allPlayers;
positionStats = __payload.positionStats;
teams = __payload.teams;
__result = runJob(${JSON.stringify(job)});
`;
  vm.runInContext(run, ctx);
  return ctx.__result;
}

mkdirSync(FIXTURES, { recursive: true });

function write(name, data) {
  const out = path.join(FIXTURES, name);
  writeFileSync(out, JSON.stringify(data, null, 2));
  console.log('wrote', path.relative(ROOT, out));
}

if (!EDGE_ONLY) {
  console.log(`fetching live payload: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`live payload fetch failed: HTTP ${res.status} ${res.statusText}`);
  const payload = await res.json();
  write('dashboard-payload.json', payload);

  const defaultOut = runLegacy(payload, {});
  write('legacy-scoring.json', defaultOut);
  console.log(`  default weights: ${defaultOut.players.length} players, ${defaultOut.teams.length} teams`);

  const sliderOut = runLegacy(payload, {
    weights: { bat: { xwoba: 4.0, barrel_rate: 0.5 }, pit: { xera: 3.0 } },
    payWeight: 1.5,
  });
  write('legacy-scoring-weights.json', sliderOut);
  console.log(`  slider weights:  ${sliderOut.players.length} players`);
}

// Synthetic edge-case payload: exercises the branches the live data may not
// hit — a position whose marketGroup is empty (RP), a single-market-player
// position (C), null stats, players without projections, pre-arb aliasing.
const edgePayload = {
  allPlayers: [
    {
      id: 1, name: 'Aaron C', team: 'T1', position: 'C', isBatter: true, isPreArb: false,
      salary: 1000000, aav: 1000000, contractType: 'pre-arb', age: 25, nComps: 0,
      stats: {
        xwoba: 0.35, xba: 0.25, xslg: 0.45, barrel_rate: 8.0, hard_hit_rate: 40.0,
        chase_rate: 0.2, whiff_rate: 0.25, k_rate: 0.2, bb_rate: 0.1, oaa: 2, frv: 1, drs: 0,
      },
      projected: {},
    },
    {
      id: 2, name: 'Bobby C', team: 'T1', position: 'C', isBatter: true, isPreArb: true,
      salary: 700000, aav: 700000, contractType: null, age: 22, nComps: 0,
      stats: {
        xwoba: null, xba: null, xslg: null, barrel_rate: null, hard_hit_rate: null,
        chase_rate: null, whiff_rate: null, k_rate: null, bb_rate: null, oaa: null, frv: null, drs: null,
      },
      projected: {},
    },
    {
      id: 3, name: 'Cy Young Jr', team: 'T2', position: 'SP', isBatter: false, isPreArb: false,
      salary: 20000000, aav: 20000000, contractType: 'extension', age: 30, nComps: 1,
      stats: {
        xera: 3.2, xba_against: 0.21, avg_exit_velo_against: 88.0, hard_hit_rate_against: 32.0,
        barrel_rate_against: 6.0, k_rate: 0.28, bb_rate: 0.06, chase_rate: 0.3, whiff_rate: 0.3,
        z_swing_rate: 0.65, extension: 6.2, stuff_plus: 115, location_plus: 105,
      },
      projected: { xera: 3.5 },
    },
    {
      id: 4, name: 'Dan Smith', team: 'T2', position: 'SP', isBatter: false, isPreArb: false,
      salary: 5000000, aav: 5000000, contractType: 'arb', age: 28, nComps: 1,
      stats: {
        xera: 4.8, xba_against: 0.26, avg_exit_velo_against: 91.0, hard_hit_rate_against: 44.0,
        barrel_rate_against: 10.0, k_rate: 0.18, bb_rate: 0.09, chase_rate: 0.25, whiff_rate: 0.22,
        z_swing_rate: 0.6, extension: 5.8, stuff_plus: 95, location_plus: 98,
      },
      projected: { xera: 4.5 },
    },
    {
      id: 5, name: 'Eli Prospect', team: 'T2', position: 'SP', isBatter: false, isPreArb: true,
      salary: 700000, aav: 700000, contractType: null, age: 23, nComps: 0,
      stats: {
        xera: 4.0, xba_against: 0.24, avg_exit_velo_against: 89.5, hard_hit_rate_against: 38.0,
        barrel_rate_against: 8.0, k_rate: 0.24, bb_rate: 0.07, chase_rate: 0.28, whiff_rate: 0.27,
        z_swing_rate: 0.62, extension: 6.0, stuff_plus: 108, location_plus: 102,
      },
      projected: { xera: 4.0 },
    },
    {
      id: 6, name: 'Fred Reliever', team: 'T3', position: 'RP', isBatter: false, isPreArb: true,
      salary: 700000, aav: 700000, contractType: null, age: 24, nComps: 0,
      stats: { xera: 3.6, k_rate: 0.3, bb_rate: 0.08 },
      projected: {},
    },
    {
      id: 7, name: 'Gus Reliever', team: 'T3', position: 'RP', isBatter: false, isPreArb: true,
      salary: 700000, aav: 700000, contractType: null, age: 26, nComps: 0,
      stats: { xera: 5.2, k_rate: 0.2, bb_rate: 0.12 },
      projected: { xera: 5.0 },
    },
  ],
  positionStats: {
    C: {
      xwoba: { mean: 0.3, std: 0.05 }, xba: { mean: 0.24, std: 0.03 }, xslg: { mean: 0.4, std: 0.06 },
      barrel_rate: { mean: 7.0, std: 3.0 }, hard_hit_rate: { mean: 38.0, std: 8.0 },
      chase_rate: { mean: 0.22, std: 0.05 }, whiff_rate: { mean: 0.24, std: 0.05 },
      k_rate: { mean: 0.21, std: 0.05 }, bb_rate: { mean: 0.09, std: 0.03 },
      oaa: { mean: 0, std: 3 }, frv: { mean: 0, std: 3 }, drs: { mean: 0, std: 4 },
    },
    SP: {
      xera: { mean: 4.2, std: 0.6 }, xba_against: { mean: 0.24, std: 0.03 },
      avg_exit_velo_against: { mean: 89.5, std: 1.8 }, hard_hit_rate_against: { mean: 39.0, std: 6.0 },
      barrel_rate_against: { mean: 8.0, std: 2.5 }, k_rate: { mean: 0.22, std: 0.05 },
      bb_rate: { mean: 0.08, std: 0.02 }, chase_rate: { mean: 0.27, std: 0.04 },
      whiff_rate: { mean: 0.26, std: 0.05 }, z_swing_rate: { mean: 0.63, std: 0.06 },
      extension: { mean: 6.0, std: 0.3 }, stuff_plus: { mean: 100, std: 10 },
      location_plus: { mean: 100, std: 8 },
    },
    RP: { xera: { mean: 4.0, std: 0.7 }, k_rate: { mean: 0.25, std: 0.06 }, bb_rate: { mean: 0.09, std: 0.03 } },
  },
  teams: [
    { abbr: 'T1', name: 'Team One', league: 'AL', division: 'East', payroll: 1700000 },
    { abbr: 'T2', name: 'Team Two', league: 'AL', division: 'Central', payroll: 25700000 },
    { abbr: 'T3', name: 'Team Three', league: 'NL', division: 'West', payroll: 1400000 },
  ],
  rosters: {},
  teamColors: {},
  contracts: {},
  capturedAt: 'edge-case fixture (synthetic)',
};

const edgeOut = runLegacy(edgePayload, {});
write('edge-payload.json', edgePayload);
write('legacy-scoring-edge.json', edgeOut);
console.log(`  edge payload:     ${edgeOut.players.length} players`);
