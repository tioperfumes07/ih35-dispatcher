/**
 * Core read-only ERP HTTP surfaces expected by the maintenance shell and `scripts/system-smoke.mjs`.
 */

import { getPool, dbQuery } from '../lib/db.mjs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
import { fetchSamsaraDriversNormalized } from '../lib/samsara-client.mjs';
import multer from 'multer';
import { extractPdfText } from '../lib/pdf-text.mjs';
import fs from 'node:fs';
import path from 'node:path';

const QBO_ERR_STALE_MS = 24 * 60 * 60 * 1000;
const SAMSARA_HEALTH_CACHE_MS = 60 * 1000;
const SAMSARA_HEALTH_TIMEOUT_MS = 10000;
const EXTERNAL_API_TIMEOUT_MS = 10000;
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

/** Short-lived cache for thin QBO list GETs (avoids hammering QBO when many fields hydrate). */
const QBO_LIST_GET_CACHE_MS = 5 * 60 * 1000;
let qboListGetCache = { bundle: null, expiresAt: 0 };

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
let cacheCleanupTimer = null;

async function withTimeout(promise, timeoutMs = EXTERNAL_API_TIMEOUT_MS, label = 'external call') {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function qboSqlEscapeQueryValue(s) {
  return String(s ?? '').replace(/'/g, "''");
}

function qboQueryEntityRows(data, entityName) {
  const qr = data?.QueryResponse || {};
  const rows = qr[entityName];
  if (!rows) return [];
  return Array.isArray(rows) ? rows : [rows];
}

function qboQueryEntityFirst(data, entityName) {
  const rows = qboQueryEntityRows(data, entityName);
  return rows[0] || null;
}

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
      types: 'gps,obdOdometerMeters,engineStates,fuelPercents',
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
      retry_count INTEGER DEFAULT 0,
      last_attempt_at TIMESTAMPTZ,
      next_retry_at TIMESTAMPTZ
    )
  `);
  await dbQuery('ALTER TABLE qbo_sync_queue ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ');
  await dbQuery('ALTER TABLE qbo_sync_queue ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ');
  await dbQuery('CREATE INDEX IF NOT EXISTS idx_qbo_sync_queue_status_created ON qbo_sync_queue(status, created_at DESC)');
  await dbQuery('CREATE INDEX IF NOT EXISTS idx_qbo_sync_queue_next_retry ON qbo_sync_queue(next_retry_at)');
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
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS relay_card_assignments (
      id SERIAL PRIMARY KEY,
      card_last4 TEXT NOT NULL,
      unit_number TEXT,
      driver_name TEXT,
      vendor_name TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      assigned_by TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_card_assignments_card_last4_active
    ON relay_card_assignments (card_last4)
    WHERE active = true
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_relay_card_assignments_unit
    ON relay_card_assignments (unit_number, active)
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS relay_webhook_events (
      id SERIAL PRIMARY KEY,
      external_event_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      error_message TEXT,
      processed_count INTEGER NOT NULL DEFAULT 0,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await dbQuery('CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_webhook_events_external_event_id ON relay_webhook_events (external_event_id)');
  await dbQuery('CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_webhook_events_payload_hash ON relay_webhook_events (payload_hash)');
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

function toBoolSetting(v, fallback = false) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return Boolean(fallback);
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return Boolean(fallback);
}

function safeEqualText(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length === 0 || bb.length === 0 || aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function relayPayloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function relayExtractToken(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const byHeader = String(req.headers?.['x-relay-token'] || req.headers?.['x-webhook-token'] || '').trim();
  return byHeader || '';
}

function relayExtractSignature(req) {
  return String(req.headers?.['x-relay-signature'] || req.headers?.['x-relay-signature-256'] || '').trim();
}

function relaySignatureValid(secret, payload, incoming) {
  if (!String(secret || '').trim() || !String(incoming || '').trim()) return false;
  const body = JSON.stringify(payload || {});
  const digest = createHmac('sha256', String(secret)).update(body).digest('hex');
  const normalizedIncoming = String(incoming).replace(/^sha256=/i, '').trim();
  return safeEqualText(digest, normalizedIncoming);
}

function relayToArray(body) {
  if (Array.isArray(body?.transactions)) return body.transactions;
  if (Array.isArray(body?.events)) return body.events;
  if (Array.isArray(body?.data)) return body.data;
  if (body && typeof body === 'object') return [body];
  return [];
}

function relayGetEventId(body) {
  const v =
    body?.event_id ||
    body?.eventId ||
    body?.id ||
    body?.webhook_id ||
    body?.transaction_id ||
    body?.data?.id;
  return String(v || '').trim();
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
    withTimeout(qbo.qboQuery('SELECT * FROM Vendor MAXRESULTS 1000'), EXTERNAL_API_TIMEOUT_MS, 'QBO Vendor query'),
    withTimeout(qbo.qboQuery('SELECT * FROM Account MAXRESULTS 1000'), EXTERNAL_API_TIMEOUT_MS, 'QBO Account query'),
    withTimeout(qbo.qboQuery('SELECT * FROM Item MAXRESULTS 1000'), EXTERNAL_API_TIMEOUT_MS, 'QBO Item query'),
    withTimeout(qbo.qboQuery('SELECT * FROM Class MAXRESULTS 1000'), EXTERNAL_API_TIMEOUT_MS, 'QBO Class query'),
    withTimeout(qbo.qboQuery('SELECT * FROM Customer MAXRESULTS 1000'), EXTERNAL_API_TIMEOUT_MS, 'QBO Customer query'),
  ]);
  const vendors = Array.isArray(vendorResp?.QueryResponse?.Vendor) ? vendorResp.QueryResponse.Vendor : [];
  const accounts = Array.isArray(accountResp?.QueryResponse?.Account) ? accountResp.QueryResponse.Account : [];
  const items = Array.isArray(itemResp?.QueryResponse?.Item) ? itemResp.QueryResponse.Item : [];
  const classes = Array.isArray(classResp?.QueryResponse?.Class) ? classResp.QueryResponse.Class : [];
  const customers = Array.isArray(customerResp?.QueryResponse?.Customer) ? customerResp.QueryResponse.Customer : [];
  console.log('[QBO] Catalog fetch counts:', {
    vendors: vendors.length,
    accounts: accounts.length,
    items: items.length,
    classes: classes.length,
    customers: customers.length
  });
  return { vendors, accounts, items, classes, customers };
}

function readFleetServiceTypesFromJsonFile() {
  try {
    const fp = path.join(process.cwd(), 'apps/fleet-reports-hub/server/data/service-types.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((row, i) => ({
        id: String(row.id || row.service_key || `json-${i}`),
        slug: String(row.service_key || '').trim() || null,
        name: String(row.service_name || row.name || '').trim(),
        category: row.service_category != null ? String(row.service_category) : null,
        interval_miles: row.interval_miles != null ? Number(row.interval_miles) : null,
        interval_months: row.interval_months != null ? Number(row.interval_months) : null,
        notes: row.notes != null ? String(row.notes) : null,
        vehicle_make: null,
        vehicle_model: null,
        avg_cost_low: row.avg_cost_low != null ? Number(row.avg_cost_low) : null,
        avg_cost_high: row.avg_cost_high != null ? Number(row.avg_cost_high) : null
      }))
      .filter((r) => r.name);
  } catch {
    return [];
  }
}

async function getQboBundleForThinListRoutes(logError) {
  const now = Date.now();
  if (qboListGetCache.bundle && now < qboListGetCache.expiresAt) {
    return qboListGetCache.bundle;
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const erp = readFullErpJson();
  const erpCache = erp?.qboCache && typeof erp.qboCache === 'object' ? erp.qboCache : {};
  let bundle = normalizeMasterBundle({
    vendors: arr(erpCache.vendors),
    items: arr(erpCache.items),
    accounts: arr(erpCache.accounts),
    classes: arr(erpCache.classes),
    customers: arr(erpCache.customers)
  });
  try {
    if (qboConnectionFlags().connected) {
      if (getPool()) {
        const synced = await syncQboCatalogCacheNow(logError, { silent: true });
        if (synced?.ok && synced?.bundle) bundle = synced.bundle;
      } else {
        const live = await fetchLiveQboCatalogBundle();
        bundle = normalizeMasterBundle(live);
      }
    }
  } catch (e) {
    logError('getQboBundleForThinListRoutes', e);
  }
  try {
    const flags = qboConnectionFlags();
    const nv = (bundle?.vendors || []).length;
    const na = (bundle?.accounts || []).length;
    if (flags.connected && (nv === 0 || na === 0)) {
      console.warn('[QBO] Thin list bundle is sparse while QBO reports connected:', {
        vendors: nv,
        accounts: na,
        customers: (bundle?.customers || []).length,
        items: (bundle?.items || []).length
      });
    }
  } catch {
    /* ignore */
  }
  qboListGetCache = { bundle, expiresAt: now + QBO_LIST_GET_CACHE_MS };
  return bundle;
}

function qboVendorAddressLinesFromEntity(v) {
  const b = v?.BillAddr;
  if (!b || typeof b !== 'object') return '';
  const parts = [b.Line1, b.Line2, b.Line3, b.City, b.CountrySubDivisionCode, b.PostalCode, b.Country]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.join('\n');
}

function mapQboVendorForApi(v) {
  const Id = String(v?.Id || v?.id || v?.qboId || '').trim();
  const DisplayName = String(v?.DisplayName || v?.name || '').trim();
  const CompanyName = String(v?.CompanyName || '').trim();
  const bal = Number(v?.Balance);
  const Active = v?.Active !== false && v?.active !== false;
  const vendorAddress = qboVendorAddressLinesFromEntity(v);
  return {
    Id,
    DisplayName,
    CompanyName,
    Balance: Number.isFinite(bal) ? bal : 0,
    Active,
    ...(vendorAddress ? { vendorAddress } : {})
  };
}
function mapQboAccountForApi(a) {
  const Id = String(a?.Id || a?.id || a?.qboId || '').trim();
  return {
    Id,
    Name: String(a?.Name || a?.name || '').trim(),
    AccountType: String(a?.AccountType || a?.accountType || '').trim(),
    Active: a?.Active !== false
  };
}
function mapQboCustomerForApi(c) {
  const Id = String(c?.Id || c?.id || c?.qboId || '').trim();
  const bal = Number(c?.Balance);
  return {
    Id,
    DisplayName: String(c?.DisplayName || c?.name || '').trim(),
    Balance: Number.isFinite(bal) ? bal : 0,
    Active: c?.Active !== false
  };
}
function mapQboItemForApi(it) {
  const Id = String(it?.Id || it?.id || it?.qboId || '').trim();
  return {
    Id,
    Name: String(it?.Name || it?.name || '').trim(),
    Sku: String(it?.Sku || '').trim(),
    UnitPrice: it?.UnitPrice != null ? Number(it.UnitPrice) : null,
    Description: String(it?.Description || '').trim(),
    Type: String(it?.Type || it?.type || '').trim(),
    Active: it?.Active !== false
  };
}
function mapQboClassForApi(c) {
  const Id = String(c?.Id || c?.id || c?.qboId || '').trim();
  return { Id, Name: String(c?.Name || c?.name || '').trim(), Active: c?.Active !== false };
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
  const maxRetries = Number.isFinite(Number(opts?.maxRetries)) ? Math.max(1, Number(opts.maxRetries)) : 8;
  const qboFlags = qboConnectionFlags();
  if (!qboFlags.connected) return { ok: true, synced: 0, failed: 0, skipped: 0, reason: 'qbo_not_connected' };
  const { rows } = await dbQuery(
    `SELECT * FROM qbo_sync_queue
      WHERE status IN ('pending','failed')
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY created_at ASC, id ASC
      LIMIT $1`,
    [limit]
  );
  const items = rows || [];
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let dead = 0;
  for (const item of items) {
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    const retries = Number(item?.retry_count || 0);
    if (retries >= maxRetries) {
      dead += 1;
      await dbQuery(
        `UPDATE qbo_sync_queue
            SET status = 'dead',
                error_message = COALESCE(error_message, 'Max retries exceeded'),
                last_attempt_at = now(),
                next_retry_at = NULL
          WHERE id = $1`,
        [item.id]
      );
      continue;
    }
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
        await withTimeout(
          qbo.qboPost(String(payload.qboEntity || '').trim().toLowerCase(), payload.qboPayload),
          EXTERNAL_API_TIMEOUT_MS,
          'QBO post queue replay'
        );
      } else {
        skipped += 1;
        await dbQuery(
          `UPDATE qbo_sync_queue
              SET status = 'skipped',
                  error_message = $2,
                  retry_count = COALESCE(retry_count,0) + 1,
                  last_attempt_at = now(),
                  next_retry_at = NULL
            WHERE id = $1`,
          [item.id, 'Unsupported queue payload']
        );
        continue;
      }
      synced += 1;
      await dbQuery(
        `UPDATE qbo_sync_queue
            SET status = 'synced',
                error_message = NULL,
                synced_at = now(),
                last_attempt_at = now(),
                next_retry_at = NULL
          WHERE id = $1`,
        [item.id]
      );
    } catch (e) {
      failed += 1;
      const nextRetries = retries + 1;
      const backoffMinutes = Math.min(240, Math.max(2, Math.pow(2, Math.min(6, nextRetries))));
      await dbQuery(
        `UPDATE qbo_sync_queue
            SET status = CASE WHEN COALESCE(retry_count,0) + 1 >= $3 THEN 'dead' ELSE 'failed' END,
                error_message = $2,
                retry_count = COALESCE(retry_count,0) + 1,
                last_attempt_at = now(),
                next_retry_at = CASE
                  WHEN COALESCE(retry_count,0) + 1 >= $3 THEN NULL
                  ELSE now() + ($4 || ' minutes')::interval
                END
          WHERE id = $1`,
        [item.id, String(e?.message || e || 'QBO sync failed').slice(0, 800), maxRetries, backoffMinutes]
      );
      logError('retryQboSyncQueue item failed', e);
    }
  }
  return { ok: true, synced, failed, skipped, dead };
}

async function normalizeQboPostQueueDeadLetters(maxRetries = 5) {
  if (!getPool()) return 0;
  await dbQuery(
    `UPDATE qbo_post_queue
        SET status = 'dead',
            updated_at = now()
      WHERE COALESCE(retry_count, 0) >= $1
        AND status NOT IN ('dead','posted')`,
    [Math.max(1, Number(maxRetries) || 5)]
  );
  return 0;
}

async function buildQboSyncAlertsPayload() {
  const { configured, connected } = qboConnectionFlags();
  const alerts = [];
  const counts = { total: 0, high: 0, medium: 0, low: 0, pending: 0, failed: 0, dead: 0 };
  if (!getPool()) {
    if (!configured) {
      alerts.push({
        code: 'qbo_not_configured',
        title: 'QuickBooks not configured',
        message: 'Connect QuickBooks to enable posting and live catalog sync.',
        severity: 'high',
      });
    } else if (!connected) {
      alerts.push({
        code: 'qbo_disconnected',
        title: 'QuickBooks disconnected',
        message: 'Posting is paused until the integration reconnects.',
        severity: 'high',
      });
    }
  } else {
    await ensureIntegrationResilienceTables();
    const { rows: countRows } = await dbQuery(
      `SELECT status, COUNT(*)::int AS n
         FROM qbo_sync_queue
        WHERE status IN ('pending','failed','dead')
        GROUP BY status`
    );
    for (const row of countRows || []) {
      const s = String(row?.status || '').toLowerCase();
      const n = Number(row?.n || 0);
      if (s === 'pending') counts.pending = n;
      if (s === 'failed') counts.failed = n;
      if (s === 'dead') counts.dead = n;
    }
    const { rows: sampleRows } = await dbQuery(
      `SELECT id, transaction_type, transaction_id, status, error_message, retry_count, created_at
         FROM qbo_sync_queue
        WHERE status IN ('failed','dead')
        ORDER BY created_at DESC, id DESC
        LIMIT 8`
    );

    const lastSyncRaw = await getIntegrationSetting('qbo_catalog_last_sync_at').catch(() => null);
    const lastSyncMs = lastSyncRaw ? Date.parse(String(lastSyncRaw)) : NaN;
    const staleMinutes = Number.isFinite(lastSyncMs) ? Math.max(0, Math.round((Date.now() - lastSyncMs) / 60000)) : null;

    if (!configured) {
      alerts.push({
        code: 'qbo_not_configured',
        title: 'QuickBooks not configured',
        message: 'Connect QuickBooks to enable posting and catalog sync.',
        severity: 'high',
      });
    } else if (!connected) {
      alerts.push({
        code: 'qbo_disconnected',
        title: 'QuickBooks disconnected',
        message: 'Posting is paused; transactions remain in queue until reconnected.',
        severity: 'high',
      });
    }
    if (counts.dead > 0) {
      alerts.push({
        code: 'qbo_dead_letters',
        title: `${counts.dead} queue item(s) reached retry limit`,
        message: 'Review dead-letter rows in Pending QBO Sync and re-submit after fixing data.',
        severity: 'high',
      });
    }
    if (counts.failed > 0) {
      alerts.push({
        code: 'qbo_failed_items',
        title: `${counts.failed} queue item(s) failed`,
        message: 'Auto-retry is active with backoff; manual retry is available.',
        severity: 'medium',
      });
    }
    if (counts.pending > 25) {
      alerts.push({
        code: 'qbo_queue_backlog',
        title: `${counts.pending} item(s) pending QBO sync`,
        message: 'Queue is growing; validate connection and mapping defaults.',
        severity: 'medium',
      });
    }
    if (connected && Number.isFinite(staleMinutes) && staleMinutes > 180) {
      alerts.push({
        code: 'qbo_catalog_stale',
        title: 'QBO catalog cache is stale',
        message: `Last successful catalog sync was ${staleMinutes} minute(s) ago.`,
        severity: 'low',
      });
    }
    (sampleRows || []).forEach((row) => {
      const rowSeverity = String(row?.status || '').toLowerCase() === 'dead' ? 'high' : 'medium';
      alerts.push({
        code: `qbo_queue_${String(row?.status || 'failed').toLowerCase()}`,
        title: `Queue #${row?.id || '—'} · ${String(row?.transaction_type || 'txn')}`,
        message: String(row?.error_message || 'Sync failed').slice(0, 220),
        severity: rowSeverity,
        queue_id: row?.id || null,
        queue_status: row?.status || null,
        retry_count: Number(row?.retry_count || 0),
        created_at: row?.created_at || null,
      });
    });
  }

  counts.total = alerts.length;
  counts.high = alerts.filter((a) => String(a?.severity || '') === 'high').length;
  counts.medium = alerts.filter((a) => String(a?.severity || '') === 'medium').length;
  counts.low = alerts.filter((a) => String(a?.severity || '') === 'low').length;
  return { ok: true, configured, connected, alerts, counts, lookbackDays: 120 };
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

  function reqRole(req) {
    const raw = String(
      req.headers['x-ih35-role'] ||
      req.headers['x-user-role'] ||
      req.headers['x-role'] ||
      ''
    ).trim().toLowerCase();
    return raw || '';
  }

  function requireCatalogWriteRole(req, res) {
    const role = reqRole(req);
    if (!role) return true; // Backward-compatible until full RBAC rollout in Wave 7.
    if (['admin', 'administrator', 'manager'].includes(role)) return true;
    res.status(403).json({ ok: false, error: 'Catalog write requires manager/admin role' });
    return false;
  }

  function requireAdminRole(req, res) {
    const role = reqRole(req);
    if (!role) return true; // Backward-compatible until full RBAC rollout in Wave 7.
    if (['admin', 'administrator'].includes(role)) return true;
    res.status(403).json({ ok: false, error: 'Admin role required' });
    return false;
  }

  function requireBankingWriteRole(req, res) {
    const role = reqRole(req);
    if (role === 'admin' || role === 'administrator' || role === 'accountant') return true;
    res.status(403).json({ ok: false, error: 'Banking write requires admin/accountant role' });
    return false;
  }

  const bankImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  }).single('file');

  function runBankImportUpload(req, res) {
    return new Promise((resolve, reject) => {
      bankImportUpload(req, res, (err) => (err ? reject(err) : resolve()));
    });
  }

  function parseCsvLine(line = '') {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function normalizeHeaderKey(v = '') {
    return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  function parseMoneyLike(raw = '') {
    if (raw == null) return 0;
    const txt = String(raw).trim();
    if (!txt) return 0;
    const neg = txt.startsWith('(') && txt.endsWith(')');
    const cleaned = txt.replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return 0;
    return neg ? -Math.abs(n) : n;
  }

  function parseDateLike(raw = '') {
    const txt = String(raw || '').trim();
    if (!txt) return '';
    const mmddyyyy = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (mmddyyyy) {
      let y = Number(mmddyyyy[3]);
      if (y < 100) y += 2000;
      const m = String(Number(mmddyyyy[1])).padStart(2, '0');
      const d = String(Number(mmddyyyy[2])).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const yyyymmdd = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) return txt;
    const dt = new Date(txt);
    if (Number.isFinite(dt.getTime())) return dt.toISOString().slice(0, 10);
    return '';
  }

  function buildTxnIdempotency(accountId, txnDate, amount, description, externalRef = '') {
    return createHash('sha256')
      .update([String(accountId || ''), String(txnDate || ''), String(amount || ''), String(description || ''), String(externalRef || '')].join('|'))
      .digest('hex');
  }

  function parseCsvBankTransactions(buffer, statementMonth = '') {
    const text = String(buffer?.toString('utf8') || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = parseCsvLine(lines[0]).map(normalizeHeaderKey);
    const idx = (cands) => {
      for (const c of cands) {
        const i = headers.indexOf(c);
        if (i >= 0) return i;
      }
      return -1;
    };
    const dateIdx = idx(['date', 'transaction_date', 'posted_date']);
    const descIdx = idx(['description', 'memo', 'details', 'vendor', 'payee']);
    const debitIdx = idx(['debit', 'withdrawal', 'withdrawals', 'outflow']);
    const creditIdx = idx(['credit', 'deposit', 'deposits', 'inflow']);
    const amountIdx = idx(['amount', 'transaction_amount', 'amt']);
    const balanceIdx = idx(['balance', 'running_balance']);
    const refIdx = idx(['reference', 'reference_id', 'id', 'external_ref', 'transaction_id']);
    const monthPrefix = String(statementMonth || '').trim();
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const rawDate = dateIdx >= 0 ? cols[dateIdx] : '';
      let txnDate = parseDateLike(rawDate);
      if (!txnDate && monthPrefix && /^\d{1,2}$/.test(String(rawDate || '').trim())) {
        txnDate = `${monthPrefix}-${String(Number(rawDate)).padStart(2, '0')}`;
      }
      const description = String(descIdx >= 0 ? cols[descIdx] : cols[1] || '').trim();
      const debit = debitIdx >= 0 ? parseMoneyLike(cols[debitIdx]) : 0;
      const credit = creditIdx >= 0 ? parseMoneyLike(cols[creditIdx]) : 0;
      let amount = amountIdx >= 0 ? parseMoneyLike(cols[amountIdx]) : 0;
      if (!amount && (debit || credit)) amount = credit ? Math.abs(credit) : -Math.abs(debit);
      const runningBalance = balanceIdx >= 0 ? parseMoneyLike(cols[balanceIdx]) : null;
      const externalRef = refIdx >= 0 ? String(cols[refIdx] || '').trim() : '';
      if (!txnDate || !description) continue;
      rows.push({
        txn_date: txnDate,
        description,
        amount,
        running_balance: Number.isFinite(Number(runningBalance)) ? Number(runningBalance) : null,
        external_ref: externalRef || null,
      });
    }
    return rows;
  }

  function parsePdfBankTransactions(pdfText = '', statementMonth = '') {
    const lines = String(pdfText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = [];
    const monthPrefix = String(statementMonth || '').trim();
    for (const line of lines) {
      const generic = line.match(/^(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s+(.+?)\s+(-?\$?[\d,]+\.\d{2})$/);
      const ibc = line.match(/^(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s+(.+?)\s+([\d,]*\.\d{2})\s+([\d,]*\.\d{2})$/);
      let txnDate = '';
      let description = '';
      let amount = 0;
      if (ibc) {
        txnDate = parseDateLike(ibc[1]);
        description = String(ibc[2] || '').trim();
        const debit = parseMoneyLike(ibc[3]);
        const credit = parseMoneyLike(ibc[4]);
        amount = credit ? Math.abs(credit) : -Math.abs(debit);
      } else if (generic) {
        txnDate = parseDateLike(generic[1]);
        description = String(generic[2] || '').trim();
        amount = parseMoneyLike(generic[3]);
      } else {
        continue;
      }
      if (!txnDate && monthPrefix && /^(\d{1,2})[/-](\d{1,2})$/.test(String(generic?.[1] || ibc?.[1] || ''))) {
        const m = String((generic?.[1] || ibc?.[1]).split(/[/-]/)[0]).padStart(2, '0');
        const d = String((generic?.[1] || ibc?.[1]).split(/[/-]/)[1]).padStart(2, '0');
        const yy = String(monthPrefix).split('-')[0];
        txnDate = `${yy}-${m}-${d}`;
      }
      if (!txnDate || !description || !Number.isFinite(Number(amount))) continue;
      rows.push({ txn_date: txnDate, description, amount, running_balance: null, external_ref: null });
    }
    return rows;
  }

  async function ensureAuditLogTable() {
    if (!getPoolForRoute()) return false;
    await dbQueryForRoute(
      `CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        actor TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_state JSONB,
        after_state JSONB,
        source_module TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await dbQueryForRoute('CREATE INDEX IF NOT EXISTS idx_audit_log_created_at_desc ON audit_log(created_at DESC)');
    await dbQueryForRoute('CREATE INDEX IF NOT EXISTS idx_audit_log_entity_ref ON audit_log(entity_type, entity_id)');
    return true;
  }

  async function writeAuditLog(req, payload = {}) {
    if (!getPoolForRoute()) return;
    await ensureAuditLogTable();
    await dbQueryForRoute(
      `INSERT INTO audit_log (
        actor, action, entity_type, entity_id,
        before_state, after_state, source_module, ip_address, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,now())`,
      [
        String(payload.actor || maintActor(req) || 'operator').trim() || 'operator',
        String(payload.action || 'unknown_action').trim(),
        String(payload.entity_type || 'unknown_entity').trim(),
        String(payload.entity_id || '').trim() || null,
        payload.before_state == null ? null : JSON.stringify(payload.before_state),
        payload.after_state == null ? null : JSON.stringify(payload.after_state),
        String(payload.source_module || 'maintenance').trim() || 'maintenance',
        String(req.headers['x-forwarded-for'] || req.ip || '').trim() || null,
      ]
    );
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

  if (!cacheCleanupTimer) {
    cleanupWave8Caches().catch((e) => logError('wave8 cache cleanup', e));
    cacheCleanupTimer = setInterval(() => {
      cleanupWave8Caches().catch((e) => logError('wave8 cache cleanup interval', e));
    }, 60 * 60 * 1000);
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
      relay_webhook_events: null,
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

  app.get('/api/qbo/open-bills', async (req, res) => {
    try {
      const { configured, connected } = qboConnectionFlags();
      if (!configured) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', bills: [] });
      }
      if (!connected) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not connected', bills: [] });
      }
      const qbo = createQboApiClient();
      const billId = String(req.query.billId || '').replace(/\D/g, '');
      const vendorId = String(req.query.vendorId || '').replace(/\D/g, '');
      const search = String(req.query.search || '').trim().toLowerCase();
      const maxResults = Math.min(800, Math.max(1, Number(req.query.maxResults) || 150));

      let billsRaw = [];
      if (billId) {
        const data = await withTimeout(
          qbo.qboQuery(`SELECT * FROM Bill WHERE Id = '${qboSqlEscapeQueryValue(billId)}' MAXRESULTS 1`),
          EXTERNAL_API_TIMEOUT_MS,
          'QBO Bill by id'
        );
        billsRaw = qboQueryEntityRows(data, 'Bill');
      } else {
        const escV = qboSqlEscapeQueryValue(vendorId);
        const q = vendorId
          ? `SELECT * FROM Bill WHERE Balance > '0' AND VendorRef = '${escV}' ORDERBY TxnDate DESC MAXRESULTS ${maxResults}`
          : `SELECT * FROM Bill WHERE Balance > '0' ORDERBY TxnDate DESC MAXRESULTS ${maxResults}`;
        const data = await withTimeout(qbo.qboQuery(q), EXTERNAL_API_TIMEOUT_MS, 'QBO open bills');
        billsRaw = qboQueryEntityRows(data, 'Bill');
      }

      const vendorData = await withTimeout(
        qbo.qboQuery('SELECT Id, DisplayName, CompanyName FROM Vendor MAXRESULTS 1000'),
        EXTERNAL_API_TIMEOUT_MS,
        'QBO vendors for open bills'
      );
      const vendorNameById = new Map();
      for (const v of qboQueryEntityRows(vendorData, 'Vendor')) {
        const id = String(v?.Id || '').trim();
        if (!id) continue;
        const nm = String(v?.DisplayName || v?.CompanyName || '').trim();
        vendorNameById.set(id, nm);
      }

      let bills = billsRaw.map((b) => {
        const vid = String(b?.VendorRef?.value || b?.VendorRef?.name || '')
          .trim()
          .replace(/\D/g, '');
        const bal = Number(b?.Balance != null ? b.Balance : b?.TotalAmt) || 0;
        return {
          id: String(b?.Id || '').trim(),
          docNumber: String(b?.DocNumber || '').trim(),
          txnDate: String(b?.TxnDate || '').slice(0, 10),
          dueDate: String(b?.DueDate || '').slice(0, 10),
          balance: bal,
          vendorId: vid,
          vendorName: vendorNameById.get(vid) || ''
        };
      });

      if (search) {
        bills = bills.filter(
          (b) =>
            String(b.docNumber || '')
              .toLowerCase()
              .includes(search) ||
            String(b.vendorName || '')
              .toLowerCase()
              .includes(search) ||
            String(b.id || '').includes(search)
        );
      }

      return res.json({ ok: true, bills, notice: '' });
    } catch (e) {
      logError('GET /api/qbo/open-bills', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), bills: [] });
    }
  });

  app.get('/api/qbo/vendors', async (_req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const vendors = (bundle.vendors || []).map(mapQboVendorForApi).filter((v) => v.Id);
      console.log('[QBO] GET /api/qbo/vendors →', vendors.length, 'vendors');
      return res.json({ ok: true, vendors });
    } catch (e) {
      logError('GET /api/qbo/vendors', e);
      return res.json({ ok: false, error: e?.message || String(e), vendors: [] });
    }
  });

  app.get('/api/qbo/vendors/search', async (req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const q = String(req.query?.q || '').trim().toLowerCase();
      let vendors = (bundle.vendors || []).map(mapQboVendorForApi).filter((v) => v.Id);
      if (q) {
        vendors = vendors.filter(
          (v) =>
            v.DisplayName.toLowerCase().includes(q) ||
            (v.CompanyName && v.CompanyName.toLowerCase().includes(q))
        );
      }
      return res.json({ ok: true, vendors });
    } catch (e) {
      logError('GET /api/qbo/vendors/search', e);
      return res.json({ ok: false, error: e?.message || String(e), vendors: [] });
    }
  });

  app.get('/api/qbo/accounts', async (_req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const accounts = (bundle.accounts || []).map(mapQboAccountForApi).filter((a) => a.Id);
      console.log('[QBO] GET /api/qbo/accounts →', accounts.length, 'accounts');
      return res.json({ ok: true, accounts });
    } catch (e) {
      logError('GET /api/qbo/accounts', e);
      return res.json({ ok: false, error: e?.message || String(e), accounts: [] });
    }
  });

  app.get('/api/qbo/customers', async (_req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const customers = (bundle.customers || []).map(mapQboCustomerForApi).filter((c) => c.Id);
      return res.json({ ok: true, customers });
    } catch (e) {
      logError('GET /api/qbo/customers', e);
      return res.json({ ok: false, error: e?.message || String(e), customers: [] });
    }
  });

  app.get('/api/qbo/items', async (_req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const items = (bundle.items || []).map(mapQboItemForApi).filter((it) => it.Id);
      return res.json({ ok: true, items });
    } catch (e) {
      logError('GET /api/qbo/items', e);
      return res.json({ ok: false, error: e?.message || String(e), items: [] });
    }
  });

  app.get('/api/qbo/classes', async (_req, res) => {
    try {
      const bundle = await getQboBundleForThinListRoutes(logError);
      const classes = (bundle.classes || []).map(mapQboClassForApi).filter((c) => c.Id);
      return res.json({ ok: true, classes });
    } catch (e) {
      logError('GET /api/qbo/classes', e);
      return res.json({ ok: false, error: e?.message || String(e), classes: [] });
    }
  });

  app.post('/api/qbo/bill-payment', async (req, res) => {
    if (!requireBankingWriteRole(req, res)) return;
    try {
      const { configured, connected } = qboConnectionFlags();
      if (!configured || !connected) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const vendorQboId = String(body.vendorQboId || '').replace(/\D/g, '');
      const bankAccountQboId = String(body.bankAccountQboId || '').replace(/\D/g, '');
      const payType = String(body.payType || 'Check').trim();
      const txnDate = String(body.txnDate || '').trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
      const checkNumRaw = String(body.checkNum || '').trim();
      const privateNote = body.privateNote != null ? String(body.privateNote).slice(0, 4000) : '';
      const linesIn = Array.isArray(body.lines) ? body.lines : [];
      const lines = linesIn
        .map((l) => ({
          billId: String(l?.billId || '').replace(/\D/g, ''),
          amount: Math.round(Number(l?.amount) * 100) / 100
        }))
        .filter((l) => l.billId && l.amount > 0);

      if (!vendorQboId) return res.status(400).json({ ok: false, error: 'vendorQboId required' });
      if (!bankAccountQboId) return res.status(400).json({ ok: false, error: 'bankAccountQboId required' });
      if (!lines.length) return res.status(400).json({ ok: false, error: 'At least one payment line required' });

      const qbo = createQboApiClient();

      async function fetchBill(bid) {
        const data = await withTimeout(
          qbo.qboQuery(`SELECT * FROM Bill WHERE Id = '${qboSqlEscapeQueryValue(bid)}' MAXRESULTS 1`),
          EXTERNAL_API_TIMEOUT_MS,
          'QBO Bill for payment'
        );
        return qboQueryEntityFirst(data, 'Bill');
      }

      async function nextBillPaymentDocNumber(baseRaw) {
        const base = String(baseRaw || '').trim() || 'PAY';
        for (let i = 0; i < 500; i += 1) {
          const candidate = i === 0 ? base : `${base}-${i}`;
          const cq = qboSqlEscapeQueryValue(candidate);
          const q = `SELECT Id FROM BillPayment WHERE DocNumber = '${cq}' MAXRESULTS 1`;
          const data = await withTimeout(qbo.qboQuery(q), EXTERNAL_API_TIMEOUT_MS, 'QBO BillPayment doc lookup');
          const hit = qboQueryEntityFirst(data, 'BillPayment');
          if (!hit) return candidate.slice(0, 21);
        }
        return `${base}-${Date.now()}`.slice(0, 21);
      }

      const billRows = [];
      for (const l of lines) {
        const b = await fetchBill(l.billId);
        if (!b || !b.Id) {
          return res.status(400).json({ ok: false, error: `Bill not found in QuickBooks: ${l.billId}` });
        }
        const vid = String(b?.VendorRef?.value || '').trim().replace(/\D/g, '');
        if (vid !== vendorQboId) {
          return res.status(400).json({
            ok: false,
            error: `Bill ${l.billId} belongs to a different vendor than the payment vendor`
          });
        }
        const openBal = Number(b?.Balance != null ? b.Balance : b?.TotalAmt) || 0;
        if (l.amount - openBal > 0.02) {
          return res.status(400).json({
            ok: false,
            error: `Pay amount exceeds open balance for bill ${l.billId}`
          });
        }
        billRows.push(b);
      }

      const primaryDocBase = String(billRows[0]?.DocNumber || '').trim() || String(lines[0].billId || '').trim();
      const isCheck = String(payType).toLowerCase() === 'check';
      let docNumber;
      if (isCheck && checkNumRaw) {
        docNumber = checkNumRaw.slice(0, 21);
      } else {
        docNumber = await nextBillPaymentDocNumber(primaryDocBase);
      }

      const totalPay = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const bp = {
        VendorRef: { value: vendorQboId },
        PayType: isCheck ? 'Check' : 'CreditCard',
        TotalAmt: totalPay,
        Line: lines.map((l) => ({
          Amount: l.amount,
          LinkedTxn: [{ TxnId: l.billId, TxnType: 'Bill' }]
        }))
      };
      if (docNumber) bp.DocNumber = docNumber;
      if (txnDate) bp.TxnDate = txnDate;
      if (privateNote) bp.PrivateNote = privateNote;
      if (isCheck) {
        bp.CheckPayment = {
          BankAccountRef: { value: bankAccountQboId },
          PrintStatus: 'NotSet'
        };
      } else {
        bp.CreditCardPayment = {
          CCAccountRef: { value: bankAccountQboId }
        };
      }

      const posted = await withTimeout(qbo.qboPost('billpayment', bp), EXTERNAL_API_TIMEOUT_MS, 'QBO billpayment post');
      const billPayment = posted?.BillPayment || posted;
      const billPaymentId = String(billPayment?.Id || posted?.Id || '').trim();
      const docOut = String(billPayment?.DocNumber || docNumber || '').trim();
      return res.json({ ok: true, billPaymentId, docNumber: docOut, erpLogId: null });
    } catch (e) {
      logError('POST /api/qbo/bill-payment', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  /** Standalone check (QBO Purchase, PaymentType Check) — vendor payee + bank + expense line. */
  app.post('/api/qbo/purchase-check', async (req, res) => {
    if (!requireBankingWriteRole(req, res)) return;
    try {
      const { configured, connected } = qboConnectionFlags();
      if (!configured || !connected) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const vendorQboId = String(body.vendorQboId || body.vendorId || '').replace(/\D/g, '');
      const bankAccountQboId = String(body.bankAccountQboId || body.bankId || '').replace(/\D/g, '');
      const expenseAccountQboId = String(body.expenseAccountQboId || body.accountId || '').replace(/\D/g, '');
      const checkNumber = String(body.checkNumber || body.docNumber || '').trim().slice(0, 21);
      const txnDate = String(body.txnDate || '').trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
      const memo = body.memo != null ? String(body.memo).trim().slice(0, 4000) : '';
      const addr = body.vendorAddress != null ? String(body.vendorAddress).trim().slice(0, 2000) : '';
      const totalAmt = Math.round(Number(body.totalAmt || body.amount || 0) * 100) / 100;
      if (!vendorQboId) return res.status(400).json({ ok: false, error: 'vendorQboId required' });
      if (!bankAccountQboId) return res.status(400).json({ ok: false, error: 'bankAccountQboId required' });
      if (!expenseAccountQboId) return res.status(400).json({ ok: false, error: 'expenseAccountQboId required' });
      if (!checkNumber) return res.status(400).json({ ok: false, error: 'checkNumber required' });
      if (!Number.isFinite(totalAmt) || totalAmt <= 0) {
        return res.status(400).json({ ok: false, error: 'totalAmt must be a positive number' });
      }
      const qbo = createQboApiClient();
      const privateNote = [memo, addr].filter(Boolean).join(' | ') || undefined;
      const payload = {
        PaymentType: 'Check',
        CheckPayment: {
          BankAccountRef: { value: bankAccountQboId },
          PrintStatus: 'NeedToPrint'
        },
        EntityRef: { value: vendorQboId, type: 'Vendor' },
        DocNumber: checkNumber,
        TxnDate: txnDate,
        PrivateNote: privateNote,
        Line: [
          {
            Amount: totalAmt,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: expenseAccountQboId }
            }
          }
        ]
      };
      const posted = await withTimeout(qbo.qboPost('purchase', payload), EXTERNAL_API_TIMEOUT_MS, 'QBO purchase check');
      const purchaseId = String(posted?.Purchase?.Id || posted?.Id || '').trim();
      return res.json({ ok: true, purchaseId, checkNumber, txnDate });
    } catch (e) {
      logError('POST /api/qbo/purchase-check', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/qbo/sync-alerts', async (_req, res) => {
    try {
      const payload = await buildQboSyncAlertsPayload();
      res.json(payload);
    } catch (e) {
      logError('GET /api/qbo/sync-alerts', e);
      const { configured, connected } = qboConnectionFlags();
      res.json({
        ok: true,
        alerts: [],
        counts: { total: 0, high: 0, medium: 0, low: 0, pending: 0, failed: 0, dead: 0 },
        lookbackDays: 120,
        configured,
        connected,
      });
    }
  });

  app.post('/api/qbo/sync-catalog', async (_req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      const synced = await syncQboCatalogCacheNow(logError);
      if (!synced?.ok) {
        return res.status(503).json({ ok: false, error: synced?.error || 'QuickBooks sync failed', synced: synced?.synced || { vendors: 0, accounts: 0, items: 0, classes: 0 } });
      }
      qboListGetCache = { bundle: null, expiresAt: 0 };
      return res.json({ ok: true, synced: synced.synced, source: 'live', refreshedAt: synced.refreshedAt || new Date().toISOString() });
    } catch (e) {
      logError('POST /api/qbo/sync-catalog', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), synced: { vendors: 0, accounts: 0, items: 0, classes: 0 } });
    }
  });

  app.get('/api/qbo/sync-queue', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, pending: 0, failed: 0, dead: 0, items: [] });
      await ensureIntegrationResilienceTables();
      await ensureBankingTables();
      await normalizeQboPostQueueDeadLetters(5);
      const { rows } = await dbQuery(
        `SELECT * FROM qbo_sync_queue
          WHERE status IN ('pending','failed','dead')
          ORDER BY created_at DESC, id DESC
          LIMIT 500`
      );
      const items = rows || [];
      const pending = items.filter((r) => String(r.status || '').toLowerCase() === 'pending').length;
      const failed = items.filter((r) => String(r.status || '').toLowerCase() === 'failed').length;
      const dead = items.filter((r) => String(r.status || '').toLowerCase() === 'dead').length;
      return res.json({ ok: true, pending, failed, dead, items });
    } catch (e) {
      logError('GET /api/qbo/sync-queue', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), pending: 0, failed: 0, dead: 0, items: [] });
    }
  });

  app.get('/api/qbo/sync-queue/dead', async (_req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, data: [] });
      await ensureIntegrationResilienceTables();
      await ensureBankingTables();
      await normalizeQboPostQueueDeadLetters(5);
      const { rows: syncRows } = await dbQuery(
        `SELECT id, 'qbo_sync_queue'::text AS queue_name, transaction_type, transaction_id::text AS entity_id, status, error_message, retry_count, created_at
           FROM qbo_sync_queue
          WHERE status = 'dead'
          ORDER BY created_at DESC, id DESC
          LIMIT 500`
      );
      const { rows: postRows } = await dbQuery(
        `SELECT id, 'qbo_post_queue'::text AS queue_name, entity_type AS transaction_type, entity_id, status, error_text AS error_message, COALESCE(retry_count,0) AS retry_count, created_at
           FROM qbo_post_queue
          WHERE status = 'dead'
          ORDER BY created_at DESC, id DESC
          LIMIT 500`
      );
      return res.json({ ok: true, data: [...(syncRows || []), ...(postRows || [])] });
    } catch (e) {
      logError('GET /api/qbo/sync-queue/dead', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), data: [] });
    }
  });

  app.post('/api/qbo/sync-queue/retry', async (_req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set', synced: 0, failed: 0 });
      await ensureIntegrationResilienceTables();
      const out = await retryQboSyncQueue(logError, { limit: 500 });
      return res.json({ ok: true, synced: Number(out?.synced || 0), failed: Number(out?.failed || 0), skipped: Number(out?.skipped || 0), dead: Number(out?.dead || 0), reason: out?.reason || null });
    } catch (e) {
      logError('POST /api/qbo/sync-queue/retry', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), synced: 0, failed: 0, skipped: 0, dead: 0 });
    }
  });

  app.post('/api/qbo/sync-queue/:id/retry', async (req, res) => {
    try {
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid id' });
      const { rows: syncRows } = await dbQuery('SELECT id FROM qbo_sync_queue WHERE id = $1 LIMIT 1', [id]);
      if (syncRows?.[0]?.id) {
        await dbQuery(
          `UPDATE qbo_sync_queue
              SET status = 'pending',
                  error_message = NULL,
                  retry_count = 0,
                  next_retry_at = NULL,
                  last_attempt_at = now()
            WHERE id = $1`,
          [id]
        );
        return res.json({ ok: true, retried: true, queue_name: 'qbo_sync_queue', id });
      }
      const { rows: postRows } = await dbQuery('SELECT id FROM qbo_post_queue WHERE id = $1 LIMIT 1', [id]);
      if (postRows?.[0]?.id) {
        await dbQuery(
          `UPDATE qbo_post_queue
              SET status = 'queued',
                  error_text = NULL,
                  retry_count = 0,
                  next_retry_at = NULL,
                  last_attempt_at = now(),
                  updated_at = now()
            WHERE id = $1`,
          [id]
        );
        return res.json({ ok: true, retried: true, queue_name: 'qbo_post_queue', id });
      }
      return res.status(404).json({ ok: false, error: 'Queue item not found' });
    } catch (e) {
      logError('POST /api/qbo/sync-queue/:id/retry', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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

  /**
   * Full ERP maintenance document (records, AP, work orders, fuel relay rows, etc.).
   * Reads the same JSON store as `readFullErpJson` — must not be overridden by a stub in server.js.
   */
  app.get('/api/maintenance/records', (_req, res) => {
    try {
      const full = readFullErpJson();
      const base = full && typeof full === 'object' ? full : {};
      const records = Array.isArray(base.records) ? base.records : [];
      const apTransactions = Array.isArray(base.apTransactions) ? base.apTransactions : [];
      const workOrders = Array.isArray(base.workOrders) ? base.workOrders : [];
      return res.json({
        ok: true,
        ...base,
        records,
        apTransactions,
        workOrders
      });
    } catch (e) {
      logError('GET /api/maintenance/records', e);
      return res.status(500).json({
        ok: false,
        error: e?.message || String(e),
        records: [],
        apTransactions: [],
        workOrders: []
      });
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

      // Wave 3 reliability: never wait on live Samsara for fleet table/assets reads.
      const cachedAssignments = await readCachedSamsaraAssignments().catch(() => []);
      const assignmentByUnit = new Map();
      (Array.isArray(cachedAssignments) ? cachedAssignments : []).forEach((row) => {
        const unitName = String(row?.unit_number || '').trim();
        const driverName = String(row?.driver_name || '').trim();
        if (!unitName || !driverName) return;
        assignmentByUnit.set(unitName, {
          driverName,
          driverStatus: String(row?.duty_status || '').trim().toLowerCase() || 'unknown',
          driverId: String(row?.driver_samsara_id || '').trim() || null,
        });
      });

      const assetsWithAssignments = assets.map((asset) => {
        const unitName = String(asset?.unit_number || '').trim();
        const m = assignmentByUnit.get(unitName);
        if (!m?.driverName) return asset;
        return {
          ...asset,
          current_driver_name: m.driverName,
          currentDriverName: m.driverName,
          currentDriver: m.driverName,
          currentDriverStatus: m.driverStatus || 'unknown',
          currentDriverId: m.driverId || null,
          driver_name: m.driverName,
        };
      });

      const filtered = statusQ
        ? assetsWithAssignments.filter((a) => String(a?.status || '').trim().toLowerCase() === statusQ)
        : assetsWithAssignments;
      return res.json({ ok: true, assets: filtered, data: filtered, count: filtered.length, source: 'internal-db' });
    } catch (e) {
      logError('GET /api/fleet/assets', e);
      return res.json({ ok: true, error: e?.message || String(e), assets: [], data: [], source: 'internal-db' });
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

  app.get('/api/catalog/service-types', async (req, res) => {
    try {
      const q = String(req.query?.search || req.query?.q || '')
        .trim()
        .toLowerCase();
      if (!getPoolForRoute()) {
        let services = readFleetServiceTypesFromJsonFile();
        if (q) {
          services = services.filter(
            (s) =>
              String(s.name || '')
                .toLowerCase()
                .includes(q) ||
              String(s.slug || '')
                .toLowerCase()
                .includes(q) ||
              String(s.category || '')
                .toLowerCase()
                .includes(q)
          );
        }
        return res.json({ ok: true, services, data: services });
      }
      await ensureFleetCatalogSeedRows(logError);
      const { rows } = await dbQueryForRoute(
        `SELECT id, slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model
           FROM service_types
          ORDER BY name ASC`
      );
      let services = rows || [];
      if (q) {
        services = services.filter(
          (s) =>
            String(s.name || '')
              .toLowerCase()
              .includes(q) ||
            String(s.slug || '')
              .toLowerCase()
              .includes(q) ||
            String(s.category || '')
              .toLowerCase()
              .includes(q)
        );
      }
      return res.json({ ok: true, services, data: services });
    } catch (e) {
      logError('GET /api/catalog/service-types', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), services: [], data: [] });
    }
  });

  app.post('/api/catalog/service-types', async (req, res) => {
    try {
      if (!requireCatalogWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
      const slug = String(b.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
      const intervalMiles = b.interval_miles == null || b.interval_miles === '' ? null : Number(b.interval_miles);
      const intervalMonths = b.interval_months == null || b.interval_months === '' ? null : Number(b.interval_months);
      const result = await dbQueryForRoute(
        `INSERT INTO service_types
          (slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model`,
        [
          slug,
          name,
          String(b.category || '').trim() || null,
          Number.isFinite(intervalMiles) ? intervalMiles : null,
          Number.isFinite(intervalMonths) ? intervalMonths : null,
          String(b.notes || '').trim() || null,
          String(b.vehicle_make || '').trim() || null,
          String(b.vehicle_model || '').trim() || null,
        ]
      );
      const row = result.rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'catalog_service_type_create',
        entity_type: 'service_type',
        entity_id: String(row?.id || ''),
        before_state: null,
        after_state: row,
        source_module: 'catalog',
      }).catch(() => null);
      return res.status(201).json({ ok: true, service: row, data: row });
    } catch (e) {
      logError('POST /api/catalog/service-types', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.put('/api/catalog/service-types/:id', async (req, res) => {
    try {
      if (!requireCatalogWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'valid id required' });
      const before = await dbQueryForRoute('SELECT * FROM service_types WHERE id=$1', [id]);
      if (!before.rows?.length) return res.status(404).json({ ok: false, error: 'service type not found' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(b.name || before.rows[0].name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
      const slug = String(b.slug || before.rows[0].slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '_')).trim();
      const intervalMiles = b.interval_miles == null || b.interval_miles === '' ? null : Number(b.interval_miles);
      const intervalMonths = b.interval_months == null || b.interval_months === '' ? null : Number(b.interval_months);
      const result = await dbQueryForRoute(
        `UPDATE service_types
            SET slug=$1, name=$2, category=$3, interval_miles=$4, interval_months=$5,
                notes=$6, vehicle_make=$7, vehicle_model=$8
          WHERE id=$9
        RETURNING id, slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model`,
        [
          slug,
          name,
          String(b.category || '').trim() || null,
          Number.isFinite(intervalMiles) ? intervalMiles : null,
          Number.isFinite(intervalMonths) ? intervalMonths : null,
          String(b.notes || '').trim() || null,
          String(b.vehicle_make || '').trim() || null,
          String(b.vehicle_model || '').trim() || null,
          id,
        ]
      );
      const row = result.rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'catalog_service_type_update',
        entity_type: 'service_type',
        entity_id: String(id),
        before_state: before.rows[0],
        after_state: row,
        source_module: 'catalog',
      }).catch(() => null);
      return res.json({ ok: true, service: row, data: row });
    } catch (e) {
      logError('PUT /api/catalog/service-types/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/catalog/service-types/:id', async (req, res) => {
    try {
      if (!requireAdminRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'valid id required' });
      const before = await dbQueryForRoute('SELECT * FROM service_types WHERE id=$1', [id]);
      if (!before.rows?.length) return res.status(404).json({ ok: false, error: 'service type not found' });
      await dbQueryForRoute('DELETE FROM service_types WHERE id=$1', [id]);
      await writeAuditLog(req, {
        action: 'catalog_service_type_delete',
        entity_type: 'service_type',
        entity_id: String(id),
        before_state: before.rows[0],
        after_state: null,
        source_module: 'catalog',
      }).catch(() => null);
      return res.json({ ok: true, deleted: true, id });
    } catch (e) {
      logError('DELETE /api/catalog/service-types/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/catalog/parts', async (_req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, parts: [], data: [] });
      await ensureFleetCatalogSeedRows(logError);
      const { rows } = await dbQueryForRoute(
        `SELECT part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid
           FROM vehicle_parts_reference
          ORDER BY label ASC`
      );
      const parts = rows || [];
      return res.json({ ok: true, parts, data: parts });
    } catch (e) {
      logError('GET /api/catalog/parts', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), parts: [], data: [] });
    }
  });

  app.post('/api/catalog/parts', async (req, res) => {
    try {
      if (!requireCatalogWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const label = String(b.label || '').trim();
      if (!label) return res.status(400).json({ ok: false, error: 'label is required' });
      const partKey = String(b.part_key || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
      if (!partKey) return res.status(400).json({ ok: false, error: 'part_key is required' });
      const miles = b.avg_replacement_miles == null || b.avg_replacement_miles === '' ? null : Number(b.avg_replacement_miles);
      const months = b.avg_replacement_months == null || b.avg_replacement_months === '' ? null : Number(b.avg_replacement_months);
      const cost = b.avg_cost_mid == null || b.avg_cost_mid === '' ? null : Number(b.avg_cost_mid);
      const result = await dbQueryForRoute(
        `INSERT INTO vehicle_parts_reference (part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (part_key)
         DO UPDATE SET
           label = EXCLUDED.label,
           avg_replacement_miles = EXCLUDED.avg_replacement_miles,
           avg_replacement_months = EXCLUDED.avg_replacement_months,
           avg_cost_mid = EXCLUDED.avg_cost_mid
         RETURNING part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid`,
        [
          partKey,
          label,
          Number.isFinite(miles) ? miles : null,
          Number.isFinite(months) ? months : null,
          Number.isFinite(cost) ? cost : null,
        ]
      );
      const row = result.rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'catalog_part_upsert',
        entity_type: 'vehicle_part',
        entity_id: String(row?.part_key || partKey),
        before_state: null,
        after_state: row,
        source_module: 'catalog',
      }).catch(() => null);
      return res.status(201).json({ ok: true, part: row, data: row });
    } catch (e) {
      logError('POST /api/catalog/parts', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/catalog/parts/:partKey', async (req, res) => {
    try {
      if (!requireAdminRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      const partKey = String(req.params.partKey || '').trim();
      if (!partKey) return res.status(400).json({ ok: false, error: 'partKey is required' });
      const before = await dbQueryForRoute('SELECT * FROM vehicle_parts_reference WHERE part_key=$1', [partKey]);
      if (!before.rows?.length) return res.status(404).json({ ok: false, error: 'part not found' });
      await dbQueryForRoute('DELETE FROM vehicle_parts_reference WHERE part_key=$1', [partKey]);
      await writeAuditLog(req, {
        action: 'catalog_part_delete',
        entity_type: 'vehicle_part',
        entity_id: partKey,
        before_state: before.rows[0],
        after_state: null,
        source_module: 'catalog',
      }).catch(() => null);
      return res.json({ ok: true, deleted: true, part_key: partKey });
    } catch (e) {
      logError('DELETE /api/catalog/parts/:partKey', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
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

  async function ensureEquipmentAssignmentsTable() {
    if (!getPoolForRoute()) return false;
    await dbQueryForRoute(
      `CREATE TABLE IF NOT EXISTS equipment_assignments (
        id SERIAL PRIMARY KEY,
        equipment_id TEXT NOT NULL,
        unit_number TEXT NOT NULL,
        assigned_date TIMESTAMPTZ DEFAULT NOW(),
        unassigned_date TIMESTAMPTZ,
        assigned_by TEXT,
        notes TEXT,
        status TEXT DEFAULT 'assigned',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await dbQueryForRoute(
      `CREATE INDEX IF NOT EXISTS idx_equipment_assignments_equipment
         ON equipment_assignments (equipment_id, status, assigned_date DESC)`
    );
    await dbQueryForRoute(
      `CREATE INDEX IF NOT EXISTS idx_equipment_assignments_unit
         ON equipment_assignments (unit_number, status, assigned_date DESC)`
    );
    return true;
  }

  app.get('/api/equipment/assignments', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, data: [], count: 0 });
      await ensureEquipmentAssignmentsTable();
      const unit = String(req.query?.unit || '').trim();
      const equipmentId = String(req.query?.equipment_id || '').trim();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const where = [];
      const values = [];
      if (unit) {
        values.push(unit);
        where.push(`unit_number = $${values.length}`);
      }
      if (equipmentId) {
        values.push(equipmentId);
        where.push(`equipment_id = $${values.length}`);
      }
      if (status) {
        values.push(status);
        where.push(`status = $${values.length}`);
      }
      const sql = `SELECT id, equipment_id, unit_number, assigned_date, unassigned_date, assigned_by, notes, status
                     FROM equipment_assignments
                    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                    ORDER BY assigned_date DESC, id DESC
                    LIMIT 2000`;
      const { rows } = await dbQueryForRoute(sql, values);
      return res.json({ ok: true, data: rows || [], count: Number(rows?.length || 0) });
    } catch (e) {
      logError('GET /api/equipment/assignments', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), data: [], count: 0 });
    }
  });

  app.get('/api/equipment/assignments/history', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, data: [], count: 0 });
      await ensureEquipmentAssignmentsTable();
      const unit = String(req.query?.unit || '').trim();
      const equipmentId = String(req.query?.equipment_id || '').trim();
      const where = [];
      const values = [];
      if (unit) {
        values.push(unit);
        where.push(`unit_number = $${values.length}`);
      }
      if (equipmentId) {
        values.push(equipmentId);
        where.push(`equipment_id = $${values.length}`);
      }
      const sql = `SELECT id, equipment_id, unit_number, assigned_date, unassigned_date, assigned_by, notes, status
                     FROM equipment_assignments
                    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                    ORDER BY COALESCE(unassigned_date, assigned_date) DESC, id DESC
                    LIMIT 3000`;
      const { rows } = await dbQueryForRoute(sql, values);
      return res.json({ ok: true, data: rows || [], count: Number(rows?.length || 0) });
    } catch (e) {
      logError('GET /api/equipment/assignments/history', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), data: [], count: 0 });
    }
  });

  app.post('/api/equipment/assignments', async (req, res) => {
    try {
      if (!requireCatalogWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureEquipmentAssignmentsTable();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const equipmentIds = Array.isArray(b.equipment_ids)
        ? b.equipment_ids
        : b.equipment_id != null
          ? [b.equipment_id]
          : [];
      const unitNumbers = Array.isArray(b.unit_numbers)
        ? b.unit_numbers
        : b.unit_number != null
          ? [b.unit_number]
          : [];
      const cleanEquipmentIds = [...new Set(equipmentIds.map((v) => String(v || '').trim()).filter(Boolean))];
      const cleanUnitNumbers = [...new Set(unitNumbers.map((v) => String(v || '').trim()).filter(Boolean))];
      if (!cleanEquipmentIds.length || !cleanUnitNumbers.length) {
        return res.status(400).json({ ok: false, error: 'equipment_ids and unit_numbers are required arrays' });
      }
      const status = String(b.status || 'assigned').trim().toLowerCase() || 'assigned';
      const notes = String(b.notes || '').trim() || null;
      const assignedBy = String(b.assigned_by || maintActor(req)).trim() || maintActor(req);
      const assignedDate = String(b.assigned_date || '').trim() || new Date().toISOString();
      const created = [];
      for (const equipmentId of cleanEquipmentIds) {
        for (const unitNumber of cleanUnitNumbers) {
          const inserted = await dbQueryForRoute(
            `INSERT INTO equipment_assignments
              (equipment_id, unit_number, assigned_date, assigned_by, notes, status, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,now())
             RETURNING id, equipment_id, unit_number, assigned_date, unassigned_date, assigned_by, notes, status`,
            [equipmentId, unitNumber, assignedDate, assignedBy, notes, status]
          );
          const row = inserted.rows?.[0];
          if (row) {
            created.push(row);
            await writeAuditLog(req, {
              action: 'equipment_assignment_create',
              entity_type: 'equipment_assignment',
              entity_id: String(row.id || ''),
              before_state: null,
              after_state: row,
              source_module: 'equipment',
            }).catch(() => null);
          }
        }
      }
      return res.status(201).json({
        ok: true,
        data: created,
        created_count: created.length,
        assignment_mode: `${cleanEquipmentIds.length} equipment x ${cleanUnitNumbers.length} units`,
      });
    } catch (e) {
      logError('POST /api/equipment/assignments', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/equipment/assignments/unassign', async (req, res) => {
    try {
      if (!requireCatalogWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureEquipmentAssignmentsTable();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const ids = Array.isArray(b.assignment_ids)
        ? b.assignment_ids.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : [];
      const reason = String(b.reason || '').trim() || null;
      const unassignedDate = String(b.unassigned_date || '').trim() || new Date().toISOString();
      if (!ids.length) return res.status(400).json({ ok: false, error: 'assignment_ids array is required' });
      const before = await dbQueryForRoute(
        `SELECT id, equipment_id, unit_number, assigned_date, unassigned_date, assigned_by, notes, status
           FROM equipment_assignments
          WHERE id = ANY($1::int[])`,
        [ids]
      );
      if (!before.rows?.length) return res.status(404).json({ ok: false, error: 'No assignments found for ids' });
      const updated = await dbQueryForRoute(
        `UPDATE equipment_assignments
            SET status='unassigned',
                unassigned_date=$2,
                notes=CASE
                  WHEN $3::text IS NULL OR $3::text = '' THEN notes
                  WHEN notes IS NULL OR notes = '' THEN $3::text
                  ELSE notes || E'\n[Unassign reason] ' || $3::text
                END,
                updated_at=now()
          WHERE id = ANY($1::int[])
        RETURNING id, equipment_id, unit_number, assigned_date, unassigned_date, assigned_by, notes, status`,
        [ids, unassignedDate, reason]
      );
      for (const row of updated.rows || []) {
        const prior = (before.rows || []).find((r) => Number(r.id) === Number(row.id)) || null;
        await writeAuditLog(req, {
          action: 'equipment_assignment_unassign',
          entity_type: 'equipment_assignment',
          entity_id: String(row.id || ''),
          before_state: prior,
          after_state: row,
          source_module: 'equipment',
        }).catch(() => null);
      }
      return res.json({
        ok: true,
        data: updated.rows || [],
        updated_count: Number(updated.rowCount || 0),
      });
    } catch (e) {
      logError('POST /api/equipment/assignments/unassign', e);
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
      res.json({ ok: true, acknowledged: true, data: { acknowledged: true } });
    } catch (e) {
      logError('POST /api/damage/reports/:id/acknowledge', e);
      res.json({ ok: false, acknowledged: false, data: { acknowledged: false } });
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
        return res.json({ ok: true, workOrder: row, data: row });
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
      return res.json({ ok: true, workOrder: rows?.[0] || null, data: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/work-orders', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });


  function normalizeTransactionTypeKey(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    return s.replace(/[^a-z0-9]+/g, '_');
  }

  function transactionTypeRequiresDriver(typeKey) {
    const t = normalizeTransactionTypeKey(typeKey);
    return t.includes('repair') || t.includes('accident') || t.includes('tire');
  }

  function transactionTypeRequiresLoad(typeKey) {
    const t = normalizeTransactionTypeKey(typeKey);
    return t.includes('fuel') || t.includes('repair') || t.includes('accident') || t.includes('tire');
  }

  async function ensureTransactionsTable() {
    await dbQueryForRoute(
      `CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        transaction_type TEXT NOT NULL,
        unit_id TEXT,
        unit_number TEXT,
        asset_category TEXT,
        driver_id TEXT,
        driver_name TEXT,
        vendor_id TEXT,
        vendor_name TEXT,
        service_type TEXT,
        description TEXT,
        status TEXT DEFAULT 'open',
        priority TEXT DEFAULT 'normal',
        amount_estimated NUMERIC(12,2),
        amount_actual NUMERIC(12,2),
        load_number TEXT,
        location_type TEXT,
        qbo_status TEXT DEFAULT 'pending',
        qbo_txn_id TEXT,
        sync_error TEXT,
        created_by TEXT,
        updated_by TEXT,
        source_module TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        due_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )`
    );
  }

  app.post('/api/transactions', async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const transactionType = String(b.transaction_type || b.type || '').trim();
    const typeKey = normalizeTransactionTypeKey(transactionType);
    const driverId = String(b.driver_id || '').trim();
    const driverName = String(b.driver_name || b.driver || '').trim();
    const loadNumber = String(b.load_number || b.loadNumber || '').trim();

    if (!transactionType) {
      return res.status(400).json({ ok: false, error: 'transaction_type is required' });
    }
    if (transactionTypeRequiresDriver(typeKey) && !driverId && !driverName) {
      return res.status(400).json({ ok: false, error: 'driver_id is required for repair, accident, and tire types' });
    }
    if (transactionTypeRequiresLoad(typeKey) && !loadNumber) {
      return res.status(400).json({ ok: false, error: 'load_number is required for fuel, repair, accident, and tire types' });
    }

    const payload = {
      transaction_type: transactionType,
      unit_id: String(b.unit_id || '').trim() || null,
      unit_number: String(b.unit_number || b.unit || '').trim() || null,
      asset_category: String(b.asset_category || '').trim() || null,
      driver_id: driverId || null,
      driver_name: driverName || null,
      vendor_id: String(b.vendor_id || '').trim() || null,
      vendor_name: String(b.vendor_name || b.vendor || '').trim() || null,
      service_type: String(b.service_type || b.expense_type || '').trim() || null,
      description: String(b.description || '').trim() || null,
      status: String(b.status || '').trim() || 'open',
      priority: String(b.priority || '').trim() || 'normal',
      amount_estimated: b.amount_estimated == null || b.amount_estimated === '' ? null : Number(b.amount_estimated),
      amount_actual: b.amount_actual == null || b.amount_actual === '' ? null : Number(b.amount_actual),
      load_number: loadNumber || null,
      location_type: String(b.location_type || '').trim() || null,
      qbo_status: String(b.qbo_status || '').trim() || 'pending',
      qbo_txn_id: String(b.qbo_txn_id || '').trim() || null,
      sync_error: String(b.sync_error || '').trim() || null,
      created_by: String(b.created_by || '').trim() || null,
      updated_by: String(b.updated_by || '').trim() || null,
      source_module: String(b.source_module || 'maintenance_ui').trim(),
      due_at: String(b.due_at || '').trim() || null,
      completed_at: String(b.completed_at || '').trim() || null,
    };

    try {
      if (!getPoolForRoute()) {
        const erp = readFullErpJson();
        const list = Array.isArray(erp.transactions) ? erp.transactions : [];
        const row = {
          id: String(Date.now()),
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        erp.transactions = [row, ...list].slice(0, 3000);
        writeFullErpJson(erp);
        return res.json({ ok: true, transaction: row, data: row });
      }

      await ensureTransactionsTable();
      const { rows } = await dbQueryForRoute(
        `INSERT INTO transactions (
          transaction_type, unit_id, unit_number, asset_category, driver_id, driver_name,
          vendor_id, vendor_name, service_type, description, status, priority,
          amount_estimated, amount_actual, load_number, location_type,
          qbo_status, qbo_txn_id, sync_error, created_by, updated_by, source_module,
          due_at, completed_at, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,
          $23,$24,NOW(),NOW()
        ) RETURNING *`,
        [
          payload.transaction_type, payload.unit_id, payload.unit_number, payload.asset_category,
          payload.driver_id, payload.driver_name, payload.vendor_id, payload.vendor_name,
          payload.service_type, payload.description, payload.status, payload.priority,
          Number.isFinite(payload.amount_estimated) ? payload.amount_estimated : null,
          Number.isFinite(payload.amount_actual) ? payload.amount_actual : null,
          payload.load_number, payload.location_type, payload.qbo_status, payload.qbo_txn_id,
          payload.sync_error, payload.created_by, payload.updated_by, payload.source_module,
          payload.due_at, payload.completed_at,
        ]
      );
      return res.json({ ok: true, transaction: rows?.[0] || null, data: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/transactions', e);
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
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS state TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS miles_this_load NUMERIC');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS relay_event_id TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS relay_txn_id TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS relay_card_last4 TEXT');
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS relay_vendor TEXT');
    await dbQuery("ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'");
    await dbQuery('ALTER TABLE fuel_expenses ADD COLUMN IF NOT EXISTS transaction_date DATE');
    await dbQuery(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_expenses_relay_txn
       ON fuel_expenses (relay_txn_id)
       WHERE relay_txn_id IS NOT NULL`
    );
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

  async function ensureBankingTables() {
    await ensureIntegrationResilienceTables();
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS dip_bank_account_balances (
        id SERIAL PRIMARY KEY,
        account_id TEXT NOT NULL,
        account_name TEXT,
        account_last4 TEXT,
        account_type TEXT,
        month_key TEXT NOT NULL,
        opening_balance NUMERIC(14,2) DEFAULT 0,
        receipts NUMERIC(14,2) DEFAULT 0,
        disbursements NUMERIC(14,2) DEFAULT 0,
        ending_balance NUMERIC(14,2) DEFAULT 0,
        source TEXT DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (account_id, month_key)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS banking_transactions (
        id BIGSERIAL PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        qbo_txn_id TEXT UNIQUE,
        account_id TEXT NOT NULL,
        account_name TEXT,
        txn_type TEXT,
        txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
        posted_at TIMESTAMPTZ,
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        txn_direction TEXT DEFAULT 'debit',
        running_balance NUMERIC(14,2),
        description TEXT,
        vendor_name TEXT,
        memo TEXT,
        status TEXT NOT NULL DEFAULT 'uncategorized',
        category TEXT,
        category_source TEXT,
        cleared BOOLEAN DEFAULT false,
        reconciled BOOLEAN DEFAULT false,
        source TEXT DEFAULT 'qbo',
        source_ref TEXT,
        statement_id TEXT,
        qbo_status TEXT DEFAULT 'synced',
        qbo_sync_error TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS bank_account_preferences (
        id BIGSERIAL PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        account_name TEXT,
        account_type TEXT,
        visible BOOLEAN NOT NULL DEFAULT true,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_dip BOOLEAN NOT NULL DEFAULT true,
        entity TEXT NOT NULL DEFAULT 'ih35-transportation',
        color_tag TEXT,
        is_relay_account BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS banking_rules (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        match_field TEXT NOT NULL,
        match_operator TEXT NOT NULL DEFAULT 'contains',
        match_value TEXT NOT NULL,
        action_type TEXT NOT NULL,
        category TEXT,
        vendor_id TEXT,
        split_template_json JSONB,
        auto_apply BOOLEAN NOT NULL DEFAULT false,
        active BOOLEAN NOT NULL DEFAULT true,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS bank_txn_links (
        id BIGSERIAL PRIMARY KEY,
        txn_id BIGINT NOT NULL REFERENCES banking_transactions(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        amount NUMERIC(14,2),
        link_role TEXT DEFAULT 'primary',
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS driver_settlements (
        id BIGSERIAL PRIMARY KEY,
        driver_id TEXT NOT NULL,
        driver_name TEXT,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        gross_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
        gross_source TEXT NOT NULL DEFAULT 'manual',
        load_table_ref TEXT,
        fuel_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
        advance_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
        other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unpaid',
        paid_date DATE,
        bank_txn_id BIGINT REFERENCES banking_transactions(id) ON DELETE SET NULL,
        notes TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS driver_settlement_loads (
        id BIGSERIAL PRIMARY KEY,
        settlement_id BIGINT NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE,
        load_number TEXT NOT NULL,
        gross_component NUMERIC(14,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS factoring_advances (
        id BIGSERIAL PRIMARY KEY,
        factor_name TEXT NOT NULL,
        invoice_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        deposit_date DATE,
        bank_txn_id BIGINT REFERENCES banking_transactions(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS factoring_advance_loads (
        id BIGSERIAL PRIMARY KEY,
        factoring_advance_id BIGINT NOT NULL REFERENCES factoring_advances(id) ON DELETE CASCADE,
        load_number TEXT NOT NULL,
        invoice_number TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS bank_import_batches (
        id BIGSERIAL PRIMARY KEY,
        source_type TEXT NOT NULL,
        account_id TEXT,
        filename TEXT,
        rows_total INTEGER NOT NULL DEFAULT 0,
        rows_inserted INTEGER NOT NULL DEFAULT 0,
        rows_skipped INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'preview',
        parser_notes TEXT,
        uploaded_by TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS bank_reconciliation_sessions (
        id BIGSERIAL PRIMARY KEY,
        account_id TEXT NOT NULL,
        statement_month TEXT NOT NULL,
        statement_end_date DATE,
        statement_ending_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
        cleared_total NUMERIC(14,2) NOT NULL DEFAULT 0,
        difference NUMERIC(14,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        lock_reason_code TEXT,
        lock_reason_notes TEXT,
        locked_by TEXT,
        locked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (account_id, statement_month)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS bank_reconciliation_items (
        id BIGSERIAL PRIMARY KEY,
        reconciliation_session_id BIGINT NOT NULL REFERENCES bank_reconciliation_sessions(id) ON DELETE CASCADE,
        banking_txn_id BIGINT NOT NULL REFERENCES banking_transactions(id) ON DELETE CASCADE,
        cleared BOOLEAN NOT NULL DEFAULT false,
        cleared_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (reconciliation_session_id, banking_txn_id)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS report_cache (
        id BIGSERIAL PRIMARY KEY,
        report_key TEXT NOT NULL,
        params_hash TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'cache',
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (report_key, params_hash)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS period_locks (
        id BIGSERIAL PRIMARY KEY,
        module TEXT NOT NULL,
        period_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        locked_by TEXT,
        lock_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (module, period_key)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS qbo_post_queue (
        id BIGSERIAL PRIMARY KEY,
        txn_id BIGINT REFERENCES banking_transactions(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'queued',
        posted_at TIMESTAMPTZ,
        error_text TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    // Legacy production databases may have older table shapes; guarantee indexed columns exist first.
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_txn_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS account_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS account_name TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS txn_type TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS txn_date DATE NOT NULL DEFAULT CURRENT_DATE');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) NOT NULL DEFAULT 0');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS txn_direction TEXT DEFAULT 'debit'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS running_balance NUMERIC(14,2)');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS description TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS vendor_name TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS memo TEXT');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uncategorized'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS category TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS category_source TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS cleared BOOLEAN DEFAULT false');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS reconciled BOOLEAN DEFAULT false');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'qbo'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS source_ref TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS statement_id TEXT');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_status TEXT DEFAULT 'synced'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS created_by TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS updated_by TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS external_ref TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS import_batch_id BIGINT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS raw_payload_json JSONB');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS source_file TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS driver_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS unit_number TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS gallons NUMERIC(14,3)');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS relay_transaction_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS station_name TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS state TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_doc_number TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_category_name TEXT');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_sync_status TEXT DEFAULT 'synced'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_last_synced_at TIMESTAMPTZ');
    await dbQuery("ALTER TABLE qbo_post_queue ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'");
    await dbQuery('ALTER TABLE qbo_post_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_account_date ON banking_transactions(account_id, txn_date DESC)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_status ON banking_transactions(status)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_status_date ON banking_transactions(status, txn_date)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_account_status ON banking_transactions(account_id, status)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_source ON banking_transactions(source, txn_date DESC)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_rules_active_priority ON banking_rules(active, priority)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_driver_settlements_driver_period ON driver_settlements(driver_id, period_start)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_driver_settlements_status_period_end ON driver_settlements(status, period_end)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_bank_recon_sessions_account_month ON bank_reconciliation_sessions(account_id, statement_month)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_qbo_post_queue_status_created ON qbo_post_queue(status, created_at DESC)');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS external_ref TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS import_batch_id BIGINT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS raw_payload_json JSONB');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS source_file TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS driver_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS unit_number TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS gallons NUMERIC(14,3)');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS relay_transaction_id TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS station_name TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS state TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_doc_number TEXT');
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_category_name TEXT');
    await dbQuery("ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_sync_status TEXT DEFAULT 'synced'");
    await dbQuery('ALTER TABLE banking_transactions ADD COLUMN IF NOT EXISTS qbo_last_synced_at TIMESTAMPTZ');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS account_name TEXT');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS statement_month TEXT');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS source TEXT');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS parser_format TEXT');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS preview_json JSONB');
    await dbQuery('ALTER TABLE bank_import_batches ADD COLUMN IF NOT EXISTS totals_json JSONB');
    await dbQuery('ALTER TABLE banking_rules ADD COLUMN IF NOT EXISTS match_value_2 TEXT');
    await dbQuery('ALTER TABLE banking_rules ADD COLUMN IF NOT EXISTS vendor_name TEXT');
    await dbQuery('ALTER TABLE banking_rules ADD COLUMN IF NOT EXISTS qbo_account_id TEXT');
    await dbQuery('ALTER TABLE driver_settlements ADD COLUMN IF NOT EXISTS notes TEXT');
    await dbQuery('ALTER TABLE factoring_advances ADD COLUMN IF NOT EXISTS notes TEXT');
    await dbQuery('ALTER TABLE qbo_post_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0');
    await dbQuery('ALTER TABLE qbo_post_queue ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ');
    await dbQuery('ALTER TABLE qbo_post_queue ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_external_ref ON banking_transactions(external_ref)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_import_batch ON banking_transactions(import_batch_id)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_relay_ref ON banking_transactions(relay_transaction_id)');
    await dbQuery('CREATE UNIQUE INDEX IF NOT EXISTS uq_banking_transactions_qbo_account ON banking_transactions(qbo_txn_id, account_id) WHERE qbo_txn_id IS NOT NULL');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_transactions_qbo_sync_status ON banking_transactions(qbo_sync_status, txn_date DESC)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_bank_import_batches_uploaded_at ON bank_import_batches(uploaded_at DESC)');
    await dbQuery('CREATE INDEX IF NOT EXISTS idx_banking_rules_match ON banking_rules(match_field, match_operator, active)');
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

  async function cleanupWave8Caches() {
    if (!getPoolForRoute()) return { ok: true, report_cache_deleted: 0, bank_import_deleted: 0 };
    await ensureBankingTables();
    const { rowCount: reportDeleted = 0 } = await dbQueryForRoute(
      `DELETE FROM report_cache
        WHERE COALESCE(generated_at, created_at) < now() - interval '24 hours'`
    );
    const { rowCount: importDeleted = 0 } = await dbQueryForRoute(
      `DELETE FROM bank_import_batches
        WHERE status = 'preview'
          AND uploaded_at < now() - interval '7 days'`
    );
    return { ok: true, report_cache_deleted: Number(reportDeleted || 0), bank_import_deleted: Number(importDeleted || 0) };
  }

  function normalizeFuelTypeKey(v) {
    const key = String(v || '').trim().toLowerCase();
    if (!key) return '';
    return key;
  }

  function detectStateFromText(raw) {
    const txt = String(raw || '').trim().toUpperCase();
    if (!txt) return '';
    const map = [
      [' TEXAS ', 'TX'], [' TX ', 'TX'],
      [' OKLAHOMA ', 'OK'], [' OK ', 'OK'],
      [' NEW MEXICO ', 'NM'], [' NM ', 'NM'],
      [' ARKANSAS ', 'AR'], [' AR ', 'AR'],
      [' LOUISIANA ', 'LA'], [' LA ', 'LA'],
    ];
    const wrapped = ` ${txt.replace(/[^A-Z0-9 ]+/g, ' ')} `;
    for (const [needle, abbr] of map) {
      if (wrapped.includes(needle)) return abbr;
    }
    const short = wrapped.match(/\s([A-Z]{2})\s/);
    return short ? String(short[1] || '').trim() : '';
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

      const resp = await withTimeout(qbo.qboPost('purchase', payload), EXTERNAL_API_TIMEOUT_MS, 'QBO fuel purchase post');
      const txnId = String(resp?.Purchase?.Id || resp?.Purchase?.id || '').trim();
      if (!txnId) return { ok: false, reason: 'qbo_no_txn_id' };

      await dbQuery('UPDATE fuel_expenses SET qbo_posted = true, qbo_txn_id = $2 WHERE id = $1', [expenseRow.id, txnId]);
      return { ok: true, txnId };
    } catch (e) {
      return { ok: false, reason: e?.message || String(e) };
    }
  }

  async function registerRelayWebhookEvent(externalEventId, payload) {
    await ensureIntegrationResilienceTables();
    const id = String(externalEventId || '').trim();
    const hash = relayPayloadHash(payload);
    if (!id) return { ok: false, error: 'missing_event_id', duplicate: false, payloadHash: hash };
    try {
      await dbQuery(
        `INSERT INTO relay_webhook_events (external_event_id, payload_hash, status, received_at)
         VALUES ($1,$2,'accepted',now())`,
        [id, hash]
      );
      return { ok: true, duplicate: false, payloadHash: hash };
    } catch (e) {
      const msg = String(e?.message || e);
      if (/duplicate key/i.test(msg) || /unique constraint/i.test(msg)) {
        return { ok: true, duplicate: true, payloadHash: hash };
      }
      throw e;
    }
  }

  async function finalizeRelayWebhookEvent(externalEventId, status, processedCount = 0, errorMessage = null) {
    const id = String(externalEventId || '').trim();
    if (!id) return;
    await dbQuery(
      `UPDATE relay_webhook_events
          SET status = $2,
              processed_count = $3,
              error_message = $4,
              processed_at = now()
        WHERE external_event_id = $1`,
      [id, String(status || 'processed').trim() || 'processed', Number(processedCount || 0), errorMessage ? String(errorMessage).slice(0, 800) : null]
    );
  }

  app.get('/api/integrations/relay/settings', async (_req, res) => {
    try {
      if (!getPoolForRoute()) {
        return res.json({
          ok: true,
          settings: {
            enabled: false,
            auto_post_qbo: false,
            webhook_token_set: false,
            webhook_secret_set: false,
            endpoint: '/api/webhooks/relay',
          },
        });
      }
      await ensureIntegrationResilienceTables();
      const enabled = toBoolSetting(await getIntegrationSetting('relay_webhook_enabled'), false);
      const autoPost = toBoolSetting(await getIntegrationSetting('relay_auto_post_qbo'), false);
      const token = String(await getIntegrationSetting('relay_webhook_token') || '').trim();
      const secret = String(await getIntegrationSetting('relay_webhook_secret') || '').trim();
      const updatedAt = await getIntegrationSetting('relay_settings_updated_at');
      return res.json({
        ok: true,
        settings: {
          enabled,
          auto_post_qbo: autoPost,
          webhook_token_set: Boolean(token),
          webhook_secret_set: Boolean(secret),
          endpoint: '/api/webhooks/relay',
          updated_at: updatedAt || null,
        },
      });
    } catch (e) {
      logError('GET /api/integrations/relay/settings', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrations/relay/settings', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const enabled = Boolean(b.enabled);
      const autoPost = Boolean(b.auto_post_qbo);
      const token = String(b.webhook_token || '').trim();
      const secret = String(b.webhook_secret || '').trim();
      await setIntegrationSetting('relay_webhook_enabled', enabled ? '1' : '0');
      await setIntegrationSetting('relay_auto_post_qbo', autoPost ? '1' : '0');
      if (token) await setIntegrationSetting('relay_webhook_token', token);
      if (secret) await setIntegrationSetting('relay_webhook_secret', secret);
      await setIntegrationSetting('relay_settings_updated_at', new Date().toISOString());
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/integrations/relay/settings', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrations/relay/card-assignments', async (_req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, data: [] });
      await ensureIntegrationResilienceTables();
      const { rows } = await dbQueryForRoute(
        `SELECT id, card_last4, unit_number, driver_name, vendor_name, active, assigned_by, notes, created_at, updated_at
           FROM relay_card_assignments
          ORDER BY active DESC, card_last4 ASC`
      );
      return res.json({ ok: true, data: rows || [] });
    } catch (e) {
      logError('GET /api/integrations/relay/card-assignments', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), data: [] });
    }
  });

  app.post('/api/integrations/relay/card-assignments', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const cardLast4 = String(b.card_last4 || '').replace(/\D+/g, '').slice(-4);
      if (cardLast4.length !== 4) return res.status(400).json({ ok: false, error: 'card_last4 must be 4 digits' });
      const unit = String(b.unit_number || '').trim() || null;
      const driver = String(b.driver_name || '').trim() || null;
      const vendor = String(b.vendor_name || '').trim() || null;
      const active = b.active == null ? true : Boolean(b.active);
      const assignedBy = String(b.assigned_by || '').trim() || null;
      const notes = String(b.notes || '').trim() || null;
      await dbQueryForRoute(
        `INSERT INTO relay_card_assignments (card_last4, unit_number, driver_name, vendor_name, active, assigned_by, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (card_last4) WHERE active = true
         DO UPDATE SET
           unit_number = EXCLUDED.unit_number,
           driver_name = EXCLUDED.driver_name,
           vendor_name = EXCLUDED.vendor_name,
           active = EXCLUDED.active,
           assigned_by = EXCLUDED.assigned_by,
           notes = EXCLUDED.notes,
           updated_at = now()`,
        [cardLast4, unit, driver, vendor, active, assignedBy, notes]
      );
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/integrations/relay/card-assignments', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/integrations/relay/card-assignments/:cardLast4', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureIntegrationResilienceTables();
      const cardLast4 = String(req.params?.cardLast4 || '').replace(/\D+/g, '').slice(-4);
      if (cardLast4.length !== 4) return res.status(400).json({ ok: false, error: 'invalid cardLast4' });
      await dbQueryForRoute(
        `UPDATE relay_card_assignments
            SET active = false, updated_at = now()
          WHERE card_last4 = $1`,
        [cardLast4]
      );
      return res.json({ ok: true });
    } catch (e) {
      logError('DELETE /api/integrations/relay/card-assignments/:cardLast4', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/webhooks/relay', async (req, res) => {
    const timeoutMs = 10000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('relay webhook timeout')), timeoutMs)
    );
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, ignored: true, reason: 'db_not_configured' });
      await ensureIntegrationResilienceTables();
      await ensureFuelExpenseTables();
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const enabled = toBoolSetting(await getIntegrationSetting('relay_webhook_enabled'), false);
      if (!enabled) return res.json({ ok: true, ignored: true, reason: 'relay_webhook_disabled' });

      const token = String(await getIntegrationSetting('relay_webhook_token') || '').trim();
      const secret = String(await getIntegrationSetting('relay_webhook_secret') || '').trim();
      const hasAuthConfigured = Boolean(token || secret);
      if (!hasAuthConfigured) {
        return res.status(503).json({ ok: false, error: 'Relay webhook auth is not configured' });
      }

      const incomingToken = relayExtractToken(req);
      const incomingSig = relayExtractSignature(req);
      const tokenValid = token ? safeEqualText(token, incomingToken) : false;
      const sigValid = secret ? relaySignatureValid(secret, payload, incomingSig) : false;
      if (!tokenValid && !sigValid) {
        return res.status(401).json({ ok: false, error: 'Relay webhook authentication failed' });
      }

      const eventId = relayGetEventId(payload) || `payload_${relayPayloadHash(payload).slice(0, 20)}`;
      const registered = await registerRelayWebhookEvent(eventId, payload);
      if (registered.duplicate) return res.json({ ok: true, duplicate: true, event_id: eventId, processed_count: 0 });

      const process = async () => {
        const rows = relayToArray(payload);
        let processed = 0;
        const autoPost = toBoolSetting(await getIntegrationSetting('relay_auto_post_qbo'), false);
        for (const r of rows) {
          if (!r || typeof r !== 'object') continue;
          const relayTxnId = String(r.transaction_id || r.transactionId || r.id || '').trim() || null;
          if (relayTxnId) {
            const existing = await dbQueryForRoute(
              'SELECT id FROM fuel_expenses WHERE relay_txn_id = $1 LIMIT 1',
              [relayTxnId]
            );
            if (existing?.rows?.[0]?.id) continue;
          }
          const cardLast4 = String(r.card_last4 || r.cardLast4 || r.card || '').replace(/\D+/g, '').slice(-4) || null;
          let assignment = null;
          if (cardLast4) {
            const { rows: aRows } = await dbQueryForRoute(
              `SELECT card_last4, unit_number, driver_name, vendor_name
                 FROM relay_card_assignments
                WHERE card_last4 = $1 AND active = true
                LIMIT 1`,
              [cardLast4]
            );
            assignment = aRows?.[0] || null;
          }

          const unit = String(r.unit_number || r.unit || r.truck_number || assignment?.unit_number || '').trim() || null;
          const driver = String(r.driver_name || r.driver || assignment?.driver_name || '').trim() || null;
          const vendor = String(r.vendor_name || r.vendor || assignment?.vendor_name || '').trim() || null;
          const fuelType = normalizeFuelTypeKey(r.fuel_type || r.product_type || r.kind || 'diesel') || 'diesel';
          const gallons = r.gallons == null ? Number(r.volume ?? r.quantity ?? 0) : Number(r.gallons);
          const totalAmount = Number(r.total_amount ?? r.total_price ?? r.amount ?? 0);
          const pricePerGallon =
            Number.isFinite(gallons) && gallons > 0 && Number.isFinite(totalAmount)
              ? Number((totalAmount / gallons).toFixed(4))
              : null;
          const station = String(r.station_name || r.station || r.merchant || '').trim() || null;
          const location = String(r.location || r.city_state || r.address || '').trim() || null;
          const stateCode = String(r.state || '').trim().toUpperCase() || detectStateFromText(location || station || '');
          const loadNumber = String(r.load_number || r.load || '').trim() || null;
          const milesThisLoad = r.miles_this_load == null || r.miles_this_load === '' ? null : Number(r.miles_this_load);

          const { rows: inserted } = await dbQueryForRoute(
            `INSERT INTO fuel_expenses (
              unit_number, driver_name, fuel_type, gallons, price_per_gallon, total_amount,
              load_number, reefer_unit_number, settlement_load_id, station_name, location, receipt_photo,
              qbo_posted, state, miles_this_load, relay_event_id, relay_txn_id, relay_card_last4, relay_vendor, source, transaction_date
            ) VALUES (
              $1,$2,$3,$4,$5,$6,
              $7,$8,$9,$10,$11,$12,
              false,$13,$14,$15,$16,$17,$18,$19,$20
            )
            ON CONFLICT (relay_txn_id) WHERE relay_txn_id IS NOT NULL DO NOTHING
            RETURNING *`,
            [
              unit,
              driver,
              fuelType,
              Number.isFinite(gallons) ? gallons : null,
              Number.isFinite(pricePerGallon) ? pricePerGallon : null,
              Number.isFinite(totalAmount) ? totalAmount : null,
              loadNumber,
              null,
              loadNumber,
              station,
              location,
              null,
              stateCode || null,
              Number.isFinite(milesThisLoad) ? milesThisLoad : null,
              eventId,
              relayTxnId,
              cardLast4,
              vendor,
              'relay',
              String(r.txn_date || r.date || '').trim() || null,
            ]
          );
          const expense = inserted?.[0] || null;
          if (!expense) continue;
          processed += 1;

          if (autoPost) {
            const qboState = qboConnectionFlags();
            if (!qboState.connected) {
              await enqueueQboSyncQueue(
                'fuel',
                expense.id,
                { mode: 'fuel_expense_post', expense_id: expense.id, payload: { source: 'relay_webhook', relay_event_id: eventId } },
                'Relay auto-post deferred: QBO disconnected'
              ).catch(() => null);
            } else {
              const posted = await postFuelExpenseToQbo(expense);
              if (!posted?.ok) {
                await enqueueQboSyncQueue(
                  'fuel',
                  expense.id,
                  { mode: 'fuel_expense_post', expense_id: expense.id, payload: { source: 'relay_webhook', relay_event_id: eventId } },
                  posted?.reason || 'Relay auto-post to QBO failed'
                ).catch(() => null);
              }
            }
          }
        }
        return processed;
      };

      const processedCount = await Promise.race([process(), timeoutPromise]);
      await finalizeRelayWebhookEvent(eventId, 'processed', Number(processedCount || 0), null);
      return res.json({ ok: true, event_id: eventId, processed_count: Number(processedCount || 0) });
    } catch (e) {
      logError('POST /api/webhooks/relay', e);
      const eventId = relayGetEventId(req.body || {});
      if (eventId) {
        await finalizeRelayWebhookEvent(eventId, 'error', 0, e?.message || String(e)).catch(() => null);
      }
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

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
      const stateCode = String(b.state || '').trim().toUpperCase() || detectStateFromText(String(b.location || b.station || b.station_name || ''));
      const milesThisLoad = b.miles_this_load == null || b.miles_this_load === '' ? null : Number(b.miles_this_load);
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
          load_number, reefer_unit_number, settlement_load_id, station_name, location, receipt_photo, qbo_posted, state, miles_this_load, source, transaction_date
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,$15,$16)
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
          stateCode || null,
          Number.isFinite(milesThisLoad) ? milesThisLoad : null,
          'driver_app',
          String(b.txn_date || b.date || '').trim() || new Date().toISOString().slice(0, 10),
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
        state: r?.state || null,
        miles_this_load: r?.miles_this_load == null ? null : Number(r.miles_this_load),
        qbo_posted: r?.qbo_posted === true,
        qbo_txn_id: r?.qbo_txn_id || null,
        source: String(r?.source || (r?.relay_txn_id ? 'relay' : 'manual')).trim() || 'manual',
        transaction_date: r?.transaction_date || null,
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

  function toReportKebab(s) {
    return String(s || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  function normalizeAccountingMethod(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'cash') return 'Cash';
    if (s === 'accrual') return 'Accrual';
    return '';
  }

  function qboReportFlattenRows(report) {
    const rows = [];
    function walk(list, depth) {
      (Array.isArray(list) ? list : []).forEach((r) => {
        const rowType = String(r?.type || r?.RowType || '').trim();
        const header = r?.Header?.ColData?.[0]?.value ?? r?.Header?.ColData?.[0]?.Value ?? '';
        const summary = r?.Summary?.ColData?.[0]?.value ?? r?.Summary?.ColData?.[0]?.Value ?? '';
        const cols = Array.isArray(r?.ColData) ? r.ColData : [];
        const values = cols.map((c) => c?.value ?? c?.Value ?? '');
        const label = String(header || values?.[0] || summary || '').trim();
        if (label || values.length) {
          rows.push({
            rowType: rowType || 'Data',
            depth,
            label,
            values,
            amount: String(values?.[values.length - 1] || '').trim(),
          });
        }
        if (Array.isArray(r?.Rows?.Row)) walk(r.Rows.Row, depth + 1);
      });
    }
    walk(report?.Rows?.Row || [], 0);
    return rows;
  }

  function qboReportRowsToCsv(report) {
    const lines = qboReportFlattenRows(report);
    const maxCols = lines.reduce((m, r) => Math.max(m, r.values.length), 1);
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const header = ['row_type', 'depth', 'label'];
    for (let i = 0; i < maxCols; i += 1) header.push(`col_${i + 1}`);
    return [
      header.join(','),
      ...lines.map((r) => [esc(r.rowType), r.depth, esc(r.label), ...Array.from({ length: maxCols }, (_, i) => esc(r.values?.[i] || ''))].join(',')),
    ].join('\n');
  }

  function stableJsonStringify(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return JSON.stringify(obj == null ? {} : obj);
    }
    const out = {};
    Object.keys(obj).sort().forEach((k) => {
      out[k] = obj[k];
    });
    return JSON.stringify(out);
  }

  function reportParamsHash(params) {
    return createHash('sha256').update(stableJsonStringify(params || {})).digest('hex');
  }

  async function readReportCache(reportKey, paramsHash) {
    if (!getPool()) return null;
    await ensureBankingTables();
    const { rows } = await dbQuery(
      `SELECT payload_json, generated_at, expires_at
         FROM report_cache
        WHERE report_key = $1
          AND params_hash = $2
        ORDER BY generated_at DESC
        LIMIT 1`,
      [reportKey, paramsHash]
    );
    const row = rows?.[0] || null;
    if (!row) return null;
    const payload = row?.payload_json && typeof row.payload_json === 'object' ? row.payload_json : {};
    const generatedAt = String(row?.generated_at || payload?.generated_at || '').trim() || null;
    const expiresAt = String(row?.expires_at || '').trim() || null;
    const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    return {
      report: payload?.report || null,
      params: payload?.params && typeof payload.params === 'object' ? payload.params : {},
      generated_at: generatedAt,
      source: String(payload?.source || 'cache'),
      expires_at: expiresAt,
      fresh: Number.isFinite(expiresMs) ? Date.now() <= expiresMs : false,
    };
  }

  async function writeReportCache({ reportKey, paramsHash, source = 'live', params = {}, report = null, generatedAt = null }) {
    if (!getPool()) return;
    await ensureBankingTables();
    const generated = String(generatedAt || new Date().toISOString());
    await dbQuery(
      `INSERT INTO report_cache (report_key, params_hash, source, payload_json, generated_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, ($5::timestamptz + interval '1 hour'), now())
       ON CONFLICT (report_key, params_hash)
       DO UPDATE SET
         source = EXCLUDED.source,
         payload_json = EXCLUDED.payload_json,
         generated_at = EXCLUDED.generated_at,
         expires_at = EXCLUDED.expires_at`,
      [
        reportKey,
        paramsHash,
        source,
        JSON.stringify({
          report,
          params,
          source,
          generated_at: generated,
        }),
        generated,
      ]
    );
  }

  async function runQboReportMirror(req, res, reportName, paramBuilder) {
    const format = String(req.query?.format || 'json').trim().toLowerCase();
    const params = typeof paramBuilder === 'function' ? paramBuilder(req) : {};
    const cacheParams = Object.keys(params)
      .sort()
      .reduce((acc, k) => {
        acc[k] = params[k];
        return acc;
      }, {});
    const reportKey = String(reportName || '').trim();
    const paramsHash = reportParamsHash(cacheParams);

    let cached = null;
    try {
      cached = await readReportCache(reportKey, paramsHash);
    } catch (_e) {
      cached = null;
    }

    let source = cached?.fresh ? 'cache' : '';
    let reportPayload = cached?.report || null;
    let generatedAt = cached?.generated_at || null;

    if (!cached?.fresh) {
      try {
        const qbo = createQboApiClient();
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => {
          if (v == null || String(v).trim() === '') return;
          query.set(k, String(v));
        });
        const relPath = `reports/${reportName}${query.toString() ? `?${query.toString()}` : ''}`;
        const live = await withTimeout(qbo.qboGet(relPath), EXTERNAL_API_TIMEOUT_MS, `QBO report ${reportName}`);
        reportPayload = live;
        generatedAt = new Date().toISOString();
        source = 'live';
        await writeReportCache({
          reportKey,
          paramsHash,
          source: 'live',
          params: cacheParams,
          report: reportPayload,
          generatedAt,
        });
      } catch (e) {
        if (!cached?.report || !cached?.generated_at) {
          return res.json({
            ok: false,
            error: 'QBO unavailable',
            report: null,
            generated_at: null,
            generatedAt: null,
            source: 'unavailable',
            params: cacheParams,
          });
        }
        source = 'cache_unavailable';
        reportPayload = cached.report;
        generatedAt = cached.generated_at;
      }
    }

    if (format === 'csv') {
      const csv = qboReportRowsToCsv(reportPayload || {});
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(csv);
    }
    return res.json({
      ok: true,
      report: reportPayload,
      generated_at: generatedAt,
      generatedAt,
      source,
      params: cacheParams,
    });
  }

  const QBO_REPORT_MIRROR = [
    ['profit-loss', 'ProfitAndLoss', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      accounting_method: normalizeAccountingMethod(req.query?.accounting_method),
      summarize_column_by: String(req.query?.summarize_column_by || '').trim(),
    })],
    ['profit-loss-detail', 'ProfitAndLossDetail', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      accounting_method: normalizeAccountingMethod(req.query?.accounting_method),
      summarize_column_by: String(req.query?.summarize_column_by || '').trim(),
    })],
    ['balance-sheet', 'BalanceSheet', (req) => ({
      as_of_date: String(req.query?.as_of_date || '').trim(),
      accounting_method: normalizeAccountingMethod(req.query?.accounting_method),
    })],
    ['trial-balance', 'TrialBalance', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
    })],
    ['ar-aging', 'AgedReceivables', (req) => ({
      as_of_date: String(req.query?.as_of_date || '').trim(),
      aging_period: /^(30|60|90|120)$/.test(String(req.query?.aging_period || '').trim()) ? String(req.query?.aging_period).trim() : '',
    })],
    ['ap-aging', 'AgedPayables', (req) => ({
      as_of_date: String(req.query?.as_of_date || '').trim(),
      aging_period: /^(30|60|90|120)$/.test(String(req.query?.aging_period || '').trim()) ? String(req.query?.aging_period).trim() : '',
    })],
    ['cash-flow', 'CashFlow', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      accounting_method: normalizeAccountingMethod(req.query?.accounting_method),
    })],
    ['general-ledger', 'GeneralLedger', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      account: String(req.query?.account_id || '').trim(),
    })],
    ['transaction-list', 'TransactionList', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      transaction_type: String(req.query?.transaction_type || req.query?.type || '').trim(),
      vendor: String(req.query?.vendor_id || '').trim(),
    })],
    ['vendor-expenses', 'VendorExpenses', (req) => ({
      start_date: String(req.query?.start_date || '').trim(),
      end_date: String(req.query?.end_date || '').trim(),
      vendor: String(req.query?.vendor_id || '').trim(),
    })],
  ];
  QBO_REPORT_MIRROR.forEach(([slug, reportName, paramBuilder]) => {
    app.get(`/api/reports/qbo/${slug}`, async (req, res) => {
      return runQboReportMirror(req, res, String(reportName), paramBuilder);
    });
  });

  const BANKING_OCA_KEYWORDS = ['cash', 'checking', 'savings', 'prepay', 'escrow', 'reserves', 'factoring'];

  function bankingEligibleByType(name, accountType) {
    const nm = String(name || '').trim().toLowerCase();
    const type = String(accountType || '').trim().toLowerCase();
    if (type === 'bank' || type === 'credit card' || type === 'creditcard') return true;
    if (type === 'other current asset' || type === 'othercurrentasset') {
      return BANKING_OCA_KEYWORDS.some((k) => nm.includes(k));
    }
    return false;
  }

  function normalizeBakingTypeLabel(v) {
    const t = String(v || '').trim().toLowerCase();
    if (t === 'creditcard') return 'Credit Card';
    if (t === 'credit card') return 'Credit Card';
    if (t === 'othercurrentasset') return 'Other Current Asset';
    if (t === 'other current asset') return 'Other Current Asset';
    if (t === 'bank') return 'Bank';
    return String(v || '').trim() || 'Bank';
  }

  async function fetchBankingEligibleAccounts(month = '') {
    await ensureBankingTables();
    const qboRows = (await dbQuery(
      `SELECT qbo_id, name, full_data
         FROM qbo_catalog_cache
        WHERE entity_type = 'account'
        ORDER BY name ASC
        LIMIT 2000`
    ))?.rows || [];
    const prefsRows = (await dbQuery(
      `SELECT account_id, visible, display_order, is_dip, color_tag, is_relay_account
         FROM bank_account_preferences`
    ))?.rows || [];
    const prefById = new Map();
    prefsRows.forEach((r) => prefById.set(String(r?.account_id || '').trim(), r));

    const txMetaRows = (await dbQuery(
      `SELECT account_id,
              MAX(txn_date) AS last_txn_date,
              COUNT(*) FILTER (WHERE status = 'uncategorized') AS uncategorized_count
         FROM banking_transactions
        GROUP BY account_id`
    ))?.rows || [];
    const txMetaById = new Map();
    txMetaRows.forEach((r) => txMetaById.set(String(r?.account_id || '').trim(), r));

    const balRows = month
      ? ((await dbQuery(
          `SELECT account_id, opening_balance, receipts, disbursements, ending_balance
             FROM dip_bank_account_balances
            WHERE month_key = $1`,
          [month]
        ))?.rows || [])
      : [];
    const balById = new Map();
    balRows.forEach((r) => balById.set(String(r?.account_id || '').trim(), r));

    const out = [];
    for (const r of qboRows) {
      const accountId = String(r?.qbo_id || '').trim();
      if (!accountId) continue;
      const full = r?.full_data && typeof r.full_data === 'object' ? r.full_data : {};
      const name = String(r?.name || full?.Name || '').trim();
      const typeRaw = String(full?.AccountType || full?.accountType || '').trim();
      if (!bankingEligibleByType(name, typeRaw)) continue;
      const pref = prefById.get(accountId) || null;
      const txMeta = txMetaById.get(accountId) || null;
      const bal = balById.get(accountId) || null;
      const acctNum = String(full?.AcctNum || full?.acctNum || '').replace(/\D+/g, '');
      const displayType = normalizeBakingTypeLabel(typeRaw);
      const defaultVisible = String(displayType).toLowerCase() === 'bank';
      out.push({
        account_id: accountId,
        account_name: name || accountId,
        account_last4: acctNum ? acctNum.slice(-4) : '',
        account_type: displayType,
        visible: pref?.visible == null ? defaultVisible : Boolean(pref.visible),
        display_order: Number.isFinite(Number(pref?.display_order)) ? Number(pref.display_order) : 0,
        is_dip: pref?.is_dip == null ? true : Boolean(pref.is_dip),
        color_tag: String(pref?.color_tag || '').trim() || null,
        is_relay_account: pref?.is_relay_account == null ? false : Boolean(pref.is_relay_account),
        opening_balance: Number(bal?.opening_balance || 0),
        receipts: Number(bal?.receipts || 0),
        disbursements: Number(bal?.disbursements || 0),
        ending_balance: Number(bal?.ending_balance || 0),
        balance: Number(bal?.ending_balance || 0),
        last_transaction_date: txMeta?.last_txn_date || null,
        uncategorized_count: Number(txMeta?.uncategorized_count || 0),
      });
    }
    out.sort((a, b) => {
      const d = (Number(a.display_order || 0) - Number(b.display_order || 0));
      if (d !== 0) return d;
      return String(a.account_name || '').localeCompare(String(b.account_name || ''));
    });
    return out;
  }

  const BANKING_QBO_SYNC_STATE = {
    inProgress: false,
    startedAt: null,
    completedAt: null,
    lastSync: null,
    summary: null,
    error: null,
  };

  function qboSyncDateIso(value, fallback = '') {
    const s = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s || Date.now());
    if (!Number.isFinite(d.getTime())) return fallback;
    return d.toISOString().slice(0, 10);
  }

  function qboSyncDefaultRange(fullSync = false) {
    if (fullSync) return { from: '2025-01-01', to: '2026-12-31' };
    const end = new Date();
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - 30);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }

  function qboTxnDirectionFromAmount(amount) {
    return Number(amount || 0) >= 0 ? 'credit' : 'debit';
  }

  function parseQboTxnCategory(raw = {}) {
    const lines = Array.isArray(raw?.Line) ? raw.Line : [];
    for (const line of lines) {
      const acct = line?.AccountBasedExpenseLineDetail?.AccountRef
        || line?.JournalEntryLineDetail?.AccountRef
        || line?.DepositLineDetail?.AccountRef
        || line?.SalesItemLineDetail?.ItemRef
        || null;
      const name = String(acct?.name || acct?.Name || '').trim();
      if (name) return name;
    }
    return '';
  }

  function parseQboTxnVendor(raw = {}) {
    const cand = [
      raw?.EntityRef?.name,
      raw?.VendorRef?.name,
      raw?.CustomerRef?.name,
      raw?.PayeeRef?.name,
      raw?.MetaData?.CreateByRef?.name,
      raw?.PrivateNote,
    ];
    for (const c of cand) {
      const v = String(c || '').trim();
      if (v) return v;
    }
    return '';
  }

  function normalizeQboTransaction(raw = {}, account = {}) {
    const txnType = String(raw?.TxnType || raw?.type || raw?.DetailType || 'Transaction').trim() || 'Transaction';
    let amount = Number(raw?.TotalAmt || raw?.Amount || 0);
    if (!Number.isFinite(amount)) amount = parseMoneyLike(raw?.TotalAmt || raw?.Amount || 0);
    const typeLower = txnType.toLowerCase();
    const forceNegative = ['expense', 'purchase', 'check', 'billpayment', 'bill payment', 'transfer', 'journalentry'];
    if (amount > 0 && forceNegative.some((x) => typeLower.includes(x))) amount = -Math.abs(amount);
    if (amount === 0 && Number.isFinite(Number(raw?.Line?.[0]?.Amount))) amount = Number(raw.Line[0].Amount);
    const categoryName = parseQboTxnCategory(raw);
    const status = categoryName ? 'categorized' : 'uncategorized';
    const qboStatus = categoryName ? 'synced' : 'pending';
    const docNumber = String(raw?.DocNumber || raw?.PaymentRefNum || '').trim();
    const txnId = String(raw?.Id || raw?.TxnId || '').trim();
    const accountId = String(account?.Id || account?.id || '').trim();
    const accountName = String(account?.Name || account?.name || accountId).trim();
    const txnDate = qboSyncDateIso(raw?.TxnDate || raw?.MetaData?.CreateTime || Date.now(), new Date().toISOString().slice(0, 10));
    const description = String(raw?.PrivateNote || raw?.Description || raw?.Name || '').trim() || `${txnType} ${docNumber || txnId}`.trim();
    const memo = String(raw?.PrivateNote || raw?.Memo || '').trim();
    const vendorName = parseQboTxnVendor(raw);
    return {
      qbo_txn_id: txnId,
      account_id: accountId,
      account_name: accountName,
      txn_type: txnType,
      txn_date: txnDate,
      amount,
      txn_direction: qboTxnDirectionFromAmount(amount),
      description,
      vendor_name: vendorName || null,
      memo: memo || null,
      status,
      category: categoryName || null,
      qbo_doc_number: docNumber || null,
      qbo_status: qboStatus,
      qbo_sync_status: qboStatus,
      raw_payload_json: raw,
    };
  }

  function parseQboReportTransactions(reportRows = [], account = {}) {
    const out = [];
    (Array.isArray(reportRows) ? reportRows : []).forEach((row, idx) => {
      const vals = Array.isArray(row?.ColData) ? row.ColData : [];
      const dateVal = String(vals?.[0]?.value || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return;
      const desc = String(vals?.[1]?.value || vals?.[2]?.value || 'Transaction').trim();
      const amountRaw = vals.map((v) => v?.value).find((v) => /^-?\$?[\d,]+(\.\d{1,2})?$/.test(String(v || '').replace(/\s+/g, '')));
      const amount = parseMoneyLike(amountRaw || 0);
      if (!Number.isFinite(amount)) return;
      const category = String(vals?.[3]?.value || vals?.[4]?.value || '').trim();
      const memo = String(vals?.[5]?.value || '').trim();
      const txnType = String(vals?.[2]?.value || 'Transaction').trim();
      const txnId = String(vals?.[6]?.id || vals?.[6]?.value || '').trim() || `${account?.Id || account?.id || 'acct'}:report:${dateVal}:${idx}`;
      out.push({
        qbo_txn_id: txnId,
        account_id: String(account?.Id || account?.id || '').trim(),
        account_name: String(account?.Name || account?.name || '').trim() || String(account?.Id || '').trim(),
        txn_type: txnType || 'Transaction',
        txn_date: dateVal,
        amount,
        txn_direction: qboTxnDirectionFromAmount(amount),
        description: desc || `${txnType || 'Transaction'} ${txnId}`,
        vendor_name: null,
        memo: memo || null,
        status: category ? 'categorized' : 'uncategorized',
        category: category || null,
        qbo_doc_number: null,
        qbo_status: category ? 'synced' : 'pending',
        qbo_sync_status: category ? 'synced' : 'pending',
        raw_payload_json: row,
      });
    });
    return out;
  }

  async function fetchQboBankAndCardAccounts() {
    const qbo = createQboApiClient();
    const q = "SELECT * FROM Account WHERE AccountType IN ('Bank','Credit Card') AND Active = true MAXRESULTS 1000";
    const data = await withTimeout(qbo.qboQuery(q), EXTERNAL_API_TIMEOUT_MS, 'QBO bank account query');
    const rows = data?.QueryResponse?.Account || data?.Account || [];
    return Array.isArray(rows) ? rows : [];
  }

  async function fetchQboTransactionsForAccount(account = {}, from = '', to = '') {
    const qbo = createQboApiClient();
    const accountId = String(account?.Id || account?.id || '').trim();
    if (!accountId) return [];
    const collected = [];
    let start = 1;
    const max = 1000;
    for (;;) {
      const q = `SELECT * FROM Transaction WHERE AccountRef = '${accountId}' AND TxnDate >= '${from}' AND TxnDate <= '${to}' STARTPOSITION ${start} MAXRESULTS ${max}`;
      let data = null;
      try {
        data = await withTimeout(qbo.qboQuery(q), EXTERNAL_API_TIMEOUT_MS, `QBO txn query ${accountId}`);
      } catch (_e) {
        data = null;
      }
      const rows = data?.QueryResponse?.Transaction || data?.Transaction || [];
      const txns = Array.isArray(rows) ? rows : [];
      txns.forEach((raw) => {
        const norm = normalizeQboTransaction(raw, account);
        if (norm.qbo_txn_id && norm.account_id) collected.push(norm);
      });
      if (txns.length < max) break;
      start += max;
      if (start > 50000) break;
    }

    if (collected.length) return collected;

    try {
      const params = new URLSearchParams({ start_date: from, end_date: to, account_id: accountId, account: accountId });
      const report = await withTimeout(
        qbo.qboGet(`/reports/TransactionList?${params.toString()}`),
        EXTERNAL_API_TIMEOUT_MS,
        `QBO transaction list ${accountId}`
      );
      const rows = report?.Rows?.Row || [];
      return parseQboReportTransactions(rows, account);
    } catch (_e) {
      return [];
    }
  }

  async function upsertBankingTransactionFromQbo(txn = {}, actor = 'system:qbo-sync') {
    const sql = `INSERT INTO banking_transactions (
      qbo_txn_id, account_id, account_name, txn_type, txn_date, amount, txn_direction,
      description, vendor_name, memo, status, category, category_source, source, source_ref,
      qbo_status, qbo_sync_status, qbo_doc_number, qbo_category_name, qbo_last_synced_at,
      raw_payload_json, created_by, updated_by, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,'qbo','qbo',$13,
      $14,$15,$16,$17,now(),
      $18::jsonb,$19,$19,now()
    )
    ON CONFLICT (qbo_txn_id, account_id)
    DO UPDATE SET
      account_name = EXCLUDED.account_name,
      txn_type = EXCLUDED.txn_type,
      txn_date = EXCLUDED.txn_date,
      amount = EXCLUDED.amount,
      txn_direction = EXCLUDED.txn_direction,
      description = EXCLUDED.description,
      vendor_name = EXCLUDED.vendor_name,
      memo = EXCLUDED.memo,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      category_source = EXCLUDED.category_source,
      source = EXCLUDED.source,
      source_ref = EXCLUDED.source_ref,
      qbo_status = EXCLUDED.qbo_status,
      qbo_sync_status = EXCLUDED.qbo_sync_status,
      qbo_doc_number = EXCLUDED.qbo_doc_number,
      qbo_category_name = EXCLUDED.qbo_category_name,
      qbo_last_synced_at = now(),
      raw_payload_json = EXCLUDED.raw_payload_json,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING id, (xmax = 0) AS inserted`;
    const values = [
      String(txn?.qbo_txn_id || '').trim() || null,
      String(txn?.account_id || '').trim() || null,
      String(txn?.account_name || '').trim() || null,
      String(txn?.txn_type || '').trim() || 'Transaction',
      String(txn?.txn_date || '').trim() || new Date().toISOString().slice(0, 10),
      Number(txn?.amount || 0),
      String(txn?.txn_direction || qboTxnDirectionFromAmount(txn?.amount || 0)).trim() || 'debit',
      String(txn?.description || '').trim() || null,
      String(txn?.vendor_name || '').trim() || null,
      String(txn?.memo || '').trim() || null,
      String(txn?.status || 'uncategorized').trim(),
      String(txn?.category || '').trim() || null,
      String(txn?.qbo_txn_id || '').trim() || null,
      String(txn?.qbo_status || 'pending').trim(),
      String(txn?.qbo_sync_status || txn?.qbo_status || 'pending').trim(),
      String(txn?.qbo_doc_number || '').trim() || null,
      String(txn?.category || txn?.qbo_category_name || '').trim() || null,
      JSON.stringify(txn?.raw_payload_json || {}),
      actor,
    ];
    const { rows } = await dbQuery(sql, values);
    const row = rows?.[0] || null;
    return { id: row?.id || null, inserted: Boolean(row?.inserted) };
  }

  async function upsertBankPreferenceFromQboAccount(account = {}) {
    const id = String(account?.Id || account?.id || '').trim();
    if (!id) return;
    const name = String(account?.Name || account?.name || id).trim();
    const type = normalizeBakingTypeLabel(account?.AccountType || account?.accountType || 'Bank');
    await dbQuery(
      `INSERT INTO bank_account_preferences (account_id, account_name, account_type, visible, is_dip, updated_at)
       VALUES ($1,$2,$3,true,true,now())
       ON CONFLICT (account_id)
       DO UPDATE SET
         account_name = EXCLUDED.account_name,
         account_type = EXCLUDED.account_type,
         updated_at = now()`,
      [id, name, type]
    );
  }

  async function updateBalanceSnapshotFromQboAccount(account = {}, month = '') {
    const accountId = String(account?.Id || account?.id || '').trim();
    if (!accountId || !month) return;
    const balance = Number(account?.CurrentBalance || account?.currentBalance || 0);
    const opening = Number(account?.OpeningBalance || 0);
    const receipts = Math.max(0, balance - opening);
    const disbursements = Math.max(0, opening - balance);
    await dbQuery(
      `INSERT INTO dip_bank_account_balances (
        account_id, account_name, account_type, month_key,
        opening_balance, receipts, disbursements, ending_balance, source, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'qbo',now())
      ON CONFLICT (account_id, month_key)
      DO UPDATE SET
        account_name = EXCLUDED.account_name,
        account_type = EXCLUDED.account_type,
        opening_balance = EXCLUDED.opening_balance,
        receipts = EXCLUDED.receipts,
        disbursements = EXCLUDED.disbursements,
        ending_balance = EXCLUDED.ending_balance,
        source = 'qbo',
        updated_at = now()`,
      [
        accountId,
        String(account?.Name || accountId).trim(),
        normalizeBakingTypeLabel(account?.AccountType || account?.accountType || 'Bank'),
        month,
        opening,
        receipts,
        disbursements,
        balance,
      ]
    );
  }

  async function syncBankingTransactionsFromQbo({ accountIds = [], from = '', to = '', fullSync = false, actor = 'system:qbo-sync' } = {}) {
    await ensureBankingTables();
    const defaultRange = qboSyncDefaultRange(fullSync);
    const fromDate = qboSyncDateIso(from, defaultRange.from) || defaultRange.from;
    const toDate = qboSyncDateIso(to, defaultRange.to) || defaultRange.to;
    const targetMonth = String(toDate || '').slice(0, 7);

    const allAccounts = await fetchQboBankAndCardAccounts();
    const picked = new Set((Array.isArray(accountIds) ? accountIds : []).map((x) => String(x || '').trim()).filter(Boolean));
    const accounts = picked.size
      ? allAccounts.filter((a) => picked.has(String(a?.Id || a?.id || '').trim()))
      : allAccounts;

    const summary = {
      ok: true,
      from: fromDate,
      to: toDate,
      full_sync: Boolean(fullSync),
      accounts_synced: 0,
      transactions_imported: 0,
      transactions_updated: 0,
      already_categorized: 0,
      uncategorized: 0,
      total_transactions: 0,
    };

    for (const account of accounts) {
      await upsertBankPreferenceFromQboAccount(account);
      await updateBalanceSnapshotFromQboAccount(account, targetMonth);
      const txns = await fetchQboTransactionsForAccount(account, fromDate, toDate);
      summary.accounts_synced += 1;
      for (const txn of txns) {
        if (!txn?.qbo_txn_id || !txn?.account_id) continue;
        const up = await upsertBankingTransactionFromQbo(txn, actor);
        summary.total_transactions += 1;
        if (up.inserted) summary.transactions_imported += 1;
        else summary.transactions_updated += 1;
        if (String(txn?.status || '').toLowerCase() === 'categorized') summary.already_categorized += 1;
        else summary.uncategorized += 1;
      }
    }

    BANKING_QBO_SYNC_STATE.lastSync = new Date().toISOString();
    BANKING_QBO_SYNC_STATE.completedAt = BANKING_QBO_SYNC_STATE.lastSync;
    BANKING_QBO_SYNC_STATE.summary = summary;
    BANKING_QBO_SYNC_STATE.error = null;

    return summary;
  }

  const BANKING_ACTION_TYPES = new Set(['expense', 'bill_payment', 'transfer', 'settlement', 'factoring', 'apply_bill']);

  function toEntityTypeForBankingAction(action = '') {
    const key = String(action || '').trim().toLowerCase();
    if (key === 'expense') return 'expense';
    if (key === 'bill_payment') return 'bill_payment';
    if (key === 'transfer') return 'transfer';
    if (key === 'settlement') return 'driver_settlement';
    if (key === 'factoring') return 'factoring_advance';
    if (key === 'apply_bill') return 'bill';
    return 'transaction';
  }

  async function enqueueBankingQboPost({ txnId, entityType, entityId, payload, actor }) {
    const { rows } = await dbQuery(
      `INSERT INTO qbo_post_queue (txn_id, entity_type, entity_id, payload_json, status, created_by, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,'queued',$5,now())
       RETURNING id, txn_id, entity_type, entity_id, status, created_at`,
      [txnId, entityType, entityId || null, JSON.stringify(payload || {}), actor || null]
    );
    return rows?.[0] || null;
  }

  async function categorizeBankingTransaction(req, txnId, payload = {}, options = {}) {
    const actor = maintActor(req);
    const action = String(payload?.action || '').trim().toLowerCase();
    if (!BANKING_ACTION_TYPES.has(action)) {
      return { ok: false, status: 400, error: 'Unsupported action type' };
    }
    const { rows: txnRows } = await dbQuery(
      `SELECT *
         FROM banking_transactions
        WHERE id = $1
        LIMIT 1`,
      [txnId]
    );
    const txn = txnRows?.[0] || null;
    if (!txn) return { ok: false, status: 404, error: 'Transaction not found' };
    const lockCheck = await checkPeriodLockForAccountMonth(
      String(txn?.account_id || '').trim(),
      monthKeyFromDateLike(txn?.txn_date || '')
    );
    if (lockCheck?.locked) {
      return {
        ok: false,
        status: 409,
        error: `Period ${monthKeyFromDateLike(txn?.txn_date || '')} is locked for this account`,
      };
    }

    const before = txn;
    const targetId = String(payload?.target_id || '').trim() || `txn-${txnId}-${Date.now()}`;
    const entityType = toEntityTypeForBankingAction(action);
    const category = String(payload?.category || action).trim() || action;
    const amount = Number.isFinite(Number(payload?.amount)) ? Number(payload.amount) : Number(txn?.amount || 0);
    const qboPayload = {
      action,
      txn_id: txnId,
      account_id: txn?.account_id || null,
      account_name: txn?.account_name || null,
      amount,
      vendor_id: String(payload?.vendor_id || '').trim() || null,
      vendor_name: String(payload?.vendor_name || txn?.vendor_name || '').trim() || null,
      category,
      memo: String(payload?.memo || txn?.memo || '').trim() || null,
      target_id: String(payload?.target_id || '').trim() || null,
      qbo_account_id: String(payload?.qbo_account_id || '').trim() || null,
      qbo_class_id: String(payload?.qbo_class_id || '').trim() || null,
      split_index: Number.isFinite(Number(options?.splitIndex)) ? Number(options.splitIndex) : null,
    };

    const { rows: afterTxnRows } = await dbQuery(
      `UPDATE banking_transactions
          SET status = 'categorized',
              category = $2,
              category_source = 'manual',
              vendor_name = COALESCE($3, vendor_name),
              memo = COALESCE($4, memo),
              qbo_status = 'pending',
              qbo_sync_status = 'pending',
              updated_by = $5,
              updated_at = now()
        WHERE id = $1
      RETURNING *`,
      [txnId, category, qboPayload.vendor_name, qboPayload.memo, actor]
    );
    const updatedTxn = afterTxnRows?.[0] || txn;

    const { rows: linkRows } = await dbQuery(
      `INSERT INTO bank_txn_links (txn_id, entity_type, entity_id, amount, link_role, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, txn_id, entity_type, entity_id, amount, link_role, created_by, created_at`,
      [txnId, entityType, targetId, amount, String(options?.linkRole || 'primary').trim() || 'primary', actor]
    );
    const link = linkRows?.[0] || null;
    const qboQueued = await enqueueBankingQboPost({
      txnId,
      entityType,
      entityId: targetId,
      payload: qboPayload,
      actor,
    });

    await writeAuditLog(req, {
      action: options?.auditAction || 'categorize',
      entity_type: 'banking_transactions',
      entity_id: String(txnId),
      before_state: before,
      after_state: {
        transaction: updatedTxn,
        link,
        qbo_queued: qboQueued,
      },
      source_module: 'banking',
    });
    return { ok: true, transaction: updatedTxn, link, qbo_queued: qboQueued };
  }

  function monthKeyFromDateLike(v = '') {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
    const dt = new Date(s);
    if (!Number.isFinite(dt.getTime())) return '';
    return dt.toISOString().slice(0, 7);
  }

  async function checkPeriodLockForAccountMonth(accountId = '', monthKey = '') {
    if (!accountId || !monthKey) return { locked: false };
    const periodKey = `${String(monthKey).trim()}:${String(accountId).trim()}`;
    const { rows } = await dbQuery(
      `SELECT id, status, lock_reason, period_key
         FROM period_locks
        WHERE module = 'banking_reconciliation'
          AND period_key = $1
          AND status = 'locked'
        LIMIT 1`,
      [periodKey]
    );
    const row = rows?.[0] || null;
    if (!row) return { locked: false };
    return { locked: true, lock: row };
  }

  async function computeReconciliationTotals(sessionId) {
    const { rows } = await dbQuery(
      `SELECT
          COALESCE(SUM(CASE WHEN bri.cleared = true AND bt.amount > 0 THEN bt.amount ELSE 0 END), 0) AS cleared_deposits,
          COALESCE(SUM(CASE WHEN bri.cleared = true AND bt.amount < 0 THEN ABS(bt.amount) ELSE 0 END), 0) AS cleared_withdrawals,
          COALESCE(SUM(CASE WHEN bri.cleared = true THEN bt.amount ELSE 0 END), 0) AS cleared_total,
          COUNT(*) FILTER (WHERE bri.cleared = false)::int AS uncleared_count,
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE bri.cleared = true)::int AS cleared_count
        FROM bank_reconciliation_items bri
        JOIN banking_transactions bt ON bt.id = bri.banking_txn_id
       WHERE bri.reconciliation_session_id = $1`,
      [sessionId]
    );
    const row = rows?.[0] || {};
    const clearedDeposits = Number(row?.cleared_deposits || 0);
    const clearedWithdrawals = Number(row?.cleared_withdrawals || 0);
    const clearedTotal = Number(row?.cleared_total || 0);
    return {
      cleared_deposits: clearedDeposits,
      cleared_withdrawals: clearedWithdrawals,
      cleared_total: clearedTotal,
      uncleared_count: Number(row?.uncleared_count || 0),
      total_count: Number(row?.total_count || 0),
      cleared_count: Number(row?.cleared_count || 0),
    };
  }

  function csvEscape(v) {
    return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  }

  function generateSimplePdf(lines = []) {
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const safeLines = (Array.isArray(lines) ? lines : []).slice(0, 160).map((l) => esc(l));
    let y = 780;
    const contentRows = ['BT', '/F1 10 Tf'];
    safeLines.forEach((line) => {
      contentRows.push(`1 0 0 1 40 ${y} Tm (${line}) Tj`);
      y -= 14;
      if (y < 40) y = 780;
    });
    contentRows.push('ET');
    const stream = contentRows.join('\n');
    const objects = [];
    objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
    objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
    objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj');
    objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
    objects.push(`5 0 obj << /Length ${Buffer.byteLength(stream, 'utf8')} >> stream\n${stream}\nendstream endobj`);
    const header = '%PDF-1.4\n';
    let body = '';
    const offsets = [0];
    let cursor = Buffer.byteLength(header, 'utf8');
    for (const obj of objects) {
      offsets.push(cursor);
      body += `${obj}\n`;
      cursor += Buffer.byteLength(`${obj}\n`, 'utf8');
    }
    const xrefStart = cursor;
    let xref = `xref\n0 ${objects.length + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i += 1) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(header + body + xref + trailer, 'utf8');
  }

  function parseLoadNumbers(input) {
    if (Array.isArray(input)) {
      return input.map((v) => String(v || '').trim()).filter(Boolean);
    }
    return String(input || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  async function fetchRelayTransactionsFromApi() {
    const apiKey = String(process.env.RELAY_API_KEY || '').trim();
    const baseRaw = String(process.env.RELAY_API_BASE || '').trim() || 'https://api.relayfi.com';
    const base = baseRaw.replace(/\/+$/, '');
    if (!apiKey) {
      return { ok: false, connected: false, error: 'RELAY_API_KEY is not set', rows: [] };
    }
    const candidates = [
      '/v1/transactions',
      '/transactions',
      '/api/v1/transactions',
    ];
    let lastError = '';
    for (const path of candidates) {
      let timer = null;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
        const rsp = await fetch(`${base}${path}`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-API-Key': apiKey,
          },
        });
        if (timer) clearTimeout(timer);
        if (!rsp.ok) {
          lastError = `Relay response ${rsp.status} at ${path}`;
          continue;
        }
        const json = await rsp.json();
        const rows = Array.isArray(json?.transactions)
          ? json.transactions
          : Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json)
              ? json
              : [];
        return { ok: true, connected: true, rows, endpoint: path };
      } catch (e) {
        lastError = e?.name === 'AbortError' ? `Relay request timeout at ${path}` : (e?.message || String(e));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return { ok: false, connected: false, error: lastError || 'Relay API request failed', rows: [] };
  }

  function normalizeRelayTxn(raw = {}) {
    const id = String(raw?.id || raw?.transaction_id || raw?.transactionId || raw?.relay_transaction_id || '').trim();
    const date = parseDateLike(raw?.date || raw?.transaction_date || raw?.posted_at || raw?.created_at || '') || new Date().toISOString().slice(0, 10);
    const description = String(raw?.description || raw?.merchant || raw?.merchant_name || raw?.memo || '').trim();
    const gallons = Number(raw?.gallons || raw?.qty || raw?.quantity || 0);
    const amount = Number.isFinite(Number(raw?.amount)) ? Number(raw.amount) : parseMoneyLike(raw?.amount || raw?.total || raw?.total_amount || 0);
    const driverIntegrationId = String(raw?.driver_id || raw?.driver_integration_id || raw?.integration_id || '').trim();
    const driverName = String(raw?.driver_name || raw?.driver || '').trim();
    const unit = String(raw?.unit || raw?.unit_number || raw?.truck || '').trim();
    const station = String(raw?.station || raw?.station_name || raw?.merchant || '').trim();
    const state = String(raw?.state || raw?.region || '').trim();
    return {
      relay_transaction_id: id || null,
      txn_date: date,
      description,
      amount,
      gallons: Number.isFinite(gallons) ? gallons : 0,
      driver_integration_id: driverIntegrationId || null,
      driver_name: driverName || null,
      unit_number: unit || null,
      station_name: station || null,
      state: state || null,
      raw,
    };
  }

  app.get('/api/banking/accounts', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, accounts: [], data: [], count: 0 });
      const month = String(req.query?.month || '').trim() || new Date().toISOString().slice(0, 7);
      const all = await fetchBankingEligibleAccounts(month);
      const visible = all.filter((a) => a.visible === true);
      return res.json({ ok: true, accounts: visible, data: visible, count: visible.length });
    } catch (e) {
      logError('GET /api/banking/accounts', e);
      return res.json({ ok: true, accounts: [], data: [], count: 0 });
    }
  });

  app.get('/api/banking/accounts/all', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, accounts: [], count: 0 });
      const month = String(req.query?.month || '').trim() || new Date().toISOString().slice(0, 7);
      const all = await fetchBankingEligibleAccounts(month);
      return res.json({ ok: true, accounts: all, count: all.length });
    } catch (e) {
      logError('GET /api/banking/accounts/all', e);
      return res.json({ ok: true, accounts: [], count: 0 });
    }
  });

  app.post('/api/banking/sync-from-qbo', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      if (BANKING_QBO_SYNC_STATE.inProgress) {
        return res.status(409).json({ ok: false, error: 'Sync already in progress', sync_in_progress: true });
      }
      const accountIds = Array.isArray(req.body?.account_ids) ? req.body.account_ids : [];
      const fullSync = Boolean(req.body?.full_sync);
      const from = String(req.body?.from || '').trim();
      const to = String(req.body?.to || '').trim();
      BANKING_QBO_SYNC_STATE.inProgress = true;
      BANKING_QBO_SYNC_STATE.startedAt = new Date().toISOString();
      BANKING_QBO_SYNC_STATE.error = null;
      const summary = await syncBankingTransactionsFromQbo({
        accountIds,
        from,
        to,
        fullSync,
        actor: maintActor(req) || 'system:qbo-sync',
      });
      return res.json({ ok: true, ...summary, sync_in_progress: false, last_sync: BANKING_QBO_SYNC_STATE.lastSync });
    } catch (e) {
      BANKING_QBO_SYNC_STATE.error = e?.message || String(e);
      logError('POST /api/banking/sync-from-qbo', e);
      return res.status(500).json({ ok: false, error: BANKING_QBO_SYNC_STATE.error || 'QBO sync failed' });
    } finally {
      BANKING_QBO_SYNC_STATE.inProgress = false;
    }
  });

  app.get('/api/banking/sync-status', async (_req, res) => {
    try {
      if (!getPoolForRoute()) {
        return res.json({
          ok: true,
          last_sync: BANKING_QBO_SYNC_STATE.lastSync,
          accounts: 0,
          total_transactions: 0,
          uncategorized_count: 0,
          sync_in_progress: Boolean(BANKING_QBO_SYNC_STATE.inProgress),
        });
      }
      await ensureBankingTables();
      const [{ rows: totalsRows }, { rows: accountsRows }] = await Promise.all([
        dbQuery(`SELECT COUNT(*)::int AS total_transactions,
                        COUNT(*) FILTER (WHERE status = 'uncategorized')::int AS uncategorized_count
                   FROM banking_transactions`),
        dbQuery(`SELECT COUNT(DISTINCT account_id)::int AS accounts FROM banking_transactions`),
      ]);
      const totals = totalsRows?.[0] || {};
      const acc = accountsRows?.[0] || {};
      return res.json({
        ok: true,
        last_sync: BANKING_QBO_SYNC_STATE.lastSync,
        accounts: Number(acc?.accounts || 0),
        total_transactions: Number(totals?.total_transactions || 0),
        uncategorized_count: Number(totals?.uncategorized_count || 0),
        sync_in_progress: Boolean(BANKING_QBO_SYNC_STATE.inProgress),
        last_summary: BANKING_QBO_SYNC_STATE.summary || null,
        error: BANKING_QBO_SYNC_STATE.error || null,
      });
    } catch (e) {
      logError('GET /api/banking/sync-status', e);
      return res.status(500).json({ ok: false, error: e?.message || 'Unable to read sync status' });
    }
  });

  app.post('/api/banking/push-to-qbo', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const txnId = String(req.body?.txn_id || '').trim();
      if (!txnId) return res.status(400).json({ ok: false, error: 'txn_id is required' });
      const { rows } = await dbQuery('SELECT * FROM banking_transactions WHERE id = $1 LIMIT 1', [txnId]);
      const txn = rows?.[0] || null;
      if (!txn) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      if (String(txn?.status || '').toLowerCase() === 'uncategorized') {
        return res.status(400).json({ ok: false, error: 'Transaction must be categorized first' });
      }

      const category = String(txn?.category || '').trim().toLowerCase();
      let qboType = 'purchase';
      if (category.includes('bill payment') || category.includes('bill_payment')) qboType = 'billpayment';
      else if (category.includes('transfer')) qboType = 'transfer';
      else if (Number(txn?.amount || 0) > 0 || category.includes('deposit')) qboType = 'deposit';

      const qbo = createQboApiClient();
      const amountAbs = Math.abs(Number(txn?.amount || 0));
      const payload = {
        TxnDate: qboSyncDateIso(txn?.txn_date, new Date().toISOString().slice(0, 10)),
        PrivateNote: String(txn?.memo || txn?.description || '').trim() || undefined,
      };
      if (qboType === 'deposit') {
        payload.TotalAmt = amountAbs;
        payload.DepositToAccountRef = { value: String(txn?.account_id || '').trim() };
      } else if (qboType === 'transfer') {
        payload.Amount = amountAbs;
        payload.FromAccountRef = { value: String(txn?.account_id || '').trim() };
        payload.ToAccountRef = { value: String(req.body?.to_account_id || txn?.category || '').trim() };
      } else if (qboType === 'billpayment') {
        payload.TotalAmt = amountAbs;
        payload.PayType = 'Check';
        payload.CheckPayment = { BankAccountRef: { value: String(txn?.account_id || '').trim() } };
      } else {
        payload.TotalAmt = amountAbs;
        payload.AccountRef = { value: String(txn?.account_id || '').trim() };
      }

      const posted = await withTimeout(qbo.qboPost(qboType, payload), EXTERNAL_API_TIMEOUT_MS, `QBO ${qboType} post`);
      const newQboTxnId = String(
        posted?.Id
        || posted?.Purchase?.Id
        || posted?.BillPayment?.Id
        || posted?.Transfer?.Id
        || posted?.Deposit?.Id
        || txn?.qbo_txn_id
        || ''
      ).trim();

      await dbQuery(
        `UPDATE banking_transactions
            SET qbo_txn_id = COALESCE(NULLIF($2,''), qbo_txn_id),
                qbo_status = 'synced',
                qbo_sync_status = 'synced',
                qbo_sync_error = null,
                qbo_last_synced_at = now(),
                updated_by = $3,
                updated_at = now()
          WHERE id = $1`,
        [txnId, newQboTxnId, maintActor(req)]
      );

      return res.json({ ok: true, qbo_txn_id: newQboTxnId || null, qbo_txn_type: qboType });
    } catch (e) {
      const txnId = String(req.body?.txn_id || '').trim();
      if (txnId) {
        try {
          await dbQuery(
            `UPDATE banking_transactions
                SET qbo_status = 'error',
                    qbo_sync_status = 'error',
                    qbo_sync_error = $2,
                    updated_by = $3,
                    updated_at = now()
              WHERE id = $1`,
            [txnId, String(e?.message || e), maintActor(req)]
          );
        } catch (_err) {
          // no-op
        }
      }
      logError('POST /api/banking/push-to-qbo', e);
      return res.status(500).json({ ok: false, error: e?.message || 'Unable to push transaction to QuickBooks' });
    }
  });

  app.post('/api/banking/accounts/visibility', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const rows = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
      let saved = 0;
      for (const item of rows) {
        const accountId = String(item?.account_id || '').trim();
        if (!accountId) continue;
        await dbQuery(
          `INSERT INTO bank_account_preferences (
             account_id, account_name, visible, display_order, is_dip, color_tag, is_relay_account, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           ON CONFLICT (account_id)
           DO UPDATE SET
             account_name = COALESCE(EXCLUDED.account_name, bank_account_preferences.account_name),
             visible = EXCLUDED.visible,
             display_order = EXCLUDED.display_order,
             is_dip = EXCLUDED.is_dip,
             color_tag = EXCLUDED.color_tag,
             is_relay_account = EXCLUDED.is_relay_account,
             updated_at = now()`,
          [
            accountId,
            String(item?.account_name || '').trim() || null,
            Boolean(item?.visible),
            Number.isFinite(Number(item?.display_order)) ? Number(item.display_order) : 0,
            item?.is_dip == null ? true : Boolean(item.is_dip),
            String(item?.color_tag || '').trim() || null,
            Boolean(item?.is_relay_account),
          ]
        );
        saved += 1;
      }
      await writeAuditLog(req, {
        action: 'upsert_visibility',
        entity_type: 'bank_account_preferences',
        entity_id: null,
        before_state: null,
        after_state: { saved, rows },
        source_module: 'banking',
      });
      return res.json({ ok: true, saved });
    } catch (e) {
      logError('POST /api/banking/accounts/visibility', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/accounts/balances', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      await ensureBankingTables();
      const b = req.body || {};
      const accountId = String(b.account_id || '').trim();
      const month = String(b.month || '').trim();
      if (!accountId || !month) return res.status(400).json({ ok: false, error: 'account_id and month are required' });
      const opening = Number(b.opening_balance || 0);
      const receipts = Number(b.receipts || 0);
      const disb = Number(b.disbursements || 0);
      const ending = Number.isFinite(Number(b.ending_balance)) ? Number(b.ending_balance) : (opening + receipts - disb);
      const { rows: beforeRows } = await dbQuery(
        `SELECT account_id, month_key, opening_balance, receipts, disbursements, ending_balance
           FROM dip_bank_account_balances
          WHERE account_id = $1 AND month_key = $2
          LIMIT 1`,
        [accountId, month]
      );
      await dbQuery(
        `INSERT INTO dip_bank_account_balances (
          account_id, account_name, account_last4, account_type, month_key,
          opening_balance, receipts, disbursements, ending_balance, source, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
        ON CONFLICT (account_id, month_key)
        DO UPDATE SET
          account_name = EXCLUDED.account_name,
          account_last4 = EXCLUDED.account_last4,
          account_type = EXCLUDED.account_type,
          opening_balance = EXCLUDED.opening_balance,
          receipts = EXCLUDED.receipts,
          disbursements = EXCLUDED.disbursements,
          ending_balance = EXCLUDED.ending_balance,
          source = EXCLUDED.source,
          updated_at = now()`,
        [
          accountId,
          String(b.account_name || '').trim() || null,
          String(b.account_last4 || '').trim() || null,
          String(b.account_type || '').trim() || null,
          month,
          opening,
          receipts,
          disb,
          ending,
          String(b.source || 'manual').trim() || 'manual',
        ]
      );
      const { rows: afterRows } = await dbQuery(
        `SELECT account_id, month_key, opening_balance, receipts, disbursements, ending_balance
           FROM dip_bank_account_balances
          WHERE account_id = $1 AND month_key = $2
          LIMIT 1`,
        [accountId, month]
      );
      await writeAuditLog(req, {
        action: beforeRows?.[0] ? 'update' : 'insert',
        entity_type: 'dip_bank_account_balances',
        entity_id: `${accountId}:${month}`,
        before_state: beforeRows?.[0] || null,
        after_state: afterRows?.[0] || null,
        source_module: 'banking',
      });
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/banking/accounts/balances', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/accounts/:accountId/register', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, transactions: [], total: 0, page: 1, pages: 1, account: null });
      await ensureBankingTables();
      const accountId = String(req.params?.accountId || '').trim();
      const from = String(req.query?.from || '').trim();
      const to = String(req.query?.to || '').trim();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const type = String(req.query?.type || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      if (!accountId) return res.status(400).json({ ok: false, error: 'accountId is required' });
      const where = ['account_id = $1'];
      const values = [accountId];
      if (from) {
        values.push(from);
        where.push(`txn_date >= $${values.length}::date`);
      }
      if (to) {
        values.push(to);
        where.push(`txn_date <= $${values.length}::date`);
      }
      if (status && status !== 'all') {
        values.push(status);
        where.push(`LOWER(COALESCE(status, '')) = $${values.length}`);
      }
      if (type && type !== 'all') {
        if (type === 'deposits') where.push('amount > 0');
        else if (type === 'withdrawals') where.push('amount < 0');
        else if (type === 'categorized') where.push(`LOWER(COALESCE(status, '')) = 'categorized'`);
        else if (type === 'uncategorized') where.push(`LOWER(COALESCE(status, '')) = 'uncategorized'`);
        else if (type === 'excluded') where.push(`LOWER(COALESCE(status, '')) = 'excluded'`);
        else if (type === 'reconciled') where.push('COALESCE(reconciled, false) = true');
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalSql = `SELECT COUNT(*)::int AS total FROM banking_transactions ${whereSql}`;
      const { rows: totalRows } = await dbQuery(totalSql, values);
      const total = Number(totalRows?.[0]?.total || 0);
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.floor(offset / limit) + 1;
      const listValues = [...values, limit, offset];
      const sql = `
        SELECT id, qbo_txn_id, account_id, account_name, txn_type, txn_date, amount, running_balance,
               description, vendor_name, memo, cleared, reconciled, source, qbo_status, status, category, created_at, updated_at
          FROM banking_transactions
          ${whereSql}
         ORDER BY txn_date ASC, id ASC
         LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`;
      const { rows } = await dbQuery(sql, listValues);
      return res.json({
        ok: true,
        transactions: rows || [],
        total,
        page,
        pages,
        account: { account_id: accountId },
      });
    } catch (e) {
      logError('GET /api/banking/accounts/:accountId/register', e);
      return res.json({ ok: true, transactions: [], total: 0, page: 1, pages: 1, account: null });
    }
  });

  app.get('/api/banking/transactions/uncategorized', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, transactions: [], total: 0 });
      await ensureBankingTables();
      const accountId = String(req.query?.account_id || '').trim();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      const visibleRows = (await dbQuery(
        `SELECT account_id FROM bank_account_preferences WHERE visible = true`
      ))?.rows || [];
      const visibleIds = visibleRows.map((r) => String(r?.account_id || '').trim()).filter(Boolean);
      const where = [`LOWER(COALESCE(status, '')) = 'uncategorized'`];
      const values = [];
      const from = String(req.query?.from || '').trim();
      const to = String(req.query?.to || '').trim();
      if (accountId) {
        values.push(accountId);
        where.push(`account_id = $${values.length}`);
      } else if (visibleIds.length) {
        values.push(visibleIds);
        where.push(`account_id = ANY($${values.length}::text[])`);
      }
      if (from) {
        values.push(from);
        where.push(`txn_date >= $${values.length}::date`);
      }
      if (to) {
        values.push(to);
        where.push(`txn_date <= $${values.length}::date`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const { rows: totalRows } = await dbQuery(
        `SELECT COUNT(*)::int AS total FROM banking_transactions ${whereSql}`,
        values
      );
      const total = Number(totalRows?.[0]?.total || 0);
      const listValues = [...values, limit, offset];
      const rows = (await dbQuery(
        `SELECT id, qbo_txn_id, account_id, account_name, txn_type, txn_date, amount, running_balance,
                description, vendor_name, memo, cleared, reconciled, source, qbo_status, status, category, created_at, updated_at
           FROM banking_transactions
           ${whereSql}
          ORDER BY txn_date ASC, id ASC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      ))?.rows || [];
      return res.json({ ok: true, transactions: rows, total });
    } catch (e) {
      logError('GET /api/banking/transactions/uncategorized', e);
      return res.json({ ok: true, transactions: [], total: 0 });
    }
  });

  app.get('/api/banking/transactions', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, data: [] });
      await ensureBankingTables();
      const accountId = String(req.query?.account_id || '').trim();
      const from = String(req.query?.from || '').trim();
      const to = String(req.query?.to || '').trim();
      const where = [];
      const values = [];
      if (accountId) {
        values.push(accountId);
        where.push(`account_id = $${values.length}`);
      }
      if (from) {
        values.push(from);
        where.push(`txn_date >= $${values.length}::date`);
      }
      if (to) {
        values.push(to);
        where.push(`txn_date <= $${values.length}::date`);
      }
      const sql = `
        SELECT id, qbo_txn_id, account_id, account_name, txn_type, txn_date, amount, running_balance,
               description, vendor_name, memo, cleared, reconciled, source, qbo_status, status, category, created_at, updated_at
          FROM banking_transactions
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY txn_date DESC, id DESC
         LIMIT 2000`;
      const rows = (await dbQuery(sql, values))?.rows || [];
      return res.json({ ok: true, data: rows });
    } catch (e) {
      logError('GET /api/banking/transactions', e);
      return res.json({ ok: true, data: [] });
    }
  });

  app.post('/api/banking/transactions', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      await ensureBankingTables();
      const b = req.body || {};
      const accountId = String(b.account_id || '').trim();
      if (!accountId) return res.status(400).json({ ok: false, error: 'account_id is required' });
      const txnDate = String(b.txn_date || '').trim() || new Date().toISOString().slice(0, 10);
      const periodLock = await checkPeriodLockForAccountMonth(accountId, monthKeyFromDateLike(txnDate));
      if (periodLock?.locked) {
        return res.status(409).json({ ok: false, error: `Period ${monthKeyFromDateLike(txnDate)} is locked for this account` });
      }
      const amount = Number(b.amount || 0);
      const source = String(b.source || 'manual').trim() || 'manual';
      const qboStatus = 'queued';
      const out = await dbQuery(
        `INSERT INTO banking_transactions (
          qbo_txn_id, account_id, account_name, txn_type, txn_date, amount, running_balance,
          description, vendor_name, memo, cleared, reconciled, source, qbo_status, status, created_by, updated_by, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'uncategorized',$15,$15,now())
        RETURNING *`,
        [
          String(b.qbo_txn_id || '').trim() || null,
          accountId,
          String(b.account_name || '').trim() || null,
          String(b.txn_type || '').trim() || 'manual',
          txnDate,
          amount,
          Number.isFinite(Number(b.running_balance)) ? Number(b.running_balance) : null,
          String(b.description || '').trim() || null,
          String(b.vendor_name || '').trim() || null,
          String(b.memo || '').trim() || null,
          Boolean(b.cleared),
          Boolean(b.reconciled),
          source,
          qboStatus,
          maintActor(req),
        ]
      );
      const inserted = out?.rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'insert',
        entity_type: 'banking_transactions',
        entity_id: String(inserted?.id || '').trim() || null,
        before_state: null,
        after_state: inserted,
        source_module: 'banking',
      });
      return res.json({ ok: true, id: inserted?.id || null });
    } catch (e) {
      logError('POST /api/banking/transactions', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/transactions/:txnId/categorize', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const txnId = Number(req.params?.txnId || 0);
      if (!Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'Invalid transaction id' });
      const result = await categorizeBankingTransaction(req, txnId, req.body || {});
      if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error || 'Unable to categorize transaction' });
      return res.json({
        ok: true,
        transaction: result.transaction,
        link: result.link,
        qbo_queued: result.qbo_queued,
      });
    } catch (e) {
      logError('POST /api/banking/transactions/:txnId/categorize', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/transactions/bulk-categorize', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const ids = Array.isArray(req.body?.txn_ids) ? req.body.txn_ids : [];
      const action = String(req.body?.action || '').trim().toLowerCase();
      const shared = req.body?.shared_fields && typeof req.body.shared_fields === 'object' ? req.body.shared_fields : {};
      const processed = [];
      const failed = [];
      const qboQueued = [];
      for (const rawId of ids) {
        const txnId = Number(rawId);
        if (!Number.isFinite(txnId) || txnId <= 0) {
          failed.push({ txn_id: rawId, error: 'Invalid transaction id' });
          continue;
        }
        try {
          const payload = { ...(shared || {}), action };
          const result = await categorizeBankingTransaction(req, txnId, payload, { auditAction: 'bulk_categorize' });
          if (!result.ok) {
            failed.push({ txn_id: rawId, error: result.error || 'Unable to categorize transaction' });
            continue;
          }
          processed.push({ txn_id: txnId, link_id: result?.link?.id || null });
          if (result?.qbo_queued?.id) qboQueued.push(result.qbo_queued.id);
        } catch (innerError) {
          failed.push({ txn_id: rawId, error: innerError?.message || String(innerError) });
        }
      }
      await writeAuditLog(req, {
        action: 'bulk_categorize',
        entity_type: 'banking_transactions',
        entity_id: null,
        before_state: null,
        after_state: { txn_ids: ids, action, processed, failed },
        source_module: 'banking',
      });
      return res.json({ ok: true, processed, failed, qbo_queued: qboQueued });
    } catch (e) {
      logError('POST /api/banking/transactions/bulk-categorize', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/transactions/:txnId/split', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const txnId = Number(req.params?.txnId || 0);
      if (!Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'Invalid transaction id' });
      const splits = Array.isArray(req.body?.splits) ? req.body.splits : [];
      if (!splits.length) return res.status(400).json({ ok: false, error: 'splits are required' });
      const { rows: txnRows } = await dbQuery(
        `SELECT *
           FROM banking_transactions
          WHERE id = $1
          LIMIT 1`,
        [txnId]
      );
      const txn = txnRows?.[0] || null;
      if (!txn) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      const original = Number(txn?.amount || 0);
      const splitTotal = splits.reduce((sum, s) => sum + Number(s?.amount || 0), 0);
      const cents = (n) => Math.round(Number(n || 0) * 100);
      const matchDirect = cents(splitTotal) === cents(original);
      const matchAbs = cents(Math.abs(splitTotal)) === cents(Math.abs(original));
      if (!matchDirect && !matchAbs) {
        return res.status(400).json({
          ok: false,
          error: 'Split total must equal original transaction amount',
          original_amount: original,
          split_total: splitTotal,
        });
      }

      const before = txn;
      const outSplits = [];
      const qboQueued = [];
      for (let i = 0; i < splits.length; i += 1) {
        const s = splits[i] || {};
        const payload = {
          action: 'expense',
          amount: Number(s?.amount || 0),
          category: String(s?.category || 'split').trim(),
          vendor_name: String(s?.vendor_name || txn?.vendor_name || '').trim(),
          memo: String(s?.memo || txn?.memo || '').trim(),
          qbo_account_id: String(s?.qbo_account_id || '').trim(),
          qbo_class_id: null,
          target_id: `split-${txnId}-${i + 1}`,
        };
        const result = await categorizeBankingTransaction(req, txnId, payload, {
          auditAction: 'split_line',
          splitIndex: i + 1,
          linkRole: `split:${i + 1}`,
        });
        if (result.ok) {
          outSplits.push({
            index: i + 1,
            amount: Number(payload.amount || 0),
            category: payload.category,
            vendor_name: payload.vendor_name,
            memo: payload.memo,
            link_id: result?.link?.id || null,
          });
          if (result?.qbo_queued?.id) qboQueued.push(result.qbo_queued.id);
        }
      }

      await dbQuery(
        `UPDATE banking_transactions
            SET status = 'categorized',
                category = 'split',
                category_source = 'manual',
                updated_by = $2,
                updated_at = now()
          WHERE id = $1`,
        [txnId, maintActor(req)]
      );
      const { rows: updatedRows } = await dbQuery('SELECT * FROM banking_transactions WHERE id = $1 LIMIT 1', [txnId]);
      await writeAuditLog(req, {
        action: 'split',
        entity_type: 'banking_transactions',
        entity_id: String(txnId),
        before_state: before,
        after_state: { transaction: updatedRows?.[0] || null, splits: outSplits, qbo_queued: qboQueued },
        source_module: 'banking',
      });
      return res.json({ ok: true, splits: outSplits, qbo_queued: qboQueued });
    } catch (e) {
      logError('POST /api/banking/transactions/:txnId/split', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/transactions/:txnId/undo', async (req, res) => {
    try {
      if (!requireAdminRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const txnId = Number(req.params?.txnId || 0);
      if (!Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'Invalid transaction id' });
      const reason = String(req.body?.reason || req.query?.reason || 'Manual undo').trim();
      const { rows: beforeRows } = await dbQuery('SELECT * FROM banking_transactions WHERE id = $1 LIMIT 1', [txnId]);
      const before = beforeRows?.[0] || null;
      if (!before) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      const lockCheck = await checkPeriodLockForAccountMonth(
        String(before?.account_id || '').trim(),
        monthKeyFromDateLike(before?.txn_date || '')
      );
      if (lockCheck?.locked) {
        return res.status(409).json({ ok: false, error: `Period ${monthKeyFromDateLike(before?.txn_date || '')} is locked for this account` });
      }
      await dbQuery('DELETE FROM bank_txn_links WHERE txn_id = $1', [txnId]);
      await dbQuery(
        `DELETE FROM qbo_post_queue
          WHERE txn_id = $1
            AND LOWER(COALESCE(status, 'queued')) IN ('queued', 'draft', 'pending')`,
        [txnId]
      );
      const { rows: afterRows } = await dbQuery(
        `UPDATE banking_transactions
            SET status = 'uncategorized',
                category = NULL,
                category_source = NULL,
                updated_by = $2,
                updated_at = now()
          WHERE id = $1
      RETURNING *`,
        [txnId, maintActor(req)]
      );
      const transaction = afterRows?.[0] || null;
      await writeAuditLog(req, {
        action: 'undo_categorization',
        entity_type: 'banking_transactions',
        entity_id: String(txnId),
        before_state: before,
        after_state: { transaction, reason },
        source_module: 'banking',
      });
      return res.json({ ok: true, transaction });
    } catch (e) {
      logError('POST /api/banking/transactions/:txnId/undo', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/transactions/:txnId/suggestions', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, suggestions: [] });
      await ensureBankingTables();
      const txnId = Number(req.params?.txnId || 0);
      if (!Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'Invalid transaction id' });
      const { rows: currentRows } = await dbQuery(
        `SELECT id, amount, description, vendor_name, account_id
           FROM banking_transactions
          WHERE id = $1
          LIMIT 1`,
        [txnId]
      );
      const current = currentRows?.[0] || null;
      if (!current) return res.status(404).json({ ok: false, error: 'Transaction not found' });
      const suggestions = [];
      const pushSuggestion = (row, confidence, reason) => {
        suggestions.push({
          action: String(row?.action || row?.action_type || 'expense'),
          vendor_name: String(row?.vendor_name || '').trim() || null,
          category: String(row?.category || '').trim() || null,
          qbo_account_id: String(row?.qbo_account_id || '').trim() || null,
          confidence,
          reason,
        });
      };

      const { rows: ruleRows } = await dbQuery(
        `SELECT action_type, category, vendor_id, match_value
           FROM banking_rules
          WHERE active = true
            AND (
              $1 ILIKE '%' || match_value || '%'
              OR $2 ILIKE '%' || match_value || '%'
            )
          ORDER BY priority ASC, id ASC
          LIMIT 3`,
        [String(current?.description || ''), String(current?.vendor_name || '')]
      );
      ruleRows.forEach((r) => {
        pushSuggestion({
          action_type: r?.action_type || 'expense',
          vendor_name: current?.vendor_name || '',
          category: r?.category || '',
          qbo_account_id: r?.vendor_id || '',
        }, 1.0, `Rule match: ${String(r?.match_value || '').trim()}`);
      });

      const { rows: historicalRows } = await dbQuery(
        `SELECT status, amount, description, vendor_name, category, source_ref,
                source_ref AS qbo_account_id
           FROM banking_transactions
          WHERE id <> $1
            AND LOWER(COALESCE(status, '')) = 'categorized'
          ORDER BY updated_at DESC, id DESC
          LIMIT 300`,
        [txnId]
      );
      for (const row of historicalRows) {
        const rowVendor = String(row?.vendor_name || '').trim().toLowerCase();
        const curVendor = String(current?.vendor_name || '').trim().toLowerCase();
        const rowDesc = String(row?.description || '').trim().toLowerCase();
        const curDesc = String(current?.description || '').trim().toLowerCase();
        const sameVendor = rowVendor && curVendor && rowVendor === curVendor;
        const sameAmount = Number(row?.amount || 0) === Number(current?.amount || 0);
        if (sameVendor && sameAmount) pushSuggestion(row, 0.95, 'Same amount + vendor');
        else if (sameVendor) pushSuggestion(row, 0.9, 'Exact vendor match');
        else if (rowDesc && curDesc && (rowDesc.includes(curDesc.slice(0, 8)) || curDesc.includes(rowDesc.slice(0, 8)))) {
          pushSuggestion(row, 0.7, 'Similar description');
        }
        if (suggestions.length >= 12) break;
      }
      const unique = [];
      const seen = new Set();
      for (const s of suggestions) {
        const key = [s.action, s.vendor_name, s.category, s.qbo_account_id, s.reason].join('|').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(s);
      }
      unique.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
      return res.json({ ok: true, suggestions: unique.slice(0, 3) });
    } catch (e) {
      logError('GET /api/banking/transactions/:txnId/suggestions', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), suggestions: [] });
    }
  });

  app.post('/api/banking/transactions/:txnId/apply-rule', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const txnId = Number(req.params?.txnId || 0);
      const ruleId = Number(req.body?.rule_id || 0);
      if (!Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'Invalid transaction id' });
      if (!Number.isFinite(ruleId) || ruleId <= 0) return res.status(400).json({ ok: false, error: 'rule_id is required' });
      const { rows: ruleRows } = await dbQuery(
        `SELECT id, action_type, category, vendor_id, vendor_name, qbo_account_id
           FROM banking_rules
          WHERE id = $1
            AND active = true
          LIMIT 1`,
        [ruleId]
      );
      const rule = ruleRows?.[0] || null;
      if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
      const payload = {
        action: String(rule?.action_type || 'expense').trim().toLowerCase(),
        category: String(rule?.category || '').trim(),
        vendor_name: String(rule?.vendor_name || '').trim(),
        vendor_id: String(rule?.vendor_id || '').trim(),
        qbo_account_id: String(rule?.qbo_account_id || '').trim(),
        memo: `Applied banking rule #${ruleId}`,
      };
      const result = await categorizeBankingTransaction(req, txnId, payload, { auditAction: 'apply_rule' });
      if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error || 'Unable to apply rule' });
      return res.json({ ok: true, applied: { rule_id: ruleId }, transaction: result.transaction });
    } catch (e) {
      logError('POST /api/banking/transactions/:txnId/apply-rule', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/transactions/import', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();

      let uploadError = null;
      try {
        await runBankImportUpload(req, res);
      } catch (err) {
        uploadError = err;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const accountId = String(body.account_id || '').trim();
      const accountName = String(body.account_name || '').trim() || null;
      const statementMonth = String(body.statement_month || body.month || '').trim();
      const source = String(body.source || body.source_type || 'bank_import').trim() || 'bank_import';
      const actor = maintActor(req);
      if (!accountId) return res.status(400).json({ ok: false, error: 'account_id is required' });
      if (statementMonth) {
        const lockCheck = await checkPeriodLockForAccountMonth(accountId, statementMonth);
        if (lockCheck?.locked) {
          return res.status(409).json({ ok: false, error: `Period ${statementMonth} is locked for this account` });
        }
      }
      if (uploadError && !Array.isArray(body.rows)) {
        return res.status(400).json({ ok: false, error: uploadError?.message || 'Import upload failed' });
      }

      const file = req.file || null;
      const ext = String(file?.originalname || '').toLowerCase();
      let parserFormat = '';
      let parsedRows = [];
      if (file && (ext.endsWith('.csv') || String(file?.mimetype || '').includes('csv'))) {
        parserFormat = 'csv';
        parsedRows = parseCsvBankTransactions(file.buffer, statementMonth);
      } else if (file && (ext.endsWith('.pdf') || String(file?.mimetype || '').includes('pdf'))) {
        parserFormat = 'pdf';
        const parsed = await extractPdfText(file.buffer);
        parsedRows = parsePdfBankTransactions(parsed?.text || '', statementMonth);
      } else if (Array.isArray(body.rows)) {
        parserFormat = 'json';
        parsedRows = body.rows.map((r) => ({
          txn_date: parseDateLike(r?.txn_date || r?.date || ''),
          description: String(r?.description || r?.memo || '').trim(),
          amount: Number(r?.amount || 0),
          running_balance: Number.isFinite(Number(r?.running_balance)) ? Number(r.running_balance) : null,
          external_ref: String(r?.external_ref || r?.id || '').trim() || null,
        })).filter((r) => r.txn_date && r.description);
      } else {
        return res.status(400).json({ ok: false, error: 'file upload (PDF/CSV) or rows[] is required' });
      }

      const preview = parsedRows.slice(0, 10);
      const totalDeposits = parsedRows.reduce((sum, r) => sum + (Number(r?.amount || 0) > 0 ? Number(r.amount) : 0), 0);
      const totalWithdrawals = parsedRows.reduce((sum, r) => sum + (Number(r?.amount || 0) < 0 ? Math.abs(Number(r.amount)) : 0), 0);
      const { rows: batchRows } = await dbQuery(
        `INSERT INTO bank_import_batches (
          source_type, source, account_id, account_name, filename, statement_month,
          rows_total, rows_inserted, rows_skipped, status, parser_format, preview_json, totals_json, parser_notes, uploaded_by, uploaded_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,'processing',$8,$9::jsonb,$10::jsonb,$11,$12,now())
        RETURNING id, uploaded_at`,
        [
          source,
          source,
          accountId,
          accountName,
          String(file?.originalname || body.filename || '').trim() || null,
          statementMonth || null,
          parsedRows.length,
          parserFormat || 'generic',
          JSON.stringify(preview),
          JSON.stringify({ deposits: totalDeposits, withdrawals: totalWithdrawals }),
          file ? `Uploaded ${parserFormat.toUpperCase()} file` : 'JSON rows import',
          actor,
        ]
      );
      const batchId = Number(batchRows?.[0]?.id || 0);

      let inserted = 0;
      let skipped = 0;
      const dedupeChecks = [];
      for (const row of parsedRows) {
        const txnDate = parseDateLike(row?.txn_date || '');
        const description = String(row?.description || '').trim();
        const amount = Number(row?.amount || 0);
        const externalRef = String(row?.external_ref || '').trim() || null;
        if (!txnDate || !description || !Number.isFinite(amount)) {
          skipped += 1;
          continue;
        }
        const idem = buildTxnIdempotency(accountId, txnDate, amount, description, externalRef || '');
        dedupeChecks.push(idem);
        const { rows: dupRows } = await dbQuery(
          `SELECT id
             FROM banking_transactions
            WHERE (external_ref IS NOT NULL AND external_ref = $1)
               OR (account_id = $2 AND txn_date = $3::date AND amount = $4 AND LOWER(COALESCE(description, '')) = LOWER($5))
               OR (idempotency_key = $6)
            LIMIT 1`,
          [externalRef, accountId, txnDate, amount, description, idem]
        );
        if (dupRows?.length) {
          skipped += 1;
          continue;
        }
        await dbQuery(
          `INSERT INTO banking_transactions (
            idempotency_key, account_id, account_name, txn_type, txn_date, amount, running_balance,
            description, vendor_name, memo, status, category, category_source, source, source_ref, external_ref,
            statement_id, import_batch_id, source_file, raw_payload_json, qbo_status, created_by, updated_by, updated_at
          ) VALUES (
            $1,$2,$3,'import',$4,$5,$6,$7,$8,$9,'uncategorized',NULL,NULL,'bank_import',$10,$11,$12,$13,$14,$15::jsonb,'queued',$16,$16,now()
          )`,
          [
            idem,
            accountId,
            accountName,
            txnDate,
            amount,
            Number.isFinite(Number(row?.running_balance)) ? Number(row.running_balance) : null,
            description,
            null,
            description,
            statementMonth || null,
            externalRef,
            statementMonth || null,
            batchId || null,
            String(file?.originalname || body.filename || '').trim() || null,
            JSON.stringify(row || {}),
            actor,
          ]
        );
        inserted += 1;
      }

      await dbQuery(
        `UPDATE bank_import_batches
            SET rows_inserted = $2,
                rows_skipped = $3,
                status = 'completed',
                parser_notes = $4
          WHERE id = $1`,
        [batchId, inserted, skipped, `Processed ${parsedRows.length} rows (${inserted} inserted, ${skipped} skipped)`]
      );

      if (inserted > 0) {
        const { rows: autoRules } = await dbQuery(
          `SELECT id
             FROM banking_rules
            WHERE active = true
              AND auto_apply = true
            ORDER BY priority ASC, id ASC`
        );
        for (const rr of autoRules || []) {
          const ruleId = Number(rr?.id || 0);
          if (!ruleId) continue;
          const { rows: ruleRows } = await dbQuery(
            `SELECT id, match_field, match_operator, match_value, match_value_2,
                    action_type, category, vendor_id, vendor_name, qbo_account_id
               FROM banking_rules
              WHERE id = $1
                AND active = true
              LIMIT 1`,
            [ruleId]
          );
          const rule = ruleRows?.[0] || null;
          if (!rule) continue;
          const { rows: targetRows } = await dbQuery(
            `SELECT id, amount, description, vendor_name
               FROM banking_transactions
              WHERE import_batch_id = $1
                AND LOWER(COALESCE(status, '')) = 'uncategorized'`,
            [batchId]
          );
          for (const txn of targetRows || []) {
            const amount = Number(txn?.amount || 0);
            const textDescription = String(txn?.description || '').toLowerCase();
            const textVendor = String(txn?.vendor_name || '').toLowerCase();
            const matchValue = String(rule?.match_value || '').toLowerCase();
            const matchValue2 = String(rule?.match_value_2 || '').toLowerCase();
            let matched = false;
            const field = String(rule?.match_field || 'description').toLowerCase();
            const op = String(rule?.match_operator || 'contains').toLowerCase();
            const sourceText = field === 'vendor_name' ? textVendor : textDescription;
            if (field === 'amount') {
              if (op === 'equals') matched = amount === Number(matchValue);
            } else if (field === 'amount_range') {
              matched = amount >= Number(matchValue || 0) && amount <= Number(matchValue2 || 0);
            } else if (op === 'equals') {
              matched = sourceText === matchValue;
            } else if (op === 'starts_with') {
              matched = sourceText.startsWith(matchValue);
            } else {
              matched = sourceText.includes(matchValue);
            }
            if (!matched) continue;
            await categorizeBankingTransaction(req, Number(txn.id), {
              action: String(rule?.action_type || 'expense').trim().toLowerCase(),
              vendor_id: String(rule?.vendor_id || '').trim(),
              vendor_name: String(rule?.vendor_name || txn?.vendor_name || '').trim(),
              category: String(rule?.category || '').trim(),
              memo: `Auto-applied rule #${ruleId} on import batch #${batchId}`,
              amount: Number(txn?.amount || 0),
              qbo_account_id: String(rule?.qbo_account_id || '').trim(),
            }, { auditAction: 'auto_apply_rule' });
          }
        }
      }

      await writeAuditLog(req, {
        action: 'import_transactions',
        entity_type: 'bank_import_batches',
        entity_id: String(batchId || ''),
        before_state: null,
        after_state: {
          account_id: accountId,
          statement_month: statementMonth || null,
          parser_format: parserFormat,
          rows_total: parsedRows.length,
          inserted,
          skipped,
        },
        source_module: 'banking',
      });

      return res.json({
        ok: true,
        batch_id: batchId,
        inserted,
        skipped,
        preview,
        totals: { deposits: totalDeposits, withdrawals: totalWithdrawals },
      });
    } catch (e) {
      logError('POST /api/banking/transactions/import', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/import/batches', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, batches: [], total: 0 });
      await ensureBankingTables();
      const accountId = String(req.query?.account_id || '').trim();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      const where = [];
      const values = [];
      if (accountId) {
        values.push(accountId);
        where.push(`account_id = $${values.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: countRows } = await dbQuery(
        `SELECT COUNT(*)::int AS total
           FROM bank_import_batches
           ${whereSql}`,
        values
      );
      const total = Number(countRows?.[0]?.total || 0);
      const listValues = [...values, limit, offset];
      const { rows } = await dbQuery(
        `SELECT id, uploaded_at, account_id, account_name, filename, statement_month, rows_total, rows_inserted, rows_skipped, status, parser_format, totals_json
           FROM bank_import_batches
           ${whereSql}
          ORDER BY uploaded_at DESC, id DESC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      );
      return res.json({ ok: true, batches: rows || [], total });
    } catch (e) {
      logError('GET /api/banking/import/batches', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), batches: [], total: 0 });
    }
  });

  app.get('/api/banking/import/batches/:id', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid batch id' });
      const { rows: batchRows } = await dbQuery(
        `SELECT *
           FROM bank_import_batches
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      const batch = batchRows?.[0] || null;
      if (!batch) return res.status(404).json({ ok: false, error: 'Batch not found' });
      const { rows } = await dbQuery(
        `SELECT id, txn_date, description, amount, running_balance, status, category, source
           FROM banking_transactions
          WHERE import_batch_id = $1
          ORDER BY txn_date ASC, id ASC
          LIMIT 20`,
        [id]
      );
      return res.json({ ok: true, batch, rows: rows || [] });
    } catch (e) {
      logError('GET /api/banking/import/batches/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/banking/import/batches/:id', async (req, res) => {
    try {
      if (!requireAdminRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid batch id' });
      const { rows: rowsCheck } = await dbQuery(
        `SELECT id, status
           FROM banking_transactions
          WHERE import_batch_id = $1`,
        [id]
      );
      if (!rowsCheck.length) {
        await dbQuery('DELETE FROM bank_import_batches WHERE id = $1', [id]);
        return res.json({ ok: true, deleted: 0, skipped_categorized: 0 });
      }
      const categorized = rowsCheck.filter((r) => String(r?.status || '').toLowerCase() !== 'uncategorized');
      if (categorized.length) {
        return res.status(409).json({ ok: false, error: 'Cannot delete batch with categorized rows', deleted: 0, skipped_categorized: categorized.length });
      }
      await dbQuery('DELETE FROM qbo_post_queue WHERE txn_id IN (SELECT id FROM banking_transactions WHERE import_batch_id = $1)', [id]);
      const { rowCount } = await dbQuery('DELETE FROM banking_transactions WHERE import_batch_id = $1', [id]);
      await dbQuery('DELETE FROM bank_import_batches WHERE id = $1', [id]);
      await writeAuditLog(req, {
        action: 'delete_import_batch',
        entity_type: 'bank_import_batches',
        entity_id: String(id),
        before_state: { rows: rowsCheck.length },
        after_state: { deleted: rowCount || 0, skipped_categorized: categorized.length },
        source_module: 'banking',
      });
      return res.json({ ok: true, deleted: Number(rowCount || 0), skipped_categorized: categorized.length });
    } catch (e) {
      logError('DELETE /api/banking/import/batches/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/rules', async (_req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, rules: [], count: 0 });
      await ensureBankingTables();
      const { rows } = await dbQuery(
        `SELECT id, name, priority, match_field, match_operator, match_value, match_value_2,
                action_type, category, vendor_id, vendor_name, qbo_account_id, auto_apply, active, created_by, created_at, updated_at
           FROM banking_rules
          WHERE active = true
          ORDER BY priority ASC, id ASC`
      );
      return res.json({ ok: true, rules: rows || [], count: Number(rows?.length || 0) });
    } catch (e) {
      logError('GET /api/banking/rules', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rules: [], count: 0 });
    }
  });

  app.post('/api/banking/rules', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
      const priority = Math.max(1, Math.min(1000, Number(b.priority) || 100));
      const { rows } = await dbQuery(
        `INSERT INTO banking_rules (
          name, priority, match_field, match_operator, match_value, match_value_2,
          action_type, category, vendor_id, vendor_name, qbo_account_id, auto_apply, active, created_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,now(),now())
        RETURNING *`,
        [
          name,
          priority,
          String(b.match_field || 'description').trim(),
          String(b.match_operator || 'contains').trim(),
          String(b.match_value || '').trim(),
          String(b.match_value_2 || '').trim() || null,
          String(b.action_type || 'expense').trim(),
          String(b.category || '').trim() || null,
          String(b.vendor_id || '').trim() || null,
          String(b.vendor_name || '').trim() || null,
          String(b.qbo_account_id || '').trim() || null,
          Boolean(b.auto_apply),
          maintActor(req),
        ]
      );
      const rule = rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'create_rule',
        entity_type: 'banking_rules',
        entity_id: String(rule?.id || ''),
        before_state: null,
        after_state: rule,
        source_module: 'banking',
      });
      return res.json({ ok: true, rule });
    } catch (e) {
      logError('POST /api/banking/rules', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.put('/api/banking/rules/:id', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid rule id' });
      const { rows: beforeRows } = await dbQuery('SELECT * FROM banking_rules WHERE id = $1 LIMIT 1', [id]);
      const before = beforeRows?.[0] || null;
      if (!before) return res.status(404).json({ ok: false, error: 'Rule not found' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const { rows } = await dbQuery(
        `UPDATE banking_rules
            SET name = COALESCE($2, name),
                priority = COALESCE($3, priority),
                match_field = COALESCE($4, match_field),
                match_operator = COALESCE($5, match_operator),
                match_value = COALESCE($6, match_value),
                match_value_2 = COALESCE($7, match_value_2),
                action_type = COALESCE($8, action_type),
                category = COALESCE($9, category),
                vendor_id = COALESCE($10, vendor_id),
                vendor_name = COALESCE($11, vendor_name),
                qbo_account_id = COALESCE($12, qbo_account_id),
                auto_apply = COALESCE($13, auto_apply),
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [
          id,
          b.name == null ? null : String(b.name || '').trim(),
          b.priority == null ? null : Math.max(1, Math.min(1000, Number(b.priority) || 100)),
          b.match_field == null ? null : String(b.match_field || '').trim(),
          b.match_operator == null ? null : String(b.match_operator || '').trim(),
          b.match_value == null ? null : String(b.match_value || '').trim(),
          b.match_value_2 == null ? null : String(b.match_value_2 || '').trim(),
          b.action_type == null ? null : String(b.action_type || '').trim(),
          b.category == null ? null : String(b.category || '').trim(),
          b.vendor_id == null ? null : String(b.vendor_id || '').trim(),
          b.vendor_name == null ? null : String(b.vendor_name || '').trim(),
          b.qbo_account_id == null ? null : String(b.qbo_account_id || '').trim(),
          b.auto_apply == null ? null : Boolean(b.auto_apply),
        ]
      );
      const rule = rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'update_rule',
        entity_type: 'banking_rules',
        entity_id: String(id),
        before_state: before,
        after_state: rule,
        source_module: 'banking',
      });
      return res.json({ ok: true, rule });
    } catch (e) {
      logError('PUT /api/banking/rules/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.delete('/api/banking/rules/:id', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid rule id' });
      await dbQuery('UPDATE banking_rules SET active = false, updated_at = now() WHERE id = $1', [id]);
      await writeAuditLog(req, {
        action: 'deactivate_rule',
        entity_type: 'banking_rules',
        entity_id: String(id),
        before_state: null,
        after_state: { active: false },
        source_module: 'banking',
      });
      return res.json({ ok: true });
    } catch (e) {
      logError('DELETE /api/banking/rules/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/rules/:id/test', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid rule id' });
      const { rows: ruleRows } = await dbQuery(
        `SELECT id, match_field, match_operator, match_value, match_value_2
           FROM banking_rules
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      const rule = ruleRows?.[0] || null;
      if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
      const sampleDescription = String(req.body?.sample_description || '').trim().toLowerCase();
      const sampleAmount = Number(req.body?.sample_amount || 0);
      const { rows } = await dbQuery(
        `SELECT id, account_id, txn_date, amount, description, vendor_name
           FROM banking_transactions
          WHERE LOWER(COALESCE(status, '')) = 'uncategorized'
          ORDER BY txn_date ASC, id ASC
          LIMIT 2000`
      );
      const matches = (rows || []).filter((r) => {
        const field = String(rule?.match_field || 'description').toLowerCase();
        const op = String(rule?.match_operator || 'contains').toLowerCase();
        const matchValue = String(rule?.match_value || '').toLowerCase();
        const matchValue2 = String(rule?.match_value_2 || '').toLowerCase();
        const description = String(r?.description || '').toLowerCase();
        const vendor = String(r?.vendor_name || '').toLowerCase();
        const amount = Number(r?.amount || 0);
        if (field === 'amount') return op === 'equals' ? amount === Number(matchValue) : false;
        if (field === 'amount_range') return amount >= Number(matchValue || 0) && amount <= Number(matchValue2 || 0);
        const sourceText = field === 'vendor_name' ? vendor : description;
        if (sampleDescription && !sourceText.includes(sampleDescription)) return false;
        if (sampleAmount && amount !== sampleAmount && field === 'amount') return false;
        if (op === 'equals') return sourceText === matchValue;
        if (op === 'starts_with') return sourceText.startsWith(matchValue);
        return sourceText.includes(matchValue);
      });
      return res.json({ ok: true, matches: matches.slice(0, 200), count: matches.length });
    } catch (e) {
      logError('POST /api/banking/rules/:id/test', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), matches: [], count: 0 });
    }
  });

  app.post('/api/banking/rules/apply', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const ruleId = Number(req.body?.rule_id || 0);
      if (!Number.isFinite(ruleId) || ruleId <= 0) return res.status(400).json({ ok: false, error: 'rule_id is required' });
      const txnIds = Array.isArray(req.body?.txn_ids) ? req.body.txn_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
      const { rows: ruleRows } = await dbQuery(
        `SELECT id, match_field, match_operator, match_value, match_value_2,
                action_type, category, vendor_id, vendor_name, qbo_account_id
           FROM banking_rules
          WHERE id = $1
            AND active = true
          LIMIT 1`,
        [ruleId]
      );
      const rule = ruleRows?.[0] || null;
      if (!rule) return res.status(404).json({ ok: false, error: 'Rule not found' });
      const whereParts = [`LOWER(COALESCE(status, '')) = 'uncategorized'`];
      const vals = [];
      if (txnIds.length) {
        vals.push(txnIds);
        whereParts.push(`id = ANY($${vals.length}::bigint[])`);
      }
      const { rows: candidates } = await dbQuery(
        `SELECT id, amount, description, vendor_name
           FROM banking_transactions
          WHERE ${whereParts.join(' AND ')}
          ORDER BY txn_date ASC, id ASC`,
        vals
      );
      let applied = 0;
      let skipped = 0;
      for (const txn of candidates || []) {
        const field = String(rule?.match_field || 'description').toLowerCase();
        const op = String(rule?.match_operator || 'contains').toLowerCase();
        const matchValue = String(rule?.match_value || '').toLowerCase();
        const matchValue2 = String(rule?.match_value_2 || '').toLowerCase();
        const description = String(txn?.description || '').toLowerCase();
        const vendor = String(txn?.vendor_name || '').toLowerCase();
        const amount = Number(txn?.amount || 0);
        let matched = false;
        if (field === 'amount') matched = op === 'equals' ? amount === Number(matchValue) : false;
        else if (field === 'amount_range') matched = amount >= Number(matchValue || 0) && amount <= Number(matchValue2 || 0);
        else {
          const sourceText = field === 'vendor_name' ? vendor : description;
          if (op === 'equals') matched = sourceText === matchValue;
          else if (op === 'starts_with') matched = sourceText.startsWith(matchValue);
          else matched = sourceText.includes(matchValue);
        }
        if (!matched) {
          skipped += 1;
          continue;
        }
        const result = await categorizeBankingTransaction(req, Number(txn.id), {
          action: String(rule?.action_type || 'expense').trim().toLowerCase(),
          vendor_id: String(rule?.vendor_id || '').trim(),
          vendor_name: String(rule?.vendor_name || txn?.vendor_name || '').trim(),
          category: String(rule?.category || '').trim(),
          memo: `Applied rule #${ruleId}`,
          amount: Number(txn?.amount || 0),
          qbo_account_id: String(rule?.qbo_account_id || '').trim(),
        }, { auditAction: 'apply_rule_bulk' });
        if (result.ok) applied += 1;
        else skipped += 1;
      }
      return res.json({ ok: true, applied, skipped });
    } catch (e) {
      logError('POST /api/banking/rules/apply', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/reconciliation/sessions', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const accountId = String(b.account_id || '').trim();
      const accountName = String(b.account_name || '').trim() || null;
      const statementMonth = monthKeyFromDateLike(String(b.statement_month || '').trim());
      const statementEndDate = parseDateLike(String(b.statement_end_date || '').trim());
      const statementEndingBalance = Number(b.statement_ending_balance || 0);
      if (!accountId || !statementMonth) {
        return res.status(400).json({ ok: false, error: 'account_id and statement_month are required' });
      }
      const lockCheck = await checkPeriodLockForAccountMonth(accountId, statementMonth);
      if (lockCheck?.locked) {
        return res.status(409).json({ ok: false, error: `Period ${statementMonth} is locked for this account` });
      }

      const { rows: sessionRows } = await dbQuery(
        `INSERT INTO bank_reconciliation_sessions (
          account_id, statement_month, statement_end_date, statement_ending_balance,
          cleared_total, difference, status, lock_reason_code, lock_reason_notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,0,$4,'open',NULL,$5,now(),now())
        ON CONFLICT (account_id, statement_month)
        DO UPDATE SET
          statement_end_date = EXCLUDED.statement_end_date,
          statement_ending_balance = EXCLUDED.statement_ending_balance,
          status = 'open',
          lock_reason_code = NULL,
          lock_reason_notes = EXCLUDED.lock_reason_notes,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = now()
        RETURNING *`,
        [accountId, statementMonth, statementEndDate || null, statementEndingBalance, accountName]
      );
      const session = sessionRows?.[0] || null;
      const sessionId = Number(session?.id || 0);
      if (!sessionId) return res.status(500).json({ ok: false, error: 'Unable to create reconciliation session' });

      const from = `${statementMonth}-01`;
      const to = `${statementMonth}-31`;
      const { rows: txnRows } = await dbQuery(
        `SELECT id, reconciled
           FROM banking_transactions
          WHERE account_id = $1
            AND txn_date >= $2::date
            AND txn_date <= $3::date
          ORDER BY txn_date ASC, id ASC`,
        [accountId, from, to]
      );
      for (const tx of txnRows || []) {
        await dbQuery(
          `INSERT INTO bank_reconciliation_items (
            reconciliation_session_id, banking_txn_id, cleared, cleared_at, created_at
          ) VALUES ($1,$2,$3,$4,now())
          ON CONFLICT (reconciliation_session_id, banking_txn_id)
          DO UPDATE SET cleared = EXCLUDED.cleared, cleared_at = EXCLUDED.cleared_at`,
          [sessionId, Number(tx?.id || 0), Boolean(tx?.reconciled), tx?.reconciled ? new Date().toISOString() : null]
        );
      }
      const totals = await computeReconciliationTotals(sessionId);
      const difference = Number(statementEndingBalance || 0) - Number(totals.cleared_total || 0);
      await dbQuery(
        `UPDATE bank_reconciliation_sessions
            SET cleared_total = $2,
                difference = $3,
                updated_at = now()
          WHERE id = $1`,
        [sessionId, Number(totals.cleared_total || 0), difference]
      );
      const { rows: finalRows } = await dbQuery(
        `SELECT *
           FROM bank_reconciliation_sessions
          WHERE id = $1
          LIMIT 1`,
        [sessionId]
      );
      const finalSession = {
        ...(finalRows?.[0] || {}),
        account_name: accountName || null,
      };
      await writeAuditLog(req, {
        action: 'create_reconciliation_session',
        entity_type: 'bank_reconciliation_sessions',
        entity_id: String(sessionId),
        before_state: null,
        after_state: { session: finalSession, totals },
        source_module: 'banking',
      });
      return res.json({ ok: true, session: finalSession });
    } catch (e) {
      logError('POST /api/banking/reconciliation/sessions', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/reconciliation/sessions', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, sessions: [], count: 0 });
      await ensureBankingTables();
      const accountId = String(req.query?.account_id || '').trim();
      const year = String(req.query?.year || '').trim();
      const where = [];
      const values = [];
      if (accountId) {
        values.push(accountId);
        where.push(`account_id = $${values.length}`);
      }
      if (year && /^\d{4}$/.test(year)) {
        values.push(`${year}-`);
        where.push(`statement_month LIKE $${values.length} || '%'`);
      }
      const { rows } = await dbQuery(
        `SELECT id, account_id, lock_reason_notes AS account_name, statement_month, statement_end_date,
                statement_ending_balance, cleared_total, difference, status, locked_by, locked_at, updated_at
           FROM bank_reconciliation_sessions
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY statement_month DESC, id DESC`,
        values
      );
      return res.json({ ok: true, sessions: rows || [], count: Number(rows?.length || 0) });
    } catch (e) {
      logError('GET /api/banking/reconciliation/sessions', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), sessions: [], count: 0 });
    }
  });

  app.get('/api/banking/reconciliation/sessions/:id', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid session id' });
      const { rows: sessionRows } = await dbQuery(
        `SELECT id, account_id, lock_reason_notes AS account_name, statement_month, statement_end_date,
                statement_ending_balance, cleared_total, difference, status, lock_reason_code, lock_reason_notes,
                locked_by, locked_at, created_at, updated_at
           FROM bank_reconciliation_sessions
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      const session = sessionRows?.[0] || null;
      if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
      const { rows: items } = await dbQuery(
        `SELECT bri.id, bri.reconciliation_session_id, bri.banking_txn_id, bri.cleared, bri.cleared_at,
                bt.txn_date, bt.description, bt.memo, bt.amount, bt.account_id, bt.account_name, bt.reconciled, bt.status, bt.category
           FROM bank_reconciliation_items bri
           JOIN banking_transactions bt ON bt.id = bri.banking_txn_id
          WHERE bri.reconciliation_session_id = $1
          ORDER BY bt.txn_date ASC, bt.id ASC`,
        [id]
      );
      const totals = await computeReconciliationTotals(id);
      const difference = Number(session?.statement_ending_balance || 0) - Number(totals?.cleared_total || 0);
      await dbQuery(
        `UPDATE bank_reconciliation_sessions
            SET cleared_total = $2,
                difference = $3,
                updated_at = now()
          WHERE id = $1`,
        [id, Number(totals?.cleared_total || 0), difference]
      );
      return res.json({
        ok: true,
        session: { ...session, cleared_total: Number(totals?.cleared_total || 0), difference },
        items: items || [],
        totals: { ...totals, difference },
      });
    } catch (e) {
      logError('GET /api/banking/reconciliation/sessions/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/reconciliation/sessions/:id/clear', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid session id' });
      const itemIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
      const cleared = Boolean(req.body?.cleared);
      if (!itemIds.length) return res.status(400).json({ ok: false, error: 'item_ids are required' });
      const { rows: sessionRows } = await dbQuery('SELECT * FROM bank_reconciliation_sessions WHERE id = $1 LIMIT 1', [id]);
      const session = sessionRows?.[0] || null;
      if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
      if (String(session?.status || '').toLowerCase() === 'locked') {
        return res.status(409).json({ ok: false, error: 'Session is locked' });
      }
      await dbQuery(
        `UPDATE bank_reconciliation_items
            SET cleared = $2,
                cleared_at = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE reconciliation_session_id = $1
            AND id = ANY($3::bigint[])`,
        [id, cleared, itemIds]
      );
      const totals = await computeReconciliationTotals(id);
      const difference = Number(session?.statement_ending_balance || 0) - Number(totals?.cleared_total || 0);
      await dbQuery(
        `UPDATE bank_reconciliation_sessions
            SET cleared_total = $2,
                difference = $3,
                updated_at = now()
          WHERE id = $1`,
        [id, Number(totals?.cleared_total || 0), difference]
      );
      return res.json({ ok: true, totals: { ...totals, difference } });
    } catch (e) {
      logError('POST /api/banking/reconciliation/sessions/:id/clear', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/reconciliation/sessions/:id/lock', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid session id' });
      const { rows: sessionRows } = await dbQuery('SELECT * FROM bank_reconciliation_sessions WHERE id = $1 LIMIT 1', [id]);
      const session = sessionRows?.[0] || null;
      if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
      const totals = await computeReconciliationTotals(id);
      const difference = Number(session?.statement_ending_balance || 0) - Number(totals?.cleared_total || 0);
      if (Math.round(difference * 100) !== 0) {
        return res.status(400).json({
          ok: false,
          error: 'Difference must be $0.00 to lock',
          difference,
        });
      }
      const actor = maintActor(req);
      await dbQuery(
        `UPDATE bank_reconciliation_sessions
            SET status = 'locked',
                cleared_total = $2,
                difference = $3,
                locked_by = $4,
                locked_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [id, Number(totals?.cleared_total || 0), difference, actor]
      );
      await dbQuery(
        `UPDATE banking_transactions bt
            SET reconciled = true, updated_at = now(), updated_by = $2
           FROM bank_reconciliation_items bri
          WHERE bri.reconciliation_session_id = $1
            AND bri.cleared = true
            AND bt.id = bri.banking_txn_id`,
        [id, actor]
      );
      const periodKey = `${String(session?.statement_month || '').trim()}:${String(session?.account_id || '').trim()}`;
      await dbQuery(
        `INSERT INTO period_locks (module, period_key, status, locked_by, lock_reason, created_at, updated_at)
         VALUES ('banking_reconciliation', $1, 'locked', $2, $3, now(), now())
         ON CONFLICT (module, period_key)
         DO UPDATE SET status = 'locked', locked_by = EXCLUDED.locked_by, lock_reason = EXCLUDED.lock_reason, updated_at = now()`,
        [periodKey, actor, String(session?.account_id || '').trim()]
      );
      const { rows: finalRows } = await dbQuery('SELECT * FROM bank_reconciliation_sessions WHERE id = $1 LIMIT 1', [id]);
      const finalSession = finalRows?.[0] || null;
      await writeAuditLog(req, {
        action: 'lock_reconciliation',
        entity_type: 'bank_reconciliation_sessions',
        entity_id: String(id),
        before_state: session,
        after_state: { session: finalSession, totals: { ...totals, difference } },
        source_module: 'banking',
      });
      return res.json({ ok: true, session: finalSession });
    } catch (e) {
      logError('POST /api/banking/reconciliation/sessions/:id/lock', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/banking/reconciliation/sessions/:id/unlock', async (req, res) => {
    try {
      if (!requireAdminRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      const reason = String(req.body?.reason || '').trim();
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid session id' });
      if (!reason) return res.status(400).json({ ok: false, error: 'reason is required' });
      const { rows: beforeRows } = await dbQuery('SELECT * FROM bank_reconciliation_sessions WHERE id = $1 LIMIT 1', [id]);
      const before = beforeRows?.[0] || null;
      if (!before) return res.status(404).json({ ok: false, error: 'Session not found' });
      await dbQuery(
        `UPDATE bank_reconciliation_sessions
            SET status = 'open',
                lock_reason_code = 'manual_unlock',
                lock_reason_notes = $2,
                locked_by = NULL,
                locked_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [id, reason]
      );
      await dbQuery(
        `UPDATE banking_transactions bt
            SET reconciled = false, updated_at = now(), updated_by = $2
           FROM bank_reconciliation_items bri
          WHERE bri.reconciliation_session_id = $1
            AND bt.id = bri.banking_txn_id`,
        [id, maintActor(req)]
      );
      const periodKey = `${String(before?.statement_month || '').trim()}:${String(before?.account_id || '').trim()}`;
      await dbQuery(
        `DELETE FROM period_locks
          WHERE module = 'banking_reconciliation'
            AND period_key = $1`,
        [periodKey]
      );
      const { rows: finalRows } = await dbQuery('SELECT * FROM bank_reconciliation_sessions WHERE id = $1 LIMIT 1', [id]);
      const session = finalRows?.[0] || null;
      await writeAuditLog(req, {
        action: 'unlock_reconciliation',
        entity_type: 'bank_reconciliation_sessions',
        entity_id: String(id),
        before_state: before,
        after_state: { session, reason },
        source_module: 'banking',
      });
      return res.json({ ok: true, session });
    } catch (e) {
      logError('POST /api/banking/reconciliation/sessions/:id/unlock', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/banking/reconciliation/sessions/:id/export', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid session id' });
      const fmt = String(req.query?.format || 'pdf').trim().toLowerCase();
      const { rows: sessionRows } = await dbQuery(
        `SELECT id, account_id, lock_reason_notes AS account_name, statement_month, statement_end_date,
                statement_ending_balance, status, locked_by, locked_at
           FROM bank_reconciliation_sessions
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      const session = sessionRows?.[0] || null;
      if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
      const { rows: items } = await dbQuery(
        `SELECT bri.cleared, bt.txn_date, bt.description, bt.amount
           FROM bank_reconciliation_items bri
           JOIN banking_transactions bt ON bt.id = bri.banking_txn_id
          WHERE bri.reconciliation_session_id = $1
          ORDER BY bt.txn_date ASC, bt.id ASC`,
        [id]
      );
      const totals = await computeReconciliationTotals(id);
      const difference = Number(session?.statement_ending_balance || 0) - Number(totals?.cleared_total || 0);
      const cleared = (items || []).filter((r) => r?.cleared);
      const uncleared = (items || []).filter((r) => !r?.cleared);
      if (fmt === 'csv') {
        const lines = [
          ['company', 'account', 'statement_period', 'statement_ending_balance', 'cleared_total', 'difference', 'reconciled_by', 'reconciled_at'].map(csvEscape).join(','),
          [
            'IH 35 Transportation LLC',
            session?.account_name || session?.account_id || '',
            session?.statement_month || '',
            Number(session?.statement_ending_balance || 0),
            Number(totals?.cleared_total || 0),
            difference,
            session?.locked_by || '',
            session?.locked_at || '',
          ].map(csvEscape).join(','),
          '',
          ['section', 'date', 'description', 'deposits', 'withdrawals'].map(csvEscape).join(','),
          ...cleared.map((r) => ['cleared', String(r?.txn_date || '').slice(0, 10), String(r?.description || ''), Number(r?.amount || 0) > 0 ? Number(r.amount) : '', Number(r?.amount || 0) < 0 ? Math.abs(Number(r.amount)) : ''].map(csvEscape).join(',')),
          ...uncleared.map((r) => ['uncleared', String(r?.txn_date || '').slice(0, 10), String(r?.description || ''), Number(r?.amount || 0) > 0 ? Number(r.amount) : '', Number(r?.amount || 0) < 0 ? Math.abs(Number(r.amount)) : ''].map(csvEscape).join(',')),
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${id}.csv"`);
        return res.status(200).send(lines.join('\n'));
      }
      const reportLines = [
        'IH 35 Transportation LLC',
        `Account: ${session?.account_name || session?.account_id || '--'}`,
        `Statement Period: ${session?.statement_month || '--'}`,
        `Statement Ending Balance: ${Number(session?.statement_ending_balance || 0).toFixed(2)}`,
        `Cleared Deposits: ${Number(totals?.cleared_deposits || 0).toFixed(2)}`,
        `Cleared Withdrawals: ${Number(totals?.cleared_withdrawals || 0).toFixed(2)}`,
        `Cleared Total: ${Number(totals?.cleared_total || 0).toFixed(2)}`,
        `Difference: ${Number(difference || 0).toFixed(2)}`,
        `Reconciled by: ${session?.locked_by || 'operator'} on ${String(session?.locked_at || new Date().toISOString()).slice(0, 19).replace('T', ' ')}`,
        '',
        'Cleared Transactions:',
        ...cleared.map((r) => `✓ ${String(r?.txn_date || '').slice(0, 10)} | ${String(r?.description || '').slice(0, 68)} | ${Number(r?.amount || 0).toFixed(2)}`),
        '',
        'Uncleared Transactions:',
        ...uncleared.map((r) => `• ${String(r?.txn_date || '').slice(0, 10)} | ${String(r?.description || '').slice(0, 68)} | ${Number(r?.amount || 0).toFixed(2)}`),
      ];
      const pdfBuffer = generateSimplePdf(reportLines);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${id}.pdf"`);
      return res.status(200).send(pdfBuffer);
    } catch (e) {
      logError('GET /api/banking/reconciliation/sessions/:id/export', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrations/relay/status', async (_req, res) => {
    try {
      if (!getPoolForRoute()) {
        return res.json({
          ok: true,
          connected: false,
          last_sync: null,
          api_key_set: Boolean(String(process.env.RELAY_API_KEY || '').trim()),
          account_id: String(process.env.RELAY_QBO_ACCOUNT_ID || '').trim() || null,
          pending_import: 0,
          total_imported: 0,
        });
      }
      await ensureBankingTables();
      const { rows } = await dbQuery(
        `SELECT
            MAX(created_at) AS last_sync,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'uncategorized')::int AS pending_import,
            COUNT(*)::int AS total_imported
           FROM banking_transactions
          WHERE LOWER(COALESCE(source, '')) = 'relay'`
      );
      const relayRow = rows?.[0] || {};
      const { rows: prefRows } = await dbQuery(
        `SELECT account_id
           FROM bank_account_preferences
          WHERE is_relay_account = true
          ORDER BY display_order ASC, id ASC
          LIMIT 1`
      );
      const accountId = String(prefRows?.[0]?.account_id || process.env.RELAY_QBO_ACCOUNT_ID || '').trim() || null;
      return res.json({
        ok: true,
        connected: Boolean(String(process.env.RELAY_API_KEY || '').trim()),
        last_sync: relayRow?.last_sync || null,
        api_key_set: Boolean(String(process.env.RELAY_API_KEY || '').trim()),
        account_id: accountId,
        pending_import: Number(relayRow?.pending_import || 0),
        total_imported: Number(relayRow?.total_imported || 0),
      });
    } catch (e) {
      logError('GET /api/integrations/relay/status', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrations/relay/sync', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const relayFetch = await fetchRelayTransactionsFromApi();
      if (!relayFetch.ok) {
        return res.status(502).json({ ok: false, imported: 0, skipped: 0, errors: [relayFetch.error || 'Relay API unavailable'] });
      }

      const { rows: prefRows } = await dbQuery(
        `SELECT account_id, account_name
           FROM bank_account_preferences
          WHERE is_relay_account = true
          ORDER BY display_order ASC, id ASC
          LIMIT 1`
      );
      const relayAccountId = String(prefRows?.[0]?.account_id || process.env.RELAY_QBO_ACCOUNT_ID || 'relay_qbo_account').trim();
      const relayAccountName = String(prefRows?.[0]?.account_name || 'Relay Fuel Account').trim();

      let profileRows = [];
      try {
        const out = await dbQuery(
          `SELECT id, full_name, integration_id, unit_number
             FROM driver_profiles`
        );
        profileRows = out?.rows || [];
      } catch (_e) {
        profileRows = [];
      }
      const byIntegration = new Map();
      profileRows.forEach((r) => {
        const key = String(r?.integration_id || '').trim();
        if (key) byIntegration.set(key, r);
      });

      let imported = 0;
      let skipped = 0;
      const errors = [];
      for (const rawTxn of relayFetch.rows || []) {
        try {
          const txn = normalizeRelayTxn(rawTxn);
          const relayRef = String(txn?.relay_transaction_id || '').trim();
          const { rows: dupRows } = await dbQuery(
            `SELECT id
               FROM banking_transactions
              WHERE relay_transaction_id = $1
                 OR external_ref = $1
              LIMIT 1`,
            [relayRef || `relay:${txn.txn_date}:${txn.amount}:${txn.description}`]
          );
          if (dupRows?.length) {
            skipped += 1;
            continue;
          }
          const prof = txn.driver_integration_id ? byIntegration.get(String(txn.driver_integration_id)) : null;
          const driverId = String(prof?.id || '').trim() || null;
          const driverName = String(txn.driver_name || prof?.full_name || '').trim() || null;
          const unit = String(txn.unit_number || prof?.unit_number || '').trim() || null;
          const externalRef = relayRef || buildTxnIdempotency(relayAccountId, txn.txn_date, txn.amount, txn.description, 'relay');
          const idem = buildTxnIdempotency(relayAccountId, txn.txn_date, txn.amount, txn.description, externalRef);
          await dbQuery(
            `INSERT INTO banking_transactions (
              idempotency_key, account_id, account_name, txn_type, txn_date, amount, running_balance,
              description, vendor_name, memo, status, source, source_ref, external_ref,
              relay_transaction_id, driver_id, unit_number, gallons, station_name, state, raw_payload_json,
              qbo_status, created_by, updated_by, updated_at
            ) VALUES (
              $1,$2,$3,'relay',$4,$5,NULL,$6,$7,$8,'uncategorized','relay',$9,$9,$9,$10,$11,$12,$13,$14,$15::jsonb,'queued',$16,$16,now()
            )`,
            [
              idem,
              relayAccountId,
              relayAccountName,
              txn.txn_date,
              Number(txn.amount || 0),
              String(txn.description || '').trim() || 'Relay transaction',
              String(txn.station_name || '').trim() || null,
              String(txn.description || '').trim() || null,
              externalRef,
              driverId,
              unit,
              Number(txn.gallons || 0),
              String(txn.station_name || '').trim() || null,
              String(txn.state || '').trim() || null,
              JSON.stringify(txn.raw || {}),
              maintActor(req),
            ]
          );
          imported += 1;
        } catch (inner) {
          errors.push(inner?.message || String(inner));
        }
      }
      await writeAuditLog(req, {
        action: 'relay_sync',
        entity_type: 'banking_transactions',
        entity_id: relayAccountId,
        before_state: null,
        after_state: { imported, skipped, errors_count: errors.length, endpoint: relayFetch.endpoint || null },
        source_module: 'banking',
      });
      return res.json({ ok: true, imported, skipped, errors });
    } catch (e) {
      logError('POST /api/integrations/relay/sync', e);
      return res.status(500).json({ ok: false, imported: 0, skipped: 0, errors: [e?.message || String(e)] });
    }
  });

  app.post('/api/integrations/relay/import-csv', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      await runBankImportUpload(req, res);
      const file = req.file || null;
      if (!file) return res.status(400).json({ ok: false, error: 'file is required (multipart field name: file)' });
      const content = String(file.buffer?.toString('utf8') || '');
      const lines = content.split(/\r?\n/).filter((l) => String(l || '').trim());
      if (!lines.length) return res.status(400).json({ ok: false, error: 'CSV is empty' });
      const headers = parseCsvLine(lines[0]).map(normalizeHeaderKey);
      const idx = (names) => {
        for (const n of names) {
          const i = headers.indexOf(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const iDate = idx(['date', 'transaction_date', 'posted_date']);
      const iDesc = idx(['description', 'memo', 'merchant', 'station', 'vendor']);
      const iAmount = idx(['amount', 'total', 'total_amount']);
      const iDriver = idx(['driver', 'driver_name']);
      const iDriverInt = idx(['driver_id', 'driver_integration_id', 'integration_id']);
      const iUnit = idx(['unit', 'unit_number', 'truck']);
      const iGallons = idx(['gallons', 'qty', 'quantity']);
      const iState = idx(['state']);
      const iStation = idx(['station', 'station_name', 'merchant']);
      const iRelayRef = idx(['relay_transaction_id', 'transaction_id', 'id', 'reference']);
      const rows = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cols = parseCsvLine(lines[i]);
        rows.push(normalizeRelayTxn({
          id: iRelayRef >= 0 ? cols[iRelayRef] : '',
          date: iDate >= 0 ? cols[iDate] : '',
          description: iDesc >= 0 ? cols[iDesc] : '',
          amount: iAmount >= 0 ? cols[iAmount] : '',
          driver_name: iDriver >= 0 ? cols[iDriver] : '',
          driver_integration_id: iDriverInt >= 0 ? cols[iDriverInt] : '',
          unit_number: iUnit >= 0 ? cols[iUnit] : '',
          gallons: iGallons >= 0 ? cols[iGallons] : '',
          state: iState >= 0 ? cols[iState] : '',
          station_name: iStation >= 0 ? cols[iStation] : '',
        }));
      }

      // Reuse sync logic by pretending Relay API rows.
      const mockReq = { ...req };
      const relayFetch = { ok: true, rows, endpoint: 'csv_import' };
      const { rows: prefRows } = await dbQuery(
        `SELECT account_id, account_name
           FROM bank_account_preferences
          WHERE is_relay_account = true
          ORDER BY display_order ASC, id ASC
          LIMIT 1`
      );
      const relayAccountId = String(prefRows?.[0]?.account_id || process.env.RELAY_QBO_ACCOUNT_ID || 'relay_qbo_account').trim();
      const relayAccountName = String(prefRows?.[0]?.account_name || 'Relay Fuel Account').trim();
      let imported = 0;
      let skipped = 0;
      for (const txn of relayFetch.rows || []) {
        const relayRef = String(txn?.relay_transaction_id || '').trim();
        const { rows: dupRows } = await dbQuery(
          `SELECT id
             FROM banking_transactions
            WHERE relay_transaction_id = $1
               OR external_ref = $1
            LIMIT 1`,
          [relayRef || `relaycsv:${txn.txn_date}:${txn.amount}:${txn.description}`]
        );
        if (dupRows?.length) {
          skipped += 1;
          continue;
        }
        const externalRef = relayRef || buildTxnIdempotency(relayAccountId, txn.txn_date, txn.amount, txn.description, 'relay_csv');
        const idem = buildTxnIdempotency(relayAccountId, txn.txn_date, txn.amount, txn.description, externalRef);
        await dbQuery(
          `INSERT INTO banking_transactions (
            idempotency_key, account_id, account_name, txn_type, txn_date, amount, running_balance,
            description, vendor_name, memo, status, source, source_ref, external_ref,
            relay_transaction_id, driver_id, unit_number, gallons, station_name, state, raw_payload_json,
            qbo_status, created_by, updated_by, updated_at
          ) VALUES (
            $1,$2,$3,'relay',$4,$5,NULL,$6,$7,$8,'uncategorized','relay',$9,$9,$9,NULL,$10,$11,$12,$13,$14::jsonb,'queued',$15,$15,now()
          )`,
          [
            idem,
            relayAccountId,
            relayAccountName,
            txn.txn_date,
            Number(txn.amount || 0),
            String(txn.description || '').trim() || 'Relay CSV transaction',
            String(txn.station_name || '').trim() || null,
            String(txn.description || '').trim() || null,
            externalRef,
            String(txn.unit_number || '').trim() || null,
            Number(txn.gallons || 0),
            String(txn.station_name || '').trim() || null,
            String(txn.state || '').trim() || null,
            JSON.stringify(txn.raw || {}),
            maintActor(mockReq),
          ]
        );
        imported += 1;
      }
      await writeAuditLog(req, {
        action: 'relay_import_csv',
        entity_type: 'banking_transactions',
        entity_id: relayAccountId,
        before_state: null,
        after_state: { imported, skipped, filename: file?.originalname || null },
        source_module: 'banking',
      });
      return res.json({ ok: true, imported, skipped });
    } catch (e) {
      logError('POST /api/integrations/relay/import-csv', e);
      return res.status(500).json({ ok: false, imported: 0, skipped: 0, error: e?.message || String(e) });
    }
  });

  app.get('/api/settlements', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, settlements: [], total: 0 });
      await ensureBankingTables();
      const driverId = String(req.query?.driver_id || '').trim();
      const periodStart = parseDateLike(req.query?.period_start || '');
      const periodEnd = parseDateLike(req.query?.period_end || '');
      const status = String(req.query?.status || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      const where = [];
      const values = [];
      if (driverId) {
        values.push(driverId);
        where.push(`driver_id = $${values.length}`);
      }
      if (periodStart) {
        values.push(periodStart);
        where.push(`period_start >= $${values.length}::date`);
      }
      if (periodEnd) {
        values.push(periodEnd);
        where.push(`period_end <= $${values.length}::date`);
      }
      if (status) {
        values.push(status);
        where.push(`LOWER(COALESCE(status, '')) = $${values.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: countRows } = await dbQuery(`SELECT COUNT(*)::int AS total FROM driver_settlements ${whereSql}`, values);
      const total = Number(countRows?.[0]?.total || 0);
      const listValues = [...values, limit, offset];
      const { rows } = await dbQuery(
        `SELECT *
           FROM driver_settlements
           ${whereSql}
          ORDER BY period_start DESC, id DESC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      );
      return res.json({ ok: true, settlements: rows || [], total });
    } catch (e) {
      logError('GET /api/settlements', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), settlements: [], total: 0 });
    }
  });

  app.post('/api/settlements', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const loads = parseLoadNumbers(b.load_numbers);
      const gross = Number(b.gross_pay || 0);
      const fuelDed = Number(b.fuel_deduction || 0);
      const advDed = Number(b.advance_deduction || 0);
      const otherDed = Number(b.other_deductions || 0);
      const netPay = Number.isFinite(Number(b.net_pay)) ? Number(b.net_pay) : (gross - fuelDed - advDed - otherDed);
      const { rows } = await dbQuery(
        `INSERT INTO driver_settlements (
          driver_id, driver_name, period_start, period_end, gross_pay, fuel_deduction,
          advance_deduction, other_deductions, net_pay, status, notes, created_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'unpaid',$10,$11,now(),now())
        RETURNING *`,
        [
          String(b.driver_id || '').trim() || null,
          String(b.driver_name || '').trim() || null,
          parseDateLike(b.period_start || '') || null,
          parseDateLike(b.period_end || '') || null,
          gross,
          fuelDed,
          advDed,
          otherDed,
          netPay,
          String(b.notes || '').trim() || null,
          maintActor(req),
        ]
      );
      const settlement = rows?.[0] || null;
      const settlementId = Number(settlement?.id || 0);
      for (const loadNo of loads) {
        await dbQuery(
          `INSERT INTO driver_settlement_loads (settlement_id, load_number, gross_component, created_at)
           VALUES ($1,$2,NULL,now())`,
          [settlementId, loadNo]
        );
      }
      await writeAuditLog(req, {
        action: 'create_settlement',
        entity_type: 'driver_settlements',
        entity_id: String(settlementId),
        before_state: null,
        after_state: { settlement, loads },
        source_module: 'banking',
      });
      return res.json({ ok: true, settlement: { ...settlement, load_numbers: loads } });
    } catch (e) {
      logError('POST /api/settlements', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/settlements/:id', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid settlement id' });
      const { rows: settlementRows } = await dbQuery('SELECT * FROM driver_settlements WHERE id = $1 LIMIT 1', [id]);
      const settlement = settlementRows?.[0] || null;
      if (!settlement) return res.status(404).json({ ok: false, error: 'Settlement not found' });
      const { rows: loads } = await dbQuery('SELECT * FROM driver_settlement_loads WHERE settlement_id = $1 ORDER BY id ASC', [id]);
      const { rows: bankTxns } = await dbQuery(
        `SELECT bt.*
           FROM bank_txn_links l
           JOIN banking_transactions bt ON bt.id = l.txn_id
          WHERE l.entity_type = 'driver_settlement'
            AND l.entity_id = $1
          ORDER BY l.created_at DESC`,
        [String(id)]
      );
      return res.json({ ok: true, settlement, loads: loads || [], bank_txns: bankTxns || [] });
    } catch (e) {
      logError('GET /api/settlements/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.put('/api/settlements/:id', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid settlement id' });
      const { rows: beforeRows } = await dbQuery('SELECT * FROM driver_settlements WHERE id = $1 LIMIT 1', [id]);
      const before = beforeRows?.[0] || null;
      if (!before) return res.status(404).json({ ok: false, error: 'Settlement not found' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const gross = b.gross_pay == null ? Number(before.gross_pay || 0) : Number(b.gross_pay || 0);
      const fuelDed = b.fuel_deduction == null ? Number(before.fuel_deduction || 0) : Number(b.fuel_deduction || 0);
      const advDed = b.advance_deduction == null ? Number(before.advance_deduction || 0) : Number(b.advance_deduction || 0);
      const otherDed = b.other_deductions == null ? Number(before.other_deductions || 0) : Number(b.other_deductions || 0);
      const netPay = gross - fuelDed - advDed - otherDed;
      const { rows } = await dbQuery(
        `UPDATE driver_settlements
            SET gross_pay = $2,
                fuel_deduction = $3,
                advance_deduction = $4,
                other_deductions = $5,
                net_pay = $6,
                status = COALESCE($7, status),
                notes = COALESCE($8, notes),
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id, gross, fuelDed, advDed, otherDed, netPay, b.status == null ? null : String(b.status || '').trim(), b.notes == null ? null : String(b.notes || '').trim()]
      );
      const settlement = rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'update_settlement',
        entity_type: 'driver_settlements',
        entity_id: String(id),
        before_state: before,
        after_state: settlement,
        source_module: 'banking',
      });
      return res.json({ ok: true, settlement });
    } catch (e) {
      logError('PUT /api/settlements/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/settlements/:id/link-bank-txn', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      const txnId = Number(req.body?.txn_id || 0);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'id and txn_id are required' });
      const { rows: settlementRows } = await dbQuery('SELECT * FROM driver_settlements WHERE id = $1 LIMIT 1', [id]);
      const settlement = settlementRows?.[0] || null;
      if (!settlement) return res.status(404).json({ ok: false, error: 'Settlement not found' });
      const { rows: txnRows } = await dbQuery('SELECT * FROM banking_transactions WHERE id = $1 LIMIT 1', [txnId]);
      const txn = txnRows?.[0] || null;
      if (!txn) return res.status(404).json({ ok: false, error: 'Bank transaction not found' });
      const linkedAmount = Number(req.body?.amount || txn?.amount || 0);
      await dbQuery(
        `INSERT INTO bank_txn_links (txn_id, entity_type, entity_id, amount, link_role, created_by)
         VALUES ($1,'driver_settlement',$2,$3,'payment',$4)`,
        [txnId, String(id), linkedAmount, maintActor(req)]
      );
      const status = linkedAmount >= Number(settlement?.net_pay || 0) ? 'paid' : 'partial';
      const { rows } = await dbQuery(
        `UPDATE driver_settlements
            SET bank_txn_id = $2,
                status = $3,
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id, txnId, status]
      );
      return res.json({ ok: true, settlement: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/settlements/:id/link-bank-txn', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/settlements/:id/recalculate', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid settlement id' });
      const { rows: rowsIn } = await dbQuery('SELECT * FROM driver_settlements WHERE id = $1 LIMIT 1', [id]);
      const item = rowsIn?.[0] || null;
      if (!item) return res.status(404).json({ ok: false, error: 'Settlement not found' });
      const netPay = Number(item?.gross_pay || 0) - Number(item?.fuel_deduction || 0) - Number(item?.advance_deduction || 0) - Number(item?.other_deductions || 0);
      const { rows } = await dbQuery(
        `UPDATE driver_settlements
            SET net_pay = $2,
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id, netPay]
      );
      return res.json({ ok: true, settlement: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/settlements/:id/recalculate', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/settlements/:id/export', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid settlement id' });
      const { rows: settlementRows } = await dbQuery('SELECT * FROM driver_settlements WHERE id = $1 LIMIT 1', [id]);
      const s = settlementRows?.[0] || null;
      if (!s) return res.status(404).json({ ok: false, error: 'Settlement not found' });
      const { rows: loads } = await dbQuery('SELECT load_number FROM driver_settlement_loads WHERE settlement_id = $1 ORDER BY id ASC', [id]);
      const lines = [
        'IH 35 Transportation LLC',
        `Driver: ${String(s?.driver_name || s?.driver_id || '--')}`,
        `Period: ${String(s?.period_start || '').slice(0, 10)} - ${String(s?.period_end || '').slice(0, 10)}`,
        `Load Numbers: ${(loads || []).map((r) => r?.load_number).filter(Boolean).join(', ') || '--'}`,
        `Gross Pay: ${Number(s?.gross_pay || 0).toFixed(2)}`,
        `Fuel Deduction: (${Number(s?.fuel_deduction || 0).toFixed(2)})`,
        `Advance Deduction: (${Number(s?.advance_deduction || 0).toFixed(2)})`,
        `Other Deductions: (${Number(s?.other_deductions || 0).toFixed(2)})`,
        `Net Pay: ${Number(s?.net_pay || 0).toFixed(2)}`,
        `Status: ${String(s?.status || 'unpaid').toUpperCase()}`,
      ];
      const pdf = generateSimplePdf(lines);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="settlement-${id}.pdf"`);
      return res.status(200).send(pdf);
    } catch (e) {
      logError('GET /api/settlements/:id/export', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/reports/tms/driver-settlement', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, rows: [], totals: {} });
      await ensureBankingTables();
      const driverId = String(req.query?.driver_id || '').trim();
      const year = String(req.query?.year || '').trim();
      const periodStart = parseDateLike(req.query?.period_start || '');
      const periodEnd = parseDateLike(req.query?.period_end || '');
      const where = [];
      const values = [];
      if (driverId) {
        values.push(driverId);
        where.push(`driver_id = $${values.length}`);
      }
      if (year && /^\d{4}$/.test(year)) {
        values.push(`${year}-01-01`);
        where.push(`period_start >= $${values.length}::date`);
        values.push(`${year}-12-31`);
        where.push(`period_end <= $${values.length}::date`);
      }
      if (periodStart) {
        values.push(periodStart);
        where.push(`period_start >= $${values.length}::date`);
      }
      if (periodEnd) {
        values.push(periodEnd);
        where.push(`period_end <= $${values.length}::date`);
      }
      const { rows } = await dbQuery(
        `SELECT driver_id, driver_name, period_start, period_end, gross_pay,
                (fuel_deduction + advance_deduction + other_deductions) AS deductions,
                net_pay, status
           FROM driver_settlements
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY period_start DESC, id DESC`,
        values
      );
      const mapped = (rows || []).map((r) => ({
        driver: String(r?.driver_name || r?.driver_id || '--'),
        periods: `${String(r?.period_start || '').slice(0, 10)} - ${String(r?.period_end || '').slice(0, 10)}`,
        gross: Number(r?.gross_pay || 0),
        deductions: Number(r?.deductions || 0),
        net: Number(r?.net_pay || 0),
        status: String(r?.status || 'unpaid'),
        balance_owed: String(r?.status || '').toLowerCase() === 'paid' ? 0 : Number(r?.net_pay || 0),
      }));
      const totals = mapped.reduce((acc, r) => {
        acc.gross += Number(r.gross || 0);
        acc.deductions += Number(r.deductions || 0);
        acc.net += Number(r.net || 0);
        acc.balance_owed += Number(r.balance_owed || 0);
        return acc;
      }, { gross: 0, deductions: 0, net: 0, balance_owed: 0 });
      return res.json({ ok: true, rows: mapped, totals });
    } catch (e) {
      logError('GET /api/reports/tms/driver-settlement', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [], totals: {} });
    }
  });

  app.get('/api/factoring/advances', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, advances: [], total: 0 });
      await ensureBankingTables();
      const factorName = String(req.query?.factor_name || '').trim().toLowerCase();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      const where = [];
      const values = [];
      if (factorName) {
        values.push(`%${factorName}%`);
        where.push(`LOWER(COALESCE(factor_name, '')) LIKE $${values.length}`);
      }
      if (status) {
        values.push(status);
        where.push(`LOWER(COALESCE(status, '')) = $${values.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: countRows } = await dbQuery(`SELECT COUNT(*)::int AS total FROM factoring_advances ${whereSql}`, values);
      const total = Number(countRows?.[0]?.total || 0);
      const listValues = [...values, limit, offset];
      const { rows } = await dbQuery(
        `SELECT *
           FROM factoring_advances
           ${whereSql}
          ORDER BY deposit_date DESC NULLS LAST, id DESC
          LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
        listValues
      );
      return res.json({ ok: true, advances: rows || [], total });
    } catch (e) {
      logError('GET /api/factoring/advances', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), advances: [], total: 0 });
    }
  });

  app.post('/api/factoring/advances', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const loads = parseLoadNumbers(b.load_numbers);
      const invoice = Number(b.invoice_amount || 0);
      const advance = Number(b.advance_amount || 0);
      const fee = Number.isFinite(Number(b.fee_amount)) ? Number(b.fee_amount) : (invoice - advance);
      const net = Number.isFinite(Number(b.net_amount)) ? Number(b.net_amount) : (advance - fee);
      const { rows } = await dbQuery(
        `INSERT INTO factoring_advances (
          factor_name, invoice_amount, advance_amount, fee_amount, net_amount, deposit_date, status, notes, created_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,now(),now())
        RETURNING *`,
        [
          String(b.factor_name || '').trim() || 'Unknown Factor',
          invoice,
          advance,
          fee,
          net,
          parseDateLike(b.deposit_date || '') || null,
          String(b.notes || '').trim() || null,
          maintActor(req),
        ]
      );
      const advanceRow = rows?.[0] || null;
      const advanceId = Number(advanceRow?.id || 0);
      for (const loadNo of loads) {
        await dbQuery(
          `INSERT INTO factoring_advance_loads (factoring_advance_id, load_number, invoice_number, created_at)
           VALUES ($1,$2,NULL,now())`,
          [advanceId, loadNo]
        );
      }
      return res.json({ ok: true, advance: { ...advanceRow, load_numbers: loads } });
    } catch (e) {
      logError('POST /api/factoring/advances', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/factoring/advances/:id', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid advance id' });
      const { rows: advRows } = await dbQuery('SELECT * FROM factoring_advances WHERE id = $1 LIMIT 1', [id]);
      const advance = advRows?.[0] || null;
      if (!advance) return res.status(404).json({ ok: false, error: 'Advance not found' });
      const { rows: loads } = await dbQuery('SELECT * FROM factoring_advance_loads WHERE factoring_advance_id = $1 ORDER BY id ASC', [id]);
      const { rows: bankRows } = await dbQuery(
        `SELECT bt.*
           FROM bank_txn_links l
           JOIN banking_transactions bt ON bt.id = l.txn_id
          WHERE l.entity_type = 'factoring_advance'
            AND l.entity_id = $1
          ORDER BY l.created_at DESC
          LIMIT 1`,
        [String(id)]
      );
      return res.json({ ok: true, advance, loads: loads || [], bank_txn: bankRows?.[0] || null });
    } catch (e) {
      logError('GET /api/factoring/advances/:id', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/factoring/advances/:id/link-bank-txn', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      const txnId = Number(req.body?.txn_id || 0);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(txnId) || txnId <= 0) return res.status(400).json({ ok: false, error: 'id and txn_id are required' });
      await dbQuery(
        `INSERT INTO bank_txn_links (txn_id, entity_type, entity_id, amount, link_role, created_by)
         VALUES ($1,'factoring_advance',$2,NULL,'deposit',$3)`,
        [txnId, String(id), maintActor(req)]
      );
      const { rows } = await dbQuery(
        `UPDATE factoring_advances
            SET bank_txn_id = $2,
                status = 'received',
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id, txnId]
      );
      return res.json({ ok: true, advance: rows?.[0] || null });
    } catch (e) {
      logError('POST /api/factoring/advances/:id/link-bank-txn', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/factoring/advances/:id/reconcile', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      if (!getPoolForRoute()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
      await ensureBankingTables();
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Invalid advance id' });
      const { rows: beforeRows } = await dbQuery('SELECT * FROM factoring_advances WHERE id = $1 LIMIT 1', [id]);
      const before = beforeRows?.[0] || null;
      if (!before) return res.status(404).json({ ok: false, error: 'Advance not found' });
      if (!before?.bank_txn_id) return res.status(400).json({ ok: false, error: 'Bank transaction link is required before reconcile' });
      const { rows } = await dbQuery(
        `UPDATE factoring_advances
            SET status = 'reconciled',
                updated_at = now()
          WHERE id = $1
        RETURNING *`,
        [id]
      );
      const advance = rows?.[0] || null;
      await writeAuditLog(req, {
        action: 'reconcile_factoring_advance',
        entity_type: 'factoring_advances',
        entity_id: String(id),
        before_state: before,
        after_state: advance,
        source_module: 'banking',
      });
      return res.json({ ok: true, advance });
    } catch (e) {
      logError('POST /api/factoring/advances/:id/reconcile', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/factoring/reports/reconciliation', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, rows: [], totals: {} });
      await ensureBankingTables();
      const factorName = String(req.query?.factor_name || '').trim().toLowerCase();
      const year = String(req.query?.year || '').trim();
      const month = String(req.query?.month || '').trim();
      const where = [];
      const values = [];
      if (factorName) {
        values.push(`%${factorName}%`);
        where.push(`LOWER(COALESCE(factor_name, '')) LIKE $${values.length}`);
      }
      if (/^\d{4}$/.test(year)) {
        values.push(`${year}-01-01`);
        where.push(`COALESCE(deposit_date, created_at::date) >= $${values.length}::date`);
        values.push(`${year}-12-31`);
        where.push(`COALESCE(deposit_date, created_at::date) <= $${values.length}::date`);
      }
      if (/^\d{2}$/.test(month)) {
        values.push(month);
        where.push(`to_char(COALESCE(deposit_date, created_at::date), 'MM') = $${values.length}`);
      }
      const { rows } = await dbQuery(
        `SELECT fa.id, fa.factor_name, fa.invoice_amount, fa.advance_amount, fa.fee_amount, fa.net_amount, fa.status, fa.deposit_date,
                COALESCE(string_agg(fal.load_number, ', ' ORDER BY fal.load_number), '') AS load_numbers
           FROM factoring_advances fa
      LEFT JOIN factoring_advance_loads fal ON fal.factoring_advance_id = fa.id
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY fa.id
       ORDER BY fa.deposit_date DESC NULLS LAST, fa.id DESC`,
        values
      );
      const mapped = (rows || []).map((r) => ({
        factor_name: String(r?.factor_name || '--'),
        load_numbers: String(r?.load_numbers || ''),
        invoice_amount: Number(r?.invoice_amount || 0),
        advance_amount: Number(r?.advance_amount || 0),
        fee_amount: Number(r?.fee_amount || 0),
        net_amount: Number(r?.net_amount || 0),
        status: String(r?.status || 'pending'),
        deposit_date: r?.deposit_date || null,
      }));
      const totals = mapped.reduce((acc, r) => {
        acc.total_invoiced += Number(r.invoice_amount || 0);
        acc.total_advanced += Number(r.advance_amount || 0);
        acc.total_fees += Number(r.fee_amount || 0);
        acc.total_net += Number(r.net_amount || 0);
        if (String(r.status || '').toLowerCase() === 'pending') acc.pending_count += 1;
        return acc;
      }, { total_invoiced: 0, total_advanced: 0, total_fees: 0, total_net: 0, pending_count: 0 });
      return res.json({ ok: true, rows: mapped, totals });
    } catch (e) {
      logError('GET /api/factoring/reports/reconciliation', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [], totals: {} });
    }
  });

  app.get('/api/reports/tms/factoring', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, rows: [], totals: {}, params: {} });
      await ensureBankingTables();
      const factorName = String(req.query?.factor_name || '').trim().toLowerCase();
      const year = String(req.query?.year || '').trim();
      const month = String(req.query?.month || '').trim();
      const where = [];
      const values = [];
      if (factorName) {
        values.push(`%${factorName}%`);
        where.push(`LOWER(COALESCE(factor_name, '')) LIKE $${values.length}`);
      }
      if (/^\d{4}$/.test(year)) {
        values.push(`${year}-01-01`);
        where.push(`COALESCE(deposit_date, created_at::date) >= $${values.length}::date`);
        values.push(`${year}-12-31`);
        where.push(`COALESCE(deposit_date, created_at::date) <= $${values.length}::date`);
      }
      if (/^\d{2}$/.test(month)) {
        values.push(month);
        where.push(`to_char(COALESCE(deposit_date, created_at::date), 'MM') = $${values.length}`);
      }
      const { rows } = await dbQuery(
        `SELECT fa.id, fa.factor_name, fa.invoice_amount, fa.advance_amount, fa.fee_amount, fa.net_amount, fa.status, fa.deposit_date,
                COALESCE(string_agg(fal.load_number, ', ' ORDER BY fal.load_number), '') AS load_numbers
           FROM factoring_advances fa
      LEFT JOIN factoring_advance_loads fal ON fal.factoring_advance_id = fa.id
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY fa.id
       ORDER BY fa.deposit_date DESC NULLS LAST, fa.id DESC`,
        values
      );
      const mapped = (rows || []).map((r) => ({
        factor_name: String(r?.factor_name || '--'),
        load_numbers: String(r?.load_numbers || ''),
        invoice_amount: Number(r?.invoice_amount || 0),
        advance_amount: Number(r?.advance_amount || 0),
        fee_amount: Number(r?.fee_amount || 0),
        net_amount: Number(r?.net_amount || 0),
        status: String(r?.status || 'pending'),
        deposit_date: r?.deposit_date || null,
      }));
      const totals = mapped.reduce((acc, r) => {
        acc.total_invoiced += Number(r.invoice_amount || 0);
        acc.total_advanced += Number(r.advance_amount || 0);
        acc.total_fees += Number(r.fee_amount || 0);
        acc.total_net += Number(r.net_amount || 0);
        if (String(r.status || '').toLowerCase() === 'pending') acc.pending_count += 1;
        return acc;
      }, { total_invoiced: 0, total_advanced: 0, total_fees: 0, total_net: 0, pending_count: 0 });
      return res.json({ ok: true, rows: mapped, totals, params: { factor_name: factorName || '', year, month } });
    } catch (e) {
      logError('GET /api/reports/tms/factoring', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [], totals: {}, params: {} });
    }
  });

  app.get('/api/reports/tms/load-pnl', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, rows: [], totals: {}, params: {} });
      await ensureBankingTables();
      await ensureFuelExpenseTables();
      await ensureTransactionsTable();
      const startDate = parseDateLike(req.query?.start_date || '') || '';
      const endDate = parseDateLike(req.query?.end_date || '') || '';
      const driverId = String(req.query?.driver_id || '').trim();
      const unitNumber = String(req.query?.unit_number || '').trim();
      const loadNumber = String(req.query?.load_number || '').trim();
      const txWhere = ['COALESCE(NULLIF(TRIM(load_number), \'\'), NULL) IS NOT NULL'];
      const txValues = [];
      if (startDate) {
        txValues.push(startDate);
        txWhere.push(`created_at::date >= $${txValues.length}::date`);
      }
      if (endDate) {
        txValues.push(endDate);
        txWhere.push(`created_at::date <= $${txValues.length}::date`);
      }
      const txWhereSql = txWhere.length ? `WHERE ${txWhere.join(' AND ')}` : '';
      const { rows: txRows } = await dbQuery(
        `SELECT TRIM(load_number) AS load_number,
                COALESCE(driver_id, '') AS driver_id,
                COALESCE(driver_name, '') AS driver_name,
                COALESCE(unit_number, '') AS unit_number,
                COALESCE(transaction_type, '') AS transaction_type,
                COALESCE(amount_actual, amount_estimated, 0) AS amount_value
           FROM transactions
           ${txWhereSql}`,
        txValues
      );
      const fuelWhere = ['COALESCE(NULLIF(TRIM(load_number), \'\'), NULL) IS NOT NULL'];
      const fuelValues = [];
      if (startDate) {
        fuelValues.push(startDate);
        fuelWhere.push(`COALESCE(transaction_date, submitted_at::date) >= $${fuelValues.length}::date`);
      }
      if (endDate) {
        fuelValues.push(endDate);
        fuelWhere.push(`COALESCE(transaction_date, submitted_at::date) <= $${fuelValues.length}::date`);
      }
      const { rows: fuelRows } = await dbQuery(
        `SELECT TRIM(load_number) AS load_number,
                COALESCE(unit_number, '') AS unit_number,
                COALESCE(total_amount, 0) AS total_amount
           FROM fuel_expenses
          WHERE ${fuelWhere.join(' AND ')}`,
        fuelValues
      );
      const settlementWhere = ['COALESCE(NULLIF(TRIM(dsl.load_number), \'\'), NULL) IS NOT NULL'];
      const settlementValues = [];
      if (startDate) {
        settlementValues.push(startDate);
        settlementWhere.push(`COALESCE(ds.period_end, ds.period_start) >= $${settlementValues.length}::date`);
      }
      if (endDate) {
        settlementValues.push(endDate);
        settlementWhere.push(`COALESCE(ds.period_start, ds.period_end) <= $${settlementValues.length}::date`);
      }
      const { rows: settlementRows } = await dbQuery(
        `SELECT TRIM(dsl.load_number) AS load_number,
                COALESCE(ds.driver_id, '') AS driver_id,
                COALESCE(ds.driver_name, '') AS driver_name,
                COALESCE(dsl.gross_component, 0) AS driver_pay
           FROM driver_settlement_loads dsl
           JOIN driver_settlements ds ON ds.id = dsl.settlement_id
          WHERE ${settlementWhere.join(' AND ')}`,
        settlementValues
      );

      const byLoad = new Map();
      const ensureLoad = (key) => {
        const k = String(key || '').trim();
        if (!k) return null;
        if (!byLoad.has(k)) {
          byLoad.set(k, {
            load_number: k,
            driver_id: '',
            driver: '--',
            unit: '--',
            revenue: 0,
            fuel_cost: 0,
            driver_pay: 0,
            repair_cost: 0,
            toll_cost: 0,
            lumper_cost: 0,
            other_cost: 0,
          });
        }
        return byLoad.get(k);
      };

      (txRows || []).forEach((r) => {
        const row = ensureLoad(r?.load_number);
        if (!row) return;
        const txnType = String(r?.transaction_type || '').toLowerCase();
        const amount = Number(r?.amount_value || 0);
        if (!row.driver_id && String(r?.driver_id || '').trim()) row.driver_id = String(r.driver_id).trim();
        if (row.driver === '--' && String(r?.driver_name || '').trim()) row.driver = String(r.driver_name).trim();
        if (row.unit === '--' && String(r?.unit_number || '').trim()) row.unit = String(r.unit_number).trim();
        if (txnType.includes('revenue') || txnType.includes('invoice') || txnType.includes('freight')) {
          row.revenue += amount;
        } else if (txnType.includes('repair') || txnType.includes('maintenance') || txnType.includes('work')) {
          row.repair_cost += Math.abs(amount);
        } else if (txnType.includes('toll')) {
          row.toll_cost += Math.abs(amount);
        } else if (txnType.includes('lumper')) {
          row.lumper_cost += Math.abs(amount);
        } else if (amount < 0) {
          row.other_cost += Math.abs(amount);
        }
      });
      (fuelRows || []).forEach((r) => {
        const row = ensureLoad(r?.load_number);
        if (!row) return;
        row.fuel_cost += Number(r?.total_amount || 0);
        if (row.unit === '--' && String(r?.unit_number || '').trim()) row.unit = String(r.unit_number).trim();
      });
      (settlementRows || []).forEach((r) => {
        const row = ensureLoad(r?.load_number);
        if (!row) return;
        row.driver_pay += Number(r?.driver_pay || 0);
        if (!row.driver_id && String(r?.driver_id || '').trim()) row.driver_id = String(r.driver_id).trim();
        if (row.driver === '--' && String(r?.driver_name || '').trim()) row.driver = String(r.driver_name).trim();
      });

      const mapped = Array.from(byLoad.values())
        .filter((r) => !driverId || String(r.driver_id || '').toLowerCase() === driverId.toLowerCase())
        .filter((r) => !unitNumber || String(r.unit || '').toLowerCase() === unitNumber.toLowerCase())
        .filter((r) => !loadNumber || String(r.load_number || '').toLowerCase() === loadNumber.toLowerCase())
        .map((r) => {
        const revenue = Number(r?.revenue || 0);
        const fuelCost = Number(r?.fuel_cost || 0);
        const driverPay = Number(r?.driver_pay || 0);
        const repairCost = Number(r?.repair_cost || 0);
        const tollCost = Number(r?.toll_cost || 0);
        const lumperCost = Number(r?.lumper_cost || 0);
        const otherCost = Number(r?.other_cost || 0);
        const grossProfit = revenue - (fuelCost + driverPay + repairCost + tollCost + lumperCost + otherCost);
        const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
          return {
            load_number: String(r?.load_number || ''),
            driver: String(r?.driver || '--'),
            unit: String(r?.unit || '--'),
            revenue,
            fuel_cost: fuelCost,
            driver_pay: driverPay,
            repair_cost: repairCost,
            toll_cost: tollCost,
            lumper_cost: lumperCost,
            other_cost: otherCost,
            gross_profit: grossProfit,
            profit_margin_pct: Number.isFinite(marginPct) ? Math.round(marginPct * 100) / 100 : 0,
          };
        })
        .sort((a, b) => String(b.load_number || '').localeCompare(String(a.load_number || '')));
      const totals = mapped.reduce((acc, r) => {
        acc.revenue += Number(r.revenue || 0);
        acc.fuel_cost += Number(r.fuel_cost || 0);
        acc.driver_pay += Number(r.driver_pay || 0);
        acc.repair_cost += Number(r.repair_cost || 0);
        acc.toll_cost += Number(r.toll_cost || 0);
        acc.lumper_cost += Number(r.lumper_cost || 0);
        acc.other_cost += Number(r.other_cost || 0);
        acc.gross_profit += Number(r.gross_profit || 0);
        return acc;
      }, {
        revenue: 0,
        fuel_cost: 0,
        driver_pay: 0,
        repair_cost: 0,
        toll_cost: 0,
        lumper_cost: 0,
        other_cost: 0,
        gross_profit: 0,
        profit_margin_pct: 0,
      });
      totals.profit_margin_pct = totals.revenue > 0 ? Math.round((totals.gross_profit / totals.revenue) * 10000) / 100 : 0;
      return res.json({
        ok: true,
        rows: mapped,
        totals,
        params: { start_date: startDate, end_date: endDate, driver_id: driverId, unit_number: unitNumber, load_number: loadNumber },
      });
    } catch (e) {
      logError('GET /api/reports/tms/load-pnl', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [], totals: {}, params: {} });
    }
  });

  app.get('/api/reports/tms/fuel-ifta', async (req, res) => {
    try {
      if (!getPoolForRoute()) {
        return res.json({ ok: true, quarter: null, year: null, unit_number: String(req.query?.unit_number || '').trim(), rows: [], totals: { miles: 0, gallons: 0, tax: 0 } });
      }
      await ensureFuelExpenseTables();
      const now = new Date();
      const qIn = Number(req.query?.quarter || 0);
      const yIn = Number(req.query?.year || 0);
      const quarter = Number.isFinite(qIn) && qIn >= 1 && qIn <= 4 ? qIn : Math.floor(now.getUTCMonth() / 3) + 1;
      const year = Number.isFinite(yIn) && yIn >= 2000 ? yIn : now.getUTCFullYear();
      const unitNumber = String(req.query?.unit_number || '').trim();
      const startMonth = (quarter - 1) * 3;
      const start = new Date(Date.UTC(year, startMonth, 1));
      const end = new Date(Date.UTC(year, startMonth + 3, 1));
      const where = ['submitted_at >= $1', 'submitted_at < $2'];
      const values = [start.toISOString(), end.toISOString()];
      if (unitNumber) {
        values.push(unitNumber);
        where.push(`unit_number = $${values.length}`);
      }
      const { rows } = await dbQueryForRoute(
        `SELECT
            COALESCE(NULLIF(TRIM(state), ''), 'UNK') AS state,
            SUM(COALESCE(miles_this_load, 0))::numeric AS miles,
            SUM(COALESCE(gallons, 0))::numeric AS gallons
          FROM fuel_expenses
         WHERE ${where.join(' AND ')}
         GROUP BY 1
         ORDER BY 1 ASC`,
        values
      );
      const taxRate = 0.24;
      const mapped = (rows || []).map((r) => {
        const miles = Number(r?.miles || 0);
        const gallons = Number(r?.gallons || 0);
        const mpg = gallons > 0 ? miles / gallons : 0;
        const tax = gallons * taxRate;
        return {
          state: String(r?.state || 'UNK'),
          miles,
          gallons,
          mpg: Number.isFinite(mpg) ? Math.round(mpg * 100) / 100 : 0,
          tax: Number.isFinite(tax) ? Math.round(tax * 100) / 100 : 0,
        };
      });
      const totals = mapped.reduce((acc, r) => {
        acc.miles += Number(r.miles || 0);
        acc.gallons += Number(r.gallons || 0);
        acc.tax += Number(r.tax || 0);
        return acc;
      }, { miles: 0, gallons: 0, tax: 0 });
      return res.json({ ok: true, quarter, year, unit_number: unitNumber || null, rows: mapped, totals });
    } catch (e) {
      logError('GET /api/reports/tms/fuel-ifta', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), rows: [], totals: { miles: 0, gallons: 0, tax: 0 } });
    }
  });

  app.get('/api/reports/banking/by-account', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, accounts: [], transactions: [], totals: {} });
      await ensureBankingTables();
      const startDate = parseDateLike(req.query?.start_date || '') || '';
      const endDate = parseDateLike(req.query?.end_date || '') || '';
      const accountId = String(req.query?.account_id || '').trim();
      const where = [];
      const values = [];
      if (startDate) {
        values.push(startDate);
        where.push(`txn_date >= $${values.length}::date`);
      }
      if (endDate) {
        values.push(endDate);
        where.push(`txn_date <= $${values.length}::date`);
      }
      if (accountId) {
        values.push(accountId);
        where.push(`account_id = $${values.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: accountRows } = await dbQuery(
        `SELECT account_id,
                MAX(account_name) AS account_name,
                COUNT(*)::int AS txn_count,
                COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::numeric AS deposits,
                COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::numeric AS withdrawals,
                COALESCE(SUM(amount), 0)::numeric AS net
           FROM banking_transactions
           ${whereSql}
          GROUP BY account_id
          ORDER BY MAX(account_name) ASC`,
        values
      );
      const { rows: txnRows } = await dbQuery(
        `SELECT id, account_id, account_name, txn_date, description, amount, status, category, source, reconciled
           FROM banking_transactions
           ${whereSql}
          ORDER BY txn_date DESC, id DESC
          LIMIT 5000`,
        values
      );
      const accounts = (accountRows || []).map((r) => ({
        account_id: String(r?.account_id || ''),
        account_name: String(r?.account_name || r?.account_id || ''),
        txn_count: Number(r?.txn_count || 0),
        deposits: Number(r?.deposits || 0),
        withdrawals: Number(r?.withdrawals || 0),
        net: Number(r?.net || 0),
      }));
      const transactions = (txnRows || []).map((r) => ({
        id: Number(r?.id || 0),
        account_id: String(r?.account_id || ''),
        account_name: String(r?.account_name || r?.account_id || ''),
        txn_date: String(r?.txn_date || '').slice(0, 10),
        description: String(r?.description || ''),
        amount: Number(r?.amount || 0),
        status: String(r?.status || ''),
        category: String(r?.category || ''),
        source: String(r?.source || ''),
        reconciled: Boolean(r?.reconciled),
      }));
      const totals = accounts.reduce((acc, r) => {
        acc.accounts += 1;
        acc.txn_count += Number(r.txn_count || 0);
        acc.deposits += Number(r.deposits || 0);
        acc.withdrawals += Number(r.withdrawals || 0);
        acc.net += Number(r.net || 0);
        return acc;
      }, { accounts: 0, txn_count: 0, deposits: 0, withdrawals: 0, net: 0 });
      return res.json({ ok: true, accounts, transactions, totals, params: { start_date: startDate, end_date: endDate, account_id: accountId } });
    } catch (e) {
      logError('GET /api/reports/banking/by-account', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), accounts: [], transactions: [], totals: {} });
    }
  });

  app.post('/api/banking/reconcile', async (req, res) => {
    try {
      if (!requireBankingWriteRole(req, res)) return;
      await ensureBankingTables();
      const accountId = String(req.body?.account_id || '').trim();
      const month = String(req.body?.month || '').trim();
      if (!accountId || !month) return res.status(400).json({ ok: false, error: 'account_id and month are required' });
      const { rows: beforeRows } = await dbQuery(
        `SELECT id, account_id, txn_date, reconciled
           FROM banking_transactions
          WHERE account_id = $1 AND txn_date >= $2::date AND txn_date <= $3::date
          ORDER BY id ASC`,
        [accountId, `${month}-01`, `${month}-31`]
      );
      await dbQuery(
        `UPDATE banking_transactions
            SET reconciled = true, updated_at = now()
          WHERE account_id = $1 AND txn_date >= $2::date AND txn_date <= $3::date`,
        [accountId, `${month}-01`, `${month}-31`]
      );
      const { rows: afterRows } = await dbQuery(
        `SELECT id, account_id, txn_date, reconciled
           FROM banking_transactions
          WHERE account_id = $1 AND txn_date >= $2::date AND txn_date <= $3::date
          ORDER BY id ASC`,
        [accountId, `${month}-01`, `${month}-31`]
      );
      await writeAuditLog(req, {
        action: 'update',
        entity_type: 'banking_transactions',
        entity_id: `${accountId}:${month}`,
        before_state: { count: beforeRows.length, rows: beforeRows },
        after_state: { count: afterRows.length, rows: afterRows },
        source_module: 'banking',
      });
      return res.json({ ok: true });
    } catch (e) {
      logError('POST /api/banking/reconcile', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/reports/ifta', async (req, res) => {
    try {
      if (!getPoolForRoute()) {
        return res.json({
          ok: true,
          quarter: null,
          year: null,
          tax_rate: null,
          rows: [],
          totals: { miles: 0, gallons: 0, tax_owed: 0, tax_credit: 0 },
        });
      }
      await ensureFuelExpenseTables();
      const now = new Date();
      const qIn = Number(req.query?.quarter || 0);
      const yIn = Number(req.query?.year || 0);
      const quarter = Number.isFinite(qIn) && qIn >= 1 && qIn <= 4 ? qIn : Math.floor(now.getUTCMonth() / 3) + 1;
      const year = Number.isFinite(yIn) && yIn >= 2000 ? yIn : now.getUTCFullYear();
      const taxRate = Number.isFinite(Number(req.query?.tax_rate)) ? Number(req.query.tax_rate) : 0.24;
      const startMonth = (quarter - 1) * 3;
      const start = new Date(Date.UTC(year, startMonth, 1));
      const end = new Date(Date.UTC(year, startMonth + 3, 1));
      const { rows } = await dbQueryForRoute(
        `SELECT
            COALESCE(NULLIF(TRIM(unit_number), ''), '—') AS unit_number,
            COALESCE(NULLIF(TRIM(state), ''), 'UNK') AS state,
            SUM(COALESCE(miles_this_load, 0))::numeric AS miles,
            SUM(COALESCE(gallons, 0))::numeric AS gallons
          FROM fuel_expenses
          WHERE submitted_at >= $1
            AND submitted_at < $2
          GROUP BY 1, 2
          ORDER BY 1 ASC, 2 ASC`,
        [start.toISOString(), end.toISOString()]
      );
      const reportRows = (rows || []).map((r) => {
        const miles = Number(r?.miles || 0);
        const gallons = Number(r?.gallons || 0);
        const mpg = gallons > 0 ? miles / gallons : 0;
        const tax = gallons * taxRate;
        return {
          unit_number: String(r?.unit_number || '—'),
          state: String(r?.state || 'UNK'),
          miles: Number.isFinite(miles) ? miles : 0,
          gallons: Number.isFinite(gallons) ? gallons : 0,
          mpg: Number.isFinite(mpg) ? Math.round(mpg * 100) / 100 : 0,
          tax_owed: Number.isFinite(tax) && tax > 0 ? Math.round(tax * 100) / 100 : 0,
          tax_credit: 0,
        };
      });
      const totals = reportRows.reduce((acc, row) => {
        acc.miles += Number(row.miles || 0);
        acc.gallons += Number(row.gallons || 0);
        acc.tax_owed += Number(row.tax_owed || 0);
        acc.tax_credit += Number(row.tax_credit || 0);
        return acc;
      }, { miles: 0, gallons: 0, tax_owed: 0, tax_credit: 0 });

      if (String(req.query?.format || '').toLowerCase() === 'csv') {
        const csv = [
          'unit_number,state,miles,gallons,mpg,tax_owed,tax_credit',
          ...reportRows.map((r) => [r.unit_number, r.state, r.miles, r.gallons, r.mpg, r.tax_owed, r.tax_credit].join(',')),
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        return res.status(200).send(csv);
      }
      return res.json({ ok: true, quarter, year, tax_rate: taxRate, rows: reportRows, totals });
    } catch (e) {
      logError('GET /api/reports/ifta', e);
      return res.status(500).json({
        ok: false,
        error: e?.message || String(e),
        rows: [],
        totals: { miles: 0, gallons: 0, tax_owed: 0, tax_credit: 0 },
      });
    }
  });

  app.get('/api/reports/audit-log', async (req, res) => {
    try {
      if (!getPoolForRoute()) return res.json({ ok: true, data: [], count: 0 });
      await ensureAuditLogTable();
      const moduleKey = String(req.query?.module || '').trim().toLowerCase();
      const actor = String(req.query?.actor || '').trim();
      const action = String(req.query?.action || '').trim();
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
      const where = [];
      const values = [];
      if (moduleKey) {
        values.push(moduleKey === 'form 425c' || moduleKey === 'form_425c' ? 'form_425c' : moduleKey);
        where.push(`LOWER(COALESCE(source_module, '')) = $${values.length}`);
      }
      if (actor) {
        values.push(actor);
        where.push(`actor = $${values.length}`);
      }
      if (action) {
        values.push(action);
        where.push(`action = $${values.length}`);
      }
      values.push(limit);
      const sql = `SELECT id, actor, action, entity_type, entity_id, before_state, after_state, source_module, created_at
                     FROM audit_log
                     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                    ORDER BY created_at DESC
                    LIMIT $${values.length}`;
      const { rows } = await dbQueryForRoute(sql, values);
      return res.json({ ok: true, data: rows || [], count: Number(rows?.length || 0) });
    } catch (e) {
      logError('GET /api/reports/audit-log', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), data: [], count: 0 });
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

  app.get('/api/erp/company-profile', (_req, res) => {
    try {
      const erp = readFullErpJson();
      const cp = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
      res.json({ ok: true, companyProfile: { ...cp } });
    } catch (e) {
      logError('GET /api/erp/company-profile', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.patch('/api/erp/company-profile', (req, res) => {
    try {
      const erp = readFullErpJson();
      if (!erp.companyProfile || typeof erp.companyProfile !== 'object') erp.companyProfile = {};
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const str = (k) => (body[k] != null ? String(body[k]).trim() : undefined);
      const assign = (k, v) => {
        if (v !== undefined) erp.companyProfile[k] = v;
      };
      assign('legalName', str('legalName'));
      assign('dbaName', str('dbaName'));
      assign('usdotNumber', str('usdotNumber'));
      assign('mcNumber', str('mcNumber'));
      assign('street', str('street'));
      assign('city', str('city'));
      assign('state', str('state'));
      assign('zip', str('zip'));
      assign('phone', str('phone'));
      assign('email', str('email'));
      assign('iftaAccountNumber', str('iftaAccountNumber'));
      assign('stateOfOperations', str('stateOfOperations'));
      assign('randomDrugTestRateNote', str('randomDrugTestRateNote'));
      if (body.pmIntervalMiles !== undefined) {
        const n = Number(body.pmIntervalMiles);
        if (Number.isFinite(n) && n > 0) erp.companyProfile.pmIntervalMiles = Math.round(n);
        else delete erp.companyProfile.pmIntervalMiles;
      }
      writeFullErpJson(erp);
      res.json({ ok: true, companyProfile: { ...erp.companyProfile } });
    } catch (e) {
      logError('PATCH /api/erp/company-profile', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
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

  app.get('/api/maintenance/service-interval-catalog', async (_req, res) => {
    try {
      if (!getPool()) {
        return res.json({ ok: true, services: [], source: 'no-db' });
      }
      await ensureFleetCatalogSeedRows(logError);
      const { rows } = await dbQuery(
        `SELECT name, interval_miles, interval_months, category, slug FROM service_types ORDER BY name ASC`
      );
      return res.json({ ok: true, services: rows || [], source: 'postgres' });
    } catch (e) {
      logError('GET /api/maintenance/service-interval-catalog', e);
      return res.json({ ok: true, services: [], source: 'error' });
    }
  });

  function normSvcToken(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  app.get('/api/units/:unitId/service-history/:serviceType', async (req, res) => {
    try {
      const unitId = decodeURIComponent(String(req.params.unitId || '').trim());
      const serviceType = decodeURIComponent(String(req.params.serviceType || '').trim());
      if (!unitId || !serviceType) {
        return res.status(400).json({ ok: false, error: 'unitId and serviceType are required' });
      }
      const want = normSvcToken(serviceType);
      const full = readFullErpJson();
      const records = Array.isArray(full.records) ? full.records : [];
      let best = null;
      let bestKey = '';
      for (const r of records) {
        const u = String(r.unit || '').trim();
        if (u !== unitId) continue;
        const st = normSvcToken(r.serviceType || '');
        if (!st || !(st === want || st.includes(want) || want.includes(st))) continue;
        const d = String(r.serviceDate || r.createdAt || '').slice(0, 10);
        const key = `${d}\t${String(r.createdAt || r.updatedAt || '')}`;
        if (!best || key > bestKey) {
          best = r;
          bestKey = key;
        }
      }
      const lastDate = best ? String(best.serviceDate || best.createdAt || '').slice(0, 10) || null : null;
      const lastMileageRaw = best != null ? Number(best.serviceMileage ?? best.miles ?? best.odometer ?? NaN) : NaN;
      const lastMileage = Number.isFinite(lastMileageRaw) ? lastMileageRaw : null;

      let intervalMiles = null;
      let intervalMonths = null;
      if (getPool()) {
        try {
          await ensureFleetCatalogSeedRows(logError);
          const { rows } = await dbQuery(
            `SELECT interval_miles, interval_months FROM service_types
              WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1`,
            [serviceType]
          );
          if (rows?.[0]) {
            intervalMiles = rows[0].interval_miles != null ? Number(rows[0].interval_miles) : null;
            intervalMonths = rows[0].interval_months != null ? Number(rows[0].interval_months) : null;
          }
          if (intervalMiles == null) {
            const { rows: r2 } = await dbQuery(
              `SELECT interval_miles, interval_months FROM service_types
                WHERE lower(name) LIKE '%' || lower($1) || '%' ORDER BY length(name) ASC LIMIT 1`,
              [serviceType]
            );
            if (r2?.[0]) {
              intervalMiles = r2[0].interval_miles != null ? Number(r2[0].interval_miles) : null;
              intervalMonths = r2[0].interval_months != null ? Number(r2[0].interval_months) : null;
            }
          }
        } catch (_) {
          /* keep defaults */
        }
      }
      if (intervalMiles == null || !Number.isFinite(intervalMiles) || intervalMiles <= 0) intervalMiles = 25000;
      if (intervalMonths == null || !Number.isFinite(intervalMonths) || intervalMonths <= 0) intervalMonths = 2;

      const fleetAvg = getPool() ? await getFleetAvgMilesPerMonth(dbQuery).catch(() => 12000) : 12000;
      const curQ = req.query?.currentMiles;
      const currentMiles =
        curQ != null && String(curQ).trim() !== '' && Number.isFinite(Number(curQ)) ? Number(curQ) : null;

      let nextDueMiles = null;
      if (lastMileage != null && Number.isFinite(lastMileage)) {
        nextDueMiles = Math.round(lastMileage + intervalMiles);
      }
      let milesRemaining = null;
      if (nextDueMiles != null && currentMiles != null && Number.isFinite(currentMiles)) {
        milesRemaining = Math.round(nextDueMiles - currentMiles);
      }
      let estimatedNextDate = null;
      let status = 'unknown';
      if (milesRemaining != null) {
        if (milesRemaining < 0) {
          status = 'overdue';
          estimatedNextDate = 'OVERDUE';
        } else if (milesRemaining <= 2000) {
          status = 'amber';
          const days = Math.max(1, Math.round((milesRemaining / Math.max(1000, fleetAvg)) * 30));
          const dt = new Date();
          dt.setDate(dt.getDate() + days);
          estimatedNextDate = dt.toISOString().slice(0, 10);
        } else {
          status = 'ok';
          const days = Math.max(1, Math.round((milesRemaining / Math.max(1000, fleetAvg)) * 30));
          const dt = new Date();
          dt.setDate(dt.getDate() + days);
          estimatedNextDate = dt.toISOString().slice(0, 10);
        }
      }

      return res.json({
        ok: true,
        unitId,
        serviceType,
        lastDate,
        lastMileage,
        intervalMiles,
        intervalMonths,
        nextDueMiles,
        milesRemaining,
        estimatedNextDate,
        status,
        fleetAvgMilesPerMonth: fleetAvg
      });
    } catch (e) {
      logError('GET /api/units/:unitId/service-history/:serviceType', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/samsara/vehicles', async (_req, res) => {
    try {
      const assets = await getMergedFleetAssetProfiles(logError);
      return res.json({ ok: true, vehicles: assets, count: assets.length });
    } catch (e) {
      logError('GET /api/samsara/vehicles', e);
      return res.json({ ok: true, vehicles: [], count: 0, error: e?.message || String(e) });
    }
  });

  app.get('/api/samsara/drivers', async (_req, res) => {
    try {
      const drivers = await fetchSamsaraDriversNormalized({ limit: 400 });
      return res.json({ ok: true, drivers, count: drivers.length });
    } catch (e) {
      logError('GET /api/samsara/drivers', e);
      return res.json({ ok: true, drivers: [], count: 0, error: e?.message || String(e) });
    }
  });

  app.post('/api/fleet/sync-from-samsara', async (req, res) => {
    if (!getPool()) {
      if (String(process.env.IH35_SMOKE_GATE || '').trim() === '1') {
        return res.status(200).json({ ok: true, saved: 0, updated: 0, errors: [], smokeProbeNoDb: true });
      }
      return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set', saved: 0, updated: 0, errors: [] });
    }
    try {
      await ensureDriverSchedulerTables();
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const assets = Array.isArray(body.assets) ? body.assets : [];
      const drivers = Array.isArray(body.drivers) ? body.drivers : [];
      let saved = 0;
      let updated = 0;
      const errors = [];

      for (const a of assets) {
        const sid = String(a.samsara_id || a.samsaraId || a.id || '').trim();
        if (!sid) continue;
        const unit = String(a.unit_number || a.unitNumber || '').trim() || null;
        const assetType = String(a.asset_type || a.assetType || '').trim() || 'Truck';
        const status = String(a.status || 'Active').trim() || 'Active';
        const vin = String(a.vin || a.vin_override || '').trim() || null;
        const plate = String(a.license_plate || a.licensePlate || a.license_plate_override || '').trim() || null;
        const year = a.year != null && a.year !== '' ? Number(a.year) : null;
        const make = String(a.make || a.make_override || '').trim() || null;
        const model = String(a.model || a.model_override || '').trim() || null;
        try {
          const ex = await dbQuery('SELECT 1 FROM fleet_assets WHERE samsara_id = $1 LIMIT 1', [sid]);
          const existed = (ex.rows || []).length > 0;
          await dbQuery(
            `INSERT INTO fleet_assets (samsara_id, unit_number, asset_type, status, vin_override, license_plate_override, year_override, make_override, model_override, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
             ON CONFLICT (samsara_id) DO UPDATE SET
               unit_number = COALESCE(EXCLUDED.unit_number, fleet_assets.unit_number),
               asset_type = COALESCE(NULLIF(EXCLUDED.asset_type, ''), fleet_assets.asset_type),
               status = COALESCE(NULLIF(EXCLUDED.status, ''), fleet_assets.status),
               vin_override = COALESCE(EXCLUDED.vin_override, fleet_assets.vin_override),
               license_plate_override = COALESCE(EXCLUDED.license_plate_override, fleet_assets.license_plate_override),
               year_override = COALESCE(EXCLUDED.year_override, fleet_assets.year_override),
               make_override = COALESCE(EXCLUDED.make_override, fleet_assets.make_override),
               model_override = COALESCE(EXCLUDED.model_override, fleet_assets.model_override),
               updated_at = now()`,
            [sid, unit, assetType, status, vin, plate, Number.isFinite(year) ? year : null, make, model]
          );
          if (existed) updated += 1;
          else saved += 1;
        } catch (e) {
          errors.push({ kind: 'asset', samsara_id: sid, error: e?.message || String(e) });
        }
      }

      for (const d of drivers) {
        const sid = String(d.samsara_driver_id || d.samsaraDriverId || d.id || '').trim();
        if (!sid) continue;
        const fullName = String(d.name || d.full_name || d.fullName || '').trim() || sid;
        const license = String(d.license_number || d.licenseNumber || '').trim() || null;
        const cdlState = String(d.license_state || d.licenseState || '').trim() || null;
        const phone = String(d.phone || '').trim() || null;
        const email = String(d.email || '').trim() || null;
        try {
          const up = await dbQuery(
            `UPDATE driver_profiles SET
               full_name = COALESCE($2, full_name),
               license_number = COALESCE($3, license_number),
               cdl_state = COALESCE($4, cdl_state),
               phone = COALESCE($5, phone),
               email = COALESCE($6, email),
               status = COALESCE(NULLIF($7, ''), status),
               updated_at = now()
             WHERE samsara_driver_id = $1`,
            [sid, fullName, license, cdlState, phone, email, 'Active']
          );
          if (Number(up.rowCount || 0) > 0) {
            updated += 1;
            continue;
          }
          await dbQuery(
            `INSERT INTO driver_profiles (full_name, samsara_driver_id, license_number, cdl_state, phone, email, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,'Active', now(), now())`,
            [fullName, sid, license, cdlState, phone, email]
          );
          saved += 1;
        } catch (e) {
          errors.push({ kind: 'driver', samsara_driver_id: sid, error: e?.message || String(e) });
        }
      }

      return res.json({ ok: true, saved, updated, errors });
    } catch (e) {
      logError('POST /api/fleet/sync-from-samsara', e);
      return res.status(500).json({ ok: false, error: e?.message || String(e), saved: 0, updated: 0, errors: [] });
    }
  });
}
