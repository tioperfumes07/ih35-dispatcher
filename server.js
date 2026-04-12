import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3400;

const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN || '';
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';

const PERSIST_DIR = '/var/data';
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = fs.existsSync(PERSIST_DIR) ? PERSIST_DIR : LOCAL_DATA_DIR;

const ERP_FILE = path.join(DATA_DIR, 'maintenance.json');
const QBO_FILE = path.join(DATA_DIR, 'qbo_tokens.json');

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || '';

const INTUIT_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_API_BASE = 'https://quickbooks.api.intuit.com';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultErpData() {
  return {
    currentMileage: {},
    records: [],
    unitOverrides: {},
    vendors: [],
    items: [],
    accounts: [],
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

  const data = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
  const merged = { ...defaultErpData(), ...data };

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
    fs.writeFileSync(
      QBO_FILE,
      JSON.stringify(
        {
          state: '',
          tokens: null
        },
        null,
        2
      )
    );
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

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseUnitNumber(name) {
  const m = String(name || '').match(/^T(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function sanitizeName(value, fallback = 'Unnamed') {
  return String(value || fallback).trim().slice(0, 100);
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isTrackedAsset(v) {
  const unitNum = parseUnitNumber(v.name);
  const inTruckRange = unitNum !== null && unitNum >= 120 && unitNum <= 177;

  const text = `${v.name || ''} ${v.make || ''} ${v.model || ''} ${v.notes || ''}`.toLowerCase();
  const reeferLike =
    text.includes('reefer') ||
    text.includes('utility 3000r') ||
    text.includes('thermo king') ||
    text.includes('carrier');
  const flatbedLike =
    text.includes('flatbed') ||
    text.includes('step deck') ||
    text.includes('drop deck');

  return inTruckRange || reeferLike || flatbedLike;
}

function normalizeUnitType(v) {
  const text = `${v.name || ''} ${v.make || ''} ${v.model || ''} ${v.notes || ''}`.toLowerCase();
  if (
    text.includes('reefer') ||
    text.includes('utility 3000r') ||
    text.includes('thermo king') ||
    text.includes('carrier')
  ) return 'reefer';
  if (
    text.includes('flatbed') ||
    text.includes('step deck') ||
    text.includes('drop deck')
  ) return 'flatbed';
  return 'tractor';
}

function defaultRulesForVehicle(v) {
  const make = String(v.make || '').toUpperCase();
  const type = normalizeUnitType(v);

  const tractorBase = [
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

  const reeferBase = [
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

  const flatbedBase = [
    { serviceType: 'Trailer PM', category: 'maintenance', intervalMiles: null, intervalDays: 180 },
    { serviceType: 'Lubrication', category: 'maintenance', intervalMiles: null, intervalDays: 90 },
    { serviceType: 'Tires', category: 'tire', intervalMiles: 25000, intervalDays: 90 },
    { serviceType: 'Brakes', category: 'maintenance', intervalMiles: 50000, intervalDays: 180 },
    { serviceType: 'Annual Inspection', category: 'maintenance', intervalMiles: null, intervalDays: 365 },
    { serviceType: 'Repair', category: 'repair', intervalMiles: null, intervalDays: null },
    { serviceType: 'Accident Report', category: 'accident', intervalMiles: null, intervalDays: null }
  ];

  if (type === 'reefer') return reeferBase;
  if (type === 'flatbed') return flatbedBase;

  if (make.includes('MACK') || make.includes('VOLVO')) {
    return tractorBase.map(x => {
      if (x.serviceType === 'Differential Service') return { ...x, intervalMiles: 250000 };
      if (x.serviceType === 'DPF Ash Clean') return { ...x, intervalMiles: 250000 };
      return x;
    });
  }

  if (make.includes('PETERBILT')) {
    return tractorBase.map(x => {
      if (x.serviceType === 'Air Dryer Cartridge') return { ...x, intervalMiles: 150000, intervalDays: 365 };
      if (x.serviceType === 'DPF Ash Clean') return { ...x, intervalMiles: 250000 };
      return x;
    });
  }

  return tractorBase;
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
  const records = erpStore.records || [];
  const currentMileage = erpStore.currentMileage || {};
  const unitOverrides = erpStore.unitOverrides || {};

  return vehicles.map(v => {
    const unit = v.name;
    const rules = unitOverrides[unit]?.rules || defaultRulesForVehicle(v);
    const unitRecords = records.filter(r => r.unit === unit);

    return rules.map(rule => {
      const sameType = unitRecords
        .filter(r => r.serviceType === rule.serviceType)
        .sort((a, b) => {
          const da = `${a.serviceDate || ''} ${a.serviceMileage || ''}`;
          const db = `${b.serviceDate || ''} ${b.serviceMileage || ''}`;
          return da < db ? 1 : -1;
        });

      const last = sameType[0] || null;
      const currentMiles = safeNum(currentMileage[unit], null);
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
        unitType: normalizeUnitType(v),
        category: rule.category || 'maintenance',
        serviceType: rule.serviceType,
        intervalMiles: rule.intervalMiles,
        intervalDays: rule.intervalDays,
        currentMileage: currentMiles,
        lastServiceDate: last?.serviceDate || '',
        lastServiceMileage: last?.serviceMileage ?? '',
        nextDueMileage: nextDueMiles,
        nextDueDate,
        vendor: last?.vendor || '',
        cost: last?.cost ?? '',
        notes: last?.notes || '',
        qboSyncStatus: last?.qboSyncStatus || '',
        qboPurchaseId: last?.qboPurchaseId || '',
        status: calcStatus(nextDueMiles, nextDueDate, currentMiles)
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

    rows.forEach(r => {
      const expected = safeNum(r.expectedTireLifeMiles, null);
      const install = safeNum(r.installMileage, null);
      const remove = safeNum(r.removeMileage, null);
      if (expected != null && install != null && remove != null) {
        const life = remove - install;
        if (life > 0 && life < expected * 0.5) {
          alerts.push({
            unit,
            type: 'Low Tire Life',
            severity: 'past due',
            message: `Tire removed early at ${life} miles vs expected ${expected}`
          });
        }
      }
    });
  });

  return alerts;
}

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
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`QuickBooks refresh failed: ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'QuickBooks refresh failed');
  }

  store.tokens = {
    ...store.tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || store.tokens.refresh_token,
    id_token: data.id_token || store.tokens.id_token || '',
    expires_in: data.expires_in,
    x_refresh_token_expires_in: data.x_refresh_token_expires_in,
    expires_at: nowSec + Number(data.expires_in || 3600)
  };

  writeQbo(store);
  return store.tokens;
}

async function qboGet(pathname) {
  const store = readQbo();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');

  const tokens = await qboRefreshIfNeeded();
  const url = `${QBO_API_BASE}/v3/company/${store.tokens.realmId}/${pathname}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json'
    }
  });

  const raw = await response.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`QuickBooks GET failed: ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(data?.Fault?.Error?.[0]?.Message || 'QuickBooks GET failed');
  }

  return data;
}

async function qboPost(pathname, payload) {
  const store = readQbo();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');

  const tokens = await qboRefreshIfNeeded();
  const url = `${QBO_API_BASE}/v3/company/${store.tokens.realmId}/${pathname}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`QuickBooks POST failed: ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    const msg =
      data?.Fault?.Error?.[0]?.Message ||
      data?.Fault?.Error?.[0]?.Detail ||
      'QuickBooks POST failed';
    throw new Error(msg);
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
  const companyName = sanitizeName(body.companyName || displayName);

  const existing = await qboQuery(
    `select * from Vendor where DisplayName = '${String(displayName).replace(/'/g, "\\'")}' maxresults 1`
  );

  const existingVendor = existing?.QueryResponse?.Vendor?.[0];
  if (existingVendor) {
    return { vendor: existingVendor, created: false };
  }

  const payload = {
    DisplayName: displayName,
    CompanyName: companyName,
    PrimaryPhone: body.phone ? { FreeFormNumber: String(body.phone).slice(0, 21) } : undefined,
    PrimaryEmailAddr: body.email ? { Address: String(body.email).slice(0, 100) } : undefined
  };

  if (body.address) {
    payload.BillAddr = {
      Line1: String(body.address).slice(0, 500)
    };
  }

  const created = await qboPost('vendor', payload);
  return { vendor: created?.Vendor || null, created: true };
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

  let line = null;
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
      EntityRef: {
        type: 'Vendor',
        value: ap.qboVendorId
      },
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

/* dispatcher */

app.get('/api/samsara/vehicles', async (_req, res) => {
  try {
    const data = await fetchJson('https://api.samsara.com/fleet/vehicles', {
      headers: samsaraHeaders()
    });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

app.get('/api/samsara/live', async (_req, res) => {
  try {
    const data = await fetchJson(
      'https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates',
      { headers: samsaraHeaders() }
    );
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

app.get('/api/samsara/hos', async (_req, res) => {
  const tries = [
    'https://api.samsara.com/fleet/hos/clocks',
    'https://api.samsara.com/fleet/drivers/hos/clocks'
  ];

  for (const url of tries) {
    try {
      const data = await fetchJson(url, { headers: samsaraHeaders() });
      return res.json(data);
    } catch {}
  }

  res.json({ data: [] });
});

app.get('/api/samsara/assignments', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const url = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    url.searchParams.set('filterBy', 'vehicles');
    url.searchParams.set('startTime', startTime);
    url.searchParams.set('endTime', endTime);

    const data = await fetchJson(url.toString(), { headers: samsaraHeaders() });
    res.json(data);
  } catch {
    res.json({ data: [] });
  }
});

app.get('/api/board', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);

    const [vehicles, live, hos, assignments] = await Promise.all([
      fetchJson('https://api.samsara.com/fleet/vehicles', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/hos/clocks', { headers: samsaraHeaders() }).catch(() => ({ data: [] })),
      fetchJson(assignmentsUrl.toString(), { headers: samsaraHeaders() }).catch(() => ({ data: [] }))
    ]);

    res.json({
      vehicles: vehicles.data || [],
      live: live.data || [],
      hos: hos.data || [],
      assignments: assignments.data || [],
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message, details: error.details || null });
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
      const results = (data.results || []).map(x => ({
        lat: Number(x.lat),
        lon: Number(x.lon),
        name: x.formatted || q
      }));
      return res.json(results);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IH35-Dispatcher-App', Accept: 'application/json' }
    });

    const raw = await response.text();
    let data = [];
    try { data = JSON.parse(raw); } catch { return res.json([]); }

    const results = (Array.isArray(data) ? data : []).map(x => ({
      lat: Number(x.lat),
      lon: Number(x.lon),
      name: x.display_name || q
    }));
    res.json(results);
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
      const results = (data.results || []).map(x => ({
        name: x.formatted || x.address_line1 || x.city || q
      }));
      return res.json(results);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'IH35-Dispatcher-App', Accept: 'application/json' }
    });

    const raw = await response.text();
    let data = [];
    try { data = JSON.parse(raw); } catch { return res.json([]); }

    const results = (Array.isArray(data) ? data : []).map(x => ({
      name: x.display_name
    }));

    res.json(results);
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
    res.status(error.status || 500).json({ error: error.message, details: error.details || null });
  }
});

/* QuickBooks */

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
    let data = {};
    try { data = JSON.parse(raw); } catch {
      return res.status(500).send(`QuickBooks token exchange failed: ${raw.slice(0, 200)}`);
    }

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
      x_refresh_token_expires_in: data.x_refresh_token_expires_in,
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
          <p>You can close this page and return to the maintenance module.</p>
          <p><a href="/maintenance.html">Go to Maintenance Module</a></p>
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
    res.json({
      ok: true,
      created: result.created,
      vendor: result.vendor,
      cache
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* AP */

app.post('/api/erp/ap-transaction', (req, res) => {
  const body = req.body || {};
  if (!body.txnType) return res.status(400).json({ error: 'Transaction type is required' });
  if (!body.detailMode) return res.status(400).json({ error: 'Detail mode is required' });
  if (!body.qboVendorId) return res.status(400).json({ error: 'QuickBooks vendor is required' });
  if (!(safeNum(body.amount, 0) > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });

  const erp = readErp();
  const ap = {
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
  };

  erp.apTransactions.push(ap);
  writeErp(erp);
  res.json({ ok: true, ap });
});

app.post('/api/qbo/post-ap/:id', async (req, res) => {
  const erp = readErp();
  const idx = (erp.apTransactions || []).findIndex(x => String(x.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'AP transaction not found' });

  try {
    const ap = erp.apTransactions[idx];
    const result = await qboCreateApTransaction(ap);

    erp.apTransactions[idx] = {
      ...ap,
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

/* maintenance */

app.get('/api/maintenance/dashboard', async (_req, res) => {
  try {
    const vehiclesRes = await fetchJson('https://api.samsara.com/fleet/vehicles', {
      headers: samsaraHeaders()
    });

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

    const tracked = Array.from(trackedMap.values()).sort((a, b) => {
      const ua = parseUnitNumber(a.name);
      const ub = parseUnitNumber(b.name);
      if (ua == null && ub == null) return String(a.name).localeCompare(String(b.name));
      if (ua == null) return 1;
      if (ub == null) return -1;
      return ua - ub;
    });

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

app.get('/api/maintenance/records', (_req, res) => {
  const data = readErp();
  res.json(data);
});

app.post('/api/maintenance/mileage', (req, res) => {
  const { unit, currentMileage } = req.body || {};
  if (!unit) return res.status(400).json({ error: 'unit is required' });

  const erp = readErp();
  if (!erp.currentMileage) erp.currentMileage = {};
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
  if (!Array.isArray(erp.records)) erp.records = [];

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
      qboItemId: '',
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
