/**
 * CustomScoreView — port of the legacy Custom tab
 * (dashboard_template.html.bak:591-639 HTML, renderCustomScore 1585-1610,
 * customDetailRow 1554-1583, chips/sort wiring 1543-1548, 1613-1635).
 *
 * Position chips filter every player (market and pre-arb), the 6-column table
 * sorts via the shared useSort state machine (rank is display-only, legacy
 * data-sort="rank" sorted by a non-existent field = no-op), and clicking a row
 * expands the live score breakdown: each stat's z-contribution, the pay row,
 * and the final Score formula. Two-way players share an id across their
 * batting/pitching rows, so expand state keys on `id:position` exactly like the
 * legacy expandedCustomIds set.
 */
import { useMemo, useState } from 'react';
import { fmtMoney, fmtSigned, fmtStatValueExt } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { useSort, applySort } from '../hooks/useSort';
import { WeightPanel } from '../components/WeightPanel';
import { useScoring } from '../context/ScoringProvider';
import type { EnrichedPlayer } from '../lib/scoring';

const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];

/** Legacy customRowKey: two-way players share an id across batting/pitching rows. */
function rowKey(p: EnrichedPlayer): string {
  return p.id + ':' + p.position;
}

/** Legacy customDetailRow (dashboard_template.html.bak:1554-1583). */
function DetailRow({ p }: { p: EnrichedPlayer }) {
  const { battingWeights, pitchingWeights, payWeight } = useScoring();
  const w = p.isBatter ? battingWeights : pitchingWeights;

  return (
    <div className="detail-inner">
      {p.breakdown.map(s => {
        const cls = s.z == null ? '' : s.contribution >= 0 ? 'good' : 'bad';
        return (
          <div className="preview-row" key={s.key}>
            <span className="preview-row-name">{s.label}</span>
            <span className="preview-row-tag">
              {fmtStatValueExt(s.type, s.value)} · z={s.z == null ? '—' : s.z.toFixed(2)} · ×{w[s.key].toFixed(1)}
            </span>
            <span className={`preview-row-val ${cls}`}>{s.z == null ? '—' : fmtSigned(s.contribution)}</span>
          </div>
        );
      })}
      <div className="detail-formula">
        Raw performance subtotal = {fmtSigned(p.rawScore)} →{' '}
        <span className={p.compPct >= 50 ? 'good' : 'bad'}>{p.compPct.toFixed(1)}th</span> percentile at {p.position}
      </div>
      {p.isPreArb ? (
        <div className="preview-row">
          <span className="preview-row-name">Pay</span>
          <span className="preview-row-tag">pre-arbitration — paid near league minimum by rule, no pay adjustment applied</span>
          <span className="preview-row-val">—</span>
        </div>
      ) : (
        <div className="preview-row">
          <span className="preview-row-name">Pay</span>
          <span className="preview-row-tag">
            {fmtMoney(p.aav)} AAV · {p.salPct!.toFixed(1)}th percentile · ×{payWeight.toFixed(1)}
          </span>
          <span className="preview-row-val bad">−{(payWeight * p.salPct!).toFixed(1)}</span>
        </div>
      )}
      <div className="detail-formula">
        {p.isPreArb ? (
          <>
            Score = performance percentile = <span className={p.score >= 0 ? 'good' : 'bad'}>{fmtSigned(p.score)}</span>
          </>
        ) : (
          <>
            Score = {p.compPct.toFixed(1)} − ({payWeight.toFixed(1)} × {p.salPct!.toFixed(1)}) ={' '}
            <span className={p.score >= 0 ? 'good' : 'bad'}>{fmtSigned(p.score)}</span>
          </>
        )}
      </div>
    </div>
  );
}

interface Row {
  p: EnrichedPlayer;
  rank: number;
}

interface CustomScoreViewProps {
  players: EnrichedPlayer[];
}

export function CustomScoreView({ players }: CustomScoreViewProps) {
  const [activePos, setActivePos] = useState('All');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { sort, toggle } = useSort({ key: 'score', dir: 'desc' });

  const toggleExpanded = (p: EnrichedPlayer) => {
    setExpanded(prev => {
      const next = new Set(prev);
      const key = rowKey(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Legacy renderCustomScore: filter by position, sort (percentile th maps to
  // compPct), then index rows for the # column.
  const rows = useMemo<Row[]>(() => {
    const filtered = players.filter(p => activePos === 'All' || p.position === activePos);
    const sorted = applySort(filtered, sort, row => {
      const k = sort.key === 'percentile' ? 'compPct' : sort.key;
      return k === 'name' ? row.name : row[k as keyof EnrichedPlayer];
    });
    return sorted.map((p, i) => ({ p, rank: i + 1 }));
  }, [players, activePos, sort]);

  const columns: Array<Column<Row>> = [
    { label: '#', num: true, render: r => r.rank },
    {
      key: 'name',
      label: 'Player',
      render: r => (
        <>
          <span className={`chevron${expanded.has(rowKey(r.p)) ? ' open' : ''}`}>▸</span>
          <div className="name-cell" style={{ display: 'inline-flex' }}>
            <span>{r.p.name}</span>
            <span className="team-tag">{r.p.team}</span>
          </div>
        </>
      ),
    },
    { key: 'position', label: 'Pos', render: r => <span className="pos-pill">{r.p.position}</span> },
    {
      key: 'score',
      label: 'Score',
      num: true,
      render: r => <span className={r.p.score >= 0 ? 'good' : 'bad'}>{fmtSigned(r.p.score)}</span>,
    },
    { key: 'percentile', label: 'Percentile', num: true, render: r => r.p.compPct.toFixed(1) },
    { label: 'Grade', render: r => r.p.grade },
  ];

  const countText = `${rows.length} shown` + (rows.length ? ' · click a player for the breakdown' : '');

  return (
    <div id="custom-view">
      <div className="custom-intro">
        <h2>Weights</h2>
        <p>
          These weights are the site's single source of truth — every score, grade, and projected salary on Home,
          Players, Rookies, Teams, and the player card is computed live from them. Each stat is measured as a{' '}
          <strong>z-score</strong> against the position average, multiplied by its weight, and summed into a raw
          performance subtotal. That subtotal is converted to a percentile within the position, then <strong>Pay</strong>{' '}
          below blends in how well-paid the player is:{' '}
          <code>Score = performance percentile − (Pay weight × salary percentile)</code>. Pre-arbitration players are
          paid near the league minimum by rule, so they skip the pay adjustment entirely and their Score is just their
          performance percentile.
        </p>
      </div>

      <WeightPanel />

      <div className="controls">
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
        emptyMessage="No players at this position."
        rowClick={r => toggleExpanded(r.p)}
        isExpanded={r => expanded.has(rowKey(r.p))}
        expandedRow={r => <DetailRow p={r.p} />}
      />
    </div>
  );
}
