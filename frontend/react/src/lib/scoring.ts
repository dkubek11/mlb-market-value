/**
 * Scoring engine — VERBATIM TypeScript port of the legacy engine in
 * frontend/dashboard/dashboard_template.html.bak.
 *
 * Source ranges (original line numbers, pre-migration template):
 *   - gradeFor:              lines 762-772
 *   - weighted composite engine (configs, constants, effectiveSampleSize,
 *     weightedMedian, adaptiveCompMedian, recomputeAll): lines 1262-1474
 *
 * The legacy code is the site's single source of truth for every score/grade/
 * value/projected-salary shown anywhere. This port keeps the same algorithms,
 * the same operation order, and the same constants so the numbers it produces
 * are bit-for-bit identical to the legacy recomputeAll(). Do NOT "improve"
 * anything here without re-running the parity fixture
 * (npm run capture:legacy && npm test).
 */
import type { PlayerRecord, PositionStats, StatValue, TeamRecord } from '../api/types';

/** Stat value formatting types used by the scoring configs (incl. fracPct1). */
export type StatType = 'avg3' | 'pct1' | 'fracPct1' | 'int' | 'rate2' | 'velo1';

/** One entry of the weighted scoring config (BATTER_STAT_CONFIG / PITCHER_STAT_CONFIG). */
export interface ScoringStatConfig {
  key: string;
  label: string;
  higherBetter: boolean;
  defaultWeight: number;
  type: StatType;
}

// --- Weighted composite scoring engine (this is the site's single source
// of truth: every score/grade/value/projected-salary everywhere reads back
// off the player objects that recomputeAll() below writes into) ---
export const BATTER_STAT_CONFIG: ScoringStatConfig[] = [
  { key: 'xwoba', label: 'xwOBA', higherBetter: true, defaultWeight: 3.0, type: 'avg3' },
  { key: 'xba', label: 'xBA', higherBetter: true, defaultWeight: 1.0, type: 'avg3' },
  { key: 'xslg', label: 'xSLG', higherBetter: true, defaultWeight: 1.5, type: 'avg3' },
  { key: 'barrel_rate', label: 'Barrel%', higherBetter: true, defaultWeight: 1.5, type: 'pct1' },
  { key: 'hard_hit_rate', label: 'Hard-Hit%', higherBetter: true, defaultWeight: 1.0, type: 'pct1' },
  { key: 'chase_rate', label: 'Chase%', higherBetter: false, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'whiff_rate', label: 'Whiff%', higherBetter: false, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'k_rate', label: 'K%', higherBetter: false, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'bb_rate', label: 'BB%', higherBetter: true, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'oaa', label: 'OAA', higherBetter: true, defaultWeight: 0.7, type: 'int' },
  { key: 'frv', label: 'FRV', higherBetter: true, defaultWeight: 0.7, type: 'int' },
  { key: 'drs', label: 'DRS', higherBetter: true, defaultWeight: 0.7, type: 'int' },
];
export const PITCHER_STAT_CONFIG: ScoringStatConfig[] = [
  { key: 'xera', label: 'xERA', higherBetter: false, defaultWeight: 2.0, type: 'rate2' },
  { key: 'xba_against', label: 'xBA Allowed', higherBetter: false, defaultWeight: 1.0, type: 'avg3' },
  { key: 'avg_exit_velo_against', label: 'Avg Exit Velo Allowed', higherBetter: false, defaultWeight: 0.8, type: 'velo1' },
  { key: 'hard_hit_rate_against', label: 'Hard-Hit% Allowed', higherBetter: false, defaultWeight: 1.0, type: 'pct1' },
  { key: 'barrel_rate_against', label: 'Barrel% Allowed', higherBetter: false, defaultWeight: 1.2, type: 'pct1' },
  { key: 'k_rate', label: 'K%', higherBetter: true, defaultWeight: 1.5, type: 'fracPct1' },
  { key: 'bb_rate', label: 'BB%', higherBetter: false, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'chase_rate', label: 'Chase% Induced', higherBetter: true, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'whiff_rate', label: 'Whiff% Induced', higherBetter: true, defaultWeight: 1.0, type: 'fracPct1' },
  { key: 'z_swing_rate', label: 'Z-Swing% Induced', higherBetter: false, defaultWeight: 0.5, type: 'fracPct1' },
  { key: 'extension', label: 'Extension', higherBetter: true, defaultWeight: 1.0, type: 'velo1' },
  { key: 'stuff_plus', label: 'Stuff+', higherBetter: true, defaultWeight: 1.5, type: 'int' },
  { key: 'location_plus', label: 'Location+', higherBetter: true, defaultWeight: 1.5, type: 'int' },
];

export const DEFAULT_PAY_WEIGHT = 1.0;

// How much weight the Marcel-style multi-year projection gets when anchoring
// a pre-arb player's salary comps, vs. their compPct from this season alone.
export const PROJECTION_BLEND = 0.3;

// Percentile-point decay scale for comp weighting below: weight =
// e^(-distance / PROXIMITY_SCALE). Exponential rather than inverse (1/d) --
// MLB pay is bimodal (lots of cost-controlled arms, a separate cluster of
// paid aces, not much between), so a slowly-decaying tail lets the much
// more numerous cheap comps quietly outvote a thin cluster of expensive
// ones even at long range. Exponential decay keeps the "no hard cutoff"
// benefit but drops distant comps' influence fast enough that they stop
// mattering well before that happens.
export const PROXIMITY_SCALE = 8;

// A player at the extreme edge of a position's performance distribution
// (e.g. dead last) can have almost no market-priced peers nearby -- the
// closest "comp" might be 10+ percentile points away. At the default
// scale, that one comp can end up carrying most of the weight, so the
// "recommended pay" becomes whatever that single closest player happens to
// earn, not a real market consensus. MIN_EFFECTIVE_COMPS guards against
// that: if too few comps are meaningfully contributing, the scale widens
// until enough real signal is pulled in, capped at PROXIMITY_SCALE_MAX.
export const MIN_EFFECTIVE_COMPS = 5;
export const PROXIMITY_SCALE_GROWTH = 1.4;
export const PROXIMITY_SCALE_MAX = 40;

/** Grade letter for a performance percentile, verbatim from the legacy card. */
export function gradeFor(pct: number): string {
  if (pct >= 99) return 'S';
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C+';
  if (pct >= 40) return 'C';
  if (pct >= 30) return 'D';
  return 'F';
}

// Kish's effective sample size: (sum w)^2 / sum(w^2). Equals the plain
// count when every weight is equal, and collapses toward 1 when one weight
// dominates the rest -- a direct measure of "how many comps are actually
// doing the work," not just how many are technically nonzero.
export function effectiveSampleSize(weights: number[]): number {
  const sum = weights.reduce((a, w) => a + w, 0);
  const sumSq = weights.reduce((a, w) => a + w * w, 0);
  return sumSq > 0 ? (sum * sum) / sumSq : 0;
}

// Weighted median: sort by value, walk the cumulative weight, return the
// value where it crosses half the total weight. Distance-weighting an
// average is easy but lets one huge outlier drag the whole result; a
// weighted median keeps that same outlier-resistance a plain median has,
// just letting nearby comps count more than far ones instead of counting
// everyone inside a window equally and everyone outside it not at all.
export function weightedMedian<T extends Record<string, number>>(
  items: T[],
  valueKey: keyof T,
  weightKey: keyof T,
): number | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a[valueKey] - b[valueKey]);
  const totalWeight = sorted.reduce((s, it) => s + it[weightKey], 0);
  let cumulative = 0;
  for (const it of sorted) {
    cumulative += it[weightKey];
    if (cumulative >= totalWeight / 2) return it[valueKey];
  }
  return sorted[sorted.length - 1][valueKey];
}

// Proximity-weighted median with an adaptively widening scale: starts at
// PROXIMITY_SCALE and widens (by PROXIMITY_SCALE_GROWTH each step) until
// the effective sample size clears MIN_EFFECTIVE_COMPS or the scale hits
// PROXIMITY_SCALE_MAX, whichever comes first.
export function adaptiveCompMedian(
  pool: Array<{ compPct: number; aav: number }>,
  anchorPct: number,
  valueKey: 'aav',
): number {
  let scale = PROXIMITY_SCALE;
  let weights: number[] = [];
  while (true) {
    weights = pool.map(m => Math.exp(-Math.abs(m.compPct - anchorPct) / scale));
    if (effectiveSampleSize(weights) >= MIN_EFFECTIVE_COMPS || scale >= PROXIMITY_SCALE_MAX) break;
    scale *= PROXIMITY_SCALE_GROWTH;
  }
  const items = pool.map((m, i) => ({ value: m[valueKey], weight: weights[i] }));
  // pool is non-empty by contract (the caller guards compPool.length === 0),
  // so the weighted median is always defined here.
  return weightedMedian(items, 'value', 'weight') as number;
}

/** One weighted stat line of a player's score breakdown (legacy `p.breakdown`). */
export interface BreakdownEntry {
  key: string;
  label: string;
  higherBetter: boolean;
  defaultWeight: number;
  type: StatType;
  value: StatValue;
  z: number | null;
  contribution: number;
}

/** A PlayerRecord after recomputeAll() has written every derived field into it. */
export interface EnrichedPlayer extends PlayerRecord {
  rawScore: number;
  breakdown: BreakdownEntry[];
  compPct: number;
  grade: string;
  salPct: number | null;
  score: number;
  projectedPct: number | null;
  recommendedSalary: number | null;
  paySurplus: number | null;
  projectedSalary: number | null;
  surplus: number | null;
}

/** A TeamRecord after recomputeAll() has written avgScore. */
export interface EnrichedTeam extends TeamRecord {
  avgScore: number;
}

/** Mutable slider weights, mirroring the legacy module-level battingWeights / pitchingWeights / payWeight. */
export interface ScoringWeights {
  batting: Record<string, number>;
  pitching: Record<string, number>;
  pay: number;
}

/**
 * Verbatim port of legacy recomputeAll(). Mutates `allPlayers` and `teams` in
 * place (exactly like the legacy module-level arrays). Callers that must not
 * mutate their source data (ScoringProvider, the parity tests) pass shallow
 * clones. The legacy engine reads p.stats / p.projected / p.aav / p.position /
 * p.isBatter / p.isPreArb and writes the enriched fields; all comparisons use
 * the same loose != null checks as the original.
 */
export function recomputeAll(
  allPlayers: EnrichedPlayer[],
  positionStats: PositionStats,
  teams: EnrichedTeam[],
  weights: ScoringWeights,
): void {
  allPlayers.forEach(p => {
    const cfg = p.isBatter ? BATTER_STAT_CONFIG : PITCHER_STAT_CONFIG;
    const w = p.isBatter ? weights.batting : weights.pitching;
    const posStats = positionStats[p.position] || {};
    let total = 0;
    const breakdown = cfg.map(s => {
      const val = p.stats[s.key];
      const ps = posStats[s.key];
      let z: number | null = null;
      let contribution = 0;
      if (val != null && ps && ps.std > 0) {
        const rawZ = (val - ps.mean) / ps.std;
        z = s.higherBetter ? rawZ : -rawZ;
        contribution = z * w[s.key];
        total += contribution;
      }
      return { ...s, value: val == null ? null : val, z, contribution };
    });
    // rawScore is the pure stat-weighted composite (no pay). p.score, set
    // below, is the single number shown everywhere on the site: rawScore
    // converted to a percentile and blended with the salary percentile.
    p.rawScore = total;
    p.breakdown = breakdown;
    // Players without a multi-year projection keep projectedPct null (the
    // legacy code leaves the field unset, which reads the same via != null).
    p.projectedPct = p.projectedPct ?? null;
  });

  const byPos: Record<string, EnrichedPlayer[]> = {};
  allPlayers.forEach(p => { (byPos[p.position] = byPos[p.position] || []).push(p); });

  Object.values(byPos).forEach(group => {
    const byRaw = [...group].sort((a, b) => a.rawScore - b.rawScore);
    byRaw.forEach((p, i) => {
      p.compPct = byRaw.length > 1 ? (i / (byRaw.length - 1)) * 100 : 100;
      p.grade = gradeFor(p.compPct);
    });

    const marketGroup = group.filter(p => !p.isPreArb);
    const bySalary = [...marketGroup].sort((a, b) => a.aav - b.aav);
    bySalary.forEach((p, i) => {
      p.salPct = bySalary.length > 1 ? (i / (bySalary.length - 1)) * 100 : 100;
      p.score = p.compPct - weights.pay * p.salPct;
    });

    // Rank players by their blended (Marcel + comparable-player) projected
    // true-talent value (xwoba for batters, xera for pitchers) wherever a
    // projection exists, so the pre-arb salary anchor below can lean on
    // multi-year, sample-size-, age-, and peer-outcome-adjusted history
    // instead of only this season's small sample.
    const isBatterGroup = group[0] && group[0].isBatter;
    const projKey = isBatterGroup ? 'xwoba' : 'xera';
    const higherBetterProj = isBatterGroup;
    const withProj = group.filter(p => p.projected && p.projected[projKey] != null);
    const byProj = [...withProj].sort((a, b) => {
      const av = a.projected[projKey]!;
      const bv = b.projected[projKey]!;
      return higherBetterProj ? av - bv : bv - av;
    });
    byProj.forEach((p, i) => {
      p.projectedPct = byProj.length > 1 ? (i / (byProj.length - 1)) * 100 : 100;
    });

    // Pre-arbitration players are paid at/near the league minimum by CBA
    // rule, not by the market, so there's no meaningful salary percentile
    // to blend in -- their score is just their performance percentile.
    group.filter(p => p.isPreArb).forEach(p => {
      p.salPct = null;
      p.score = p.compPct;
    });

    // Recommended pay: what a player's performance level says they're
    // worth, in dollars -- the median AAV of market-priced peers performing
    // at a similar level. Computed for every player (market and pre-arb
    // alike), not just rookies, so it doubles as a plain-dollar complement
    // to Score for market players too ("performs like $30M, paid $8M").
    group.forEach(p => {
      if (marketGroup.length === 0) { p.recommendedSalary = null; p.paySurplus = null; return; }
      // Blend in the multi-year projection (when available) so the number
      // isn't purely a bet on one season's small sample.
      const anchorPct = p.projectedPct != null
        ? (1 - PROJECTION_BLEND) * p.compPct + PROJECTION_BLEND * p.projectedPct
        : p.compPct;
      const compPool = marketGroup.filter(m => m !== p);
      if (compPool.length === 0) { p.recommendedSalary = null; p.paySurplus = null; return; }
      const median = adaptiveCompMedian(compPool, anchorPct, 'aav');
      p.recommendedSalary = median;
      p.paySurplus = median - p.aav;
    });

    // Pre-arb players keep the old field names too (card/Rookies-tab code
    // reads projectedSalary/surplus) -- same numbers, just aliased.
    group.filter(p => p.isPreArb).forEach(p => {
      p.projectedSalary = p.recommendedSalary;
      p.surplus = p.paySurplus;
    });
  });

  teams.forEach(t => {
    const roster = allPlayers.filter(p => p.team === t.abbr && !p.isPreArb && p.score != null);
    t.avgScore = roster.length ? roster.reduce((a, p) => a + p.score, 0) / roster.length : 0;
  });
}
