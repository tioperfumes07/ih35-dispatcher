#!/usr/bin/env node
/**
 * Ensures `public/fleet-reports/index.html` exists (Vite output; path is gitignored).
 * Invoked by `npm run prestart` before `npm start`, by `npm run dev`, and by `qa-with-server.mjs`
 * so a single `server.js` process can always serve `/fleet-reports/*` static assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'fleet-reports', 'index.html');

if (fs.existsSync(indexPath)) {
  console.log('[ensure-fleet-reports-dist] OK:', indexPath);
  process.exit(0);
}

console.log('[ensure-fleet-reports-dist] Missing — building Fleet Reports Hub into public/fleet-reports/ …');
const hub = path.join(root, 'apps', 'fleet-reports-hub');
if (!fs.existsSync(path.join(hub, 'package.json'))) {
  console.error('[ensure-fleet-reports-dist] apps/fleet-reports-hub/package.json not found');
  process.exit(1);
}

const shell = process.platform === 'win32';
let r = spawnSync('npm', ['ci'], { cwd: hub, stdio: 'inherit', env: process.env, shell });
if (r.status !== 0) {
  console.warn('[ensure-fleet-reports-dist] npm ci failed in apps/fleet-reports-hub — trying npm install …');
  r = spawnSync('npm', ['install'], { cwd: hub, stdio: 'inherit', env: process.env, shell });
  if (r.status !== 0) {
    console.error('[ensure-fleet-reports-dist] npm install in apps/fleet-reports-hub failed');
    process.exit(r.status ?? 1);
  }
}

r = spawnSync('npm', ['run', 'build:fleet'], { cwd: root, stdio: 'inherit', env: process.env, shell });
if (r.status !== 0) {
  console.error('[ensure-fleet-reports-dist] npm run build:fleet failed');
  process.exit(r.status ?? 1);
}

if (!fs.existsSync(indexPath)) {
  console.error('[ensure-fleet-reports-dist] build finished but index.html still missing at', indexPath);
  process.exit(1);
}
console.log('[ensure-fleet-reports-dist] Built:', indexPath);
process.exit(0);
