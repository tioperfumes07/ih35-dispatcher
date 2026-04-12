import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';

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
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultErpData() {
  return {
    currentMileage: {},
    records: [],
    unitOverrides: {},
    paymentMethods: [
      { id: 'pm_cash', name: 'Cash', qboType: 'Cash' },
      { id: 'pm_check', name: 'Check', qboType: 'Check' },
      { id: 'pm_creditcard', name: 'Credit Card', qboType: 'CreditCard' },
      { id: 'pm_other', name: 'Other', qboType: 'Other' },
      { id: 'pm_vendorcredit', name: 'Vendor Credit / Terms', qboType: 'Other' }
    ],
    apTransactions: [],
    qboCache: {
      vendors: [],
      items: [],
      accounts: [],
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
  const existing = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
  const merged = { ...defaultErpData(), ...existing };
  if (!Array.isArray(merged.records)) merged.records = [];
  if (!merged.currentMileage) merged.currentMileage = {};
  if (!merged.unitOverrides) merged.unitOverrides = {};
  if (!Array.isArray(merged.paymentMethods)) merged.paymentMethods = defaultErpData().paymentMethods;
  if (!Array.isArray(merged.apTransactions)) merged.apTransactions = [];
  if (!merged.qboCache) merged.qboCache = defaultErpData().qboCache;
  if (!Array.isArray(merged.qboCache.vendors)) merged.qboCache.vendors = [];
  if (!Array.isArray(merged.qboCache.items)) merged.qboCache.items = [];
  if (!Array.isArray(merged.qboCache.accounts)) merged.qboCache.accounts = [];
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

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeName(value, fallback = 'Unnamed') {
  return String(value || fallback).trim().slice(0, 100);
}

function parseUnitNumber(name) {
  const m = String(name || '').match(/^T(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function samsaraHeaders() {
  return {
    Authorization: `Bearer ${SAMSARA_API_TOKEN}`,
    Accept: 'application/json'
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${raw.slice(0, 250)}`);
  }

  if (!response.ok) {
    const msg =
      data?.Fault?.Error?.[0]?.Message ||
      data?.Fault?.Error?.[0]?.Detail ||
      data?.message ||
      data?.error ||
      response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function isTrackedAsset(v) {
  const unitNum = parseUnitNumber(v.name);
  const inTruckRange = unitNum !== null && unitNum >= 120 && unitNum <= 177;
  const text = `${v.name || ''} ${v.make || ''} ${v.model || ''} ${v.notes || ''}`.toLowerCase();
  const reeferLike =
    text.includes('reefer') ||
    text.includes('refrigerated') ||
    text.includes('utility 3000r') ||
    text.includes('thermo king') ||
    text.includes('carrier');
  const flatbedLike =
    text.includes('flatbed') ||
    text.includes('step deck') ||
    text.includes('drop deck');
  const dryVanLike = text.includes('dry van');
  const companyVehicleLike =
    text.includes('pickup') ||
    text.includes('suv') ||
    text.includes('company vehicle') ||
    text.includes('car') ||
    text.includes('silverado') ||
    text.includes('f-150');

  return inTruckRange || reeferLike || flatbedLike || dryVanLike || companyVehicleLike;
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
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null },
      { serviceType: 'Accident Report', category: 'accident', intervalMiles: null, intervalDays: null }
    ];
  }

  if (category === 'Flatbeds' || category === 'Dry Vans') {
    return [
      { serviceType: 'Trailer PM', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
      { serviceType: 'Lubrication', category: 'maintenance', intervalMiles: null, intervalDays: 90 },
      { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 90 },
      { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
      { serviceType: 'Annual Inspection', category: 'maintenance', intervalMiles: null, intervalDays: 365 },
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null },
      { serviceType: 'Accident Report', category: 'accident', intervalMiles: null, intervalDays: null }
    ];
  }

  if (category === 'Company Vehicles') {
    return [
      { serviceType: 'Oil Change', category: 'maintenance', intervalMiles: 5000, intervalDays: 180 },
      { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 180 },
      { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 30000, intervalDays: 180 },
      { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null },
      { serviceType: 'Accident Report', category: 'accident', intervalMiles: null, intervalDays: null }
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
    { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null },
    { serviceType: 'Accident Report', category: 'accident', intervalMiles: null, intervalDays: null }
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

function getStatValue(entry, keys = []) {
  for (const key of keys) {
    const v = entry?.[key];
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'object') {
      if (v.value != null) return v.value;
      if (v.percent != null) return v.percent;
      if (v.latitude != null || v.longitude != null) return v;
    }
  }
  return null;
}

function vehicleIdOf(entry) {
  return String(
    entry?.id ||
    entry?.vehicleId ||
    entry?.vehicle?.id ||
    entry?.vehicle?.ids?.samsaraId ||
    entry?.ids?.samsaraId ||
    ''
  );
}

function enrichVehicles(vehicles, liveStats = []) {
  const statsById = new Map();
  for (const row of liveStats) {
    const id = vehicleIdOf(row);
    if (id) statsById.set(id, row);
  }

  return vehicles.map(v => {
    const id = String(v.id || v.vehicleId || v.ids?.samsaraId || '');
    const s = statsById.get(id) || {};

    const obdMeters = safeNum(
      getStatValue(s, ['obdOdometerMeters', 'obdOdometer', 'obdOdometerMetersValue']),
      null
    );
    const gpsMeters = safeNum(
      getStatValue(s, ['gpsOdometerMeters', 'syntheticOdometerMeters', 'gpsOdometer']),
      null
    );
    const odometerMeters = obdMeters ?? gpsMeters ?? null;
    const odometerMiles = odometerMeters != null ? Math.round(odometerMeters * 0.000621371) : null;

    const fuelPercent = safeNum(
      getStatValue(s, ['fuelPercent', 'fuelPercents', 'fuel']),
      null
    );

    const gps = getStatValue(s, ['gps', 'location']) || {};
    const lat = safeNum(gps?.latitude ?? gps?.lat, null);
    const lon = safeNum(gps?.longitude ?? gps?.lng ?? gps?.lon, null);

    const engineState = getStatValue(s, ['engineState', 'engineStates']) || '';

    return {
      ...v,
      assetCategory: assetCategoryForVehicle(v),
      odometerMiles,
      odometerMeters,
      fuelPercent,
      latitude: lat,
      longitude: lon,
      engineState: String(engineState || '')
    };
  });
}

function buildDashboardRows(vehicles, erpStore) {
  const records = erpStore.records || [];
  const currentMileage = erpStore.currentMileage || {};
  const unitOverrides = erpStore.unitOverrides || {};

  return vehicles.map(v => {
    const unit = v.name;
    const rules = unitOverrides[unit]?.rules || defaultRulesForVehicle(v);
    const unitRecords = records.filter(r => r.unit === unit);
    const liveMiles = v.odometerMiles ?? null;
    const manualMiles = safeNum(currentMileage[unit], null);
    const effectiveMileage = liveMiles ?? manualMiles;

    return rules.map(rule => {
      const sameType = unitRecords
        .filter(r => r.serviceType === rule.serviceType)
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
        fuelPercent: v.fuelPercent ?? null,
        latitude: v.latitude,
        longitude: v.longitude,
        engineState: v.engineState || '',
        category: rule.category || 'maintenance',
        serviceType: rule.serviceType,
        intervalMiles: rule.intervalMiles,
        intervalDays: rule.intervalDays,
        lastServiceDate: last?.serviceDate || '',
        lastServiceMileage: last?.serviceMileage ?? '',
        nextDueMileage: nextDueMiles,
        nextDueDate,
        vendor: last?.vendor || '',
        cost: last?.cost ?? '',
        notes: last?.notes || '',
        qboSyncStatus: last?.qboSyncStatus || '',
        qboPurchaseId: last?.qboPurchaseId || '',
        status: calcStatus(nextDueMiles, nextDueDate, effectiveMileage)
      };
    });
  }).flat();
}

function buildTireAlerts(records) {
  const tireRecords = records.filter(r => r.recordType === 'tire');
  const byUnit = {};
  tireRecords.forEach(r => {
    if (!byUnit[r.unit]) byUnit[r.unit] = [];
    byUnit[r.unit].push(r);
  });

  const alerts = [];
  Object.entries(byUnit).forEach(([unit, rows]) => {
    rows.sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || '')));
    const recent = rows.filter(r => r.serviceDate);
    if (recent.length >= 3) {
      const lastThree = recent.slice(0, 3);
      const first = new Date(lastThree[2].serviceDate);
      const last = new Date(lastThree[0].serviceDate);
      const diffDays = Math.ceil((last - first) / (1000 * 60 * 60 * 24));
      if (diffDays <= 90) {
        alerts.push({
          unit,
          type: 'Tire Frequency',
          severity: 'due soon',
          message: 'Too many tire replacements in a short period'
        });
      }
    }
  });

  return alerts;
}

/* QuickBooks helpers */

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

async function qboSyncMasterData() {
  const [vendorsData, itemsData, accountsData] = await Promise.all([
    qboQuery('select * from Vendor maxresults 1000'),
    qboQuery('select * from Item maxresults 1000'),
    qboQuery('select * from Account maxresults 1000')
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

  const accounts = (accountsData?.QueryResponse?.Account || [])
    .filter(a => a.Active !== false)
    .filter(a => ['Expense', 'Cost of Goods Sold'].includes(a.AccountType))
    .map(a => ({
      qboId: a.Id,
      name: a.Name || '',
      accountType: a.AccountType || '',
      accountSubType: a.AccountSubType || ''
    }));

  const erp = readErp();
  erp.qboCache = {
    vendors,
    items,
    accounts,
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

async function qboFindVendorById(id) {
  const data = await qboGet(`vendor/${id}`);
  return data?.Vendor || null;
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
        AccountRef: {
          value: accountQbo.Id,
          name: accountQbo.Name
        }
      }
    };
    qboAccountId = accountQbo.Id;
  } else {
    if (!ap.qboItemId) throw new Error('QuickBooks item/service is required');
    const itemQbo = await qboFindItemById(ap.qboItemId);
    if (!itemQbo) throw new Error('QuickBooks item not found');
    const qty = safeNum(ap.qty, 1) || 1;
    const unitPrice = amount / qty;
    line = {
      Amount: amount,
      DetailType: 'ItemBasedExpenseLineDetail',
      Description: sanitizeName(ap.description || itemQbo.Name || 'Item expense'),
      ItemBasedExpenseLineDetail: {
        ItemRef: {
          value: itemQbo.Id,
          name: itemQbo.Name
        },
        Qty: qty,
        UnitPrice: unitPrice
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

  if (txnType === 'bill') {
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

  throw new Error('Unsupported AP transaction type');
}

/* Samsara endpoints */

app.get('/api/board', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);

    const statsUrl = 'https://api.samsara.com/fleet/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters,fuelPercents,gps,engineStates';

    const [vehiclesRes, liveRes, hosRes, assignmentsRes] = await Promise.all([
      fetchJson('https://api.samsara.com/fleet/vehicles', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson(statsUrl, { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/hos/clocks', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson(assignmentsUrl.toString(), { headers: samsaraHeaders() }).catch(() => ({ data: [] }))
    ]);

    const rawVehicles = (vehiclesRes.data || []).filter(isTrackedAsset);
    const live = liveRes.data || [];
    const enrichedVehicles = enrichVehicles(rawVehicles, live).sort(byVehicleName);

    res.json({
      vehicles: enrichedVehicles,
      live,
      hos: hosRes.data || [],
      assignments: assignmentsRes.data || [],
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.details || null });
  }
});

function byVehicleName(a, b) {
  const pa = parseUnitNumber(a.name);
  const pb = parseUnitNumber(b.name);
  if (pa != null && pb != null) return pa - pb;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

app.get('/api/maintenance/dashboard', async (_req, res) => {
  try {
    const statsUrl = 'https://api.samsara.com/fleet/vehicles/stats?types=obdOdometerMeters,gpsOdometerMeters,fuelPercents,gps,engineStates';

    const [vehiclesRes, liveRes] = await Promise.all([
      fetchJson('https://api.samsara.com/fleet/vehicles', { headers: samsaraHeaders() }),
      fetchJson(statsUrl, { headers: samsaraHeaders() }).catch(() => ({ data: [] }))
    ]);

    const trackedMap = new Map();
    (vehiclesRes.data || []).filter(isTrackedAsset).forEach(v => {
      const key = String(v.name || '').trim().toUpperCase();
      if (!key) return;
      if (!trackedMap.has(key)) trackedMap.set(key, v);
      else {
        const existing = trackedMap.get(key);
        const oldTs = String(existing.updatedAtTime || '');
        const newTs = String(v.updatedAtTime || '');
        if (newTs > oldTs) trackedMap.set(key, v);
      }
    });

    const tracked = enrichVehicles(Array.from(trackedMap.values()), liveRes.data || []).sort(byVehicleName);
    const erp = readErp();
    const dashboard = buildDashboardRows(tracked, erp);
    const tireAlerts = buildTireAlerts(erp.records || []);

    res.json({
      vehicles: tracked,
      dashboard,
      tireAlerts
    });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.details || null });
  }
});

/* Geo/autocomplete */

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
    const response = await fetch(url, { headers: { 'User-Agent': 'IH35-ERP', Accept: 'application/json' } });
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
    const response = await fetch(url, { headers: { 'User-Agent': 'IH35-ERP', Accept: 'application/json' } });
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

/* QuickBooks endpoints */

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
  } catch (err) {
    return res.status(500).send(`QuickBooks callback failed: ${err.message}`);
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

app.get('/api/qbo/master', async (_req, res) => {
  try {
    const cache = await qboSyncMasterData();
    res.json({ ok: true, ...cache });
  } catch (error) {
    const erp = readErp();
    res.status(500).json({
      error: error.message,
      vendors: erp.qboCache?.vendors || [],
      items: erp.qboCache?.items || [],
      accounts: erp.qboCache?.accounts || [],
      refreshedAt: erp.qboCache?.refreshedAt || ''
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

/* Maintenance / accounting CRUD */

app.get('/api/maintenance/records', (_req, res) => {
  res.json(readErp());
});

app.post('/api/maintenance/mileage', (req, res) => {
  const { unit, currentMileage } = req.body || {};
  if (!unit) return res.status(400).json({ error: 'unit is required' });

  const erp = readErp();
  erp.currentMileage[unit] = safeNum(currentMileage, null);
  writeErp(erp);
  res.json({ ok: true });
});

app.post('/api/maintenance/record', (req, res) => {
  const body = req.body || {};
  if (!body.unit || !body.serviceType) {
    return res.status(400).json({ error: 'unit and serviceType are required' });
  }

  const erp = readErp();
  erp.records.push({
    id: uid('rec'),
    recordType: body.recordType || 'maintenance',
    unit: body.unit,
    serviceType: body.serviceType,
    serviceDate: body.serviceDate || '',
    serviceMileage: safeNum(body.serviceMileage, null),
    vendor: body.vendor || '',
    cost: safeNum(body.cost, null),
    notes: body.notes || '',
    tireCondition: body.tireCondition || '',
    tirePosition: body.tirePosition || '',
    tirePositionText: body.tirePositionText || '',
    tireBrand: body.tireBrand || '',
    tireDot: body.tireDot || '',
    installMileage: safeNum(body.installMileage, null),
    removeMileage: safeNum(body.removeMileage, null),
    expectedTireLifeMiles: safeNum(body.expectedTireLifeMiles, null),
    accidentAtFault: body.accidentAtFault || '',
    accidentLocation: body.accidentLocation || '',
    accidentReportNumber: body.accidentReportNumber || '',
    repairLocationType: body.repairLocationType || '',
    qboSyncStatus: '',
    qboPurchaseId: '',
    qboVendorId: '',
    qboItemId: '',
    qboAccountId: '',
    qboError: ''
  });
  writeErp(erp);
  res.json({ ok: true });
});

app.post('/api/erp/ap-transaction', (req, res) => {
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

app.post('/api/qbo/post-record/:id', async (req, res) => {
  try {
    const recordId = String(req.params.id);
    const erp = readErp();
    const idx = (erp.records || []).findIndex(r => String(r.id) === recordId);
    if (idx === -1) return res.status(404).json({ error: 'Record not found' });

    const record = erp.records[idx];
    const cache = erp.qboCache || { vendors: [], accounts: [] };

    let vendor = (cache.vendors || []).find(v => v.name === record.vendor) || (cache.vendors || [])[0];
    if (!vendor) throw new Error('No QuickBooks vendor available. Refresh QuickBooks master data first.');

    let accountName = 'Maintenance Expense';
    if (record.recordType === 'tire' || String(record.serviceType).toLowerCase().includes('tire')) accountName = 'Tire Expense';
    if (record.recordType === 'accident') accountName = 'Accident Expense';
    if (record.recordType === 'repair' && record.repairLocationType === 'road-service') accountName = 'Road Service Expense';
    if (record.recordType === 'repair' && record.repairLocationType === 'over-the-road') accountName = 'Over The Road Repair Expense';
    if (String(record.serviceType).toLowerCase().includes('reefer')) accountName = 'Reefer Maintenance Expense';

    const account = (cache.accounts || []).find(a => a.name === accountName);
    if (!account) throw new Error(`QuickBooks account not found: ${accountName}`);

    const amount = safeNum(record.cost, 0);
    if (!(amount > 0)) throw new Error('Record cost must be greater than 0 for QuickBooks posting');

    const payload = {
      TxnDate: record.serviceDate || new Date().toISOString().slice(0, 10),
      PaymentType: 'Other',
      EntityRef: { type: 'Vendor', value: vendor.qboId },
      Line: [
        {
          Amount: amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: sanitizeName(`Unit ${record.unit} | ${record.serviceType} | ${record.notes || ''}`, 'Maintenance'),
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: account.qboId, name: account.name }
          }
        }
      ],
      PrivateNote: sanitizeName(`IH35 ${record.recordType} | ${record.unit} | ${record.serviceType}`, 'Maintenance')
    };

    const created = await qboPost('purchase', payload);

    erp.records[idx] = {
      ...record,
      qboSyncStatus: 'posted',
      qboPurchaseId: created?.Purchase?.Id || '',
      qboVendorId: vendor?.qboId || '',
      qboAccountId: account?.qboId || '',
      qboError: '',
      qboPostedAt: new Date().toISOString()
    };

    writeErp(erp);
    res.json({ ok: true, record: erp.records[idx] });
  } catch (error) {
    const erp = readErp();
    const idx = (erp.records || []).findIndex(r => String(r.id) === String(req.params.id));
    if (idx !== -1) {
      erp.records[idx] = {
        ...erp.records[idx],
        qboSyncStatus: 'error',
        qboError: error.message,
        qboErrorAt: new Date().toISOString()
      };
      writeErp(erp);
    }
    res.status(500).json({ error: error.message });
  }
});

/* Imports */

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
      const serviceType = sanitizeName(firstValue(row, ['service', 'service type', 'maintenance type', 'type']), '');

      if (!unit || !serviceType) continue;

      const serviceMileage = safeNum(firstValue(row, ['service mileage', 'mileage', 'odometer', 'last mileage']), null);
      if (serviceMileage != null) {
        erp.currentMileage[unit] = Math.max(safeNum(erp.currentMileage[unit], 0) || 0, serviceMileage);
      }

      erp.records.push({
        id: uid('imp_rec'),
        recordType: sanitizeName(firstValue(row, ['record type', 'category']), 'maintenance').toLowerCase(),
        unit,
        serviceType,
        serviceDate: firstValue(row, ['date', 'service date', 'last date']) || '',
        serviceMileage,
        vendor: firstValue(row, ['vendor', 'shop', 'supplier']) || '',
        cost: safeNum(firstValue(row, ['cost', 'amount', 'expense']), null),
        notes: firstValue(row, ['notes', 'memo', 'description']) || '',
        tireCondition: firstValue(row, ['tire condition']) || '',
        tirePosition: firstValue(row, ['tire position']) || '',
        tirePositionText: firstValue(row, ['tire position text']) || '',
        tireBrand: firstValue(row, ['tire brand']) || '',
        tireDot: firstValue(row, ['tire dot', 'dot']) || '',
        installMileage: safeNum(firstValue(row, ['install mileage']), null),
        removeMileage: safeNum(firstValue(row, ['remove mileage']), null),
        expectedTireLifeMiles: safeNum(firstValue(row, ['expected tire life', 'expected tire life miles']), null),
        accidentAtFault: firstValue(row, ['accident at fault']) || '',
        accidentLocation: firstValue(row, ['accident location']) || '',
        accidentReportNumber: firstValue(row, ['accident report', 'accident report number']) || '',
        repairLocationType: firstValue(row, ['repair type', 'repair location type']) || '',
        qboSyncStatus: '',
        qboPurchaseId: '',
        qboVendorId: '',
        qboItemId: '',
        qboAccountId: '',
        qboError: ''
      });
      imported += 1;
    }

    writeErp(erp);
    res.json({ ok: true, imported });
  } catch (error) {
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
    res.status(500).json({ error: error.message });
  }
});

/* Basic endpoints */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasSamsaraToken: !!SAMSARA_API_TOKEN,
    hasGeoapifyKey: !!GEOAPIFY_API_KEY,
    hasQboConfig: qboConfigured(),
    dataDir: DATA_DIR,
    serverTime: new Date().toISOString()
  });
});

app.get('/maintenance.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
