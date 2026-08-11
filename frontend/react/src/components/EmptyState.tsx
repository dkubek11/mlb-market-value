/**
 * EmptyState — rendered by App when useDashboardData is in the 'empty' state
 * (e.g., no qualified players for the requested season). Mirrors the legacy
 * `.empty` styling (plan §4: "empty → explicit empty state instead of undefined crashes").
 */
interface EmptyStateProps {
  season: number;
}

export function EmptyState({ season }: EmptyStateProps) {
  return (
    <div className="page-shell">
      <main className="main-content" style={{ width: '100%' }}>
        <div className="empty" style={{ maxWidth: 560, margin: '18vh auto 0' }}>
          <p className="eyebrow" style={{ color: 'var(--ink-dim)' }}>
            {season} Season
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: '0 0 6px' }}>
            No qualified players found for the {season} season yet.
          </p>
          <p style={{ fontSize: 12.5 }}>
            This dashboard requires players with at least 150 PA (batters) or 50 IP (pitchers).
            Run the data pipeline for {season} and reload.
          </p>
        </div>
      </main>
    </div>
  );
}
