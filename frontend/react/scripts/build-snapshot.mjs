// Opt-in offline-snapshot embed (the React analogue of splice_dashboard.py).
// Only runs when VITE_EMBED_SNAPSHOT=1. Fetches the live payload from a
// running backend and emits src/snapshot.json, which the build inlines as
// window.__DASHBOARD_DATA__. Off by default so builds never depend on the
// backend being up.
//
//   VITE_EMBED_SNAPSHOT=1 npm run snapshot   # fetches payload -> src/snapshot.json
//   VITE_EMBED_SNAPSHOT=1 npm run build      # inlines the snapshot
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../src');
const OUT = path.join(SRC_DIR, 'snapshot.json');

const apiBase = process.env.VITE_API_BASE || 'http://localhost:8000';
const season = process.env.VITE_SNAPSHOT_SEASON || String(new Date().getFullYear());
const url = `${apiBase}/api/dashboard?season=${season}&fetch_live_contracts=true`;

console.log(`fetching snapshot from ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`snapshot fetch failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const payload = await res.json();

mkdirSync(SRC_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
console.log(`snapshot written -> ${path.relative(process.cwd(), OUT)} (${payload.allPlayers?.length ?? 0} players, ${payload.teams?.length ?? 0} teams)`);
