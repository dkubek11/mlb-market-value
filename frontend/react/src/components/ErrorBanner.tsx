/**
 * ErrorBanner — rendered by App when useDashboardData is in the 'error' state.
 * Never a white screen: the message plus a working Retry (plan §4).
 */
interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="page-shell">
      <main className="main-content" style={{ width: '100%' }}>
        <div
          className="method"
          style={{
            borderColor: 'var(--bad)',
            background: 'var(--bad-soft)',
            color: 'var(--ink)',
            maxWidth: 640,
            margin: '20vh auto 0',
            textAlign: 'center',
          }}
        >
          <p className="eyebrow" style={{ color: 'var(--bad)' }}>
            Data unavailable
          </p>
          <p style={{ margin: '0 0 14px', lineHeight: 1.6 }}>
            Could not load dashboard data from the API.
            <br />
            <span style={{ color: 'var(--ink-dim)', fontSize: 12.5 }}>{message}</span>
          </p>
          <button
            type="button"
            className="chip active"
            style={{ fontSize: 13, padding: '8px 18px' }}
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      </main>
    </div>
  );
}
