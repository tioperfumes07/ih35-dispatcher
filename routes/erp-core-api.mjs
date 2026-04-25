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
import { getVehicles, samsaraGet } from '../services/samsara.js';

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

const COMMON_WORK_ORDER_SERVICE_TYPE_SEEDS = [
  'Oil Change',
  'Tire Rotation',
  'Brake Inspection',
  'PM Service',
  'DOT Inspection',
  'Engine Diagnostic',
  'Battery Service',
  'Air System Repair',
  'Suspension Repair',
  'Trailer Repair'
];

const COMMON_PARTS_REFERENCE_SEEDS = [
  { part_key: 'oil_filter', label: 'Oil Filter', avg_replacement_miles: 25000, avg_replacement_months: 2, avg_cost_mid: 24 },
  { part_key: 'fuel_filter', label: 'Fuel Filter', avg_replacement_miles: 25000, avg_replacement_months: 2, avg_cost_mid: 58 },
  { part_key: 'air_filter', label: 'Air Filter', avg_replacement_miles: 30000, avg_replacement_months: 3, avg_cost_mid: 36 },
  { part_key: 'brake_pad_set', label: 'Brake Pad Set', avg_replacement_miles: 60000, avg_replacement_months: 6, avg_cost_mid: 280 },
  { part_key: 'drive_tire', label: 'Drive Tire', avg_replacement_miles: 150000, avg_replacement_months: 12, avg_cost_mid: 450 },
  { part_key: 'battery_12v', label: 'Battery 12V', avg_replacement_miles: 80000, avg_replacement_months: 24, avg_cost_mid: 160 },
  { part_key: 'serpentine_belt', label: 'Serpentine Belt', avg_replacement_miles: 90000, avg_replacement_months: 18, avg_cost_mid: 98 },
  { part_key: 'def_filter', label: 'DEF Filter', avg_replacement_miles: 100000, avg_replacement_months: 12, avg_cost_mid: 130 }
];

let fleetCatalogSeedState = { done: false, inFlight: null };

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


function summarizeSamsaraVehicleStatsPayload(payload) {
  const arr = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.stats)
      ? payload.stats
      : Array.isArray(payload)
        ? payload
        : [];
  return { rows: arr, count: arr.length };
}

function mapSamsaraVehicleStatsRow(raw = {}) {
  const id = String(raw.vehicleId || raw.id || raw.vehicle?.id || '').trim();
  if (!id) return null;

  const odometerMeters = Number(
    raw.obdOdometerMeters ??
      raw.odometerMeters ??
      raw.obdOdometer?.meters ??
      raw.odometer?.meters ??
      raw.stats?.obdOdometerMeters ??
      NaN
  );
  const odometerMiles =
    Number.isFinite(odometerMeters) && odometerMeters > 0
      ? Math.round(odometerMeters * 0.000621371)
      : null;

  const engineSeconds = Number(
    raw.engineSeconds ??
      raw.engine?.seconds ??
      raw.engineState?.seconds ??
      raw.stats?.engineSeconds ??
      NaN
  );
  const engineHours =
    Number.isFinite(engineSeconds) && engineSeconds >= 0
      ? Number((engineSeconds / 3600).toFixed(2))
      : null;

  const gps = raw.gps || raw.lastGps || raw.location || raw.lastLocation || raw.stats?.gps || {};
  const lat = Number(gps.latitude ?? gps.lat ?? gps.latitudeDegrees ?? NaN);
  const lng = Number(gps.longitude ?? gps.lng ?? gps.longitudeDegrees ?? NaN);
  const lastGpsLat = Number.isFinite(lat) ? lat : null;
  const lastGpsLng = Number.isFinite(lng) ? lng : null;
  const lastGpsTime = String(gps.time || gps.timestamp || gps.timeMs || '').trim() || null;

  return {
    id,
    odometerMiles,
    engineHours,
    lastGpsLat,
    lastGpsLng,
    lastGpsTime,
    lastLocation: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

async function fetchSamsaraVehicleStatsMap(token, rawRows, logError, scope = 'board') {
  if (!token) return new Map();
  const ids = Array.isArray(rawRows)
    ? rawRows
        .map((r) => String(r?.id || r?.vehicleId || r?.uuid || '').trim())
        .filter(Boolean)
    : [];
  if (!ids.length) return new Map();

  try {
    const payload = await samsaraGet('/fleet/vehicles/stats', token, {
      types: 'gps,obdOdometerMeters,engineSeconds,engineStates,fuelPercents',
      vehicleIds: ids.join(',')
    });
    const { rows } = summarizeSamsaraVehicleStatsPayload(payload);
    const out = new Map();
    for (const row of rows) {
      const mapped = mapSamsaraVehicleStatsRow(row);
      if (mapped?.id) out.set(mapped.id, mapped);
    }
    try {
      console.log(
        `[${scope}] samsara stats snapshot:`,
        JSON.stringify({ count: out.size, sample: rows[0] || null }).slice(0, 500)
      );
    } catch {
      /* ignore logging serialization failures */
    }
    return out;
  } catch (e) {
    logError(`[${scope}] samsara stats call failed`, e);
    return new Map();
  }
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

async function ensureDriverSchedulerTables() {
  if (!getPool()) return false;
  try {
    await dbQuery(`CREATE TABLE IF NOT EXISTS driver_schedules (
      id SERIAL PRIMARY KEY,
      unit_number TEXT NOT NULL,
      driver_id TEXT,
      date DATE NOT NULL,
      leave_type TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(unit_number, date)
    )`);
    await dbQuery(`CREATE TABLE IF NOT EXISTS driver_profiles (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      unit_number TEXT UNIQUE,
      team TEXT,
      manager TEXT,
      cdl_number TEXT,
      cdl_expiry DATE,
      medical_expiry DATE,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'Active',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    return true;
  } catch (e) {
    logError('[drivers] ensureDriverSchedulerTables warning', e);
    return false;
  }
}

function dedupeCatalogNames(names = []) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const v = String(raw || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function ensureFleetCatalogSeedRows(logError) {
  if (!getPool()) return;
  if (fleetCatalogSeedState.done) return;
  if (fleetCatalogSeedState.inFlight) {
    await fleetCatalogSeedState.inFlight;
    return;
  }
  fleetCatalogSeedState.inFlight = (async () => {
    try {
      const st = await dbQuery('SELECT COUNT(*)::int AS c FROM service_types');
      if ((st?.rows?.[0]?.c ?? 0) === 0) {
        await dbQuery(`INSERT INTO service_types (slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model) VALUES
          ('oil_change', 'Oil Change', 'Engine', 25000, 2, 'Auto-seeded common service type for work orders.', NULL, NULL),
          ('tire_rotation', 'Tire Rotation', 'Tires', 30000, 3, 'Auto-seeded common service type for work orders.', NULL, NULL),
          ('brake_inspection', 'Brake Inspection', 'Brakes', 25000, 2, 'Auto-seeded common service type for work orders.', NULL, NULL),
          ('pm_service', 'PM Service', 'Preventive Maintenance', 25000, 2, 'Auto-seeded common service type for work orders.', NULL, NULL),
          ('dot_inspection', 'DOT Inspection', 'Inspection', 12000, 12, 'Auto-seeded common service type for work orders.', NULL, NULL),
          ('engine_diagnostic', 'Engine Diagnostic', 'Engine', 10000, 6, 'Auto-seeded common service type for work orders.', NULL, NULL)
        ON CONFLICT (slug) DO NOTHING`);
      }

      const pr = await dbQuery('SELECT COUNT(*)::int AS c FROM vehicle_parts_reference');
      if ((pr?.rows?.[0]?.c ?? 0) === 0) {
        await dbQuery(`INSERT INTO vehicle_parts_reference (part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid) VALUES
          ('oil_filter', 'Oil Filter', 25000, 2, 24.00),
          ('fuel_filter', 'Fuel Filter', 25000, 2, 58.00),
          ('air_filter', 'Air Filter', 30000, 3, 36.00),
          ('brake_pad_set', 'Brake Pad Set', 60000, 6, 280.00),
          ('drive_tire', 'Drive Tire', 150000, 12, 450.00),
          ('battery_12v', 'Battery 12V', 80000, 24, 160.00),
          ('serpentine_belt', 'Serpentine Belt', 90000, 18, 98.00),
          ('def_filter', 'DEF Filter', 100000, 12, 130.00)
        ON CONFLICT (part_key) DO NOTHING`);
      }
    } catch (e) {
      logError('[fleet catalog seed] ensure rows failed', e);
    } finally {
      fleetCatalogSeedState.done = true;
      fleetCatalogSeedState.inFlight = null;
    }
  })();
  await fleetCatalogSeedState.inFlight;
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

function mapSamsaraVehicleRow(raw = {}, statsById = new Map()) {
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
  const rawOdometerMiles =
    Number.isFinite(odometerMeters) && odometerMeters > 0
      ? Math.round(odometerMeters * 0.000621371)
      : null;

  const engineHoursRaw = Number(
    raw.engineHours ??
      raw.engine_hours ??
      raw.engine?.hours ??
      raw.attributes?.engineHours ??
      NaN
  );
  const rawEngineHours = Number.isFinite(engineHoursRaw) && engineHoursRaw >= 0 ? engineHoursRaw : null;

  const rawLat = Number(
    raw.lastLocation?.latitude ??
      raw.lastLocation?.lat ??
      raw.location?.latitude ??
      raw.location?.lat ??
      raw.gps?.latitude ??
      raw.gps?.lat ??
      raw.attributes?.lastLocation?.latitude ??
      raw.attributes?.lastLocation?.lat ??
      NaN
  );
  const rawLng = Number(
    raw.lastLocation?.longitude ??
      raw.lastLocation?.lng ??
      raw.location?.longitude ??
      raw.location?.lng ??
      raw.gps?.longitude ??
      raw.gps?.lng ??
      raw.attributes?.lastLocation?.longitude ??
      raw.attributes?.lastLocation?.lng ??
      NaN
  );
  const rawGpsTime = String(
    raw.lastLocation?.time ||
      raw.lastLocation?.timestamp ||
      raw.location?.time ||
      raw.location?.timestamp ||
      raw.gps?.time ||
      raw.gps?.timestamp ||
      ''
  ).trim() || null;

  const stats = statsById.get(rawId) || null;
  const lastGpsLat = stats?.lastGpsLat ?? (Number.isFinite(rawLat) ? rawLat : null);
  const lastGpsLng = stats?.lastGpsLng ?? (Number.isFinite(rawLng) ? rawLng : null);
  const lastGpsTime = stats?.lastGpsTime ?? rawGpsTime;
  const odometerMiles = stats?.odometerMiles ?? rawOdometerMiles;
  const engineHours = stats?.engineHours ?? rawEngineHours;

  return {
    id: rawId || unit,
    name: unit,
    make: String(raw.make || raw.attributes?.make || '').trim() || null,
    model: String(raw.model || raw.attributes?.model || '').trim() || null,
    year: Number.isFinite(Number(raw.year ?? raw.attributes?.year)) ? Number(raw.year ?? raw.attributes?.year) : null,
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
    engineHours,
    lastGpsLat,
    lastGpsLng,
    lastGpsTime,
    lastLocation:
      Number.isFinite(Number(lastGpsLat)) && Number.isFinite(Number(lastGpsLng))
        ? { lat: Number(lastGpsLat), lng: Number(lastGpsLng) }
        : null,
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
    return cachedRows.map((row) => mapSamsaraVehicleRow(row)).filter(Boolean);
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
    return rows.map((row) => mapSamsaraVehicleRow(row)).filter(Boolean);
  } catch (e) {
    logError('[samsara] fallback vehicle fetch failed', e);
    return [];
  }
}

function isTruckUnitNumber(unitRaw) {
  const unit = String(unitRaw || '').trim().toUpperCase();
  const m = unit.match(/^T(\d{3})$/);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 120 && n <= 177;
}

function normalizeFleetAssetType(unitNumber, existingType) {
  const t = String(existingType || '').trim();
  if (t) return t;
  return isTruckUnitNumber(unitNumber) ? 'Truck' : 'Trailer';
}

function normalizeFleetAssetStatus(rawStatus) {
  const s = String(rawStatus || '').trim();
  return s || 'Active';
}

function mergeFleetAssetWithSamsara(samsaraRow, assetRow) {
  const unitNumber = String(assetRow?.unit_number || samsaraRow?.name || '').trim();
  const yearOverride = Number(assetRow?.year_override);
  return {
    samsara_id: String(samsaraRow?.id || assetRow?.samsara_id || '').trim(),
    unit_number: unitNumber,
    asset_type: normalizeFleetAssetType(unitNumber, assetRow?.asset_type),
    status: normalizeFleetAssetStatus(assetRow?.status),
    year: Number.isFinite(yearOverride) ? yearOverride : (samsaraRow?.year ?? null),
    make: String(assetRow?.make_override || samsaraRow?.make || '').trim() || null,
    model: String(assetRow?.model_override || samsaraRow?.model || '').trim() || null,
    vin: String(assetRow?.vin_override || samsaraRow?.vin || '').trim() || null,
    licensePlate: String(assetRow?.license_plate_override || samsaraRow?.licensePlate || '').trim() || null,
    notes: String(assetRow?.notes || '').trim() || null,
    odometerMiles: samsaraRow?.odometerMiles ?? null,
    engineHours: samsaraRow?.engineHours ?? null,
    lastGpsLat: samsaraRow?.lastGpsLat ?? null,
    lastGpsLng: samsaraRow?.lastGpsLng ?? null,
    lastGpsTime: samsaraRow?.lastGpsTime ?? null,
    lastLocation: samsaraRow?.lastLocation ?? null,
    updated_at: assetRow?.updated_at || null,
  };
}

async function fetchSamsaraVehiclesForProfiles(logError, scope = 'fleet-assets') {
  const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
  if (!token) return [];
  try {
    const payload = await getVehicles(token);
    const { rows } = summarizeSamsaraVehiclesPayload(payload);
    const statsById = await fetchSamsaraVehicleStatsMap(token, rows, logError, scope);
    return rows.map((row) => mapSamsaraVehicleRow(row, statsById)).filter(Boolean);
  } catch (e) {
    logError(`[${scope}] samsara fetch failed`, e);
    return [];
  }
}

async function seedFleetAssetsFromSamsaraRows(rows = []) {
  if (!getPool() || !Array.isArray(rows) || !rows.length) return;
  await dbQuery('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  for (const r of rows) {
    const samsaraId = String(r?.id || '').trim();
    if (!samsaraId) continue;
    const unitNumber = String(r?.name || '').trim();
    const defaultType = normalizeFleetAssetType(unitNumber, '');
    await dbQuery(
      `INSERT INTO fleet_assets (samsara_id, unit_number, asset_type, status, updated_at)
       VALUES ($1, $2, $3, 'Active', now())
       ON CONFLICT (samsara_id)
       DO UPDATE SET
         unit_number = EXCLUDED.unit_number,
         asset_type = COALESCE(NULLIF(fleet_assets.asset_type, ''), EXCLUDED.asset_type),
         updated_at = now()`,
      [samsaraId, unitNumber || null, defaultType]
    );
  }
}

async function getMergedFleetAssetProfiles(logError) {
  const samsaraRows = await fetchSamsaraVehiclesForProfiles(logError, 'fleet-assets');
  const samsaraById = new Map(samsaraRows.map((r) => [String(r.id), r]));

  if (!getPool()) {
    return samsaraRows.map((r) => mergeFleetAssetWithSamsara(r, null));
  }

  await seedFleetAssetsFromSamsaraRows(samsaraRows);
  const { rows: assetRows } = await dbQuery('SELECT * FROM fleet_assets');
  const merged = [];
  for (const a of assetRows || []) {
    const sid = String(a.samsara_id || '').trim();
    const sam = samsaraById.get(sid) || { id: sid, name: a.unit_number || sid };
    merged.push(mergeFleetAssetWithSamsara(sam, a));
    samsaraById.delete(sid);
  }
  for (const rest of samsaraById.values()) merged.push(mergeFleetAssetWithSamsara(rest, null));
  merged.sort((a, b) => String(a.unit_number || '').localeCompare(String(b.unit_number || '')));
  return merged;
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
          const statsById = await fetchSamsaraVehicleStatsMap(token, rows, logError, 'dashboard');
          vehicles = rows.map((row) => mapSamsaraVehicleRow(row, statsById)).filter(Boolean);
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
          const statsById = await fetchSamsaraVehicleStatsMap(token, rows, logError, 'board');
          vehicles = rows.map((row) => mapSamsaraVehicleRow(row, statsById)).filter(Boolean);
          console.log('[board] samsara direct:', vehicles.length, 'vehicles');
        } catch (e) {
          logError('[board] samsara call failed', e);
        }
      }
      if (!vehicles.length && token) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const payload = await getVehicles(token);
          const { rows } = summarizeSamsaraVehiclesPayload(payload);
          const statsById = await fetchSamsaraVehicleStatsMap(token, rows, logError, 'board-retry');
          vehicles = rows.map((row) => mapSamsaraVehicleRow(row, statsById)).filter(Boolean);
          console.log('[board] samsara retry:', vehicles.length, 'vehicles');
        } catch (_e) {
          // Keep fallback behavior below.
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

    app.get('/api/fleet/assets', async (_req, res) => {
    try {
      const assets = await getMergedFleetAssetProfiles(logError);
      return res.json({ ok: true, assets, count: assets.length });
    } catch (e) {
      logError('GET /api/fleet/assets', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), assets: [] });
    }
  });

  app.put('/api/fleet/assets/:samsara_id', async (req, res) => {
    const samsaraId = String(req.params.samsara_id || '').trim();
    if (!samsaraId) return res.status(400).json({ ok: false, error: 'samsara_id required' });
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });

    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const allowedType = new Set(['Truck', 'Reefer Van', 'Flatbed', 'Dry Van', 'Company Vehicle', 'Trailer', 'Other']);
    const allowedStatus = new Set(['Active', 'In Shop', 'Out of Service', 'Sold', 'Crashed/Total Loss', 'Permanently Removed']);

    const unitNumber = String(b.unit_number || '').trim() || null;
    const assetTypeRaw = String(b.asset_type || '').trim();
    const assetType = allowedType.has(assetTypeRaw) ? assetTypeRaw : normalizeFleetAssetType(unitNumber, '');
    const statusRaw = String(b.status || '').trim();
    const status = allowedStatus.has(statusRaw) ? statusRaw : 'Active';
    const yearNum = Number(b.year_override);

    await dbQuery(
      `INSERT INTO fleet_assets (
         samsara_id, unit_number, asset_type, status, vin_override, license_plate_override,
         year_override, make_override, model_override, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (samsara_id)
       DO UPDATE SET
         unit_number = EXCLUDED.unit_number,
         asset_type = EXCLUDED.asset_type,
         status = EXCLUDED.status,
         vin_override = EXCLUDED.vin_override,
         license_plate_override = EXCLUDED.license_plate_override,
         year_override = EXCLUDED.year_override,
         make_override = EXCLUDED.make_override,
         model_override = EXCLUDED.model_override,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [
        samsaraId,
        unitNumber,
        assetType,
        status,
        String(b.vin_override || '').trim() || null,
        String(b.license_plate_override || '').trim() || null,
        Number.isFinite(yearNum) ? yearNum : null,
        String(b.make_override || '').trim() || null,
        String(b.model_override || '').trim() || null,
        String(b.notes || '').trim() || null,
      ]
    );

    const assets = await getMergedFleetAssetProfiles(logError);
    const updated = assets.find((a) => String(a.samsara_id) === samsaraId) || null;
    return res.json({ ok: true, asset: updated });
  });

  app.get('/api/fleet/assets/units', async (_req, res) => {
    try {
      const assets = await getMergedFleetAssetProfiles(logError);
      const units = assets
        .filter((a) => isTruckUnitNumber(a.unit_number) && String(a.status || '') === 'Active')
        .map((a) => ({
          samsara_id: a.samsara_id,
          unit_number: a.unit_number,
          asset_type: a.asset_type,
          status: a.status,
          make: a.make,
          model: a.model,
          year: a.year,
          vin: a.vin,
          licensePlate: a.licensePlate,
        }))
        .sort((a, b) => String(a.unit_number || '').localeCompare(String(b.unit_number || '')));
      return res.json({ ok: true, units, count: units.length });
    } catch (e) {
      logError('GET /api/fleet/assets/units', e);
      return res.json({ ok: true, units: [], count: 0 });
    }
  });

  app.get('/api/maintenance/service-types', async (_req, res) => {
    try {
      const fallback = dedupeCatalogNames([
        ...COMMON_WORK_ORDER_SERVICE_TYPE_SEEDS,
        ...MAINTENANCE_SERVICE_CATALOG_SEEDS
      ]);
      if (!getPool()) {
        return res.json({ ok: true, names: fallback });
      }
      await ensureFleetCatalogSeedRows(logError);
      const [maintRows, serviceRows] = await Promise.all([
        dbQuery(`SELECT name FROM maintenance_service_catalog WHERE active = true ORDER BY sort_order, name`)
          .then(r => r.rows || [])
          .catch(() => []),
        dbQuery(`SELECT name FROM service_types ORDER BY name`)
          .then(r => r.rows || [])
          .catch(() => [])
      ]);
      const names = dedupeCatalogNames([
        ...fallback,
        ...maintRows.map(r => String(r.name || '').trim()),
        ...serviceRows.map(r => String(r.name || '').trim())
      ]);
      return res.json({ ok: true, names: names.length ? names : fallback });
    } catch (e) {
      logError('GET /api/maintenance/service-types', e);
      return res.json({ ok: true, names: dedupeCatalogNames([...COMMON_WORK_ORDER_SERVICE_TYPE_SEEDS, ...MAINTENANCE_SERVICE_CATALOG_SEEDS]) });
    }
  });

  app.get('/api/maintenance/parts-reference', async (_req, res) => {
    const fallbackParts = COMMON_PARTS_REFERENCE_SEEDS.map(p => ({ ...p }));
    const fallbackNames = dedupeCatalogNames(fallbackParts.map(p => p.label));
    try {
      if (!getPool()) {
        return res.json({ ok: true, names: fallbackNames, parts: fallbackParts });
      }
      await ensureFleetCatalogSeedRows(logError);
      const { rows } = await dbQuery(
        `SELECT part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid
           FROM vehicle_parts_reference
          ORDER BY label`
      );
      const parts = (rows || [])
        .map(r => ({
          part_key: String(r.part_key || '').trim(),
          label: String(r.label || '').trim(),
          avg_replacement_miles: r.avg_replacement_miles == null ? null : Number(r.avg_replacement_miles),
          avg_replacement_months: r.avg_replacement_months == null ? null : Number(r.avg_replacement_months),
          avg_cost_mid: r.avg_cost_mid == null ? null : Number(r.avg_cost_mid)
        }))
        .filter(r => r.part_key && r.label);
      const names = dedupeCatalogNames(parts.map(p => p.label));
      return res.json({
        ok: true,
        names: names.length ? names : fallbackNames,
        parts: parts.length ? parts : fallbackParts
      });
    } catch (e) {
      logError('GET /api/maintenance/parts-reference', e);
      return res.json({ ok: true, names: fallbackNames, parts: fallbackParts });
    }
  });

  app.get('/api/parts', async (req, res) => {
    const q = String(req.query?.q || '').trim().toLowerCase();
    try {
      const fromMaint = await (async () => {
        if (!getPool()) return [];
        await ensureFleetCatalogSeedRows(logError);
        const { rows } = await dbQuery(
          `SELECT part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid
             FROM vehicle_parts_reference
            ORDER BY label`
        );
        return (rows || []).map((r) => ({
          part_key: String(r.part_key || '').trim(),
          label: String(r.label || '').trim(),
          avg_replacement_miles: r.avg_replacement_miles == null ? null : Number(r.avg_replacement_miles),
          avg_replacement_months: r.avg_replacement_months == null ? null : Number(r.avg_replacement_months),
          avg_cost_mid: r.avg_cost_mid == null ? null : Number(r.avg_cost_mid),
        })).filter((r) => r.part_key && r.label);
      })();
      const fallback = COMMON_PARTS_REFERENCE_SEEDS.map((r) => ({ ...r }));
      let parts = fromMaint.length ? fromMaint : fallback;
      if (q) {
        parts = parts.filter((p) => {
          const hay = `${p.part_key || ''} ${p.label || ''}`.toLowerCase();
          return hay.includes(q);
        });
      }
      return res.json({ ok: true, parts, names: dedupeCatalogNames(parts.map((p) => p.label)) });
    } catch (e) {
      logError('GET /api/parts', e);
      const fallback = COMMON_PARTS_REFERENCE_SEEDS
        .filter((p) => !q || `${p.part_key} ${p.label}`.toLowerCase().includes(q))
        .map((p) => ({ ...p }));
      return res.json({ ok: true, parts: fallback, names: dedupeCatalogNames(fallback.map((p) => p.label)) });
    }
  });

  app.post('/api/fleet/assets/bulk', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const rows = Array.isArray(req.body?.records) ? req.body.records : Array.isArray(req.body) ? req.body : [];
      let inserted = 0;
      let updated = 0;
      let errors = 0;

      // Ensure unit_number can be used for UPSERT conflict target.
      try {
        await dbQuery('ALTER TABLE fleet_assets ADD CONSTRAINT fleet_assets_unit_number_key UNIQUE (unit_number)');
      } catch (_) {
        /* already exists or duplicates; fallback path below handles update-by-select */
      }

      for (const r of rows) {
        try {
          const unit = String(r?.unit_number || '').trim();
          if (!unit) continue;
          const cleanUnit = unit.toUpperCase();
          const payload = [
            cleanUnit,
            String(r?.asset_type || normalizeFleetAssetType(cleanUnit, '')).trim() || 'Trailer',
            String(r?.status || 'Active').trim() || 'Active',
            String(r?.vin || '').trim() || null,
            String(r?.license_plate || '').trim() || null,
            Number.isFinite(Number(r?.year)) ? Number(r?.year) : null,
            String(r?.make || '').trim() || null,
            String(r?.model || '').trim() || null,
            String(r?.notes || '').trim() || null,
          ];

          try {
            const { rows: upRows } = await dbQuery(
              `INSERT INTO fleet_assets (
                samsara_id, unit_number, asset_type, status,
                vin_override, license_plate_override, year_override,
                make_override, model_override, notes, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
              ON CONFLICT (unit_number)
              DO UPDATE SET
                asset_type = EXCLUDED.asset_type,
                status = EXCLUDED.status,
                vin_override = EXCLUDED.vin_override,
                license_plate_override = EXCLUDED.license_plate_override,
                year_override = EXCLUDED.year_override,
                make_override = EXCLUDED.make_override,
                model_override = EXCLUDED.model_override,
                notes = EXCLUDED.notes,
                updated_at = now()
              RETURNING (xmax = 0) AS inserted`,
              [String(r?.samsara_id || `local-${cleanUnit}`).trim(), ...payload]
            );
            const wasInserted = !!upRows?.[0]?.inserted;
            if (wasInserted) inserted++;
            else updated++;
          } catch {
            // Fallback when UNIQUE(unit_number) is unavailable in existing DBs.
            const existing = await dbQuery('SELECT samsara_id FROM fleet_assets WHERE lower(unit_number)=lower($1) LIMIT 1', [cleanUnit]);
            if (existing.rows?.length) {
              await dbQuery(
                `UPDATE fleet_assets
                   SET asset_type=$2,
                       status=$3,
                       vin_override=$4,
                       license_plate_override=$5,
                       year_override=$6,
                       make_override=$7,
                       model_override=$8,
                       notes=$9,
                       updated_at=now()
                 WHERE lower(unit_number)=lower($1)`,
                [cleanUnit, ...payload.slice(1)]
              );
              updated++;
            } else {
              await dbQuery(
                `INSERT INTO fleet_assets (
                  samsara_id, unit_number, asset_type, status,
                  vin_override, license_plate_override, year_override,
                  make_override, model_override, notes, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
                [String(r?.samsara_id || `local-${cleanUnit}`).trim(), ...payload]
              );
              inserted++;
            }
          }
        } catch {
          errors++;
        }
      }
      return res.json({ ok: true, inserted, updated, errors, total: rows.length });
    } catch (e) {
      logError('POST /api/fleet/assets/bulk', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


  app.get('/api/drivers/profiles', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, drivers: [] });
      await ensureDriverSchedulerTables();
      const { rows } = await dbQuery('SELECT * FROM driver_profiles ORDER BY unit_number NULLS LAST, full_name NULLS LAST');
      return res.json({ ok: true, drivers: rows || [] });
    } catch (e) {
      logError('GET /api/drivers/profiles', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), drivers: [] });
    }
  });

  app.post('/api/drivers/profiles', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const unit = String(b.unit_number || '').trim();
      if (!unit) return res.status(400).json({ ok: false, error: 'unit_number is required' });
      const fullName = String(b.full_name || '').trim();
      await dbQuery(
        `INSERT INTO driver_profiles (
          full_name, unit_number, team, manager, cdl_number, cdl_expiry,
          medical_expiry, phone, email, status, notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
        ON CONFLICT (unit_number)
        DO UPDATE SET
          full_name = EXCLUDED.full_name,
          team = EXCLUDED.team,
          manager = EXCLUDED.manager,
          cdl_number = EXCLUDED.cdl_number,
          cdl_expiry = EXCLUDED.cdl_expiry,
          medical_expiry = EXCLUDED.medical_expiry,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          notes = EXCLUDED.notes,
          updated_at = now()`,
        [
          fullName || null,
          unit,
          String(b.team || '').trim() || null,
          String(b.manager || '').trim() || null,
          String(b.cdl_number || '').trim() || null,
          String(b.cdl_expiry || '').trim() || null,
          String(b.medical_expiry || '').trim() || null,
          String(b.phone || '').trim() || null,
          String(b.email || '').trim() || null,
          String(b.status || 'Active').trim() || 'Active',
          String(b.notes || '').trim() || null,
        ]
      );
      const { rows } = await dbQuery('SELECT * FROM driver_profiles WHERE unit_number = $1 LIMIT 1', [unit]);
      return res.json({ ok: true, driver: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/drivers/profiles', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/drivers/schedule', async (req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, rows: [] });
      await ensureDriverSchedulerTables();
      const month = String(req.query?.month || '').trim();
      const monthNorm = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
      const start = `${monthNorm}-01`;
      const d = new Date(`${start}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const end = d.toISOString().slice(0, 10);
      const { rows } = await dbQuery(
        'SELECT * FROM driver_schedules WHERE date >= $1 AND date < $2 ORDER BY date, unit_number',
        [start, end]
      );
      return res.json({ ok: true, rows: rows || [] });
    } catch (e) {
      logError('GET /api/drivers/schedule', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [] });
    }
  });

  app.post('/api/drivers/schedule', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const unit = String(b.unit_number || '').trim();
      const date = String(b.date || '').trim();
      if (!unit || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ ok: false, error: 'unit_number and date (YYYY-MM-DD) are required' });
      }
      const leaveType = String(b.leave_type || '').trim() || 'Working';
      const notes = String(b.notes || '').trim() || null;
      const driverId = String(b.driver_id || '').trim() || null;
      const { rows } = await dbQuery(
        `INSERT INTO driver_schedules (unit_number, driver_id, date, leave_type, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,now(),now())
         ON CONFLICT (unit_number, date)
         DO UPDATE SET
           driver_id = EXCLUDED.driver_id,
           leave_type = EXCLUDED.leave_type,
           notes = EXCLUDED.notes,
           updated_at = now()
         RETURNING *`,
        [unit, driverId, date, leaveType, notes]
      );
      return res.json({ ok: true, row: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/drivers/schedule', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/drivers/schedule/:id', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
      await dbQuery('DELETE FROM driver_schedules WHERE id = $1', [id]);
      return res.json({ ok: true, deleted: id });
    } catch (e) {
      logError('DELETE /api/drivers/schedule/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/drivers/hos-status', async (_req, res) => {
    const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
    if (!token) return res.json({ ok: true, rows: [] });
    try {
      const payload = await samsaraGet('/fleet/drivers/hos/clocks', token, {});
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.clocks) ? payload.clocks : [];
      return res.json({ ok: true, rows });
    } catch (e) {
      logError('GET /api/drivers/hos-status', e);
      return res.json({ ok: true, rows: [] });
    }
  });

  app.get('/api/equipment/checklist', async (req, res) => {
    const unit = String(req.query.unit || '').trim();
    if (!unit) return res.json({ ok: false, error: 'unit required' });
    try {
      const pool = getPool();
      let items = [];
      if (pool) {
        await dbQuery(
          `CREATE TABLE IF NOT EXISTS equipment_checklist (
            id SERIAL PRIMARY KEY,
            unit_number TEXT NOT NULL,
            item_name TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            category TEXT,
            sort_order INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active'
          )`
        );
        const { rows } = await dbQuery(
          'SELECT * FROM equipment_checklist WHERE unit_number=$1 ORDER BY sort_order, item_name',
          [unit]
        );
        items = rows || [];
      }
      if (!items.length) {
        items = [
          { id: 1, item_name: 'Tarp 20x20', quantity: 4, category: 'tarps' },
          { id: 2, item_name: 'Tarp 24x24', quantity: 2, category: 'tarps' },
          { id: 3, item_name: '4x4 Oak log', quantity: 8, category: 'lumber' },
          { id: 4, item_name: 'Bungee cord', quantity: 20, category: 'straps' },
          { id: 5, item_name: 'Load strap 2"', quantity: 8, category: 'straps' },
          { id: 6, item_name: 'Load lock bar', quantity: 4, category: 'locks' },
          { id: 7, item_name: 'Corner protector', quantity: 12, category: 'protection' },
          { id: 8, item_name: 'Chain binder', quantity: 4, category: 'straps' },
        ].map((i, idx) => ({ ...i, unit_number: unit, sort_order: idx, status: 'active' }));
      }
      res.json({ ok: true, unit, items });
    } catch (e) {
      logError('GET /api/equipment/checklist', e);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/equipment/checklist/submit', async (req, res) => {
    const { unit, driver, items, timestamp } = req.body || {};
    try {
      const pool = getPool();
      if (pool) {
        await dbQuery(
          `CREATE TABLE IF NOT EXISTS equipment_submissions (
            id SERIAL PRIMARY KEY,
            unit_number TEXT,
            driver_name TEXT,
            submitted_at TIMESTAMPTZ DEFAULT NOW(),
            items JSONB,
            all_confirmed BOOLEAN
          )`
        );
        const allConfirmed = Array.isArray(items) && items.every(i => i.status === 'confirmed');
        await dbQuery(
          'INSERT INTO equipment_submissions (unit_number, driver_name, submitted_at, items, all_confirmed) VALUES ($1,$2,$3,$4,$5)',
          [unit, driver, timestamp || new Date().toISOString(), JSON.stringify(items || []), allConfirmed]
        );
      }
      res.json({ ok: true, message: 'Checklist submitted', report_id: Date.now() });
    } catch (e) {
      logError('POST /api/equipment/checklist/submit', e);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/damage/report', async (req, res) => {
    const { unit, driver, damage_type, description, photos, location, timestamp } = req.body || {};
    try {
      const pool = getPool();
      if (pool) {
        await dbQuery(
          `CREATE TABLE IF NOT EXISTS damage_reports (
            id SERIAL PRIMARY KEY,
            unit_number TEXT,
            driver_name TEXT,
            damage_type TEXT,
            description TEXT,
            photos JSONB,
            location JSONB,
            reported_at TIMESTAMPTZ DEFAULT NOW(),
            status TEXT DEFAULT 'new'
          )`
        );
        await dbQuery(
          'INSERT INTO damage_reports (unit_number, driver_name, damage_type, description, photos, location, reported_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [unit, driver, damage_type, description, JSON.stringify(photos || []), JSON.stringify(location || {}), timestamp || new Date().toISOString()]
        );
      }
      const reportId = 'DMG-' + Date.now().toString().slice(-6);
      res.json({ ok: true, report_id: reportId, message: 'Damage report submitted' });
    } catch (e) {
      logError('POST /api/damage/report', e);
      res.json({ ok: false, error: e.message });
    }
  });

  app.get('/api/equipment/submissions', async (req, res) => {
    const unit = req.query.unit;
    try {
      const pool = getPool();
      if (!pool) return res.json({ ok: true, submissions: [] });
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS equipment_submissions (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          submitted_at TIMESTAMPTZ DEFAULT NOW(),
          items JSONB,
          all_confirmed BOOLEAN
        )`
      );
      const q = unit
        ? 'SELECT * FROM equipment_submissions WHERE unit_number=$1 ORDER BY submitted_at DESC LIMIT 50'
        : 'SELECT * FROM equipment_submissions ORDER BY submitted_at DESC LIMIT 100';
      const { rows } = await dbQuery(q, unit ? [unit] : []);
      res.json({ ok: true, submissions: rows });
    } catch (e) {
      res.json({ ok: true, submissions: [] });
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
