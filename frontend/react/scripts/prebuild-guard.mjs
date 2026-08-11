// Fails the build early if dist/index.html is missing but a previous build
// exists, so `docker compose up -d --build` (which COPYs frontend/dashboard at
// build time) never ships a stale template silently.
//
// First-ever build is allowed (dist/ doesn't exist yet — nothing to go stale);
// subsequent builds require dist/index.html, which vite build recreates, so in
// practice the guard only trips when dist/ was deleted or the build is being
// run from a clean checkout without a prior build artifact.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

if (existsSync(DIST_DIR)) {
  if (!existsSync(DIST_HTML) || statSync(DIST_HTML).size === 0) {
    console.error(
      'prebuild guard: dist/ exists but index.html is missing or empty.\n' +
      'Run `npm run build` BEFORE `docker compose up -d --build` so the image ships the React dashboard.\n' +
      '(The api container serves frontend/dashboard/dashboard_template.html, which the build overwrites.)'
    );
    process.exit(1);
  }
  console.log('prebuild guard: dist/index.html present');
} else {
  console.log('prebuild guard: first build (no dist/ yet) — allowing');
}
