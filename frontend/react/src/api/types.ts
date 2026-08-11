/**
 * API contract types — mirrors backend/app/dashboard_data.py `_to_record` and
 * `build_dashboard_payload` exactly. Do NOT add optional shortcuts here; the
 * payload validation in api/client.ts enforces this shape at runtime.
 */

/** One stat column value (rounded to 5 decimals by the backend; null = not qualified). */
export type StatValue = number | null;

/** A single batter or pitcher record as produced by `_to_record`. */
export interface PlayerRecord {
  id: number;
  name: string;
  team: string;
  position: string;
  isBatter: boolean;
  isPreArb: boolean;
  /** Rounded to whole dollars; 0 when no salary data is present. */
  salary: number;
  aav: number;
  contractType: string | null;
  /** Current-season stat values, keyed by stat key (see BATTER_STAT_CONFIG / PITCHER_STAT_CONFIG). */
  stats: Record<string, StatValue>;
  age: number | null;
  /** Projected true-talent values, keyed the same as `stats` for 1:1 comparison. */
  projected: Record<string, StatValue>;
  nComps: number;
}

export interface TeamRecord {
  abbr: string;
  name: string;
  league: string;
  division: string;
  payroll: number;
}

/** Mean/std of a stat within a position; null when fewer than 2 samples. */
export interface PositionStatSummary {
  mean: number;
  std: number;
}
export type PositionStats = Record<string, Record<string, PositionStatSummary | null>>;

/** Best player per team/position for the diamond view. */
export type Rosters = Record<string, Record<string, { id: number; name: string }>>;

/** Static brand colors: [primary, secondary], from frontend/dashboard/team_colors.json. */
export type TeamColors = Record<string, [string, string]>;

export interface ContractYear {
  season: number;
  salary: number | null;
  aav: number | null;
  type: string | null;
}

export interface ContractEntry {
  contractType: string | null;
  yearsTotal: number | null;
  startSeason: number | null;
  endSeasonAll: number | null;
  totalGuaranteed: number | null;
  signingBonus: number | null;
  years: ContractYear[];
}
/** Keyed by player id. May be {} when the live FanGraphs scrape was skipped or failed. */
export type Contracts = Record<number, ContractEntry>;

export interface DashboardPayload {
  allPlayers: PlayerRecord[];
  positionStats: PositionStats;
  teams: TeamRecord[];
  rosters: Rosters;
  teamColors: TeamColors;
  contracts: Contracts;
  /** UTC timestamp, e.g. "2026-08-05 04:12 UTC". */
  capturedAt: string;
}

/** Stat config consumed by the card renderer (BATTER_STATS / PITCHER_STATS in legacy). */
export interface StatConfig {
  key: string;
  label: string;
  type: 'avg3' | 'int' | 'pct1' | 'velo1' | 'rate2';
  higherBetter: boolean;
}
