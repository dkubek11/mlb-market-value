/**
 * RookiesView — port of the legacy Rookies tab (dashboard_template.html.bak:1073-1131).
 * Filters pre-arb players, sorts by surplus desc by default, and renders the
 * projected-salary / surplus columns with the legacy surplusBar (bar-fill good,
 * value-num good). Empty state matches the legacy colspan-5 message exactly.
 */
import { useMemo, useState } from 'react';
import { fmtMoney, matchesTeamQuery, teamNameByAbbr } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { useSort, applySort } from '../hooks/useSort';
import { RegressionTag } from '../components/RegressionTag';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';

const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];

interface RookiesViewProps {
  players: EnrichedPlayer[];
  teams: EnrichedTeam[];
  onOpenPlayer: (p: EnrichedPlayer) => void;
}

/** Legacy surplusBar (dashboard_template.html.bak:1081-1087): full-width good bar. */
function SurplusBar({ surplus, max }: { surplus: number; max: number }) {
  const pct = Math.min(surplus / max, 1) * 100;
  return (
    <div className="bar-cell">
      <div className="bar-track">
        <div className="bar-fill good" style={{ left: 0, width: `${pct}%` }} />
      </div>
      <span className="value-num good">{fmtMoney(surplus)}</span>
    </div>
  );
}

export function RookiesView({ players, teams, onOpenPlayer }: RookiesViewProps) {
  const teamNames = useMemo(() => teamNameByAbbr(teams), [teams]);
  const [q, setQ] = useState('');
  const [activeRookiePos, setActiveRookiePos] = useState('All');
  const { sort, toggle } = useSort({ key: 'surplus', dir: 'desc' });

  // Legacy renderRookies: filter, sort, slice(0,300). The max for the surplus
  // bar is computed from ALL pre-arb surpluses (not just the filtered rows).
  const allSurplus = useMemo(
    () => players.filter(p => p.isPreArb && p.surplus != null).map(p => p.surplus as number),
    [players],
  );
  const maxSurplus = Math.max(...allSurplus, 1);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    let filtered = players.filter(
      p => p.isPreArb && (activeRookiePos === 'All' || p.position === activeRookiePos) && (query === '' || matchesTeamQuery(p, query, teamNames)),
    );
    // Rookies table shows pre-arb players only; compPct is always a number here.
    const sorted = applySort(filtered as Array<EnrichedPlayer & { compPct: number }>, sort, row => row[sort.key as keyof typeof row]);
    return sorted.slice(0, 300);
  }, [players, q, activeRookiePos, sort, teamNames]);

  const columns: Array<Column<EnrichedPlayer>> = [
    {
      key: 'name',
      label: 'Player',
      render: p => (
        <>
          <span className="chevron">▸</span>
          <div className="name-cell" style={{ display: 'inline-flex' }}>
            <span>
              {p.name}
              <RegressionTag record={p} />
            </span>
            <span className="team-tag">
              {p.team} · <span className="pos-pill">{p.position}</span>
            </span>
          </div>
        </>
      ),
    },
    { key: 'salary', label: 'Actual Salary', num: true, render: p => fmtMoney(p.salary) },
    { key: 'compPct', label: 'Perf %', num: true, render: p => (p.compPct != null ? p.compPct.toFixed(1) : '—') },
    { key: 'projectedSalary', label: 'Projected Salary', num: true, render: p => fmtMoney(p.projectedSalary) },
    {
      key: 'surplus',
      label: 'Surplus',
      num: true,
      render: p => (p.surplus != null ? <SurplusBar surplus={p.surplus} max={maxSurplus} /> : '—'),
    },
  ];

  const countText = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');

  return (
    <div id="rookies-view">
      <div className="controls">
        <input
          className="search"
          placeholder="Search player or team..."
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search player or team"
        />
        <div className="chips">
          {POSITIONS.map(pos => (
            <button
              key={pos}
              type="button"
              className={`chip${pos === activeRookiePos ? ' active' : ''}`}
              onClick={() => setActiveRookiePos(pos)}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="count">{countText}</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        sort={sort}
        onSort={toggle}
        emptyColspan={5}
        emptyMessage="No prospects match that search."
        rowClick={onOpenPlayer}
      />
    </div>
  );
}
