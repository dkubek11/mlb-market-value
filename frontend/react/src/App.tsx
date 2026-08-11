/**
 * App — top-level state machine over useDashboardData:
 *   loading → LoadingSkeleton
 *   error   → ErrorBanner (with working Retry)
 *   empty   → EmptyState
 *   success → AppShell (sidebar + active tab view)
 *
 * No localStorage, no router, no URL-param reading — parity with the legacy app.
 */
import { CURRENT_SEASON } from './api/dashboard';
import { useDashboardData } from './hooks/useDashboardData';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { ErrorBanner } from './components/ErrorBanner';
import { EmptyState } from './components/EmptyState';
import { AppShell } from './components/AppShell';
import { ScoringProvider } from './context/ScoringProvider';

export default function App() {
  const { status, data, error, fromSnapshot, retry } = useDashboardData(CURRENT_SEASON);
  const season = CURRENT_SEASON;

  if (status === 'loading') {
    return <LoadingSkeleton />;
  }
  if (status === 'error') {
    return <ErrorBanner message={error ?? 'Unknown error'} onRetry={retry} />;
  }
  if (status === 'empty') {
    return <EmptyState season={season} />;
  }
  // success — data is non-null here; AppShell renders the sidebar + active tab.
  // ScoringProvider wraps the shell so every view (Stages 3-5) reads the same
  // enriched players/teams and the same live weight sliders.
  return (
    <ScoringProvider payload={data!}>
      <AppShell data={data!} season={season} fromSnapshot={fromSnapshot} />
    </ScoringProvider>
  );
}
