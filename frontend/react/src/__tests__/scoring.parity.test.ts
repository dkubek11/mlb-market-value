/**
 * Parity tests: the TypeScript port (src/lib/scoring.ts) must produce
 * bit-for-bit identical numbers to the legacy JavaScript engine.
 *
 * Golden fixtures are captured by scripts/capture-legacy-scoring.mjs, which
 * runs the LITERAL legacy engine source (extracted from
 * frontend/dashboard/dashboard_template.html.bak) in a Node vm. The fixtures
 * therefore come from the legacy code itself, never from this port.
 *
 * Regenerate after any engine change:
 *   npm run capture:legacy   # needs the backend on :8000
 *   npm test
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BATTER_STAT_CONFIG,
  PITCHER_STAT_CONFIG,
  DEFAULT_PAY_WEIGHT,
  recomputeAll,
  type EnrichedPlayer,
  type EnrichedTeam,
} from '../lib/scoring';
import type { DashboardPayload } from '../api/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => path.join(__dirname, 'fixtures', ...parts);
const load = <T,>(name: string): T => JSON.parse(readFileSync(fixture(name), 'utf8')) as T;

interface BreakdownOut { key: string; value: number | null; z: number | null; contribution: number; }
interface PlayerOut {
  id: number;
  rawScore: number;
  compPct: number;
  grade: string;
  salPct: number | null;
  score: number;
  projectedPct: number | null;
  recommendedSalary: number | null;
  paySurplus: number | null;
  projectedSalary: number | null;
  surplus: number | null;
  breakdown: BreakdownOut[];
}
interface TeamOut { abbr: string; avgScore: number; }
interface EngineOutput { players: PlayerOut[]; teams: TeamOut[]; }

interface WeightsArg { batting: Record<string, number>; pitching: Record<string, number>; pay: number; }

const DEFAULT_WEIGHTS: WeightsArg = {
  batting: Object.fromEntries(BATTER_STAT_CONFIG.map(s => [s.key, s.defaultWeight])),
  pitching: Object.fromEntries(PITCHER_STAT_CONFIG.map(s => [s.key, s.defaultWeight])),
  pay: DEFAULT_PAY_WEIGHT,
};

/**
 * Run the TS port on shallow clones of the payload (the engine mutates in
 * place, exactly like legacy recomputeAll) and normalize to the same shape
 * the capture script writes:
 *   - undefined -> null
 *   - -0 -> 0  (JSON.stringify normalizes -0, so the golden fixtures store
 *     "0"; toEqual uses Object.is semantics and would otherwise fail on the
 *     sign-of-zero the legacy engine itself produces too)
 */
function runPort(payload: DashboardPayload, weights: WeightsArg): EngineOutput {
  const players = payload.allPlayers.map(p => ({ ...p }) as EnrichedPlayer);
  const teams = payload.teams.map(t => ({ ...t }) as EnrichedTeam);
  recomputeAll(players, payload.positionStats, teams, weights);
  // -0 -> 0 mirrors JSON.stringify's normalization of the golden fixtures;
  // contribution is a plain number, so normalize it inline (not via num,
  // which widens the type to include null).
  const num = (v: number | null | undefined) => (v == null ? null : v === 0 ? 0 : v);
  return {
    players: players.map(p => ({
      id: p.id,
      rawScore: p.rawScore,
      compPct: p.compPct,
      grade: p.grade,
      salPct: num(p.salPct),
      score: p.score,
      projectedPct: num(p.projectedPct),
      recommendedSalary: num(p.recommendedSalary),
      paySurplus: num(p.paySurplus),
      projectedSalary: num(p.projectedSalary),
      surplus: num(p.surplus),
      breakdown: p.breakdown.map(b => ({
        key: b.key,
        value: num(b.value),
        z: num(b.z),
        contribution: b.contribution === 0 ? 0 : b.contribution,
      })),
    })),
    teams: teams.map(t => ({ abbr: t.abbr, avgScore: t.avgScore })),
  };
}

describe('scoring parity vs the legacy engine', () => {
  const payload = load<DashboardPayload>('dashboard-payload.json');
  const edgePayload = load<DashboardPayload>('edge-payload.json');

  it('matches legacy recomputeAll for every player at default weights', () => {
    const expected = load<EngineOutput>('legacy-scoring.json');
    expect(runPort(payload, DEFAULT_WEIGHTS)).toEqual(expected);
  });

  it('matches legacy recomputeAll under non-default slider weights', () => {
    const weights: WeightsArg = {
      batting: { ...DEFAULT_WEIGHTS.batting, xwoba: 4.0, barrel_rate: 0.5 },
      pitching: { ...DEFAULT_WEIGHTS.pitching, xera: 3.0 },
      pay: 1.5,
    };
    const expected = load<EngineOutput>('legacy-scoring-weights.json');
    expect(runPort(payload, weights)).toEqual(expected);
  });

  it('matches legacy recomputeAll on the edge-case payload', () => {
    const expected = load<EngineOutput>('legacy-scoring-edge.json');
    expect(runPort(edgePayload, DEFAULT_WEIGHTS)).toEqual(expected);
  });

  it('recomputes scores when weights change (slider drives the numbers)', () => {
    const heavy = runPort(payload, { ...DEFAULT_WEIGHTS, pay: 3.0 });
    const free = runPort(payload, { ...DEFAULT_WEIGHTS, pay: 0.0 });
    const changed = payload.allPlayers.some(
      (p, i) => !p.isPreArb && heavy.players[i].score !== free.players[i].score,
    );
    expect(changed).toBe(true);
  });
});
