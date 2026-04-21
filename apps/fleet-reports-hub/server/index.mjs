/**
 * API + nightly integrity job.
 * Uses existing Samsara client modules (server/lib/samsara-*.mjs).
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { minimalErp } from './lib/erp-mock.mjs';
import { getOrRefreshFleetBundle, invalidateFleetCache } from './lib/samsara-fleet-bundle.mjs';
import { runVehicleIntegrityChecks } from './lib/vehicle-integrity-checks.mjs';
import { hasSamsaraReadToken } from './lib/samsara-integrity-fetch.mjs';
import { initializeDatabase } from './lib/accounting-db.mjs';
import { registerAccountingRoutes } from './lib/accounting-http.mjs';
import { registerNameManagementRoutes } from './lib/name-management-http.mjs';
import { registerCatalogRoutes } from './lib/catalog-http.mjs';
import { registerFleetRegistryRoutes } from './lib/fleet-registries-http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.INTEGRITY_API_PORT || 8787);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const NIGHTLY_FILE = path.join(DATA_DIR, 'last-nightly-run.json');
const NIGHTLY_ALERTS = path.join(DATA_DIR, 'nightly-alerts.json');

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function dedupeNightlyKey() {
  const day = new Date().toISOString().slice(0, 10);
  const prev = readJson(NIGHTLY_FILE, {});
  if (prev.date === day) return false;
  writeJson(NIGHTLY_FILE, { date: day, ranAt: new Date().toISOString() });
  return true;
}

function mergeNightlyAlerts(rows) {
  const prev = readJson(NIGHTLY_ALERTS, []);
  const keys = new Set(prev.map((r) => `${r.unit}|${r.code}|${r.day}`));
  const added = [];
  for (const r of rows) {
    const k = `${r.unit}|${r.code}|${r.day}`;
    if (keys.has(k)) continue;
    keys.add(k);
    added.push(r);
  }
  writeJson(NIGHTLY_ALERTS, [...added, ...prev].slice(0, 5000));
  return added.length;
}

async function nightlyIntegrityJob() {
  if (!dedupeNightlyKey()) {
    console.log('[nightly] skip duplicate for', new Date().toISOString().slice(0, 10));
    return;
  }
  console.log('[nightly] integrity refresh 02:00');
  const erp = minimalErp();
  const fleet = await getOrRefreshFleetBundle(erp, true);
  const checks = runVehicleIntegrityChecks(fleet, erp);
  const day = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const [unit, v] of Object.entries(checks.vehicles || {})) {
    for (const a of v.alerts || []) {
      rows.push({ unit, code: a.code, day, severity: a.severity, title: a.title });
    }
  }
  const n = mergeNightlyAlerts(rows);
  console.log('[nightly] merged', n, 'new alert rows (deduped)');
}

try {
  initializeDatabase();
} catch (e) {
  console.error('[db] initializeDatabase failed:', e);
  process.exit(1);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

registerAccountingRoutes(app);
registerNameManagementRoutes(app);
registerCatalogRoutes(app);
registerFleetRegistryRoutes(app);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    samsaraToken: hasSamsaraReadToken(),
    cacheTtlMinutes: 5,
  });
});

app.get('/api/samsara/fleet-cache', async (_req, res) => {
  try {
    const erp = minimalErp();
    const data = await getOrRefreshFleetBundle(erp, false);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/samsara/refresh', async (_req, res) => {
  try {
    invalidateFleetCache();
    const erp = minimalErp();
    const data = await getOrRefreshFleetBundle(erp, true);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/integrity/fleet-vehicles', async (_req, res) => {
  try {
    const erp = minimalErp();
    const fleet = await getOrRefreshFleetBundle(erp, false);
    const checks = runVehicleIntegrityChecks(fleet, erp);
    const table = Object.entries(checks.vehicles || {})
      .map(([unit, v]) => ({
        unit,
        score: v.score,
        band: v.band,
        alertCount: v.alerts.length,
        codes: v.alerts.map((a) => a.code),
        tripMiles90d: v.bundle?.tripMiles90d,
        idlePct: v.bundle?.idlePercent90d,
        faults: (v.bundle?.faultCodes || []).length,
      }))
      .sort((a, b) => a.score - b.score);
    res.json({ refreshedAt: fleet.refreshedAt, fromCache: fleet.fromCache, table, checks });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/integrity/vehicle/:unit', async (req, res) => {
  try {
    const unit = decodeURIComponent(req.params.unit || '');
    const erp = minimalErp();
    const fleet = await getOrRefreshFleetBundle(erp, false);
    const checks = runVehicleIntegrityChecks(fleet, erp);
    const row = checks.vehicles?.[unit];
    if (!row) return res.status(404).json({ error: 'Unknown unit' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const distDir = path.join(__dirname, '..', 'dist');
const distIndex = path.join(distDir, 'index.html');
if (fs.existsSync(distIndex)) {
  app.use(express.static(distDir));
  // Express 5 / path-to-regexp v8: avoid app.get('*') (invalid). Send SPA shell for non-API GETs.
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
    res.sendFile(distIndex, (err) => (err ? next(err) : undefined));
  });
}

app.listen(PORT, BIND_HOST, () => {
  console.log(`Integrity + Samsara API http://${BIND_HOST}:${PORT}`);
});

cron.schedule(
  '0 2 * * *',
  () => {
    void nightlyIntegrityJob();
  },
  { timezone: process.env.CRON_TZ || 'America/Chicago' },
);
