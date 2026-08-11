/**
 * TeamsView — port of the legacy Teams tab (dashboard_template.html.bak:1142-1260).
 * Search box filters teams, the table sorts by name/division/payroll/avgScore,
 * and clicking a row expands a diamond panel showing that team's best player per
 * position (rendered by DiamondField). The avgScore column uses the legacy
 * valueBar (bar-fill good/bad) scaled to the max |avgScore| across all teams.
 */
import { useMemo, useState } from 'react';
import { fmtMoney, fmtSigned, valueBarStyle } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { useSort, applySort } from '../hooks/useSort';
import { DiamondField } from '../components/DiamondField';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';
import type { Rosters } from '../api/types';

interface TeamsViewProps {
  players: EnrichedPlayer[];
  teams: EnrichedTeam[];
  rosters: Rosters;
  onOpenPlayer: (record: EnrichedPlayer) => void;
}

/** Legacy valueBar: centered bar scaled by maxAbs, plus the signed value. */
function ScoreBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const { cls, pct, isPositive } = valueBarStyle(value, maxAbs);
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

export function TeamsView({ players, teams, rosters, onOpenPlayer }: TeamsViewProps) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { sort, toggle } = useSort({ key: 'payroll', dir: 'desc' });

  // Legacy renderTeams maxAbs: max |avgScore| across ALL teams (not filtered).
  const maxAbs = useMemo(() => Math.max(...teams.map(t => Math.abs(t.avgScore)), 1), [teams]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = teams.filter(t => query === '' || t.name.toLowerCase().includes(query) || t.abbr.toLowerCase().includes(query));
    return applySort(filtered, sort, row => (sort.key === 'name' ? row.name : row[sort.key as keyof EnrichedTeam]));
  }, [teams, q, sort]);

  const columns: Array<Column<EnrichedTeam>> = [
    {
      key: 'name',
      label: 'Team',
      render: t => (
        <>
          <span className={`chevron${expanded === t.abbr ? ' open' : ''}`}>▸</span>
          <div className="name-cell" style={{ display: 'inline-flex' }}>
            <span>{t.name}</span>
            <span className="team-tag">{t.abbr}</span>
          </div>
        </>
      ),
    },
    { key: 'division', label: 'Division', render: t => t.division },
    { key: 'payroll', label: 'Payroll', num: true, render: t => fmtMoney(t.payroll) },
    { key: 'avgScore', label: 'Avg Score', num: true, render: t => <ScoreBar value={t.avgScore} maxAbs={maxAbs} /> },
  ];

  const countText = `${rows.length} shown` + (rows.length ? ' · click a team to see the roster' : '');

  return (
    <div id="teams-view">
      <div className="controls">
        <input
          className="search"
          placeholder="Search team..."
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search team"
        />
        <div className="spacer" />
        <span className="count">{countText}</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        sort={sort}
        onSort={toggle}
        emptyColspan={4}
        emptyMessage="No teams match that search."
        rowClick={t => setExpanded(expanded === t.abbr ? null : t.abbr)}
        isExpanded={t => expanded === t.abbr}
        expandedRow={t => (
          <div className="diamond-panel">
            <div className="diamond-head">
              <h3>{t.name} — 2026 roster by position</h3>
              <span className="diamond-sub">Top player by playing time at each spot (min. 150 PA / 50 IP)</span>
            </div>
            <div className="diamond-wrap">
              <DiamondField teamAbbr={t.abbr} players={players} rosters={rosters} onOpenPlayer={onOpenPlayer} />
            </div>
            <div className="diamond-legend">
              <span><span className="legend-dot" style={{ background: 'var(--good)' }} />Underpaid (value score)</span>
              <span><span className="legend-dot" style={{ background: 'var(--bad)' }} />Overpaid (value score)</span>
              <span><span className="legend-dot" style={{ background: 'var(--accent)' }} />Pre-arb — projected surplus</span>
            </div>
          </div>
        )}
      />
    </div>
  );
}
