#!/usr/bin/env node
/**
 * Ensures `public/fleet-reports/index.html` exists (Vite output; path is gitignored).
 * Invoked by `npm run prestart` before `npm start`, by `npm run dev`, and by `qa-with-server.mjs`
 * so a single `server.js` process can always serve `/fleet-reports/*` static assets.
 *
 * Rebuilds when hub sources are newer than the built `index.html` (avoids stale UI after CSS/TS edits).
 * Force anytime: `IH35_FORCE_FLEET_HUB_BUILD=1` or `FORCE_FLEET_HUB_BUILD=1`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public', 'fleet-reports', 'index.html');
const hub = path.join(root, 'apps', 'fleet-reports-hub');

/** Latest mtime under a directory (used to detect stale `public/fleet-reports/` after hub edits). */
function newestMtimeMs(dir, skipDirNames = new Set(['node_modules', 'dist', '.git'])) {
  let max = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (d) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (skipDirNames.has(ent.name)) continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile()) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs > max) max = st.mtimeMs;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return max;
}

function hubSourcesMaxMtime() {
  const srcDir = path.join(hub, 'src');
  let max = newestMtimeMs(srcDir);
  const extra = [
    path.join(hub, 'index.html'),
    path.join(hub, 'vite.config.ts'),
    path.join(hub, 'tsconfig.json'),
    path.join(hub, 'tsconfig.app.json'),
    path.join(hub, 'package.json'),
    path.join(hub, 'package-lock.json'),
  ];
  for (const f of extra) {
    try {
      if (fs.existsSync(f)) max = Math.max(max, fs.statSync(f).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return max;
}

let needBuild =
  process.env.IH35_FORCE_FLEET_HUB_BUILD === '1' || process.env.FORCE_FLEET_HUB_BUILD === '1';
if (!needBuild && !fs.existsSync(indexPath)) needBuild = true;
if (!needBuild && fs.existsSync(indexPath)) {
  try {
    const outMs = fs.statSync(indexPath).mtimeMs;
    const srcMs = hubSourcesMaxMtime();
    if (srcMs > outMs) needBuild = true;
  } catch {
    needBuild = true;
  }
}

if (!needBuild) {
  console.log('[ensure-fleet-reports-dist] OK (dist up to date):', indexPath);
  process.exit(0);
}

console.log(
  '[ensure-fleet-reports-dist] Building Fleet Reports Hub into public/fleet-reports/ (missing, stale sources, or force flag)…',
);
if (!fs.existsSync(path.join(hub, 'package.json'))) {
  console.error('[ensure-fleet-reports-dist] apps/fleet-reports-hub/package.json not found');
  process.exit(1);
}

const hubNodeModules = path.join(hub, 'node_modules');
if (!fs.existsSync(hubNodeModules)) {
  const sh = process.platform === 'win32';
  let r = spawnSync('npm', ['ci'], { cwd: hub, stdio: 'inherit', env: process.env, shell: sh });
  if (r.status !== 0) {
    console.warn('[ensure-fleet-reports-dist] npm ci failed in apps/fleet-reports-hub — trying npm install …');
    r = spawnSync('npm', ['install'], { cwd: hub, stdio: 'inherit', env: process.env, shell: sh });
    if (r.status !== 0) {
      console.error('[ensure-fleet-reports-dist] npm install in apps/fleet-reports-hub failed');
      process.exit(r.status ?? 1);
    }
  }
}

const build = spawnSync('npm', ['run', 'build:fleet'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  console.error('[ensure-fleet-reports-dist] npm run build:fleet failed');
  process.exit(build.status ?? 1);
}

if (!fs.existsSync(indexPath)) {
  console.error('[ensure-fleet-reports-dist] build finished but index.html still missing at', indexPath);
  process.exit(1);
}
console.log('[ensure-fleet-reports-dist] Built:', indexPath);
process.exit(0);
