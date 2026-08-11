/**
 * Formatting + small data helpers ported verbatim from the legacy template
 * (dashboard_template.html.bak). Every displayed string must match the legacy
 * site exactly, so these are direct ports — no "cleanup".
 */
import type { EnrichedPlayer, EnrichedTeam } from './scoring';

/** Legacy fmtMoney: $X.XM / $XK / — for null. */
export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  return '$' + Math.round(n / 1000) + 'K';
}

/** Legacy fmtSigned: +/– prefixed number, — for null. */
export function fmtSigned(n: number | null | undefined): string {
  if (n == null) return '—';
  const s = n >= 0 ? '+' : '';
  return s + n.toFixed(1);
}

/** Legacy valueBar: centered bar scaled by maxAbs (legacy maxAbs=100). */
export function valueBarStyle(value: number, maxAbs = 100) {
  const pct = Math.min(Math.abs(value) / maxAbs, 1) * 50;
  const cls = value >= 0 ? 'good' : 'bad';
  const isPositive = value >= 0;
  return { cls, pct, isPositive };
}

/** Legacy matchesTeamQuery: name, abbr, or full team name. */
export function matchesTeamQuery(p: EnrichedPlayer, q: string, teamNames: Record<string, string>): boolean {
  return (
    p.name.toLowerCase().includes(q) ||
    p.team.toLowerCase().includes(q) ||
    (teamNames[p.team] || '').toLowerCase().includes(q)
  );
}

/** Legacy regression signal (dashboard_template.html.bak:781-803). */
const REGRESSION_THRESHOLD = { ba: 0.02, era: 0.4 };

export function regressionSignal(record: EnrichedPlayer) {
  if (record.isBatter) {
    const actual = record.stats.ba;
    const projected = record.projected && record.projected.xba;
    if (actual == null || projected == null) return null;
    return { actual, projected, gap: actual - projected, label: 'AVG', type: 'avg3' as const, threshold: REGRESSION_THRESHOLD.ba };
  }
  const actual = record.stats.era;
  const projected = record.projected && record.projected.xera;
  if (actual == null || projected == null) return null;
  return { actual, projected, gap: projected - actual, label: 'ERA', type: 'rate2' as const, threshold: REGRESSION_THRESHOLD.era };
}

export function regressionArrow(record: EnrichedPlayer) {
  const sig = regressionSignal(record);
  if (!sig || Math.abs(sig.gap) < sig.threshold) return null;
  return sig.gap > 0
    ? { symbol: '▼', cls: 'bad' as const, sig }
    : { symbol: '▲', cls: 'good' as const, sig };
}

/** Legacy fmtStatValue: card stat formatting (dashboard_template.html.bak:743-751). */
export function fmtStatValue(type: string, v: number | null | undefined): string {
  if (v == null) return '—';
  if (type === 'avg3') return (v < 0 ? '-' : '') + Math.abs(v).toFixed(3).replace(/^0\./, '.');
  if (type === 'rate2') return v.toFixed(2);
  if (type === 'pct1') return v.toFixed(1) + '%';
  if (type === 'velo1') return v.toFixed(1);
  if (type === 'int') return Math.round(v).toString();
  return String(v);
}

/** Legacy fmtStatValueExt: same as fmtStatValue but fracPct1 = ×100 (dashboard_template.html.bak:1301-1305). */
export function fmtStatValueExt(type: string, v: number | null | undefined): string {
  if (v == null) return '—';
  if (type === 'fracPct1') return (v * 100).toFixed(1) + '%';
  return fmtStatValue(type, v);
}

/** Legacy fmtDelta: signed delta with the stat's precision (dashboard_template.html.bak:752-761). */
export function fmtDelta(type: string, d: number): string {
  const sign = d >= 0 ? '+' : '−';
  const abs = Math.abs(d);
  if (type === 'avg3') return sign + abs.toFixed(3).replace(/^0\./, '.');
  if (type === 'rate2') return sign + abs.toFixed(2);
  if (type === 'pct1') return sign + abs.toFixed(1) + ' pts';
  if (type === 'velo1') return sign + abs.toFixed(1);
  if (type === 'int') return sign + Math.round(abs).toString();
  return sign + abs;
}

/** Build a team-abbr -> full-name map for matchesTeamQuery. */
export function teamNameByAbbr(teams: EnrichedTeam[]): Record<string, string> {
  const m: Record<string, string> = {};
  teams.forEach(t => { m[t.abbr] = t.name; });
  return m;
}
