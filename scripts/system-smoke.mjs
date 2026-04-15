#!/usr/bin/env node
/**
 * Non-destructive HTTP checks against a running server (default http://127.0.0.1:3400).
 * Run: `npm start` in another terminal, then `npm run smoke`.
 * Set SMOKE_BASE=http://host:port to target another environment.
 */
import process from 'process';

const base = String(process.env.SMOKE_BASE || `http://127.0.0.1:${process.env.PORT || 3400}`).replace(/\/$/, '');

const paths = [
  ['GET', '/api/health'],
  ['GET', '/api/health/db'],
  ['GET', '/api/qbo/status'],
  ['GET', '/api/qbo/sync-alerts'],
  ['GET', '/api/maintenance/dashboard'],
  ['GET', '/api/maintenance/records'],
  ['GET', '/api/board'],
  ['GET', '/api/maintenance/service-types']
];

async function one(method, path) {
  const url = base + path;
  const r = await fetch(url, { method, headers: { Accept: 'application/json' } });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _nonJson: text.slice(0, 120) };
  }
  const ok = r.ok;
  const hint =
    path === '/api/health/db' && json?.configured === false
      ? '(expected without DATABASE_URL)'
      : path === '/api/qbo/sync-alerts' && json?.counts
        ? `(alerts total ${json.counts.total ?? '—'})`
        : '';
  return { path, status: r.status, ok, hint, jsonSnippet: summarize(json, path) };
}

function summarize(j, path) {
  if (!j || typeof j !== 'object') return String(j).slice(0, 80);
  if (path === '/api/health') return `ok=${j.ok} samsara=${j.hasSamsaraToken} qboCfg=${j.hasQboConfig}`;
  if (j.ok === false && j.error) return `error=${String(j.error).slice(0, 80)}`;
  if (j.counts) return `counts=${JSON.stringify(j.counts)}`;
  if (Array.isArray(j.vehicles)) return `vehicles=${j.vehicles.length}`;
  if (j.records && Array.isArray(j.records)) return `records=${j.records.length}`;
  if (path === '/api/maintenance/dashboard' && j.dashboard) return `dashboardRows=${j.dashboard.length}`;
  return JSON.stringify(j).slice(0, 100);
}

let failures = 0;
for (const [method, path] of paths) {
  try {
    const row = await one(method, path);
    const pass = row.status < 500;
    if (!pass) failures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} ${method} ${path} ${row.hint}`.trim());
    if (!pass) console.log('   ', row.jsonSnippet);
  } catch (e) {
    failures++;
    console.log(`✗ FAIL ${method} ${path}: ${e.message || e}`);
    console.log('   Is the server running? Try: npm start');
    process.exit(1);
  }
}

console.log(failures ? `\nSmoke finished with ${failures} server error(s).` : '\nSmoke checks completed.');
process.exit(failures ? 1 : 0);
