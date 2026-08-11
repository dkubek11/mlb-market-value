/**
 * DiamondField — port of the legacy `renderDiamondSvg` + `posMarker`
 * (dashboard_template.html.bak:1144-1204). Renders a team's best player per
 * position on a 640×620 field, colored by value score (good/bad) or projected
 * surplus (pre-arb accent). Markers are clickable to open the player card —
 * the legacy Teams tab delegated to the card overlay via data-pid/data-pos.
 *
 * Pure SVG (no dangerouslySetInnerHTML); colors flow through the team-agnostic
 * field CSS vars, exactly like the legacy markup.
 */
import { useMemo } from 'react';
import { fmtMoney, fmtSigned } from '../lib/format';
import type { EnrichedPlayer, EnrichedTeam } from '../lib/scoring';
import type { Rosters } from '../api/types';

/** Roughly true-to-position layout on a 0 0 640 620 field, home plate at bottom. */
const POSITION_COORDS: Record<string, { x: number; y: number }> = {
  C: { x: 320, y: 522 },
  SP: { x: 320, y: 430 },
  '1B': { x: 445, y: 428 },
  '2B': { x: 320, y: 328 },
  '3B': { x: 195, y: 428 },
  SS: { x: 258, y: 372 },
  LF: { x: 140, y: 208 },
  CF: { x: 320, y: 128 },
  RF: { x: 500, y: 208 },
  DH: { x: 566, y: 556 },
  RP: { x: 74, y: 556 },
};
const ON_FIELD = new Set(['C', 'SP', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);

function initials(name: string): string {
  const parts = name.replace(/[^\w\s.]/g, '').split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function scoreLabel(record: EnrichedPlayer | null): { text: string; cls: string } {
  if (!record) return { text: '—', cls: 'empty' };
  if (record.isPreArb) return { text: '+' + fmtMoney(record.surplus) + ' proj', cls: 'proj' };
  return { text: fmtSigned(record.score), cls: record.score >= 0 ? 'good' : 'bad' };
}

interface DiamondFieldProps {
  teamAbbr: string;
  players: EnrichedPlayer[];
  rosters: Rosters;
  onOpenPlayer: (record: EnrichedPlayer) => void;
}

export function DiamondField({ teamAbbr, players, rosters, onOpenPlayer }: DiamondFieldProps) {
  const roster = rosters[teamAbbr] || {};

  // Legacy findPlayerRecord: allPlayers.find(p => p.id === id && p.position === pos).
  const findRecord = useMemo(() => {
    const byKey = new Map<string, EnrichedPlayer>();
    players.forEach(p => byKey.set(`${p.id}:${p.position}`, p));
    return (id: number, pos: string) => byKey.get(`${id}:${pos}`) || null;
  }, [players]);

  const markers = useMemo(
    () =>
      Object.keys(POSITION_COORDS).map(pos => {
        const c = POSITION_COORDS[pos];
        const entry = roster[pos];
        const record = entry ? findRecord(entry.id, pos) : null;
        const r = 26;

        if (!record) {
          return (
            <g key={pos} className="pos-marker">
              <circle cx={c.x} cy={c.y} r={r} fill="none" stroke="var(--border)" strokeWidth={2} strokeDasharray="4 4" />
              <text x={c.x} y={c.y + 4} textAnchor="middle" className="pos-tag" fontSize={11}>
                {pos}
              </text>
              <text x={c.x} y={c.y + r + 16} textAnchor="middle" className="pos-score empty">
                no qualified player
              </text>
            </g>
          );
        }

        const score = scoreLabel(record);
        const fillHue = record.isPreArb ? 'var(--accent)' : record.score >= 0 ? 'var(--good)' : 'var(--bad)';
        const nameShort = record.name.length > 16 ? record.name.split(' ').pop() : record.name;
        return (
          <g
            key={pos}
            className="pos-marker"
            data-pid={record.id}
            data-pos={pos}
            onClick={() => onOpenPlayer(record)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenPlayer(record);
              }
            }}
          >
            <circle className="pos-avatar-ring" cx={c.x} cy={c.y} r={r} fill={fillHue} fillOpacity={0.9} />
            <text x={c.x} y={c.y + 5} textAnchor="middle" className="pos-initials">
              {initials(record.name)}
            </text>
            <text x={c.x} y={c.y - r - 8} textAnchor="middle" className="pos-tag">
              {pos}
            </text>
            <text x={c.x} y={c.y + r + 16} textAnchor="middle" className="pos-name">
              {nameShort}
            </text>
            <text x={c.x} y={c.y + r + 30} textAnchor="middle" className={`pos-score ${score.cls}`}>
              {score.text}
            </text>
          </g>
        );
      }),
    [roster, findRecord, onOpenPlayer],
  );

  return (
    <svg viewBox="0 0 640 620" className="diamond-svg" role="img" aria-label={`${teamAbbr} field diagram`}>
      <rect x="0" y="0" width="640" height="620" fill="var(--field-grass)" />
      <polygon points="320,60 560,430 320,600 80,430" fill="var(--field-infield)" />
      <line x1="320" y1="560" x2="60" y2="200" stroke="var(--field-line)" strokeWidth={2} />
      <line x1="320" y1="560" x2="580" y2="200" stroke="var(--field-line)" strokeWidth={2} />
      <polygon points="320,560 445,428 320,328 195,428" fill="none" stroke="var(--field-dirt)" strokeWidth={34} strokeLinejoin="round" />
      <circle cx="320" cy="430" r="16" fill="var(--field-dirt)" />
      <rect x="308" y="548" width="24" height="24" fill="var(--field-base)" transform="rotate(45 320 560)" />
      <rect x="433" y="416" width="20" height="20" fill="var(--field-base)" transform="rotate(45 445 428)" />
      <rect x="308" y="316" width="20" height="20" fill="var(--field-base)" transform="rotate(45 320 328)" />
      <rect x="183" y="416" width="20" height="20" fill="var(--field-base)" transform="rotate(45 195 428)" />
      {markers}
    </svg>
  );
}
