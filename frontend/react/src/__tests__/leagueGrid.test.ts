/**
 * Unit tests for the HomeView 2x2 league value grid (leagueValueGrid).
 * Covers league split, underpaid/overpaid ordering, pre-arb exclusion,
 * top-N limit, and skipping players whose team has no league mapping.
 * Pure helper — no DOM needed.
 */
import { describe, expect, it } from 'vitest';
import { leagueValueGrid } from '../views/HomeView';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';

/** Minimal EnrichedPlayer factory — only fields leagueValueGrid reads. */
function p(overrides: Partial<EnrichedPlayer> & { id: number; name: string; team: string }): EnrichedPlayer {
  return {
    isBatter: true,
    isPreArb: false,
    salary: 0,
    aav: 0,
    contractType: null,
    stats: {},
    age: null,
    projected: {},
    nComps: 0,
    rawScore: 0,
    breakdown: [],
    compPct: 50,
    grade: 'C',
    salPct: null,
    score: 0,
    projectedPct: null,
    recommendedSalary: null,
    paySurplus: null,
    projectedSalary: null,
    surplus: null,
    position: 'DH',
    ...overrides,
  };
}

function team(abbr: string, league: 'NL' | 'AL'): EnrichedTeam {
  return { abbr, name: abbr, league, division: league, payroll: 0, avgScore: 0 };
}

const TEAMS = [team('N1', 'NL'), team('N2', 'NL'), team('A1', 'AL'), team('A2', 'AL')];

describe('leagueValueGrid', () => {
  it('splits market players into NL/AL underpaid+overpaid cells in row-major order', () => {
    const players = [
      p({ id: 1, name: 'NL Under', team: 'N1', score: 12 }),
      p({ id: 2, name: 'NL Over', team: 'N1', score: -8 }),
      p({ id: 3, name: 'AL Under', team: 'A1', score: 10 }),
      p({ id: 4, name: 'AL Over', team: 'A1', score: -5 }),
    ];
    const cells = leagueValueGrid(players, TEAMS);

    expect(cells.map(c => c.league)).toEqual(['NL', 'NL', 'AL', 'AL']);
    expect(cells.map(c => c.title)).toEqual([
      'Most underpaid',
      'Most overpaid',
      'Most underpaid',
      'Most overpaid',
    ]);
    expect(cells[0].rows.map(r => r.name)).toEqual(['NL Under']);
    expect(cells[1].rows.map(r => r.name)).toEqual(['NL Over']);
    expect(cells[2].rows.map(r => r.name)).toEqual(['AL Under']);
    expect(cells[3].rows.map(r => r.name)).toEqual(['AL Over']);
    expect(cells.every(c => !c.empty)).toBe(true);
  });

  it('sorts underpaid (positive, desc) and overpaid (negative, asc) regardless of position', () => {
    const players = [
      p({ id: 1, name: 'A', team: 'N1', score: 5, position: 'C' }),
      p({ id: 2, name: 'B', team: 'N1', score: 20, position: 'SP' }),
      p({ id: 3, name: 'C', team: 'N1', score: 1, position: '1B' }),
      p({ id: 4, name: 'D', team: 'N1', score: -15, position: 'LF' }),
      p({ id: 5, name: 'E', team: 'N1', score: -3, position: 'RP' }),
    ];
    const cells = leagueValueGrid(players, TEAMS, 10);

    expect(cells[0].rows.map(r => r.name)).toEqual(['B', 'A', 'C']);
    expect(cells[1].rows.map(r => r.name)).toEqual(['D', 'E']);
  });

  it('never lists the same player in both columns (sign split)', () => {
    const players = [
      p({ id: 1, name: 'Mixed', team: 'N1', score: -8 }),
      p({ id: 2, name: 'Pos', team: 'N1', score: 4 }),
    ];
    const cells = leagueValueGrid(players, TEAMS);

    expect(cells[0].rows.map(r => r.name)).toEqual(['Pos']);
    expect(cells[1].rows.map(r => r.name)).toEqual(['Mixed']);
  });

  it('excludes pre-arb players (rookies stay in their own preview card)', () => {
    const players = [
      p({ id: 1, name: 'Market', team: 'N1', score: 9 }),
      p({ id: 2, name: 'Rookie', team: 'N1', score: 99, isPreArb: true }),
    ];
    const cells = leagueValueGrid(players, TEAMS);

    expect(cells[0].rows.map(r => r.name)).toEqual(['Market']);
    expect(cells[0].rows.some(r => r.name === 'Rookie')).toBe(false);
  });

  it('honors the top-N limit per cell', () => {
    const players = [
      ...[1, 2, 3, 4, 5, 6, 7].map(i => p({ id: i, name: `Pos${i}`, team: 'N1', score: i * 10 })),
      ...[1, 2, 3, 4, 5, 6, 7].map(i => p({ id: 100 + i, name: `Neg${i}`, team: 'N1', score: -i * 10 })),
    ];
    const cells = leagueValueGrid(players, TEAMS, 3);

    expect(cells[0].rows).toHaveLength(3);
    expect(cells[1].rows).toHaveLength(3);
  });

  it('skips players whose team has no league mapping', () => {
    const players = [
      p({ id: 1, name: 'Known', team: 'N1', score: 8 }),
      p({ id: 2, name: 'Mystery', team: 'UNKNOWN', score: 50 }),
    ];
    const cells = leagueValueGrid(players, TEAMS);

    expect(cells[0].rows.map(r => r.name)).toEqual(['Known']);
    expect(cells.some(c => c.rows.some(r => r.name === 'Mystery'))).toBe(false);
  });

  it('marks a league cell empty when that league has no market players', () => {
    const players = [
      p({ id: 1, name: 'NL Under Guy', team: 'N1', score: 4 }),
      p({ id: 2, name: 'NL Over Guy', team: 'N1', score: -4 }),
    ];
    const cells = leagueValueGrid(players, TEAMS);

    expect(cells[0].empty).toBe(false);
    expect(cells[1].empty).toBe(false);
    expect(cells[2].empty).toBe(true);
    expect(cells[3].empty).toBe(true);
  });
});
