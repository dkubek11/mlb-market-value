/**
 * HomeView — port of the legacy home tab (dashboard_template.html.bak:947-1018).
 * The 2x2 league value grid (NL/AL x underpaid/overpaid) plus the rookie-bargain
 * and payroll-leader preview lists. The hero-band KPIs and the global "Most
 * underpaid" preview card were removed (the grid covers underpaid per league).
 */
import { useMemo } from 'react';
import { fmtMoney, fmtSigned } from '../lib/format';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';
import type { TabKey } from '../components/Sidebar';

export type LeagueKey = 'NL' | 'AL';

/** One league cell: top-5 market players by score in the given direction. */
export interface LeagueCell {
  league: LeagueKey;
  title: string;
  rows: EnrichedPlayer[];
  empty: boolean;
}

/**
 * Pure helper (unit-tested): splits market-priced players (non-pre-arb) into
 * the 2x2 league grid. Top row = NL, bottom row = AL; left column = most
 * underpaid (score > 0, desc), right column = most overpaid (score < 0, asc).
 * All positions rank together. Players whose team has no league mapping are
 * skipped. Returns 4 cells in row-major order: [NL underpaid, NL overpaid,
 * AL underpaid, AL overpaid]. The sign split guarantees a player never
 * appears in both columns (with real league data the top-N per column are
 * all-positive / all-negative anyway, so output is unchanged there).
 */
export function leagueValueGrid(
  players: EnrichedPlayer[],
  teams: EnrichedTeam[],
  limit = 5,
): LeagueCell[] {
  const leagueByAbbr = new Map<string, LeagueKey>();
  teams.forEach(t => leagueByAbbr.set(t.abbr, t.league as LeagueKey));

  const cells: LeagueCell[] = [
    { league: 'NL', title: 'Most underpaid', rows: [], empty: true },
    { league: 'NL', title: 'Most overpaid', rows: [], empty: true },
    { league: 'AL', title: 'Most underpaid', rows: [], empty: true },
    { league: 'AL', title: 'Most overpaid', rows: [], empty: true },
  ];

  const marketPlayers = players.filter(p => !p.isPreArb);
  for (const league of ['NL', 'AL'] as const) {
    const byLeague = marketPlayers.filter(p => leagueByAbbr.get(p.team) === league);
    const underpaid = byLeague.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    const overpaid = byLeague.filter(p => p.score < 0).sort((a, b) => a.score - b.score).slice(0, limit);
    cells[league === 'NL' ? 0 : 2].rows = underpaid;
    cells[league === 'NL' ? 0 : 2].empty = underpaid.length === 0;
    cells[league === 'NL' ? 1 : 3].rows = overpaid;
    cells[league === 'NL' ? 1 : 3].empty = overpaid.length === 0;
  }
  return cells;
}

interface HomeViewProps {
  players: EnrichedPlayer[];
  teams: EnrichedTeam[];
  season: number;
  onNavigate: (tab: TabKey) => void;
}

export function HomeView({ players, teams, season, onNavigate }: HomeViewProps) {
  // Rookie-bargain and payroll-leader preview lists (the global "Most underpaid"
  // preview card was removed — the NL/AL league grid above covers underpaid).
  const previews = useMemo(() => {
    // Legacy preArbPlayers filter: isPreArb AND surplus != null.
    const preArbPlayers: Array<EnrichedPlayer & { surplus: number }> = players.filter(
      (p): p is EnrichedPlayer & { surplus: number } => p.isPreArb && p.surplus != null,
    );
    const topRookies = [...preArbPlayers].sort((a, b) => b.surplus - a.surplus).slice(0, 5);
    const topTeams = [...teams].sort((a, b) => b.payroll - a.payroll).slice(0, 5);
    return { topRookies, topTeams };
  }, [players, teams]);

  const grid = useMemo(() => leagueValueGrid(players, teams), [players, teams]);

  return (
    <div id="home-view">
      <div className="hero-center">
        <p className="eyebrow">{season} Season</p>
        <h1 id="page-title">MLB Pay vs.<br />Performance</h1>
        <p className="lede" id="page-lede">
          Every qualified player's on-field percentile ranked against same-position peers, next to where their salary ranks among the same group. The gap between the two is the value score.
        </p>
      </div>

      <div className="league-grid">
        {grid.map(cell => (
          <section key={`${cell.league}-${cell.title}`} className="league-card">
            <div className="league-head">
              <span className="league-badge">{cell.league}</span>
              <h3 className="league-title">{cell.title}</h3>
              <button className="league-link" type="button" onClick={() => onNavigate('players')}>
                See all →
              </button>
            </div>
            {cell.empty ? (
              <p className="league-empty">No market players in the {cell.league}.</p>
            ) : (
              cell.rows.map(p => (
                <div className="preview-row" key={p.id + p.position}>
                  <span className="preview-row-name">
                    {p.name} <span className="preview-row-tag">{p.team} · {p.position}</span>
                  </span>
                  <span className={`preview-row-val ${cell.title === 'Most overpaid' ? 'bad' : 'good'}`}>
                    {fmtSigned(p.score)}
                  </span>
                </div>
              ))
            )}
          </section>
        ))}
      </div>

      <div className="preview-grid">
        <div className="preview-card">
          <div className="preview-head">
            <h3>Biggest rookie bargains <span className="preview-sub">projected vs. actual</span></h3>
            <button className="preview-link" type="button" onClick={() => onNavigate('rookies')}>See all →</button>
          </div>
          {previews.topRookies.map(p => (
            <div className="preview-row" key={p.id + p.position}>
              <span className="preview-row-name">
                {p.name} <span className="preview-row-tag">{p.team} · {p.position}</span>
              </span>
              <span className="preview-row-val proj">+{fmtMoney(p.surplus)}</span>
            </div>
          ))}
        </div>
        <div className="preview-card">
          <div className="preview-head">
            <h3>Payroll leaders <span className="preview-sub">{season} total tracked</span></h3>
            <button className="preview-link" type="button" onClick={() => onNavigate('teams')}>See all →</button>
          </div>
          {previews.topTeams.map(t => (
            <div className="preview-row" key={t.abbr}>
              <span className="preview-row-name">
                {t.name} <span className="preview-row-tag">{t.abbr}</span>
              </span>
              <span className="preview-row-val">{fmtMoney(t.payroll)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="method">
        <strong>How to read this:</strong> Score = performance percentile − (Pay weight × salary percentile), computed within same position and season. Positive means outperforming their pay grade (underpaid); negative means overpaid relative to position peers. Performance percentile comes from a weighted composite — 12 stats for batters (xwOBA, xBA, xSLG, Barrel%, Hard-Hit%, Chase%, Whiff%, K%, BB%, OAA, FRV, DRS), 13 for pitchers (xERA, xBA/Avg Exit Velo/Hard-Hit%/Barrel% Allowed, K%, BB%, Chase%/Whiff%/Z-Swing% Induced, Extension, Stuff+, Location+) — each stat scored as a z-score against the position average. Adjust any weight, including Pay, in the <strong>Weights</strong> tab and every score, grade, and salary projection on the site recomputes instantly. Minimum sample: 150 PA for batters, 50 IP for pitchers.
        <br /><br />
        <strong>Pre-arbitration players skip the pay adjustment</strong> — by CBA rule they're paid at or near the league minimum almost regardless of performance, so weighing their salary would just penalize them for a number they don't control. Their Score is pure performance percentile, and they're broken out in the <strong>Rookies</strong> tab with a projected market salary based on comparable-performing market-priced peers (Arbitration, Extension, or Free Agent deals) at their position.
        <br /><br />
        <strong>▲/▼ arrows</strong> next to a player's name (and on their card) flag a gap between their actual AVG/ERA this season and a projected true-talent level, blending two independent signals: a Marcel-style projection (their own last 3 seasons of expected stats, regressed to the league mean by sample size and adjusted for age) and a comparable-player projection (historical players — 2015–2024 — who were at the same age with a similar recent performance level and trend, weighted by how those comps actually performed the following season). Both are real, established statistical techniques, not black-box models. Green ▲ means they're underperforming that projection and due for positive regression; red ▼ means they're running ahead of it and likely to cool off. For pre-arb players, this projection also nudges their projected salary so a small-sample hot or cold streak doesn't fully drive the number.
      </div>
    </div>
  );
}
