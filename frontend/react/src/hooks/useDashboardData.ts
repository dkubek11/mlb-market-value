/**
 * useDashboardData — data-loading hook with the four states required by the plan:
 *
 *   loading → LoadingSkeleton (rendered by App)
 *   error   → ErrorBanner with Retry (rendered by App)
 *   empty   → EmptyState (rendered by App)
 *   success → DashboardPayload
 *
 * Fallback chain (plan §4):
 *   1. live GET /api/dashboard?season=<year>&fetch_live_contracts=true
 *   2. if live fails and a snapshot was embedded at build time (VITE_EMBED_SNAPSHOT=1),
 *      use it and mark `fromSnapshot` so the UI can show "showing offline snapshot".
 *   3. if both fail → error state with message + retry.
 *
 * Retry bumps a counter; the effect re-runs because it depends on `attempt`.
 * StrictMode double-mount in dev is harmless (each mount has its own abort).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CURRENT_SEASON, getDashboardData, getEmbeddedSnapshot } from '../api/dashboard';
import type { DashboardPayload } from '../api/types';

export type DashboardStatus = 'loading' | 'error' | 'empty' | 'success';

export interface DashboardState {
  status: DashboardStatus;
  data: DashboardPayload | null;
  error: string | null;
  /** True when the payload came from the embedded offline snapshot (not the live API). */
  fromSnapshot: boolean;
  retry: () => void;
}

export function useDashboardData(season: number = CURRENT_SEASON): DashboardState {
  const [status, setStatus] = useState<DashboardStatus>('loading');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromSnapshot, setFromSnapshot] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountedRef = useRef(true);

  const retry = useCallback(() => {
    setStatus('loading');
    setError(null);
    setFromSnapshot(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      setError(null);
      setFromSnapshot(false);
      try {
        const payload = await getDashboardData(season);
        if (!cancelled && mountedRef.current) {
          if (payload.allPlayers.length === 0) {
            setStatus('empty');
            setData(payload);
          } else {
            setStatus('success');
            setData(payload);
          }
        }
      } catch (err) {
        // Live API failed — try the embedded offline snapshot before surfacing the error.
        const snapshot = getEmbeddedSnapshot();
        if (!cancelled && mountedRef.current) {
          if (snapshot) {
            setStatus('success');
            setData(snapshot);
            setFromSnapshot(true);
          } else {
            setStatus('error');
            setData(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [season, attempt]);

  return { status, data, error, fromSnapshot, retry };
}
