/**
 * PlayersView — port of the legacy Players tab (dashboard_template.html.bak:1020-1071).
 * Search box + position chips filter market-priced (non-pre-arb) players, the table
 * sorts via the shared useSort state machine, and rows are capped at 300 (legacy
 * slice(0,300)). Null stats render as — via fmtMoney. The empty state matches the
 * legacy colspan-6 message exactly.
 */
import { useMemo, useState } from 'react';
import { fmtMoney, fmtSigned, valueBarStyle, matchesTeamQuery, teamNameByAbbr } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { useSort, applySort } from '../hooks/useSort';
import { RegressionTag } from '../components/RegressionTag';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';

const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];

const MAX_ABS = 100; // legacy hardcoded maxAbs=100 for the score bar

interface PlayersViewProps {
  players: EnrichedPlayer[];
  teams: EnrichedTeam[];
  onOpenPlayer: (p: EnrichedPlayer) => void;
}

/** Legacy valueBar: centered bar scaled by maxAbs, plus the signed value. */
function ScoreBar({ value }: { value: number }) {
  const { cls, pct, isPositive } = valueBarStyle(value, MAX_ABS);
  const style = isPositive ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` };
  return (
    <div className="bar-cell">
      <div className="bar-track">
        <div className="bar-mid" />
        <div className={`bar-fill ${cls}`} style={style} />
      </div>
      <span className={`value-num ${cls}`}>{fmtSigned(value)}</span>
    </div>
  );
}

export function PlayersView({ players, teams, onOpenPlayer }: PlayersViewProps) {
  const teamNames = useMemo(() => teamNameByAbbr(teams), [teams]);
  const [q, setQ] = useState('');
  const [activePos, setActivePos] = useState('All');
  const { sort, toggle } = useSort({ key: 'score', dir: 'desc' });

  // Legacy renderPlayers: filter, sort, slice(0,300).
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    let filtered = players.filter(
      p => !p.isPreArb && (activePos === 'All' || p.position === activePos) && (query === '' || matchesTeamQuery(p, query, teamNames)),
    );
    // Players table shows market players only; compPct is always a number here.
    const sorted = applySort(filtered as Array<EnrichedPlayer & { compPct: number }>, sort, row => row[sort.key as keyof typeof row]);
    return sorted.slice(0, 300);
  }, [players, q, activePos, sort, teamNames]);

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
    { key: 'salary', label: 'Salary', num: true, render: p => fmtMoney(p.salary) },
    { key: 'compPct', label: 'Perf %', num: true, render: p => (p.compPct != null ? p.compPct.toFixed(1) : '—') },
    { key: 'salPct', label: 'Pay %', num: true, render: p => (p.salPct != null ? p.salPct.toFixed(1) : '—') },
    {
      key: 'recommendedSalary',
      label: 'Rec. Pay',
      num: true,
      render: p => fmtMoney(p.recommendedSalary),
    },
    { key: 'score', label: 'Score', num: true, render: p => <ScoreBar value={p.score} /> },
  ];

  const countText = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');

  return (
    <div id="players-view">
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
              className={`chip${pos === activePos ? ' active' : ''}`}
              onClick={() => setActivePos(pos)}
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
        emptyColspan={6}
        emptyMessage="No players match that search."
        rowClick={onOpenPlayer}
      />
    </div>
  );
}
