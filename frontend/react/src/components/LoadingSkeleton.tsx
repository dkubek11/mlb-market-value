/**
 * LoadingSkeleton — mirrors the page layout so / never shows a blank page
 * (plan §4: "loading → LoadingSkeleton instead of today's blank page").
 * Uses plain CSS surfaces (no shimmer animation, matching the static legacy look).
 */
export function LoadingSkeleton() {
  return (
    <div className="page-shell" aria-busy="true" aria-label="Loading dashboard data">
      <aside className="sidebar" aria-hidden="true">
        <div className="sidebar-brand">
          <div style={{ height: 14, width: 150, background: 'var(--surface-2)', borderRadius: 4 }} />
        </div>
        <nav className="sidebar-nav">
          {['Home', 'Players', 'Rookies', 'Teams', 'Weights'].map((label) => (
            <div
              key={label}
              style={{
                height: 38,
                marginBottom: 4,
                borderRadius: '0 6px 6px 0',
                background: 'var(--surface-2)',
                opacity: 0.5,
              }}
            />
          ))}
        </nav>
      </aside>
      <main className="main-content" style={{ width: '100%' }}>
        <div className="hero-center" style={{ marginTop: 0, minHeight: 'auto' }}>
          <div
            style={{
              height: 64,
              width: 'min(480px, 80%)',
              margin: '0 auto 18px',
              background: 'var(--surface-2)',
              borderRadius: 8,
            }}
          />
          <div
            style={{
              height: 16,
              width: 'min(560px, 90%)',
              margin: '0 auto',
              background: 'var(--surface-2)',
              borderRadius: 4,
              opacity: 0.7,
            }}
          />
        </div>
        <div className="league-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{ height: 168, background: 'var(--surface-2)', borderRadius: 8, opacity: 0.5 }}
            />
          ))}
        </div>
        <div
          style={{
            height: 44,
            marginBottom: 12,
            background: 'var(--surface-2)',
            borderRadius: 7,
            opacity: 0.5,
          }}
        />
        <div
          style={{
            height: 220,
            background: 'var(--surface-2)',
            borderRadius: 7,
            opacity: 0.35,
          }}
        />
      </main>
    </div>
  );
}
