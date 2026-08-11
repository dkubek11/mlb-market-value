// Decodes the legacy base64 font/texture files (from frontend/dashboard/*.b64)
// into real asset files under src/assets/. Run once (`npm run assets`); the
// decoded files are committed so builds never depend on the .b64 sources.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ASSETS = path.resolve(__dirname, '../src/assets');
const LEGACY_DIR = path.resolve(__dirname, '../../dashboard');

const ASSETS = [
  { src: 'rye.b64', out: 'rye.woff2', type: 'font/woff2' },
  { src: 'courier-regular.b64', out: 'courier-regular.woff2', type: 'font/woff2' },
  { src: 'courier-bold.b64', out: 'courier-bold.woff2', type: 'font/woff2' },
  { src: 'noise.b64', out: 'noise.svg', type: 'image/svg+xml' },
];

mkdirSync(SRC_ASSETS, { recursive: true });

for (const a of ASSETS) {
  const srcPath = path.join(LEGACY_DIR, a.src);
  let b64 = readFileSync(srcPath, 'utf8').trim();
  // The legacy files are plain base64 of the raw bytes.
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(path.join(SRC_ASSETS, a.out), buf);
  console.log(`decoded ${a.src} -> src/assets/${a.out} (${buf.length} bytes)`);
}

console.log('done — assets written to src/assets/');
