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
import { ensureTmsSchema } from './lib/tms-schema.mjs';
import tmsRouter, { fetchLoadSettlementContextByNumber } from './routes/tms.mjs';
import { buildSettlementByLoad, buildSettlementIndex, normLoadKey } from './lib/settlement-by-load.mjs';
import pdfRouter from './routes/pdf.mjs';
import documentParseRouter from './routes/document-parse.mjs';
import integrationsRouter from './routes/integrations.mjs';
import { syncAllLoadDocumentsToQboInvoice } from './lib/qbo-attachments.mjs';

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
const DEFAULT_QBO_BANK_ACCOUNT_ID = String(process.env.DEFAULT_QBO_BANK_ACCOUNT_ID || '').trim();
const DEFAULT_QBO_INVOICE_ITEM_ID = String(process.env.DEFAULT_QBO_INVOICE_ITEM_ID || '').trim();
const DEFAULT_QBO_LINEHAUL_ITEM_ID = String(process.env.DEFAULT_QBO_LINEHAUL_ITEM_ID || '').trim();

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

const DRIVER_SETTLEMENT_PAY_PCT = safeNum(process.env.DRIVER_SETTLEMENT_PAY_PCT, null);

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
    records: [],
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
      classes: [],
      accountsBank: [],
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
  if (!Array.isArray(merged.records)) merged.records = [];
  if (!merged.records.length && merged.legacyRecords.length) {
    merged.records = [...merged.legacyRecords];
  }
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
  if (!Array.isArray(merged.qboCache.classes)) merged.qboCache.classes = [];
  if (!Array.isArray(merged.qboCache.accountsBank)) merged.qboCache.accountsBank = [];

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

/** Paginate Samsara HOS clocks (max 512 per page, up to ~10k drivers). */
async function fetchAllSamsaraHosClocks() {
  if (!SAMSARA_API_TOKEN) return [];
  const all = [];
  let after = '';
  for (let page = 0; page < 24; page++) {
    const url = new URL('https://api.samsara.com/fleet/hos/clocks');
    url.searchParams.set('limit', '512');
    if (after) url.searchParams.set('after', after);
    let res;
    try {
      res = await fetchJson(url.toString(), { headers: samsaraHeaders() });
    } catch (err) {
      logError('fetchAllSamsaraHosClocks', err);
      break;
    }
    const chunk = Array.isArray(res?.data) ? res.data : [];
    all.push(...chunk);
    const pag = res?.pagination || {};
    if (!pag.hasNextPage || !chunk.length) break;
    after = pag.endCursor || '';
    if (!after) break;
  }
  return all;
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

/** Per-unit maintenance urgency for dispatch (PM past due / due soon + out-of-service records). */
function aggregateDispatchMaintenanceAlerts(dashboardRows, erp) {
  const map = new Map();
  for (const r of dashboardRows) {
    const u = String(r.unit || '').trim();
    if (!u) continue;
    if (!map.has(u)) {
      map.set(u, { unit: u, worst: 'current', pastDue: [], dueSoon: [] });
    }
    const e = map.get(u);
    if (r.status === 'past due') {
      e.worst = 'past due';
      e.pastDue.push({
        serviceType: r.serviceType,
        nextDueMileage: r.nextDueMileage,
        nextDueDate: r.nextDueDate
      });
    } else if (r.status === 'due soon') {
      if (e.worst !== 'past due') e.worst = 'due soon';
      e.dueSoon.push({
        serviceType: r.serviceType,
        nextDueMileage: r.nextDueMileage,
        nextDueDate: r.nextDueDate
      });
    }
  }

  for (const rec of erp.records || []) {
    const st = String(rec.serviceType || '').toLowerCase();
    const oos = st.includes('out of service') || st.includes('out-of-service') || st === 'oos';
    if (!oos) continue;
    const u = String(rec.unit || '').trim();
    if (!u) continue;
    if (!map.has(u)) {
      map.set(u, { unit: u, worst: 'current', pastDue: [], dueSoon: [], outOfService: true, oosNotes: [] });
    }
    const e = map.get(u);
    e.outOfService = true;
    if (!e.oosNotes) e.oosNotes = [];
    const note = String(rec.notes || '').trim();
    if (note) e.oosNotes.push(note.slice(0, 240));
  }

  const out = {};
  for (const [, e] of map) {
    const hasPmIssue = e.worst === 'past due' || e.worst === 'due soon';
    if (!e.outOfService && !hasPmIssue) continue;

    const level = e.outOfService ? 'critical' : e.worst === 'past due' ? 'high' : 'medium';
    const reasons = [];
    if (e.outOfService) {
      reasons.push('Unit has an out-of-service maintenance record — verify clearance before dispatch.');
      for (const n of (e.oosNotes || []).slice(0, 2)) reasons.push(`Note: ${n}`);
    }
    for (const p of (e.pastDue || []).slice(0, 10)) {
      reasons.push(
        `PM past due: ${p.serviceType}` +
          (p.nextDueMileage != null ? ` (target ≤ ${p.nextDueMileage} mi)` : '') +
          (p.nextDueDate ? ` · ${p.nextDueDate}` : '')
      );
    }
    for (const d of (e.dueSoon || []).slice(0, 8)) {
      reasons.push(`PM due soon: ${d.serviceType}${d.nextDueDate ? ` · ${d.nextDueDate}` : ''}`);
    }

    out[e.unit] = {
      level,
      worstStatus: e.outOfService ? 'out_of_service' : e.worst,
      outOfService: !!e.outOfService,
      reasons: reasons.slice(0, 16),
      summary:
        level === 'critical'
          ? 'Out of service — do not dispatch without maintenance clearance.'
          : level === 'high'
            ? 'Preventive maintenance past due — confirm with shop before dispatch.'
            : 'Preventive maintenance due soon — review before dispatch.'
    };
  }
  return out;
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

function qboTxnWindowStartIso(days) {
  const n = Math.min(366, Math.max(0, Number(days) || 0));
  if (!n) return null;
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function normalizeQboBill(b) {
  return {
    id: b.Id,
    docNumber: b.DocNumber || '',
    txnDate: b.TxnDate || '',
    dueDate: b.DueDate || '',
    totalAmt: safeNum(b.TotalAmt, 0) || 0,
    balance: safeNum(b.Balance, 0) || 0,
    vendorId: b.VendorRef?.value || '',
    vendorName: b.VendorRef?.name || ''
  };
}

function normalizeQboPurchase(p) {
  return {
    id: p.Id,
    docNumber: p.DocNumber || '',
    txnDate: p.TxnDate || '',
    totalAmt: safeNum(p.TotalAmt, 0) || 0,
    vendorId: p.EntityRef?.value || '',
    vendorName: p.EntityRef?.name || '',
    paymentType: p.PaymentType || ''
  };
}

function normalizeQboVendorCredit(v) {
  return {
    id: v.Id,
    docNumber: v.DocNumber || '',
    txnDate: v.TxnDate || '',
    totalAmt: safeNum(v.TotalAmt, 0) || 0,
    vendorId: v.VendorRef?.value || '',
    vendorName: v.VendorRef?.name || ''
  };
}

function normalizeQboInvoice(inv) {
  return {
    id: inv.Id,
    docNumber: inv.DocNumber || '',
    txnDate: inv.TxnDate || '',
    dueDate: inv.DueDate || '',
    totalAmt: safeNum(inv.TotalAmt, 0) || 0,
    balance: safeNum(inv.Balance, 0) || 0,
    customerId: inv.CustomerRef?.value || '',
    customerName: inv.CustomerRef?.name || ''
  };
}

async function qboFetchTransactionActivity(startDate) {
  if (!startDate) {
    return { bills: [], purchases: [], vendorCredits: [], invoices: [] };
  }
  const esc = String(startDate).replace(/[^0-9-]/g, '');
  const [billsData, purchasesData, vcData, invData] = await Promise.all([
    qboQuery(`select * from Bill where TxnDate >= '${esc}' MAXRESULTS 200`).catch(err => {
      logError('qboSync bills', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from Purchase where TxnDate >= '${esc}' MAXRESULTS 200`).catch(err => {
      logError('qboSync purchases', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from VendorCredit where TxnDate >= '${esc}' MAXRESULTS 200`).catch(err => {
      logError('qboSync vendor credits', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from Invoice where TxnDate >= '${esc}' MAXRESULTS 200`).catch(err => {
      logError('qboSync invoices', err);
      return { QueryResponse: {} };
    })
  ]);
  const bills = (billsData?.QueryResponse?.Bill || []).map(normalizeQboBill);
  const purchases = (purchasesData?.QueryResponse?.Purchase || []).map(normalizeQboPurchase);
  const vendorCredits = (vcData?.QueryResponse?.VendorCredit || []).map(normalizeQboVendorCredit);
  const invoices = (invData?.QueryResponse?.Invoice || []).map(normalizeQboInvoice);
  return { bills, purchases, vendorCredits, invoices };
}

function summarizePostingRows(rows) {
  const list = rows || [];
  let posted = 0;
  let error = 0;
  let localOnly = 0;
  for (const r of list) {
    const s = String(r.qboSyncStatus || '').toLowerCase();
    const id = r.qboEntityId || r.qboPurchaseId;
    if (s === 'error') error++;
    else if (id || s === 'posted') posted++;
    else localOnly++;
  }
  return { total: list.length, posted, error, localOnly };
}

function buildMaintenanceCostByUnit(erp) {
  const map = new Map();
  for (const r of erp.records || []) {
    const u = String(r.unit || '—').trim() || '—';
    const cur = map.get(u) || { unit: u, recordCount: 0, costSum: 0 };
    cur.recordCount += 1;
    cur.costSum += safeNum(r.cost, 0) || 0;
    map.set(u, cur);
  }
  return [...map.values()].sort((a, b) => b.costSum - a.costSum);
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
    classes: c.classes || [],
    accountsBank: c.accountsBank || [],
    employees: c.employees || [],
    transactionActivity: c.transactionActivity || null,
    refreshedAt: c.refreshedAt || null
  };
}

async function qboSyncMasterData() {
  const [vendorsData, itemsData, accountsData, customersData, bankData, cardData, classData, employeeData] =
    await Promise.all([
      qboQuery('select * from Vendor maxresults 1000'),
      qboQuery('select * from Item maxresults 1000'),
      qboQuery('select * from Account maxresults 1000'),
      qboQuery('select * from Customer maxresults 1000'),
      qboQuery("select * from Account where AccountType = 'Bank' maxresults 200").catch(err => {
        logError('qboSync bank accounts', err);
        return { QueryResponse: {} };
      }),
      qboQuery("select * from Account where AccountType = 'Credit Card' maxresults 200").catch(err => {
        logError('qboSync credit card accounts', err);
        return { QueryResponse: {} };
      }),
      qboQuery('select * from Class maxresults 500').catch(err => {
        logError('qboSync classes', err);
        return { QueryResponse: {} };
      }),
      qboQuery('select * from Employee maxresults 500').catch(err => {
        logError('qboSync employees', err);
        return { QueryResponse: {} };
      })
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

  const paymentAccountRows = [...(bankData?.QueryResponse?.Account || []), ...(cardData?.QueryResponse?.Account || [])];
  const accountsBankById = new Map();
  for (const a of paymentAccountRows) {
    if (a.Active === false || !a.Id) continue;
    accountsBankById.set(String(a.Id), {
      qboId: a.Id,
      name: a.Name || '',
      accountType: a.AccountType || ''
    });
  }
  const accountsBank = [...accountsBankById.values()].sort((x, y) =>
    String(x.name || '').localeCompare(String(y.name || ''))
  );

  const classes = (classData?.QueryResponse?.Class || [])
    .filter(c => c.Active !== false)
    .map(c => ({
      qboId: c.Id,
      name: c.Name || '',
      fullyQualifiedName: c.FullyQualifiedName || c.Name || ''
    }));

  const employees = (employeeData?.QueryResponse?.Employee || [])
    .filter(e => e.Active !== false)
    .map(e => ({
      qboId: e.Id,
      displayName: e.DisplayName || '',
      givenName: e.GivenName || '',
      familyName: e.FamilyName || ''
    }));

  const txnDays = Math.min(366, Math.max(0, Number(process.env.QBO_SYNC_TRANSACTION_DAYS ?? 90) || 0));
  const startIso = qboTxnWindowStartIso(txnDays);
  let transactionActivity = {
    windowDays: txnDays,
    startDate: startIso,
    bills: [],
    purchases: [],
    vendorCredits: [],
    invoices: [],
    totals: { bills: 0, purchases: 0, vendorCredits: 0, invoices: 0 }
  };
  if (startIso) {
    const act = await qboFetchTransactionActivity(startIso);
    transactionActivity = {
      windowDays: txnDays,
      startDate: startIso,
      bills: act.bills,
      purchases: act.purchases,
      vendorCredits: act.vendorCredits,
      invoices: act.invoices,
      totals: {
        bills: act.bills.reduce((s, x) => s + (Number(x.totalAmt) || 0), 0),
        purchases: act.purchases.reduce((s, x) => s + (Number(x.totalAmt) || 0), 0),
        vendorCredits: act.vendorCredits.reduce((s, x) => s + (Number(x.totalAmt) || 0), 0),
        invoices: act.invoices.reduce((s, x) => s + (Number(x.totalAmt) || 0), 0)
      }
    };
  }

  const erp = readErp();
  erp.qboCache = {
    vendors,
    items,
    accounts,
    accountsExpense,
    accountsIncome,
    customers,
    classes,
    accountsBank,
    employees,
    transactionActivity,
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

async function qboCreateCustomerFromApp(body) {
  const displayName = sanitizeName(body.name || body.companyName || 'Customer');
  const existing = await qboQuery(
    `select * from Customer where DisplayName = '${String(displayName).replace(/'/g, "\\'")}' maxresults 1`
  );
  const existingCustomer = existing?.QueryResponse?.Customer?.[0];
  if (existingCustomer) return { created: false, customer: existingCustomer };

  const payload = {
    DisplayName: displayName,
    CompanyName: sanitizeName(body.companyName || displayName),
    PrimaryPhone: body.phone ? { FreeFormNumber: String(body.phone).slice(0, 21) } : undefined,
    PrimaryEmailAddr: body.email ? { Address: String(body.email).slice(0, 100) } : undefined,
    BillAddr: body.address ? { Line1: String(body.address).slice(0, 500) } : undefined
  };

  const created = await qboPost('customer', payload);
  return { created: true, customer: created?.Customer || null };
}

function buildQboSalesItemLine(itemQbo, amount, description, classId) {
  const salesDetail = {
    ItemRef: { value: itemQbo.Id, name: itemQbo.Name },
    Qty: 1,
    UnitPrice: amount
  };
  if (classId) salesDetail.ClassRef = { value: classId };
  return {
    Amount: amount,
    DetailType: 'SalesItemLineDetail',
    Description: sanitizeName(description || itemQbo.Name || 'Line', 'Line'),
    SalesItemLineDetail: salesDetail
  };
}

/** One QBO invoice: optional linehaul line plus extra service lines (each { itemId, amount, description }). */
async function qboCreateTripInvoice(opts) {
  const {
    customerId,
    amount,
    txnDate,
    docNumber,
    privateNote,
    itemId,
    classId,
    lineDescription,
    extraLines
  } = opts;
  if (!customerId) throw new Error('Customer is required');

  const extras = Array.isArray(extraLines)
    ? extraLines.filter(x => x && String(x.itemId || '').trim() && safeNum(x.amount, 0) > 0)
    : [];
  const mainAmt = safeNum(amount, 0);
  const extraSum = extras.reduce((s, x) => s + safeNum(x.amount, 0), 0);

  if (!(mainAmt > 0) && extras.length === 0) {
    throw new Error('Invoice needs a positive linehaul amount and/or at least one extra charge line');
  }

  const lines = [];

  if (mainAmt > 0) {
    if (!itemId) throw new Error('QuickBooks linehaul item id is required when trip revenue is set');
    const itemQbo = await qboFindItemById(itemId);
    if (!itemQbo) throw new Error('QuickBooks item not found for invoice');
    lines.push(buildQboSalesItemLine(itemQbo, mainAmt, lineDescription || 'Trip / linehaul', classId));
  }

  for (const ex of extras) {
    const iq = await qboFindItemById(String(ex.itemId).trim());
    if (!iq) throw new Error('QuickBooks item not found for extra charge: ' + ex.itemId);
    lines.push(
      buildQboSalesItemLine(iq, safeNum(ex.amount, 0), ex.description || iq.Name, classId)
    );
  }

  if (!lines.length) throw new Error('No invoice lines to post');

  const payload = {
    CustomerRef: { value: customerId },
    TxnDate: txnDate || new Date().toISOString().slice(0, 10),
    DocNumber: docNumber ? String(docNumber).slice(0, 21) : undefined,
    Line: lines,
    PrivateNote: sanitizeName(privateNote || '', 'Invoice')
  };

  const created = await qboPost('invoice', payload);
  return {
    qboEntityType: 'Invoice',
    qboEntityId: created?.Invoice?.Id || ''
  };
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

function resolveQboBankAccountId(erp, explicit) {
  const e = String(explicit || '').trim();
  if (e) return e;
  return DEFAULT_QBO_BANK_ACCOUNT_ID;
}

/** Match QBO Class name to vehicle unit (e.g. T160) for P&amp;L by truck. */
function qboClassIdForUnit(unitRaw, erp) {
  const u = String(unitRaw || '').trim();
  if (!u) return '';
  const classes = erp?.qboCache?.classes || [];
  const lower = u.toLowerCase();
  const hit = classes.find(c => String(c.name || '').trim().toLowerCase() === lower);
  return hit ? String(hit.qboId) : '';
}

/** Prefer explicit env, then QBO item whose name matches Line haul / Linehaul, then DEFAULT_QBO_INVOICE_ITEM_ID. */
function resolveLinehaulItemId(erp) {
  const explicit = DEFAULT_QBO_LINEHAUL_ITEM_ID;
  if (explicit) return explicit;
  const items = erp?.qboCache?.items || [];
  const re = /line\s*haul|linehaul/i;
  const hit = items.find(i => re.test(String(i.name || '')));
  if (hit?.qboId) return String(hit.qboId);
  return DEFAULT_QBO_INVOICE_ITEM_ID;
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
  const classId = qboClassIdForUnit(ap.assetUnit, erp);

  if (detailMode === 'category') {
    if (!ap.qboAccountId) throw new Error('QuickBooks category/account is required');
    const accountQbo = await qboFindAccountById(ap.qboAccountId);
    if (!accountQbo) throw new Error('QuickBooks account not found');
    const acctDetail = {
      AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
    };
    if (classId) acctDetail.ClassRef = { value: classId };
    line = {
      Amount: amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      Description: sanitizeName(ap.description || ap.memo || ap.assetUnit || 'Expense'),
      AccountBasedExpenseLineDetail: acctDetail
    };
    qboAccountId = accountQbo.Id;
  } else {
    if (!ap.qboItemId) throw new Error('QuickBooks item/service is required');
    const itemQbo = await qboFindItemById(ap.qboItemId);
    if (!itemQbo) throw new Error('QuickBooks item not found');
    const qty = safeNum(ap.qty, 1) || 1;
    const itemDetail = {
      ItemRef: { value: itemQbo.Id, name: itemQbo.Name },
      Qty: qty,
      UnitPrice: amount / qty
    };
    if (classId) itemDetail.ClassRef = { value: classId };
    line = {
      Amount: amount,
      DetailType: 'ItemBasedExpenseLineDetail',
      Description: sanitizeName(ap.description || itemQbo.Name || 'Item expense'),
      ItemBasedExpenseLineDetail: itemDetail
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
    const bankId = resolveQboBankAccountId(erp, ap.qboBankAccountId);
    if (bankId) payload.AccountRef = { value: bankId };
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

  const classId = qboClassIdForUnit(workOrder.unit, erp);
  const lines = [];
  for (const line of workOrder.lines) {
    const amount = safeNum(line.amount, 0);
    if (!(amount > 0)) continue;

    if (line.detailMode === 'item') {
      if (!line.qboItemId) throw new Error(`Missing QuickBooks item for line ${line.serviceType || line.lineType}`);
      const itemQbo = await qboFindItemById(line.qboItemId);
      if (!itemQbo) throw new Error(`QuickBooks item not found for line ${line.serviceType || line.lineType}`);
      const qty = safeNum(line.qty, 1) || 1;
      const itemDetail = {
        ItemRef: { value: itemQbo.Id, name: itemQbo.Name },
        Qty: qty,
        UnitPrice: amount / qty
      };
      if (classId) itemDetail.ClassRef = { value: classId };
      lines.push({
        Amount: amount,
        DetailType: 'ItemBasedExpenseLineDetail',
        Description: sanitizeName(
          `${line.serviceType || line.lineType || 'Line'} ${line.tirePosition || line.tirePositionText || ''}`,
          'Line'
        ),
        ItemBasedExpenseLineDetail: itemDetail
      });
    } else {
      if (!line.qboAccountId) throw new Error(`Missing QuickBooks account for line ${line.serviceType || line.lineType}`);
      const accountQbo = await qboFindAccountById(line.qboAccountId);
      if (!accountQbo) throw new Error(`QuickBooks account not found for line ${line.serviceType || line.lineType}`);
      const acctDetail = {
        AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
      };
      if (classId) acctDetail.ClassRef = { value: classId };
      lines.push({
        Amount: amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: sanitizeName(
          `${line.serviceType || line.lineType || 'Line'} ${line.tirePosition || line.tirePositionText || ''}`,
          'Line'
        ),
        AccountBasedExpenseLineDetail: acctDetail
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
        `Load/Inv:${workOrder.loadNumber || workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} Unit:${workOrder.unit || ''}`,
        'Work Order'
      )
    };
    const bankId = resolveQboBankAccountId(erp, workOrder.qboBankAccountId);
    if (bankId) payload.AccountRef = { value: bankId };
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
      `Load/Inv:${workOrder.loadNumber || workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} Unit:${workOrder.unit || ''}`,
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
      hasDatabaseUrl: !!String(process.env.DATABASE_URL || '').trim(),
      hasPcmilerKey: !!String(process.env.PCMILER_API_KEY || '').trim(),
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
app.use(pdfRouter);
app.use('/api/documents', documentParseRouter);
app.use('/api/integrations', integrationsRouter);

/**
 * One merge path for tracked fleet + live Samsara stats (odometer, fuel, GPS).
 * Used by board, maintenance dashboard, and dispatch maintenance alerts so unit
 * identity and mileage stay aligned across tabs and pages.
 */
async function fetchTrackedFleetSnapshot() {
  const [vehiclesRaw, statsRows] = await Promise.all([
    fetchVehiclesSafely(),
    fetchVehicleStatsCurrentSafely()
  ]);
  const trackedVehicles = vehiclesRaw.filter(isTrackedAsset).sort(byVehicleName);
  const enrichedVehicles = mergeVehiclesWithStats(trackedVehicles, statsRows);
  return {
    vehiclesRaw,
    statsRows,
    trackedVehicles,
    enrichedVehicles,
    refreshedAt: new Date().toISOString()
  };
}

app.get('/api/board', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);

    const [{ enrichedVehicles, statsRows, refreshedAt }, hosAll, assignmentsRes] = await Promise.all([
      fetchTrackedFleetSnapshot(),
      fetchAllSamsaraHosClocks(),
      fetchJson(assignmentsUrl.toString(), { headers: samsaraHeaders() }).catch(() => ({ data: [] }))
    ]);

    res.json({
      vehicles: enrichedVehicles,
      live: statsRows,
      hos: hosAll,
      assignments: assignmentsRes.data || [],
      refreshedAt
    });
  } catch (error) {
    logError('api/board', error);
    res.status(500).json({ error: error.message, details: error.details || null });
  }
});

app.get('/api/maintenance/dashboard', async (_req, res) => {
  try {
    const { enrichedVehicles, statsRows, trackedVehicles, refreshedAt } = await fetchTrackedFleetSnapshot();

    const erp = readErp();
    const dashboard = buildDashboardRows(enrichedVehicles, erp);

    res.json({
      vehicles: enrichedVehicles,
      dashboard,
      tireAlerts: buildTireAlerts(erp),
      workOrders: erp.workOrders || [],
      records: erp.records || [],
      refreshedAt,
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

/** Compact per-unit maintenance / repair urgency for TMS dispatch truck assignment. */
app.get('/api/maintenance/dispatch-alerts', async (_req, res) => {
  try {
    const { enrichedVehicles } = await fetchTrackedFleetSnapshot();
    const erp = readErp();
    const dashboardRows = buildDashboardRows(enrichedVehicles, erp);
    const byUnit = aggregateDispatchMaintenanceAlerts(dashboardRows, erp);
    res.json({
      ok: true,
      byUnit,
      generatedAt: new Date().toISOString(),
      vehiclesConsidered: enrichedVehicles.length
    });
  } catch (error) {
    logError('api/maintenance/dispatch-alerts', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/erp/all', (_req, res) => {
  res.json(readErp());
});

app.get('/api/maintenance/records', (_req, res) => {
  res.json(readErp());
});

app.post('/api/maintenance/mileage', (req, res) => {
  try {
    const body = req.body || {};
    const unit = String(body.unit || '').trim();
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    const m = safeNum(body.currentMileage, null);
    const erp = readErp();
    if (m != null && Number.isFinite(m) && m >= 0) erp.currentMileage[unit] = m;
    writeErp(erp);
    res.json({ ok: true, currentMileage: erp.currentMileage[unit] });
  } catch (error) {
    logError('api/maintenance/mileage', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/maintenance/record', (req, res) => {
  try {
    const body = req.body || {};
    const unit = String(body.unit || '').trim();
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    const serviceType = sanitizeName(body.serviceType || body.recordType || 'Service', 'Service');
    const erp = readErp();
    if (!Array.isArray(erp.records)) erp.records = [];
    const record = {
      id: uid('mr'),
      unit,
      recordType: String(body.recordType || 'maintenance').trim() || 'maintenance',
      serviceType,
      serviceDate: String(body.serviceDate || '').trim(),
      serviceMileage: safeNum(body.serviceMileage, null),
      vendor: String(body.vendor || '').trim(),
      cost: safeNum(body.cost, 0) || 0,
      notes: String(body.notes || '').trim(),
      loadNumber: String(body.loadNumber || body.load_number || '').trim(),
      tireCondition: String(body.tireCondition || '').trim(),
      tirePosition: String(body.tirePosition || '').trim(),
      tirePositionText: String(body.tirePositionText || '').trim(),
      tireBrand: String(body.tireBrand || '').trim(),
      tireDot: String(body.tireDot || '').trim(),
      installMileage: safeNum(body.installMileage, null),
      removeMileage: safeNum(body.removeMileage, null),
      expectedTireLifeMiles: safeNum(body.expectedTireLifeMiles, null),
      accidentAtFault: String(body.accidentAtFault || '').trim(),
      accidentLocation: String(body.accidentLocation || '').trim(),
      accidentReportNumber: String(body.accidentReportNumber || '').trim(),
      repairLocationType: String(body.repairLocationType || '').trim(),
      vendorInvoiceNumber: String(body.vendorInvoiceNumber || '').trim(),
      workOrderNumber: String(body.workOrderNumber || body.vendorWorkOrderNumber || '').trim(),
      qboSyncStatus: '',
      qboPurchaseId: '',
      qboError: '',
      createdAt: new Date().toISOString()
    };
    erp.records.push(record);
    const sm = safeNum(body.serviceMileage, null);
    if (sm != null && sm > 0) {
      erp.currentMileage[unit] = Math.max(safeNum(erp.currentMileage[unit], 0) || 0, sm);
    }
    writeErp(erp);
    res.json({ ok: true, record });
  } catch (error) {
    logError('api/maintenance/record', error);
    res.status(500).json({ error: error.message });
  }
});

async function qboPostMaintenanceRecord(recordId) {
  const erp = readErp();
  const idx = (erp.records || []).findIndex(x => String(x.id) === String(recordId));
  if (idx === -1) throw new Error('Maintenance record not found');
  const rec = erp.records[idx];
  const cost = safeNum(rec.cost, 0) || 0;
  if (!(cost > 0)) throw new Error('Record cost must be greater than zero');

  let vendorId = rec.qboVendorId || '';
  if (!vendorId && rec.vendor) {
    const vn = String(rec.vendor).trim().toLowerCase();
    const m = (erp.qboCache.vendors || []).find(v => String(v.name).toLowerCase() === vn);
    vendorId = m?.qboId || '';
  }
  if (!vendorId) {
    throw new Error('Match vendor name to a QuickBooks vendor (exact name) or refresh QBO master');
  }

  let accountId = rec.qboAccountId || '';
  if (!accountId) {
    const exp = (erp.qboCache.accountsExpense || [])[0];
    const alt = (erp.qboCache.accounts || []).find(
      a => a.accountType === 'Expense' || a.accountType === 'Cost of Goods Sold'
    );
    accountId = exp?.qboId || alt?.qboId || '';
  }
  if (!accountId) throw new Error('No expense account in QBO cache — refresh QuickBooks master');

  const apLike = {
    txnType: 'expense',
    detailMode: 'category',
    qboVendorId: vendorId,
    paymentMethodId: rec.paymentMethodId || 'pm_other',
    qboBankAccountId: rec.qboBankAccountId || '',
    qboAccountId: accountId,
    qboItemId: '',
    qty: 1,
    amount: cost,
    txnDate: rec.serviceDate || new Date().toISOString().slice(0, 10),
    dueDate: '',
    docNumber: rec.loadNumber || undefined,
    description: rec.serviceType || 'Maintenance',
    memo: rec.notes || `${rec.unit || ''} ${rec.recordType || ''}`.trim(),
    assetUnit: rec.unit || ''
  };

  const result = await qboCreateApTransaction(apLike);
  erp.records[idx] = {
    ...rec,
    qboSyncStatus: 'posted',
    qboPurchaseId: result.qboEntityId,
    qboEntityType: result.qboEntityType,
    qboError: '',
    qboVendorId: vendorId,
    qboAccountId: accountId
  };
  writeErp(erp);
  return erp.records[idx];
}

app.post('/api/qbo/post-record/:id', async (req, res) => {
  try {
    const record = await qboPostMaintenanceRecord(req.params.id);
    res.json({ ok: true, record });
  } catch (error) {
    const erp = readErp();
    const idx = (erp.records || []).findIndex(x => String(x.id) === String(req.params.id));
    if (idx !== -1) {
      erp.records[idx] = {
        ...erp.records[idx],
        qboSyncStatus: 'error',
        qboError: error.message
      };
      writeErp(erp);
    }
    logError('api/qbo/post-record', error);
    res.status(500).json({ error: error.message });
  }
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Costs in ERP + optional TMS load context (same load / invoice #). */
app.get('/api/settlement/by-load/:loadNumber', async (req, res) => {
  try {
    const raw = req.params.loadNumber != null ? decodeURIComponent(String(req.params.loadNumber)) : '';
    if (!normLoadKey(raw)) {
      return res.status(400).json({ ok: false, error: 'loadNumber is required' });
    }
    const erp = readErp();
    const report = buildSettlementByLoad(erp, raw);
    let tms = null;
    try {
      tms = await fetchLoadSettlementContextByNumber(raw);
    } catch (err) {
      logError('settlement/tms-load', err);
    }
    const revenueAmount =
      tms?.load?.revenue_amount != null && String(tms.load.revenue_amount).trim() !== ''
        ? safeNum(tms.load.revenue_amount, null)
        : null;
    const netSettlement =
      revenueAmount != null && Number.isFinite(revenueAmount)
        ? Math.round((revenueAmount - report.grandTotal) * 100) / 100
        : null;
    res.json({
      ok: true,
      ...report,
      revenueAmount,
      netSettlement,
      tms: tms
        ? {
            load: tms.load,
            stops: tms.stops,
            documents: tms.documents || [],
            settlementMiles: tms.settlementMiles || null,
            revenuePlanned: revenueAmount,
            note:
              revenueAmount != null && Number.isFinite(revenueAmount)
                ? 'Net settlement = TMS revenue − rolled-up expenses (WO + AP + unit records).'
                : 'Add trip revenue on the load in Dispatch to see net P&L here.'
          }
        : null
    });
  } catch (error) {
    logError('api/settlement/by-load', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Loads grouped by QBO driver vendor with revenue, expense rollup, and optional suggested driver pay (% of revenue). */
app.get('/api/settlements/driver-pay', async (_req, res) => {
  try {
    const erp = readErp();
    const { rows } = await dbQuery(
      `SELECT id, load_number, revenue_amount, status, qbo_driver_vendor_id, qbo_driver_vendor_name
       FROM loads
       WHERE qbo_driver_vendor_id IS NOT NULL AND btrim(qbo_driver_vendor_id) <> ''
       ORDER BY qbo_driver_vendor_id, load_number`
    );
    const byVendor = new Map();
    for (const r of rows) {
      const vid = String(r.qbo_driver_vendor_id).trim();
      let entry = byVendor.get(vid);
      if (!entry) {
        entry = {
          qboVendorId: vid,
          vendorName: String(r.qbo_driver_vendor_name || '').trim(),
          loads: []
        };
        byVendor.set(vid, entry);
      }
      let expenseRollup = 0;
      try {
        const rep = buildSettlementByLoad(erp, r.load_number);
        expenseRollup = safeNum(rep.grandTotal, 0);
      } catch (_) {
        expenseRollup = 0;
      }
      const rev = safeNum(r.revenue_amount, 0);
      const companyNet = Math.round((rev - expenseRollup) * 100) / 100;
      let suggestedDriverPay = null;
      if (
        DRIVER_SETTLEMENT_PAY_PCT != null &&
        DRIVER_SETTLEMENT_PAY_PCT >= 0 &&
        DRIVER_SETTLEMENT_PAY_PCT <= 1
      ) {
        suggestedDriverPay = Math.round(rev * DRIVER_SETTLEMENT_PAY_PCT * 100) / 100;
      }
      entry.loads.push({
        loadId: r.id,
        loadNumber: r.load_number,
        status: r.status,
        revenue: rev,
        expenseRollup,
        companyNet,
        suggestedDriverPay
      });
    }
    res.json({
      ok: true,
      drivers: [...byVendor.values()],
      driverPayPct: DRIVER_SETTLEMENT_PAY_PCT
    });
  } catch (error) {
    logError('api/settlements/driver-pay', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/settlement/export', async (req, res) => {
  try {
    const raw = String(req.query.load || '').trim();
    if (!normLoadKey(raw)) {
      return res.status(400).send('Query ?load= is required (load / invoice number).');
    }
    const erp = readErp();
    const r = buildSettlementByLoad(erp, raw);
    let tms = null;
    try {
      tms = await fetchLoadSettlementContextByNumber(raw);
    } catch (err) {
      logError('settlement/export-tms', err);
    }

    const lines = [];
    lines.push(['Settlement export', csvEscape(r.loadNumber)].join(','));
    lines.push(['Generated (UTC)', csvEscape(new Date().toISOString())].join(','));
    if (tms?.load) {
      lines.push(['TMS status', csvEscape(tms.load.status)].join(','));
      lines.push(['Customer', csvEscape(tms.load.customer_name)].join(','));
      lines.push(['Trip revenue (TMS)', csvEscape(tms.load.revenue_amount)].join(','));
      lines.push(['Loaded miles', csvEscape(tms.load.practical_loaded_miles)].join(','));
      lines.push(['Empty miles', csvEscape(tms.load.practical_empty_miles)].join(','));
    }
    lines.push('');
    lines.push(['kind', 'unit', 'description', 'amount', 'qbo status'].map(csvEscape).join(','));
    for (const row of r.lineItems || []) {
      const desc =
        row.kind === 'work_order_line'
          ? row.serviceType
          : row.kind === 'ap_transaction'
            ? row.description
            : `${row.serviceType} ${row.description || ''}`.trim();
      lines.push(
        [
          csvEscape(row.kind),
          csvEscape(row.unit),
          csvEscape(desc),
          csvEscape(row.amount),
          csvEscape(row.qboSyncStatus)
        ].join(',')
      );
    }
    lines.push('');
    lines.push(['total WO lines', csvEscape(r.totalWorkOrderLines)].join(','));
    lines.push(['total AP', csvEscape(r.totalAp)].join(','));
    lines.push(['total maintenance records', csvEscape(r.totalMaintenanceRecords)].join(','));
    lines.push(['grand total expenses', csvEscape(r.grandTotal)].join(','));
    const rev =
      tms?.load?.revenue_amount != null && String(tms.load.revenue_amount).trim() !== ''
        ? safeNum(tms.load.revenue_amount, null)
        : null;
    if (rev != null && Number.isFinite(rev)) {
      lines.push(['net settlement (revenue - expenses)', csvEscape(Math.round((rev - r.grandTotal) * 100) / 100)].join(','));
    }

    const safeName = String(r.loadNumber).replace(/[^\w.-]+/g, '_') || 'load';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="settlement-${safeName}.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/settlement/export', error);
    res.status(500).send(error.message);
  }
});

app.get('/api/settlement/index', (_req, res) => {
  try {
    const erp = readErp();
    res.json({ ok: true, loads: buildSettlementIndex(erp) });
  } catch (error) {
    logError('api/settlement/index', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/reports/summary', async (_req, res) => {
  try {
    const erp = readErp();
    const c = erp.qboCache || {};
    const posting = {
      maintenanceRecords: summarizePostingRows(erp.records),
      workOrders: summarizePostingRows(erp.workOrders),
      apTransactions: summarizePostingRows(erp.apTransactions)
    };
    let tms = { ok: false, configured: false };
    try {
      const { rows } = await dbQuery(`SELECT status, COUNT(*)::int AS c FROM loads GROUP BY status`);
      const { rows: revRows } = await dbQuery(
        `SELECT COALESCE(SUM(revenue_amount), 0)::numeric AS rev FROM loads`
      );
      const total = rows.reduce((s, r) => s + r.c, 0);
      tms = {
        ok: true,
        configured: true,
        totalLoads: total,
        byStatus: Object.fromEntries(rows.map(r => [r.status, r.c])),
        revenueSum: safeNum(revRows[0]?.rev, 0) || 0
      };
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('DATABASE_URL')) {
        tms = { ok: false, configured: false, error: 'Database not configured' };
      } else {
        tms = { ok: false, configured: true, error: msg };
      }
    }
    const ta = c.transactionActivity;
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      qboCache: {
        refreshedAt: c.refreshedAt || null,
        masterCounts: {
          vendors: (c.vendors || []).length,
          customers: (c.customers || []).length,
          items: (c.items || []).length,
          classes: (c.classes || []).length,
          employees: (c.employees || []).length,
          accounts: (c.accounts || []).length
        },
        transactionActivity: ta || null
      },
      erpCounts: {
        maintenanceRecords: (erp.records || []).length,
        workOrders: (erp.workOrders || []).length,
        apTransactions: (erp.apTransactions || []).length
      },
      posting,
      maintenanceCostByUnit: buildMaintenanceCostByUnit(erp).slice(0, 80),
      tms
    });
  } catch (error) {
    logError('api/reports/summary', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/reports/export/maintenance-by-unit.csv', (_req, res) => {
  try {
    const erp = readErp();
    const rows = buildMaintenanceCostByUnit(erp);
    const lines = [['unit', 'record_count', 'cost_sum'].join(',')].concat(
      rows.map(r =>
        [csvEscape(r.unit), String(r.recordCount), String(r.costSum.toFixed(2))].join(',')
      )
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="maintenance-by-unit.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/reports/export/maintenance-by-unit', error);
    res.status(500).send(error.message);
  }
});

app.post('/api/work-orders', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.unit) return res.status(400).json({ error: 'unit is required' });
    if (!Array.isArray(body.lines) || !body.lines.length) {
      return res.status(400).json({ error: 'At least one work order line is required' });
    }

    const erp = readErp();

    const loadRef = String(body.loadNumber || body.invoiceNumber || '').trim();
    const internalNo = String(body.internalWorkOrderNumber || '').trim();
    const vendorInv = String(body.vendorInvoiceNumber || '').trim();
    const workOrder = {
      id: uid('wo'),
      unit: body.unit,
      loadNumber: loadRef || null,
      assetCategory: body.assetCategory || '',
      serviceDate: body.serviceDate || '',
      internalWorkOrderNumber: internalNo || null,
      vendorInvoiceNumber: vendorInv || null,
      vendorWorkOrderNumber: body.vendorWorkOrderNumber || '',
      vendor: body.vendor || '',
      qboVendorId: body.qboVendorId || '',
      repairLocationType: body.repairLocationType || '',
      isInternalWorkOrder: !!body.isInternalWorkOrder,
      paymentMethodId: body.paymentMethodId || '',
      qboBankAccountId: String(body.qboBankAccountId || '').trim(),
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
      qboBankAccountId: String(body.qboBankAccountId || '').trim(),
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
      connected: !!(store.tokens?.access_token && store.tokens?.realmId),
      ...payload
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/qbo/catalog/refresh', async (_req, res) => {
  try {
    const store = readQbo();
    if (!store.tokens?.access_token) {
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

app.post('/api/qbo/create-customer', async (req, res) => {
  try {
    const result = await qboCreateCustomerFromApp(req.body || {});
    const cache = await qboSyncMasterData();
    res.json({ ok: true, created: result.created, customer: result.customer, cache });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/qbo/invoice-from-load', async (req, res) => {
  try {
    const body = req.body || {};
    const loadNumber = String(body.loadNumber || '').trim();
    if (!loadNumber) return res.status(400).json({ error: 'loadNumber is required' });

    const tms = await fetchLoadSettlementContextByNumber(loadNumber);
    if (!tms?.load) return res.status(404).json({ error: 'Load not found in TMS' });

    const load = tms.load;
    const custId = load.qbo_customer_id ? String(load.qbo_customer_id).trim() : '';
    if (!custId) {
      return res.status(400).json({ error: 'Load has no QuickBooks customer — pick a QBO customer in Dispatch' });
    }

    const revenue = safeNum(load.revenue_amount, null);
    let extras = [];
    try {
      const raw = load.invoice_extra_lines;
      if (Array.isArray(raw)) extras = raw;
      else if (typeof raw === 'string' && raw.trim()) extras = JSON.parse(raw);
    } catch {
      extras = [];
    }
    extras = extras.filter(
      x => x && String(x.qbo_item_id || '').trim() && safeNum(x.amount, 0) > 0
    );
    const hasMain = revenue != null && revenue > 0;

    if (!hasMain && extras.length === 0) {
      return res.status(400).json({
        error:
          'Set trip revenue (linehaul) and/or add extra invoice lines on the load in Dispatch before creating a QuickBooks invoice'
      });
    }

    const erp = readErp();
    const savedLinehaul = String(load.qbo_linehaul_item_id || '').trim();
    const itemId = String(
      body.qboItemId || savedLinehaul || resolveLinehaulItemId(erp) || ''
    ).trim();
    if (hasMain && !itemId) {
      return res.status(400).json({
        error:
          'Choose a linehaul QuickBooks item on the load (Book/Edit), sync catalog, or set DEFAULT_QBO_LINEHAUL_ITEM_ID on the server'
      });
    }

    const truckUnit = String(load.truck_code || '').trim();
    const classId = qboClassIdForUnit(truckUnit, erp);

    const result = await qboCreateTripInvoice({
      customerId: custId,
      amount: hasMain ? revenue : 0,
      txnDate: load.end_date || load.start_date || undefined,
      docNumber: load.load_number || loadNumber,
      privateNote: `TMS load ${load.load_number || loadNumber}`,
      itemId: hasMain ? itemId : '',
      classId,
      lineDescription: `Linehaul / trip ${load.load_number || loadNumber}`,
      extraLines: extras.map(x => ({
        itemId: String(x.qbo_item_id).trim(),
        amount: safeNum(x.amount, 0),
        description: String(x.description || '').trim() || undefined
      }))
    });

    const invId = String(result.qboEntityId || '').trim();
    if (invId && load.id) {
      await dbQuery(`UPDATE loads SET qbo_invoice_id = $1 WHERE id = $2::uuid`, [invId, load.id]);
    }
    let attachmentsSynced = { uploaded: 0, skipped: 0, errors: [] };
    if (invId && load.id) {
      try {
        attachmentsSynced = await syncAllLoadDocumentsToQboInvoice(load.id, invId);
      } catch (e) {
        attachmentsSynced = { uploaded: 0, skipped: 0, errors: [{ error: e.message || String(e) }] };
        logError('qbo attach load docs', e);
      }
    }

    res.json({
      ok: true,
      ...result,
      loadNumber: load.load_number || loadNumber,
      classApplied: !!classId,
      attachmentsSynced
    });
  } catch (error) {
    logError('api/qbo/invoice-from-load', error);
    res.status(500).json({ error: error.message });
  }
});

/** Attach any load_documents not yet synced to the load's QBO invoice (manual retry or automation). */
app.post('/api/qbo/sync-load-documents', async (req, res) => {
  try {
    const body = req.body || {};
    const loadId = String(body.loadId || '').trim();
    const loadNumber = String(body.loadNumber || '').trim();
    let loadRow = null;
    if (loadId) {
      const { rows } = await dbQuery(
        `SELECT id, load_number, qbo_invoice_id FROM loads WHERE id = $1::uuid`,
        [loadId]
      );
      loadRow = rows[0] || null;
    } else if (loadNumber) {
      const ctx = await fetchLoadSettlementContextByNumber(loadNumber);
      if (ctx?.load) {
        loadRow = {
          id: ctx.load.id,
          load_number: ctx.load.load_number,
          qbo_invoice_id: ctx.load.qbo_invoice_id
        };
      }
    } else {
      return res.status(400).json({ ok: false, error: 'loadId or loadNumber is required' });
    }
    if (!loadRow) return res.status(404).json({ ok: false, error: 'Load not found' });
    if (!loadRow.qbo_invoice_id) {
      return res.status(400).json({
        ok: false,
        error: 'Load has no QuickBooks invoice id yet — use Create in QBO on the load first'
      });
    }
    const attachmentsSynced = await syncAllLoadDocumentsToQboInvoice(loadRow.id, loadRow.qbo_invoice_id);
    res.json({ ok: true, loadNumber: loadRow.load_number, ...attachmentsSynced });
  } catch (error) {
    logError('api/qbo/sync-load-documents', error);
    res.status(500).json({ ok: false, error: error.message });
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
      const loadTripNo =
        firstValue(row, [
          'load number',
          'load no',
          'load #',
          'load/invoice',
          'trip load',
          'load'
        ]) || '';

      const workOrder = {
        id: uid('imp_wo'),
        unit,
        loadNumber: String(loadTripNo).trim() || null,
        assetCategory: '',
        serviceDate: firstValue(row, ['date', 'service date', 'last date']) || '',
        internalWorkOrderNumber:
          String(loadTripNo).trim() || firstValue(row, ['internal work order', 'work order', 'wo']) || '',
        vendorInvoiceNumber:
          String(loadTripNo).trim() || firstValue(row, ['vendor invoice', 'invoice number']) || '',
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

async function startServer() {
  await ensureTmsSchema();
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });

  const syncMin = Number(process.env.QBO_AUTO_SYNC_MINUTES ?? 360);
  const QBO_SYNC_MS = Math.max(5, Number.isFinite(syncMin) ? syncMin : 360) * 60 * 1000;
  setInterval(async () => {
    try {
      const store = readQbo();
      if (!store.tokens?.access_token) return;
      await qboSyncMasterData();
      console.log('[qbo] catalog auto-sync OK', new Date().toISOString());
    } catch (e) {
      console.warn('[qbo] catalog auto-sync failed:', e?.message || e);
    }
  }, QBO_SYNC_MS);
}

startServer();
