/**
 * PlayerCard — modal port of the legacy baseball card (dashboard_template.html.bak:714-945).
 *
 * Renders the team-gradient head with avatar initials + grade badge, the
 * regression line, the contract section, the value box (score bar for market
 * players / projected arbitration value for pre-arb), and the stat-vs-position-
 * average grid. All numbers flow through fmtStatValue/fmtMoney/fmtDelta so null
 * renders as '—' and NaN never leaks; contract fields degrade gracefully when
 * the payload's `contracts` is {} (FanGraphs 403 / fetch_live_contracts=false).
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { fmtMoney, fmtSigned, fmtStatValue, fmtDelta, valueBarStyle, regressionArrow } from '../lib/format';
import { gradeFor } from '../lib/scoring';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';
import type { Contracts, ContractYear } from '../api/types';

/** Legacy card stat sets (dashboard_template.html.bak:715-741). */
const BATTER_STATS: Array<{ key: string; label: string; type: string; higherBetter: boolean }> = [
  { key: 'ba', label: 'AVG', type: 'avg3', higherBetter: true },
  { key: 'obp', label: 'OBP', type: 'avg3', higherBetter: true },
  { key: 'slg', label: 'SLG', type: 'avg3', higherBetter: true },
  { key: 'xwoba', label: 'xwOBA', type: 'avg3', higherBetter: true },
  { key: 'hr', label: 'HR', type: 'int', higherBetter: true },
  { key: 'rbi', label: 'RBI', type: 'int', higherBetter: true },
  { key: 'sb', label: 'SB', type: 'int', higherBetter: true },
  { key: 'barrel_rate', label: 'Barrel%', type: 'pct1', higherBetter: true },
  { key: 'hard_hit_rate', label: 'Hard-Hit%', type: 'pct1', higherBetter: true },
  { key: 'sprint_speed', label: 'Sprint Spd', type: 'velo1', higherBetter: true },
];
const PITCHER_STATS: Array<{ key: string; label: string; type: string; higherBetter: boolean }> = [
  { key: 'era', label: 'ERA', type: 'rate2', higherBetter: false },
  { key: 'whip', label: 'WHIP', type: 'rate2', higherBetter: false },
  { key: 'fip', label: 'FIP', type: 'rate2', higherBetter: false },
  { key: 'xera', label: 'xERA', type: 'rate2', higherBetter: false },
  { key: 'k_9', label: 'K/9', type: 'rate2', higherBetter: true },
  { key: 'bb_9', label: 'BB/9', type: 'rate2', higherBetter: false },
  { key: 'hard_hit_rate_against', label: 'Hard-Hit% Allowed', type: 'pct1', higherBetter: false },
  { key: 'barrel_rate_against', label: 'Barrel% Allowed', type: 'pct1', higherBetter: false },
];
const FIELDING_STATS: Array<{ key: string; label: string; type: string; higherBetter: boolean }> = [
  { key: 'oaa', label: 'OAA', type: 'int', higherBetter: true },
  { key: 'frv', label: 'FRV', type: 'int', higherBetter: true },
  { key: 'drs', label: 'DRS', type: 'int', higherBetter: true },
];

/** Legacy initials (dashboard_template.html.bak:1153-1157). */
function initials(name: string): string {
  const parts = name.replace(/[^\w\s.]/g, '').split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface StatCellProps {
  stat: { key: string; label: string; type: string; higherBetter: boolean };
  record: EnrichedPlayer;
  positionStats: Record<string, { mean: number; std: number } | null> | undefined;
}

function StatCell({ stat, record, positionStats }: StatCellProps) {
  const val = record.stats[stat.key];
  if (val == null) return null;
  const avgEntry = positionStats ? positionStats[stat.key] : null;
  const avg = avgEntry ? avgEntry.mean : null;
  let delta = null;
  if (avg != null) {
    const d = val - avg;
    const isGood = stat.higherBetter ? d >= 0 : d <= 0;
    delta = (
      <div className={`card-stat-delta ${isGood ? 'good' : 'bad'}`}>
        {fmtDelta(stat.type, d)} vs {record.position} avg
      </div>
    );
  }
  return (
    <div className="card-stat">
      <div className="card-stat-label">{stat.label}</div>
      <div className="card-stat-value">{fmtStatValue(stat.type, val)}</div>
      {delta}
    </div>
  );
}

interface ContractSectionProps {
  record: EnrichedPlayer;
  contracts: Contracts;
  season: number;
}

function ContractSection({ record, contracts, season }: ContractSectionProps) {
  const contract = contracts[record.id];
  const badge = (
    <span className="card-contract-type">{(contract && contract.contractType) || record.contractType || 'Unknown'}</span>
  );

  const realYears = contract ? contract.years.filter(y => y.salary != null) : [];
  if (!contract || realYears.length <= 1) {
    // Graceful: contract data unavailable (contracts={}) -> badge + salary line.
    return (
      <div className="card-contract-line">
        {badge}
        <span className="card-contract-total">{fmtMoney(record.salary)} in {season}</span>
      </div>
    );
  }

  const totalLine = contract.totalGuaranteed
    ? `${fmtMoney(contract.totalGuaranteed)} guaranteed · ${contract.startSeason}–${contract.endSeasonAll}`
    : `${realYears.length}-year deal`;

  return (
    <div className="card-contract-box">
      <div className="card-contract-head">
        {badge}
        <span className="card-contract-total">{totalLine}</span>
      </div>
      <div className="card-contract-years">
        {contract.years.map((y: ContractYear) => {
          const isCurrent = y.season === season;
          const salaryText = y.salary != null ? fmtMoney(y.salary) : y.type ? y.type.replace(/_/g, ' ').toLowerCase() : '—';
          return (
            <div key={y.season} className={`contract-year-row${isCurrent ? ' current' : ''}`} data-current={isCurrent ? '1' : undefined}>
              <span className="contract-year">{y.season}</span>
              <span className="contract-year-salary">{salaryText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlayerCardProps {
  record: EnrichedPlayer;
  teams: EnrichedTeam[];
  contracts: Contracts;
  teamColors: Record<string, [string, string]>;
  positionStats: Record<string, Record<string, { mean: number; std: number } | null>>;
  season: number;
  onClose: () => void;
}

/** Legacy valueBar: centered bar scaled by maxAbs (default 100), plus the signed value. */
function ScoreBar({ value, maxAbs = 100 }: { value: number; maxAbs?: number }) {
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

export function PlayerCard({ record, teams, contracts, teamColors, positionStats, season, onClose }: PlayerCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const teamName = useMemo(() => {
    const t = teams.find(t => t.abbr === record.team);
    return t ? t.name : record.team;
  }, [teams, record.team]);

  // Team brand colors come from the payload's teamColors map (keyed by abbr),
  // with the legacy default when a team has no entry.
  const colors = useMemo(() => {
    const c = teamColors[record.team];
    return c || ['#3a4a42', '#1a231e'];
  }, [teamColors, record.team]);

  const grade = gradeFor(record.compPct);
  const statSet = record.isBatter ? BATTER_STATS : PITCHER_STATS;
  const arrow = regressionArrow(record);

  const hasFielding = record.isBatter && FIELDING_STATS.some(s => record.stats[s.key] != null);

  // Legacy behavior: scroll the current contract year into view when opened.
  useEffect(() => {
    if (cardRef.current) {
      const current = cardRef.current.querySelector('[data-current="1"]');
      if (current) current.scrollIntoView({ block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card-overlay" role="dialog" aria-modal="true" aria-label={`${record.name} card`}>
      <div className="card-overlay-bg" onClick={onClose} />
      <div className="baseball-card" ref={cardRef} style={{ '--team-1': colors[0], '--team-2': colors[1] } as CSSProperties}>
        <button className="card-close" type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="card-head">
          <div className="card-head-top">
            <span>{record.team}</span>
            <span>{season}</span>
          </div>
          <div className="card-avatar-wrap">
            <div className="card-avatar">{initials(record.name)}</div>
            <div className="card-grade-badge">{grade}</div>
          </div>
        </div>
        <div className="card-body">
          <h2 className="card-name">{record.name}</h2>
          <div className="card-subline">
            {record.position} · {teamName}
          </div>

          {arrow ? (
            <div className={`regression-line ${arrow.cls}`}>
              <span className="regression-arrow">{arrow.symbol}</span>{' '}
              {fmtStatValue(arrow.sig.type, arrow.sig.actual)} {arrow.sig.label} vs.{' '}
              {fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected (
              {arrow.cls === 'bad' ? 'overperforming, regression likely' : 'underperforming, positive regression likely'}
              )
              {record.nComps ? ` · ${record.nComps} historical comps` : ''}
            </div>
          ) : null}

          <ContractSection record={record} contracts={contracts} season={season} />

          {!record.isPreArb ? (
            <div className="card-value-box">
              <div className="card-stat-label">Score</div>
              <ScoreBar value={record.score} />
              <div className="card-value-note">
                {record.compPct.toFixed(1)}th percentile performance, paid at the {record.salPct!.toFixed(1)}th percentile for {record.position}
              </div>
              {record.recommendedSalary != null ? (
                <div className="card-value-note">
                  Recommended pay: <strong>{fmtMoney(record.recommendedSalary)}</strong> vs. actual {fmtMoney(record.aav)} AAV (
                  {fmtSigned(record.paySurplus! / 1e6)}M)
                </div>
              ) : null}
            </div>
          ) : record.projectedSalary != null ? (
            <div className="card-value-box">
              <div className="card-stat-label">Projected Arbitration Value</div>
              <div className="card-projected">{fmtMoney(record.projectedSalary)}</div>
            </div>
          ) : null}

          <div className="card-section-title">
            {record.isBatter ? 'Hitting' : 'Pitching'} vs. {record.position} average
          </div>
          <div className="card-stats-grid">
            {statSet.map(s => (
              <StatCell key={s.key} stat={s} record={record} positionStats={positionStats[record.position]} />
            ))}
          </div>

          {hasFielding ? (
            <>
              <div className="card-section-title">Fielding vs. {record.position} average</div>
              <div className="card-stats-grid card-stats-grid-3">
                {FIELDING_STATS.map(s => (
                  <StatCell key={s.key} stat={s} record={record} positionStats={positionStats[record.position]} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
