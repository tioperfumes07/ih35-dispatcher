#!/usr/bin/env node
/**
 * Ensures `SMOKE_GATE_API_PATHS` in `server.js` matches GET entries in `scripts/system-smoke.mjs` `CRITICAL`
 * (excluding `/api/health`, which is always auth-exempt). Invoked from **`qa-with-server.mjs`** before spawning the server, and from **`npm run qa:automated`** (**`package.json`**) before **`rule0:check`** + **`smoke`**.
 *
 * Run: `npm run smoke:gate-sync`
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const smokeText = fs.readFileSync(path.join(root, 'scripts/system-smoke.mjs'), 'utf8');
const serverText = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const cr = smokeText.match(/const CRITICAL = \[([\s\S]*?)\];/);
if (!cr) {
  console.error('smoke-gate-paths-sync: could not find CRITICAL in scripts/system-smoke.mjs');
  process.exit(1);
}
const criticalGet = [...cr[1].matchAll(/\[\s*'GET'\s*,\s*'([^']+)'\s*\]/g)].map((m) => m[1]);
const fromSmoke = new Set(criticalGet.filter((p) => p !== '/api/health'));

const gr = serverText.match(/const SMOKE_GATE_API_PATHS = new Set\(\[([\s\S]*?)\]\);/);
if (!gr) {
  console.error('smoke-gate-paths-sync: could not find SMOKE_GATE_API_PATHS in server.js');
  process.exit(1);
}
const fromServer = new Set([...gr[1].matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]));

let ok = true;
for (const p of fromSmoke) {
  if (!fromServer.has(p)) {
    console.error(
      `smoke-gate-paths-sync: system-smoke CRITICAL GET ${p} is not in server.js SMOKE_GATE_API_PATHS (IH35_SMOKE_GATE would 401)`
    );
    ok = false;
  }
}
for (const p of fromServer) {
  if (!fromSmoke.has(p)) {
    console.error(
      `smoke-gate-paths-sync: server.js SMOKE_GATE_API_PATHS has ${p} but system-smoke CRITICAL has no matching GET`
    );
    ok = false;
  }
}
if (!ok) process.exit(1);
const quiet = process.env.SMOKE_GATE_SYNC_QUIET === '1' || process.env.CI === 'true';
if (!quiet) console.log(`smoke-gate-paths-sync: OK (${fromSmoke.size} paths, IH35_SMOKE_GATE)`);
process.exit(0);
