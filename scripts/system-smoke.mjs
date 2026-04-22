#!/usr/bin/env node
/**
 * Non-destructive HTTP checks against a running server (default http://localhost:3400).
 * Run: start the server, then `npm run smoke`. For **Rule 0 guard + smoke** in one step: `npm run qa:automated` (**`smoke:gate-sync`** + **`rule0:check`** + this script; requires server up) or `npm run qa:isolated` (**`scripts/smoke-gate-paths-sync.mjs`** first, then a temp **`server.js`** on a free port with **`IH35_SMOKE_GATE=1`** from **`qa-with-server.mjs`**, then **`rule0:check`** + this script + **`test:name-mgmt`** + **`test:fleet-mileage`**).
 * Also GETs key static HTML pages (hub, maintenance, dispatch, fuel, banking, settings, tracking redirect) and checks for stable substring(s),
 * plus static CSS/JS (design-tokens, app-theme, erp-master-redesign, erp-master-spec-2026, maint-accounting, board-nav.css, erp-ui.js, board-nav.js) for HTTP 200 + stable header needles.
 * After static needles, **`app-theme.css`**, **`maint-accounting-ui-2026.css`**, and **`maintenance.html`** are scanned for forbidden legacy **`var(--color-*, …)`** substrings (Agent B Rule 0 regression guard). Bodies are reused from earlier successful GETs (**`STATIC_TEXT`** for CSS, HTML needles for **`/maintenance.html`**) so the guard avoids duplicate fetches when those steps pass.
 * **`GET /api/__smoke_not_found__`** (auth-exempt in **`server.js`**) must return **404** with **`Content-Type`** including **`application/json`** and body **`{ error: 'Not found', path: '...' }`** so XHR clients never see HTML for unknown API paths.
 * **`GET /api/pdf/__smoke__`** (auth-exempt in **`server.js`**) must return **200** with **`Content-Type`** including **`application/pdf`** and a body starting with **`%PDF`** — exercises **`pdfkit`** even when ERP login is required.
 * Set SMOKE_BASE=http://host:port to target another environment. Set SMOKE_QUIET=1 to omit the trailing “Smoke target” line on success (also set automatically for smoke when CI=true via qa-with-server.mjs).
 * Set SMOKE_TIMEOUT_MS for per-fetch AbortSignal timeout (default **10000** ms, clamped **2000–30000**); **.github/workflows/rule0-check.yml** sets **15000** for CI.
 * If `/api/qbo/sync-alerts` returns 404 while this repo’s server.js defines it, another process
 * is often still bound to that port (stale deploy) — pick a free PORT or stop the old listener.
 * On critical failure, the script prints a one-line hint to run **`npm run qa:isolated`** ( **`smoke-gate-paths-sync`**, temp **`server.js`**, **`rule0:check`**, this script, then unit tests).
 */
import process from 'process';
import { ruleZeroForbiddenHits } from './rule-zero-agent-b.mjs';

const base = String(process.env.SMOKE_BASE || `http://localhost:${process.env.PORT || 3400}`).replace(/\/$/, '');

/** Must return HTTP 2xx with a JSON body that looks healthy. Keep paths in sync with `SMOKE_GATE_API_PATHS` in `server.js` (used when `IH35_SMOKE_GATE=1` from `qa-with-server.mjs`). */
const CRITICAL = [
  ['GET', '/api/health'],
  ['GET', '/api/qbo/status'],
  ['GET', '/api/accounting/qbo-items'],
  ['GET', '/api/catalog/parts'],
  ['GET', '/api/catalog/service-types'],
  ['GET', '/api/form-425c/profiles'],
  ['GET', '/api/qbo/sync-alerts'],
  ['GET', '/api/maintenance/dashboard'],
  ['GET', '/api/maintenance/records'],
  ['GET', '/api/board'],
  ['GET', '/api/maintenance/service-types'],
  ['GET', '/api/integrity/dashboard'],
  ['GET', '/api/integrity/counts'],
  ['GET', '/api/integrity/thresholds']
];

/** Optional: DB reachability (fails in dev when URL points at a dead host). */
const SOFT_DB = ['GET', '/api/health/db'];

/** Reserved path; auth middleware skips it so smoke can assert JSON 404 even when login is required elsewhere. */
const API_NOT_FOUND_PROBE = '/api/__smoke_not_found__';

/** Minimal PDF route (auth-exempt); validates `pdfkit` + `routes/pdf.mjs` when agents run smoke with auth on. */
const PDF_SMOKE_PATH = '/api/pdf/__smoke__';

/** Static ERP shells (HTML) — catches broken public paths or 500 on page boot. Second value: one substring or all of a list must be present. */
const HTML_PAGES = [
  ['/index.html', ['hub-page', 'erpConnectionStrip', '/js/erp-ui.js']],
  [
    '/maintenance.html',
    [
      'section-reports',
      'section-dashboard',
      'section-fuel',
      'section-safety',
      'section-tracking',
      'section-accounting',
      'section-uploads',
      'section-maintenance',
      'section-catalog',
      'maint-action-strip',
      'maint-page-shell',
      'shopBoardSubtabs',
      'id="erpApp"',
      'id="erpToastHost"',
      'id="qboSyncAlertBar"',
      'erp-reports-shell',
      'acct-dash-kpis',
      'id="acctBoardStrip"',
      'erpConnectionStrip',
      'topbar-hint-wrap',
      'id="bpOpenBillsPagerHost"',
      'id="driverFilesPagerHost"',
      'id="repairLocationSelect"',
      'maint-cost-imports-shortcut',
      'printDocuments.js',
      'erp-multi-bills.js',
      'erpOpenMultiBillsModal',
      'id="erpMultiBillsModal"',
      'ih35-runtime.js',
      'http-equiv="Cache-Control"'
    ]
  ],
  ['/dispatch.html', ['dispatchApp', 'erpConnectionStrip']],
  ['/fuel.html', ['fuel-board', 'erpConnectionStrip']],
  ['/banking.html', ['banking-page', 'erpConnectionStrip']],
  ['/settings.html', ['settings-page', 'erpConnectionStrip']],
  ['/tracking.html', ['maintenance.html#tracking', 'viewport-fit=cover']],
  ['/fleet-reports/index.html', ['id="root"', 'Fleet Reports Hub']]
];

/** Static assets (200 + stable header): `[path, needle]` or `[path, needle, accept]`. */
const STATIC_TEXT = [
  ['/css/design-tokens.css', 'IH35 ERP — Master spec design tokens (Rule 0).'],
  ['/css/maint-accounting-ui-2026.css', 'Maintenance center action strip'],
  ['/css/app-theme.css', 'IH35 — shared visual language'],
  ['/css/erp-master-redesign.css', 'IH35 ERP — QuickBooks-style shell (UI only).'],
  [
    '/css/erp-master-spec-2026.css',
    'IH35 ERP — Master redesign spec (Rules 0–22; maintenance is the reference surface).'
  ],
  ['/css/board-nav.css', 'Persistent operations bar'],
  ['/js/erp-ui.js', ['IH35 ERP — shared UI helpers', '__IH35_DEPLOY_REF'], '*/*'],
  ['/js/board-nav.js', 'Fuel & route planning', '*/*'],
  ['/src/utils/printDocuments.js', 'IH35 ERP — approved print documents', '*/*'],
  ['/css/erp-multi-bills.css', 'Multiple bills modal'],
  ['/js/erp-multi-bills.js', 'Multiple bills — pure helpers', '*/*'],
  ['/ih35-runtime.js', ['window.__IH35_FLEET_HUB_BASE', 'window.__IH35_DEPLOY_REF'], '*/*']
];

/** `[path, Accept header]` — GET body checked against **`rule-zero-agent-b.mjs`** forbidden list. */
const RULE0_GUARD_FETCHES = [
  ['/css/app-theme.css', 'text/css,*/*'],
  ['/css/maint-accounting-ui-2026.css', 'text/css,*/*'],
  ['/maintenance.html', 'text/html']
];

const FETCH_MS = Math.min(30000, Math.max(2000, Number(process.env.SMOKE_TIMEOUT_MS) || 10000));

/**
 * Returns null when payload shape is acceptable for the endpoint.
 * Returns a short error string when payload shape is invalid.
 */
function criticalContractError(path, json) {
  if (!json || typeof json !== 'object' || json._nonJson) return 'non-JSON response body';
  switch (path) {
    case '/api/health':
      return json.ok === true ? null : 'expected { ok: true }';
    case '/api/qbo/status':
      return json.ok === true &&
        typeof json.connected === 'boolean' &&
        typeof json.configured === 'boolean'
        ? null
        : 'expected { ok:true, connected:boolean, configured:boolean }';
    case '/api/accounting/qbo-items':
      return Array.isArray(json.items) ? null : 'expected { items: [] }';
    case '/api/catalog/parts':
      return Array.isArray(json.parts) ? null : 'expected { parts: [] }';
    case '/api/catalog/service-types':
      return Array.isArray(json.services) ? null : 'expected { services: [] }';
    case '/api/form-425c/profiles':
      return Array.isArray(json.companies) ? null : 'expected { companies: [] }';
    case '/api/qbo/sync-alerts':
      return json.ok === true &&
        json.counts &&
        typeof json.counts === 'object' &&
        typeof json.counts.total === 'number' &&
        typeof json.configured === 'boolean' &&
        typeof json.connected === 'boolean'
        ? null
        : 'expected { ok:true, counts:{ total:number }, configured:boolean, connected:boolean }';
    case '/api/maintenance/dashboard':
      return json.ok === true &&
        Array.isArray(json.dashboard) &&
        Array.isArray(json.vehicles) &&
        Array.isArray(json.tireAlerts)
        ? null
        : 'expected { ok:true, dashboard:[], vehicles:[], tireAlerts:[] }';
    case '/api/maintenance/records':
      return json && typeof json === 'object' ? null : 'expected object payload';
    case '/api/maintenance/service-types':
      return json.ok === true && Array.isArray(json.names)
        ? null
        : 'expected { ok:true, names: [] }';
    case '/api/board':
      return Array.isArray(json.vehicles) &&
        Array.isArray(json.live) &&
        Array.isArray(json.hos) &&
        Array.isArray(json.assignments)
        ? null
        : 'expected { vehicles:[], live:[], hos:[], assignments:[] }';
    case '/api/integrity/dashboard':
      return json.ok === true &&
        Array.isArray(json.alerts) &&
        json.kpi &&
        typeof json.kpi === 'object' &&
        typeof json.kpi.active === 'number' &&
        typeof json.kpi.red === 'number' &&
        typeof json.kpi.amber === 'number' &&
        json.query &&
        typeof json.query === 'object'
        ? null
        : 'expected { ok:true, alerts:[], kpi:{ active:number, red:number, amber:number }, query:{...} }';
    case '/api/integrity/counts':
      return json.ok === true &&
        typeof json.active === 'number' &&
        typeof json.red === 'number' &&
        typeof json.amber === 'number' &&
        typeof json.resolvedThisMonth === 'number'
        ? null
        : 'expected { ok:true, active:number, red:number, amber:number, resolvedThisMonth:number }';
    case '/api/integrity/thresholds':
      if (!(json.ok === true && json.thresholds && typeof json.thresholds === 'object')) {
        return 'expected { ok:true, thresholds:{...} }';
      }
      {
        const vals = Object.values(json.thresholds);
        if (vals.length === 0) return 'expected thresholds to have at least one key';
        const bad = vals.some(v => typeof v !== 'number' || !Number.isFinite(v));
        return bad ? 'expected all thresholds values to be finite numbers' : null;
      }
    default:
      return null;
  }
}

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
  return { path, status: r.status, ok: r.ok, hint, json, jsonSnippet: summarize(json, path) };
}

async function oneHtml(path, needleOrList) {
  const url = base + path;
  const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
  const r = await fetch(url, { method: 'GET', headers: { Accept: 'text/html' }, signal: ctrl });
  const text = await r.text();
  const needles = Array.isArray(needleOrList) ? needleOrList : needleOrList ? [needleOrList] : [];
  const missing = needles.filter(n => n && !text.includes(n));
  const has = needles.length > 0 && missing.length === 0;
  const hint = has
    ? `contains ${needles.map(n => `"${n}"`).join(' + ')}`
    : r.ok
      ? `missing ${missing.map(n => `"${n}"`).join(', ')}`
      : '';
  return {
    path,
    status: r.status,
    ok: r.ok && has,
    hint,
    bodyText: text,
    jsonSnippet: r.ok ? `bytes=${text.length}` : text.slice(0, 80)
  };
}

async function oneStatic(path, needleOrList, accept = 'text/css,*/*') {
  const url = base + path;
  const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
  const r = await fetch(url, { method: 'GET', headers: { Accept: accept }, signal: ctrl });
  const text = await r.text();
  const needles = Array.isArray(needleOrList) ? needleOrList : needleOrList ? [needleOrList] : [];
  const missing = needles.filter((n) => n && !text.includes(n));
  const has = needles.length > 0 && missing.length === 0;
  const hint = has
    ? `contains ${needles.map((n) => `"${n}"`).join(' + ')}`
    : r.ok
      ? `missing ${missing.map((n) => `"${n}"`).join(', ')}`
      : '';
  return {
    path,
    status: r.status,
    ok: r.ok && has,
    hint,
    bodyText: text,
    jsonSnippet: r.ok ? `bytes=${text.length}` : text.slice(0, 80)
  };
}

/** When **`cachedBody`** is set (same bytes as a successful **`STATIC_TEXT`** GET), skip a duplicate fetch. */
async function oneRuleZeroGuard(path, accept, cachedBody = null) {
  let text = cachedBody;
  let status = 200;
  if (text == null) {
    const url = base + path;
    const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
    const r = await fetch(url, { method: 'GET', headers: { Accept: accept }, signal: ctrl });
    status = r.status;
    text = await r.text();
  }
  const hits = ruleZeroForbiddenHits(text);
  const pass = status >= 200 && status < 300 && hits.length === 0;
  const hint = pass
    ? cachedBody != null
      ? 'Rule 0 stack guard OK (cached body)'
      : 'Rule 0 stack guard OK'
    : hits.length
      ? `forbidden: ${hits.map(h => `"${h}"`).join(', ')}`
      : status >= 200 && status < 300
        ? 'empty guard'
        : '';
  return {
    path,
    status,
    ok: pass,
    hint,
    jsonSnippet: `bytes=${text.length}`
  };
}

async function oneApiUnknown404(probePath) {
  const url = base + probePath;
  const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
  const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  const pathOnly = probePath.split('?')[0];
  const ct = String(r.headers.get('content-type') || '');
  const jsonContentType = ct.toLowerCase().includes('application/json');
  const pass =
    r.status === 404 &&
    jsonContentType &&
    j &&
    j.error === 'Not found' &&
    String(j.path || '') === pathOnly;
  return {
    path: probePath,
    status: r.status,
    ok: pass,
    hint: pass ? 'JSON 404 Not found' : 'expected 404 application/json { error, path }',
    jsonSnippet: pass ? JSON.stringify(j) : text.slice(0, 160)
  };
}

async function onePdf(path) {
  const url = base + path;
  const ctrl = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_MS) : undefined;
  const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/pdf,*/*' }, signal: ctrl });
  const buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const magic = u8.length >= 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
  const ct = String(r.headers.get('content-type') || '').toLowerCase();
  const pdfCt = ct.includes('application/pdf');
  const pass = r.ok && pdfCt && magic;
  let hint = '';
  if (pass) hint = 'application/pdf + %PDF header';
  else if (!r.ok) hint = `HTTP ${r.status}`;
  else if (!pdfCt) hint = `content-type: ${ct || '—'}`;
  else hint = 'body missing %PDF magic';
  return {
    path,
    status: r.status,
    ok: pass,
    hint,
    jsonSnippet: `bytes=${buf.byteLength}`
  };
}

function summarize(j, path) {
  if (!j || typeof j !== 'object') return String(j).slice(0, 80);
  if (path === '/api/health') return `ok=${j.ok} samsara=${j.hasSamsaraToken} qboCfg=${j.hasQboConfig}`;
  if (path === '/api/accounting/qbo-items' && Array.isArray(j.items)) return `items=${j.items.length}`;
  if (path === '/api/catalog/parts' && Array.isArray(j.parts)) return `parts=${j.parts.length}`;
  if (path === '/api/catalog/service-types' && Array.isArray(j.services)) return `services=${j.services.length}`;
  if (path === '/api/form-425c/profiles' && Array.isArray(j.companies)) return `companies=${j.companies.length}`;
  if (path === '/api/qbo/status' && typeof j.connected === 'boolean') return `connected=${j.connected} configured=${j.configured}`;
  if (path === '/api/board' && Array.isArray(j.vehicles)) return `vehicles=${j.vehicles.length} live=${Array.isArray(j.live) ? j.live.length : 0}`;
  if (path === '/api/maintenance/dashboard' && Array.isArray(j.dashboard))
    return `dashboard=${j.dashboard.length} vehicles=${Array.isArray(j.vehicles) ? j.vehicles.length : 0}`;
  if (path === '/api/maintenance/service-types' && Array.isArray(j.names)) return `serviceTypes=${j.names.length}`;
  if (j.ok === false && j.error) return `error=${String(j.error).slice(0, 120)}`;
  if (j.counts) return `counts=${JSON.stringify(j.counts)}`;
  if (Array.isArray(j.vehicles)) return `vehicles=${j.vehicles.length}`;
  if (j.records && Array.isArray(j.records)) return `records=${j.records.length}`;
  if (path === '/api/maintenance/dashboard' && j.dashboard) return `dashboardRows=${j.dashboard.length}`;
  if (path === '/api/integrity/dashboard' && j.ok === true && Array.isArray(j.alerts)) {
    const k = j.kpi || {};
    return `alerts=${j.alerts.length} kpiActive=${k.active ?? '—'}`;
  }
  if (path === '/api/integrity/counts' && j.ok === true && typeof j.active === 'number') {
    return `active=${j.active} red=${j.red} amber=${j.amber}`;
  }
  if (path === '/api/integrity/thresholds' && j.ok === true && j.thresholds && typeof j.thresholds === 'object') {
    return `thresholdKeys=${Object.keys(j.thresholds).length}`;
  }
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
/** Populated from successful **`STATIC_TEXT`** GETs so Rule 0 guard can reuse CSS bodies (one fewer round-trip per file). */
const ruleZeroBodyCache = new Map();

for (const [method, path] of CRITICAL) {
  try {
    const row = await one(method, path);
    const contractErr = criticalContractError(path, row.json);
    const pass = row.ok && !contractErr;
    if (!pass) criticalFailures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} ${method} ${path} ${row.hint}`.trim());
    if (!pass) {
      console.log('   ', row.jsonSnippet);
      if (contractErr) console.log('    Contract:', contractErr);
    }
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

try {
  const row = await oneApiUnknown404(API_NOT_FOUND_PROBE);
  const pass = row.ok;
  if (!pass) criticalFailures++;
  console.log(`${pass ? '✓' : '✗'} ${row.status} GET ${API_NOT_FOUND_PROBE} ${row.hint}`.trim());
  if (!pass) {
    console.log('   ', row.jsonSnippet);
    if (String(row.jsonSnippet || '').includes('<!DOCTYPE'))
      console.log(
        '    Hint: another process may be bound to this port (HTML 404) — restart from this repo (`npm start`) or set `SMOKE_BASE` to the server you intend (e.g. `http://127.0.0.1:<PORT>`). Expect JSON `{ error, path }` for unknown `/api/*`.'
      );
  }
} catch (e) {
  criticalFailures++;
  console.log(`✗ FAIL GET ${API_NOT_FOUND_PROBE}: ${e.message || e}`);
}

try {
  const row = await onePdf(PDF_SMOKE_PATH);
  const pass = row.ok;
  if (!pass) criticalFailures++;
  console.log(`${pass ? '✓' : '✗'} ${row.status} GET ${PDF_SMOKE_PATH} ${row.hint}`.trim());
  if (!pass) console.log('   ', row.jsonSnippet);
} catch (e) {
  criticalFailures++;
  console.log(`✗ FAIL GET ${PDF_SMOKE_PATH}: ${e.message || e}`);
}

for (const [path, needle] of HTML_PAGES) {
  try {
    const row = await oneHtml(path, needle);
    const pass = row.ok;
    if (!pass) criticalFailures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} GET ${path} ${row.hint}`.trim());
    if (!pass) console.log('   ', row.jsonSnippet);
    if (pass && path === '/maintenance.html' && typeof row.bodyText === 'string') {
      ruleZeroBodyCache.set(path, row.bodyText);
    }
  } catch (e) {
    criticalFailures++;
    console.log(`✗ FAIL GET ${path}: ${e.message || e}`);
  }
}

for (const entry of STATIC_TEXT) {
  const path = entry[0];
  const needle = entry[1];
  const accept = entry[2] || 'text/css,*/*';
  try {
    const row = await oneStatic(path, needle, accept);
    const pass = row.ok;
    if (!pass) criticalFailures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} GET ${path} ${row.hint}`.trim());
    if (!pass) console.log('   ', row.jsonSnippet);
    if (pass && typeof row.bodyText === 'string') ruleZeroBodyCache.set(path, row.bodyText);
  } catch (e) {
    criticalFailures++;
    console.log(`✗ FAIL GET ${path}: ${e.message || e}`);
  }
}

for (const [path, accept] of RULE0_GUARD_FETCHES) {
  try {
    const row = await oneRuleZeroGuard(path, accept, ruleZeroBodyCache.get(path));
    const pass = row.ok;
    if (!pass) criticalFailures++;
    console.log(`${pass ? '✓' : '✗'} ${row.status} GET ${path} ${row.hint}`.trim());
    if (!pass) console.log('   ', row.jsonSnippet);
  } catch (e) {
    criticalFailures++;
    console.log(`✗ FAIL GET ${path} Rule 0 guard: ${e.message || e}`);
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
    ? `\nSmoke failed: ${criticalFailures} critical endpoint(s) did not return HTTP 2xx.\nFull gate (no manual start; smoke-gate sync + rule0 + smoke + unit tests): npm run qa:isolated`
    : softWarnings
      ? '\nSmoke completed (critical paths OK; see optional DB check above).'
      : '\nSmoke checks completed.'
);
if (!criticalFailures && process.env.SMOKE_QUIET !== '1') {
  console.log(
    `Smoke target: ${base}  (set SMOKE_BASE to override)  |  With server up: npm run qa:automated  |  Ephemeral full gate (+ unit tests): npm run qa:isolated (smoke-gate-paths-sync first)`
  );
}
process.exit(criticalFailures ? 1 : 0);
