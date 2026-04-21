/**
 * Core read-only ERP HTTP surfaces expected by the maintenance shell and `scripts/system-smoke.mjs`.
 */

import fs from 'fs';
import path from 'path';
import { getPool, dbQuery } from '../lib/db.mjs';
import { readFullErpJson } from '../lib/read-erp.mjs';
import { mergeIntegrityThresholds } from '../lib/integrity-engine.mjs';
import {
  getFleetAvgMilesPerMonth,
  recalcAllIntervalMonthsFromFleetAvg,
  clampFleetAvgMilesPerMonth
} from '../lib/fleet-mileage-settings.mjs';
import { MAINTENANCE_SERVICE_CATALOG_SEEDS } from '../lib/maintenance-service-catalog.mjs';
import { DATA_DIR } from '../lib/data-dirs.mjs';

const QBO_TOKENS = path.join(DATA_DIR, 'qbo_tokens.json');

function readQboStore() {
  try {
    if (!fs.existsSync(QBO_TOKENS)) return { tokens: null };
    return JSON.parse(fs.readFileSync(QBO_TOKENS, 'utf8'));
  } catch {
    return { tokens: null };
  }
}

function qboConnectionFlags() {
  const s = readQboStore();
  const tok = s?.tokens;
  const connected = Boolean(tok?.refresh_token && tok?.access_token);
  const configured =
    Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET) || Boolean(tok?.refresh_token);
  return { configured, connected, companyName: s?.companyName || s?.company_name || '' };
}

/**
 * @param {import('express').Application} app
 * @param {{ logError?: (msg: string, err?: unknown) => void }} [opts]
 */
export function mountErpCoreApi(app, opts = {}) {
  const logError = opts.logError || console.error;

  app.get('/api/health', (_req, res) => {
    const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      hasSamsaraToken: Boolean(token),
      hasQboConfig: qboConnectionFlags().configured,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
      samsaraVehicles: null,
      samsaraStatsRows: null
    });
  });

  app.get('/api/health/db', async (_req, res) => {
    if (!getPool()) {
      return res.status(200).json({ ok: true, configured: false, message: 'DATABASE_URL is not set' });
    }
    try {
      await dbQuery('SELECT 1 AS one');
      return res.json({ ok: true, configured: true });
    } catch (e) {
      return res.status(503).json({ ok: false, configured: true, error: e?.message || String(e) });
    }
  });

  app.get('/api/qbo/status', (_req, res) => {
    const { configured, connected, companyName } = qboConnectionFlags();
    res.json({
      ok: true,
      configured,
      connected,
      companyName: companyName || undefined,
      catalogUiPollMinutes: 0,
      catalogLastSyncedAt: null
    });
  });

  app.get('/api/qbo/sync-alerts', (_req, res) => {
    const { configured, connected } = qboConnectionFlags();
    res.json({
      ok: true,
      alerts: [],
      counts: { total: 0 },
      lookbackDays: 120,
      configured,
      connected
    });
  });

  app.get('/api/maintenance/dashboard', (_req, res) => {
    const erp = readFullErpJson();
    const vehicles = Array.isArray(erp.vehicles) ? erp.vehicles : [];
    const dashboard = Array.isArray(erp.maintenanceDashboard) ? erp.maintenanceDashboard : [];
    const tireAlerts = Array.isArray(erp.tireAlerts) ? erp.tireAlerts : [];
    res.json({
      ok: true,
      vehicles,
      dashboard,
      tireAlerts,
      refreshedAt: erp.refreshedAt || null
    });
  });

  app.get('/api/maintenance/records', (_req, res) => {
    res.json(readFullErpJson());
  });

  app.get('/api/board', (_req, res) => {
    res.json({
      vehicles: [],
      live: [],
      hos: [],
      assignments: [],
      refreshedAt: new Date().toISOString()
    });
  });

  app.get('/api/maintenance/service-types', async (_req, res) => {
    try {
      if (!getPool()) {
        return res.json({ ok: true, names: [...MAINTENANCE_SERVICE_CATALOG_SEEDS] });
      }
      const { rows } = await dbQuery(
        `SELECT name FROM maintenance_service_catalog WHERE active = true ORDER BY sort_order, name`
      );
      const names = (rows || []).map(r => String(r.name || '').trim()).filter(Boolean);
      if (names.length) return res.json({ ok: true, names });
      return res.json({ ok: true, names: [...MAINTENANCE_SERVICE_CATALOG_SEEDS] });
    } catch (e) {
      logError('GET /api/maintenance/service-types', e);
      return res.json({ ok: true, names: [...MAINTENANCE_SERVICE_CATALOG_SEEDS] });
    }
  });

  app.get('/api/integrity/dashboard', (req, res) => {
    const erp = readFullErpJson();
    const alerts = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
    const active = alerts.filter(a => String(a.status || 'active').toLowerCase() !== 'reviewed');
    const red = active.filter(a => String(a.severity || '').toUpperCase() === 'RED').length;
    const amber = active.filter(a => String(a.severity || '').toUpperCase() === 'AMBER').length;
    res.json({
      ok: true,
      alerts,
      kpi: {
        active: active.length,
        red,
        amber
      },
      query: req.query || {}
    });
  });

  app.get('/api/integrity/counts', (_req, res) => {
    const erp = readFullErpJson();
    const alerts = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
    const active = alerts.filter(a => String(a.status || 'active').toLowerCase() !== 'reviewed');
    const red = active.filter(a => String(a.severity || '').toUpperCase() === 'RED').length;
    const amber = active.filter(a => String(a.severity || '').toUpperCase() === 'AMBER').length;
    res.json({
      ok: true,
      active: active.length,
      red,
      amber
    });
  });

  app.get('/api/integrity/thresholds', (_req, res) => {
    const erp = readFullErpJson();
    const thresholds = mergeIntegrityThresholds(erp);
    res.json({ ok: true, thresholds });
  });

  app.get('/api/maintenance/fleet-mileage-settings', async (_req, res) => {
    try {
      const v = getPool() ? await getFleetAvgMilesPerMonth(dbQuery) : 12000;
      return res.json({ fleet_avg_miles_per_month: v });
    } catch (e) {
      logError('GET /api/maintenance/fleet-mileage-settings', e);
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post('/api/maintenance/fleet-mileage-settings', async (req, res) => {
    if (!getPool()) {
      return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    }
    try {
      const n = clampFleetAvgMilesPerMonth(req.body?.fleet_avg_miles_per_month);
      await dbQuery(
        `INSERT INTO erp_fleet_defaults (id, fleet_avg_miles_per_month) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET fleet_avg_miles_per_month = EXCLUDED.fleet_avg_miles_per_month, updated_at = now()`,
        [n]
      );
      await recalcAllIntervalMonthsFromFleetAvg(dbQuery, n);
      return res.json({ ok: true, fleet_avg_miles_per_month: n });
    } catch (e) {
      logError('POST /api/maintenance/fleet-mileage-settings', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
