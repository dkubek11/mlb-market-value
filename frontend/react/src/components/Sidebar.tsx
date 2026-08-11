/**
 * Sidebar — port of the legacy <aside class="sidebar"> (dashboard_template.html.bak:446-476).
 * Nav SVGs are copied verbatim from the legacy markup. The snapshot note mirrors the
 * exact string built at legacy line 688-689.
 */
import type { DashboardPayload } from '../api/types';

export type TabKey = 'home' | 'players' | 'rookies' | 'teams' | 'custom';

export const TABS: Array<{ key: TabKey; label: string; svg: JSX.Element }> = [
  {
    key: 'home',
    label: 'Home',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    key: 'players',
    label: 'Players',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M12 20V4M20 20v-7" />
      </svg>
    ),
  },
  {
    key: 'rookies',
    label: 'Rookies',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M15 7h6v6" />
      </svg>
    ),
  },
  {
    key: 'teams',
    label: 'Teams',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M12 3l9 9-9 9-9-9z" />
      </svg>
    ),
  },
  {
    key: 'custom',
    label: 'Weights',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21v-7M4 10V3M12 21v-11M12 6V3M20 21v-5M20 12V3" />
        <path d="M1 14h6M9 10h6M17 16h6" />
      </svg>
    ),
  },
];

interface SidebarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  data: DashboardPayload;
  season: number;
  fromSnapshot: boolean;
}

/** Exact snapshot-note string from the legacy template (dashboard_template.html.bak:688-689). */
export function snapshotNote(data: DashboardPayload, season: number): string {
  const marketCount = data.allPlayers.filter((p) => !p.isPreArb).length;
  const preArbCount = data.allPlayers.filter((p) => p.isPreArb).length;
  return `Snapshot of ${season} season data · ${marketCount} market-priced players + ${preArbCount} pre-arb/MiLB prospects (min. 150 PA / 50 IP) across ${data.teams.length} teams · captured ${data.capturedAt}`;
}

export function Sidebar({ activeTab, onTabChange, data, season, fromSnapshot }: SidebarProps) {
  const note = snapshotNote(data, season);
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <p className="eyebrow">MLB Market Value</p>
      </div>
      <nav className="sidebar-nav">
        {TABS.map(({ key, label, svg }) => (
          <button
            key={key}
            type="button"
            className={`nav-item${activeTab === key ? ' active' : ''}`}
            aria-current={activeTab === key ? 'page' : undefined}
            onClick={() => onTabChange(key)}
          >
            {svg}
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <p className="snapshot-note">
          {note}
          {fromSnapshot ? ' (showing embedded offline snapshot)' : ''}
        </p>
      </div>
    </aside>
  );
}
