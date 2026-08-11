/**
 * /api/dashboard client — the exact call the legacy template made at page load,
 * plus the offline-snapshot fallback (the React analogue of the spliced
 * __DATA_JSON__ path).
 *
 * URL/params parity (backend/app/main.py:59):
 *   GET /api/dashboard?season=<currentYear>&fetch_live_contracts=true
 * `fetch_live_contracts=true` is explicit and matches the backend default (True);
 * we never set it to false from the client (plan §4).
 */
import { fetchJson, validateDashboardPayload } from './client';
import type { DashboardPayload } from './types';

/** Opt-in build-time embedded snapshot (scripts/build-snapshot.mjs with VITE_EMBED_SNAPSHOT=1). */
declare global {
  interface Window {
    __DASHBOARD_DATA__?: DashboardPayload;
  }
}

export const CURRENT_SEASON = new Date().getFullYear();

export function dashboardUrl(season: number): string {
  return `/api/dashboard?season=${season}&fetch_live_contracts=true`;
}

/** Live fetch of the full dashboard payload. Throws on HTTP/network/schema failure. */
export async function getDashboardData(season: number): Promise<DashboardPayload> {
  const raw = await fetchJson<unknown>(dashboardUrl(season));
  return validateDashboardPayload(raw);
}

/**
 * Offline fallback used when the live API fails: uses the snapshot embedded at
 * build time (VITE_EMBED_SNAPSHOT=1) if present. Returns null when no snapshot
 * was embedded — callers surface the error banner in that case.
 */
export function getEmbeddedSnapshot(): DashboardPayload | null {
  const snap = window.__DASHBOARD_DATA__;
  if (!snap) return null;
  try {
    return validateDashboardPayload(snap);
  } catch {
    console.error('Embedded dashboard snapshot failed validation; ignoring it.');
    return null;
  }
}
