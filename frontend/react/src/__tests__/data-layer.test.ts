/**
 * Data-layer unit tests: payload validation + snapshot-note format.
 * Run with: npm test (vitest run, node environment — no DOM needed).
 */
import { describe, expect, it } from 'vitest';
import { validateDashboardPayload } from '../api/client';
import { dashboardUrl } from '../api/dashboard';
import { snapshotNote } from '../components/Sidebar';
import type { DashboardPayload } from '../api/types';

function makePayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  const base: DashboardPayload = {
    allPlayers: [
      {
        id: 1,
        name: 'Test Player',
        team: 'TEST',
        position: 'DH',
        isBatter: true,
        isPreArb: false,
        salary: 10000000,
        aav: 12000000,
        contractType: 'Extension',
        stats: { ba: 0.28, hr: 20 },
        projected: { ba: 0.29, hr: 22 },
        age: 28,
        nComps: 6,
      },
    ],
    positionStats: { DH: { ba: { mean: 0.25, std: 0.03 } } },
    teams: [{ abbr: 'TEST', name: 'Test Team', league: 'AL', division: 'West', payroll: 200000000 }],
    rosters: { TEST: { DH: { id: 1, name: 'Test Player' } } },
    teamColors: { TEST: ['#000000', '#ffffff'] },
    contracts: {},
    capturedAt: '2026-08-05 04:12 UTC',
    ...overrides,
  };
  return base;
}

describe('validateDashboardPayload', () => {
  it('accepts a valid payload', () => {
    const payload = makePayload();
    expect(() => validateDashboardPayload(payload)).not.toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => validateDashboardPayload(null)).toThrow(/not an object/);
    expect(() => validateDashboardPayload(42)).toThrow(/not an object/);
  });

  it('rejects a payload missing a required top-level key', () => {
    const { capturedAt: _drop, ...rest } = makePayload();
    void _drop;
    expect(() => validateDashboardPayload(rest)).toThrow(/missing "capturedAt"/);
  });

  it('rejects an empty allPlayers array', () => {
    expect(() => validateDashboardPayload(makePayload({ allPlayers: [] }))).toThrow(/non-empty array/);
  });

  it('rejects a malformed player record', () => {
    const payload = makePayload();
    (payload.allPlayers[0] as unknown as { salary: unknown }).salary = 'not-a-number';
    expect(() => validateDashboardPayload(payload)).toThrow(/player record failed validation/);
  });

  it('rejects a malformed team record', () => {
    const payload = makePayload();
    (payload.teams[0] as unknown as { payroll: unknown }).payroll = 'oops';
    expect(() => validateDashboardPayload(payload)).toThrow(/team record failed validation/);
  });

  it('rejects contracts that are not an object', () => {
    expect(() => validateDashboardPayload(makePayload({ contracts: [] as never }))).toThrow(/not an object/);
  });
});

describe('dashboardUrl', () => {
  it('builds the exact legacy URL/params', () => {
    expect(dashboardUrl(2026)).toBe('/api/dashboard?season=2026&fetch_live_contracts=true');
  });
});

describe('snapshotNote', () => {
  it('matches the legacy format with market/pre-arb counts and capturedAt', () => {
    const payload = makePayload({
      allPlayers: [
        makePayload().allPlayers[0],
        { ...makePayload().allPlayers[0], id: 2, isPreArb: true },
        { ...makePayload().allPlayers[0], id: 3, isPreArb: true },
      ],
    });
    const note = snapshotNote(payload, 2026);
    expect(note).toBe(
      'Snapshot of 2026 season data · 1 market-priced players + 2 pre-arb/MiLB prospects (min. 150 PA / 50 IP) across 1 teams · captured 2026-08-05 04:12 UTC',
    );
  });
});
