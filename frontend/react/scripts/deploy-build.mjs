// Copies dist/index.html (the single-file React build) onto the file the
// backend serves at / : frontend/dashboard/dashboard_template.html.
//
// Atomicity: write to a temp file then rename, so FileResponse (which reads
// the file per request) never observes a half-written file.
//
// Backup: on the FIRST deploy, back up the current template to
// dashboard_template.html.bak for one-command rollback. Never overwrite an
// existing .bak (a known-good backup must survive bad builds).
import { copyFileSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_HTML = path.resolve(__dirname, '../dist/index.html');
const TARGET = path.resolve(__dirname, '../../dashboard/dashboard_template.html');
const BACKUP = path.resolve(__dirname, '../../dashboard/dashboard_template.html.bak');

if (!existsSync(DIST_HTML)) {
  console.error(`FATAL: ${DIST_HTML} does not exist — run vite build first.`);
  process.exit(1);
}

const html = readFileSync(DIST_HTML, 'utf8');

// Threat-model guard: the served file must be fully self-contained.
// Any relative/absolute asset reference would 404 beside the template.
const badRefs = [...html.matchAll(/(?:src|href)="(?!data:)([^"]+)"/g)].map((m) => m[1]);
if (badRefs.length) {
  console.error(`FATAL: built HTML references non-inlined assets (would 404): ${badRefs.join(', ')}`);
  process.exit(1);
}
if (/\/assets\//.test(html)) {
  console.error('FATAL: built HTML contains /assets/ references (singlefile inlining failed).');
  process.exit(1);
}
// Internal-path leak guard: no repo-root or container paths in the bundle.
const leaked = [...new Set((html.match(/(?:\/app\/|frontend\/react|backend\/|home\/[a-z0-9_]+)/g) || []))];
if (leaked.length) {
  console.error(`FATAL: built HTML leaks internal paths: ${leaked.join(', ')}`);
  process.exit(1);
}

if (!existsSync(BACKUP)) {
  copyFileSync(TARGET, BACKUP);
  console.log(`backed up existing template -> ${path.relative(process.cwd(), BACKUP)}`);
}

const tmp = `${TARGET}.tmp-${process.pid}`;
writeFileSync(tmp, html);
renameSync(tmp, TARGET);
console.log(`deployed single-file React build -> ${path.relative(process.cwd(), TARGET)} (${html.length} bytes)`);
