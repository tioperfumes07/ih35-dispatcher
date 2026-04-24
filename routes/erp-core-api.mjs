/**
 * Core read-only ERP HTTP surfaces expected by the maintenance shell and `scripts/system-smoke.mjs`.
 */

import { getPool, dbQuery } from '../lib/db.mjs';
import { DEDUPE_SUPPORT_TABLE_NAMES } from '../lib/ensure-app-database-objects.mjs';
import { readFullErpJson, writeFullErpJson } from '../lib/read-erp.mjs';
import { mergeIntegrityThresholds, evaluateIntegrityCheck, defaultIntegrityThresholds } from '../lib/integrity-engine.mjs';
import {
  mergeEngineAlertsIntoErp,
  enrichIntegrityAlertRow,
  filterAlertsForQuery,
  computeIntegrityKpis,
  findAlertById,
  buildInvestigatePayload,
  sortEnrichedAlertsDesc
} from '../lib/integrity-persist.mjs';
import {
  getFleetAvgMilesPerMonth,
  recalcAllIntervalMonthsFromFleetAvg,
  clampFleetAvgMilesPerMonth
} from '../lib/fleet-mileage-settings.mjs';
import { MAINTENANCE_SERVICE_CATALOG_SEEDS } from '../lib/maintenance-service-catalog.mjs';
import { readQboStore, clearQboConnectionFailure } from '../lib/qbo-attachments.mjs';
import { getVehicles } from '../services/samsara.js';

const QBO_ERR_STALE_MS = 24 * 60 * 60 * 1000;
const SAMSARA_HEALTH_CACHE_MS = 60 * 1000;
const SAMSARA_HEALTH_TIMEOUT_MS = 5000;
const QBO_LIVE_REFRESH_MS = 60 * 1000;
const samsaraHealthCache = {
  fetchedAt: 0,
  vehicles: null,
  rows: [],
  lastError: '',
  refreshing: null
};

function summarizeSamsaraVehiclesPayload(payload) {
  const arr = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.vehicles)
      ? payload.vehicles
      : Array.isArray(payload)
        ? payload
        : [];
  return { rows: arr, count: arr.length };
}

async function fetchSamsaraVehicleCountCached(token, logError) {
  const now = Date.now();
  const hasFresh =
    Number.isFinite(samsaraHealthCache.fetchedAt) &&
    samsaraHealthCache.fetchedAt > 0 &&
    now - samsaraHealthCache.fetchedAt < SAMSARA_HEALTH_CACHE_MS;
  if (hasFresh && Number.isFinite(samsaraHealthCache.vehicles) && samsaraHealthCache.vehicles >= 0) {
    return {
      vehicles: samsaraHealthCache.vehicles,
      rows: Array.isArray(samsaraHealthCache.rows) ? samsaraHealthCache.rows : [],
      cacheAgeMs: now - samsaraHealthCache.fetchedAt,
      error: samsaraHealthCache.lastError || undefined
    };
  }
  if (samsaraHealthCache.refreshing) {
    try {
      return await samsaraHealthCache.refreshing;
    } catch {
      return {
        vehicles: Number.isFinite(samsaraHealthCache.vehicles) ? samsaraHealthCache.vehicles : null,
        rows: Array.isArray(samsaraHealthCache.rows) ? samsaraHealthCache.rows : [],
        cacheAgeMs: now - (samsaraHealthCache.fetchedAt || now),
        error: samsaraHealthCache.lastError || 'Samsara refresh failed'
      };
    }
  }
  samsaraHealthCache.refreshing = (async () => {
    const t = setTimeout(() => {
      samsaraHealthCache.lastError = `Samsara health snapshot exceeded ${SAMSARA_HEALTH_TIMEOUT_MS}ms`;
    }, SAMSARA_HEALTH_TIMEOUT_MS);
    try {
      const response = await getVehicles(token);
      const { rows, count } = summarizeSamsaraVehiclesPayload(response);
      samsaraHealthCache.vehicles = count;
      samsaraHealthCache.rows = Array.isArray(rows) ? rows : [];
      samsaraHealthCache.fetchedAt = Date.now();
      samsaraHealthCache.lastError = '';
      try {
        console.log(
          '[samsara] vehicles health snapshot:',
          JSON.stringify({ count, sample: rows[0] || null }).slice(0, 500)
        );
      } catch {
        /* ignore non-serializable payload */
      }
      return {
        vehicles: count,
        rows: Array.isArray(rows) ? rows : [],
        cacheAgeMs: 0,
        error: undefined
      };
    } catch (err) {
      samsaraHealthCache.lastError = err?.message || String(err);
      logError('[api/health] samsara vehicles snapshot failed', err);
      return {
        vehicles: Number.isFinite(samsaraHealthCache.vehicles) ? samsaraHealthCache.vehicles : null,
        rows: Array.isArray(samsaraHealthCache.rows) ? samsaraHealthCache.rows : [],
        cacheAgeMs: samsaraHealthCache.fetchedAt ? Date.now() - samsaraHealthCache.fetchedAt : null,
        error: samsaraHealthCache.lastError
      };
    } finally {
      clearTimeout(t);
      samsaraHealthCache.refreshing = null;
    }
  })();
  return await samsaraHealthCache.refreshing;
}

function qboConnectionFlags() {
  const s = readQboStore();
  const tok = s?.tokens;
  const realmId = tok?.realmId || tok?.realm_id;
  /** OAuth looks complete (company linked). Access token may still be expired — refresh runs on demand. */
  const connected = Boolean(tok?.refresh_token && realmId);
  const configured =
    Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET) || Boolean(tok?.refresh_token);

  const h = s?.connectionHealth;
  const lastErr = typeof h?.lastError === 'string' ? h.lastError.trim() : '';
  const lastAt = h?.lastErrorAt ? Date.parse(String(h.lastErrorAt)) : NaN;
  const errRecent =
    lastErr &&
    Number.isFinite(lastAt) &&
    Date.now() - lastAt < QBO_ERR_STALE_MS;

  return {
    configured,
    connected,
    companyName: s?.companyName || s?.company_name || '',
    lastRefreshError: errRecent ? lastErr : undefined,
    lastRefreshErrorAt: errRecent ? String(h.lastErrorAt) : undefined
  };
}

function fleetApiOrigin() {
  return (
    process.env.IH35_FLEET_API_ORIGIN ||
    `http://127.0.0.1:${process.env.INTEGRITY_API_PORT || 8787}`
  ).replace(/\/+$/, '');
}

function normalizeMaintenanceUnitRow(raw = {}) {
  const unit =
    String(
      raw.unitNumber ||
        raw.unitNo ||
        raw.unit_number ||
        raw.id ||
        raw.truckNumber ||
        raw.vehicleId ||
        ''
    ).trim() || 'Unknown';
  return {
    unit,
    id: String(raw.id || raw.unitId || unit),
    status: String(raw.status || raw.operationalStatus || 'active').trim() || 'active',
    make: String(raw.make || '').trim(),
    model: String(raw.model || '').trim(),
    vin: String(raw.vin || '').trim(),
    plate: String(raw.plate || raw.licensePlate || '').trim(),
    odometerMiles: Number(raw.odometerMiles || raw.odometer || raw.miles || 0) || 0
  };
}

function mapSamsaraVehicleRow(raw = {}) {
  const rawId = String(raw.id || raw.vehicleId || raw.uuid || '').trim();
  const unit = String(
    raw.name ||
      raw.unitNumber ||
      raw.unit_number ||
      raw.attributes?.name ||
      raw.attributes?.unitNumber ||
      rawId
  ).trim();
  if (!unit) return null;
  const odometerMeters = Number(
    raw.odometerMeters ??
      raw.odometer_meters ??
      raw.odometer?.meters ??
      raw.attributes?.odometerMeters ??
      NaN
  );
  const odometerMiles = Number.isFinite(odometerMeters) && odometerMeters > 0
    ? Math.round(odometerMeters * 0.000621371)
    : null;
  return {
    id: rawId || unit,
    name: unit,
    make: String(raw.make || raw.attributes?.make || '').trim() || null,
    model: String(raw.model || raw.attributes?.model || '').trim() || null,
    vin: String(raw.vin || raw.attributes?.vin || '').trim() || null,
    licensePlate: String(
      raw.licensePlate ||
        raw.license_plate ||
        raw.plate ||
        raw.attributes?.licensePlate ||
        ''
    ).trim() || null,
    status: String(raw.status || raw.attributes?.status || 'active').trim() || 'active',
    odometerMiles,
  };
}

async function fetchSamsaraVehiclesFallback(token, logError) {
  const cachedRows = Array.isArray(samsaraHealthCache.rows) ? samsaraHealthCache.rows : [];
  if (cachedRows.length > 0) {
    console.log(
      '[fallback] using',
      cachedRows.length,
      'vehicles from cache, first:',
      cachedRows[0]?.name || cachedRows[0]?.id
    );
    return cachedRows.map(mapSamsaraVehicleRow).filter(Boolean);
  }
  if (!token) return [];
  try {
    const payload = await getVehicles(token);
    const { rows } = summarizeSamsaraVehiclesPayload(payload);
    if (!rows.length) return [];
    console.log(
      '[fallback] using',
      rows.length,
      'vehicles from live api, first:',
      rows[0]?.name || rows[0]?.id
    );
    return rows.map(mapSamsaraVehicleRow).filter(Boolean);
  } catch (e) {
    logError('[samsara] fallback vehicle fetch failed', e);
    return [];
  }
}

/**
 * @param {import('express').Application} app
 * @param {{ logError?: (msg: string, err?: unknown) => void }} [opts]
 */
export function mountErpCoreApi(app, opts = {}) {
  const logError = opts.logError || console.error;

  function maintActor(req) {
    return String(req.headers['x-ih35-user'] || req.headers['x-user-email'] || 'operator').trim() || 'operator';
  }

  app.get('/api/health', async (_req, res) => {
    const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
    const qbo = qboConnectionFlags();
    let samsaraVehicles = null;
    let samsaraStatsRows = null;
    let samsaraError = undefined;
    if (token) {
      const s = await fetchSamsaraVehicleCountCached(token, logError);
      samsaraVehicles = Number.isFinite(s.vehicles) ? s.vehicles : null;
      samsaraStatsRows = Number.isFinite(s.vehicles) ? s.vehicles : null;
      samsaraError = s.error;
    }
    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      hasSamsaraToken: Boolean(token),
      hasQboConfig: qbo.configured,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
      samsaraVehicles,
      samsaraStatsRows,
      samsaraError,
      samsaraRefreshMs: SAMSARA_HEALTH_CACHE_MS,
      qboRefreshMs: QBO_LIVE_REFRESH_MS,
      qboLiveConnection: qbo.connected ? 'connected' : qbo.configured ? 'disconnected' : 'not-configured',
      samsaraLiveConnection: token ? (samsaraError ? 'degraded' : 'connected') : 'not-configured'
    });
  });

  app.get('/api/health/db', async (_req, res) => {
    if (!getPool()) {
      return res.status(200).json({ ok: true, configured: false, message: 'DATABASE_URL is not set' });
    }
    try {
      await dbQuery('SELECT 1 AS one');
      let supportTables = null;
      try {
        const { rows } = await dbQuery(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
          [DEDUPE_SUPPORT_TABLE_NAMES]
        );
        const have = new Set((rows || []).map(r => r.table_name));
        let missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have.has(n));
        if (missing.includes('merge_log') || missing.includes('dedup_skipped')) {
          try {
            const { ensureDedupeWritePathObjects } = await import('../lib/ensure-app-database-objects.mjs');
            await ensureDedupeWritePathObjects();
            const r2 = await dbQuery(
              `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
              [DEDUPE_SUPPORT_TABLE_NAMES]
            );
            const have2 = new Set((r2.rows || []).map(r => r.table_name));
            missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have2.has(n));
            supportTables = { ok: missing.length === 0, missing, healedMergeAudit: true };
          } catch (healErr) {
            supportTables = {
              ok: false,
              missing,
              healedMergeAudit: false,
              healError: healErr?.message || String(healErr)
            };
          }
        } else {
          supportTables = { ok: missing.length === 0, missing };
        }
      } catch (e2) {
        supportTables = { ok: false, error: e2?.message || String(e2) };
      }
      return res.json({ ok: true, configured: true, supportTables });
    } catch (e) {
      return res.status(503).json({ ok: false, configured: true, error: e?.message || String(e) });
    }
  });

  app.get('/api/qbo/status', (_req, res) => {
    const { configured, connected, companyName, lastRefreshError, lastRefreshErrorAt } = qboConnectionFlags();
    res.json({
      ok: true,
      configured,
      connected,
      companyName: companyName || undefined,
      lastRefreshError: lastRefreshError || undefined,
      lastRefreshErrorAt: lastRefreshErrorAt || undefined,
      catalogUiPollMinutes: 1,
      catalogUiPollMs: QBO_LIVE_REFRESH_MS,
      catalogLastSyncedAt: null,
      liveConnectionStatus: connected ? 'connected' : configured ? 'disconnected' : 'not-configured'
    });
  });

  /**
   * Legacy ERP shell compatibility endpoint.
   * `public/maintenance.html` test action expects Intuit-style `CompanyInfo`.
   */
  app.get('/api/qbo/company', (_req, res) => {
    const { connected, companyName } = qboConnectionFlags();
    if (!connected) {
      return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
    }
    return res.json({
      CompanyInfo: {
        CompanyName: companyName || 'Connected'
      }
    });
  });

  /**
   * Legacy ERP shell compatibility endpoint.
   * Newer code reads `/api/qbo/status`, but the maintenance shell still calls `/api/qbo/master`.
   */
  app.get('/api/qbo/master', (_req, res) => {
    const erp = readFullErpJson();
    const cache = erp?.qboCache && typeof erp.qboCache === 'object' ? erp.qboCache : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    return res.json({
      vendors: arr(cache.vendors),
      items: arr(cache.items),
      accounts: arr(cache.accounts),
      accountsExpense: arr(cache.accountsExpense),
      accountsIncome: arr(cache.accountsIncome),
      customers: arr(cache.customers),
      classes: arr(cache.classes),
      accountsBank: arr(cache.accountsBank),
      paymentMethods: arr(cache.paymentMethods),
      employees: arr(cache.employees),
      terms: arr(cache.terms),
      transactionActivity: cache.transactionActivity || null,
      refreshedAt: erp?.refreshedAt || null
    });
  });

  /** Clears persisted QBO `connectionHealth` after a successful test/refresh (client calls). */
  app.post('/api/qbo/clear-connection-health', (_req, res) => {
    try {
      clearQboConnectionFailure();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
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

  app.get('/api/maintenance/dashboard', async (_req, res) => {
    try {
      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      let vehicles = [];
      if (token) {
        try {
          const payload = await getVehicles(token);
          const { rows } = summarizeSamsaraVehiclesPayload(payload);
          vehicles = rows.map(mapSamsaraVehicleRow).filter(Boolean);
          console.log('[dashboard] samsara direct:', vehicles.length, 'vehicles');
        } catch (e) {
          logError('[dashboard] samsara call failed', e);
        }
      }
      const erp = readFullErpJson();
      if (!vehicles.length) vehicles = Array.isArray(erp.vehicles) ? erp.vehicles : [];
      const dashboard = Array.isArray(erp.maintenanceDashboard) ? erp.maintenanceDashboard : [];
      const tireAlerts = Array.isArray(erp.tireAlerts) ? erp.tireAlerts : [];
      return res.json({
        ok: true,
        vehicles,
        dashboard,
        tireAlerts,
        refreshedAt: new Date().toISOString(),
        source: vehicles.length > 0 ? 'samsara-live' : 'empty'
      });
    } catch (e) {
      logError('GET /api/maintenance/dashboard', e);
      return res.json({ ok: false, vehicles: [], dashboard: [], tireAlerts: [], source: 'error' });
    }
  });

  app.get('/api/board', async (_req, res) => {
    try {
      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      let vehicles = [];
      if (token) {
        try {
          const payload = await getVehicles(token);
          const { rows } = summarizeSamsaraVehiclesPayload(payload);
          vehicles = rows.map(mapSamsaraVehicleRow).filter(Boolean);
          console.log('[board] samsara direct:', vehicles.length, 'vehicles');
        } catch (e) {
          logError('[board] samsara call failed', e);
        }
      }
      if (!vehicles.length) {
        const erp = readFullErpJson();
        vehicles = Array.isArray(erp.vehicles) ? erp.vehicles : [];
      }
      return res.json({
        vehicles, live: [], hos: [], assignments: [],
        refreshedAt: new Date().toISOString(),
        source: vehicles.length > 0 ? 'samsara-live' : 'empty'
      });
    } catch (e) {
      logError('GET /api/board', e);
      return res.json({ vehicles: [], live: [], hos: [],
        assignments: [], refreshedAt: new Date().toISOString(), source: 'error' });
    }
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
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const q = req.query || {};
      const filtered = filterAlertsForQuery(raw, q);
      const enriched = sortEnrichedAlertsDesc(filtered.map(enrichIntegrityAlertRow));
      const kpi = computeIntegrityKpis(raw);
      res.json({
        ok: true,
        alerts: enriched,
        kpi,
        query: q
      });
    } catch (e) {
      logError('GET /api/integrity/dashboard', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  /**
   * Main server shim for fleet-integrity table consumed by hub telematics pages.
   * Source of truth is the fleet API service (default :8787); falls back to local ERP units.
   */
  app.get('/api/integrity/fleet-vehicles', async (_req, res) => {
    const origin = fleetApiOrigin();
    try {
      const r = await fetch(`${origin}/api/integrity/fleet-vehicles`, {
        headers: { Accept: 'application/json' }
      });
      if (r.ok) {
        const payload = await r.json().catch(() => null);
        if (payload && typeof payload === 'object') return res.json(payload);
      }
    } catch (e) {
      logError('[integrity/fleet-vehicles] upstream fetch failed', e);
    }
    try {
      const erp = readFullErpJson();
      const vehicles = Array.isArray(erp.vehicles) ? erp.vehicles : [];
      const table = vehicles
        .map(v => {
          const row = normalizeMaintenanceUnitRow(v);
          return {
            unit: row.unit,
            score: 0,
            band: 'ok',
            alertCount: 0,
            codes: [],
            tripMiles90d: null,
            idlePct: null,
            faults: 0
          };
        })
        .filter(Boolean);
      return res.json({
        refreshedAt: erp.refreshedAt || null,
        fromCache: true,
        table,
        checks: {
          vehicles: {},
          fleetSafetyAvg: 0,
          fleetTripAvg90: 0
        }
      });
    } catch (e) {
      logError('GET /api/integrity/fleet-vehicles fallback', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/counts', (_req, res) => {
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const kpi = computeIntegrityKpis(raw);
      res.json({
        ok: true,
        active: kpi.active,
        red: kpi.red,
        amber: kpi.amber,
        resolvedThisMonth: kpi.resolvedThisMonth
      });
    } catch (e) {
      logError('GET /api/integrity/counts', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/thresholds', (_req, res) => {
    const erp = readFullErpJson();
    const thresholds = mergeIntegrityThresholds(erp);
    res.json({ ok: true, thresholds });
  });

  app.post('/api/integrity/thresholds', (req, res) => {
    try {
      const erp = readFullErpJson();
      if (!erp.integrityThresholds || typeof erp.integrityThresholds !== 'object') {
        erp.integrityThresholds = {};
      }
      if (req.body && req.body.reset) {
        erp.integrityThresholds = {};
      } else {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const defs = defaultIntegrityThresholds();
        for (const k of Object.keys(body)) {
          if (k === 'reset') continue;
          if (!(k in defs)) continue;
          const n = Number(body[k]);
          if (Number.isFinite(n)) erp.integrityThresholds[k] = n;
        }
      }
      writeFullErpJson(erp);
      res.json({ ok: true, thresholds: mergeIntegrityThresholds(erp) });
    } catch (e) {
      logError('POST /api/integrity/thresholds', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  /** Back-compat endpoint used by ERP shell actions; detailed sync state is served by /api/qbo/sync-alerts. */
  app.post('/api/qbo/sync', (_req, res) => {
    const { configured, connected, companyName } = qboConnectionFlags();
    res.json({
      ok: true,
      configured,
      connected,
      companyName: companyName || undefined,
      synced: 0,
      message: connected
        ? 'No immediate sync work queued. Use section-specific posting actions.'
        : 'QuickBooks is not connected. Open Settings to authorize.'
    });
  });

  /** Runs after client save — never blocks the save path; merges alerts into maintenance.json. */
  app.post('/api/integrity/check', async (req, res) => {
    try {
      const ctx = req.body && typeof req.body === 'object' ? req.body : {};
      const erp = readFullErpJson();
      const { alerts: fresh } = evaluateIntegrityCheck(ctx, erp);
      const normalized = (fresh || []).map(a => ({
        type: a.type,
        category: a.category,
        severity: a.severity,
        message: a.message,
        details: a.details || {},
        dedupeKey: a.dedupeKey
      }));
      mergeEngineAlertsIntoErp(erp, ctx, normalized);
      writeFullErpJson(erp);
      const dkSet = new Set(normalized.map(x => String(x.dedupeKey || '')));
      const mergedRows = (erp.integrityAlerts || []).filter(
        a =>
          dkSet.has(String(a.dedupeKey || '')) ||
          dkSet.has(String(a.details?.dedupeKey || ''))
      );
      try {
        const { syncIntegrityAlertsToDatabase } = await import('../lib/integrity-db-sync.mjs');
        await syncIntegrityAlertsToDatabase(mergedRows);
      } catch (_) {
        /* optional */
      }
      res.json({ ok: true, alerts: mergedRows.map(enrichIntegrityAlertRow) });
    } catch (e) {
      logError('POST /api/integrity/check', e);
      res.status(200).json({ ok: true, alerts: [], error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/alert/:id/records', (req, res) => {
    try {
      const erp = readFullErpJson();
      const alert = findAlertById(erp, req.params.id);
      if (!alert) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const payload = buildInvestigatePayload(alert, erp);
      res.json({ ok: true, records: payload.relatedRecords || [], alert: payload.alert });
    } catch (e) {
      logError('GET /api/integrity/alert/:id/records', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrity/alert/:id/notes', async (req, res) => {
    try {
      const erp = readFullErpJson();
      const list = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const idx = list.findIndex(a => String(a.id) === String(req.params.id));
      if (idx < 0) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const notes = String(req.body?.notes ?? '');
      list[idx] = { ...list[idx], notes };
      erp.integrityAlerts = list;
      writeFullErpJson(erp);
      try {
        const { syncIntegrityAlertsToDatabase } = await import('../lib/integrity-db-sync.mjs');
        await syncIntegrityAlertsToDatabase([list[idx]]);
      } catch (_) {}
      res.json({ ok: true, alert: enrichIntegrityAlertRow(list[idx]) });
    } catch (e) {
      logError('POST /api/integrity/alert/:id/notes', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrity/alert/:id/review', async (req, res) => {
    try {
      const erp = readFullErpJson();
      const list = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const idx = list.findIndex(a => String(a.id) === String(req.params.id));
      if (idx < 0) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const notes = req.body?.notes != null ? String(req.body.notes) : list[idx].notes;
      const by = maintActor(req);
      const now = new Date().toISOString();
      list[idx] = {
        ...list[idx],
        notes,
        status: 'reviewed',
        reviewedBy: by,
        reviewedAt: now
      };
      erp.integrityAlerts = list;
      writeFullErpJson(erp);
      try {
        const { syncIntegrityAlertsToDatabase } = await import('../lib/integrity-db-sync.mjs');
        await syncIntegrityAlertsToDatabase([list[idx]]);
      } catch (_) {}
      res.json({ ok: true, alert: enrichIntegrityAlertRow(list[idx]) });
    } catch (e) {
      logError('POST /api/integrity/alert/:id/review', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/export', (req, res) => {
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const q = req.query || {};
      const rows = sortEnrichedAlertsDesc(filterAlertsForQuery(raw, q).map(enrichIntegrityAlertRow));
      const fmt = String(req.query.format || 'csv').toLowerCase();
      if (fmt === 'xlsx' || fmt === 'pdf') {
        return res.status(501).json({
          ok: false,
          error: 'Excel/PDF integrity export requires the reports worker; use format=csv for now.'
        });
      }
      const cols = ['id', 'alertType', 'severity', 'status', 'triggeredDate', 'unitId', 'driverId', 'message'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = cols.join(',');
      const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="integrity-alerts.csv"');
      res.send(`${head}\n${body}`);
    } catch (e) {
      logError('GET /api/integrity/export', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
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
