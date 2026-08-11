/**
 * fetch wrapper + runtime payload validation.
 *
 * - timeout via AbortController (mirrors plan §4: abort on unmount/season change)
 * - normalizes network / HTTP / JSON / schema errors into a single Error type
 * - validateDashboardPayload() guards the API-contract boundary (plan §10.10):
 *   a drifted backend fails loudly with a clear message instead of undefined crashes.
 */
import type {
  Contracts,
  DashboardPayload,
  PlayerRecord,
  PositionStats,
  Rosters,
  TeamColors,
  TeamRecord,
} from './types';

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  constructor(status: number, statusText: string, body: string) {
    super(`HTTP ${status} ${statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
  }
}

export interface FetchOptions {
  /** ms before the request is aborted. Default 30_000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** GET JSON with a hard timeout; throws HttpError on !ok, Error on network/JSON failure. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, signal } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const onOuterAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        /* ignore body read failure */
      }
      throw new HttpError(res.status, res.statusText, body);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Request aborted.' : 'Request timed out.');
    }
    if (err instanceof TypeError) {
      throw new Error('Network error — the API is unreachable.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isPlayerRecord = (v: unknown): v is PlayerRecord =>
  isRecord(v) &&
  typeof v.id === 'number' &&
  typeof v.name === 'string' &&
  typeof v.team === 'string' &&
  typeof v.position === 'string' &&
  typeof v.isBatter === 'boolean' &&
  typeof v.isPreArb === 'boolean' &&
  typeof v.salary === 'number' &&
  typeof v.aav === 'number' &&
  isRecord(v.stats) &&
  isRecord(v.projected) &&
  typeof v.nComps === 'number';

const isTeamRecord = (v: unknown): v is TeamRecord =>
  isRecord(v) &&
  typeof v.abbr === 'string' &&
  typeof v.name === 'string' &&
  typeof v.league === 'string' &&
  typeof v.division === 'string' &&
  typeof v.payroll === 'number';

/**
 * Structural validation of the /api/dashboard payload: the 7 top-level keys plus
 * spot-checks on the first player/team rows and the sub-collections. Throws an
 * Error with a specific message when the contract has drifted.
 */
export function validateDashboardPayload(raw: unknown): DashboardPayload {
  if (!isRecord(raw)) {
    throw new Error('Dashboard payload is not an object — API contract drift?');
  }

  const required: Array<[keyof DashboardPayload, string]> = [
    ['allPlayers', 'array of player records'],
    ['positionStats', 'object keyed by position'],
    ['teams', 'array of team records'],
    ['rosters', 'object keyed by team'],
    ['teamColors', 'object keyed by team abbreviation'],
    ['contracts', 'object keyed by player id'],
    ['capturedAt', 'UTC timestamp string'],
  ];
  for (const [key, desc] of required) {
    if (!(key in raw)) {
      throw new Error(`Dashboard payload missing "${key}" (expected ${desc}).`);
    }
  }

  const players = raw.allPlayers;
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error('Dashboard payload "allPlayers" is not a non-empty array.');
  }
  for (const p of players.slice(0, 3)) {
    if (!isPlayerRecord(p)) {
      throw new Error('Dashboard payload player record failed validation (id/name/team/position/isBatter/isPreArb/salary/aav/stats/projected/nComps).');
    }
  }

  const teams = raw.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error('Dashboard payload "teams" is not a non-empty array.');
  }
  for (const t of teams.slice(0, 3)) {
    if (!isTeamRecord(t)) {
      throw new Error('Dashboard payload team record failed validation (abbr/name/league/division/payroll).');
    }
  }

  if (typeof raw.capturedAt !== 'string') {
    throw new Error('Dashboard payload "capturedAt" is not a string.');
  }

  // Sub-collections: tolerate any valid shape for rosters/teamColors/contracts,
  // but reject non-objects so downstream `.X` lookups never crash.
  for (const key of ['positionStats', 'rosters', 'teamColors', 'contracts'] as const) {
    const v = raw[key];
    if (!isRecord(v) || Array.isArray(v)) {
      throw new Error(`Dashboard payload "${key}" is not an object.`);
    }
  }

  return raw as unknown as DashboardPayload;
}

/** Type-only re-exports so api/dashboard.ts consumers have one import surface. */
export type { Contracts, DashboardPayload, PlayerRecord, PositionStats, Rosters, TeamColors, TeamRecord };
