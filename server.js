import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { dbQuery } from './lib/db.mjs';
import tmsRouter from './routes/tms.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3400;

const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN || '';
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';
const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || '';

const INTUIT_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_API_BASE = 'https://quickbooks.api.intuit.com';

const PERSIST_DIR = '/var/data';
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = fs.existsSync(PERSIST_DIR) ? PERSIST_DIR : LOCAL_DATA_DIR;

const ERP_FILE = path.join(DATA_DIR, 'maintenance.json');
const QBO_FILE = path.join(DATA_DIR, 'qbo_tokens.json');

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function logError(label, error) {
  console.error(`\n[${label}]`);
  console.error(error?.stack || error?.message || error);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeName(value, fallback = 'Unnamed') {
  return String(value || fallback).trim().slice(0, 180);
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseUnitNumber(name) {
  const m = String(name || '').match(/^T(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function byVehicleName(a, b) {
  const pa = parseUnitNumber(a.name || a.unit);
  const pb = parseUnitNumber(b.name || b.unit);
  if (pa != null && pb != null) return pa - pb;
  return String(a.name || a.unit || '').localeCompare(String(b.name || b.unit || ''));
}

function defaultErpData() {
  return {
    currentMileage: {},
    legacyRecords: [],
    workOrders: [],
    apTransactions: [],
    paymentMethods: [
      { id: 'pm_cash', name: 'Cash', qboType: 'Cash' },
      { id: 'pm_check', name: 'Check', qboType: 'Check' },
      { id: 'pm_creditcard', name: 'Credit Card', qboType: 'CreditCard' },
      { id: 'pm_other', name: 'Other', qboType: 'Other' },
      { id: 'pm_vendorcredit', name: 'Vendor Credit / Terms', qboType: 'Other' }
    ],
    qboCache: {
      vendors: [],
      items: [],
      accounts: [],
      accountsExpense: [],
      accountsIncome: [],
      customers: [],
      refreshedAt: ''
    }
  };
}

function ensureErpFile() {
  ensureDataDir();
  if (!fs.existsSync(ERP_FILE)) {
    fs.writeFileSync(ERP_FILE, JSON.stringify(defaultErpData(), null, 2));
    return;
  }

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
  } catch {
    existing = {};
  }

  const merged = { ...defaultErpData(), ...existing };

  if (!merged.currentMileage) merged.currentMileage = {};
  if (!Array.isArray(merged.legacyRecords)) merged.legacyRecords = [];
  if (!Array.isArray(merged.workOrders)) merged.workOrders = [];
  if (!Array.isArray(merged.apTransactions)) merged.apTransactions = [];
  if (!Array.isArray(merged.paymentMethods)) merged.paymentMethods = defaultErpData().paymentMethods;
  if (!merged.qboCache) merged.qboCache = defaultErpData().qboCache;
  if (!Array.isArray(merged.qboCache.vendors)) merged.qboCache.vendors = [];
  if (!Array.isArray(merged.qboCache.items)) merged.qboCache.items = [];
  if (!Array.isArray(merged.qboCache.accounts)) merged.qboCache.accounts = [];
  if (!Array.isArray(merged.qboCache.accountsExpense)) merged.qboCache.accountsExpense = [];
  if (!Array.isArray(merged.qboCache.accountsIncome)) merged.qboCache.accountsIncome = [];
  if (!Array.isArray(merged.qboCache.customers)) merged.qboCache.customers = [];

  fs.writeFileSync(ERP_FILE, JSON.stringify(merged, null, 2));
}

function ensureQboFile() {
  ensureDataDir();
  if (!fs.existsSync(QBO_FILE)) {
    fs.writeFileSync(QBO_FILE, JSON.stringify({ state: '', tokens: null }, null, 2));
  }
}

function readErp() {
  ensureErpFile();
  return JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
}

function writeErp(data) {
  ensureErpFile();
  fs.writeFileSync(ERP_FILE, JSON.stringify(data, null, 2));
}

function readQbo() {
  ensureQboFile();
  return JSON.parse(fs.readFileSync(QBO_FILE, 'utf8'));
}

function writeQbo(data) {
  ensureQboFile();
  fs.writeFileSync(QBO_FILE, JSON.stringify(data, null, 2));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${raw.slice(0, 300)}`);
  }

  if (!response.ok) {
    const msg =
      data?.Fault?.Error?.[0]?.Message ||
      data?.Fault?.Error?.[0]?.Detail ||
      data?.message ||
      data?.error ||
      response.statusText ||
      'Request failed';
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function samsaraHeaders() {
  return {
    Authorization: `Bearer ${SAMSARA_API_TOKEN}`,
    Accept: 'application/json'
  };
}

function assetCategoryForVehicle(v) {
  const text = `${v.name || ''} ${v.make || ''} ${v.model || ''} ${v.notes || ''}`.toLowerCase();
  if (text.includes('reefer') || text.includes('refrigerated')) return 'Refrigerated Vans';
  if (text.includes('flatbed') || text.includes('step deck') || text.includes('drop deck')) return 'Flatbeds';
  if (text.includes('dry van')) return 'Dry Vans';
  if (
    text.includes('pickup') ||
    text.includes('suv') ||
    text.includes('company vehicle') ||
    text.includes('car') ||
    text.includes('silverado') ||
    text.includes('f-150')
  ) return 'Company Vehicles';
  return 'Trucks';
}

function isTrackedAsset(v) {
  const unitNum = parseUnitNumber(v.name);
  const inTruckRange = unitNum !== null && unitNum >= 120 && unitNum <= 177;
  const text = `${v.name || ''} ${v.make || ''} ${v.model || ''} ${v.notes || ''}`.toLowerCase();

  return (
    inTruckRange ||
    text.includes('reefer') ||
    text.includes('refrigerated') ||
    text.includes('flatbed') ||
    text.includes('step deck') ||
    text.includes('drop deck') ||
    text.includes('dry van') ||
    text.includes('pickup') ||
    text.includes('company vehicle')
  );
}

function vehicleIdOf(entry) {
  return String(
    entry?.id ||
    entry?.vehicleId ||
    entry?.vehicle?.id ||
    entry?.vehicle?.ids?.samsaraId ||
    entry?.ids?.samsaraId ||
    entry?.entityId ||
    ''
  );
}

function getVehicleStatRows(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function readOdometerMilesFromStatsRow(row) {
  const obdMeters = safeNum(row?.obdOdometerMeters?.value ?? row?.obdOdometerMeters ?? null, null);
  const gpsMeters = safeNum(
    row?.gpsOdometerMeters?.value ??
      row?.gpsOdometerMeters ??
      row?.syntheticOdometerMeters?.value ??
      row?.syntheticOdometerMeters ??
      null,
    null
  );
  const meters = obdMeters ?? gpsMeters ?? null;
  return meters != null ? Math.round(meters * 0.000621371) : null;
}

function readFuelPercentFromStatsRow(row) {
  const pct = safeNum(
    row?.fuelPercent?.percent ??
      row?.fuelPercents?.percent ??
      row?.fuelPercent ??
      row?.fuelPercents ??
      null,
    null
  );
  return pct != null ? Math.round(pct) : null;
}

function mergeVehiclesWithStats(vehicles, statsRows = []) {
  const statsByVehicleId = new Map();

  for (const row of statsRows) {
    const vehicleId = vehicleIdOf(row);
    if (!vehicleId) continue;

    const prev = statsByVehicleId.get(vehicleId) || {};
    const next = {
      ...prev,
      row,
      odometerMiles: readOdometerMilesFromStatsRow(row) ?? prev.odometerMiles ?? null,
      fuelPercent: readFuelPercentFromStatsRow(row) ?? prev.fuelPercent ?? null,
      latitude: safeNum(row?.gps?.latitude ?? row?.location?.latitude ?? prev.latitude ?? null, null),
      longitude: safeNum(row?.gps?.longitude ?? row?.location?.longitude ?? prev.longitude ?? null, null),
      engineState:
        row?.engineState?.value ??
        row?.engineStates?.value ??
        row?.engineState ??
        row?.engineStates ??
        prev.engineState ??
        '',
      updatedAt:
        row?.time ||
        row?.gps?.time ||
        row?.obdOdometerMeters?.time ||
        row?.gpsOdometerMeters?.time ||
        prev.updatedAt ||
        ''
    };

    statsByVehicleId.set(vehicleId, next);
  }

  return vehicles.map(v => {
    const vehicleId = String(v.id || v.vehicleId || v.ids?.samsaraId || '');
    const stat = statsByVehicleId.get(vehicleId) || {};

    return {
      ...v,
      assetCategory: assetCategoryForVehicle(v),
      odometerMiles: stat.odometerMiles ?? null,
      fuelPercent: stat.fuelPercent ?? null,
      latitude: stat.latitude ?? null,
      longitude: stat.longitude ?? null,
      engineState: stat.engineState || '',
      liveStatsUpdatedAt: stat.updatedAt || ''
    };
  });
}

async function fetchVehiclesSafely() {
  try {
    const payload = await fetchJson('https://api.samsara.com/fleet/vehicles', { headers: samsaraHeaders() });
    return Array.isArray(payload?.data) ? payload.data : [];
  } catch (error) {
    logError('fetchVehiclesSafely', error);
    return [];
  }
}

async function fetchVehicleStatsCurrentSafely() {
  try {
    // Samsara limits this endpoint to 4 stat types per request.
    const url =
      'https://api.samsara.com/fleet/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters,fuelPercents,gps';
    const payload = await fetchJson(url, { headers: samsaraHeaders() });
    return getVehicleStatRows(payload);
  } catch (error) {
    logError('fetchVehicleStatsCurrentSafely', error);
    return [];
  }
}

function flattenWorkOrderLines(workOrder) {
  return (workOrder.lines || []).map(line => ({
    workOrderId: workOrder.id,
    workOrderNumber: workOrder.internalWorkOrderNumber || '',
    vendorInvoiceNumber: workOrder.vendorInvoiceNumber || '',
    vendorWorkOrderNumber: workOrder.vendorWorkOrderNumber || '',
    unit: workOrder.unit || '',
    serviceDate: workOrder.serviceDate || '',
    vendor: workOrder.vendor || '',
    lineId: line.id,
    lineType: line.lineType || '',
    serviceType: line.serviceType || '',
    tirePosition: line.tirePosition || line.tirePositionText || '',
    qty: line.qty ?? '',
    rate: line.rate ?? '',
    amount: line.amount ?? '',
    notes: line.notes || '',
    serviceMileage: line.serviceMileage ?? null,
    qboSyncStatus: workOrder.qboSyncStatus || '',
    qboEntityType: workOrder.qboEntityType || '',
    qboEntityId: workOrder.qboEntityId || ''
  }));
}

function defaultRulesForVehicle(v) {
  const category = assetCategoryForVehicle(v);

  if (category === 'Refrigerated Vans') {
    return [
      { serviceType: 'Reefer PM', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Reefer Oil Service', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Reefer Fuel Filter', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Reefer Air Filter', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 90 },
      { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
      { serviceType: 'Annual Inspection', category: 'maintenance', intervalMiles: null, intervalDays: 365 },
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null }
    ];
  }

  if (category === 'Flatbeds' || category === 'Dry Vans') {
    return [
      { serviceType: 'Trailer PM', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Lubrication', category: 'maintenance', intervalMiles: null, intervalDays: 90 },
      { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 90 },
      { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
      { serviceType: 'Annual Inspection', category: 'maintenance', intervalMiles: null, intervalDays: 365 },
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null }
    ];
  }

  if (category === 'Company Vehicles') {
    return [
      { serviceType: 'Oil Change', category: 'maintenance', intervalMiles: 5000, intervalDays: 180 },
      { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 180 },
      { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 30000, intervalDays: 180 },
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null }
    ];
  }

  return [
    { serviceType: 'PM Service', category: 'maintenance', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'Oil Change', category: 'maintenance', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'Lubrication', category: 'maintenance', intervalMiles: 15000, intervalDays: 60 },
    { serviceType: 'Air Dryer Cartridge', category: 'maintenance', intervalMiles: 150000, intervalDays: 365 },
    { serviceType: 'Power Steering Service', category: 'maintenance', intervalMiles: 150000, intervalDays: 365 },
    { serviceType: 'Differential Service', category: 'maintenance', intervalMiles: 250000, intervalDays: 365 },
    { serviceType: 'Coolant Filter', category: 'maintenance', intervalMiles: 150000, intervalDays: 365 },
    { serviceType: 'Air Filters', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
    { serviceType: 'Second Fuel Filter', category: 'maintenance', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'Valve Adjustment', category: 'maintenance', intervalMiles: 150000, intervalDays: 365 },
    { serviceType: 'DPF Burn Check', category: 'maintenance', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'DPF Ash Clean', category: 'maintenance', intervalMiles: 250000, intervalDays: 365 },
    { serviceType: 'Annual Inspection', category: 'maintenance', intervalMiles: null, intervalDays: 365 },
    { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
    { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null }
  ];
}

function addDays(dateStr, days) {
  if (!dateStr || !days) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function calcStatus(nextDueMiles, nextDueDate, currentMileage) {
  const today = new Date().toISOString().slice(0, 10);

  let milesState = 'current';
  if (nextDueMiles != null && currentMileage != null) {
    const diff = nextDueMiles - currentMileage;
    if (diff < 0) milesState = 'past due';
    else if (diff <= 1000) milesState = 'due soon';
  }

  let dateState = 'current';
  if (nextDueDate) {
    if (nextDueDate < today) dateState = 'past due';
    else {
      const d1 = new Date(today);
      const d2 = new Date(nextDueDate);
      const diffDays = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) dateState = 'due soon';
    }
  }

  if (milesState === 'past due' || dateState === 'past due') return 'past due';
  if (milesState === 'due soon' || dateState === 'due soon') return 'due soon';
  return 'current';
}

function buildDashboardRows(vehicles, erpStore) {
  const currentMileage = erpStore.currentMileage || {};
  const allLines = (erpStore.workOrders || []).flatMap(flattenWorkOrderLines);

  return vehicles.flatMap(v => {
    const unit = v.name;
    const rules = defaultRulesForVehicle(v);

    const liveMiles = v.odometerMiles ?? null;
    const manualMiles = safeNum(currentMileage[unit], null);
    const effectiveMileage = liveMiles ?? manualMiles;

    return rules.map(rule => {
      const sameType = allLines
        .filter(r => r.unit === unit && r.serviceType === rule.serviceType)
        .sort((a, b) => {
          const da = `${a.serviceDate || ''} ${a.serviceMileage || ''}`;
          const db = `${b.serviceDate || ''} ${b.serviceMileage || ''}`;
          return da < db ? 1 : -1;
        });

      const last = sameType[0] || null;
      const lastMiles = last ? safeNum(last.serviceMileage, null) : null;
      const nextDueMiles =
        last && rule.intervalMiles != null && lastMiles != null
          ? lastMiles + Number(rule.intervalMiles)
          : null;
      const nextDueDate =
        last && rule.intervalDays != null && last.serviceDate
          ? addDays(last.serviceDate, rule.intervalDays)
          : null;

      return {
        unit,
        make: v.make || '',
        model: v.model || '',
        year: v.year || '',
        vin: v.vin || '',
        assetCategory: v.assetCategory || assetCategoryForVehicle(v),
        currentMileage: effectiveMileage,
        liveMileage: liveMiles,
        manualMileage: manualMiles,
        fuelPercent: v.fuelPercent ?? null,
        latitude: v.latitude,
        longitude: v.longitude,
        engineState: v.engineState || '',
        category: rule.category || 'maintenance',
        serviceType: rule.serviceType,
        intervalMiles: rule.intervalMiles,
        intervalDays: rule.intervalDays,
        lastServiceDate: last?.serviceDate || '',
        nextDueMileage: nextDueMiles,
        nextDueDate,
        vendor: last?.vendor || '',
        cost: last?.amount ?? '',
        qboSyncStatus: last?.qboSyncStatus || '',
        qboEntityId: last?.qboEntityId || '',
        status: calcStatus(nextDueMiles, nextDueDate, effectiveMileage)
      };
    });
  });
}

function buildTireAlerts(erp) {
  const lines = (erp.workOrders || [])
    .flatMap(wo => (wo.lines || []).map(line => ({ ...line, unit: wo.unit, serviceDate: wo.serviceDate })))
    .filter(line => String(line.lineType || '').toLowerCase() === 'tire');

  const byUnit = {};
  for (const line of lines) {
    if (!byUnit[line.unit]) byUnit[line.unit] = [];
    byUnit[line.unit].push(line);
  }

  const alerts = [];
  Object.entries(byUnit).forEach(([unit, rows]) => {
    rows.sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || '')));
    if (rows.length >= 3) {
      const lastThree = rows.slice(0, 3);
      const first = new Date(lastThree[2].serviceDate);
      const last = new Date(lastThree[0].serviceDate);
      const diffDays = Math.ceil((last - first) / (1000 * 60 * 60 * 24));
      if (diffDays <= 90) {
        alerts.push({
          unit,
          type: 'Tire Frequency',
          message: 'Too many tire line items created in a short period'
        });
      }
    }
  });

  return alerts;
}

/* QuickBooks */

function qboConfigured() {
  return !!(QBO_CLIENT_ID && QBO_CLIENT_SECRET && QBO_REDIRECT_URI);
}

async function qboRefreshIfNeeded() {
  const store = readQbo();
  const tokens = store.tokens;
  if (!tokens?.refresh_token) throw new Error('QuickBooks is not connected');

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Number(tokens.expires_at || 0);
  if (expiresAt && expiresAt - nowSec > 300 && tokens.access_token) {
    return store.tokens;
  }

  const basic = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', tokens.refresh_token);

  const response = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const raw = await response.text();
  const data = JSON.parse(raw);

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'QuickBooks refresh failed');
  }

  store.tokens = {
    ...store.tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || store.tokens.refresh_token,
    id_token: data.id_token || store.tokens.id_token || '',
    expires_in: data.expires_in,
    expires_at: nowSec + Number(data.expires_in || 3600)
  };
  writeQbo(store);
  return store.tokens;
}

async function qboGet(pathname) {
  const store = readQbo();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');
  const tokens = await qboRefreshIfNeeded();

  const response = await fetch(`${QBO_API_BASE}/v3/company/${store.tokens.realmId}/${pathname}`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json'
    }
  });

  const raw = await response.text();
  const data = JSON.parse(raw);
  if (!response.ok) {
    throw new Error(data?.Fault?.Error?.[0]?.Message || 'QuickBooks GET failed');
  }
  return data;
}

async function qboPost(pathname, payload) {
  const store = readQbo();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');
  const tokens = await qboRefreshIfNeeded();

  const response = await fetch(`${QBO_API_BASE}/v3/company/${store.tokens.realmId}/${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  const data = JSON.parse(raw);
  if (!response.ok) {
    throw new Error(
      data?.Fault?.Error?.[0]?.Message ||
      data?.Fault?.Error?.[0]?.Detail ||
      'QuickBooks POST failed'
    );
  }
  return data;
}

async function qboQuery(sql) {
  return qboGet(`query?query=${encodeURIComponent(sql)}`);
}

function partitionQboAccounts(accounts) {
  const expenseTypes = ['Expense', 'Cost of Goods Sold'];
  const incomeTypes = ['Income', 'Other Income'];
  return {
    accountsExpense: accounts.filter(a => expenseTypes.includes(a.accountType)),
    accountsIncome: accounts.filter(a => incomeTypes.includes(a.accountType))
  };
}

/** Normalized QBO lists for maintenance, dispatch, fuel — single source after refresh. */
function readQboCatalogPayload() {
  const erp = readErp();
  const c = erp.qboCache || {};
  const accounts = c.accounts || [];
  const parts =
    Array.isArray(c.accountsExpense) && Array.isArray(c.accountsIncome)
      ? { accountsExpense: c.accountsExpense, accountsIncome: c.accountsIncome }
      : partitionQboAccounts(accounts);
  return {
    vendors: c.vendors || [],
    items: c.items || [],
    accounts,
    accountsExpense: parts.accountsExpense,
    accountsIncome: parts.accountsIncome,
    customers: c.customers || [],
    refreshedAt: c.refreshedAt || null
  };
}

async function qboSyncMasterData() {
  const [vendorsData, itemsData, accountsData, customersData] = await Promise.all([
    qboQuery('select * from Vendor maxresults 1000'),
    qboQuery('select * from Item maxresults 1000'),
    qboQuery('select * from Account maxresults 1000'),
    qboQuery('select * from Customer maxresults 1000')
  ]);

  const vendors = (vendorsData?.QueryResponse?.Vendor || []).map(v => ({
    qboId: v.Id,
    name: v.DisplayName || '',
    companyName: v.CompanyName || '',
    phone: v.PrimaryPhone?.FreeFormNumber || '',
    email: v.PrimaryEmailAddr?.Address || '',
    active: v.Active !== false
  }));

  const items = (itemsData?.QueryResponse?.Item || []).map(i => ({
    qboId: i.Id,
    name: i.Name || '',
    type: i.Type || '',
    sku: i.Sku || '',
    active: i.Active !== false
  }));

  const accountTypesForCatalog = ['Expense', 'Cost of Goods Sold', 'Income', 'Other Income'];
  const accounts = (accountsData?.QueryResponse?.Account || [])
    .filter(a => a.Active !== false)
    .filter(a => accountTypesForCatalog.includes(a.AccountType))
    .map(a => ({
      qboId: a.Id,
      name: a.Name || '',
      accountType: a.AccountType || '',
      accountSubType: a.AccountSubType || ''
    }));

  const { accountsExpense, accountsIncome } = partitionQboAccounts(accounts);

  const customers = (customersData?.QueryResponse?.Customer || []).map(c => ({
    qboId: c.Id,
    name: c.DisplayName || '',
    companyName: c.CompanyName || '',
    email: c.PrimaryEmailAddr?.Address || '',
    phone: c.PrimaryPhone?.FreeFormNumber || '',
    active: c.Active !== false
  }));

  const erp = readErp();
  erp.qboCache = {
    vendors,
    items,
    accounts,
    accountsExpense,
    accountsIncome,
    customers,
    refreshedAt: new Date().toISOString()
  };
  writeErp(erp);
  return erp.qboCache;
}

async function qboCreateVendorFromApp(body) {
  const displayName = sanitizeName(body.name || body.companyName || 'Vendor');
  const existing = await qboQuery(
    `select * from Vendor where DisplayName = '${String(displayName).replace(/'/g, "\\'")}' maxresults 1`
  );
  const existingVendor = existing?.QueryResponse?.Vendor?.[0];
  if (existingVendor) return { created: false, vendor: existingVendor };

  const payload = {
    DisplayName: displayName,
    CompanyName: sanitizeName(body.companyName || displayName),
    PrimaryPhone: body.phone ? { FreeFormNumber: String(body.phone).slice(0, 21) } : undefined,
    PrimaryEmailAddr: body.email ? { Address: String(body.email).slice(0, 100) } : undefined,
    BillAddr: body.address ? { Line1: String(body.address).slice(0, 500) } : undefined
  };

  const created = await qboPost('vendor', payload);
  return { created: true, vendor: created?.Vendor || null };
}

async function qboFindItemById(id) {
  const data = await qboGet(`item/${id}`);
  return data?.Item || null;
}

async function qboFindAccountById(id) {
  const data = await qboGet(`account/${id}`);
  return data?.Account || null;
}

function findPaymentMethodLocal(erp, paymentMethodId) {
  return (erp.paymentMethods || []).find(v => v.id === paymentMethodId) || null;
}

async function qboCreateApTransaction(ap) {
  const erp = readErp();
  const txnDate = ap.txnDate || new Date().toISOString().slice(0, 10);
  const detailMode = ap.detailMode || 'category';
  const txnType = ap.txnType || 'expense';
  const amount = safeNum(ap.amount, 0);

  if (!(amount > 0)) throw new Error('Amount must be greater than 0');
  if (!ap.qboVendorId) throw new Error('QuickBooks vendor is required');

  let line;
  let qboItemId = '';
  let qboAccountId = '';

  if (detailMode === 'category') {
    if (!ap.qboAccountId) throw new Error('QuickBooks category/account is required');
    const accountQbo = await qboFindAccountById(ap.qboAccountId);
    if (!accountQbo) throw new Error('QuickBooks account not found');
    line = {
      Amount: amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      Description: sanitizeName(ap.description || ap.memo || ap.assetUnit || 'Expense'),
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
      }
    };
    qboAccountId = accountQbo.Id;
  } else {
    if (!ap.qboItemId) throw new Error('QuickBooks item/service is required');
    const itemQbo = await qboFindItemById(ap.qboItemId);
    if (!itemQbo) throw new Error('QuickBooks item not found');
    const qty = safeNum(ap.qty, 1) || 1;
    line = {
      Amount: amount,
      DetailType: 'ItemBasedExpenseLineDetail',
      Description: sanitizeName(ap.description || itemQbo.Name || 'Item expense'),
      ItemBasedExpenseLineDetail: {
        ItemRef: { value: itemQbo.Id, name: itemQbo.Name },
        Qty: qty,
        UnitPrice: amount / qty
      }
    };
    qboItemId = itemQbo.Id;
  }

  if (txnType === 'expense') {
    const paymentMethod = findPaymentMethodLocal(erp, ap.paymentMethodId);
    const paymentType = paymentMethod?.qboType || 'Other';
    const payload = {
      TxnDate: txnDate,
      DocNumber: ap.docNumber || undefined,
      PaymentType: paymentType,
      EntityRef: { type: 'Vendor', value: ap.qboVendorId },
      Line: [line],
      PrivateNote: sanitizeName(ap.memo || `${ap.assetUnit || ''} ${ap.description || ''}`, 'Expense')
    };
    const created = await qboPost('purchase', payload);
    return {
      qboEntityType: 'Purchase',
      qboEntityId: created?.Purchase?.Id || '',
      qboVendorId: ap.qboVendorId,
      qboItemId,
      qboAccountId
    };
  }

  const payload = {
    VendorRef: { value: ap.qboVendorId },
    TxnDate: txnDate,
    DueDate: ap.dueDate || '',
    DocNumber: ap.docNumber || undefined,
    Line: [line],
    PrivateNote: sanitizeName(ap.memo || `${ap.assetUnit || ''} ${ap.description || ''}`, 'Bill')
  };
  const created = await qboPost('bill', payload);
  return {
    qboEntityType: 'Bill',
    qboEntityId: created?.Bill?.Id || '',
    qboVendorId: ap.qboVendorId,
    qboItemId,
    qboAccountId
  };
}

async function qboCreateWorkOrderTransaction(workOrder) {
  const erp = readErp();
  if (!workOrder.qboVendorId) throw new Error('QuickBooks vendor is required on work order');
  if (!Array.isArray(workOrder.lines) || !workOrder.lines.length) throw new Error('Work order needs at least one line');

  const lines = [];
  for (const line of workOrder.lines) {
    const amount = safeNum(line.amount, 0);
    if (!(amount > 0)) continue;

    if (line.detailMode === 'item') {
      if (!line.qboItemId) throw new Error(`Missing QuickBooks item for line ${line.serviceType || line.lineType}`);
      const itemQbo = await qboFindItemById(line.qboItemId);
      if (!itemQbo) throw new Error(`QuickBooks item not found for line ${line.serviceType || line.lineType}`);
      const qty = safeNum(line.qty, 1) || 1;
      lines.push({
        Amount: amount,
        DetailType: 'ItemBasedExpenseLineDetail',
        Description: sanitizeName(
          `${line.serviceType || line.lineType || 'Line'} ${line.tirePosition || line.tirePositionText || ''}`,
          'Line'
        ),
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: itemQbo.Id, name: itemQbo.Name },
          Qty: qty,
          UnitPrice: amount / qty
        }
      });
    } else {
      if (!line.qboAccountId) throw new Error(`Missing QuickBooks account for line ${line.serviceType || line.lineType}`);
      const accountQbo = await qboFindAccountById(line.qboAccountId);
      if (!accountQbo) throw new Error(`QuickBooks account not found for line ${line.serviceType || line.lineType}`);
      lines.push({
        Amount: amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: sanitizeName(
          `${line.serviceType || line.lineType || 'Line'} ${line.tirePosition || line.tirePositionText || ''}`,
          'Line'
        ),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
        }
      });
    }
  }

  if (!lines.length) throw new Error('No valid bill/expense lines found on work order');

  if (workOrder.txnType === 'expense') {
    const paymentMethod = findPaymentMethodLocal(erp, workOrder.paymentMethodId);
    const paymentType = paymentMethod?.qboType || 'Other';
    const payload = {
      TxnDate: workOrder.serviceDate || new Date().toISOString().slice(0, 10),
      DocNumber: workOrder.vendorInvoiceNumber || workOrder.internalWorkOrderNumber || undefined,
      PaymentType: paymentType,
      EntityRef: { type: 'Vendor', value: workOrder.qboVendorId },
      Line: lines,
      PrivateNote: sanitizeName(
        `${workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} ${workOrder.unit || ''}`,
        'Work Order'
      )
    };
    const created = await qboPost('purchase', payload);
    return {
      qboEntityType: 'Purchase',
      qboEntityId: created?.Purchase?.Id || ''
    };
  }

  const payload = {
    VendorRef: { value: workOrder.qboVendorId },
    TxnDate: workOrder.serviceDate || new Date().toISOString().slice(0, 10),
    DueDate: workOrder.dueDate || '',
    DocNumber: workOrder.vendorInvoiceNumber || workOrder.internalWorkOrderNumber || undefined,
    Line: lines,
    PrivateNote: sanitizeName(
      `${workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} ${workOrder.unit || ''}`,
      'Work Order'
    )
  };
  const created = await qboPost('bill', payload);
  return {
    qboEntityType: 'Bill',
    qboEntityId: created?.Bill?.Id || ''
  };
}

/* Main endpoints */

app.get('/api/health', async (_req, res) => {
  try {
    const vehicles = await fetchVehiclesSafely();
    const stats = await fetchVehicleStatsCurrentSafely();
    res.json({
      ok: true,
      hasSamsaraToken: !!SAMSARA_API_TOKEN,
      hasGeoapifyKey: !!GEOAPIFY_API_KEY,
      hasQboConfig: qboConfigured(),
      dataDir: DATA_DIR,
      serverTime: new Date().toISOString(),
      samsaraVehicles: vehicles.length,
      samsaraStatsRows: stats.length
    });
  } catch (error) {
    res.json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const { rows } = await dbQuery('SELECT 1 AS ok, current_database() AS database');
    res.json({ ok: true, database: rows[0].database });
  } catch (error) {
    const msg = error?.message || String(error);
    if (msg.includes('DATABASE_URL is not set')) {
      res.json({ ok: false, configured: false, error: msg });
      return;
    }
    res.status(500).json({ ok: false, configured: true, error: msg });
  }
});

app.use('/api/tms', tmsRouter);

app.get('/api/board', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);

    const [vehiclesRaw, statsRows, hosRes, assignmentsRes] = await Promise.all([
      fetchVehiclesSafely(),
      fetchVehicleStatsCurrentSafely(),
      fetchJson('https://api.samsara.com/fleet/hos/clocks', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson(assignmentsUrl.toString(), { headers: samsaraHeaders() }).catch(() => ({ data: [] }))
    ]);

    const trackedVehicles = vehiclesRaw.filter(isTrackedAsset).sort(byVehicleName);
    const enrichedVehicles = mergeVehiclesWithStats(trackedVehicles, statsRows);

    res.json({
      vehicles: enrichedVehicles,
      live: statsRows,
      hos: hosRes.data || [],
      assignments: assignmentsRes.data || [],
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    logError('api/board', error);
    res.status(500).json({ error: error.message, details: error.details || null });
  }
});

app.get('/api/maintenance/dashboard', async (_req, res) => {
  try {
    const [vehiclesRaw, statsRows] = await Promise.all([
      fetchVehiclesSafely(),
      fetchVehicleStatsCurrentSafely()
    ]);

    const trackedVehicles = vehiclesRaw.filter(isTrackedAsset).sort(byVehicleName);
    const enrichedVehicles = mergeVehiclesWithStats(trackedVehicles, statsRows);

    const erp = readErp();
    const dashboard = buildDashboardRows(enrichedVehicles, erp);

    res.json({
      vehicles: enrichedVehicles,
      dashboard,
      tireAlerts: buildTireAlerts(erp),
      workOrders: erp.workOrders || [],
      statsInfo: {
        vehiclesCount: trackedVehicles.length,
        statsRowsCount: statsRows.length
      }
    });
  } catch (error) {
    logError('api/maintenance/dashboard', error);
    res.status(500).json({ error: error.message, details: error.details || null });
  }
});

app.get('/api/erp/all', (_req, res) => {
  res.json(readErp());
});

app.get('/api/maintenance/records', (_req, res) => {
  res.json(readErp());
});

app.post('/api/work-orders', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.unit) return res.status(400).json({ error: 'unit is required' });
    if (!Array.isArray(body.lines) || !body.lines.length) {
      return res.status(400).json({ error: 'At least one work order line is required' });
    }

    const erp = readErp();

    const workOrder = {
      id: uid('wo'),
      unit: body.unit,
      assetCategory: body.assetCategory || '',
      serviceDate: body.serviceDate || '',
      internalWorkOrderNumber: body.internalWorkOrderNumber || '',
      vendorInvoiceNumber: body.vendorInvoiceNumber || '',
      vendorWorkOrderNumber: body.vendorWorkOrderNumber || '',
      vendor: body.vendor || '',
      qboVendorId: body.qboVendorId || '',
      repairLocationType: body.repairLocationType || '',
      isInternalWorkOrder: !!body.isInternalWorkOrder,
      paymentMethodId: body.paymentMethodId || '',
      txnType: body.txnType || 'expense',
      dueDate: body.dueDate || '',
      notes: body.notes || '',
      qboSyncStatus: '',
      qboEntityType: '',
      qboEntityId: '',
      qboError: '',
      createdAt: new Date().toISOString(),
      lines: (body.lines || []).map(line => ({
        id: uid('wol'),
        lineType: line.lineType || 'service',
        serviceType: line.serviceType || '',
        detailMode: line.detailMode || 'category',
        qboAccountId: line.qboAccountId || '',
        qboItemId: line.qboItemId || '',
        tirePosition: line.tirePosition || '',
        tirePositionText: line.tirePositionText || '',
        qty: safeNum(line.qty, 1) || 1,
        rate: safeNum(line.rate, 0),
        amount: safeNum(line.amount, 0),
        vendorInvoiceNumber: line.vendorInvoiceNumber || '',
        vendorWorkOrderNumber: line.vendorWorkOrderNumber || '',
        notes: line.notes || '',
        serviceMileage: safeNum(line.serviceMileage, null)
      }))
    };

    erp.workOrders.push(workOrder);

    const maxMileage = Math.max(
      0,
      ...workOrder.lines.map(l => safeNum(l.serviceMileage, 0) || 0)
    );
    if (maxMileage > 0) {
      erp.currentMileage[workOrder.unit] = Math.max(safeNum(erp.currentMileage[workOrder.unit], 0) || 0, maxMileage);
    }

    writeErp(erp);
    res.json({ ok: true, workOrder });
  } catch (error) {
    logError('api/work-orders POST', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/qbo/post-work-order/:id', async (req, res) => {
  const erp = readErp();
  const idx = (erp.workOrders || []).findIndex(x => String(x.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Work order not found' });

  try {
    const result = await qboCreateWorkOrderTransaction(erp.workOrders[idx]);
    erp.workOrders[idx] = {
      ...erp.workOrders[idx],
      qboSyncStatus: 'posted',
      qboEntityType: result.qboEntityType,
      qboEntityId: result.qboEntityId,
      qboError: '',
      qboPostedAt: new Date().toISOString()
    };
    writeErp(erp);
    res.json({ ok: true, workOrder: erp.workOrders[idx] });
  } catch (error) {
    erp.workOrders[idx] = {
      ...erp.workOrders[idx],
      qboSyncStatus: 'error',
      qboError: error.message,
      qboErrorAt: new Date().toISOString()
    };
    writeErp(erp);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/erp/ap-transaction', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.txnType || !body.detailMode || !body.qboVendorId) {
      return res.status(400).json({ error: 'Missing required AP transaction fields' });
    }

    const erp = readErp();
    erp.apTransactions.push({
      id: uid('ap'),
      txnType: body.txnType,
      detailMode: body.detailMode,
      qboVendorId: body.qboVendorId,
      paymentMethodId: body.paymentMethodId || '',
      qboAccountId: body.qboAccountId || '',
      qboItemId: body.qboItemId || '',
      qty: safeNum(body.qty, 1) || 1,
      amount: safeNum(body.amount, 0),
      txnDate: body.txnDate || '',
      dueDate: body.dueDate || '',
      docNumber: body.docNumber || '',
      description: body.description || '',
      memo: body.memo || '',
      assetUnit: body.assetUnit || '',
      qboSyncStatus: '',
      qboEntityType: '',
      qboEntityId: '',
      qboError: '',
      createdAt: new Date().toISOString()
    });
    writeErp(erp);
    res.json({ ok: true });
  } catch (error) {
    logError('api/erp/ap-transaction POST', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/qbo/post-ap/:id', async (req, res) => {
  const erp = readErp();
  const idx = (erp.apTransactions || []).findIndex(x => String(x.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'AP transaction not found' });

  try {
    const result = await qboCreateApTransaction(erp.apTransactions[idx]);
    erp.apTransactions[idx] = {
      ...erp.apTransactions[idx],
      qboSyncStatus: 'posted',
      qboEntityType: result.qboEntityType,
      qboEntityId: result.qboEntityId,
      qboVendorId: result.qboVendorId,
      qboItemId: result.qboItemId,
      qboAccountId: result.qboAccountId,
      qboError: '',
      qboPostedAt: new Date().toISOString()
    };
    writeErp(erp);
    res.json({ ok: true, ap: erp.apTransactions[idx] });
  } catch (error) {
    erp.apTransactions[idx] = {
      ...erp.apTransactions[idx],
      qboSyncStatus: 'error',
      qboError: error.message,
      qboErrorAt: new Date().toISOString()
    };
    writeErp(erp);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qbo/status', (_req, res) => {
  const store = readQbo();
  res.json({
    configured: qboConfigured(),
    connected: !!store.tokens?.access_token,
    realmId: store.tokens?.realmId || '',
    connectedAt: store.tokens?.connected_at || '',
    companyName: store.tokens?.companyName || ''
  });
});

app.get('/api/qbo/connect', (_req, res) => {
  try {
    if (!qboConfigured()) return res.status(400).send('QuickBooks environment variables are missing.');

    const state = crypto.randomBytes(16).toString('hex');
    const store = readQbo();
    store.state = state;
    writeQbo(store);

    const params = new URLSearchParams();
    params.set('client_id', QBO_CLIENT_ID);
    params.set('response_type', 'code');
    params.set('scope', 'com.intuit.quickbooks.accounting');
    params.set('redirect_uri', QBO_REDIRECT_URI);
    params.set('state', state);

    return res.redirect(`${INTUIT_AUTH_BASE}?${params.toString()}`);
  } catch (error) {
    logError('api/qbo/connect', error);
    res.status(500).send(error.message);
  }
});

app.get('/api/qbo/callback', async (req, res) => {
  try {
    const { code, realmId, state } = req.query;
    const store = readQbo();

    if (!code || !realmId || !state) return res.status(400).send('Missing QuickBooks callback parameters.');
    if (!store.state || store.state !== state) return res.status(400).send('Invalid QuickBooks state.');

    const basic = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', QBO_REDIRECT_URI);

    const response = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const raw = await response.text();
    const data = JSON.parse(raw);

    if (!response.ok) {
      return res.status(500).send(data?.error_description || data?.error || 'QuickBooks token exchange failed');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    store.tokens = {
      realmId: String(realmId),
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token || '',
      expires_in: data.expires_in,
      expires_at: nowSec + Number(data.expires_in || 3600),
      connected_at: new Date().toISOString(),
      companyName: ''
    };
    store.state = '';
    writeQbo(store);

    try {
      const company = await qboGet(`companyinfo/${realmId}`);
      const companyName =
        company?.CompanyInfo?.CompanyName ||
        company?.QueryResponse?.CompanyInfo?.[0]?.CompanyName ||
        '';
      const updated = readQbo();
      if (updated.tokens) {
        updated.tokens.companyName = companyName;
        writeQbo(updated);
      }
    } catch {}

    return res.send(`
      <html>
        <body style="font-family:Arial;padding:24px">
          <h2>QuickBooks connected successfully</h2>
          <p>You can close this page and return to the dashboard.</p>
          <p><a href="/maintenance.html">Go to Dashboard</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    logError('api/qbo/callback', error);
    res.status(500).send(`QuickBooks callback failed: ${error.message}`);
  }
});

app.get('/api/qbo/company', async (_req, res) => {
  try {
    const store = readQbo();
    if (!store.tokens?.realmId) return res.status(400).json({ error: 'QuickBooks not connected' });
    const data = await qboGet(`companyinfo/${store.tokens.realmId}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qbo/catalog', (req, res) => {
  try {
    const store = readQbo();
    const payload = readQboCatalogPayload();
    res.json({
      ok: true,
      source: 'quickbooks',
      connected: !!(store.tokens?.accessToken && store.tokens?.realmId),
      ...payload
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/qbo/catalog/refresh', async (_req, res) => {
  try {
    const store = readQbo();
    if (!store.tokens?.accessToken) {
      return res.status(400).json({ ok: false, error: 'QuickBooks not connected' });
    }
    await qboSyncMasterData();
    const payload = readQboCatalogPayload();
    res.json({
      ok: true,
      source: 'quickbooks',
      connected: true,
      ...payload
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/qbo/master', async (_req, res) => {
  try {
    await qboSyncMasterData();
    const payload = readQboCatalogPayload();
    res.json({ ok: true, ...payload });
  } catch (error) {
    const payload = readQboCatalogPayload();
    res.status(500).json({
      error: error.message,
      ...payload
    });
  }
});

app.post('/api/qbo/create-vendor', async (req, res) => {
  try {
    const result = await qboCreateVendorFromApp(req.body || {});
    const cache = await qboSyncMasterData();
    res.json({ ok: true, created: result.created, vendor: result.vendor, cache });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function lowerKeyMap(row) {
  const out = {};
  Object.keys(row || {}).forEach(k => {
    out[String(k).trim().toLowerCase()] = row[k];
  });
  return out;
}

function firstValue(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}

app.post('/api/import/maintenance', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

    const erp = readErp();
    let imported = 0;

    for (const rawRow of rows) {
      const row = lowerKeyMap(rawRow);
      const unit = sanitizeName(firstValue(row, ['unit', 'vehicle', 'truck', 'asset', 'unit number']), '');
      if (!unit) continue;

      const serviceType = sanitizeName(firstValue(row, ['service', 'service type', 'maintenance type', 'type']), 'Service');
      const serviceMileage = safeNum(firstValue(row, ['service mileage', 'mileage', 'odometer', 'last mileage']), null);
      const qty = safeNum(firstValue(row, ['qty', 'quantity']), 1) || 1;
      const amount = safeNum(firstValue(row, ['cost', 'amount', 'expense']), 0);
      const rate = qty ? amount / qty : amount;

      const workOrder = {
        id: uid('imp_wo'),
        unit,
        assetCategory: '',
        serviceDate: firstValue(row, ['date', 'service date', 'last date']) || '',
        internalWorkOrderNumber: firstValue(row, ['internal work order', 'work order', 'wo']) || '',
        vendorInvoiceNumber: firstValue(row, ['vendor invoice', 'invoice number']) || '',
        vendorWorkOrderNumber: firstValue(row, ['vendor work order']) || '',
        vendor: firstValue(row, ['vendor', 'shop', 'supplier']) || '',
        qboVendorId: '',
        repairLocationType: firstValue(row, ['repair type', 'repair location type']) || '',
        isInternalWorkOrder: String(firstValue(row, ['internal', 'is internal']) || '').toLowerCase() === 'true',
        paymentMethodId: '',
        txnType: 'expense',
        dueDate: '',
        notes: firstValue(row, ['notes', 'memo', 'description']) || '',
        qboSyncStatus: '',
        qboEntityType: '',
        qboEntityId: '',
        qboError: '',
        createdAt: new Date().toISOString(),
        lines: [
          {
            id: uid('imp_wol'),
            lineType: sanitizeName(firstValue(row, ['line type', 'category']), 'service').toLowerCase(),
            serviceType,
            detailMode: 'category',
            qboAccountId: '',
            qboItemId: '',
            tirePosition: firstValue(row, ['tire position']) || '',
            tirePositionText: firstValue(row, ['tire position text']) || '',
            qty,
            rate,
            amount,
            vendorInvoiceNumber: firstValue(row, ['vendor invoice', 'invoice number']) || '',
            vendorWorkOrderNumber: firstValue(row, ['vendor work order']) || '',
            notes: firstValue(row, ['notes', 'memo', 'description']) || '',
            serviceMileage
          }
        ]
      };

      if (serviceMileage != null) {
        erp.currentMileage[unit] = Math.max(safeNum(erp.currentMileage[unit], 0) || 0, serviceMileage);
      }

      erp.workOrders.push(workOrder);
      imported += 1;
    }

    writeErp(erp);
    res.json({ ok: true, imported });
  } catch (error) {
    logError('api/import/maintenance', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/import/ap', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

    const erp = readErp();
    let imported = 0;

    for (const rawRow of rows) {
      const row = lowerKeyMap(rawRow);
      const amount = safeNum(firstValue(row, ['amount', 'cost', 'expense amount']), 0);
      if (!(amount > 0)) continue;

      const vendorName = String(firstValue(row, ['vendor', 'vendor name']) || '').trim().toLowerCase();
      const accountName = String(firstValue(row, ['account', 'category', 'account name']) || '').trim().toLowerCase();
      const itemName = String(firstValue(row, ['item', 'item name', 'service']) || '').trim().toLowerCase();

      const vendor = (erp.qboCache.vendors || []).find(v => String(v.name).toLowerCase() === vendorName);
      const account = (erp.qboCache.accounts || []).find(v => String(v.name).toLowerCase() === accountName);
      const item = (erp.qboCache.items || []).find(v => String(v.name).toLowerCase() === itemName);

      erp.apTransactions.push({
        id: uid('imp_ap'),
        txnType: String(firstValue(row, ['txn type', 'type']) || 'expense').toLowerCase(),
        detailMode: item ? 'item' : 'category',
        qboVendorId: vendor?.qboId || '',
        paymentMethodId: '',
        qboAccountId: account?.qboId || '',
        qboItemId: item?.qboId || '',
        qty: safeNum(firstValue(row, ['qty', 'quantity']), 1) || 1,
        amount,
        txnDate: firstValue(row, ['date', 'txn date']) || '',
        dueDate: firstValue(row, ['due date']) || '',
        docNumber: firstValue(row, ['doc number', 'expense no', 'bill no']) || '',
        description: firstValue(row, ['description', 'memo']) || '',
        memo: firstValue(row, ['memo', 'notes']) || '',
        assetUnit: firstValue(row, ['unit', 'vehicle', 'truck']) || '',
        qboSyncStatus: '',
        qboEntityType: '',
        qboEntityId: '',
        qboError: '',
        createdAt: new Date().toISOString()
      });
      imported += 1;
    }

    writeErp(erp);
    res.json({ ok: true, imported });
  } catch (error) {
    logError('api/import/ap', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);

    if (GEOAPIFY_API_KEY) {
      const url = new URL('https://api.geoapify.com/v1/geocode/search');
      url.searchParams.set('text', q);
      url.searchParams.set('filter', 'countrycode:us');
      url.searchParams.set('limit', '8');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const data = await fetchJson(url.toString(), { headers: { Accept: 'application/json' } });
      return res.json((data.results || []).map(x => ({
        lat: Number(x.lat),
        lon: Number(x.lon),
        name: x.formatted || q
      })));
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IH35-ERP', Accept: 'application/json' }
    });
    const raw = await response.text();
    const data = JSON.parse(raw);
    res.json((Array.isArray(data) ? data : []).map(x => ({
      lat: Number(x.lat),
      lon: Number(x.lon),
      name: x.display_name || q
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/autocomplete', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q || q.length < 2) return res.json([]);

    if (GEOAPIFY_API_KEY) {
      const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      url.searchParams.set('text', q);
      url.searchParams.set('filter', 'countrycode:us');
      url.searchParams.set('limit', '10');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const data = await fetchJson(url.toString(), { headers: { Accept: 'application/json' } });
      return res.json((data.results || []).map(x => ({ name: x.formatted || x.address_line1 || q })));
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IH35-ERP', Accept: 'application/json' }
    });
    const raw = await response.text();
    const data = JSON.parse(raw);
    res.json((Array.isArray(data) ? data : []).map(x => ({ name: x.display_name })));
  } catch {
    res.json([]);
  }
});

app.get('/api/route', async (req, res) => {
  try {
    const coords = String(req.query.coords || '').trim();
    if (!coords) return res.status(400).json({ error: 'Missing coords' });

    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const data = await fetchJson(url, { headers: { Accept: 'application/json' } });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/maintenance.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  logError('unhandled middleware error', err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

process.on('uncaughtException', err => {
  logError('uncaughtException', err);
});

process.on('unhandledRejection', err => {
  logError('unhandledRejection', err);
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
