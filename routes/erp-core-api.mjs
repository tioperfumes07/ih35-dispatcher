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
import { createQboApiClient } from '../lib/qbo-api-client.mjs';
import { getVehicles, samsaraGet, getDriverVehicleAssignments } from '../services/samsara.js';

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
let qboCatalogAutoSyncTimer = null;
let qboSyncQueueRetryTimer = null;

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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    const alterCols = [
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS phone TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS email TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS cdl_number TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS cdl_state TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS cdl_expiry DATE',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS medical_expiry DATE',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS hire_date DATE',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS emergency_contact TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS emergency_phone TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS qbo_vendor_id TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS qbo_vendor_name TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS samsara_driver_id TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS license_number TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS notes TEXT',
      'ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()'
    ];
    for (const sql of alterCols) {
      await dbQuery(sql);
    }

    await dbQuery(`
      CREATE UNIQUE INDEX IF NOT EXISTS driver_profiles_samsara_id_idx
      ON driver_profiles (samsara_driver_id)
      WHERE samsara_driver_id IS NOT NULL
    `);

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

async function ensureFleetAssetQboClassesTable(dbCtx = {}) {
  const getPoolFn = typeof dbCtx.getPool === 'function' ? dbCtx.getPool : getPool;
  const dbQueryFn = typeof dbCtx.dbQuery === 'function' ? dbCtx.dbQuery : dbQuery;
  if (!getPoolFn()) return false;
  await dbQueryFn(`
    CREATE TABLE IF NOT EXISTS fleet_asset_qbo_classes (
      unit_number TEXT PRIMARY KEY,
      qbo_class_id TEXT,
      qbo_class_name TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  return true;
}

async function ensureIntegrationResilienceTables() {
  if (!getPool()) return false;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qbo_catalog_cache (
      entity_type TEXT NOT NULL,
      qbo_id TEXT NOT NULL,
      name TEXT NOT NULL,
      full_data JSONB,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (entity_type, qbo_id)
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qbo_sync_queue (
      id SERIAL PRIMARY KEY,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER,
      payload JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      synced_at TIMESTAMPTZ,
      retry_count INTEGER DEFAULT 0
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS samsara_vehicle_assignments (
      unit_number TEXT PRIMARY KEY,
      driver_name TEXT,
      driver_samsara_id TEXT,
      duty_status TEXT,
      last_updated TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  return true;
}

async function getIntegrationSetting(settingKey) {
  if (!getPool()) return null;
  await ensureIntegrationResilienceTables();
  const { rows } = await dbQuery(
    'SELECT setting_value FROM integration_settings WHERE setting_key = $1 LIMIT 1',
    [String(settingKey || '').trim()]
  );
  return String(rows?.[0]?.setting_value || '').trim() || null;
}

async function setIntegrationSetting(settingKey, settingValue) {
  if (!getPool()) return;
  await ensureIntegrationResilienceTables();
  await dbQuery(
    `INSERT INTO integration_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [String(settingKey || '').trim(), settingValue == null ? null : String(settingValue)]
  );
}

function normalizeQboCatalogRow(entityType, row) {
  const qboId = String(
    row?.Id || row?.id || row?.qboId || row?.value || row?.AcctNum || row?.DocNumber || ''
  ).trim();
  const name = String(
    row?.DisplayName || row?.Name || row?.FullyQualifiedName || row?.PrintOnCheckName || row?.name || ''
  ).trim();
  if (!qboId || !name) return null;
  return {
    entity_type: String(entityType || '').trim().toLowerCase(),
    qbo_id: qboId,
    name,
    full_data: row || {},
  };
}

async function fetchLiveQboCatalogBundle() {
  const qbo = createQboApiClient();
  const [vendorResp, accountResp, itemResp, classResp, customerResp] = await Promise.all([
    qbo.qboQuery('SELECT * FROM Vendor MAXRESULTS 1000'),
    qbo.qboQuery('SELECT * FROM Account MAXRESULTS 1000'),
    qbo.qboQuery('SELECT * FROM Item MAXRESULTS 1000'),
    qbo.qboQuery('SELECT * FROM Class MAXRESULTS 1000'),
    qbo.qboQuery('SELECT * FROM Customer MAXRESULTS 1000'),
  ]);
  const vendors = Array.isArray(vendorResp?.QueryResponse?.Vendor) ? vendorResp.QueryResponse.Vendor : [];
  const accounts = Array.isArray(accountResp?.QueryResponse?.Account) ? accountResp.QueryResponse.Account : [];
  const items = Array.isArray(itemResp?.QueryResponse?.Item) ? itemResp.QueryResponse.Item : [];
  const classes = Array.isArray(classResp?.QueryResponse?.Class) ? classResp.QueryResponse.Class : [];
  const customers = Array.isArray(customerResp?.QueryResponse?.Customer) ? customerResp.QueryResponse.Customer : [];
  return { vendors, accounts, items, classes, customers };
}

function normalizeMasterBundle(bundle) {
  const vendors = Array.isArray(bundle?.vendors) ? bundle.vendors : [];
  const accounts = Array.isArray(bundle?.accounts) ? bundle.accounts : [];
  const items = Array.isArray(bundle?.items) ? bundle.items : [];
  const classes = Array.isArray(bundle?.classes) ? bundle.classes : [];
  const customers = Array.isArray(bundle?.customers) ? bundle.customers : [];
  const accountsExpense = accounts.filter((a) => {
    const t = String(a?.AccountType || a?.accountType || '').trim();
    return t === 'Expense' || t === 'Cost of Goods Sold';
  });
  const accountsIncome = accounts.filter((a) => String(a?.AccountType || a?.accountType || '').trim() === 'Income');
  const accountsBank = accounts.filter((a) => {
    const t = String(a?.AccountType || a?.accountType || '').trim();
    return t === 'Bank' || t === 'Credit Card';
  });
  return {
    vendors,
    items,
    accounts,
    accountsExpense,
    accountsIncome,
    customers,
    classes,
    accountsBank,
    paymentMethods: [],
    employees: [],
    terms: [],
    transactionActivity: null,
  };
}

async function upsertQboCatalogBundle(bundle) {
  if (!getPool()) return { vendors: 0, accounts: 0, items: 0, classes: 0, customers: 0 };
  await ensureIntegrationResilienceTables();
  const entityMap = [
    ['vendor', Array.isArray(bundle?.vendors) ? bundle.vendors : []],
    ['account', Array.isArray(bundle?.accounts) ? bundle.accounts : []],
    ['item', Array.isArray(bundle?.items) ? bundle.items : []],
    ['class', Array.isArray(bundle?.classes) ? bundle.classes : []],
    ['customer', Array.isArray(bundle?.customers) ? bundle.customers : []],
  ];
  const counts = { vendors: 0, accounts: 0, items: 0, classes: 0, customers: 0 };
  for (const [entityType, rows] of entityMap) {
    for (const row of rows) {
      const normalized = normalizeQboCatalogRow(entityType, row);
      if (!normalized) continue;
      await dbQuery(
        `INSERT INTO qbo_catalog_cache (entity_type, qbo_id, name, full_data, last_synced_at)
         VALUES ($1,$2,$3,$4::jsonb,now())
         ON CONFLICT (entity_type, qbo_id)
         DO UPDATE SET name = EXCLUDED.name, full_data = EXCLUDED.full_data, last_synced_at = now()`,
        [normalized.entity_type, normalized.qbo_id, normalized.name, JSON.stringify(normalized.full_data || {})]
      );
      if (entityType === 'vendor') counts.vendors += 1;
      if (entityType === 'account') counts.accounts += 1;
      if (entityType === 'item') counts.items += 1;
      if (entityType === 'class') counts.classes += 1;
      if (entityType === 'customer') counts.customers += 1;
    }
  }
  return counts;
}

async function readQboCatalogBundleFromCache() {
  if (!getPool()) return { bundle: normalizeMasterBundle({}), cacheAge: null, refreshedAt: null };
  await ensureIntegrationResilienceTables();
  const { rows } = await dbQuery(
    `SELECT entity_type, full_data, last_synced_at
       FROM qbo_catalog_cache
      WHERE entity_type = ANY($1::text[])`,
    [['vendor', 'account', 'item', 'class', 'customer']]
  );
  const grouped = { vendors: [], accounts: [], items: [], classes: [], customers: [] };
  let newest = null;
  for (const row of rows || []) {
    const et = String(row?.entity_type || '').trim().toLowerCase();
    const full = row?.full_data && typeof row.full_data === 'object' ? row.full_data : {};
    const at = row?.last_synced_at ? Date.parse(String(row.last_synced_at)) : NaN;
    if (Number.isFinite(at)) newest = newest == null ? at : Math.max(newest, at);
    if (et === 'vendor') grouped.vendors.push(full);
    if (et === 'account') grouped.accounts.push(full);
    if (et === 'item') grouped.items.push(full);
    if (et === 'class') grouped.classes.push(full);
    if (et === 'customer') grouped.customers.push(full);
  }
  const bundle = normalizeMasterBundle(grouped);
  const cacheAge = newest == null ? null : Math.max(0, Math.round((Date.now() - newest) / 60000));
  return { bundle, cacheAge, refreshedAt: newest == null ? null : new Date(newest).toISOString() };
}

async function syncQboCatalogCacheNow(logError, opts = {}) {
  if (!qboConnectionFlags().connected) return { ok: false, error: 'qbo_not_connected', synced: { vendors: 0, accounts: 0, items: 0, classes: 0 } };
  try {
    const live = await fetchLiveQboCatalogBundle();
    const counts = await upsertQboCatalogBundle(live);
    const nowIso = new Date().toISOString();
    await setIntegrationSetting('qbo_catalog_last_sync_at', nowIso);
    return {
      ok: true,
      source: 'live',
      synced: {
        vendors: Number(counts.vendors || 0),
        accounts: Number(counts.accounts || 0),
        items: Number(counts.items || 0),
        classes: Number(counts.classes || 0),
      },
      bundle: normalizeMasterBundle(live),
      refreshedAt: nowIso,
      cacheAge: 0,
    };
  } catch (e) {
    if (!opts?.silent) logError('syncQboCatalogCacheNow', e);
    const cached = await readQboCatalogBundleFromCache();
    return {
      ok: false,
      error: e?.message || String(e),
      source: 'cache',
      synced: { vendors: 0, accounts: 0, items: 0, classes: 0 },
      bundle: cached.bundle,
      refreshedAt: cached.refreshedAt,
      cacheAge: cached.cacheAge,
    };
  }
}

async function upsertSamsaraAssignmentsFromHosRows(rows = []) {
  if (!getPool()) return 0;
  await ensureIntegrationResilienceTables();
  let count = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const unit = String(row?.currentVehicle?.name || '').trim();
    const driverName = String(row?.driver?.name || '').trim();
    if (!unit || !driverName) continue;
    const driverId = String(row?.driver?.id || '').trim() || null;
    const duty = String(row?.currentDutyStatus?.hosStatusType || '').trim().toLowerCase() || 'unknown';
    await dbQuery(
      `INSERT INTO samsara_vehicle_assignments (unit_number, driver_name, driver_samsara_id, duty_status, last_updated)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (unit_number)
       DO UPDATE SET driver_name = EXCLUDED.driver_name,
                     driver_samsara_id = EXCLUDED.driver_samsara_id,
                     duty_status = EXCLUDED.duty_status,
                     last_updated = now()`,
      [unit, driverName, driverId, duty]
    );
    count += 1;
  }
  return count;
}

async function readCachedSamsaraAssignments() {
  if (!getPool()) return [];
  await ensureIntegrationResilienceTables();
  const { rows } = await dbQuery(
    `SELECT unit_number, driver_name, driver_samsara_id, duty_status, last_updated
       FROM samsara_vehicle_assignments
      ORDER BY unit_number`
  );
  return rows || [];
}

async function enqueueQboSyncQueue(transactionType, transactionId, payload, errorMessage) {
  if (!getPool()) return null;
  await ensureIntegrationResilienceTables();
  const { rows } = await dbQuery(
    `INSERT INTO qbo_sync_queue (transaction_type, transaction_id, payload, status, error_message, created_at)
     VALUES ($1,$2,$3::jsonb,'pending',$4,now())
     RETURNING id`,
    [
      String(transactionType || '').trim() || 'unknown',
      Number.isFinite(Number(transactionId)) ? Number(transactionId) : null,
      JSON.stringify(payload || {}),
      String(errorMessage || '').trim() || null,
    ]
  );
  return rows?.[0]?.id || null;
}

async function retryQboSyncQueue(logError, opts = {}) {
  if (!getPool()) return { ok: true, synced: 0, failed: 0, skipped: 0 };
  await ensureIntegrationResilienceTables();
  const limit = Number.isFinite(Number(opts?.limit)) ? Math.max(1, Number(opts.limit)) : 200;
  const qboFlags = qboConnectionFlags();
  if (!qboFlags.connected) return { ok: true, synced: 0, failed: 0, skipped: 0, reason: 'qbo_not_connected' };
  const { rows } = await dbQuery(
    `SELECT * FROM qbo_sync_queue
      WHERE status IN ('pending','failed')
      ORDER BY created_at ASC, id ASC
      LIMIT $1`,
    [limit]
  );
  const items = rows || [];
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    try {
      if (String(item.transaction_type || '').toLowerCase() === 'fuel' || payload?.mode === 'fuel_expense_post') {
        const expenseId = Number(payload?.expense_id || item?.transaction_id);
        if (!Number.isFinite(expenseId)) throw new Error('fuel expense_id missing');
        const { rows: expenseRows } = await dbQuery('SELECT * FROM fuel_expenses WHERE id = $1 LIMIT 1', [expenseId]);
        const expense = expenseRows?.[0] || null;
        if (!expense) throw new Error('fuel expense not found');
        const posted = await postFuelExpenseToQbo(expense);
        if (!posted?.ok) throw new Error(String(posted?.reason || 'QBO fuel sync failed'));
      } else if (payload?.qboEntity && payload?.qboPayload && typeof payload.qboPayload === 'object') {
        const qbo = createQboApiClient();
        await qbo.qboPost(String(payload.qboEntity || '').trim().toLowerCase(), payload.qboPayload);
      } else {
        skipped += 1;
        await dbQuery(
          `UPDATE qbo_sync_queue
              SET status = 'skipped', error_message = $2, retry_count = COALESCE(retry_count,0) + 1
            WHERE id = $1`,
          [item.id, 'Unsupported queue payload']
        );
        continue;
      }
      synced += 1;
      await dbQuery(
        `UPDATE qbo_sync_queue
            SET status = 'synced', error_message = NULL, synced_at = now()
          WHERE id = $1`,
        [item.id]
      );
    } catch (e) {
      failed += 1;
      await dbQuery(
        `UPDATE qbo_sync_queue
            SET status = 'failed', error_message = $2, retry_count = COALESCE(retry_count,0) + 1
          WHERE id = $1`,
        [item.id, String(e?.message || e || 'QBO sync failed').slice(0, 800)]
      );
      logError('retryQboSyncQueue item failed', e);
    }
  }
  return { ok: true, synced, failed, skipped };
}

/**
 * @param {import('express').Application} app
 * @param {{ logError?: (msg: string, err?: unknown) => void, getPool?: () => unknown, dbQuery?: (sql: string, params?: unknown[]) => Promise<any> }} [opts]
 */
export function mountErpCoreApi(app, opts = {}) {
  const logError = opts.logError || console.error;
  const getPoolForRoute = typeof opts.getPool === 'function' ? opts.getPool : getPool;
  const dbQueryForRoute = typeof opts.dbQuery === 'function' ? opts.dbQuery : dbQuery;

  function maintActor(req) {
    return String(req.headers['x-ih35-user'] || req.headers['x-user-email'] || 'operator').trim() || 'operator';
  }

  async function ensureWorkOrdersTable() {
    await dbQueryForRoute(
      `CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        unit_number TEXT,
        service_type TEXT,
        description TEXT,
        vendor TEXT,
        estimated_cost NUMERIC,
        priority TEXT,
        status TEXT,
        source TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
  }

  if (!qboCatalogAutoSyncTimer) {
    qboCatalogAutoSyncTimer = setInterval(async () => {
      try {
        if (!getPool()) return;
        if (!qboConnectionFlags().connected) return;
        const lastSyncRaw = await getIntegrationSetting('qbo_catalog_last_sync_at').catch(() => null);
        const lastSyncMs = lastSyncRaw ? Date.parse(String(lastSyncRaw)) : NaN;
        const ageMs = Number.isFinite(lastSyncMs) ? (Date.now() - lastSyncMs) : Number.POSITIVE_INFINITY;
        if (ageMs < 24 * 60 * 60 * 1000) return;
        await syncQboCatalogCacheNow(logError, { silent: true });
      } catch (e) {
        logError('qbo catalog auto-sync interval', e);
      }
    }, 60 * 60 * 1000);
  }

  if (!qboSyncQueueRetryTimer) {
    qboSyncQueueRetryTimer = setInterval(async () => {
      try {
        if (!getPool()) return;
        if (!qboConnectionFlags().connected) return;
        await retryQboSyncQueue(logError, { limit: 500 });
      } catch (e) {
        logError('qbo queue retry interval', e);
      }
    }, 15 * 60 * 1000);
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

  app.get('/api/health/sync', async (_req, res) => {
    const empty = {
      damage_reports: null,
      fuel_expenses: null,
      work_orders: null,
      leave_requests: null,
      qbo_sync_queue: null,
      driver_schedules: null,
    };
    try {
      if (!getPoolForRoute()) {
        return res.json({ ok: true, sync: empty, updated_at: null });
      }
      const out = { ...empty };
      const tableNames = Object.keys(out);
      for (const table of tableNames) {
        try {
          const reg = await dbQueryForRoute(`SELECT to_regclass($1) AS name`, [`public.${table}`]);
          if (!reg?.rows?.[0]?.name) continue;
          const { rows } = await dbQueryForRoute(
            `SELECT
              COALESCE(
                MAX(COALESCE(updated_at, submitted_at, reported_at, reviewed_at, synced_at, created_at)),
                MAX(created_at)
              ) AS latest
             FROM ${table}`
          );
          out[table] = rows?.[0]?.latest || null;
        } catch (_) {
          out[table] = null;
        }
      }
      const updatedAt = Object.values(out)
        .map((v) => (v ? Date.parse(String(v)) : NaN))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => b - a)[0];
      return res.json({
        ok: true,
        sync: out,
        updated_at: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : null,
      });
    } catch (e) {
      logError('GET /api/health/sync', e);
      return res.json({ ok: true, sync: empty, updated_at: null });
    }
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

  app.get('/api/qbo/status', async (_req, res) => {
    const { configured, connected, companyName, lastRefreshError, lastRefreshErrorAt } = qboConnectionFlags();
    let catalogLastSyncedAt = null;
    let cacheAgeMinutes = null;
    if (getPool()) {
      const last = await getIntegrationSetting('qbo_catalog_last_sync_at').catch(() => null);
      catalogLastSyncedAt = last || null;
      const ms = last ? Date.parse(String(last)) : NaN;
      cacheAgeMinutes = Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 60000)) : null;
    }
    res.json({
      ok: true,
      configured,
      connected,
      companyName: companyName || undefined,
      lastRefreshError: lastRefreshError || undefined,
      lastRefreshErrorAt: lastRefreshErrorAt || undefined,
      catalogUiPollMinutes: 1,
      catalogUiPollMs: QBO_LIVE_REFRESH_MS,
      catalogLastSyncedAt,
      cacheAgeMinutes,
      source: connected ? 'live' : 'cache',
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
  app.get('/api/qbo/master', async (_req, res) => {
    const arr = (v) => (Array.isArray(v) ? v : []);
    const erp = readFullErpJson();
    const erpCache = erp?.qboCache && typeof erp.qboCache === 'object' ? erp.qboCache : {};

    if (!getPool()) {
      const normalized = normalizeMasterBundle({
        vendors: arr(erpCache.vendors),
        items: arr(erpCache.items),
        accounts: arr(erpCache.accounts),
        classes: arr(erpCache.classes),
        customers: arr(erpCache.customers),
      });
      return res.json({ ...normalized, source: 'cache', cacheAge: null, refreshedAt: erp?.refreshedAt || null });
    }

    try {
      await ensureIntegrationResilienceTables();

      let source = 'cache';
      let cacheAge = null;
      let refreshedAt = null;
      let bundle = null;

      if (qboConnectionFlags().connected) {
        const synced = await syncQboCatalogCacheNow(logError, { silent: true });
        if (synced?.ok && synced?.bundle) {
          source = 'live';
          cacheAge = 0;
          refreshedAt = synced.refreshedAt || new Date().toISOString();
          bundle = synced.bundle;
        }
      }

      if (!bundle) {
        const cached = await readQboCatalogBundleFromCache();
        bundle = cached.bundle;
        cacheAge = cached.cacheAge;
        refreshedAt = cached.refreshedAt;
      }

      if (!bundle || (
        !Array.isArray(bundle.vendors) &&
        !Array.isArray(bundle.items) &&
        !Array.isArray(bundle.accounts)
      )) {
        bundle = normalizeMasterBundle({
          vendors: arr(erpCache.vendors),
          items: arr(erpCache.items),
          accounts: arr(erpCache.accounts),
          classes: arr(erpCache.classes),
          customers: arr(erpCache.customers),
        });
      }

      return res.json({
        ...bundle,
        source,
        cacheAge,
        refreshedAt: refreshedAt || erp?.refreshedAt || null,
      });
    } catch (e) {
      logError('GET /api/qbo/master', e);
      const fallback = normalizeMasterBundle({
        vendors: arr(erpCache.vendors),
        items: arr(erpCache.items),
        accounts: arr(erpCache.accounts),
        classes: arr(erpCache.classes),
        customers: arr(erpCache.customers),
      });
      return res.json({ ...fallback, source: 'cache', cacheAge: null, refreshedAt: erp?.refreshedAt || null });
    }
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

  app.post('/api/qbo/sync-catalog', async (_req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      const synced = await syncQboCatalogCacheNow(logError);
      if (!synced?.ok) {
        return res.status(503).json({ ok: false, error: synced?.error || 'QuickBooks sync failed', synced: synced?.synced || { vendors: 0, accounts: 0, items: 0, classes: 0 } });
      }
      return res.json({ ok: true, synced: synced.synced, source: 'live', refreshedAt: synced.refreshedAt || new Date().toISOString() });
    } catch (e) {
      logError('POST /api/qbo/sync-catalog', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), synced: { vendors: 0, accounts: 0, items: 0, classes: 0 } });
    }
  });

  app.get('/api/qbo/sync-queue', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, pending: 0, failed: 0, items: [] });
      await ensureIntegrationResilienceTables();
      const { rows } = await dbQuery(
        `SELECT * FROM qbo_sync_queue
          WHERE status IN ('pending','failed')
          ORDER BY created_at DESC, id DESC
          LIMIT 500`
      );
      const items = rows || [];
      const pending = items.filter((r) => String(r.status || '').toLowerCase() === 'pending').length;
      const failed = items.filter((r) => String(r.status || '').toLowerCase() === 'failed').length;
      return res.json({ ok: true, pending, failed, items });
    } catch (e) {
      logError('GET /api/qbo/sync-queue', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), pending: 0, failed: 0, items: [] });
    }
  });

  app.post('/api/qbo/sync-queue/retry', async (_req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set', synced: 0, failed: 0 });
      await ensureIntegrationResilienceTables();
      const out = await retryQboSyncQueue(logError, { limit: 500 });
      return res.json({ ok: true, synced: Number(out?.synced || 0), failed: Number(out?.failed || 0), skipped: Number(out?.skipped || 0), reason: out?.reason || null });
    } catch (e) {
      logError('POST /api/qbo/sync-queue/retry', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), synced: 0, failed: 0, skipped: 0 });
    }
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
      let assignmentList = [];
      let hosRows = [];
      let cachedAssignments = [];
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
        assignmentList = await getDriverVehicleAssignments(token, {}).then((assignments) => (
          Array.isArray(assignments?.data)
            ? assignments.data
            : Array.isArray(assignments)
              ? assignments
              : []
        )).catch(() => []);
        const hosData = await samsaraGet('/fleet/hos/clocks', token, {}).catch(() => ({ data: [] }));
        hosRows = Array.isArray(hosData?.data) ? hosData.data : [];
        if (hosRows.length) {
          await upsertSamsaraAssignmentsFromHosRows(hosRows).catch(() => 0);
        }
      }
      if (!hosRows.length) {
        cachedAssignments = await readCachedSamsaraAssignments().catch(() => []);
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

      const hosByUnit = new Map();
      hosRows.forEach((row) => {
        const unitName = String(row?.currentVehicle?.name || '').trim();
        const driverName = String(row?.driver?.name || '').trim();
        if (!unitName || !driverName) return;
        hosByUnit.set(unitName, {
          driverName,
          driverStatus: String(row?.currentDutyStatus?.hosStatusType || '').trim().toLowerCase() || 'unknown',
        });
      });
      if (!hosByUnit.size && Array.isArray(cachedAssignments)) {
        cachedAssignments.forEach((row) => {
          const unitName = String(row?.unit_number || '').trim();
          const driverName = String(row?.driver_name || '').trim();
          if (!unitName || !driverName) return;
          hosByUnit.set(unitName, {
            driverName,
            driverStatus: String(row?.duty_status || '').trim().toLowerCase() || 'unknown',
          });
        });
      }
      if (!hosByUnit.size && Array.isArray(cachedAssignments)) {
        cachedAssignments.forEach((row) => {
          const unitName = String(row?.unit_number || '').trim();
          const driverName = String(row?.driver_name || '').trim();
          if (!unitName || !driverName) return;
          hosByUnit.set(unitName, {
            driverName,
            driverStatus: String(row?.duty_status || '').trim().toLowerCase() || 'unknown',
          });
        });
      }

      const vehiclesWithAssignments = vehicles.map((vehicle) => {
        const unitNeedle = String(vehicle?.unit_number || vehicle?.unitNumber || vehicle?.name || '').trim();
        const hosMatch = hosByUnit.get(unitNeedle);
        if (hosMatch?.driverName) {
          return {
            ...vehicle,
            currentDriver: hosMatch.driverName,
            currentDriverStatus: hosMatch.driverStatus || 'unknown',
          };
        }

        const vehicleSamsaraId = String(vehicle?.samsara_id || vehicle?.samsaraId || vehicle?.id || '').trim();
        const match = assignmentList.find((a) => {
          const assignmentVehicleId = String(a?.vehicle?.id || '').trim();
          const assignmentVehicleName = String(a?.vehicle?.name || '').trim();
          if (vehicleSamsaraId && assignmentVehicleId) return assignmentVehicleId === vehicleSamsaraId;
          if (unitNeedle && assignmentVehicleName) return assignmentVehicleName === unitNeedle;
          return false;
        });
        const currentDriver = String(match?.driver?.name || '').trim();
        const currentDriverId = String(match?.driver?.id || '').trim();
        if (!currentDriver && !currentDriverId) return vehicle;
        return {
          ...vehicle,
          currentDriver: currentDriver || null,
          currentDriverId: currentDriverId || null,
        };
      });

      return res.json({
        vehicles: vehiclesWithAssignments, live: [], hos: [], assignments: [],
        refreshedAt: new Date().toISOString(),
        source: hosRows.length > 0 ? 'samsara-live' : (cachedAssignments.length > 0 ? 'cache' : (vehiclesWithAssignments.length > 0 ? 'samsara-live' : 'empty'))
      });
    } catch (e) {
      logError('GET /api/board', e);
      return res.json({ vehicles: [], live: [], hos: [],
        assignments: [], refreshedAt: new Date().toISOString(), source: 'error' });
    }
  });

    app.get('/api/fleet/assets', async (req, res) => {
    try {
      const statusQ = String(req.query?.status || '').trim().toLowerCase();
      const assets = await getMergedFleetAssetProfiles(logError);

      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      let assignList = [];
      let hosRows = [];
      let cachedAssignments = [];
      if (token) {
        const assignments = await getDriverVehicleAssignments(token, {}).catch(() => ({ data: [] }));
        assignList = Array.isArray(assignments?.data)
          ? assignments.data
          : Array.isArray(assignments)
            ? assignments
            : [];

        const hosData = await samsaraGet('/fleet/hos/clocks', token, {}).catch(() => ({ data: [] }));
        hosRows = Array.isArray(hosData?.data) ? hosData.data : [];
        if (hosRows.length) {
          await upsertSamsaraAssignmentsFromHosRows(hosRows).catch(() => 0);
        }
      }
      if (!hosRows.length) {
        cachedAssignments = await readCachedSamsaraAssignments().catch(() => []);
      }

      const hosByUnit = new Map();
      hosRows.forEach((row) => {
        const unitName = String(row?.currentVehicle?.name || '').trim();
        const driverName = String(row?.driver?.name || '').trim();
        if (!unitName || !driverName) return;
        hosByUnit.set(unitName, {
          driverName,
          driverStatus: String(row?.currentDutyStatus?.hosStatusType || '').trim().toLowerCase() || 'unknown',
        });
      });

      const assetsWithAssignments = assets.map((asset) => {
        const unitName = String(asset?.unit_number || '').trim();
        const hosMatch = hosByUnit.get(unitName);
        if (hosMatch?.driverName) {
          return {
            ...asset,
            current_driver_name: hosMatch.driverName,
            currentDriverName: hosMatch.driverName,
            currentDriver: hosMatch.driverName,
            currentDriverStatus: hosMatch.driverStatus || 'unknown',
            driver_name: hosMatch.driverName,
          };
        }

        const match = assignList.find((a) =>
          String(a?.vehicle?.id || '') === String(asset?.samsara_id || '')
        );
        const driverName = String(match?.driver?.name || '').trim();
        const driverId = String(match?.driver?.id || '').trim();
        if (!driverName && !driverId) return asset;
        return {
          ...asset,
          current_driver_name: driverName,
          currentDriverName: driverName,
          currentDriver: driverName || null,
          currentDriverId: driverId || null,
          driver_name: driverName,
        };
      });

      const filtered = statusQ
        ? assetsWithAssignments.filter((a) => String(a?.status || '').trim().toLowerCase() === statusQ)
        : assetsWithAssignments;
      return res.json({ ok: true, assets: filtered, data: filtered, count: filtered.length });
    } catch (e) {
      logError('GET /api/fleet/assets', e);
      return res.json({ ok: true, error: e?.message || String(e), assets: [], data: [] });
    }
  });

  app.get('/api/fleet/assets/qbo-classes', async (_req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, mappings: [] });
      await ensureFleetAssetQboClassesTable({ getPool: getPoolForRoute, dbQuery: dbQueryForRoute });
      const { rows } = await dbQueryForRoute(
        `SELECT unit_number, qbo_class_id, qbo_class_name
           FROM fleet_asset_qbo_classes
          ORDER BY unit_number`
      );
      return res.json({ ok: true, mappings: rows || [] });
    } catch (e) {
      logError('GET /api/fleet/assets/qbo-classes', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), mappings: [] });
    }
  });


  app.get('/api/fleet/assets/qbo-class', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, mapping: null, class_name: '' });
      await ensureFleetAssetQboClassesTable({ getPool: getPoolForRoute, dbQuery: dbQueryForRoute });
      const unit = String(req.query?.unit || req.query?.unit_number || '').trim();
      if (!unit) return res.json({ ok: true, mapping: null, class_name: '' });
      const { rows } = await dbQueryForRoute(
        `SELECT unit_number, qbo_class_id, qbo_class_name
           FROM fleet_asset_qbo_classes
          WHERE unit_number = $1
          LIMIT 1`,
        [unit]
      );
      const mapping = rows?.[0] || null;
      return res.json({
        ok: true,
        mapping,
        class_name: String(mapping?.qbo_class_name || '').trim(),
      });
    } catch (e) {
      logError('GET /api/fleet/assets/qbo-class', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), mapping: null, class_name: '' });
    }
  });

  app.post('/api/fleet/assets/qbo-class', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'no db' });
      await ensureFleetAssetQboClassesTable({ getPool: getPoolForRoute, dbQuery: dbQueryForRoute });
      const unitNumber = String(req.body?.unit_number || '').trim();
      const qboClassId = String(req.body?.qbo_class_id || '').trim();
      const qboClassName = String(req.body?.qbo_class_name || '').trim();
      if (!unitNumber) return res.status(400).json({ ok: false, error: 'unit_number required' });

      await dbQueryForRoute(
        `INSERT INTO fleet_asset_qbo_classes (unit_number, qbo_class_id, qbo_class_name, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (unit_number)
         DO UPDATE SET
           qbo_class_id = EXCLUDED.qbo_class_id,
           qbo_class_name = EXCLUDED.qbo_class_name,
           updated_at = now()`,
        [unitNumber, qboClassId || null, qboClassName || null]
      );

      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/fleet/assets/qbo-class', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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



  app.post('/api/fleet/assets/import', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'no db' });
      const trailers = Array.isArray(req.body?.trailers) ? req.body.trailers : [];
      if (!trailers.length) return res.json({ ok: true, imported: 0, updated: 0 });
      let imported = 0;
      let updated = 0;
      for (const t of trailers) {
        const unit = String(t.unit_number || '').trim();
        if (!unit) continue;

        const assetType = String(t.asset_type || 'Trailer').trim();
        const status = String(t.status || 'Active').trim();
        const make = String(t.make_override || t.make || '').trim() || null;
        const model = String(t.model_override || t.model || '').trim() || null;
        const year = parseInt(String(t.year_override || t.year || '0').trim()) || null;
        const vin = String(t.vin_override || t.vin || '').trim() || null;
        const plate = String(t.license_plate_override || t.licensePlate || t.license_plate || '').trim() || null;
        const notes = String(t.notes || '').trim() || null;

        const existing = await dbQuery(
          'SELECT unit_number FROM fleet_assets WHERE unit_number=$1 LIMIT 1',
          [unit]
        );

        if (existing.rows.length > 0) {
          await dbQuery(
            'UPDATE fleet_assets SET asset_type=$2, status=$3, make_override=$4, model_override=$5, year_override=$6, vin_override=$7, license_plate_override=$8, notes=$9, updated_at=now() WHERE unit_number=$1',
            [unit, assetType, status, make, model, year, vin, plate, notes]
          );
          updated++;
        } else {
          await dbQuery(
            'INSERT INTO fleet_assets (samsara_id, unit_number, asset_type, status, make_override, model_override, year_override, vin_override, license_plate_override, notes, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())',
            [
              'manual_' + unit,
              unit,
              assetType,
              status,
              make,
              model,
              year,
              vin,
              plate,
              notes,
            ]
          );
          imported++;
        }
      }
      return res.json({ ok: true, imported, updated });
    } catch (e) {
      logError('POST /api/fleet/assets/import', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/fleet/assets/bulk', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'no db' });
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(v => String(v)).filter(Boolean) : [];
      const statusRaw = String(req.body?.status || '').trim();
      const assetTypeRaw = String(req.body?.asset_type || '').trim();
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids required' });
      if (!statusRaw && !assetTypeRaw) {
        return res.status(400).json({ ok: false, error: 'status or asset_type required' });
      }

      const valid = ['Active', 'Inactive', 'Out of Service', 'Sold', 'In Shop', 'Accident'];
      const updates = [];
      const params = [ids];

      if (statusRaw) {
        const normalized = valid.find(s => s.toLowerCase() === statusRaw.toLowerCase()) || statusRaw;
        updates.push('status=$' + String(params.length + 1));
        params.push(normalized);
      }

      if (assetTypeRaw) {
        updates.push('asset_type=$' + String(params.length + 1));
        params.push(assetTypeRaw);
      }

      const sql = 'UPDATE fleet_assets SET ' + updates.join(', ') + ', updated_at=now() WHERE unit_number = ANY($1::text[])';
      const { rowCount } = await dbQuery(sql, params);
      return res.json({ ok: true, updated: Number(rowCount || 0) });
    } catch (e) {
      logError('PATCH /api/fleet/assets/bulk', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.patch('/api/drivers/bulk', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((v) => String(v || '').trim()).filter((v) => v.length > 0)
        : [];
      const statusRaw = String(req.body?.status || '').trim().toLowerCase();
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids array is required' });
      if (statusRaw !== 'active' && statusRaw !== 'inactive') {
        return res.status(400).json({ ok: false, error: "status must be 'active' or 'inactive'" });
      }
      const { rowCount } = await dbQueryForRoute(
        `UPDATE drivers
           SET status = $2, updated_at = now()
         WHERE unit_number = ANY($1::text[])`,
        [ids, statusRaw]
      );
      return res.json({ ok: true, updated: Number(rowCount || 0) });
    } catch (e) {
      logError('PATCH /api/drivers/bulk', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/drivers/profiles', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, drivers: [] });
      await ensureDriverSchedulerTables();
      const seedCheck = await dbQuery('SELECT COUNT(*)::int AS n FROM driver_profiles');
      const n = Number(seedCheck?.rows?.[0]?.n || 0);
      if (n === 0) {
        await dbQuery(
          `INSERT INTO driver_profiles (unit_number, full_name, status, cdl_expiry, medical_expiry, created_at, updated_at)
           SELECT 'T' || gs::text, 'Unassigned', 'active', NULL, NULL, now(), now()
           FROM generate_series(120, 177) AS gs
           ON CONFLICT (unit_number) DO NOTHING`
        );
      }
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
      const fullName = String(b.full_name || b.driver_name || '').trim();
      await dbQuery(
        `INSERT INTO driver_profiles (
          full_name, unit_number, team, manager, phone, email, status,
          cdl_number, cdl_state, cdl_expiry, medical_expiry, hire_date,
          emergency_contact, emergency_phone,
          qbo_vendor_id, qbo_vendor_name, samsara_driver_id,
          license_number, notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())
        ON CONFLICT (unit_number)
        DO UPDATE SET
          full_name = EXCLUDED.full_name,
          team = EXCLUDED.team,
          manager = EXCLUDED.manager,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          cdl_number = EXCLUDED.cdl_number,
          cdl_state = EXCLUDED.cdl_state,
          cdl_expiry = EXCLUDED.cdl_expiry,
          medical_expiry = EXCLUDED.medical_expiry,
          hire_date = EXCLUDED.hire_date,
          emergency_contact = EXCLUDED.emergency_contact,
          emergency_phone = EXCLUDED.emergency_phone,
          qbo_vendor_id = EXCLUDED.qbo_vendor_id,
          qbo_vendor_name = EXCLUDED.qbo_vendor_name,
          samsara_driver_id = EXCLUDED.samsara_driver_id,
          license_number = EXCLUDED.license_number,
          notes = EXCLUDED.notes,
          updated_at = now()`,
        [
          fullName || null,
          unit,
          String(b.team || '').trim() || null,
          String(b.manager || '').trim() || null,
          String(b.phone || '').trim() || null,
          String(b.email || '').trim() || null,
          String(b.status || 'Active').trim() || 'Active',
          String(b.cdl_number || '').trim() || null,
          String(b.cdl_state || '').trim() || null,
          String(b.cdl_expiry || '').trim() || null,
          String(b.medical_expiry || '').trim() || null,
          String(b.hire_date || '').trim() || null,
          String(b.emergency_contact || '').trim() || null,
          String(b.emergency_phone || '').trim() || null,
          String(b.qbo_vendor_id || '').trim() || null,
          String(b.qbo_vendor_name || '').trim() || null,
          String(b.samsara_driver_id || '').trim() || null,
          String(b.license_number || '').trim() || null,
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

  app.put('/api/drivers/profiles/:id', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const id = Number(req.params?.id);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'valid id is required' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      await dbQuery(
        `UPDATE driver_profiles
            SET full_name=$2,
                unit_number=$3,
                status=$4,
                phone=$5,
                email=$6,
                cdl_number=$7,
                cdl_state=$8,
                cdl_expiry=$9,
                medical_expiry=$10,
                hire_date=$11,
                emergency_contact=$12,
                emergency_phone=$13,
                qbo_vendor_id=$14,
                qbo_vendor_name=$15,
                samsara_driver_id=$16,
                license_number=$17,
                notes=$18,
                updated_at=now()
          WHERE id=$1`,
        [
          id,
          String(b.full_name || b.driver_name || '').trim() || null,
          String(b.unit_number || '').trim() || null,
          String(b.status || 'active').trim() || 'active',
          String(b.phone || '').trim() || null,
          String(b.email || '').trim() || null,
          String(b.cdl_number || '').trim() || null,
          String(b.cdl_state || '').trim() || null,
          String(b.cdl_expiry || '').trim() || null,
          String(b.medical_expiry || '').trim() || null,
          String(b.hire_date || '').trim() || null,
          String(b.emergency_contact || '').trim() || null,
          String(b.emergency_phone || '').trim() || null,
          String(b.qbo_vendor_id || '').trim() || null,
          String(b.qbo_vendor_name || '').trim() || null,
          String(b.samsara_driver_id || '').trim() || null,
          String(b.license_number || '').trim() || null,
          String(b.notes || '').trim() || null,
        ]
      );
      const { rows } = await dbQuery('SELECT * FROM driver_profiles WHERE id = $1 LIMIT 1', [id]);
      return res.json({ ok: true, driver: rows?.[0] || null });
    } catch (e) {
      logError('PUT /api/drivers/profiles/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/drivers/profiles/import-samsara', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const samsaraId = String(b.samsara_driver_id || '').trim();
      const name = String(b.name || b.driver_name || '').trim();
      const unit = String(b.unit_number || '').trim();
      if (!samsaraId && !name) {
        return res.status(400).json({ ok: false, error: 'samsara_driver_id or name is required' });
      }

      const { rows } = await dbQuery(
        `INSERT INTO driver_profiles (
          full_name, unit_number, phone, cdl_state, license_number,
          samsara_driver_id, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'active',now(),now())
        ON CONFLICT (unit_number)
        DO UPDATE SET
          full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          cdl_state = EXCLUDED.cdl_state,
          license_number = EXCLUDED.license_number,
          samsara_driver_id = EXCLUDED.samsara_driver_id,
          updated_at = now()
        RETURNING *`,
        [
          name || null,
          unit || `SAMSARA-${samsaraId || Date.now()}`,
          String(b.phone || '').trim() || null,
          String(b.licenseState || b.cdl_state || '').trim() || null,
          String(b.licenseNumber || b.license_number || '').trim() || null,
          samsaraId || null,
        ]
      );
      return res.json({ ok: true, driver: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/drivers/profiles/import-samsara', e);
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
    try {
      await ensureIntegrationResilienceTables();
      if (!token) {
        const cached = await readCachedSamsaraAssignments().catch(() => []);
        const rows = cached.map((r) => ({
          driver: { id: r.driver_samsara_id || null, name: r.driver_name || null },
          currentVehicle: { name: r.unit_number || null },
          currentDutyStatus: { hosStatusType: r.duty_status || 'unknown' },
          lastUpdated: r.last_updated || null,
        }));
        return res.json({ ok: true, source: 'cache', rows });
      }
      const payload = await samsaraGet('/fleet/hos/clocks', token, {});
      const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.clocks) ? payload.clocks : [];
      await upsertSamsaraAssignmentsFromHosRows(rows).catch(() => 0);
      return res.json({ ok: true, source: 'live', rows });
    } catch (e) {
      logError('GET /api/drivers/hos-status', e);
      const cached = await readCachedSamsaraAssignments().catch(() => []);
      const rows = cached.map((r) => ({
        driver: { id: r.driver_samsara_id || null, name: r.driver_name || null },
        currentVehicle: { name: r.unit_number || null },
        currentDutyStatus: { hosStatusType: r.duty_status || 'unknown' },
        lastUpdated: r.last_updated || null,
      }));
      return res.json({ ok: true, source: 'cache', rows });
    }
  });


  app.get('/api/drivers/samsara-list', async (_req, res) => {
    try {
      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      if (!token) return res.json({ ok: true, drivers: [] });

      const assignmentsRes = await getDriverVehicleAssignments(token, {}).catch(() => ({ data: [] }));
      const driversData = await samsaraGet('/fleet/drivers', token, { limit: 200 }).catch(() => ({ data: [] }));

      const drivers = (Array.isArray(driversData?.data) ? driversData.data : []).map((d) => ({
        samsara_id: d?.id,
        name: d?.name,
        username: d?.username,
        phone: d?.phone,
        licenseNumber: d?.licenseNumber,
        licenseState: d?.licenseState,
        eldExempt: d?.eldExempt,
        currentVehicle: null,
      }));

      const assignmentList = Array.isArray(assignmentsRes?.data)
        ? assignmentsRes.data
        : Array.isArray(assignmentsRes)
          ? assignmentsRes
          : [];

      assignmentList.forEach((a) => {
        const driver = drivers.find((d) => String(d.samsara_id || '') === String(a?.driver?.id || ''));
        if (driver && a?.vehicle) {
          driver.currentVehicle = a.vehicle.name || a.vehicle.id || null;
        }
      });

      if (getPool()) {
        await ensureDriverSchedulerTables();
        for (const d of drivers) {
          const name = String(d?.name || '').trim();
          const samsaraId = String(d?.samsara_id || '').trim();
          if (!name || !samsaraId) continue;
          await dbQuery(
            `INSERT INTO driver_profiles (full_name, samsara_driver_id, license_number, cdl_state, status, unit_number, updated_at, created_at)
             VALUES ($1,$2,$3,$4,'active','Unassigned',now(),now())
             ON CONFLICT (samsara_driver_id)
             DO UPDATE SET
               full_name = EXCLUDED.full_name,
               license_number = EXCLUDED.license_number,
               cdl_state = EXCLUDED.cdl_state,
               updated_at = now()`,
            [
              name,
              samsaraId,
              d?.licenseNumber || null,
              d?.licenseState || null,
            ]
          ).catch(() => null);
        }
      }

      return res.json({ ok: true, drivers, assignments: assignmentList });
    } catch (e) {
      logError('GET /api/drivers/samsara-list', e);
      return res.json({ ok: true, drivers: [], error: e?.message || String(e) });
    }
  });

  app.get('/api/drivers/assignments', async (_req, res) => {
    try {
      await ensureIntegrationResilienceTables();
      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      if (token) {
        const payload = await samsaraGet('/fleet/hos/clocks', token, {}).catch(() => ({ data: [] }));
        const rows = Array.isArray(payload?.data) ? payload.data : [];
        if (rows.length) {
          await upsertSamsaraAssignmentsFromHosRows(rows).catch(() => 0);
          const assignments = rows
            .map((row) => {
              const unit = String(row?.currentVehicle?.name || '').trim();
              const driver = String(row?.driver?.name || '').trim();
              if (!unit || !driver) return null;
              return {
                unit_number: unit,
                driver_name: driver,
                driver_samsara_id: String(row?.driver?.id || '').trim() || null,
                duty_status: String(row?.currentDutyStatus?.hosStatusType || '').trim().toLowerCase() || 'unknown',
              };
            })
            .filter(Boolean);
          return res.json({ ok: true, source: 'live', assignments });
        }
      }
      const cached = await readCachedSamsaraAssignments().catch(() => []);
      return res.json({ ok: true, source: 'cache', assignments: cached || [] });
    } catch (e) {
      logError('GET /api/drivers/assignments', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), source: 'cache', assignments: [] });
    }
  });


  app.post('/api/drivers/sync-from-samsara', async (_req, res) => {
    try {
      const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
      if (!token) return res.json({ ok: false, error: 'no token' });
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();

      const driversData = await samsaraGet('/fleet/drivers', token, { limit: 200 }).catch(() => ({ data: [] }));
      const drivers = Array.isArray(driversData?.data) ? driversData.data : [];

      let imported = 0;
      for (const d of drivers) {
        const name = String(d?.name || '').trim();
        if (!name) continue;
        const samsaraId = String(d?.id || '').trim();
        if (!samsaraId) continue;

        await dbQuery(
          `INSERT INTO driver_profiles (
             full_name, samsara_driver_id, license_number,
             cdl_state, status, unit_number, updated_at, created_at
           ) VALUES ($1,$2,$3,$4,'active','Unassigned',now(),now())
           ON CONFLICT (samsara_driver_id) DO UPDATE SET
             full_name=EXCLUDED.full_name,
             license_number=EXCLUDED.license_number,
             cdl_state=EXCLUDED.cdl_state,
             updated_at=now()`,
          [
            name,
            samsaraId,
            d?.licenseNumber || null,
            d?.licenseState || null,
          ]
        ).catch(() => null);
        imported++;
      }

      return res.json({ ok: true, imported });
    } catch (e) {
      logError('POST /api/drivers/sync-from-samsara', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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


  app.get('/api/damage/reports', async (_req, res) => {
    try {
      const pool = getPoolForRoute();
      if (!pool) return res.json({ ok: true, reports: [], data: [] });
      await dbQueryForRoute(
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
      const { rows } = await dbQueryForRoute('SELECT * FROM damage_reports ORDER BY reported_at DESC LIMIT 50');
      const reports = rows || [];
      res.json({ ok: true, reports, data: reports });
    } catch (e) {
      logError('GET /api/damage/reports', e);
      res.json({ ok: true, reports: [], data: [] });
    }
  });

  app.post('/api/damage/reports/:id/acknowledge', async (req, res) => {
    try {
      const pool = getPoolForRoute();
      if (pool) {
        await dbQueryForRoute("UPDATE damage_reports SET status='acknowledged' WHERE id=$1", [req.params.id]);
      }
      res.json({ ok: true, acknowledged: true });
    } catch (e) {
      logError('POST /api/damage/reports/:id/acknowledge', e);
      res.json({ ok: false, acknowledged: false });
    }
  });


  app.post('/api/damage/reports/bulk-acknowledge', async (req, res) => {
    try {
      const pool = getPoolForRoute();
      if (!pool) return res.json({ ok: true, updated: 0 });
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids array is required', updated: 0 });
      const { rowCount } = await dbQueryForRoute(
        "UPDATE damage_reports SET status='acknowledged' WHERE id = ANY($1::int[])",
        [ids]
      );
      return res.json({ ok: true, updated: Number(rowCount || 0) });
    } catch (e) {
      logError('POST /api/damage/reports/bulk-acknowledge', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), updated: 0 });
    }
  });

  app.get('/api/work-orders', async (_req, res) => {
    try {
      if (!getPoolForRoute()) {
        const erp = readFullErpJson();
        const cached = Array.isArray(erp?.workOrders) ? erp.workOrders : [];
        return res.json({ ok: true, workOrders: cached, data: cached });
      }
      await ensureWorkOrdersTable();
      const { rows } = await dbQueryForRoute('SELECT * FROM work_orders ORDER BY created_at DESC, id DESC LIMIT 1000');
      const workOrders = rows || [];
      return res.json({ ok: true, workOrders, data: workOrders });
    } catch (e) {
      logError('GET /api/work-orders', e);
      return res.json({ ok: true, workOrders: [], data: [] });
    }
  });

  app.get('/api/maintenance/work-orders', async (_req, res) => {
    try {
      if (!getPoolForRoute()) {
        const erp = readFullErpJson();
        const cached = Array.isArray(erp?.workOrders) ? erp.workOrders : [];
        return res.json({ ok: true, workOrders: cached, data: cached });
      }
      await ensureWorkOrdersTable();
      const { rows } = await dbQueryForRoute('SELECT * FROM work_orders ORDER BY created_at DESC, id DESC LIMIT 1000');
      const workOrders = rows || [];
      return res.json({ ok: true, workOrders, data: workOrders });
    } catch (e) {
      logError('GET /api/maintenance/work-orders', e);
      return res.json({ ok: true, workOrders: [], data: [] });
    }
  });

  app.post('/api/work-orders', async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = {
      unit_number: String(b.unit_number || b.unit || '').trim() || null,
      service_type: String(b.service_type || b.serviceType || '').trim() || null,
      description: String(b.description || '').trim() || null,
      vendor: String(b.vendor || b.vendor_name || '').trim() || null,
      estimated_cost: b.estimated_cost == null || b.estimated_cost === '' ? null : Number(b.estimated_cost),
      priority: String(b.priority || '').trim() || 'Normal',
      status: String(b.status || '').trim() || 'Open',
      source: String(b.source || 'maintenance_ui').trim(),
    };
    try {
      if (!getPoolForRoute()) {
        const erp = readFullErpJson();
        const list = Array.isArray(erp.workOrders) ? erp.workOrders : [];
        const row = {
          id: String(Date.now()),
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        erp.workOrders = [row, ...list].slice(0, 1000);
        writeFullErpJson(erp);
        return res.json({ ok: true, workOrder: row });
      }
      await ensureWorkOrdersTable();
      const { rows } = await dbQueryForRoute(
        `INSERT INTO work_orders
          (unit_number, service_type, description, vendor, estimated_cost, priority, status, source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         RETURNING *`,
        [
          payload.unit_number,
          payload.service_type,
          payload.description,
          payload.vendor,
          Number.isFinite(payload.estimated_cost) ? payload.estimated_cost : null,
          payload.priority,
          payload.status,
          payload.source,
        ]
      );
      return res.json({ ok: true, workOrder: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/work-orders', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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



  async function ensureFuelExpenseTables() {
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS fuel_expenses (
        id SERIAL PRIMARY KEY,
        unit_number TEXT,
        driver_name TEXT,
        fuel_type TEXT,
        gallons NUMERIC,
        price_per_gallon NUMERIC,
        total_amount NUMERIC,
        load_number TEXT,
        reefer_unit_number TEXT,
        settlement_load_id TEXT,
        station_name TEXT,
        location TEXT,
        receipt_photo TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        qbo_posted BOOLEAN DEFAULT false,
        qbo_txn_id TEXT
      )`
    );
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS fuel_type TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS load_number TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS reefer_unit_number TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS settlement_load_id TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS qbo_txn_id TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS qbo_posted BOOLEAN DEFAULT false');
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS fuel_qbo_settings (
        id SERIAL PRIMARY KEY,
        fuel_type TEXT UNIQUE,
        qbo_account_id TEXT,
        qbo_account_name TEXT,
        qbo_item_id TEXT,
        qbo_item_name TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS driver_expense_mappings (
        id SERIAL PRIMARY KEY,
        expense_type TEXT UNIQUE,
        qbo_account_id TEXT,
        qbo_account_name TEXT,
        qbo_item_id TEXT,
        qbo_item_name TEXT,
        default_vendor_id TEXT,
        default_vendor_name TEXT,
        requires_load_number TEXT DEFAULT 'optional',
        requires_reefer_number BOOLEAN DEFAULT false,
        requires_receipt BOOLEAN DEFAULT false,
        requires_odometer BOOLEAN DEFAULT false,
        auto_post_qbo BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
  }

  async function ensureLoadExpenseLinksTable() {
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS load_expense_links (
        id SERIAL PRIMARY KEY,
        load_number TEXT NOT NULL,
        expense_type TEXT,
        expense_id INTEGER,
        expense_table TEXT,
        amount NUMERIC,
        unit_number TEXT,
        driver_name TEXT,
        linked_at TIMESTAMPTZ DEFAULT NOW(),
        settlement_status TEXT DEFAULT 'pending'
      )`
    );
  }

  function normalizeFuelTypeKey(v) {
    const key = String(v || '').trim().toLowerCase();
    if (!key) return '';
    return key;
  }

  function normalizeLoadMode(v) {
    const mode = String(v || '').trim().toLowerCase();
    if (mode === 'required' || mode === 'optional' || mode === 'not_needed') return mode;
    if (mode === 'true') return 'required';
    if (mode === 'false') return 'optional';
    return 'optional';
  }

  async function postFuelExpenseToQbo(expenseRow, mappingOverride = null) {
    try {
      const fuelType = normalizeFuelTypeKey(expenseRow?.fuel_type);
      if (!fuelType) return { ok: false, reason: 'missing_fuel_type' };
      let setting = mappingOverride;
      if (!setting) {
        const { rows: mapRows } = await dbQuery(
          `SELECT * FROM fuel_qbo_settings WHERE fuel_type = $1 LIMIT 1`,
          [fuelType]
        );
        setting = mapRows?.[0] || null;
      }
      if (!setting || !String(setting.qbo_account_id || '').trim()) {
        return { ok: false, reason: 'mapping_missing' };
      }

      const qbo = createQboApiClient();
      const amount = Number(expenseRow.total_amount || 0);
      const unit = String(expenseRow.unit_number || '').trim();
      const load = String(expenseRow.load_number || '').trim();
      const driver = String(expenseRow.driver_name || '').trim();
      const station = String(expenseRow.station_name || '').trim();
      const gallons = String(expenseRow.gallons ?? '').trim();
      const description = `${fuelType} - Unit ${unit || 'N/A'} - Load ${load || 'N/A'}`;

      const detail = {
        AccountRef: { value: String(setting.qbo_account_id), name: String(setting.qbo_account_name || '').trim() || undefined }
      };
      if (String(setting.qbo_item_id || '').trim()) {
        detail.ItemBasedExpenseLineDetail = {
          ItemRef: {
            value: String(setting.qbo_item_id),
            name: String(setting.qbo_item_name || '').trim() || undefined
          }
        };
      }

      const payload = {
        PaymentType: 'Cash',
        AccountRef: { value: String(setting.qbo_account_id), name: String(setting.qbo_account_name || '').trim() || undefined },
        TxnDate: new Date().toISOString().slice(0, 10),
        PrivateNote: `Driver: ${driver || 'N/A'} | Station: ${station || 'N/A'} | Gallons: ${gallons || '0'}`,
        Line: [
          {
            Amount: Number.isFinite(amount) ? amount : 0,
            Description: description,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: detail,
          }
        ]
      };
      if (String(setting.default_vendor_id || '').trim()) {
        payload.EntityRef = {
          value: String(setting.default_vendor_id),
          name: String(setting.default_vendor_name || '').trim() || undefined,
          type: 'Vendor'
        };
      }

      const resp = await qbo.qboPost('purchase', payload);
      const txnId = String(resp?.Purchase?.Id || resp?.Purchase?.id || '').trim();
      if (!txnId) return { ok: false, reason: 'qbo_no_txn_id' };

      await dbQuery('UPDATE fuel_expenses SET qbo_posted = true, qbo_txn_id = $2 WHERE id = $1', [expenseRow.id, txnId]);
      return { ok: true, txnId };
    } catch (e) {
      return { ok: false, reason: e?.message || String(e) };
    }
  }

  app.get('/api/fuel/expense-mapping', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, mappings: [] });
      await ensureFuelExpenseTables();
      const { rows } = await dbQuery('SELECT * FROM driver_expense_mappings ORDER BY expense_type ASC');
      return res.json({ ok: true, mappings: rows || [] });
    } catch (e) {
      logError('GET /api/fuel/expense-mapping', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), mappings: [] });
    }
  });

  app.post('/api/fuel/expense-mapping', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureFuelExpenseTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const expenseType = normalizeFuelTypeKey(b.expense_type || b.expenseType);
      if (!expenseType) return res.status(400).json({ ok: false, error: 'expense_type is required' });
      await dbQuery(
        `INSERT INTO driver_expense_mappings (
          expense_type, qbo_account_id, qbo_account_name, qbo_item_id, qbo_item_name,
          default_vendor_id, default_vendor_name, requires_load_number, requires_reefer_number,
          requires_receipt, requires_odometer, auto_post_qbo, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (expense_type)
        DO UPDATE SET
          qbo_account_id = EXCLUDED.qbo_account_id,
          qbo_account_name = EXCLUDED.qbo_account_name,
          qbo_item_id = EXCLUDED.qbo_item_id,
          qbo_item_name = EXCLUDED.qbo_item_name,
          default_vendor_id = EXCLUDED.default_vendor_id,
          default_vendor_name = EXCLUDED.default_vendor_name,
          requires_load_number = EXCLUDED.requires_load_number,
          requires_reefer_number = EXCLUDED.requires_reefer_number,
          requires_receipt = EXCLUDED.requires_receipt,
          requires_odometer = EXCLUDED.requires_odometer,
          auto_post_qbo = EXCLUDED.auto_post_qbo,
          updated_at = NOW()`,
        [
          expenseType,
          String(b.qbo_account_id || '').trim() || null,
          String(b.qbo_account_name || '').trim() || null,
          String(b.qbo_item_id || '').trim() || null,
          String(b.qbo_item_name || '').trim() || null,
          String(b.default_vendor_id || '').trim() || null,
          String(b.default_vendor_name || '').trim() || null,
          normalizeLoadMode(b.requires_load_number),
          Boolean(b.requires_reefer_number),
          Boolean(b.requires_receipt),
          Boolean(b.requires_odometer),
          Boolean(b.auto_post_qbo),
        ]
      );
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/fuel/expense-mapping', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/fuel/driver-expense', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      await ensureFuelExpenseTables();
      await ensureLoadExpenseLinksTable();
      const fuelType = normalizeFuelTypeKey(b.fuel_type || b.fuelType);
      const loadNumber = String(b.load_number || b.loadNumber || '').trim();
      const reeferUnitNumber = String(b.reefer_unit_number || b.reeferUnitNumber || '').trim();
      const { rows: mappingRows } = await dbQuery(
        'SELECT * FROM driver_expense_mappings WHERE expense_type = $1 LIMIT 1',
        [fuelType || '']
      );
      const mapping = mappingRows?.[0] || null;
      const warnings = [];
      if (mapping && normalizeLoadMode(mapping.requires_load_number) === 'required' && !loadNumber) {
        warnings.push('Load number is required by mapping for this expense type.');
      }
      if (mapping && mapping.requires_reefer_number === true && !reeferUnitNumber) {
        warnings.push('Reefer unit number is required by mapping for this expense type.');
      }

      const { rows } = await dbQuery(
        `INSERT INTO fuel_expenses (
          unit_number, driver_name, fuel_type, gallons, price_per_gallon, total_amount,
          load_number, reefer_unit_number, settlement_load_id, station_name, location, receipt_photo, qbo_posted
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)
        RETURNING *`,
        [
          String(b.unit || b.unit_number || '').trim() || null,
          String(b.driver || b.driver_name || '').trim() || null,
          fuelType || null,
          b.gallons == null ? null : Number(b.gallons),
          b.price_per_gallon == null ? null : Number(b.price_per_gallon),
          b.total_amount == null ? null : Number(b.total_amount),
          loadNumber || null,
          reeferUnitNumber || null,
          loadNumber || null,
          String(b.station || b.station_name || '').trim() || null,
          String(b.location || '').trim() || null,
          String(b.receipt_photo_base64 || b.receipt_photo || '').trim() || null,
        ]
      );
      const expense = rows?.[0] || null;

      if (expense?.id && loadNumber) {
        await dbQuery(
          `INSERT INTO load_expense_links (
            load_number, expense_type, expense_id, expense_table, amount, unit_number, driver_name
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            loadNumber,
            fuelType || null,
            expense.id,
            'fuel_expenses',
            expense.total_amount == null ? null : Number(expense.total_amount),
            String(expense.unit_number || '').trim() || null,
            String(expense.driver_name || '').trim() || null,
          ]
        );
      }

      let qboPosted = false;
      let qboTxnId = null;
      if (expense?.id && mapping && mapping.auto_post_qbo === true && String(mapping.qbo_account_id || '').trim()) {
        const posted = await postFuelExpenseToQbo(expense, mapping);
        qboPosted = posted.ok === true;
        qboTxnId = posted.txnId || null;
        if (!qboPosted) {
          await enqueueQboSyncQueue(
            'fuel',
            expense.id,
            {
              mode: 'fuel_expense_post',
              expense_id: expense.id,
              payload: {
                unit_number: expense.unit_number || null,
                driver_name: expense.driver_name || null,
                total_amount: expense.total_amount == null ? null : Number(expense.total_amount),
                load_number: expense.load_number || null,
              },
            },
            posted.reason || 'Auto-post to QBO failed'
          ).catch(() => null);
        }
      }
      return res.json({
        ok: true,
        expense_id: expense?.id || null,
        qbo_posted: qboPosted,
        qbo_txn_id: qboTxnId,
        warning: warnings.length ? warnings.join(' ') : null,
      });
    } catch (e) {
      logError('POST /api/fuel/driver-expense', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/fuel/expenses', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, expenses: [], data: [] });
      await ensureFuelExpenseTables();
      const unit = String(req.query?.unit || '').trim();
      const sql = unit
        ? 'SELECT * FROM fuel_expenses WHERE unit_number = $1 ORDER BY submitted_at DESC'
        : 'SELECT * FROM fuel_expenses ORDER BY submitted_at DESC';
      const { rows } = await dbQueryForRoute(sql, unit ? [unit] : []);
      const expenses = (rows || []).map((r) => ({
        ...r,
        load_number: r?.load_number || null,
        reefer_unit_number: r?.reefer_unit_number || null,
        settlement_load_id: r?.settlement_load_id || null,
        qbo_posted: r?.qbo_posted === true,
        qbo_txn_id: r?.qbo_txn_id || null,
      }));
      return res.json({ ok: true, expenses, data: expenses });
    } catch (e) {
      logError('GET /api/fuel/expenses', e);
      return res.json({ ok: true, error: e?.message || String(e), expenses: [], data: [] });
    }
  });

  app.get('/api/fuel/qbo-accounts', (_req, res) => {
    try {
      const erp = readFullErpJson();
      const cache = erp?.qboCache && typeof erp.qboCache === 'object' ? erp.qboCache : {};
      const accounts = Array.isArray(cache.accounts) ? cache.accounts : [];
      const items = Array.isArray(cache.items) ? cache.items : [];
      const needles = ['diesel', 'fuel', 'def', 'energy', 'fleet'];
      const keep = (v) => {
        const s = String(v || '').toLowerCase();
        return needles.some((k) => s.includes(k));
      };
      const filteredAccounts = accounts
        .map((a) => ({ id: String(a.id || a.Id || '').trim(), name: String(a.name || a.Name || '').trim() }))
        .filter((a) => a.id && a.name && keep(a.name));
      const filteredItems = items
        .map((i) => ({ id: String(i.id || i.Id || '').trim(), name: String(i.name || i.Name || '').trim() }))
        .filter((i) => i.id && i.name && keep(i.name));
      return res.json({ ok: true, accounts: filteredAccounts, items: filteredItems });
    } catch (e) {
      logError('GET /api/fuel/qbo-accounts', e);
      return res.json({ ok: true, accounts: [], items: [] });
    }
  });

  app.get('/api/fuel/settings', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, settings: [] });
      await ensureFuelExpenseTables();
      const { rows } = await dbQuery('SELECT * FROM fuel_qbo_settings ORDER BY fuel_type');
      return res.json({ ok: true, settings: rows || [] });
    } catch (e) {
      logError('GET /api/fuel/settings', e);
      return res.json({ ok: true, settings: [] });
    }
  });

  app.post('/api/fuel/settings', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureFuelExpenseTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const fuelType = normalizeFuelTypeKey(b.fuel_type || b.fuelType);
      if (!fuelType) return res.status(400).json({ ok: false, error: 'fuel_type is required' });
      const { rows } = await dbQuery(
        `INSERT INTO fuel_qbo_settings (
          fuel_type, qbo_account_id, qbo_account_name, qbo_item_id, qbo_item_name, updated_at
        ) VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (fuel_type)
        DO UPDATE SET
          qbo_account_id = EXCLUDED.qbo_account_id,
          qbo_account_name = EXCLUDED.qbo_account_name,
          qbo_item_id = EXCLUDED.qbo_item_id,
          qbo_item_name = EXCLUDED.qbo_item_name,
          updated_at = NOW()
        RETURNING *`,
        [
          fuelType,
          String(b.qbo_account_id || '').trim() || null,
          String(b.qbo_account_name || '').trim() || null,
          String(b.qbo_item_id || '').trim() || null,
          String(b.qbo_item_name || '').trim() || null,
        ]
      );
      return res.json({ ok: true, setting: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/fuel/settings', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/settlements/by-load', async (req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, load_number: String(req.query?.load || '').trim(), expenses: [], total_amount: 0 });
      await ensureLoadExpenseLinksTable();
      const loadNumber = String(req.query?.load || '').trim();
      if (!loadNumber) return res.status(400).json({ ok: false, error: 'load query param is required', expenses: [], total_amount: 0 });
      const { rows } = await dbQuery(
        'SELECT * FROM load_expense_links WHERE load_number = $1 ORDER BY linked_at DESC, id DESC',
        [loadNumber]
      );
      const expenses = rows || [];
      const total_amount = expenses.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0);
      return res.json({ ok: true, load_number: loadNumber, expenses, total_amount });
    } catch (e) {
      logError('GET /api/settlements/by-load', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), expenses: [], total_amount: 0 });
    }
  });

  app.post('/api/fuel/post-to-qbo', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureFuelExpenseTables();
      const expenseId = Number(req.body?.expense_id);
      if (!Number.isFinite(expenseId)) return res.status(400).json({ ok: false, error: 'expense_id required' });
      const { rows } = await dbQuery('SELECT * FROM fuel_expenses WHERE id = $1 LIMIT 1', [expenseId]);
      const expense = rows?.[0] || null;
      if (!expense) return res.status(404).json({ ok: false, error: 'Fuel expense not found' });
      const posted = await postFuelExpenseToQbo(expense);
      if (posted.ok) return res.json({ ok: true, qbo_txn_id: posted.txnId || null });
      await enqueueQboSyncQueue(
        'fuel',
        expense.id,
        {
          mode: 'fuel_expense_post',
          expense_id: expense.id,
          payload: {
            unit_number: expense.unit_number || null,
            driver_name: expense.driver_name || null,
            total_amount: expense.total_amount == null ? null : Number(expense.total_amount),
            load_number: expense.load_number || null,
          },
        },
        posted.reason || 'Manual QBO post failed'
      ).catch(() => null);
      return res.json({ ok: false, error: posted.reason || 'QBO post failed (queued for retry)' });
    } catch (e) {
      logError('POST /api/fuel/post-to-qbo', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/drivers/leave-request', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const { rows } = await dbQuery(
        `INSERT INTO leave_requests (
          unit_number, driver_name, start_date, end_date, leave_type, notes
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id`,
        [
          String(b.unit || b.unit_number || '').trim() || null,
          String(b.driver || b.driver_name || '').trim() || null,
          String(b.start_date || '').trim() || null,
          String(b.end_date || '').trim() || null,
          String(b.leave_type || '').trim() || null,
          String(b.notes || '').trim() || null,
        ]
      );
      return res.json({ ok: true, request_id: rows?.[0]?.id || null });
    } catch (e) {
      logError('POST /api/drivers/leave-request', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


  app.get('/api/drivers/leave-request', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set', requests: [], rows: [] });
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const unit = String(req.query?.unit || '').trim();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const params = [];
      let where = [];
      if (unit) {
        params.push(unit);
        where.push(`unit_number = $${params.length}`);
      }
      if (status) {
        params.push(status);
        where.push(`LOWER(COALESCE(status, 'pending')) = $${params.length}`);
      }
      const sql = `SELECT * FROM leave_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`;
      const { rows } = await dbQuery(sql, params);
      return res.json({ ok: true, requests: rows || [], rows: rows || [] });
    } catch (e) {
      logError('GET /api/drivers/leave-request', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), requests: [], rows: [] });
    }
  });

  app.get('/api/drivers/leave-requests', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, requests: [], rows: [], data: [] });
      await dbQueryForRoute(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const unit = String(req.query?.unit || '').trim();
      const sql = unit
        ? 'SELECT * FROM leave_requests WHERE unit_number = $1 ORDER BY created_at DESC, id DESC'
        : 'SELECT * FROM leave_requests ORDER BY created_at DESC, id DESC';
      const { rows } = await dbQueryForRoute(sql, unit ? [unit] : []);
      const requests = rows || [];
      return res.json({ ok: true, requests, rows: requests, data: requests });
    } catch (e) {
      logError('GET /api/drivers/leave-requests', e);
      return res.json({ ok: true, error: e?.message || String(e), requests: [], rows: [], data: [] });
    }
  });

  app.post('/api/drivers/leave-request/:id/approve', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });

      const { rows } = await dbQuery(
        `UPDATE leave_requests
           SET status = 'approved', reviewed_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      const reqRow = rows?.[0] || null;
      if (!reqRow) return res.status(404).json({ ok: false, error: 'Leave request not found' });

      await dbQuery(
        `INSERT INTO driver_schedules (unit_number, driver_id, date, leave_type, notes, created_at, updated_at)
         SELECT
           NULLIF(TRIM(lr.unit_number), ''),
           NULLIF(TRIM(lr.driver_name), ''),
           gs::date,
           NULLIF(TRIM(COALESCE(lr.leave_type, 'Leave')), ''),
           COALESCE(NULLIF(TRIM(lr.notes), ''), $2),
           NOW(),
           NOW()
         FROM leave_requests lr
         CROSS JOIN generate_series(lr.start_date::date, lr.end_date::date, INTERVAL '1 day') gs
         WHERE lr.id = $1
         ON CONFLICT (unit_number, date) DO NOTHING`,
        [id, `Auto-approved leave request #${id}`]
      );

      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/drivers/leave-request/:id/approve', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/drivers/leave-request/:id/deny', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
      const { rowCount } = await dbQuery(
        `UPDATE leave_requests
           SET status = 'denied', reviewed_at = NOW()
         WHERE id = $1`,
        [id]
      );
      if (!rowCount) return res.status(404).json({ ok: false, error: 'Leave request not found' });
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/drivers/leave-request/:id/deny', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


  app.post('/api/drivers/leave-requests/bulk-approve', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureDriverSchedulerTables();
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids array is required', updated: 0 });
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS leave_requests (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          start_date DATE,
          end_date DATE,
          leave_type TEXT,
          notes TEXT,
          status TEXT DEFAULT 'pending',
          reviewed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const { rows } = await dbQuery(
        `UPDATE leave_requests
           SET status = 'approved', reviewed_at = NOW()
         WHERE unit_number = ANY($1::text[])
         RETURNING *`,
        [ids]
      );
      const updatedRows = rows || [];
      for (const reqRow of updatedRows) {
        const start = String(reqRow.start_date || '').slice(0, 10);
        const end = String(reqRow.end_date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
        const leaveType = String(reqRow.leave_type || 'Leave').trim() || 'Leave';
        let d = new Date(`${start}T00:00:00Z`);
        const until = new Date(`${end}T00:00:00Z`);
        while (d <= until) {
          const iso = d.toISOString().slice(0, 10);
          await dbQuery(
            `INSERT INTO driver_schedules (unit_number, driver_id, date, leave_type, notes, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,now(),now())
             ON CONFLICT (unit_number, date)
             DO UPDATE SET
               driver_id = EXCLUDED.driver_id,
               leave_type = EXCLUDED.leave_type,
               notes = EXCLUDED.notes,
               updated_at = now()`,
            [
              String(reqRow.unit_number || '').trim() || null,
              String(reqRow.driver_name || '').trim() || null,
              iso,
              leaveType,
              String(reqRow.notes || '').trim() || `Auto-approved leave request #${reqRow.id}`,
            ]
          );
          d.setUTCDate(d.getUTCDate() + 1);
        }
      }
      return res.json({ ok: true, updated: updatedRows.length });
    } catch (e) {
      logError('POST /api/drivers/leave-requests/bulk-approve', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), updated: 0 });
    }
  });

  app.post('/api/drivers/leave-requests/bulk-deny', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'ids array is required', updated: 0 });
      const { rowCount } = await dbQuery(
        `UPDATE leave_requests
           SET status = 'denied', reviewed_at = NOW()
         WHERE unit_number = ANY($1::text[])`,
        [ids]
      );
      return res.json({ ok: true, updated: Number(rowCount || 0) });
    } catch (e) {
      logError('POST /api/drivers/leave-requests/bulk-deny', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), updated: 0 });
    }
  });

  app.post('/api/pre-trip/submit', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      await dbQuery(
        `CREATE TABLE IF NOT EXISTS pre_trip_inspections (
          id SERIAL PRIMARY KEY,
          unit_number TEXT,
          driver_name TEXT,
          odometer INTEGER,
          items JSONB,
          passed BOOLEAN,
          signature TEXT,
          submitted_at TIMESTAMPTZ DEFAULT NOW()
        )`
      );
      const overall = String(b.overall_result || '').toLowerCase();
      const passed = b.passed != null ? Boolean(b.passed) : overall === 'pass';
      const { rows } = await dbQuery(
        `INSERT INTO pre_trip_inspections (
          unit_number, driver_name, odometer, items, passed, signature
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id`,
        [
          String(b.unit || b.unit_number || '').trim() || null,
          String(b.driver || b.driver_name || '').trim() || null,
          Number.isFinite(Number(b.odometer ?? b.odometer_reading)) ? Number(b.odometer ?? b.odometer_reading) : null,
          JSON.stringify(Array.isArray(b.items) ? b.items : Array.isArray(b.checklist) ? b.checklist : []),
          passed,
          String(b.signature || b.driver_signature || '').trim() || null,
        ]
      );
      return res.json({ ok: true, inspection_id: rows?.[0]?.id || null });
    } catch (e) {
      logError('POST /api/pre-trip/submit', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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
