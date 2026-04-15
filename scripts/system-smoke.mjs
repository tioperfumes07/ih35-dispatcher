#!/usr/bin/env node
/**
 * Non-destructive HTTP checks against a running server (default http://127.0.0.1:3400).
 * Run: `npm start` in another terminal, then `npm run smoke`.
 * Set SMOKE_BASE=http://host:port to target another environment.
 * If `/api/qbo/sync-alerts` returns 404 while this repo’s server.js defines it, another process
 * is often still bound to that port (stale deploy) — pick a free PORT or stop the old listener.
 */
import process from 'process';

const base = String(process.env.SMOKE_BASE || `http://127.0.0.1:${process.env.PORT || 3400}`).replace(/\/$/, '');

/** Must return HTTP 2xx with a JSON body that looks healthy. */
const CRITICAL = [
  ['GET', '/api/health'],
  ['GET', '/api/qbo/status'],
  ['GET', '/api/qbo/sync-alerts'],
  ['GET', '/api/maintenance/dashboard'],
  ['GET', '/api/maintenance/records'],
  ['GET', '/api/board'],
  ['GET', '/api/maintenance/service-types']
];

/** Optional: DB reachability (fails in dev when URL points at a dead host). */
const SOFT_DB = ['GET', '/api/health/db'];

const FETCH_MS = Math.min(30000, Math.max(2000, Number(process.env.SMOKE_TIMEOUT_MS) || 8000));

async function one(method, path) {
  const url = base + path;
  const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
  const r = await fetch(url, { method, headers: { Accept: 'application/json' }, signal: ctrl });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _nonJson: text.slice(0, 120) };
  }
  const hint =
    path === '/api/health/db' && json?.configured === false
      ? '(no DATABASE_URL — expected)'
      : path === '/api/qbo/sync-alerts' && json?.counts
        ? `(alerts total ${json.counts.total ?? '—'})`
        : '';
  return { path, status: r.status, ok: r.ok, hint, jsonSnippet: summarize(json, path) };
}

function summarize(j, path) {
  if (!j || typeof j !== 'object') return String(j).slice(0, 80);
  if (path === '/api/health') return `ok=${j.ok} samsara=${j.hasSamsaraToken} qboCfg=${j.hasQboConfig}`;
  if (j.ok === false && j.error) return `error=${String(j.error).slice(0, 120)}`;
  if (j.counts) return `counts=${JSON.stringify(j.counts)}`;
  if (Array.isArray(j.vehicles)) return `vehicles=${j.vehicles.length}`;
  if (j.records && Array.isArray(j.records)) return `records=${j.records.length}`;
  if (path === '/api/maintenance/dashboard' && j.dashboard) return `dashboardRows=${j.dashboard.length}`;
  return JSON.stringify(j).slice(0, 100);
}

function dbSoftFailure(row) {
  if (row.ok) return false;
  const msg = String(row.jsonSnippet || '');
  return (
    msg.includes('DATABASE_URL is not set') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('connect ECONNREFUSED')
  );
}

let criticalFailures = 0;
let softWarnings = 0;

for (const [method, path] of CRITICAL) {
  try {
    const row = await one(method, path);
    const pass = row.ok;
    if (!pass) criticalFailures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} ${method} ${path} ${row.hint}`.trim());
    if (!pass) console.log('   ', row.jsonSnippet);
    if (!pass && path === '/api/qbo/sync-alerts' && row.status === 404) {
      console.log(
        '    Hint: 404 on this path usually means the listener on this port is not this tree’s server (restart `npm start`, or set SMOKE_BASE to the server you intend).'
      );
    }
  } catch (e) {
    criticalFailures++;
    console.log(`✗ FAIL ${method} ${path}: ${e.message || e}`);
    console.log('   Is the server running? Try: npm start');
    process.exit(1);
  }
}

for (const [method, path] of [SOFT_DB]) {
  try {
    const row = await one(method, path);
    const softOk = row.ok || dbSoftFailure(row);
    if (!softOk) softWarnings++;
    console.log(`${softOk ? '○' : '✗'} ${row.status} ${method} ${path} ${row.hint}`.trim());
    if (!softOk) console.log('   ', row.jsonSnippet);
    else if (!row.ok && dbSoftFailure(row)) console.log('   (soft — database not reachable in this environment)');
  } catch (e) {
    softWarnings++;
    console.log(`○ FAIL ${method} ${path}: ${e.message || e}`);
  }
}

console.log(
  criticalFailures
    ? `\nSmoke failed: ${criticalFailures} critical endpoint(s) did not return HTTP 2xx.`
    : softWarnings
      ? '\nSmoke completed (critical paths OK; see optional DB check above).'
      : '\nSmoke checks completed.'
);
process.exit(criticalFailures ? 1 : 0);
