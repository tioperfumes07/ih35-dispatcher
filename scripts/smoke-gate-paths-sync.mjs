#!/usr/bin/env node
/**
 * Ensures `SMOKE_GATE_API_PATHS` in `server.js` matches GET entries in `scripts/system-smoke.mjs` `CRITICAL`
 * (excluding `/api/health`, which is always auth-exempt). `CRITICAL` must list **`GET /api/health`** so smoke and this script stay aligned.
 * Parses `GET` + path pairs with single or double quotes (including mixed quotes per tuple, e.g. `['GET', "/path"]`). Parsed paths must start with **`/api/`**. Duplicates or empty gate sets exit **1**.
 * Also checks **`API_NOT_FOUND_PROBE`** and **`PDF_SMOKE_PATH`** in **`system-smoke.mjs`** match dedicated **`pathOnly === …`** auth skips in **`server.js`**, differ from each other, are **not** `/api/health`, are **not** listed in **`SMOKE_GATE_API_PATHS`**, and are **not** listed in **`CRITICAL`** (they use the bypass only). **`/api/health`** must not appear in **`SMOKE_GATE_API_PATHS`**; **`server.js`** must still exempt **`/api/health`** before session auth.
 * Invoked from **`qa-with-server.mjs`** before spawning the server, and from **`npm run qa:automated`** (**`package.json`**) before **`rule0:check`** + **`smoke`**.
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

const probeM = smokeText.match(/const API_NOT_FOUND_PROBE = ['"]([^'"]+)['"];/);
const pdfM = smokeText.match(/const PDF_SMOKE_PATH = ['"]([^'"]+)['"];/);
if (!probeM) {
  console.error('smoke-gate-paths-sync: could not find API_NOT_FOUND_PROBE in scripts/system-smoke.mjs');
  process.exit(1);
}
if (!pdfM) {
  console.error('smoke-gate-paths-sync: could not find PDF_SMOKE_PATH in scripts/system-smoke.mjs');
  process.exit(1);
}
const smokeAuthExemptPaths = [probeM[1], pdfM[1]];

const cr = smokeText.match(/const CRITICAL = \[([\s\S]*?)\];/);
if (!cr) {
  console.error('smoke-gate-paths-sync: could not find CRITICAL in scripts/system-smoke.mjs');
  process.exit(1);
}
function criticalGetPathsFromBlock(block) {
  const paths = [];
  for (const re of [
    /\[\s*'GET'\s*,\s*'([^']+)'\s*\]/g,
    /\[\s*"GET"\s*,\s*"([^"]+)"\s*\]/g,
    /\[\s*'GET'\s*,\s*"([^"]+)"\s*\]/g,
    /\[\s*"GET"\s*,\s*'([^']+)'\s*\]/g
  ]) {
    for (const m of block.matchAll(re)) paths.push(m[1]);
  }
  return paths;
}
function assertNoDuplicatePaths(label, paths) {
  const seen = new Set();
  for (const p of paths) {
    if (seen.has(p)) {
      console.error(`smoke-gate-paths-sync: duplicate ${label}: ${p}`);
      process.exit(1);
    }
    seen.add(p);
  }
}
function assertAllApiPaths(label, paths) {
  for (const p of paths) {
    if (!p.startsWith('/api/')) {
      console.error(`smoke-gate-paths-sync: ${label} must start with /api/ — got ${JSON.stringify(p)}`);
      process.exit(1);
    }
  }
}
function assertServerAuthExemptPath(serverJs, path) {
  const hit = [`pathOnly === '${path}'`, `pathOnly === "${path}"`].some((s) => serverJs.includes(s));
  if (!hit) {
    console.error(
      `smoke-gate-paths-sync: server.js must exempt ${JSON.stringify(path)} (pathOnly === … before session auth)`
    );
    process.exit(1);
  }
}
function assertServerHealthExempt(serverJs) {
  const eq =
    serverJs.includes(`pathOnly === '/api/health'`) || serverJs.includes(`pathOnly === "/api/health"`);
  const sub =
    serverJs.includes(`pathOnly.startsWith('/api/health/')`) ||
    serverJs.includes(`pathOnly.startsWith("/api/health/")`);
  if (!eq || !sub) {
    console.error(
      'smoke-gate-paths-sync: server.js must exempt /api/health (pathOnly === and startsWith(/api/health/) before session auth)'
    );
    process.exit(1);
  }
}
const criticalGet = criticalGetPathsFromBlock(cr[1]);
assertAllApiPaths('CRITICAL GET path', criticalGet);
assertNoDuplicatePaths('CRITICAL GET path', criticalGet);
if (!criticalGet.includes('/api/health')) {
  console.error(
    'smoke-gate-paths-sync: CRITICAL must include GET /api/health (auth-exempt baseline for system-smoke.mjs)'
  );
  process.exit(1);
}
for (const p of smokeAuthExemptPaths) {
  if (criticalGet.includes(p)) {
    console.error(
      `smoke-gate-paths-sync: ${JSON.stringify(p)} must not appear in CRITICAL (smoke-only auth bypass; not an IH35_SMOKE_GATE JSON probe)`
    );
    process.exit(1);
  }
}
const fromSmoke = new Set(criticalGet.filter((p) => p !== '/api/health'));

const gr = serverText.match(/const SMOKE_GATE_API_PATHS = new Set\(\[([\s\S]*?)\]\);/);
if (!gr) {
  console.error('smoke-gate-paths-sync: could not find SMOKE_GATE_API_PATHS in server.js');
  process.exit(1);
}
function smokeGatePathsFromBlock(block) {
  const paths = [];
  for (const re of [/'(\/api\/[^']+)'/g, /"(\/api\/[^"]+)"/g]) {
    for (const m of block.matchAll(re)) paths.push(m[1]);
  }
  return paths;
}
const serverGatePaths = smokeGatePathsFromBlock(gr[1]);
assertAllApiPaths('SMOKE_GATE_API_PATHS entry', serverGatePaths);
assertNoDuplicatePaths('SMOKE_GATE_API_PATHS entry', serverGatePaths);
const fromServer = new Set(serverGatePaths);

if (fromSmoke.size === 0) {
  console.error(
    'smoke-gate-paths-sync: no CRITICAL GET paths after excluding /api/health (unparsed CRITICAL or only health?)'
  );
  process.exit(1);
}
if (fromServer.size === 0) {
  console.error('smoke-gate-paths-sync: SMOKE_GATE_API_PATHS literal contains no /api paths');
  process.exit(1);
}

assertAllApiPaths('system-smoke auth-exempt probe path', smokeAuthExemptPaths);
for (const p of smokeAuthExemptPaths) {
  if (p === '/api/health') {
    console.error(
      'smoke-gate-paths-sync: API_NOT_FOUND_PROBE and PDF_SMOKE_PATH must not be /api/health (reserved for the health probe)'
    );
    process.exit(1);
  }
}
if (smokeAuthExemptPaths[0] === smokeAuthExemptPaths[1]) {
  console.error('smoke-gate-paths-sync: API_NOT_FOUND_PROBE and PDF_SMOKE_PATH must differ');
  process.exit(1);
}
for (const p of smokeAuthExemptPaths) {
  if (fromServer.has(p)) {
    console.error(
      `smoke-gate-paths-sync: ${JSON.stringify(p)} must not be in SMOKE_GATE_API_PATHS (use the dedicated pathOnly === bypass)`
    );
    process.exit(1);
  }
}
for (const p of smokeAuthExemptPaths) assertServerAuthExemptPath(serverText, p);

if (fromServer.has('/api/health')) {
  console.error(
    'smoke-gate-paths-sync: /api/health must not be in SMOKE_GATE_API_PATHS (always auth-exempt before the smoke gate)'
  );
  process.exit(1);
}
assertServerHealthExempt(serverText);

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
