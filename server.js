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
import { dbQuery, getPool } from './lib/db.mjs';
import { ensureTmsSchema } from './lib/tms-schema.mjs';
import {
  ensureMaintenanceServiceCatalog,
  MAINTENANCE_SERVICE_CATALOG_SEEDS
} from './lib/maintenance-service-catalog.mjs';
import tmsRouter, { fetchLoadSettlementContextByNumber } from './routes/tms.mjs';
import { buildSettlementByLoad, buildSettlementIndex, normLoadKey } from './lib/settlement-by-load.mjs';
import pdfRouter from './routes/pdf.mjs';
import documentParseRouter from './routes/document-parse.mjs';
import integrationsRouter from './routes/integrations.mjs';
import { fetchSamsaraDriversNormalized, fetchSamsaraDriverById } from './lib/samsara-client.mjs';
import { syncAllLoadDocumentsToQboInvoice } from './lib/qbo-attachments.mjs';
import {
  setAuthUsersFilePath,
  readUsersStore,
  writeUsersStore,
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  authRequired
} from './lib/auth-users.mjs';
import {
  appendSecurityAudit,
  clientIp,
  setSecurityAuditFilePath
} from './lib/security-audit.mjs';
import { relayLineLabel, relayQuickBooksCategory, relaySpreadsheetCategory } from './lib/relay-qb-categories.mjs';
import { parseBankCsvText, suggestForBankRow } from './lib/bank-match.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3400;

const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN || '';
/** Prefer a dedicated token with Write Vehicles / Write Drivers scopes; falls back to SAMSARA_API_TOKEN. */
const SAMSARA_WRITE_API_TOKEN = String(process.env.SAMSARA_WRITE_API_TOKEN || '').trim();
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
setAuthUsersFilePath(path.join(DATA_DIR, 'app-users.json'));
setSecurityAuditFilePath(path.join(DATA_DIR, 'security-audit.log'));

const upload = multer({ storage: multer.memoryStorage() });

/** When set, fuel ledger writes + Relay file import/undo require matching header or Bearer token. */
const ERP_WRITE_SECRET = String(process.env.ERP_WRITE_SECRET || process.env.IH35_ERP_WRITE_SECRET || '').trim();

const TEAM_ACTIVITY_WARN_DAYS = Math.min(90, Math.max(1, Number(process.env.TEAM_ACTIVITY_WARN_DAYS) || 7));
const TEAM_ACTIVITY_CRITICAL_DAYS = Math.min(120, Math.max(TEAM_ACTIVITY_WARN_DAYS, Number(process.env.TEAM_ACTIVITY_CRITICAL_DAYS) || 14));

const __lastSeenThrottle = new Map();

function erpWriteTokenFromRequest(req) {
  const a = req.headers['x-ih35-erp-secret'];
  const b = req.headers['x-erp-write-secret'];
  if (typeof a === 'string' && a.trim()) return a.trim();
  if (typeof b === 'string' && b.trim()) return b.trim();
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^\s*Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : '';
}

function erpWriteAuthOk(req) {
  if (!ERP_WRITE_SECRET) return true;
  const t = erpWriteTokenFromRequest(req);
  const x = Buffer.from(t, 'utf8');
  const y = Buffer.from(ERP_WRITE_SECRET, 'utf8');
  if (x.length !== y.length) return false;
  try {
    return crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function requireErpWrite(req, res) {
  if (erpWriteAuthOk(req)) return true;
  res.status(401).json({ error: 'ERP write authentication required', authRequired: true });
  return false;
}

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (!req.originalUrl.startsWith('/api/')) return next();
  const pathOnly = req.originalUrl.split('?')[0];
  if (
    pathOnly === '/api/health' ||
    pathOnly.startsWith('/api/health/') ||
    pathOnly === '/api/auth/login' ||
    pathOnly === '/api/auth/status' ||
    pathOnly === '/api/auth/bootstrap-first-user'
  ) {
    return next();
  }
  if (!authRequired()) return next();
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^\s*Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  const session = verifySessionToken(token);
  if (!session || !session.sub) {
    return res.status(401).json({ error: 'Login required', authRequired: true });
  }
  const st = readUsersStore();
  const user = st.users.find(u => u.id === session.sub);
  if (!user) return res.status(401).json({ error: 'Invalid session', authRequired: true });
  req.authUser = { id: user.id, email: user.email, name: user.name, role: user.role || 'user' };
  next();
});

app.use((req, res, next) => {
  if (!req.originalUrl.startsWith('/api/')) return next();
  if (!req.authUser?.id) return next();
  const uid = req.authUser.id;
  const now = Date.now();
  const prev = __lastSeenThrottle.get(uid) || 0;
  if (now - prev < 120000) return next();
  __lastSeenThrottle.set(uid, now);
  setImmediate(() => {
    try {
      const st = readUsersStore();
      const u = st.users.find(x => x.id === uid);
      if (!u) return;
      u.lastSeenAt = new Date().toISOString();
      writeUsersStore(st);
    } catch (err) {
      logError('api/lastSeen', err);
    }
  });
  next();
});

function logError(label, error) {
  console.error(`\n[${label}]`);
  console.error(error?.stack || error?.message || error);
}

/** Structured console line for grep-friendly QBO audit (deletes, posts, reverts). */
function logQboEvent(message, meta) {
  const extra = meta && typeof meta === 'object' && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[QBO] ${message}${extra}`);
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
    driverProfiles: [],
    fuelPurchases: [],
    relayExpenses: [],
    /** Last confirmed Relay/fuel file import (for undo after refresh). */
    lastFuelImportBatch: null,
    /** Short audit trail of file imports (newest last). */
    fuelImportBatches: [],
    /** Monotonic counter for display work order numbers (WO-YYYY-#####). */
    workOrderSeq: 0,
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
      /** QuickBooks PaymentMethod entities (merged in UI with `paymentMethods` on the ERP file). */
      paymentMethods: [],
      employees: [],
      terms: [],
      refreshedAt: ''
    },
    /** UI labels for operational status (asset picker); used by /api/maintenance/asset-status validation. */
    operationalStatusCatalog: [
      { value: 'in_service', label: 'In service' },
      { value: 'out_of_service', label: 'Out of service' },
      { value: 'shop', label: 'In shop' },
      { value: 'roadside', label: 'Roadside / down' }
    ],
    /** Per unit name: { status, note?, updatedAt?, updatedBy? } — operational availability (OOS, shop, etc.). */
    assetStatusByUnit: {},
    /**
     * Per unit Samsara display name: false = retired / disposed — omitted from fleet lists, board, and dispatch alerts.
     * Key absent or true = active (default).
     */
    assetActiveByUnit: {},
    /** File import batches (maintenance WO / AP) for ERP-only undo — not QBO. */
    erpImportBatches: [],
    /** Bank CSV imports + user links to QBO/ERP rows (reconciliation aid). */
    bankStatementImports: [],
    bankMatchLinks: [],
    /** Shop floor queue: internal / external / roadside repair tracking. */
    maintenanceShopQueue: [],
    /** Internal employee directory for ERP permissions + contact info. */
    employees: [],
    /** Bill payments posted to QuickBooks from this app (audit + expense history). */
    qboBillPaymentLog: []
  };
}

/** Work orders excluded from rollups, dashboards, and settlement after void. */
function erpActiveWorkOrders(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

/** Assign next monotonic system work order number (WO-YYYY-#####) and bump `workOrderSeq`. Mutates `erp`. */
function allocNextWorkOrderNumber(erp) {
  const y = new Date().getFullYear();
  const cur = safeNum(erp.workOrderSeq, 0) || 0;
  erp.workOrderSeq = cur + 1;
  return `WO-${y}-${String(erp.workOrderSeq).padStart(5, '0')}`;
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
  if (!Array.isArray(merged.driverProfiles)) merged.driverProfiles = [];
  if (!Array.isArray(merged.fuelPurchases)) merged.fuelPurchases = [];
  if (!Array.isArray(merged.relayExpenses)) merged.relayExpenses = [];
  if (!Array.isArray(merged.fuelImportBatches)) merged.fuelImportBatches = [];
  if (merged.workOrderSeq == null || typeof merged.workOrderSeq !== 'number' || !Number.isFinite(merged.workOrderSeq)) {
    let mx = 0;
    for (const w of merged.workOrders || []) {
      const s = Number(w.workOrderSeq);
      if (Number.isFinite(s) && s > mx) mx = s;
      const mm = String(w.workOrderNumber || '').match(/^WO-\d{4}-(\d+)$/);
      if (mm) mx = Math.max(mx, Number(mm[1]) || 0);
    }
    merged.workOrderSeq = mx;
  }
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
  if (!Array.isArray(merged.qboCache.paymentMethods)) merged.qboCache.paymentMethods = [];
  if (!Array.isArray(merged.qboCache.employees)) merged.qboCache.employees = [];
  if (!Array.isArray(merged.qboCache.terms)) merged.qboCache.terms = [];
  if (!merged.assetStatusByUnit || typeof merged.assetStatusByUnit !== 'object') merged.assetStatusByUnit = {};
  if (!merged.assetActiveByUnit || typeof merged.assetActiveByUnit !== 'object') merged.assetActiveByUnit = {};
  if (!Array.isArray(merged.operationalStatusCatalog) || !merged.operationalStatusCatalog.length) {
    merged.operationalStatusCatalog = defaultErpData().operationalStatusCatalog;
  }
  if (!Array.isArray(merged.erpImportBatches)) merged.erpImportBatches = [];
  if (!Array.isArray(merged.bankStatementImports)) merged.bankStatementImports = [];
  if (!Array.isArray(merged.bankMatchLinks)) merged.bankMatchLinks = [];
  if (!Array.isArray(merged.maintenanceShopQueue)) merged.maintenanceShopQueue = [];
  if (!Array.isArray(merged.employees)) merged.employees = [];
  if (!Array.isArray(merged.qboBillPaymentLog)) merged.qboBillPaymentLog = [];

  for (const w of merged.workOrders || []) {
    if (w.voided == null) w.voided = false;
    if (!String(w.workOrderNumber || '').trim()) {
      w.workOrderNumber = allocNextWorkOrderNumber(merged);
    }
  }

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

function sliceIsoDate(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // YYYY-MM-DD or full ISO.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // Relay / US exports: M/D/YY or M/D/YYYY (e.g. 4/15/26)
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s|$)/);
  if (us) {
    const mo = parseInt(us[1], 10);
    const da = parseInt(us[2], 10);
    let yr = parseInt(us[3], 10);
    if (yr < 100) yr += yr >= 70 ? 1900 : 2000;
    const dt = new Date(Date.UTC(yr, mo - 1, da));
    if (Number.isNaN(dt.getTime())) return '';
    if (dt.getUTCFullYear() !== yr || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return '';
    return dt.toISOString().slice(0, 10);
  }
  return '';
}

function sanitizeDriverProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 120);
  if (!name) return null;
  const samsaraDriverId = String(raw.samsaraDriverId || '').trim().slice(0, 64);
  const cdlNumber = String(raw.cdlNumber || '').trim().slice(0, 64);
  const cdlState = String(raw.cdlState || '').trim().slice(0, 16);
  const cdlExpiry = sliceIsoDate(raw.cdlExpiry);
  const medCertExpiry = sliceIsoDate(raw.medCertExpiry);
  const drugTestExpiry = sliceIsoDate(raw.drugTestExpiry);
  const hireDate = sliceIsoDate(raw.hireDate);
  const notes = String(raw.notes || '').trim().slice(0, 5000);
  const out = { name };
  if (samsaraDriverId) out.samsaraDriverId = samsaraDriverId;
  if (cdlNumber) out.cdlNumber = cdlNumber;
  if (cdlState) out.cdlState = cdlState;
  if (cdlExpiry) out.cdlExpiry = cdlExpiry;
  if (medCertExpiry) out.medCertExpiry = medCertExpiry;
  if (drugTestExpiry) out.drugTestExpiry = drugTestExpiry;
  if (hireDate) out.hireDate = hireDate;
  if (notes) out.notes = notes;
  return out;
}

function normalizeFuelProductType(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!s) return 'diesel';
  if (s === 'def' || s.includes('def') || s.includes('urea') || s.includes('exhaust_fluid')) return 'def';
  if (s.includes('reefer')) return 'reefer';
  return 'diesel';
}

function sanitizeFuelPurchase(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const unit = sanitizeName(raw.unit || raw.assetUnit || raw.vehicle || raw.truck || '', '');
  if (!unit) return null;
  const txnDate = sliceIsoDate(raw.txnDate || raw.date || raw.purchaseDate || '');
  const numOrNull = v => (v == null || v === '' ? null : safeNum(v, null));
  const gallons = numOrNull(raw.gallons ?? raw.qty ?? raw.quantity ?? raw.gal);
  const price = numOrNull(raw.pricePerGallon ?? raw.price ?? raw.ppg);
  let total = numOrNull(raw.totalCost ?? raw.amount ?? raw.cost ?? raw.total);
  const vendor = String(raw.vendor || raw.merchant || raw.station || '').trim().slice(0, 120);
  const locationText = String(raw.location || raw.cityState || '').trim().slice(0, 180);
  const odometerMiles = numOrNull(raw.odometerMiles ?? raw.odometer ?? raw.miles);

  if (gallons != null && gallons > 0 && price != null && price > 0 && (total == null || !(total > 0))) {
    total = Math.round(gallons * price * 100) / 100;
  }
  if (!(gallons != null && gallons > 0) && !(total != null && total > 0)) return null;

  const out = {
    unit,
    txnDate: txnDate || '',
    gallons: gallons != null ? Math.round(gallons * 1000) / 1000 : null,
    pricePerGallon: price != null ? Math.round(price * 1000) / 1000 : null,
    totalCost: total != null ? Math.round(total * 100) / 100 : null,
    productType: normalizeFuelProductType(raw.productType || raw.kind || raw.fuelType || raw.fuelProduct)
  };
  if (vendor) out.vendor = vendor;
  if (locationText) out.location = locationText;
  if (odometerMiles != null && Number.isFinite(odometerMiles) && odometerMiles > 0) out.odometerMiles = Math.round(odometerMiles);
  const memo = String(raw.memo || raw.notes || raw.paymentNote || '').trim().slice(0, 500);
  if (memo) out.memo = memo;
  const lineDesc = String(raw.lineDescription || raw.description || '').trim().slice(0, 200);
  if (lineDesc) out.lineDescription = lineDesc;
  if (raw.manual === true || String(raw.entrySource || '').toLowerCase() === 'manual') out.entrySource = 'manual';
  let expNo = String(raw.expenseDocNumber || raw.manualExpenseNumber || '')
    .replace(/[^\w.-]/g, '')
    .trim();
  if (expNo.length > 21) expNo = expNo.slice(0, 21);
  if (expNo) out.expenseDocNumber = expNo;
  const loadInv = String(raw.loadInvoiceNumber || raw.loadNumber || '').trim().slice(0, 80);
  if (loadInv) out.loadInvoiceNumber = loadInv;
  const vendInv = String(raw.vendorInvoiceNumber || '').trim().slice(0, 80);
  if (vendInv) out.vendorInvoiceNumber = vendInv;
  const iwo = String(raw.internalWorkOrderNumber || raw.workOrderNumber || '').trim().slice(0, 80);
  if (iwo) out.internalWorkOrderNumber = iwo;
  return out;
}

/** Accounting → fuel expense tab: persisted QBO line draft per fuel purchase row. */
function sanitizeFuelExpenseDraft(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const str = (k, max) => String(raw[k] ?? '').trim().slice(0, max);
  const digits = (k, max) => str(k, max).replace(/[^\d]/g, '').slice(0, max);
  const pmId = str('paymentMethodId', 48)
    .replace(/[^\w.-]/g, '')
    .slice(0, 48);
  let expDraft = String(raw.expenseDocNumber || raw.expenseNumber || '')
    .replace(/[^\w.-]/g, '')
    .trim();
  if (expDraft.length > 21) expDraft = expDraft.slice(0, 21);
  const out = {
    qboClassId: digits('qboClassId', 24),
    vendorSearch: str('vendorSearch', 120),
    vendorId: digits('vendorId', 24),
    itemSearch: str('itemSearch', 120),
    itemId: digits('itemId', 24),
    qty: str('qty', 32),
    unit: str('unit', 32),
    line: str('line', 32),
    driver: str('driver', 120),
    driverVendSearch: str('driverVendSearch', 120),
    driverVendId: digits('driverVendId', 24),
    custSearch: str('custSearch', 120),
    custId: digits('custId', 24),
    paymentMethodSearch: str('paymentMethodSearch', 120),
    paymentMethodId: pmId,
    bankSearch: str('bankSearch', 160),
    qboBankAccountId: digits('qboBankAccountId', 24)
  };
  if (expDraft) out.expenseDocNumber = expDraft;
  const dm = String(raw.detailMode || '').toLowerCase();
  if (dm === 'item' || dm === 'category') out.detailMode = dm;
  const qAcct = digits('qboAccountId', 24);
  if (qAcct) out.qboAccountId = qAcct;
  return Object.values(out).some(v => v !== '') ? out : {};
}

function parseRelayExpenseNoFromNote(note) {
  const s = String(note || '').trim();
  if (!s) return '';
  // Examples: "LOAD 13087", "Load 13080", "13087"
  const m = s.match(/(?:load|invoice|expense)?\s*#?\s*(\d{4,})/i);
  return m ? String(m[1]) : '';
}

function nextRelayDocNumber(base, counterByBase) {
  const b = String(base || '').trim();
  if (!b) return '';
  const n = (counterByBase.get(b) || 0) + 1;
  counterByBase.set(b, n);
  return n === 1 ? b : `${b}-${n - 1}`;
}

/**
 * Parse Relay-style fuel workbook rows into staged fuel purchases and relay expense lines.
 * Does not read/write ERP.
 */
function buildRelayFuelImportFromRows(rows) {
  const fuelPurchases = [];
  const relayExpenses = [];
  const relayDocCounters = new Map();
  let imported = 0;
  let relayLines = 0;
  const numOrNull = v => (v == null || v === '' ? null : safeNum(v, null));

  for (const rawRow of rows) {
    const row = lowerKeyMap(rawRow);
    const relayTruck = firstValue(row, ['truck #', 'truck#', 'truck', 'unit', 'vehicle', 'asset', 'unit number']);
    const unit = sanitizeName(relayTruck, '');
    if (!unit) continue;

    const txnDate = firstValue(row, ['work_date', 'date', 'txn date', 'purchase date', 'transaction date']) || '';
    const vendor =
      firstValue(row, ['merchant_name', 'location', 'site', 'organization', 'vendor', 'merchant', 'station']) || '';
    const locationText =
      [
        firstValue(row, ['location_address']),
        firstValue(row, ['location_city']),
        firstValue(row, ['location_state']),
        firstValue(row, ['location_zip'])
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      firstValue(row, ['location', 'city', 'city/state', 'city state']) ||
      '';
    const odom = numOrNull(firstValue(row, ['odometer', 'odometer miles', 'mileage']));
    const note = firstValue(row, ['note']) || '';
    const baseExpenseNo = parseRelayExpenseNoFromNote(note);
    const productsText =
      firstValue(row, ['products', 'sub-type', 'sub_type', 'type']) ||
      firstValue(row, ['merchant_name', 'organization', 'site']) ||
      '';

    const products = [
      { kind: 'diesel', volKey: 'volume diesel', totalKey: 'total_price diesel', ppgKey: 'discounted_price diesel' },
      { kind: 'def', volKey: 'volume def', totalKey: 'total_price def', ppgKey: 'discounted_price def' },
      { kind: 'reefer', volKey: 'volume reefer', totalKey: 'total_price reefer', ppgKey: 'discounted_price reefer' },
      { kind: 'reefer_2', volKey: 'volume reefer_2', totalKey: 'total_price reefer_2', ppgKey: 'discounted_price reefer_2' },
      { kind: 'def_forecourt', volKey: 'volume def_forecourt', totalKey: 'total_price def_forecourt', ppgKey: 'discounted_price def_forecourt' }
    ];

    for (const pr of products) {
      const gallons = numOrNull(firstValue(row, [pr.volKey]));
      const total = numOrNull(firstValue(row, [pr.totalKey]));
      const price = numOrNull(firstValue(row, [pr.ppgKey]));
      if (!(gallons != null && gallons > 0) && !(total != null && total > 0)) continue;

      const p = sanitizeFuelPurchase({
        unit,
        txnDate,
        gallons,
        totalCost: total,
        pricePerGallon: price,
        odometerMiles: odom,
        vendor,
        location: locationText
      });
      if (!p) continue;
      const docNumber = nextRelayDocNumber(baseExpenseNo || 'relay', relayDocCounters);
      const qbCategory = relayQuickBooksCategory({ kind: pr.kind, productsText });
      fuelPurchases.push({
        ...p,
        productType: pr.kind,
        relayNote: String(note || '').trim().slice(0, 200),
        relayExpenseNo: baseExpenseNo || '',
        qbCategory,
        relayDocNumber: docNumber
      });
      imported++;

      relayExpenses.push({
        docNumber,
        txnDate: sliceIsoDate(txnDate),
        unit,
        vendor: String(vendor || '').trim(),
        expenseType: relayLineLabel(pr.kind),
        spreadsheetCategory: relaySpreadsheetCategory(pr.kind),
        qbCategory,
        amount: safeNum(p.totalCost, 0) || 0,
        gallons: p.gallons ?? null,
        pricePerGallon: p.pricePerGallon ?? null,
        odometerMiles: p.odometerMiles ?? null,
        location: String(locationText || '').trim(),
        memo: String(note || '').trim()
      });
      relayLines++;
    }

    const relayFee = numOrNull(firstValue(row, ['fee']));
    if (relayFee != null && relayFee > 0) {
      const docNumber = nextRelayDocNumber(baseExpenseNo || 'relay', relayDocCounters);
      relayExpenses.push({
        docNumber,
        txnDate: sliceIsoDate(txnDate),
        unit,
        vendor: String(vendor || '').trim(),
        expenseType: relayLineLabel('relay_fee'),
        spreadsheetCategory: relaySpreadsheetCategory('relay_fee'),
        qbCategory: relayQuickBooksCategory({ kind: 'relay_fee', productsText }),
        amount: Math.round(relayFee * 100) / 100,
        gallons: null,
        pricePerGallon: null,
        odometerMiles: odom != null && Number.isFinite(odom) && odom > 0 ? Math.round(odom) : null,
        location: String(locationText || '').trim(),
        memo: String(note || '').trim()
      });
      relayLines++;
    }
  }

  return { fuelPurchases, relayExpenses, imported, relayLines };
}

function relayLedgerFingerprint(r) {
  const amt = Math.round((safeNum(r.amount, 0) || 0) * 100) / 100;
  return [
    sliceIsoDate(r.txnDate || ''),
    String(r.docNumber || '').trim().toLowerCase(),
    sanitizeName(r.unit, '').toLowerCase(),
    String(r.expenseType || '').trim().toLowerCase(),
    String(amt)
  ].join('|');
}

function findRelayPreviewDuplicates(relayPreview, erp) {
  const existing = new Set();
  for (const x of erp.relayExpenses || []) {
    existing.add(relayLedgerFingerprint(x));
  }
  const matches = [];
  for (const r of relayPreview || []) {
    if (existing.has(relayLedgerFingerprint(r))) matches.push(r);
  }
  return {
    duplicateCount: matches.length,
    sample: matches.slice(0, 5).map(r => ({
      docNumber: r.docNumber,
      txnDate: r.txnDate,
      unit: r.unit,
      expenseType: r.expenseType,
      amount: r.amount,
      qbCategory: r.qbCategory
    }))
  };
}

function summarizeRelayPreview(relayExpenses) {
  const rows = relayExpenses || [];
  let total = 0;
  const byCat = {};
  for (const r of rows) {
    const amt = safeNum(r.amount, 0) || 0;
    total += amt;
    const c = String(r.qbCategory || '').trim() || '(uncategorized)';
    if (!byCat[c]) byCat[c] = { count: 0, amount: 0 };
    byCat[c].count += 1;
    byCat[c].amount += amt;
  }
  for (const k of Object.keys(byCat)) {
    byCat[k].amount = Math.round(byCat[k].amount * 100) / 100;
  }
  return { relayLineCount: rows.length, relayTotalAmount: Math.round(total * 100) / 100, byQbCategory: byCat };
}

function summarizeFuelPreview(fuelPurchases) {
  const rows = fuelPurchases || [];
  let total = 0;
  for (const r of rows) total += safeNum(r.totalCost, 0) || 0;
  return { fuelLineCount: rows.length, fuelTotalCost: Math.round(total * 100) / 100 };
}

function fuelImportMeta(erp) {
  const batches = Array.isArray(erp.fuelImportBatches) ? erp.fuelImportBatches : [];
  return {
    lastBatch: erp.lastFuelImportBatch && typeof erp.lastFuelImportBatch === 'object' ? erp.lastFuelImportBatch : null,
    recentBatches: batches.slice(-5).reverse()
  };
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

function samsaraWriteBearerToken() {
  return String(SAMSARA_WRITE_API_TOKEN || SAMSARA_API_TOKEN || '').trim();
}

async function samsaraApiPatch(pathRel, body) {
  const token = samsaraWriteBearerToken();
  if (!token) {
    const err = new Error(
      'Set SAMSARA_WRITE_API_TOKEN (write scopes) or SAMSARA_API_TOKEN to call Samsara update APIs'
    );
    err.status = 400;
    throw err;
  }
  const url = `https://api.samsara.com${pathRel.startsWith('/') ? pathRel : `/${pathRel}`}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body && typeof body === 'object' ? body : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.message || `Samsara API error (${response.status})`);
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

function pickSamsaraVehicleUpdateBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const str = (v, max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : '';
  };
  const name = str(b.name, 128);
  if (name) out.name = name;
  const notes = str(b.notes, 255);
  if (notes) out.notes = notes;
  const vin = str(b.vin, 17);
  if (vin) out.vin = vin;
  const plate = str(b.licensePlate, 12);
  if (plate) out.licensePlate = plate;
  if (b.staticAssignedDriverId != null) {
    const sid = String(b.staticAssignedDriverId).trim().slice(0, 32);
    if (sid) out.staticAssignedDriverId = sid;
  }
  return out;
}

function pickSamsaraDriverUpdateBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = {};
  const take = (key, max) => {
    if (b[key] == null) return;
    const s = String(b[key]).trim();
    if (!s) return;
    out[key] = s.slice(0, max);
  };
  take('name', 255);
  take('username', 189);
  take('phone', 255);
  take('licenseNumber', 64);
  take('licenseState', 8);
  take('timezone', 80);
  take('driverActivationStatus', 32);
  take('staticAssignedVehicleId', 32);
  if (b.notes != null) {
    const n = String(b.notes).trim().slice(0, 4096);
    if (n) out.notes = n;
  }
  return out;
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
  const inTruckRange = unitNum !== null && unitNum >= 120 && unitNum <= 178;
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

/** Retired (assetActiveByUnit[name] === false) units are hidden from board, maintenance lists, and dispatch tooling. */
function isFleetAssetActiveForLists(erp, unitName) {
  const u = String(unitName || '').trim();
  if (!u) return true;
  const m = erp?.assetActiveByUnit;
  if (!m || typeof m !== 'object') return true;
  return m[u] !== false;
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

/**
 * Normalize common Samsara vehicle identity fields (VIN, plate, ESN) for maintenance UI.
 * Field names follow Samsara Fleet API vehicle objects; availability varies by telematics hardware.
 */
function enrichSamsaraVehicle(v) {
  if (!v || typeof v !== 'object') return v;
  const ext = v.externalIds || {};
  const vin = String(v.vin || ext.samsara?.vin || ext.vin || '').trim();
  const licensePlate = String(v.licensePlate || v.license || '').trim();
  const engineSerialNumber = String(
    v.engineSerialNumber || v.engineSerial || v.esn || ext.samsara?.engineSerialNumber || ''
  ).trim();
  const serial = String(v.serial || ext.samsara?.serial || '').trim();
  const out = { ...v };
  if (vin) out.vin = vin;
  if (licensePlate) out.licensePlate = licensePlate;
  if (engineSerialNumber) out.engineSerialNumber = engineSerialNumber;
  if (serial) out.serial = serial;
  return out;
}

function lastServiceForUnitAndServiceType(erpStore, unit, serviceType, woLinesAll) {
  const st = String(serviceType || '').trim();
  const fromWo = woLinesAll
    .filter(r => r.unit === unit && String(r.serviceType || '').trim() === st)
    .map(r => ({
      serviceDate: r.serviceDate,
      serviceMileage: r.serviceMileage,
      vendor: r.vendor,
      amount: r.amount,
      qboSyncStatus: r.qboSyncStatus,
      qboEntityId: r.qboEntityId,
      vendorInvoiceNumber: r.vendorInvoiceNumber,
      workOrderNumber: r.workOrderNumber,
      loadNumber: r.loadNumber,
      _sort: `${r.serviceDate || ''} ${r.serviceMileage ?? ''}`
    }));
  const fromRec = (erpStore.records || [])
    .filter(rec => rec.unit === unit && String(rec.serviceType || '').trim() === st)
    .map(rec => ({
      serviceDate: rec.serviceDate,
      serviceMileage: rec.serviceMileage,
      vendor: rec.vendor,
      amount: rec.cost,
      qboSyncStatus: rec.qboSyncStatus,
      qboEntityId: rec.qboPurchaseId,
      vendorInvoiceNumber: rec.vendorInvoiceNumber,
      workOrderNumber: rec.workOrderNumber,
      loadNumber: rec.loadNumber,
      _sort: `${rec.serviceDate || ''} ${rec.serviceMileage ?? ''}`
    }));
  const merged = [...fromWo, ...fromRec].sort((a, b) => (a._sort < b._sort ? 1 : -1));
  return merged[0] || null;
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
    workOrderNumber: workOrder.workOrderNumber || workOrder.internalWorkOrderNumber || '',
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
  const allLines = erpActiveWorkOrders(erpStore).flatMap(flattenWorkOrderLines);

  return vehicles.flatMap(v => {
    const unit = v.name;
    const rules = defaultRulesForVehicle(v);

    const liveMiles = v.odometerMiles ?? null;
    const manualMiles = safeNum(currentMileage[unit], null);
    const effectiveMileage = liveMiles ?? manualMiles;

    return rules.map(rule => {
      const last = lastServiceForUnitAndServiceType(erpStore, unit, rule.serviceType, allLines);
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
        vendorInvoiceNumber: last?.vendorInvoiceNumber || '',
        workOrderNumber: last?.workOrderNumber || '',
        loadNumber: last?.loadNumber || '',
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
  const lines = erpActiveWorkOrders(erp)
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

function qboPathWithMinorVersion(pathname) {
  if (String(pathname).includes('minorversion=')) return pathname;
  return `${pathname}${pathname.includes('?') ? '&' : '?'}minorversion=65`;
}

async function qboGet(pathname) {
  const store = readQbo();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');
  const tokens = await qboRefreshIfNeeded();
  const path = qboPathWithMinorVersion(pathname);

  const response = await fetch(`${QBO_API_BASE}/v3/company/${store.tokens.realmId}/${path}`, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json'
    }
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `QuickBooks GET returned non-JSON (HTTP ${response.status}): ${String(raw || '').slice(0, 200)}`
    );
  }
  if (!response.ok) {
    throw new Error(enrichQboInvalidReferenceMessage(formatQboFaultMessage(data)));
  }
  return data;
}

/**
 * Delete a Purchase or Bill in QuickBooks (requires current SyncToken via read).
 * entityPath: 'purchase' | 'bill'
 */
async function qboDeletePurchaseOrBill(entityPath, entityId) {
  const id = String(entityId || '').trim();
  if (!id) throw new Error('QuickBooks entity id is required');
  const path = String(entityPath || '').toLowerCase();
  if (path !== 'purchase' && path !== 'bill') throw new Error('Only Purchase or Bill can be deleted here');

  const data = await qboGet(`${path}/${encodeURIComponent(id)}`);
  const entity = path === 'purchase' ? data.Purchase : data.Bill;
  if (!entity?.Id) throw new Error(`${path} not found in QuickBooks`);

  const store = readQbo();
  const tokens = await qboRefreshIfNeeded();
  const realmId = store.tokens.realmId;
  const url = `${QBO_API_BASE}/v3/company/${realmId}/${path}?operation=delete&minorversion=65`;
  const payload = { Id: entity.Id, SyncToken: entity.SyncToken };

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
  let out;
  try {
    out = JSON.parse(raw);
  } catch {
    throw new Error(`QuickBooks delete returned non-JSON (HTTP ${response.status}): ${String(raw || '').slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(enrichQboInvalidReferenceMessage(formatQboFaultMessage(out)));
  }
  logQboEvent('DELETE_OK', { entity: path, qboId: id });
  return out;
}

/**
 * Delete a BillPayment in QuickBooks (requires current SyncToken via read).
 * Notes:
 * - This is destructive in QBO and should be restricted.
 * - QBO returns a "Deleted" entity payload when successful.
 */
async function qboDeleteBillPayment(billPaymentId) {
  const id = String(billPaymentId || '').trim();
  if (!id) throw new Error('QuickBooks bill payment id is required');

  const data = await qboGet(`billpayment/${encodeURIComponent(id)}`);
  const entity = data?.BillPayment;
  if (!entity?.Id) throw new Error('BillPayment not found in QuickBooks');

  const store = readQbo();
  const tokens = await qboRefreshIfNeeded();
  const realmId = store.tokens.realmId;
  const url = `${QBO_API_BASE}/v3/company/${realmId}/billpayment?operation=delete&minorversion=65`;
  const payload = { Id: entity.Id, SyncToken: entity.SyncToken };

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
  let out;
  try {
    out = JSON.parse(raw);
  } catch {
    throw new Error(`QuickBooks delete returned non-JSON (HTTP ${response.status}): ${String(raw || '').slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(enrichQboInvalidReferenceMessage(formatQboFaultMessage(out)));
  }
  logQboEvent('BILL_PAYMENT_DELETE_OK', { qboBillPaymentId: id });
  return out;
}

function requireErpWriteOrAdmin(req, res) {
  if (erpWriteAuthOk(req)) return true;
  if (req.authUser && req.authUser.role === 'admin') return true;
  res.status(401).json({
    error: 'ERP write authentication or admin login required',
    authRequired: true,
    hint: 'Set X-IH35-ERP-Secret or sign in as admin (Settings)'
  });
  return false;
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
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `QuickBooks POST returned non-JSON (HTTP ${response.status}): ${String(raw || '').slice(0, 200)}`
    );
  }
  if (!response.ok) {
    throw new Error(enrichQboInvalidReferenceMessage(formatQboFaultMessage(data)));
  }
  return data;
}

/** Append operator guidance when QBO rejects a stale or wrong entity reference. */
function enrichQboInvalidReferenceMessage(message) {
  const m = String(message || '');
  if (!/invalid\s*reference\s*id/i.test(m)) return m;
  if (/Refresh QBO Master in the app, re-select the linked fields/i.test(m)) return m;
  return `${m} — QuickBooks rejected an id on this transaction (vendor, pay-from bank, class, account or item, customer, payment method mapping, etc.). Refresh QBO Master in the app, re-select the linked fields on the form or row, and post again.`;
}

/** Best-effort fault text from a QBO JSON error body (minor version errors include Detail). */
function formatQboFaultMessage(data) {
  const faults = data?.Fault?.Error;
  if (Array.isArray(faults) && faults.length) {
    return faults
      .map(e => {
        const parts = [e.Message, e.Detail].filter(Boolean);
        if (e.code) parts.push(`(${String(e.code)})`);
        return parts.join(' ').trim();
      })
      .filter(Boolean)
      .join(' | ');
  }
  return (
    String(data?.error_description || data?.error || data?.Message || data?.message || '').trim() ||
    'QuickBooks request failed'
  );
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

function normalizeQboBillPayment(bp) {
  const lineAmt = Array.isArray(bp?.Line)
    ? bp.Line.reduce((s, ln) => s + (safeNum(ln?.Amount, 0) || 0), 0)
    : 0;
  const total = safeNum(bp?.TotalAmt, 0) || lineAmt || 0;
  return {
    id: bp.Id,
    docNumber: bp.DocNumber || '',
    txnDate: bp.TxnDate || '',
    totalAmt: total,
    vendorId: bp.VendorRef?.value || '',
    vendorName: bp.VendorRef?.name || ''
  };
}

function qboMoneyRound(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/** Open (unpaid) bills from QuickBooks; optional vendor filter; optional substring search (server-side filter). */
async function qboFetchOpenBillsFromQbo(vendorQboId, opts = {}) {
  const vid = String(vendorQboId || '').replace(/\D/g, '');
  const maxRaw = Number(opts.maxResults);
  const max = Math.min(Math.max(Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 150, 1), 500);
  const sql = vid
    ? `select * from Bill where Balance > '0' AND VendorRef = '${vid}' MAXRESULTS ${max}`
    : `select * from Bill where Balance > '0' MAXRESULTS ${max}`;
  const data = await qboQuery(sql);
  const rows = data?.QueryResponse?.Bill;
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
  let list = arr.map(normalizeQboBill);
  const q = String(opts.search || '').trim().toLowerCase();
  if (q) {
    list = list.filter(b => {
      const hay = `${b.vendorName || ''} ${b.docNumber || ''} ${b.txnDate || ''} ${b.dueDate || ''} ${b.id || ''} ${b.balance}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return list.sort((a, b) => String(a.dueDate || a.txnDate).localeCompare(String(b.dueDate || b.txnDate)));
}

/** Direct read of one Bill by QBO Id; returns normalized row only if Balance is greater than zero. */
async function qboFetchOpenBillByIdFromQbo(billIdRaw) {
  const id = String(billIdRaw || '').replace(/\D/g, '');
  if (!id) {
    return { bills: [], error: 'Enter a numeric QuickBooks bill id.' };
  }
  const data = await qboGet(`bill/${encodeURIComponent(id)}`);
  const bill = data?.Bill;
  if (!bill?.Id) {
    return { bills: [], error: `Bill ${id} was not found in QuickBooks.` };
  }
  const normalized = normalizeQboBill(bill);
  const bal = qboMoneyRound(normalized.balance);
  if (!(bal > 0)) {
    return {
      bills: [],
      notice: `Bill ${id} was found but has no open balance (already paid or zero due).`
    };
  }
  return { bills: [normalized] };
}

/**
 * Create a QBO BillPayment (pay vendor bills from a bank or credit-card account).
 * body: vendorQboId, bankAccountQboId, payType ('Check' | 'CreditCard'), txnDate?, privateNote?, checkNum?, lines: [{ billId, amount }]
 */
async function qboCreateBillPaymentFromApp(body) {
  const vendorQboId = String(body?.vendorQboId || '').trim();
  const bankAccountQboId = String(body?.bankAccountQboId || '').trim();
  const payType = String(body?.payType || 'Check').trim();
  const txnDate = String(body?.txnDate || '').trim() || new Date().toISOString().slice(0, 10);
  const privateNote = String(body?.privateNote || '').trim().slice(0, 4000);
  const checkNum = String(body?.checkNum || '').trim().slice(0, 21);
  const rawLines = Array.isArray(body?.lines) ? body.lines : [];
  if (!vendorQboId) throw new Error('vendorQboId is required');
  if (!bankAccountQboId) throw new Error('bankAccountQboId is required');
  if (!rawLines.length) throw new Error('At least one bill line is required');

  const billIdsSeen = new Set();
  const linePayloads = [];
  const lineLog = [];
  let sum = 0;

  for (const ln of rawLines) {
    const billId = String(ln?.billId || '').trim();
    const amount = qboMoneyRound(ln?.amount);
    if (!billId) throw new Error('Each line needs billId');
    if (!(amount > 0)) throw new Error(`Invalid amount for bill ${billId}`);
    if (billIdsSeen.has(billId)) throw new Error(`Duplicate bill id in payment: ${billId}`);
    billIdsSeen.add(billId);

    const data = await qboGet(`bill/${encodeURIComponent(billId)}`);
    const bill = data?.Bill;
    if (!bill?.Id) throw new Error(`Bill ${billId} not found in QuickBooks`);
    const bVendor = String(bill.VendorRef?.value || '').trim();
    if (bVendor !== vendorQboId) throw new Error(`Bill ${billId} belongs to a different vendor`);
    const balance = qboMoneyRound(bill.Balance);
    if (!(balance > 0)) throw new Error(`Bill ${billId} has no open balance`);
    if (amount - balance > 0.01) throw new Error(`Bill ${billId}: pay amount exceeds balance (${balance})`);

    const billDocNumber = String(bill.DocNumber || '').trim();
    lineLog.push({
      billQboId: billId,
      billDocNumber,
      amountPaid: amount,
      balanceBefore: balance,
      balanceAfter: qboMoneyRound(balance - amount)
    });

    linePayloads.push({
      Amount: amount,
      LinkedTxn: [{ TxnId: billId, TxnType: 'Bill' }]
    });
    sum += amount;
  }

  sum = qboMoneyRound(sum);
  if (!(sum > 0)) throw new Error('Total payment must be greater than 0');

  const payload = {
    VendorRef: { value: vendorQboId },
    TxnDate: txnDate,
    TotalAmt: sum,
    Line: linePayloads
  };
  if (privateNote) payload.PrivateNote = privateNote;

  if (payType === 'CreditCard') {
    payload.PayType = 'CreditCard';
    payload.CreditCardPayment = {
      CCAccountRef: { value: bankAccountQboId }
    };
  } else {
    payload.PayType = 'Check';
    const cp = {
      BankAccountRef: { value: bankAccountQboId },
      PrintStatus: 'NotSet'
    };
    if (checkNum) cp.CheckNum = checkNum;
    payload.CheckPayment = cp;
  }

  const created = await qboPost('billpayment', payload);
  const bp = created?.BillPayment;
  return {
    billPaymentId: String(bp?.Id || '').trim(),
    docNumber: bp?.DocNumber || '',
    totalAmt: sum,
    vendorQboId,
    txnDate,
    payType,
    bankAccountQboId,
    checkNum: payType === 'Check' ? checkNum : '',
    privateNote,
    lineLog
  };
}

const QBO_BILL_PAYMENT_LOG_MAX = 2500;

function appendQboBillPaymentLogEntry(erp, req, result, body) {
  const vendors = erp.qboCache?.vendors || [];
  const banks = erp.qboCache?.accountsBank || [];
  const bankId = String(body?.bankAccountQboId || result.bankAccountQboId || '').trim();
  const vendorName =
    vendors.find(v => String(v.qboId) === String(result.vendorQboId))?.name || String(result.vendorQboId || '');
  const bankName = banks.find(b => String(b.qboId) === bankId)?.name || bankId;
  const recordedBy =
    req.authUser?.email ||
    req.authUser?.name ||
    (erpWriteAuthOk(req) ? 'erp_write_secret' : 'unknown');

  const entry = {
    id: uid('bpp'),
    createdAt: new Date().toISOString(),
    txnDate: result.txnDate,
    vendorQboId: result.vendorQboId,
    vendorName,
    bankAccountQboId: bankId,
    bankAccountName: bankName,
    payType: result.payType,
    checkNum: result.checkNum || '',
    privateNote: result.privateNote || '',
    qboBillPaymentId: result.billPaymentId,
    qboBillPaymentDocNumber: result.docNumber || '',
    totalAmt: result.totalAmt,
    lines: Array.isArray(result.lineLog) ? result.lineLog : [],
    recordedBy
  };

  if (!Array.isArray(erp.qboBillPaymentLog)) erp.qboBillPaymentLog = [];
  erp.qboBillPaymentLog.push(entry);
  if (erp.qboBillPaymentLog.length > QBO_BILL_PAYMENT_LOG_MAX) {
    erp.qboBillPaymentLog = erp.qboBillPaymentLog.slice(-QBO_BILL_PAYMENT_LOG_MAX);
  }
  return entry.id;
}

function billPaymentLogTxnSortKey(e) {
  return sliceIsoDate(e?.txnDate) || sliceIsoDate(e?.createdAt) || '';
}

function filterBillPaymentLogEntries(log, query) {
  const fromD = sliceIsoDate(query?.from);
  const toD = sliceIsoDate(query?.to);
  const vendorId = String(query?.vendorId || '').trim();
  const lim = Math.min(500, Math.max(1, Number(query?.limit) || 150));
  const arr = Array.isArray(log) ? [...log] : [];
  arr.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return arr
    .filter(e => {
      const d = billPaymentLogTxnSortKey(e);
      if (fromD && (!d || d < fromD)) return false;
      if (toD && (!d || d > toD)) return false;
      if (vendorId && String(e.vendorQboId || '') !== vendorId) return false;
      return true;
    })
    .slice(0, lim);
}

function buildBillPaymentLogCsv(entries) {
  const headers = [
    'erpLogId',
    'createdAt',
    'txnDate',
    'vendorName',
    'vendorQboId',
    'bankAccountName',
    'payType',
    'qboBillPaymentId',
    'qboBillPaymentDocNumber',
    'paymentTotal',
    'billQboId',
    'billDocNumber',
    'amountPaid',
    'balanceBefore',
    'balanceAfter',
    'checkNum',
    'privateNote',
    'recordedBy',
    'reversedAt',
    'reversedBy'
  ];
  const lines = [headers.map(csvEscape).join(',')];
  for (const e of entries) {
    const lineArr = Array.isArray(e.lines) && e.lines.length ? e.lines : [null];
    for (const ln of lineArr) {
      lines.push(
        [
          csvEscape(e.id),
          csvEscape(e.createdAt),
          csvEscape(e.txnDate),
          csvEscape(e.vendorName),
          csvEscape(e.vendorQboId),
          csvEscape(e.bankAccountName),
          csvEscape(e.payType),
          csvEscape(e.qboBillPaymentId),
          csvEscape(e.qboBillPaymentDocNumber),
          csvEscape(e.totalAmt),
          csvEscape(ln?.billQboId ?? ''),
          csvEscape(ln?.billDocNumber ?? ''),
          csvEscape(ln?.amountPaid ?? ''),
          csvEscape(ln?.balanceBefore ?? ''),
          csvEscape(ln?.balanceAfter ?? ''),
          csvEscape(e.checkNum),
          csvEscape(e.privateNote),
          csvEscape(e.recordedBy),
          csvEscape(e.reversedAt || ''),
          csvEscape(e.reversedBy || '')
        ].join(',')
      );
    }
  }
  return lines.join('\n');
}

function buildErpExpenseCandidates(erp) {
  const vendors = erp.qboCache?.vendors || [];
  const vName = id => vendors.find(v => String(v.qboId) === String(id))?.name || '';
  const out = [];
  for (const wo of erpActiveWorkOrders(erp)) {
    const lines = wo.lines || [];
    const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if (!(total > 0)) continue;
    out.push({
      kind: 'erp_wo',
      ref: wo.id,
      label: [wo.workOrderNumber && `WO ${wo.workOrderNumber}`, wo.unit || '', wo.internalWorkOrderNumber || wo.vendorInvoiceNumber || wo.id]
        .filter(Boolean)
        .join(' · '),
      amount: total,
      date: wo.serviceDate || '',
      vendorText: vName(wo.qboVendorId) || wo.vendor || '',
      memo: wo.notes || ''
    });
  }
  for (const ap of erp.apTransactions || []) {
    const a = Number(ap.amount) || 0;
    if (!(a > 0)) continue;
    out.push({
      kind: 'erp_ap',
      ref: ap.id,
      label: `AP ${ap.docNumber || ap.description || ap.id}`,
      amount: a,
      date: ap.txnDate || '',
      vendorText: vName(ap.qboVendorId) || '',
      memo: `${ap.memo || ''} ${ap.description || ''}`.trim()
    });
  }
  for (const rec of erp.records || []) {
    const c = Number(rec.cost) || 0;
    if (!(c > 0)) continue;
    out.push({
      kind: 'erp_record',
      ref: rec.id,
      label: `Maint ${rec.unit || ''} · ${rec.serviceType || ''}`,
      amount: c,
      date: rec.serviceDate || '',
      vendorText: rec.vendor || '',
      memo: rec.notes || ''
    });
  }
  return out;
}

function attachErpBillPaymentMetaToQboBillPayments(qboBillPayments, erp) {
  const log = Array.isArray(erp?.qboBillPaymentLog) ? erp.qboBillPaymentLog : [];
  if (!log.length) return qboBillPayments || [];
  const byQboId = new Map();
  for (const e of log) {
    const id = String(e?.qboBillPaymentId || '').trim();
    if (!id) continue;
    // Keep newest if duplicates exist.
    const prev = byQboId.get(id);
    if (!prev || String(e?.createdAt || '') > String(prev?.createdAt || '')) byQboId.set(id, e);
  }
  return (qboBillPayments || []).map(bp => {
    const hit = byQboId.get(String(bp?.id || '').trim());
    if (!hit) return bp;
    return {
      ...bp,
      erpLogId: hit.id || '',
      erpRecordedBy: hit.recordedBy || '',
      erpCreatedAt: hit.createdAt || ''
    };
  });
}

async function qboFetchBankingWindow(days) {
  const esc = qboTxnWindowStartIso(days);
  if (!esc) {
    return { bills: [], purchases: [], billPayments: [], vendorCredits: [] };
  }
  const [billsData, purchasesData, bpData, vcData] = await Promise.all([
    qboQuery(`select * from Bill where TxnDate >= '${esc}' MAXRESULTS 300`).catch(err => {
      logError('qbo banking bills', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from Purchase where TxnDate >= '${esc}' MAXRESULTS 300`).catch(err => {
      logError('qbo banking purchases', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from BillPayment where TxnDate >= '${esc}' MAXRESULTS 300`).catch(err => {
      logError('qbo banking bill payments', err);
      return { QueryResponse: {} };
    }),
    qboQuery(`select * from VendorCredit where TxnDate >= '${esc}' MAXRESULTS 200`).catch(err => {
      logError('qbo banking vendor credits', err);
      return { QueryResponse: {} };
    })
  ]);
  return {
    bills: (billsData?.QueryResponse?.Bill || []).map(normalizeQboBill),
    purchases: (purchasesData?.QueryResponse?.Purchase || []).map(normalizeQboPurchase),
    billPayments: (bpData?.QueryResponse?.BillPayment || []).map(normalizeQboBillPayment),
    vendorCredits: (vcData?.QueryResponse?.VendorCredit || []).map(normalizeQboVendorCredit)
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
    paymentMethods: c.paymentMethods || [],
    employees: c.employees || [],
    terms: c.terms || [],
    transactionActivity: c.transactionActivity || null,
    refreshedAt: c.refreshedAt || null
  };
}

/** Updated whenever `qboSyncMasterData` completes (also surfaced on GET /api/qbo/status). */
let lastQboCatalogServerSyncAt = null;

async function qboSyncMasterData() {
  const [
    vendorsData,
    itemsData,
    accountsData,
    customersData,
    bankData,
    cardData,
    classData,
    employeeData,
    termsData,
    paymentMethodData
  ] = await Promise.all([
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
    }),
    qboQuery('select * from Term maxresults 200').catch(err => {
      logError('qboSync terms', err);
      return { QueryResponse: {} };
    }),
    qboQuery('select * from PaymentMethod maxresults 200').catch(err => {
      logError('qboSync payment methods', err);
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
      fullyQualifiedName: a.FullyQualifiedName || a.Name || '',
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

  const paymentMethods = (paymentMethodData?.QueryResponse?.PaymentMethod || [])
    .filter(p => p && p.Active !== false && p.Id)
    .map(p => ({
      id: String(p.Id),
      name: String(p.Name || '').trim() || `Payment ${p.Id}`,
      qboType: String(p.Type || 'Other').trim() || 'Other'
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

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

  const terms = (termsData?.QueryResponse?.Term || [])
    .filter(t => t.Active !== false)
    .map(t => ({
      qboId: t.Id,
      name: t.Name || ''
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

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
    paymentMethods,
    employees,
    terms,
    transactionActivity,
    refreshedAt: new Date().toISOString()
  };
  writeErp(erp);
  lastQboCatalogServerSyncAt = erp.qboCache.refreshedAt || new Date().toISOString();
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

async function qboCreateItemFromApp(body) {
  const name = sanitizeName(body.name || body.itemName || 'Service');
  const type = String(body.type || 'Service').trim() || 'Service';
  const incomeAccountId = String(body.incomeAccountId || '').trim();
  const expenseAccountId = String(body.expenseAccountId || '').trim();
  const desc = String(body.description || '').trim().slice(0, 4000);

  const existing = await qboQuery(
    `select * from Item where Name = '${String(name).replace(/'/g, "\\'")}' maxresults 1`
  );
  const existingItem = existing?.QueryResponse?.Item?.[0];
  if (existingItem) return { created: false, item: existingItem };

  if (!incomeAccountId) throw new Error('incomeAccountId is required');
  // For Service items, ExpenseAccountRef is optional (purchase side may be disabled in QBO UI),
  // but if provided we attach it.
  const payload = {
    Name: name,
    Type: type,
    Active: true,
    IncomeAccountRef: { value: incomeAccountId },
    Description: desc || undefined
  };
  if (expenseAccountId) payload.ExpenseAccountRef = { value: expenseAccountId };

  const created = await qboPost('item', payload);
  return { created: true, item: created?.Item || null };
}

async function qboCreateAccountFromApp(body) {
  const name = sanitizeName(body.name || body.accountName || 'Account');
  const accountType = sanitizeName(body.accountType || 'Expense', 'Expense');
  const accountSubType = sanitizeName(body.accountSubType || '', '');

  const existing = await qboQuery(
    `select * from Account where Name = '${String(name).replace(/'/g, "\\'")}' maxresults 1`
  );
  const existingAcct = existing?.QueryResponse?.Account?.[0];
  if (existingAcct) return { created: false, account: existingAcct };

  const payload = {
    Name: name,
    AccountType: accountType,
    Active: true
  };
  if (accountSubType) payload.AccountSubType = accountSubType;

  const created = await qboPost('account', payload);
  return { created: true, account: created?.Account || null };
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

async function qboTryGetItemById(id) {
  const raw = String(id || '').trim().replace(/[^\d]/g, '');
  if (!raw) return null;
  try {
    const data = await qboGet(`item/${encodeURIComponent(raw)}`);
    return data?.Item || null;
  } catch {
    return null;
  }
}

async function qboFindAccountById(id) {
  const data = await qboGet(`account/${id}`);
  return data?.Account || null;
}

async function qboTryGetAccountById(id) {
  const raw = String(id || '').trim().replace(/[^\d]/g, '');
  if (!raw) return null;
  try {
    const data = await qboGet(`account/${encodeURIComponent(raw)}`);
    return data?.Account || null;
  } catch {
    return null;
  }
}

function qboExpenseAccountTypeOk(accountType) {
  const t = String(accountType || '');
  return t === 'Expense' || t === 'Cost of Goods Sold';
}

/** Category / Group / Subtotal items cannot be used as ItemBasedExpenseLineDetail on Purchases (QBO 2500). */
function qboItemTypeOkForPurchaseExpenseLine(itemType) {
  const t = String(itemType || '').trim();
  if (!t) return false;
  return !['Category', 'Group', 'Subtotal'].includes(t);
}

function findPaymentMethodLocal(erp, paymentMethodId) {
  const id = String(paymentMethodId || '').trim();
  if (!id) return null;
  const local = (erp.paymentMethods || []).find(v => String(v.id) === id);
  if (local) return local;
  return (erp.qboCache?.paymentMethods || []).find(v => String(v.id) === id) || null;
}

function resolveQboBankAccountId(erp, explicit) {
  const e = String(explicit || '').trim();
  if (e) return e;
  return DEFAULT_QBO_BANK_ACCOUNT_ID;
}

function qboDigitsId(v) {
  return String(v || '')
    .trim()
    .replace(/[^\d]/g, '');
}

/** When class cache is loaded, drop unknown class ids so QBO does not reject the whole Purchase. */
function pickValidatedQboClassId(erp, rawClassId, assetUnit) {
  const classes = erp?.qboCache?.classes || [];
  const known = new Set(classes.map(c => qboDigitsId(c.qboId)).filter(Boolean));
  if (!known.size) {
    return qboDigitsId(rawClassId) || qboClassIdForUnit(assetUnit, erp);
  }
  const fromRaw = qboDigitsId(rawClassId);
  if (fromRaw && known.has(fromRaw)) return fromRaw;
  const fromUnit = qboClassIdForUnit(assetUnit, erp);
  const u = qboDigitsId(fromUnit);
  if (u && known.has(u)) return u;
  return '';
}

function pickValidatedQboCustomerId(erp, rawCustomerId) {
  const id = qboDigitsId(rawCustomerId);
  if (!id) return '';
  const rows = erp?.qboCache?.customers || [];
  if (!rows.length) return id;
  return rows.some(r => qboDigitsId(r.qboId) === id) ? id : '';
}

/**
 * Resolve pay-from bank for Purchase; if bank accounts were synced, require a listed id
 * (prevents Invalid Reference Id from stale DEFAULT_QBO_BANK_ACCOUNT_ID or bad row data).
 */
function pickValidatedQboBankIdForPurchase(erp, explicit) {
  const id = qboDigitsId(resolveQboBankAccountId(erp, explicit));
  if (!id) return '';
  const banks = erp?.qboCache?.accountsBank || [];
  if (!banks.length) return id;
  if (banks.some(b => qboDigitsId(b.qboId) === id)) return id;
  throw new Error(
    `Pay-from bank/card QuickBooks id ${id} is not in the synced bank list — refresh QBO Master, then pick pay-from again on the row (or fix DEFAULT_QBO_BANK_ACCOUNT_ID on the server).`
  );
}

function assertQboVendorIdKnown(erp, vendorId) {
  const id = qboDigitsId(vendorId);
  if (!id) throw new Error('QuickBooks vendor is required');
  const vendors = erp?.qboCache?.vendors || [];
  if (vendors.length && !vendors.some(v => qboDigitsId(v.qboId) === id)) {
    throw new Error(
      `Vendor QuickBooks id ${id} is not in the synced vendor list — refresh QBO Master and pick the vendor again (IDs change if the vendor was recreated in QuickBooks).`
    );
  }
  return id;
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

/**
 * Single-line Purchase/Bill: avoid QBO 2500 when "item" points at a Category-type QBO item or an expense account id.
 */
async function reconcileApSingleLineForPurchase(ap) {
  const wantItem = String(ap.detailMode || 'category').toLowerCase() === 'item';
  if (!wantItem) {
    return {
      detailMode: String(ap.detailMode || 'category'),
      qboItemId: ap.qboItemId || '',
      qboAccountId: ap.qboAccountId || ''
    };
  }
  const itemDigits = String(ap.qboItemId || '').trim().replace(/[^\d]/g, '');
  const acctDigits = String(ap.qboAccountId || '').trim().replace(/[^\d]/g, '');
  if (!itemDigits) {
    if (!acctDigits) {
      throw new Error(
        'Line detail is set to item but no QuickBooks item id is stored — pick a Service/non-inventory item, or switch to category (expense account) mode.'
      );
    }
    return { detailMode: 'category', qboItemId: '', qboAccountId: acctDigits };
  }
  const itemObj = await qboTryGetItemById(itemDigits);
  if (itemObj && qboItemTypeOkForPurchaseExpenseLine(itemObj.Type)) {
    return { detailMode: 'item', qboItemId: itemDigits, qboAccountId: acctDigits };
  }
  if (itemObj && !qboItemTypeOkForPurchaseExpenseLine(itemObj.Type)) {
    const fb =
      acctDigits || String(itemObj.ExpenseAccountRef?.value || '').replace(/[^\d]/g, '') || '';
    if (!fb) {
      throw new Error(
        `QuickBooks item "${itemObj.Name || itemDigits}" is type "${itemObj.Type}" — it cannot be used as a purchase item line. Switch to category (expense account) mode or pick a Service/non-inventory item.`
      );
    }
    return { detailMode: 'category', qboItemId: '', qboAccountId: fb };
  }
  const acct = await qboTryGetAccountById(itemDigits);
  if (acct && qboExpenseAccountTypeOk(acct.AccountType)) {
    return { detailMode: 'category', qboItemId: '', qboAccountId: String(acct.Id).replace(/[^\d]/g, '') };
  }
  throw new Error(
    `QuickBooks id ${itemDigits} is not a postable item or an expense account — refresh QBO Master. For category posting, pick an expense account (not a QBO Category-type item).`
  );
}

async function qboCreateApTransaction(ap) {
  const erp = readErp();
  const txnDate = ap.txnDate || new Date().toISOString().slice(0, 10);
  const txnType = ap.txnType || 'expense';
  const amount = safeNum(ap.amount, 0);

  const vendorIdNorm = assertQboVendorIdKnown(erp, ap.qboVendorId);
  const classId = pickValidatedQboClassId(erp, ap.qboClassId, ap.assetUnit);
  const rawCostLines = Array.isArray(ap.costLines) ? ap.costLines : [];
  const costLines = rawCostLines.filter(cl => cl && typeof cl === 'object');

  if (!costLines.length) {
    const r = await reconcileApSingleLineForPurchase(ap);
    ap.detailMode = r.detailMode;
    ap.qboItemId = r.qboItemId;
    ap.qboAccountId = r.qboAccountId;
  }

  const detailMode = ap.detailMode || 'category';

  if (costLines.length > 0) {
    if (!(amount > 0)) throw new Error('Amount must be greater than 0');
    const sumLines = costLines.reduce((s, l) => s + safeNum(l.amount, 0), 0);
    if (Math.abs(sumLines - amount) > 0.05) {
      throw new Error(
        `Cost line amounts ($${sumLines.toFixed(2)}) must match transaction total ($${amount.toFixed(2)})`
      );
    }
    const lineArray = await buildQboPurchaseBillLinesFromCostLines(costLines, {
      erp,
      assetUnit: String(ap.assetUnit || '').trim(),
      classId,
      fallbackAccountId: String(ap.qboAccountId || '').trim(),
      fallbackItemId: String(ap.qboItemId || '').trim(),
      fallbackDetailMode: detailMode === 'item' ? 'item' : 'category'
    });
    if (!lineArray.length) {
      throw new Error('Add at least one cost line with amount greater than zero to post a multi-line purchase');
    }
    let qboItemId = '';
    let qboAccountId = '';
    for (const ln of lineArray) {
      if (ln.DetailType === 'AccountBasedExpenseLineDetail' && !qboAccountId) {
        qboAccountId = ln.AccountBasedExpenseLineDetail?.AccountRef?.value || '';
      }
      if (ln.DetailType === 'ItemBasedExpenseLineDetail' && !qboItemId) {
        qboItemId = ln.ItemBasedExpenseLineDetail?.ItemRef?.value || '';
      }
    }
    const privateNote = sanitizeName(
      ap.memo || `${ap.assetUnit || ''} ${ap.description || ''}`,
      txnType === 'expense' ? 'Expense' : 'Bill'
    );
    if (txnType === 'expense') {
      const paymentMethod = findPaymentMethodLocal(erp, ap.paymentMethodId);
      const paymentType = paymentMethod?.qboType || 'Other';
      const payload = {
        TxnDate: txnDate,
        DocNumber: ap.docNumber || undefined,
        PaymentType: paymentType,
        EntityRef: { type: 'Vendor', value: vendorIdNorm },
        Line: lineArray,
        PrivateNote: privateNote
      };
      const bankId = pickValidatedQboBankIdForPurchase(erp, ap.qboBankAccountId);
      if (bankId) payload.AccountRef = { value: bankId };
      const created = await qboPost('purchase', payload);
      return {
        qboEntityType: 'Purchase',
        qboEntityId: created?.Purchase?.Id || '',
        qboVendorId: vendorIdNorm,
        qboItemId,
        qboAccountId
      };
    }
    const billPayload = {
      VendorRef: { value: vendorIdNorm },
      TxnDate: txnDate,
      DueDate: ap.dueDate || '',
      DocNumber: ap.docNumber || undefined,
      Line: lineArray,
      PrivateNote: privateNote
    };
    applyQboBillTermRef(billPayload, ap.qboTermId);
    const createdBill = await qboPost('bill', billPayload);
    return {
      qboEntityType: 'Bill',
      qboEntityId: createdBill?.Bill?.Id || '',
      qboVendorId: vendorIdNorm,
      qboItemId,
      qboAccountId
    };
  }

  if (!(amount > 0)) throw new Error('Amount must be greater than 0');

  let line;
  let qboItemId = '';
  let qboAccountId = '';

  if (detailMode === 'category') {
    if (!ap.qboAccountId) throw new Error('QuickBooks category/account is required');
    const accountQbo = await qboFindAccountById(ap.qboAccountId);
    if (!accountQbo) throw new Error('QuickBooks account not found');
    const acctDetail = {
      AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
    };
    if (classId) acctDetail.ClassRef = { value: classId };
    const custA = pickValidatedQboCustomerId(erp, ap.qboCustomerId);
    if (custA) acctDetail.CustomerRef = { value: custA };
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
    const cust = pickValidatedQboCustomerId(erp, ap.qboCustomerId);
    if (cust) itemDetail.CustomerRef = { value: cust };
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
      EntityRef: { type: 'Vendor', value: vendorIdNorm },
      Line: [line],
      PrivateNote: sanitizeName(ap.memo || `${ap.assetUnit || ''} ${ap.description || ''}`, 'Expense')
    };
    const bankId = pickValidatedQboBankIdForPurchase(erp, ap.qboBankAccountId);
    if (bankId) payload.AccountRef = { value: bankId };
    const created = await qboPost('purchase', payload);
    return {
      qboEntityType: 'Purchase',
      qboEntityId: created?.Purchase?.Id || '',
      qboVendorId: vendorIdNorm,
      qboItemId,
      qboAccountId
    };
  }

  const payload = {
    VendorRef: { value: vendorIdNorm },
    TxnDate: txnDate,
    DueDate: ap.dueDate || '',
    DocNumber: ap.docNumber || undefined,
    Line: [line],
    PrivateNote: sanitizeName(ap.memo || `${ap.assetUnit || ''} ${ap.description || ''}`, 'Bill')
  };
  applyQboBillTermRef(payload, ap.qboTermId);
  const created = await qboPost('bill', payload);
  return {
    qboEntityType: 'Bill',
    qboEntityId: created?.Bill?.Id || '',
    qboVendorId: vendorIdNorm,
    qboItemId,
    qboAccountId
  };
}

async function qboCreateWorkOrderTransaction(workOrder) {
  const erp = readErp();
  if (!workOrder.qboVendorId) throw new Error('QuickBooks vendor is required on work order');
  if (!Array.isArray(workOrder.lines) || !workOrder.lines.length) throw new Error('Work order needs at least one line');

  const vendorIdNorm = assertQboVendorIdKnown(erp, workOrder.qboVendorId);
  const classId = pickValidatedQboClassId(erp, '', workOrder.unit);
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
      DocNumber: workOrderDocNumberForQbo(workOrder),
      PaymentType: paymentType,
      EntityRef: { type: 'Vendor', value: vendorIdNorm },
      Line: lines,
      PrivateNote: sanitizeName(
        `WO#${workOrder.workOrderNumber || workOrder.id} Load/Inv:${workOrder.loadNumber || workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} Unit:${workOrder.unit || ''}`,
        'Work Order'
      )
    };
    const bankId = pickValidatedQboBankIdForPurchase(erp, workOrder.qboBankAccountId);
    if (bankId) payload.AccountRef = { value: bankId };
    const created = await qboPost('purchase', payload);
    return {
      qboEntityType: 'Purchase',
      qboEntityId: created?.Purchase?.Id || ''
    };
  }

  const payload = {
    VendorRef: { value: vendorIdNorm },
    TxnDate: workOrder.serviceDate || new Date().toISOString().slice(0, 10),
    DueDate: workOrder.dueDate || '',
    DocNumber: workOrderDocNumberForQbo(workOrder),
    Line: lines,
    PrivateNote: sanitizeName(
      `WO#${workOrder.workOrderNumber || workOrder.id} Load/Inv:${workOrder.loadNumber || workOrder.internalWorkOrderNumber || ''} ${workOrder.vendorWorkOrderNumber || ''} Unit:${workOrder.unit || ''}`,
      'Work Order'
    )
  };
  applyQboBillTermRef(payload, workOrder.qboTermId);
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
      hasSamsaraWriteToken: !!(SAMSARA_WRITE_API_TOKEN || SAMSARA_API_TOKEN),
      hasGeoapifyKey: !!GEOAPIFY_API_KEY,
      hasQboConfig: qboConfigured(),
      hasDatabaseUrl: !!String(process.env.DATABASE_URL || '').trim(),
      hasPcmilerKey: !!String(process.env.PCMILER_API_KEY || '').trim(),
      dataDir: DATA_DIR,
      serverTime: new Date().toISOString(),
      samsaraVehicles: vehicles.length,
      samsaraStatsRows: stats.length,
      authRequired: authRequired(),
      userCount: readUsersStore().users.length
    });
  } catch (error) {
    res.json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/auth/status', (_req, res) => {
  const st = readUsersStore();
  res.json({
    authRequired: authRequired(),
    hasUsers: st.users.length > 0,
    userCount: st.users.length
  });
});

app.post('/api/auth/bootstrap-first-user', (req, res) => {
  try {
    const st = readUsersStore();
    if (st.users.length) return res.status(400).json({ error: 'Users already exist. Use Settings or login.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || 'Administrator').trim().slice(0, 120);
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Valid email and password (8+ chars) required' });
    }
    const user = {
      id: uid('usr'),
      email,
      name,
      role: 'admin',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    st.users.push(user);
    writeUsersStore(st);
    const token = signSessionToken({ sub: user.id, email: user.email });
    res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    logError('api/auth/bootstrap-first-user', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const st = readUsersStore();
    const user = st.users.find(u => String(u.email).toLowerCase() === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      appendSecurityAudit({
        action: 'login_failed',
        email: email || '(empty)',
        ip: clientIp(req),
        path: '/api/auth/login'
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const now = new Date().toISOString();
    user.lastLoginAt = now;
    user.lastSeenAt = now;
    writeUsersStore(st);
    appendSecurityAudit({
      action: 'login_ok',
      userId: user.id,
      email: user.email,
      ip: clientIp(req),
      path: '/api/auth/login'
    });
    const token = signSessionToken({ sub: user.id, email: user.email });
    res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role || 'user' }
    });
  } catch (error) {
    logError('api/auth/login', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!authRequired()) return res.json({ ok: true, user: null, authDisabled: true });
  if (!req.authUser) return res.status(401).json({ error: 'Not logged in' });
  const st = readUsersStore();
  const row = st.users.find(u => u.id === req.authUser.id);
  res.json({
    ok: true,
    user: {
      ...req.authUser,
      lastLoginAt: row?.lastLoginAt || null,
      lastSeenAt: row?.lastSeenAt || null
    }
  });
});

app.post('/api/auth/heartbeat', (req, res) => {
  try {
    if (!authRequired()) return res.json({ ok: true, skipped: true });
    if (!req.authUser) return res.status(401).json({ error: 'Not logged in' });
    const st = readUsersStore();
    const u = st.users.find(x => x.id === req.authUser.id);
    if (u) {
      u.lastSeenAt = new Date().toISOString();
      writeUsersStore(st);
    }
    res.json({ ok: true });
  } catch (error) {
    logError('api/auth/heartbeat', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', (req, res) => {
  if (!req.authUser || req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const st = readUsersStore();
  res.json({
    ok: true,
    users: st.users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role || 'user',
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,
      lastSeenAt: u.lastSeenAt || null
    }))
  });
});

function daysSinceIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

app.get('/api/security/posture', (req, res) => {
  try {
    if (!authRequired()) {
      return res.json({ ok: true, authDisabled: true, checks: [], theftControls: [] });
    }
    if (!req.authUser) return res.status(401).json({ error: 'Not logged in' });
    const store = readQbo();
    const qboConnected = !!store.tokens?.access_token;
    res.json({
      ok: true,
      checks: [
        {
          id: 'auth_enforced',
          ok: authRequired(),
          label: 'User authentication required',
          hint: 'Set IH35_REQUIRE_AUTH=1 after onboarding users.'
        },
        {
          id: 'erp_write_secret',
          ok: !!ERP_WRITE_SECRET,
          label: 'ERP write secret configured',
          hint: 'Set ERP_WRITE_SECRET for fuel imports, Samsara writes, and bulk reversions.'
        },
        {
          id: 'auth_secret_strong',
          ok: String(process.env.IH35_AUTH_SECRET || '').trim().length >= 24,
          label: 'Strong session signing secret (24+ chars)',
          hint: 'Replace default IH35_AUTH_SECRET in production.'
        },
        {
          id: 'samsara_token',
          ok: !!String(process.env.SAMSARA_API_TOKEN || '').trim(),
          label: 'Samsara API token configured',
          hint: 'Fleet boards and mileage depend on SAMSARA_API_TOKEN.'
        },
        {
          id: 'qbo_connected',
          ok: qboConnected,
          label: 'QuickBooks OAuth connected',
          hint: 'Connect QBO so expenses and master data stay authoritative.'
        },
        {
          id: 'postgres',
          ok: !!String(process.env.DATABASE_URL || '').trim(),
          label: 'PostgreSQL (TMS) configured',
          hint: 'DATABASE_URL enables loads, drivers, and extended catalogs.'
        }
      ],
      theftControls: [
        {
          title: 'Segregation of duties',
          detail:
            'Separate who can create vendors, import fuel, post to QuickBooks, and approve payouts. Use admin vs user roles here and permission sets inside QBO and Samsara.'
        },
        {
          title: 'Vendor and ACH fraud',
          detail:
            'Verify new vendor names against real shops before first payment. Review QuickBooks sync alerts and this server’s security-audit.log after roster changes.'
        },
        {
          title: 'Credential and device control',
          detail:
            'Do not share ERP browser write keys. Rotate Samsara and QBO tokens when staff leave; require HTTPS on public hosts and restrict office IP ranges at the reverse proxy when possible.'
        }
      ]
    });
  } catch (error) {
    logError('api/security/posture', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/security/team-activity', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }
    const st = readUsersStore();
    const rows = st.users.map(u => {
      const activityIso = u.lastSeenAt || u.lastLoginAt || u.createdAt || null;
      const daysLogin = daysSinceIso(u.lastLoginAt);
      const daysSeen = daysSinceIso(activityIso);
      let alert = 'ok';
      if (daysSeen == null || daysSeen >= TEAM_ACTIVITY_CRITICAL_DAYS) alert = 'critical';
      else if (daysSeen >= TEAM_ACTIVITY_WARN_DAYS) alert = 'warn';
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role || 'user',
        lastLoginAt: u.lastLoginAt || null,
        lastSeenAt: u.lastSeenAt || null,
        daysSinceLogin: daysLogin,
        daysSinceActivity: daysSeen,
        alert
      };
    });
    res.json({
      ok: true,
      warnDays: TEAM_ACTIVITY_WARN_DAYS,
      criticalDays: TEAM_ACTIVITY_CRITICAL_DAYS,
      disclaimer:
        'Tracks IH35 ERP sign-in and session activity (API + optional heartbeat) only. QuickBooks and Samsara staff logins are audited inside Intuit and Samsara — use their admin tools for those systems.',
      external: [
        {
          system: 'QuickBooks Online',
          link: 'https://qbo.intuit.com/app/auditlog',
          note: 'Intuit audit log (requires QBO admin rights).'
        },
        {
          system: 'Samsara',
          link: 'https://help.samsara.com/hc/en-us/articles/360021827951',
          note: 'Use Samsara Cloud admin / support for org-level access reviews.'
        }
      ],
      rows
    });
  } catch (error) {
    logError('api/security/team-activity', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/security/audit-recent', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin only' });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const fp = path.join(DATA_DIR, 'security-audit.log');
    if (!fs.existsSync(fp)) return res.json({ ok: true, events: [] });
    const raw = fs.readFileSync(fp, 'utf8');
    const lines = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit);
    const events = lines.map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return { parseError: true, raw: l.slice(0, 240) };
      }
    });
    res.json({ ok: true, events });
  } catch (error) {
    logError('api/security/audit-recent', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/users', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 120) || email;
    const role = String(req.body?.role || 'user').trim() === 'admin' ? 'admin' : 'user';
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'Email and password (8+ chars) required' });
    }
    const st = readUsersStore();
    if (st.users.some(u => String(u.email).toLowerCase() === email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const user = {
      id: uid('usr'),
      email,
      name,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    st.users.push(user);
    writeUsersStore(st);
    res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    logError('api/users POST', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/users/:id', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = String(req.params.id || '');
    const st = readUsersStore();
    const admins = st.users.filter(u => u.role === 'admin');
    const target = st.users.find(u => u.id === id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin' && admins.length <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }
    st.users = st.users.filter(u => u.id !== id);
    writeUsersStore(st);
    res.json({ ok: true });
  } catch (error) {
    logError('api/users DELETE', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Employee directory (ERP) ---
app.get('/api/erp/employees', (req, res) => {
  if (!req.authUser || req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const erp = readErp();
  res.json({ ok: true, employees: erp.employees || [] });
});

app.post('/api/erp/employees', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const email = String(body.email || '').trim().slice(0, 160);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const title = String(body.title || '').trim().slice(0, 120);
    const department = String(body.department || '').trim().slice(0, 120);
    const status = String(body.status || 'active').trim();
    if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'status must be active or inactive' });
    const now = new Date().toISOString();
    const erp = readErp();
    if (!Array.isArray(erp.employees)) erp.employees = [];
    const row = {
      id: uid('emp'),
      name,
      email,
      phone,
      title,
      department,
      status,
      createdAt: now,
      updatedAt: now
    };
    erp.employees.push(row);
    writeErp(erp);
    res.json({ ok: true, employee: row });
  } catch (error) {
    logError('api/erp/employees POST', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/erp/employees/:id', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const erp = readErp();
    const arr = Array.isArray(erp.employees) ? erp.employees : [];
    const idx = arr.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Employee not found' });
    const cur = arr[idx];
    const next = { ...cur };
    if (body.name != null) next.name = String(body.name || '').trim().slice(0, 120) || next.name;
    if (body.email != null) next.email = String(body.email || '').trim().slice(0, 160);
    if (body.phone != null) next.phone = String(body.phone || '').trim().slice(0, 40);
    if (body.title != null) next.title = String(body.title || '').trim().slice(0, 120);
    if (body.department != null) next.department = String(body.department || '').trim().slice(0, 120);
    if (body.status != null) {
      const st = String(body.status || '').trim();
      if (!['active', 'inactive'].includes(st)) return res.status(400).json({ error: 'status must be active or inactive' });
      next.status = st;
    }
    next.updatedAt = new Date().toISOString();
    arr[idx] = next;
    erp.employees = arr;
    writeErp(erp);
    res.json({ ok: true, employee: next });
  } catch (error) {
    logError('api/erp/employees PATCH', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/erp/employees/:id', (req, res) => {
  try {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const id = String(req.params.id || '').trim();
    const erp = readErp();
    const before = (erp.employees || []).length;
    erp.employees = (erp.employees || []).filter(x => String(x.id) !== id);
    if (erp.employees.length === before) return res.status(404).json({ error: 'Employee not found' });
    writeErp(erp);
    res.json({ ok: true });
  } catch (error) {
    logError('api/erp/employees DELETE', error);
    res.status(500).json({ error: error.message });
  }
});

function operationalStatusAllowedValues(erp) {
  const rows = Array.isArray(erp?.operationalStatusCatalog) ? erp.operationalStatusCatalog : [];
  const codes = rows
    .map(r => {
      if (r && typeof r === 'object') return String(r.value || '').trim();
      return String(r || '').trim();
    })
    .filter(Boolean);
  const fallback = ['in_service', 'out_of_service', 'shop', 'roadside'];
  return new Set(codes.length ? codes : fallback);
}

app.post('/api/maintenance/asset-status', (req, res) => {
  try {
    const unit = String(req.body?.unit || '').trim();
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    const status = String(req.body?.status || 'in_service').trim();
    const erp0 = readErp();
    const allowed = operationalStatusAllowedValues(erp0);
    if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const erp = erp0;
    if (!erp.assetStatusByUnit || typeof erp.assetStatusByUnit !== 'object') erp.assetStatusByUnit = {};
    erp.assetStatusByUnit[unit] = {
      status,
      note,
      updatedAt: new Date().toISOString(),
      updatedBy: req.authUser?.email || ''
    };
    writeErp(erp);
    res.json({ ok: true, assetStatusByUnit: erp.assetStatusByUnit });
  } catch (error) {
    logError('api/maintenance/asset-status', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/maintenance/asset-active', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const unit = String(req.body?.unit || '').trim();
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    const raw = req.body?.active;
    const active = !(raw === false || raw === 0 || String(raw).toLowerCase() === 'false');
    const erp = readErp();
    if (!erp.assetActiveByUnit || typeof erp.assetActiveByUnit !== 'object') erp.assetActiveByUnit = {};
    if (active) {
      delete erp.assetActiveByUnit[unit];
    } else {
      erp.assetActiveByUnit[unit] = false;
    }
    writeErp(erp);
    res.json({ ok: true, assetActiveByUnit: erp.assetActiveByUnit });
  } catch (error) {
    logError('api/maintenance/asset-active', error);
    res.status(500).json({ error: error.message });
  }
});

function buildUnitCategoryMap(erp) {
  const m = new Map();
  for (const wo of erpActiveWorkOrders(erp)) {
    const u = String(wo.unit || '').trim();
    if (u && wo.assetCategory) m.set(u, wo.assetCategory);
  }
  return m;
}

const EXPENSE_SUMMARY_CATS = ['Trucks', 'Refrigerated Vans', 'Flatbeds', 'Dry Vans', 'Company Vehicles', 'Other'];

function expenseSummaryByCategoryWindow(erp, startIso, endIso) {
  const start = String(startIso || '').slice(0, 10);
  const end = String(endIso || '').slice(0, 10);
  const sums = Object.fromEntries(EXPENSE_SUMMARY_CATS.map(c => [c, 0]));
  const ucat = buildUnitCategoryMap(erp);

  function catForUnit(u, explicit) {
    if (explicit && sums[explicit] != null) return explicit;
    const x = String(u || '').trim();
    return ucat.get(x) || 'Other';
  }

  for (const wo of erpActiveWorkOrders(erp)) {
    const d = String(wo.serviceDate || '').slice(0, 10);
    if (!d || d < start || (end && d > end)) continue;
    const cat = catForUnit(wo.unit, wo.assetCategory);
    for (const line of wo.lines || []) {
      sums[cat] += safeNum(line.amount, 0) || 0;
    }
  }
  for (const ap of erp.apTransactions || []) {
    const d = String(ap.txnDate || '').slice(0, 10);
    if (!d || d < start || (end && d > end)) continue;
    const cat = catForUnit(ap.assetUnit, ap.assetCategory);
    sums[cat] += safeNum(ap.amount, 0) || 0;
  }
  for (const rec of erp.records || []) {
    const d = String(rec.serviceDate || '').slice(0, 10);
    if (!d || d < start || (end && d > end)) continue;
    const cat = catForUnit(rec.unit, rec.assetCategory);
    sums[cat] += safeNum(rec.cost, 0) || 0;
  }

  for (const k of EXPENSE_SUMMARY_CATS) {
    sums[k] = Math.round(sums[k] * 100) / 100;
  }
  const total = Math.round(EXPENSE_SUMMARY_CATS.reduce((s, k) => s + sums[k], 0) * 100) / 100;
  return { startDate: start, endDate: end || '', byCategory: sums, total };
}

function expenseSummaryByCategory(erp, days) {
  const n = Math.min(366, Math.max(1, Number(days) || 30));
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - n);
  const startIso = start.toISOString().slice(0, 10);
  const out = expenseSummaryByCategoryWindow(erp, startIso, end);
  return { days: n, cutoff: startIso, ...out };
}

function shopQueueEntryOverdue(entry, nowMs = Date.now()) {
  const estH = safeNum(entry.estimatedHours, null);
  if (estH == null || !(estH > 0)) return false;
  const ms = estH * 3600000;
  const st = String(entry.status || '');
  if (st === 'queued' && entry.queuedAt) {
    return nowMs - new Date(entry.queuedAt).getTime() > ms;
  }
  if (st === 'in_progress' && entry.startedAt) {
    return nowMs - new Date(entry.startedAt).getTime() > ms;
  }
  return false;
}

function securityCutoffDate(days) {
  const n = Math.min(90, Math.max(7, Number(days) || 30));
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { days: n, cutoffStr: d.toISOString().slice(0, 10) };
}

function driverRiskWindowCutoff() {
  const n = Math.min(90, Math.max(14, Number(process.env.DRIVER_RISK_WINDOW_DAYS || 30)));
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { days: n, cutoffStr: d.toISOString().slice(0, 10) };
}

function driverAccidentWindowCutoff() {
  const n = Math.min(365, Math.max(30, Number(process.env.DRIVER_RISK_ACCIDENT_WINDOW_DAYS || 90)));
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { days: n, cutoffStr: d.toISOString().slice(0, 10) };
}

function isRoutineMaintenanceText(blob) {
  const t = String(blob || '').toLowerCase();
  return /\b(pm\b|preventive|oil change|lubrication|lube\b|dot\s*inspect|annual inspect|filter\s*service|alignment|rotation)\b/i.test(
    t
  );
}

/** Non-PM damage / abuse signals for driver-focused alerts (keywords, not full NLP). */
function isRiskExpenseBlob(blob) {
  const t = String(blob || '').toLowerCase();
  if (!t.trim()) return false;
  if (isRoutineMaintenanceText(t)) return false;
  return (
    /\b(accident|collision|damage|air\s*bag|airbag|tow\b|roadside|body shop|glass|windshield|bumper|hood|fender|claim)\b/i.test(
      t
    ) ||
    (/\b(tire|tyre)\b/i.test(t) &&
      /\b(replace|replacement|road\s*hazard|blowout|recap|new\s+tire)\b/i.test(t)) ||
    /\b(def|aftertreatment|derate|scr|dpf)\b/i.test(t)
  );
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function dutyNormServer(s) {
  return String(s || '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
}

function isInServiceDutyServer(dutyType) {
  const x = dutyNormServer(dutyType);
  return (
    x === 'driving' || x === 'onduty' || x === 'yardmove' || x === 'waitingtime'
  );
}

function parseAssignEndMs(s) {
  if (s == null || s === '') return null;
  const t = Date.parse(String(s));
  return Number.isNaN(t) ? null : t;
}

function assignmentIsActiveNowServer(a, nowMs = Date.now()) {
  const endMs = parseAssignEndMs(a?.endTime || a?.endAt);
  if (endMs == null) return true;
  return endMs > nowMs;
}

function driverFromAssignments(assignments, unitName, nowMs = Date.now()) {
  const un = String(unitName || '').trim();
  if (!un) return null;
  for (const a of assignments || []) {
    const vn = String(a?.vehicle?.name || a?.vehicleName || '').trim();
    if (vn !== un) continue;
    if (assignmentIsActiveNowServer(a, nowMs)) {
      const dr = String(a?.driver?.name || a?.driverName || '').trim();
      return dr || null;
    }
  }
  return null;
}

/**
 * Driver-facing expense pattern alerts: repeated non-PM damage/repair language and accident records.
 */
function computeDriverRiskAlerts(erp, driversByUnit) {
  const drWin = driverRiskWindowCutoff();
  const accWin = driverAccidentWindowCutoff();
  const minEvents = Math.max(2, Number(process.env.DRIVER_RISK_MIN_EVENTS || 4));
  const maxAcc = Math.max(1, Number(process.env.DRIVER_RISK_MAX_ACCIDENTS || 2));

  const riskCountByUnit = {};
  const accidentCountByUnit = {};

  for (const r of erp.records || []) {
    const d = String(r.serviceDate || '').slice(0, 10);
    if (!d) continue;
    const blob = [r.serviceType, r.recordType, r.notes].filter(Boolean).join(' ');
    const unit = String(r.unit || '').trim();
    if (String(r.recordType || '').toLowerCase() === 'accident' && d >= accWin.cutoffStr) {
      accidentCountByUnit[unit] = (accidentCountByUnit[unit] || 0) + 1;
    }
    if (d < drWin.cutoffStr || !unit) continue;
    if (String(r.recordType || '').toLowerCase() === 'accident') continue;
    if (isRiskExpenseBlob(blob)) {
      riskCountByUnit[unit] = (riskCountByUnit[unit] || 0) + 1;
    }
  }

  for (const wo of erpActiveWorkOrders(erp)) {
    const d = String(wo.serviceDate || '').slice(0, 10);
    if (!d || d < drWin.cutoffStr) continue;
    const unit = String(wo.unit || '').trim();
    if (!unit) continue;
    for (const line of wo.lines || []) {
      const blob = [line.serviceType, line.notes].filter(Boolean).join(' ');
      if (isRiskExpenseBlob(blob)) {
        riskCountByUnit[unit] = (riskCountByUnit[unit] || 0) + 1;
      }
    }
  }

  for (const ap of erp.apTransactions || []) {
    const d = String(ap.txnDate || '').slice(0, 10);
    if (!d || d < drWin.cutoffStr) continue;
    const unit = String(ap.assetUnit || '').trim();
    if (!unit) continue;
    const blob = [ap.description, ap.memo].filter(Boolean).join(' ');
    if (isRiskExpenseBlob(blob)) {
      riskCountByUnit[unit] = (riskCountByUnit[unit] || 0) + 1;
    }
  }

  const alerts = [];
  for (const [unit, n] of Object.entries(riskCountByUnit)) {
    if (n >= minEvents) {
      alerts.push({
        severity: 'warn',
        type: 'driver_damage_repair_pattern',
        unit,
        driverHint: driversByUnit[unit] || null,
        message: `Non-routine damage / repair signals (${n} events in ${drWin.days}d) — review driver assignment, habits, and vendor invoices.`,
        eventCount: n,
        windowDays: drWin.days
      });
    }
  }
  for (const [unit, n] of Object.entries(accidentCountByUnit)) {
    if (n >= maxAcc) {
      alerts.push({
        severity: 'high',
        type: 'driver_repeat_accidents',
        unit,
        driverHint: driversByUnit[unit] || null,
        message: `${n} accident records in ${accWin.days}d — safety review recommended.`,
        accidentCount: n,
        windowDays: accWin.days
      });
    }
  }

  return {
    alerts,
    parameters: {
      driverRiskWindowDays: drWin.days,
      driverRiskMinEvents: minEvents,
      driverAccidentWindowDays: accWin.days,
      driverRiskMaxAccidents: maxAcc
    }
  };
}

const TMS_ACTIVE_LOAD_STATUSES = [
  'open',
  'covered',
  'dispatched',
  'on_route',
  'loading',
  'unloading'
];
const TMS_COMPLETED_STATUSES = ['delivered', 'unsettled'];

async function fetchTmsTruckIdleByUnit() {
  if (!getPool()) return {};
  try {
    const { rows } = await dbQuery(
      `SELECT
        t.unit_code,
        (
          SELECT jsonb_build_object(
            'load_number', l.load_number,
            'status', l.status,
            'end_date', l.end_date,
            'start_date', l.start_date
          )
          FROM loads l
          WHERE l.truck_id = t.id AND l.status = ANY($1::text[])
          ORDER BY l.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS active_load,
        (
          SELECT MAX(l.end_date)::text
          FROM loads l
          WHERE l.truck_id = t.id AND l.status = ANY($2::text[])
        ) AS last_completed_end
      FROM trucks t`,
      [TMS_ACTIVE_LOAD_STATUSES, TMS_COMPLETED_STATUSES]
    );
    const map = {};
    for (const r of rows) {
      const code = String(r.unit_code || '').trim();
      if (!code) continue;
      map[code] = {
        activeLoad: r.active_load || null,
        lastCompletedEnd: r.last_completed_end || null
      };
    }
    return map;
  } catch (err) {
    logError('fetchTmsTruckIdleByUnit', err);
    return {};
  }
}

function daysSinceDateStr(isoDate) {
  if (!isoDate) return null;
  const d = new Date(String(isoDate).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * Parts / repair frequency, tire interval checks, and fuel purchase vs miles heuristic.
 * Operational status (assetStatusByUnit) is surfaced when present but rules are mileage- and spend-based.
 */
function computeMaintenanceSecurityAlerts(erp, boardAssignments, vehicleByName, windowDaysOverride) {
  const daysWanted =
    windowDaysOverride != null && windowDaysOverride !== '' ? Number(windowDaysOverride) : null;
  const { days, cutoffStr } = securityCutoffDate(
    Number.isFinite(daysWanted) && daysWanted > 0
      ? daysWanted
      : Number(process.env.SECURITY_ALERT_WINDOW_DAYS || 30)
  );
  const fuelRatio = Number(process.env.SECURITY_FUEL_PURCHASE_RATIO || 1.22);
  const defaultMpg = Number(process.env.SECURITY_DEFAULT_MPG || 6.5);
  const maxRepairs7 = Number(process.env.SECURITY_MAX_REPAIRS_7D || 6);
  const tireMinMi = Number(process.env.SECURITY_TIRE_MIN_INTERVAL_MI || 38000);
  const highCost = Number(process.env.SECURITY_HIGH_COST_SINGLE || 7500);
  const cutoff7 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();

  const records = (erp.records || []).filter(
    r => String(r.serviceDate || '').slice(0, 10) >= cutoffStr
  );
  const fuelPurchases = (erp.fuelPurchases || []).filter(p => {
    const d = String(p.txnDate || '').slice(0, 10);
    return d && d >= cutoffStr && String(p.unit || '').trim();
  });
  const units = new Set([
    ...records.map(r => r.unit),
    ...fuelPurchases.map(p => p.unit)
  ]);
  units.delete(undefined);
  units.delete('');

  const driversByUnit = {};
  for (const a of boardAssignments || []) {
    const un =
      a?.vehicle?.name ||
      a?.vehicleName ||
      (a?.vehicle && a.vehicle.name) ||
      '';
    if (!un) continue;
    const dr = a?.driverName || a?.driver?.name || a?.assignedDriverName || '';
    if (dr && !driversByUnit[un]) driversByUnit[un] = dr;
  }

  const alerts = [];
  const fuelDetails = [];

  for (const unit of units) {
    const urec = records.filter(r => r.unit === unit);
    const ufuel = fuelPurchases.filter(p => p.unit === unit).sort((a, b) => {
      const da = String(a.txnDate || '').slice(0, 10);
      const db = String(b.txnDate || '').slice(0, 10);
      return da.localeCompare(db);
    });
    const opSt = erp.assetStatusByUnit?.[unit]?.status || '';

    const recent7 = urec.filter(r => String(r.serviceDate || '').slice(0, 10) >= cutoff7);
    if (recent7.length >= maxRepairs7) {
      alerts.push({
        severity: 'warn',
        type: 'repair_frequency',
        unit,
        message: `Many maintenance records in 7 days (${recent7.length}) — review for duplicate billing or parts theft.`,
        count7d: recent7.length,
        operationalStatus: opSt || null
      });
    }

    for (const r of urec) {
      const c = safeNum(r.cost, 0) || 0;
      if (c >= highCost) {
        alerts.push({
          severity: 'info',
          type: 'high_cost',
          unit,
          message: `Single service cost $${c.toFixed(2)} (${r.serviceType || r.recordType || 'record'}) — verify invoice.`,
          cost: c,
          serviceDate: r.serviceDate || '',
          operationalStatus: opSt || null
        });
      }
    }

    const tireRecs = urec
      .filter(
        r =>
          String(r.recordType || '').toLowerCase() === 'tire' ||
          /tire|tyre/i.test(String(r.serviceType || ''))
      )
      .sort(
        (a, b) =>
          safeNum(b.serviceMileage, 0) - safeNum(a.serviceMileage, 0)
      );
    for (let i = 0; i < tireRecs.length - 1; i++) {
      const newer = tireRecs[i];
      const older = tireRecs[i + 1];
      const hi = safeNum(newer.serviceMileage, null);
      const lo = safeNum(older.serviceMileage, null);
      if (hi != null && lo != null && hi - lo < tireMinMi && hi - lo >= 0) {
        alerts.push({
          severity: 'warn',
          type: 'tire_interval',
          unit,
          message: `Tire work only ~${Math.round(hi - lo).toLocaleString()} mi after prior tire record — confirm not premature parts.`,
          milesBetween: Math.round(hi - lo),
          operationalStatus: opSt || null
        });
        break;
      }
    }

    const galSum = ufuel.reduce((s, p) => s + safeNum(p.gallons, 0), 0);
    const withOd = ufuel.filter(
      p => p.odometerMiles != null && Number(p.odometerMiles) > 0
    );
    let milesDriven = null;
    if (withOd.length >= 2) {
      const ods = withOd.map(p => Number(p.odometerMiles));
      milesDriven = Math.max(0, Math.max(...ods) - Math.min(...ods));
    }
    const veh = vehicleByName[unit];
    const mpg =
      veh && veh.mpg != null && Number.isFinite(Number(veh.mpg))
        ? Number(veh.mpg)
        : defaultMpg;
    if (milesDriven != null && milesDriven > 80 && galSum > 0 && mpg > 0) {
      const expectedGal = milesDriven / mpg;
      if (galSum > expectedGal * fuelRatio) {
        const row = {
          severity: 'high',
          type: 'fuel_volume_mismatch',
          unit,
          message: `Diesel purchases (${galSum.toFixed(
            0
          )} gal) exceed expected ~${expectedGal.toFixed(
            0
          )} gal for ~${Math.round(milesDriven)} mi at ${mpg} MPG (ratio ×${fuelRatio}).`,
          milesDriven: Math.round(milesDriven),
          gallonsPurchased: Math.round(galSum * 10) / 10,
          expectedGallons: Math.round(expectedGal * 10) / 10,
          mpgUsed: mpg,
          driverHint: driversByUnit[unit] || null,
          purchases: ufuel.map(p => ({
            txnDate: p.txnDate,
            gallons: p.gallons,
            vendor: p.vendor,
            odometerMiles: p.odometerMiles,
            totalCost: p.totalCost
          }))
        };
        alerts.push(row);
        fuelDetails.push(row);
      }
    }
  }

  const driverRisk = computeDriverRiskAlerts(erp, driversByUnit);

  return {
    ok: true,
    windowDays: days,
    cutoff: cutoffStr,
    parameters: {
      fuelPurchaseRatio: fuelRatio,
      defaultMpg,
      maxRepairs7d: maxRepairs7,
      tireMinIntervalMiles: tireMinMi,
      highCostSingle: highCost,
      ...driverRisk.parameters
    },
    alerts,
    driverRiskAlerts: driverRisk.alerts,
    fuelTheftCandidates: fuelDetails,
    driversByUnit
  };
}

function applyQboBillTermRef(payload, termId) {
  const id = String(termId || '').trim();
  if (!id) return;
  payload.SalesTermRef = { value: id };
}

app.get('/api/maintenance/expense-summary', (req, res) => {
  try {
    const days = Number(req.query.days);
    const erp = readErp();
    const base = expenseSummaryByCategory(erp, days);
    const compare = String(req.query.compare || '').trim();
    if (compare === '1' || compare.toLowerCase() === 'true') {
      const n = base.days || 30;
      const endCur = new Date().toISOString().slice(0, 10);
      const startCur = base.cutoff || base.startDate || '';
      const startPrevDate = new Date();
      startPrevDate.setDate(startPrevDate.getDate() - n * 2);
      const startPrev = startPrevDate.toISOString().slice(0, 10);
      const endPrev = startCur;
      const prev = expenseSummaryByCategoryWindow(erp, startPrev, endPrev);
      const delta = {
        total: Math.round((Number(base.total || 0) - Number(prev.total || 0)) * 100) / 100,
        pct:
          prev.total && Number(prev.total) !== 0
            ? Math.round(((Number(base.total || 0) - Number(prev.total || 0)) / Number(prev.total)) * 1000) / 10
            : null
      };
      return res.json({ ok: true, ...base, previous: prev, delta });
    }
    res.json({ ok: true, ...base });
  } catch (error) {
    logError('api/maintenance/expense-summary', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/maintenance/security-alerts', async (req, res) => {
  try {
    const erp = readErp();
    const days = req.query?.days != null ? Number(req.query.days) : null;
    const now = new Date();
    const startTime = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);
    const [assignmentsRes, vehiclesRaw] = await Promise.all([
      fetchJson(assignmentsUrl.toString(), {
        headers: samsaraHeaders()
      }).catch(() => ({ data: [] })),
      fetchVehiclesSafely()
    ]);
    const vehicleByName = {};
    for (const v of vehiclesRaw || []) {
      const n = String(v?.name || '').trim();
      if (n && isFleetAssetActiveForLists(erp, n)) vehicleByName[n] = v;
    }
    const data = computeMaintenanceSecurityAlerts(erp, assignmentsRes.data || [], vehicleByName, days);
    res.json(data);
  } catch (error) {
    logError('api/maintenance/security-alerts', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Stable JSON for external tools (Cursor extensions, scripts): security + driver-risk + expense rollup. */
app.get('/api/analytics/fleet-inconsistencies', async (_req, res) => {
  try {
    const erp = readErp();
    const now = new Date();
    const startTime = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);
    const [assignmentsRes, vehiclesRaw] = await Promise.all([
      fetchJson(assignmentsUrl.toString(), {
        headers: samsaraHeaders()
      }).catch(() => ({ data: [] })),
      fetchVehiclesSafely()
    ]);
    const vehicleByName = {};
    for (const v of vehiclesRaw || []) {
      const n = String(v?.name || '').trim();
      if (n && isFleetAssetActiveForLists(erp, n)) vehicleByName[n] = v;
    }
    const security = computeMaintenanceSecurityAlerts(
      erp,
      assignmentsRes.data || [],
      vehicleByName
    );
    const expenseSummary30 = expenseSummaryByCategory(erp, 30);
    res.json({
      ok: true,
      apiVersion: '1',
      generatedAt: new Date().toISOString(),
      security,
      expenseSummary30
    });
  } catch (error) {
    logError('api/analytics/fleet-inconsistencies', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Yard geofence + TMS idle hints for T120–T178. Requires Samsara; TMS columns optional (DATABASE_URL).
 */
app.get('/api/tracking/idle-snapshot', async (_req, res) => {
  try {
    const yardLat = Number(process.env.YARD_LAT || 27.65138);
    const yardLon = Number(process.env.YARD_LON || -99.62903);
    const yardRadiusM = Math.max(50, Number(process.env.YARD_RADIUS_M || 2000));
    const dailyRev = Math.max(0, Number(process.env.IDLE_EST_DAILY_REVENUE || 800));
    const yardLabel =
      String(process.env.YARD_LABEL || '').trim() ||
      '21918 Mines Rd, Laredo, TX (geofence — set YARD_LAT/YARD_LON)';

    const [fleetSnap, hosAll, assignmentsRes, tmsByUnit] = await Promise.all([
      fetchTrackedFleetSnapshot(),
      fetchAllSamsaraHosClocks(),
      (async () => {
        const now = new Date();
        const startTime = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
        assignmentsUrl.searchParams.set('filterBy', 'vehicles');
        assignmentsUrl.searchParams.set('startTime', startTime);
        assignmentsUrl.searchParams.set('endTime', endTime);
        return fetchJson(assignmentsUrl.toString(), { headers: samsaraHeaders() }).catch(() => ({
          data: []
        }));
      })(),
      fetchTmsTruckIdleByUnit()
    ]);
    const { enrichedVehicles, refreshedAt } = fleetSnap;

    const assignments = assignmentsRes.data || [];
    const nowMs = Date.now();

    const hosByVehicleName = {};
    for (const c of hosAll || []) {
      const vn = String(c?.currentVehicle?.name || '').trim();
      if (vn) hosByVehicleName[vn] = c;
    }

    const notes = [];
    if (!getPool()) {
      notes.push(
        'TMS database not configured — trip / idle columns from loads are omitted (set DATABASE_URL).'
      );
    }

    const vehicles = [];
    for (const v of enrichedVehicles) {
      const un = String(v.name || '').trim();
      const n = parseUnitNumber(un);
      if (n == null || n < 120 || n > 178) continue;

      const lat = v.latitude != null ? Number(v.latitude) : null;
      const lon = v.longitude != null ? Number(v.longitude) : null;
      let distanceM = null;
      let inYard = false;
      if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
        distanceM = haversineMeters(lat, lon, yardLat, yardLon);
        inYard = distanceM <= yardRadiusM;
      }

      const clock = hosByVehicleName[un];
      const dutyType = clock?.currentDutyStatus?.hosStatusType || '';
      const driverHos = String(clock?.driver?.name || '').trim();
      const driverAssign = driverFromAssignments(assignments, un, nowMs);
      const driverName = driverAssign || driverHos || null;

      const tms = tmsByUnit[un] || {};
      const activeLoad = tms.activeLoad || null;
      const lastEnd = tms.lastCompletedEnd || null;
      const daysSince = daysSinceDateStr(lastEnd);

      const hasActiveTrip = !!(
        activeLoad &&
        activeLoad.status &&
        TMS_ACTIVE_LOAD_STATUSES.includes(String(activeLoad.status))
      );
      const workingHos = isInServiceDutyServer(dutyType);
      const workingTripLikely = hasActiveTrip || workingHos;

      let idleBand = 'unknown';
      if (workingTripLikely) idleBand = 'working';
      else if (inYard) idleBand = 'yard_idle';
      else if (lat != null && lon != null) idleBand = 'away_idle';
      else idleBand = 'no_gps';

      let estimatedRevenueAtRisk = null;
      if (!workingTripLikely && daysSince != null && daysSince > 0 && dailyRev > 0) {
        estimatedRevenueAtRisk = Math.round(daysSince * dailyRev * 100) / 100;
      }

      vehicles.push({
        unit: un,
        vehicleId: String(v.id || v.vehicleId || v.ids?.samsaraId || ''),
        latitude: lat,
        longitude: lon,
        engineState: v.engineState || '',
        liveStatsUpdatedAt: v.liveStatsUpdatedAt || '',
        inYard,
        distanceToYardM:
          distanceM != null ? Math.round(distanceM) : null,
        yardLabel,
        driverName,
        hosDutyType: dutyType || null,
        tmsActiveLoad: activeLoad,
        lastCompletedLoadEnd: lastEnd,
        daysSinceLastCompletedLoad: daysSince,
        workingTripLikely,
        idleBand,
        estimatedRevenueAtRisk
      });
    }

    vehicles.sort(byVehicleName);

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      samsaraRefreshedAt: refreshedAt,
      yard: {
        label: yardLabel,
        addressNote: 'Default center is approximate for Mines Rd, Laredo — override YARD_LAT / YARD_LON.',
        latitude: yardLat,
        longitude: yardLon,
        radiusM: yardRadiusM
      },
      parameters: { idleEstDailyRevenue: dailyRev },
      notes,
      vehicles
    });
  } catch (error) {
    logError('api/tracking/idle-snapshot', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/maintenance/shop-queue', (_req, res) => {
  try {
    const erp = readErp();
    const rows = (erp.maintenanceShopQueue || []).map(e => ({
      ...e,
      overdue: shopQueueEntryOverdue(e)
    }));
    res.json({ ok: true, queue: rows });
  } catch (error) {
    logError('api/maintenance/shop-queue GET', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/maintenance/shop-queue', (req, res) => {
  try {
    const body = req.body || {};
    const unit = String(body.unit || '').trim();
    const shopType = String(body.shopType || '').trim();
    const title = String(body.title || 'Repair / service').trim().slice(0, 200);
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    if (!['internal', 'external', 'roadside', 'parts'].includes(shopType)) {
      return res.status(400).json({ error: 'shopType must be internal, external, roadside, or parts' });
    }
    const assetCategory = String(body.assetCategory || 'Trucks').trim().slice(0, 80);
    const erp = readErp();
    if (!Array.isArray(erp.maintenanceShopQueue)) erp.maintenanceShopQueue = [];
    const row = {
      id: uid('sq'),
      unit,
      assetCategory,
      shopType,
      status: 'queued',
      title,
      workOrderId: String(body.workOrderId || '').trim(),
      estimatedHours: safeNum(body.estimatedHours, null),
      vendorHint: String(body.vendorHint || '').trim().slice(0, 120),
      queuedAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      delayReasonCode: '',
      delayReasonNote: '',
      createdAt: new Date().toISOString()
    };
    erp.maintenanceShopQueue.push(row);
    writeErp(erp);
    res.json({ ok: true, entry: row });
  } catch (error) {
    logError('api/maintenance/shop-queue POST', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/maintenance/shop-queue/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const erp = readErp();
    const arr = erp.maintenanceShopQueue || [];
    const idx = arr.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Queue entry not found' });

    const next = { ...arr[idx] };
    const newStatus = body.status != null ? String(body.status).trim() : next.status;
    if (!['queued', 'in_progress', 'finished'].includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    next.status = newStatus;

    if (newStatus === 'in_progress' && !next.startedAt) {
      next.startedAt = new Date().toISOString();
    }
    if (newStatus === 'finished') {
      next.finishedAt = new Date().toISOString();
    }
    if (newStatus === 'queued') {
      next.startedAt = '';
      next.finishedAt = '';
    }

    if (body.delayReasonCode != null) next.delayReasonCode = String(body.delayReasonCode).trim().slice(0, 64);
    if (body.delayReasonNote != null) next.delayReasonNote = String(body.delayReasonNote).trim().slice(0, 500);
    if (body.estimatedHours != null) next.estimatedHours = safeNum(body.estimatedHours, null);
    if (body.title != null) next.title = String(body.title).trim().slice(0, 200);

    const overdue = shopQueueEntryOverdue(next);
    const hasDelay = String(next.delayReasonCode || '').trim();
    if (overdue && !hasDelay) {
      return res.status(400).json({
        error: 'Past estimated time — select a delay reason (bottleneck)',
        requiresDelayReason: true,
        overdue
      });
    }

    next.updatedAt = new Date().toISOString();
    arr[idx] = next;
    erp.maintenanceShopQueue = arr;
    writeErp(erp);
    res.json({ ok: true, entry: { ...next, overdue: shopQueueEntryOverdue(next) } });
  } catch (error) {
    logError('api/maintenance/shop-queue PATCH', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/maintenance/shop-queue/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const erp = readErp();
    const before = (erp.maintenanceShopQueue || []).length;
    erp.maintenanceShopQueue = (erp.maintenanceShopQueue || []).filter(x => String(x.id) !== id);
    if (erp.maintenanceShopQueue.length === before) return res.status(404).json({ error: 'Not found' });
    writeErp(erp);
    res.json({ ok: true });
  } catch (error) {
    logError('api/maintenance/shop-queue DELETE', error);
    res.status(500).json({ error: error.message });
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

app.post('/api/integrations/samsara/vehicle/:id', async (req, res) => {
  if (!requireErpWriteOrAdmin(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'vehicle id is required' });
    const patch = pickSamsaraVehicleUpdateBody(req.body || {});
    if (!Object.keys(patch).length) {
      return res.status(400).json({
        error:
          'Provide at least one field to update: name, notes, vin, licensePlate, staticAssignedDriverId (Samsara ids as strings)'
      });
    }
    const data = await samsaraApiPatch(`/fleet/vehicles/${encodeURIComponent(id)}`, patch);
    appendSecurityAudit({
      action: 'samsara_vehicle_patch',
      userId: req.authUser?.id,
      email: req.authUser?.email,
      ip: clientIp(req),
      samsaraVehicleId: id,
      fields: Object.keys(patch)
    });
    res.json({ ok: true, data });
  } catch (error) {
    logError('api/integrations/samsara/vehicle', error);
    const st = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    res.status(st).json({ error: error.message, details: error.details || null });
  }
});

app.post('/api/integrations/samsara/driver/:id', async (req, res) => {
  if (!requireErpWriteOrAdmin(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'driver id is required' });
    const patch = pickSamsaraDriverUpdateBody(req.body || {});
    if (!Object.keys(patch).length) {
      return res.status(400).json({
        error:
          'Provide at least one field to update: name, notes, username, phone, licenseNumber, licenseState, timezone, driverActivationStatus, staticAssignedVehicleId'
      });
    }
    const data = await samsaraApiPatch(`/fleet/drivers/${encodeURIComponent(id)}`, patch);
    appendSecurityAudit({
      action: 'samsara_driver_patch',
      userId: req.authUser?.id,
      email: req.authUser?.email,
      ip: clientIp(req),
      samsaraDriverId: id,
      fields: Object.keys(patch)
    });
    res.json({ ok: true, data });
  } catch (error) {
    logError('api/integrations/samsara/driver', error);
    const st = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    res.status(st).json({ error: error.message, details: error.details || null });
  }
});

function escapeQboQueryLikeFragment(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Search QBO vendors (live query when connected + q length ≥ 2; otherwise ERP cache). */
app.get('/api/qbo/vendors/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const store = readQbo();
    const connected = !!store.tokens?.access_token;
    const vendors = readQboCatalogPayload().vendors;
    if (!q) {
      return res.json({ ok: true, source: 'cache', vendors: vendors.slice(0, 200) });
    }
    const qLow = q.toLowerCase();
    const fromCache = vendors.filter(
      v =>
        String(v.name || '').toLowerCase().includes(qLow) ||
        String(v.companyName || '').toLowerCase().includes(qLow) ||
        String(v.qboId || '').includes(q)
    );
    if (!connected || q.length < 2) {
      return res.json({ ok: true, source: 'cache', vendors: fromCache.slice(0, 120) });
    }
    const esc = escapeQboQueryLikeFragment(q);
    const data = await qboQuery(
      `select * from Vendor where DisplayName LIKE '%${esc}%' OR CompanyName LIKE '%${esc}%' maxresults 80`
    );
    const live = (data?.QueryResponse?.Vendor || []).map(v => ({
      qboId: v.Id,
      name: v.DisplayName || '',
      companyName: v.CompanyName || '',
      phone: v.PrimaryPhone?.FreeFormNumber || '',
      email: v.PrimaryEmailAddr?.Address || '',
      active: v.Active !== false
    }));
    res.json({ ok: true, source: 'quickbooks', vendors: live });
  } catch (error) {
    logError('api/qbo/vendors/search', error);
    const vendors = readQboCatalogPayload().vendors;
    const qLow = String(req.query.q || '').trim().toLowerCase();
    const fallback = vendors.filter(
      v =>
        String(v.name || '').toLowerCase().includes(qLow) ||
        String(v.companyName || '').toLowerCase().includes(qLow)
    );
    res.json({ ok: true, source: 'cache_fallback', error: error.message, vendors: fallback.slice(0, 120) });
  }
});

/** Read-only: list Samsara drivers for linking (uses SAMSARA_API_TOKEN). */
app.get('/api/integrations/samsara/drivers', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(400, Math.max(10, Number(req.query.limit) || 200));
    const drivers = await fetchSamsaraDriversNormalized({ q, limit });
    res.json({ ok: true, drivers, count: drivers.length });
  } catch (error) {
    logError('api/integrations/samsara/drivers', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Create (or match) a QuickBooks vendor from a Samsara driver profile, refresh QBO cache,
 * and optionally attach ids to a TMS driver row.
 */
app.post('/api/maintenance/qbo-vendor-from-samsara-driver', async (req, res) => {
  if (!requireErpWriteOrAdmin(req, res)) return;
  try {
    const samsaraDriverId = String(req.body?.samsaraDriverId || '').trim();
    const tmsDriverId = String(req.body?.tmsDriverId || '').trim();
    if (!samsaraDriverId) return res.status(400).json({ ok: false, error: 'samsaraDriverId is required' });
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
    }
    const sd = await fetchSamsaraDriverById(samsaraDriverId);
    const emailGuess =
      sd.username && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sd.username) ? sd.username : '';
    const result = await qboCreateVendorFromApp({
      name: sd.name,
      companyName: sd.name,
      phone: sd.phone,
      email: emailGuess
    });
    const v = result.vendor;
    const qboId = String(v?.Id || '').trim();
    if (!qboId) throw new Error('QuickBooks did not return a vendor id');
    await qboSyncMasterData();
    let linked = null;
    if (tmsDriverId && getPool()) {
      const { rows } = await dbQuery(
        `UPDATE drivers SET qbo_vendor_id = $1, samsara_driver_id = $2,
         name = CASE WHEN NULLIF(TRIM($3), '') IS NOT NULL THEN TRIM($3) ELSE name END,
         phone = CASE WHEN NULLIF(TRIM($4), '') IS NOT NULL THEN TRIM($4) ELSE phone END
         WHERE id = $5::uuid
         RETURNING id, name, email, phone, qbo_vendor_id, samsara_driver_id, created_at`,
        [qboId, samsaraDriverId, sd.name, sd.phone || null, tmsDriverId]
      );
      linked = rows[0] || null;
    }
    appendSecurityAudit({
      action: 'qbo_vendor_from_samsara_driver',
      userId: req.authUser?.id,
      email: req.authUser?.email,
      ip: clientIp(req),
      samsaraDriverId,
      qboVendorId: qboId,
      tmsDriverId: tmsDriverId || '',
      created: !!result.created
    });
    res.json({ ok: true, created: !!result.created, qboVendorId: qboId, samsara: sd, linked });
  } catch (error) {
    logError('api/maintenance/qbo-vendor-from-samsara-driver', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * One merge path for tracked fleet + live Samsara stats (odometer, fuel, GPS).
 * Used by board, maintenance dashboard, and dispatch maintenance alerts so unit
 * identity and mileage stay aligned across tabs and pages.
 */
async function fetchTrackedFleetSnapshot() {
  const erp = readErp();
  const [vehiclesRaw, statsRows] = await Promise.all([
    fetchVehiclesSafely(),
    fetchVehicleStatsCurrentSafely()
  ]);
  const trackedVehicles = vehiclesRaw.filter(isTrackedAsset).sort(byVehicleName);
  const enrichedAll = mergeVehiclesWithStats(trackedVehicles.map(enrichSamsaraVehicle), statsRows);
  const enrichedVehicles = enrichedAll.filter(v => isFleetAssetActiveForLists(erp, v.name));
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
      workOrders: erpActiveWorkOrders(erp),
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

app.get('/api/erp/auth-status', (_req, res) => {
  res.json({ ok: true, writeSecretConfigured: !!ERP_WRITE_SECRET });
});

app.get('/api/maintenance/records', (_req, res) => {
  res.json(readErp());
});

app.get('/api/safety/driver-profiles', (_req, res) => {
  const erp = readErp();
  res.json({ ok: true, drivers: erp.driverProfiles || [] });
});

app.post('/api/safety/driver-profiles', (req, res) => {
  try {
    const body = req.body || {};
    const profile = sanitizeDriverProfile(body);
    if (!profile) return res.status(400).json({ ok: false, error: 'driver name is required' });

    const erp = readErp();
    if (!Array.isArray(erp.driverProfiles)) erp.driverProfiles = [];
    const key = String(profile.samsaraDriverId || '').trim();
    const nameKey = profile.name.toLowerCase();
    const idx = erp.driverProfiles.findIndex(d => {
      if (!d || typeof d !== 'object') return false;
      const did = String(d.samsaraDriverId || '').trim();
      if (key && did && did === key) return true;
      const dn = String(d.name || '').trim().toLowerCase();
      return dn && dn === nameKey;
    });
    const now = new Date().toISOString();
    if (idx >= 0) {
      erp.driverProfiles[idx] = { ...erp.driverProfiles[idx], ...profile, updatedAt: now };
    } else {
      erp.driverProfiles.push({ id: uid('drv'), ...profile, createdAt: now, updatedAt: now });
    }
    writeErp(erp);
    res.json({ ok: true, drivers: erp.driverProfiles });
  } catch (error) {
    logError('api/safety/driver-profiles POST', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/fuel/purchases', (_req, res) => {
  const erp = readErp();
  res.json({ ok: true, purchases: erp.fuelPurchases || [], import: fuelImportMeta(erp) });
});

app.post('/api/fuel/purchases', (req, res) => {
  try {
    if (!requireErpWrite(req, res)) return;
    const body = req.body || {};
    const p = sanitizeFuelPurchase(body);
    if (!p) return res.status(400).json({ ok: false, error: 'unit + gallons (or total) is required' });
    const erp = readErp();
    if (!Array.isArray(erp.fuelPurchases)) erp.fuelPurchases = [];
    const now = new Date().toISOString();
    const row = { id: uid('fuel'), ...p, createdAt: now };
    erp.fuelPurchases.push(row);
    writeErp(erp);
    res.json({ ok: true, purchase: row, purchases: erp.fuelPurchases, import: fuelImportMeta(erp) });
  } catch (error) {
    logError('api/fuel/purchases POST', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/fuel/purchases/:id/expense-draft', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
    const erp = readErp();
    const idx = (erp.fuelPurchases || []).findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Fuel purchase not found' });
    const fp = erp.fuelPurchases[idx];
    if (String(fp.qboSyncStatus || '').toLowerCase() === 'posted') {
      return res.status(400).json({ ok: false, error: 'Posted fuel rows cannot store an expense draft' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const draft = sanitizeFuelExpenseDraft(body);
    const next = { ...fp };
    if (!Object.keys(draft).length) {
      delete next.fuelExpenseDraft;
      delete next.fuelExpenseDraftUpdatedAt;
    } else {
      next.fuelExpenseDraft = draft;
      next.fuelExpenseDraftUpdatedAt = new Date().toISOString();
    }
    erp.fuelPurchases[idx] = next;
    writeErp(erp);
    res.json({ ok: true, purchase: erp.fuelPurchases[idx] });
  } catch (error) {
    logError('api/fuel/purchases/:id/expense-draft', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/maintenance/service-types', async (_req, res) => {
  try {
    if (!getPool()) {
      return res.json({
        ok: true,
        source: 'defaults',
        names: [...MAINTENANCE_SERVICE_CATALOG_SEEDS]
      });
    }
    await ensureMaintenanceServiceCatalog();
    const { rows } = await dbQuery(
      `SELECT name FROM maintenance_service_catalog WHERE active = true ORDER BY sort_order ASC, name ASC`
    );
    const names = rows.map(r => String(r.name || '').trim()).filter(Boolean);
    res.json({
      ok: true,
      source: names.length ? 'database' : 'defaults',
      names: names.length ? names : [...MAINTENANCE_SERVICE_CATALOG_SEEDS]
    });
  } catch (error) {
    logError('api/maintenance/service-types', error);
    res.json({
      ok: true,
      source: 'defaults',
      names: [...MAINTENANCE_SERVICE_CATALOG_SEEDS],
      warn: error.message
    });
  }
});

app.post('/api/maintenance/service-types', async (req, res) => {
  try {
    if (!getPool()) {
      return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set — cannot store catalog' });
    }
    await ensureMaintenanceServiceCatalog();
    const name = String(req.body?.name || '')
      .trim()
      .slice(0, 120);
    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, error: 'name must be 2–120 characters' });
    }
    const { rows: mx } = await dbQuery(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM maintenance_service_catalog`
    );
    const sortOrder = Number(mx[0]?.n) || 0;
    await dbQuery(
      `INSERT INTO maintenance_service_catalog (name, sort_order) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET active = true`,
      [name, sortOrder]
    );
    res.json({ ok: true, name });
  } catch (error) {
    logError('api/maintenance/service-types POST', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/maintenance/operational-status-catalog', (_req, res) => {
  try {
    const erp = readErp();
    const rows = Array.isArray(erp.operationalStatusCatalog) ? erp.operationalStatusCatalog : [];
    res.json({ ok: true, rows });
  } catch (error) {
    logError('api/maintenance/operational-status-catalog GET', error);
    res.status(500).json({ ok: false, error: error.message, rows: [] });
  }
});

app.post('/api/maintenance/operational-status-catalog', (req, res) => {
  try {
    const rawLabel = String(req.body?.label || '').trim().slice(0, 80);
    let value = String(req.body?.value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    if (!value && rawLabel) {
      value = rawLabel
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    }
    if (!value || !rawLabel) {
      return res.status(400).json({ ok: false, error: 'value and label are required (value may be derived from label)' });
    }
    const erp = readErp();
    if (!Array.isArray(erp.operationalStatusCatalog)) erp.operationalStatusCatalog = [];
    const taken = new Set(
      erp.operationalStatusCatalog.map(r =>
        typeof r === 'object' ? String(r.value || '').trim() : String(r || '').trim()
      )
    );
    if (taken.has(value)) {
      return res.status(400).json({ ok: false, error: 'That status code already exists' });
    }
    erp.operationalStatusCatalog.push({ value, label: rawLabel });
    writeErp(erp);
    res.json({ ok: true, rows: erp.operationalStatusCatalog });
  } catch (error) {
    logError('api/maintenance/operational-status-catalog POST', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/maintenance/vendor-catalog', async (_req, res) => {
  try {
    const erp = readErp();
    const qbVendors = (erp.qboCache?.vendors || []).map(v => ({
      source: 'quickbooks',
      qboId: v.qboId,
      name: v.name || v.companyName || '',
      companyName: v.companyName || ''
    }));
    let driverPayees = [];
    try {
      if (getPool()) {
        const { rows } = await dbQuery(
          `SELECT id, name, email, phone, qbo_vendor_id AS "qboVendorId", samsara_driver_id AS "samsaraDriverId"
           FROM drivers ORDER BY name`
        );
        driverPayees = (rows || []).map(r => ({
          source: 'tms_driver',
          tmsDriverId: r.id,
          name: r.name || '',
          email: r.email || '',
          phone: r.phone || '',
          qboVendorId: r.qboVendorId || '',
          samsaraDriverId: r.samsaraDriverId || ''
        }));
      }
    } catch (err) {
      logError('api/maintenance/vendor-catalog drivers', err);
    }
    res.json({
      ok: true,
      note:
        'QuickBooks vendors are payees for bills/expenses; TMS drivers often use the same QBO vendor for settlements.',
      qbVendors,
      driverPayees
    });
  } catch (error) {
    logError('api/maintenance/vendor-catalog', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/maintenance/service-catalog-admin', async (_req, res) => {
  try {
    if (!getPool()) {
      const rows = MAINTENANCE_SERVICE_CATALOG_SEEDS.map((name, i) => ({
        id: `default-${i}`,
        name,
        active: true,
        sort_order: i,
        created_at: null
      }));
      return res.json({
        ok: true,
        readOnly: true,
        source: 'defaults',
        rows
      });
    }
    await ensureMaintenanceServiceCatalog();
    const { rows } = await dbQuery(
      `SELECT id, name, active, sort_order, created_at
       FROM maintenance_service_catalog
       ORDER BY sort_order ASC, name ASC`
    );
    res.json({ ok: true, rows });
  } catch (error) {
    logError('api/maintenance/service-catalog-admin GET', error);
    res.status(500).json({ ok: false, error: error.message, rows: [] });
  }
});

app.patch('/api/maintenance/service-catalog-admin', async (req, res) => {
  try {
    if (!getPool()) {
      return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    }
    await ensureMaintenanceServiceCatalog();
    const body = req.body || {};
    const id = String(body.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
    if (body.active === undefined) {
      return res.status(400).json({ ok: false, error: 'active (boolean) is required' });
    }
    const active = !!body.active;
    await dbQuery(`UPDATE maintenance_service_catalog SET active = $1 WHERE id = $2::uuid`, [
      active,
      id
    ]);
    res.json({ ok: true, id, active });
  } catch (error) {
    logError('api/maintenance/service-catalog-admin PATCH', error);
    res.status(500).json({ ok: false, error: error.message });
  }
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

/** Planned services / repairs for a visit (structured; not duplicated into freeform notes). */
function sanitizeMaintenancePlannedWork(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (x == null) continue;
    let desc = '';
    if (typeof x === 'string') desc = x;
    else if (typeof x === 'object') desc = String(x.description || x.text || '').trim();
    desc = desc
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      .trim()
      .slice(0, 240);
    if (desc) out.push({ description: desc });
    if (out.length >= 40) break;
  }
  return out;
}

function plannedWorkSummaryForMemo(plannedWork) {
  if (!Array.isArray(plannedWork) || !plannedWork.length) return '';
  const parts = plannedWork.map(p => String(p?.description || '').trim()).filter(Boolean);
  if (!parts.length) return '';
  const head = parts.slice(0, 8).join('; ');
  const tail = parts.length > 8 ? ` (+${parts.length - 8} more)` : '';
  return `Planned work: ${head}${tail}`.slice(0, 900);
}

function sanitizeMaintenanceTireLineItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const tirePosition = String(x.tirePosition || '').trim().slice(0, 120);
    const tireBrand = String(x.tireBrand || '').trim().slice(0, 120);
    const tireDot = String(x.tireDot || '').trim().slice(0, 80);
    const tireCondition = String(x.tireCondition || '').trim().slice(0, 80);
    if (tirePosition || tireBrand || tireDot || tireCondition) {
      out.push({ tirePosition, tireBrand, tireDot, tireCondition });
    }
  }
  return out;
}

function costLineDescriptionForQbo(cl) {
  const base = String(cl.description || '').trim() || 'Line';
  const pos = String(cl.partPosition || '').trim().slice(0, 120);
  const pn = String(cl.partNumber || '').trim().slice(0, 80);
  const cat = String(cl.partCategory || '').trim().slice(0, 64);
  const bits = [];
  if (pos) bits.push(`Pos: ${pos}`);
  if (cat && cat !== 'none') bits.push(cat);
  if (pn) bits.push(`PN: ${pn}`);
  const suffix = bits.length ? ` (${bits.join(' · ')})` : '';
  return sanitizeName((base + suffix).slice(0, 380), 'Line');
}

/** Optional per-line memo sent as the QuickBooks expense line Description (else built from description + parts). */
function costLineQboDescription(cl) {
  const custom = String(cl.qboLineDescription || '').trim();
  if (custom) return sanitizeName(custom.slice(0, 380), 'Line');
  return costLineDescriptionForQbo(cl);
}

function maintenanceExpenseLineBillableStatus(cl) {
  if (cl.billable === true) return 'Billable';
  if (cl.billable === false) return 'NotBillable';
  return undefined;
}

/** Class (unit), billable customer, billable flag on AccountBased / ItemBased expense line detail. */
function applyMaintenanceExpenseLineRefs(erp, detail, cl, assetUnit) {
  const cls = pickValidatedQboClassId(erp, cl.qboClassId != null ? String(cl.qboClassId) : '', assetUnit);
  if (cls) detail.ClassRef = { value: cls };
  const cust = pickValidatedQboCustomerId(erp, cl.qboCustomerId || '');
  if (cust) detail.CustomerRef = { value: cust };
  const bill = maintenanceExpenseLineBillableStatus(cl);
  if (bill) detail.BillableStatus = bill;
}

function sanitizeMaintenanceCostLines(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const description = String(x.description || '').trim().slice(0, 180);
    const qRaw = safeNum(x.quantity, null);
    const quantity =
      qRaw != null && Number.isFinite(qRaw) && qRaw >= 0 ? Math.round(qRaw * 100000) / 100000 : null;
    const uRaw = safeNum(x.unitPrice, null);
    const unitPrice =
      uRaw != null && Number.isFinite(uRaw) && uRaw >= 0 ? Math.round(uRaw * 100) / 100 : null;
    let amount = safeNum(x.amount, 0) || 0;
    if (quantity != null && quantity > 0 && unitPrice != null) {
      amount = Math.round(quantity * unitPrice * 100) / 100;
    } else {
      amount = Math.round(amount * 100) / 100;
    }
    const row = { description, amount };
    if (quantity != null && quantity > 0) row.quantity = quantity;
    if (unitPrice != null && unitPrice > 0) row.unitPrice = unitPrice;
    const dm = String(x.detailMode || '').trim();
    if (dm === 'item' || dm === 'category') row.detailMode = dm;
    const qa = String(x.qboAccountId || '').trim().slice(0, 64);
    const qi = String(x.qboItemId || '').trim().slice(0, 64);
    if (qa) row.qboAccountId = qa;
    if (qi) row.qboItemId = qi;
    const partCategory = String(x.partCategory || '').trim().slice(0, 64);
    const partPosition = String(x.partPosition || '').trim().slice(0, 120);
    const partNumber = String(x.partNumber || '').trim().slice(0, 80);
    if (partCategory) row.partCategory = partCategory;
    if (partPosition) row.partPosition = partPosition;
    if (partNumber) row.partNumber = partNumber;

    const qboLineDescription = String(x.qboLineDescription || '').trim().slice(0, 380);
    if (qboLineDescription) row.qboLineDescription = qboLineDescription;
    const qboCustomerId = String(x.qboCustomerId || '').trim().slice(0, 64);
    if (qboCustomerId) row.qboCustomerId = qboCustomerId;
    const qboClassId = String(x.qboClassId || '').trim().slice(0, 64);
    if (qboClassId) row.qboClassId = qboClassId;
    if (typeof x.billable === 'boolean') row.billable = x.billable;

    if (description || amount > 0 || (quantity != null && quantity > 0) || (unitPrice != null && unitPrice > 0)) {
      out.push(row);
    }
  }
  return out;
}

/**
 * Build QBO Purchase/Bill Line[] from maintenance costLines (category or item per row).
 */
async function buildQboPurchaseBillLinesFromCostLines(costLines, opts) {
  const {
    erp,
    assetUnit = '',
    classId: _legacyHeaderClass = '',
    fallbackAccountId = '',
    fallbackItemId = '',
    fallbackDetailMode = 'category'
  } = opts;
  if (!erp || typeof erp !== 'object') {
    throw new Error('ERP context is required to build QuickBooks lines from maintenance cost breakdown');
  }
  const out = [];
  for (const cl of costLines) {
    const amount = safeNum(cl.amount, 0);
    if (!(amount > 0)) continue;
    const mode =
      String(cl.detailMode || fallbackDetailMode || 'category').trim() === 'item' ? 'item' : 'category';
    const lineDesc = costLineQboDescription(cl);
    if (mode === 'item') {
      const rawItemId = String(cl.qboItemId || fallbackItemId || '').trim().replace(/[^\d]/g, '');
      if (!rawItemId) {
        throw new Error(
          `QuickBooks item required for item line "${lineDesc}" — pick a per-line item or set a default item on the record`
        );
      }
      const lineAcctFallback = String(cl.qboAccountId || fallbackAccountId || '').trim().replace(/[^\d]/g, '');
      const itemObj = await qboTryGetItemById(rawItemId);
      if (itemObj && qboItemTypeOkForPurchaseExpenseLine(itemObj.Type)) {
        const qtyBase = safeNum(cl.quantity, safeNum(cl.qty, 1)) || 1;
        const qty = qtyBase > 0 ? qtyBase : 1;
        const itemDetail = {
          ItemRef: { value: String(itemObj.Id), name: itemObj.Name },
          Qty: qty,
          UnitPrice: Math.round((amount / qty) * 1000000) / 1000000
        };
        applyMaintenanceExpenseLineRefs(erp, itemDetail, cl, assetUnit);
        out.push({
          Amount: amount,
          DetailType: 'ItemBasedExpenseLineDetail',
          Description: sanitizeName(lineDesc, 'Line'),
          ItemBasedExpenseLineDetail: itemDetail
        });
      } else {
        let acctDigits = lineAcctFallback;
        if (itemObj && !qboItemTypeOkForPurchaseExpenseLine(itemObj.Type)) {
          acctDigits =
            acctDigits || String(itemObj.ExpenseAccountRef?.value || '').replace(/[^\d]/g, '') || '';
          if (!acctDigits) {
            throw new Error(
              `QuickBooks item "${itemObj.Name || rawItemId}" (type ${itemObj.Type}) cannot be used as a purchase item line for "${lineDesc}". Pick an expense account for this line or choose a Service/non-inventory item.`
            );
          }
        } else if (!itemObj) {
          const acct = await qboTryGetAccountById(rawItemId);
          if (acct && qboExpenseAccountTypeOk(acct.AccountType)) {
            acctDigits = String(acct.Id).replace(/[^\d]/g, '');
          } else {
            throw new Error(
              `QuickBooks id ${rawItemId} for line "${lineDesc}" is not a postable item or expense account — refresh QBO Master and re-link this line.`
            );
          }
        } else {
            throw new Error(
              `QuickBooks item id ${rawItemId} for line "${lineDesc}" could not be posted as an item line — refresh QBO Master.`
            );
        }
        const accountQbo = await qboFindAccountById(acctDigits);
        if (!accountQbo) throw new Error(`QuickBooks account not found for line: ${lineDesc}`);
        const acctDetail = {
          AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
        };
        applyMaintenanceExpenseLineRefs(erp, acctDetail, cl, assetUnit);
        out.push({
          Amount: amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: sanitizeName(lineDesc, 'Line'),
          AccountBasedExpenseLineDetail: acctDetail
        });
      }
    } else {
      const acctId = String(cl.qboAccountId || fallbackAccountId || '').trim();
      if (!acctId) {
        throw new Error(
          `QuickBooks expense account required for category line "${lineDesc}" — pick per-line account or default category on the form`
        );
      }
      const accountQbo = await qboFindAccountById(acctId);
      if (!accountQbo) throw new Error(`QuickBooks account not found for line: ${lineDesc}`);
      const acctDetail = {
        AccountRef: { value: accountQbo.Id, name: accountQbo.Name }
      };
      applyMaintenanceExpenseLineRefs(erp, acctDetail, cl, assetUnit);
      out.push({
        Amount: amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        Description: sanitizeName(lineDesc, 'Line'),
        AccountBasedExpenseLineDetail: acctDetail
      });
    }
  }
  return out;
}

/** Shared field normalization for POST / PATCH maintenance ERP records. */
function deriveMaintenanceRecordFields(body) {
  const unit = String(body.unit || '').trim();
  const serviceType = sanitizeName(body.serviceType || body.recordType || 'Service', 'Service');
  const tireLineItems = sanitizeMaintenanceTireLineItems(body.tireLineItems);
  const firstTire = tireLineItems[0];
  const tirePosition = String(body.tirePosition || '').trim() || (firstTire?.tirePosition || '');
  const tireBrand = String(body.tireBrand || '').trim() || (firstTire?.tireBrand || '');
  const tireDot = String(body.tireDot || '').trim() || (firstTire?.tireDot || '');
  const tireCondition = String(body.tireCondition || '').trim() || (firstTire?.tireCondition || '');
  const costLines = sanitizeMaintenanceCostLines(body.costLines);
  const plannedWork = sanitizeMaintenancePlannedWork(body.plannedWork);
  const sumLines = costLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const costFromLines = Math.round(sumLines * 100) / 100;
  const cost =
    costLines.length && costFromLines > 0 ? costFromLines : safeNum(body.cost, 0) || 0;
  const qboTxnType = String(body.qboTxnType || '').trim().toLowerCase() === 'bill' ? 'bill' : 'expense';
  const recordCore = {
    unit,
    recordType: String(body.recordType || 'maintenance').trim() || 'maintenance',
    serviceType,
    serviceDate: String(body.serviceDate || '').trim(),
    serviceMileage: safeNum(body.serviceMileage, null),
    vendor: String(body.vendor || '').trim(),
    cost,
    notes: String(body.notes || '').trim(),
    loadNumber: String(body.loadNumber || body.load_number || '').trim(),
    tireCondition,
    tirePosition,
    tirePositionText: String(body.tirePositionText || '').trim(),
    tireBrand,
    tireDot,
    installMileage: safeNum(body.installMileage, null),
    removeMileage: safeNum(body.removeMileage, null),
    expectedTireLifeMiles: safeNum(body.expectedTireLifeMiles, null),
    accidentAtFault: String(body.accidentAtFault || '').trim(),
    accidentLocation: String(body.accidentLocation || '').trim(),
    accidentReportNumber: String(body.accidentReportNumber || '').trim(),
    repairLocationType: String(body.repairLocationType || '').trim(),
    assetCategory: String(body.assetCategory || '').trim().slice(0, 80),
    vendorInvoiceNumber: String(body.vendorInvoiceNumber || '').trim(),
    workOrderNumber: String(body.workOrderNumber || body.vendorWorkOrderNumber || '').trim(),
    qboVendorId: String(body.qboVendorId || '').trim().slice(0, 64),
    qboAccountId: String(body.qboAccountId || '').trim().slice(0, 64),
    qboItemId: String(body.qboItemId || '').trim().slice(0, 64),
    detailMode: String(body.detailMode || '').trim() === 'item' ? 'item' : 'category',
    paymentMethodId: String(body.paymentMethodId || '').trim().slice(0, 64) || 'pm_other',
    qboBankAccountId: String(body.qboBankAccountId || '').trim().slice(0, 64),
    qboTxnType,
    qboDueDate: String(body.qboDueDate || '').trim().slice(0, 32),
    qboDocNumber: String(body.qboDocNumber || '').trim().slice(0, 64)
  };
  if (tireLineItems.length) recordCore.tireLineItems = tireLineItems;
  if (costLines.length) recordCore.costLines = costLines;
  if (plannedWork.length) recordCore.plannedWork = plannedWork;
  return { recordCore, cost, plannedWork, costLines, tireLineItems };
}

app.post('/api/maintenance/record', async (req, res) => {
  try {
    const body = req.body || {};
    const { recordCore, cost } = deriveMaintenanceRecordFields(body);
    const unit = recordCore.unit;
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    const erp = readErp();
    if (!Array.isArray(erp.records)) erp.records = [];
    const record = {
      id: uid('mr'),
      ...recordCore,
      qboSyncStatus: '',
      qboPurchaseId: '',
      qboEntityType: '',
      qboError: '',
      createdAt: new Date().toISOString()
    };
    erp.records.push(record);
    const sm = safeNum(body.serviceMileage, null);
    if (sm != null && sm > 0) {
      erp.currentMileage[unit] = Math.max(safeNum(erp.currentMileage[unit], 0) || 0, sm);
    }
    writeErp(erp);

    let qbo = null;
    const qboStore = readQbo();
    const postToQbo = body.postToQbo === true || String(body.postToQbo || '').toLowerCase() === 'true';
    if (cost > 0 && qboStore.tokens?.realmId && postToQbo) {
      try {
        const posted = await qboPostMaintenanceRecord(record.id);
        qbo = { ok: true, posted: true, record: posted };
      } catch (err) {
        logError('api/maintenance/record qbo', err);
        const errMsg = enrichQboInvalidReferenceMessage(err.message || String(err));
        const erp2 = readErp();
        const idx2 = (erp2.records || []).findIndex(x => String(x.id) === String(record.id));
        if (idx2 !== -1) {
          erp2.records[idx2] = {
            ...erp2.records[idx2],
            qboSyncStatus: 'error',
            qboError: errMsg
          };
          writeErp(erp2);
          record.qboSyncStatus = 'error';
          record.qboError = errMsg;
        }
        qbo = { ok: false, posted: false, error: errMsg };
      }
    } else if (cost > 0 && postToQbo) {
      qbo = { ok: false, skipped: true, reason: 'quickbooks_not_connected' };
    } else {
      qbo = { ok: true, skipped: true, reason: postToQbo ? 'no_cost' : 'not_requested' };
    }

    res.json({ ok: true, record, qbo });
  } catch (error) {
    logError('api/maintenance/record', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/maintenance/record/:id', async (req, res) => {
  try {
    const erp = readErp();
    const id = String(req.params.id || '').trim();
    const rec = (erp.records || []).find(x => String(x.id) === id);
    if (!rec) return res.status(404).json({ error: 'Maintenance record not found' });
    res.json({ ok: true, record: rec });
  } catch (error) {
    logError('api/maintenance/record/:id GET', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/maintenance/record/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(req.params.id || '').trim();
    const erp = readErp();
    if (!Array.isArray(erp.records)) erp.records = [];
    const idx = erp.records.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Maintenance record not found' });
    const prev = erp.records[idx];

    const { recordCore, cost, plannedWork, costLines, tireLineItems } = deriveMaintenanceRecordFields(body);
    const unit = recordCore.unit;
    if (!unit) return res.status(400).json({ error: 'unit is required' });
    if (String(prev.unit || '').trim() !== unit) {
      return res.status(400).json({ error: 'unit must match the existing record' });
    }

    const alreadyPosted =
      String(prev.qboSyncStatus || '').toLowerCase() === 'posted' &&
      String(prev.qboPurchaseId || prev.qboEntityId || '').trim();

    const record = {
      ...prev,
      ...recordCore,
      id: prev.id,
      createdAt: prev.createdAt
    };
    if (alreadyPosted) {
      record.qboPurchaseId = prev.qboPurchaseId;
      record.qboEntityType = prev.qboEntityType;
      record.qboEntityId = prev.qboEntityId;
      record.qboSyncStatus = prev.qboSyncStatus;
      record.qboError = prev.qboError;
    } else {
      record.qboPurchaseId = prev.qboPurchaseId || '';
      record.qboEntityType = prev.qboEntityType || '';
      record.qboEntityId = prev.qboEntityId || '';
      record.qboSyncStatus = prev.qboSyncStatus || '';
      record.qboError = prev.qboError || '';
    }

    if (plannedWork.length) record.plannedWork = plannedWork;
    else delete record.plannedWork;
    if (costLines.length) record.costLines = costLines;
    else delete record.costLines;
    if (tireLineItems.length) record.tireLineItems = tireLineItems;
    else delete record.tireLineItems;

    erp.records[idx] = record;
    const sm = safeNum(body.serviceMileage, null);
    if (sm != null && sm > 0) {
      erp.currentMileage[unit] = Math.max(safeNum(erp.currentMileage[unit], 0) || 0, sm);
    }
    writeErp(erp);

    let qbo = null;
    const qboStore = readQbo();
    const postToQbo = body.postToQbo === true || String(body.postToQbo || '').toLowerCase() === 'true';
    if (!alreadyPosted && cost > 0 && qboStore.tokens?.realmId && postToQbo) {
      try {
        const posted = await qboPostMaintenanceRecord(record.id);
        qbo = { ok: true, posted: true, record: posted };
      } catch (err) {
        logError('api/maintenance/record/:id PATCH qbo', err);
        const errMsg = enrichQboInvalidReferenceMessage(err.message || String(err));
        const erp2 = readErp();
        const idx2 = (erp2.records || []).findIndex(x => String(x.id) === String(record.id));
        if (idx2 !== -1) {
          erp2.records[idx2] = {
            ...erp2.records[idx2],
            qboSyncStatus: 'error',
            qboError: errMsg
          };
          writeErp(erp2);
          record.qboSyncStatus = 'error';
          record.qboError = errMsg;
        }
        qbo = { ok: false, posted: false, error: errMsg };
      }
    } else if (!alreadyPosted && cost > 0 && postToQbo) {
      qbo = { ok: false, skipped: true, reason: 'quickbooks_not_connected' };
    } else {
      let reason = 'not_requested';
      if (postToQbo && alreadyPosted) reason = 'already_posted';
      else if (postToQbo && !(cost > 0)) reason = 'no_cost';
      qbo = { ok: true, skipped: true, reason };
    }

    res.json({ ok: true, record, qbo });
  } catch (error) {
    logError('api/maintenance/record/:id PATCH', error);
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
  const costLines = Array.isArray(rec.costLines) ? rec.costLines : [];
  const useCostBreakdown = costLines.length > 0;
  if (!useCostBreakdown && !accountId) {
    throw new Error('No expense account in QBO cache — refresh QuickBooks master');
  }

  const detailMode = rec.detailMode === 'item' ? 'item' : 'category';
  const itemFallback = String(rec.qboItemId || '').trim();
  const txnType = rec.qboTxnType === 'bill' ? 'bill' : 'expense';
  const docNum =
    String(rec.qboDocNumber || '').trim() ||
    String(rec.vendorInvoiceNumber || '').trim() ||
    String(rec.loadNumber || '').trim() ||
    '';

  const apLike = {
    txnType,
    detailMode,
    qboVendorId: vendorId,
    paymentMethodId: rec.paymentMethodId || 'pm_other',
    qboBankAccountId: rec.qboBankAccountId || '',
    qboAccountId: accountId,
    qboItemId: itemFallback,
    qty: 1,
    amount: cost,
    txnDate: rec.serviceDate || new Date().toISOString().slice(0, 10),
    dueDate: String(rec.qboDueDate || '').trim(),
    docNumber: docNum || undefined,
    description: rec.serviceType || 'Maintenance',
    memo:
      [rec.notes, plannedWorkSummaryForMemo(rec.plannedWork)]
        .filter(Boolean)
        .join('\n\n')
        .trim() || `${rec.unit || ''} ${rec.recordType || ''}`.trim(),
    assetUnit: rec.unit || ''
  };
  if (useCostBreakdown) apLike.costLines = costLines;

  const result = await qboCreateApTransaction(apLike);
  erp.records[idx] = {
    ...rec,
    qboSyncStatus: 'posted',
    qboPurchaseId: result.qboEntityId,
    qboEntityType: result.qboEntityType,
    qboError: '',
    qboVendorId: vendorId,
    qboAccountId: result.qboAccountId || accountId,
    qboItemId: result.qboItemId || itemFallback
  };
  writeErp(erp);
  return erp.records[idx];
}

app.post('/api/qbo/post-record/:id', async (req, res) => {
  try {
    const record = await qboPostMaintenanceRecord(req.params.id);
    res.json({ ok: true, record });
  } catch (error) {
    const msg = enrichQboInvalidReferenceMessage(error.message || String(error));
    const erp = readErp();
    const idx = (erp.records || []).findIndex(x => String(x.id) === String(req.params.id));
    if (idx !== -1) {
      erp.records[idx] = {
        ...erp.records[idx],
        qboSyncStatus: 'error',
        qboError: msg
      };
      writeErp(erp);
    }
    logError('api/qbo/post-record', error);
    res.status(500).json({ error: msg });
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
      workOrders: summarizePostingRows(erpActiveWorkOrders(erp)),
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

app.get('/api/reports/export/work-orders.csv', (_req, res) => {
  try {
    const erp = readErp();
    const header = [
      'wo_id',
      'system_wo_number',
      'voided',
      'void_reason',
      'txn_type',
      'unit',
      'asset_category',
      'service_date',
      'due_date',
      'load_number',
      'vendor_invoice_number',
      'internal_work_order_number',
      'vendor',
      'qbo_vendor_id',
      'payment_method_id',
      'qbo_bank_account_id',
      'repair_location_type',
      'line_count',
      'total_amount',
      'lines_summary',
      'qbo_status',
      'qbo_entity_type',
      'qbo_entity_id',
      'qbo_posted_at',
      'qbo_error',
      'created_at'
    ];
    const lines = [header.join(',')];
    for (const wo of erp.workOrders || []) {
      const rows = Array.isArray(wo.lines) ? wo.lines : [];
      const total = Math.round(rows.reduce((s, l) => s + (safeNum(l.amount, 0) || 0), 0) * 100) / 100;
      const summary = rows
        .map(l => {
          const dm = String(l.detailMode || '').trim() || 'category';
          const ref = dm === 'item' ? String(l.qboItemId || '').trim() : String(l.qboAccountId || '').trim();
          const svc = String(l.serviceType || l.lineType || 'Line').trim();
          const amt = safeNum(l.amount, 0) || 0;
          return `${svc} $${amt.toFixed(2)} ${dm}${ref ? `(${ref})` : ''}`;
        })
        .join(' | ');
      lines.push(
        [
          csvEscape(wo.id),
          csvEscape(wo.workOrderNumber || ''),
          csvEscape(wo.voided ? 'yes' : 'no'),
          csvEscape(wo.voidReason || ''),
          csvEscape(wo.txnType || ''),
          csvEscape(wo.unit || ''),
          csvEscape(wo.assetCategory || ''),
          csvEscape(wo.serviceDate || ''),
          csvEscape(wo.dueDate || ''),
          csvEscape(wo.loadNumber || ''),
          csvEscape(wo.vendorInvoiceNumber || ''),
          csvEscape(wo.internalWorkOrderNumber || ''),
          csvEscape(wo.vendor || ''),
          csvEscape(wo.qboVendorId || ''),
          csvEscape(wo.paymentMethodId || ''),
          csvEscape(wo.qboBankAccountId || ''),
          csvEscape(wo.repairLocationType || ''),
          String(rows.length),
          String(total.toFixed(2)),
          csvEscape(summary),
          csvEscape(wo.qboSyncStatus || ''),
          csvEscape(wo.qboEntityType || ''),
          csvEscape(wo.qboEntityId || ''),
          csvEscape(wo.qboPostedAt || ''),
          csvEscape(wo.qboError || ''),
          csvEscape(wo.createdAt || '')
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="work-orders.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/reports/export/work-orders', error);
    res.status(500).send(error.message);
  }
});

app.get('/api/reports/export/ap-transactions.csv', (_req, res) => {
  try {
    const erp = readErp();
    const header = [
      'ap_id',
      'txn_type',
      'detail_mode',
      'txn_date',
      'due_date',
      'doc_number',
      'vendor_qbo_id',
      'payment_method_id',
      'qbo_bank_account_id',
      'qbo_account_id',
      'qbo_item_id',
      'qty',
      'amount',
      'description',
      'memo',
      'asset_unit',
      'qbo_status',
      'qbo_entity_type',
      'qbo_entity_id',
      'qbo_posted_at',
      'qbo_error',
      'created_at'
    ];
    const lines = [header.join(',')];
    for (const ap of erp.apTransactions || []) {
      lines.push(
        [
          csvEscape(ap.id),
          csvEscape(ap.txnType || ''),
          csvEscape(ap.detailMode || ''),
          csvEscape(ap.txnDate || ''),
          csvEscape(ap.dueDate || ''),
          csvEscape(ap.docNumber || ''),
          csvEscape(ap.qboVendorId || ''),
          csvEscape(ap.paymentMethodId || ''),
          csvEscape(ap.qboBankAccountId || ''),
          csvEscape(ap.qboAccountId || ''),
          csvEscape(ap.qboItemId || ''),
          String(safeNum(ap.qty, 1) || 1),
          String((safeNum(ap.amount, 0) || 0).toFixed(2)),
          csvEscape(ap.description || ''),
          csvEscape(ap.memo || ''),
          csvEscape(ap.assetUnit || ''),
          csvEscape(ap.qboSyncStatus || ''),
          csvEscape(ap.qboEntityType || ''),
          csvEscape(ap.qboEntityId || ''),
          csvEscape(ap.qboPostedAt || ''),
          csvEscape(ap.qboError || ''),
          csvEscape(ap.createdAt || '')
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ap-transactions.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/reports/export/ap-transactions', error);
    res.status(500).send(error.message);
  }
});

app.get('/api/reports/export/relay-expenses.csv', (_req, res) => {
  try {
    const erp = readErp();
    const header = [
      'doc_number',
      'txn_date',
      'unit',
      'vendor',
      'qb_category',
      'spreadsheet_category',
      'expense_type',
      'amount',
      'gallons',
      'price_per_gallon',
      'odometer_miles',
      'location',
      'memo'
    ];
    const lines = [header.join(',')];
    for (const r of erp.relayExpenses || []) {
      const gal = safeNum(r.gallons, null);
      const ppg = safeNum(r.pricePerGallon, null);
      const odo = safeNum(r.odometerMiles, null);
      lines.push(
        [
          csvEscape(r.docNumber || ''),
          csvEscape(r.txnDate || ''),
          csvEscape(r.unit || ''),
          csvEscape(r.vendor || ''),
          csvEscape(r.qbCategory || ''),
          csvEscape(r.spreadsheetCategory || r.expenseType || ''),
          csvEscape(r.expenseType || ''),
          String((safeNum(r.amount, 0) || 0).toFixed(2)),
          gal != null && Number.isFinite(gal) && gal > 0 ? String(gal.toFixed(3)) : '',
          ppg != null && Number.isFinite(ppg) && ppg > 0 ? String(ppg.toFixed(3)) : '',
          odo != null && Number.isFinite(odo) && odo > 0 ? String(odo.toFixed(0)) : '',
          csvEscape(r.location || ''),
          csvEscape(r.memo || '')
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="relay-expenses.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/reports/export/relay-expenses', error);
    res.status(500).send(error.message);
  }
});

/**
 * QuickBooks Spreadsheet Sync export (matches the "Quickbooks" tab headers in
 * QB-Relay Expense Conversion Template).
 *
 * Note: This is a flat CSV for copy/paste into QB Spreadsheet Sync. It does NOT post to QBO.
 */
app.get('/api/reports/export/relay-qb-sync.csv', (_req, res) => {
  try {
    const erp = readErp();

    const headerRaw = [
      'Payment Type\r\nSelect from list',
      'Payee\r\nSelect from list',
      'Deposit to/\r\nPayment account\r\nSelect from list',
      'Payment Date',
      'Payment Method\r\nSelect from list',
      'Reference',
      'Location\r\nSelect from list',
      'Tax Type\r\nSelect from list',
      'Line Type',
      'Item/Category\r\nSelect from list',
      'Description',
      'Qty\r\nUse for Items',
      'Rate\r\nUse for Items',
      'Amount\r\nUse for Category',
      'Customer\r\nUse for Purchase',
      'Class\r\nSelect from list',
      'Tax Rate\r\nSelect from list',
      'Memo',
      'Engine Row'
    ];

    const header = headerRaw.map(h => String(h).replace(/\s*\r?\n\s*/g, ' ').trim());
    const lines = [header.map(csvEscape).join(',')];
    for (const r of erp.relayExpenses || []) {
      const amount = safeNum(r.amount, null);
      if (amount == null || !Number.isFinite(amount) || amount <= 0) continue;

      const paymentType = 'Expense';
      const payee = String(r.vendor || '').trim();
      const paymentAccount = ''; // set in spreadsheet if needed
      const paymentDate = sliceIsoDate(r.txnDate || '');
      const paymentMethod = ''; // optional in template
      const reference = String(r.docNumber || '').trim();
      const location = String(r.location || '').trim();
      const taxType = '';
      const lineType = 'Category';
      const itemCategory = String(r.qbCategory || '').trim() || String(r.spreadsheetCategory || r.expenseType || '').trim();
      const description = String(r.expenseType || '').trim() + (r.unit ? ` (${r.unit})` : '');
      const qty = '';
      const rate = '';
      const customer = '';
      const klass = '';
      const taxRate = '';
      const memo = String(r.memo || '').trim();
      const engineRow = '';

      lines.push(
        [
          paymentType,
          payee,
          paymentAccount,
          paymentDate,
          paymentMethod,
          reference,
          location,
          taxType,
          lineType,
          itemCategory,
          description,
          qty,
          rate,
          String(amount.toFixed(2)),
          customer,
          klass,
          taxRate,
          memo,
          engineRow
        ].map(csvEscape).join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=\"relay-qb-spreadsheet-sync.csv\"');
    res.send(lines.join('\n'));
  } catch (error) {
    logError('api/reports/export/relay-qb-sync', error);
    res.status(500).send(error.message);
  }
});

app.post('/api/work-orders', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
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
      workOrderNumber: allocNextWorkOrderNumber(erp),
      voided: false,
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
      qboTermId: String(body.qboTermId || '').trim(),
      notes: body.notes || '',
      settlementNo: String(body.settlementNo || '').trim() || null,
      pickupDate: String(body.pickupDate || '').trim() || null,
      deliveryDate: String(body.deliveryDate || '').trim() || null,
      emptyMiles: body.emptyMiles != null && String(body.emptyMiles).trim() !== '' ? String(body.emptyMiles).trim() : null,
      loadedMiles: body.loadedMiles != null && String(body.loadedMiles).trim() !== '' ? String(body.loadedMiles).trim() : null,
      origin: String(body.origin || '').trim() || null,
      destination: String(body.destination || '').trim() || null,
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

app.post('/api/work-orders/:id/void', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const erp = readErp();
    const idx = (erp.workOrders || []).findIndex(x => String(x.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Work order not found' });
    const wo = erp.workOrders[idx];
    if (wo.voided) return res.status(400).json({ error: 'Work order is already voided' });
    const qid = String(wo.qboEntityId || '').trim();
    if (qid) {
      return res.status(400).json({
        error: 'This work order is posted to QuickBooks. Use Revert in QuickBooks first, then void here.'
      });
    }
    const reason = String(req.body?.reason || req.body?.voidReason || '').trim().slice(0, 500);
    erp.workOrders[idx] = {
      ...wo,
      voided: true,
      voidedAt: new Date().toISOString(),
      voidReason: reason || null
    };
    writeErp(erp);
    res.json({ ok: true, workOrder: erp.workOrders[idx] });
  } catch (error) {
    logError('api/work-orders/:id/void', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/work-orders/:id', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const erp = readErp();
    const id = String(req.params.id || '');
    const idx = (erp.workOrders || []).findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Work order not found' });
    const wo = erp.workOrders[idx];
    const qid = String(wo.qboEntityId || '').trim();
    if (qid) {
      return res.status(400).json({
        error: 'Cannot delete a work order posted to QuickBooks. Revert in QuickBooks first.'
      });
    }
    erp.workOrders.splice(idx, 1);
    writeErp(erp);
    res.json({ ok: true, removedId: id });
  } catch (error) {
    logError('api/work-orders DELETE', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/qbo/post-work-order/:id', async (req, res) => {
  if (!requireErpWriteOrAdmin(req, res)) return;
  const erp = readErp();
  const idx = (erp.workOrders || []).findIndex(x => String(x.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Work order not found' });
  if (erp.workOrders[idx].voided) {
    return res.status(400).json({ error: 'Voided work orders cannot be posted to QuickBooks' });
  }

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
    const msg = enrichQboInvalidReferenceMessage(error.message || String(error));
    erp.workOrders[idx] = {
      ...erp.workOrders[idx],
      qboSyncStatus: 'error',
      qboError: msg,
      qboErrorAt: new Date().toISOString()
    };
    writeErp(erp);
    res.status(500).json({ error: msg });
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
      assetCategory: String(body.assetCategory || '').trim().slice(0, 80),
      qboTermId: String(body.qboTermId || '').trim(),
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

/** List QuickBooks bills with an open balance (optionally for one vendor). Live query each call. */
app.get('/api/qbo/open-bills', async (req, res) => {
  try {
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
    }
    const billIdQuery = String(req.query.billId || '').replace(/\D/g, '');
    if (billIdQuery) {
      const single = await qboFetchOpenBillByIdFromQbo(billIdQuery);
      if (single.error) {
        return res.status(400).json({ ok: false, error: single.error });
      }
      return res.json({
        ok: true,
        bills: single.bills,
        notice: single.notice || '',
        live: true,
        billId: billIdQuery
      });
    }
    const vendorId = String(req.query.vendorId || '').trim();
    const search = String(req.query.search || req.query.q || '').trim();
    const maxResults = safeNum(req.query.maxResults, null);
    const bills = await qboFetchOpenBillsFromQbo(vendorId, {
      search,
      maxResults: maxResults != null && Number.isFinite(maxResults) ? maxResults : search && !vendorId ? 400 : 150
    });
    res.json({ ok: true, bills, live: true });
  } catch (error) {
    logError('api/qbo/open-bills', error);
    res.status(500).json({ ok: false, error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

/**
 * Record a Bill Payment in QuickBooks (pays posted Bills from a bank or card account).
 * Requires ERP write secret or admin — same as other financial writes.
 */
app.post('/api/qbo/bill-payment', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ error: 'QuickBooks is not connected' });
    }
    const result = await qboCreateBillPaymentFromApp(req.body || {});
    const erp = readErp();
    const erpLogId = appendQboBillPaymentLogEntry(erp, req, result, req.body || {});
    writeErp(erp);
    res.json({
      ok: true,
      billPaymentId: result.billPaymentId,
      docNumber: result.docNumber,
      totalAmt: result.totalAmt,
      vendorQboId: result.vendorQboId,
      lineLog: result.lineLog,
      erpLogId
    });
  } catch (error) {
    logError('api/qbo/bill-payment', error);
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    const msg = enrichQboInvalidReferenceMessage(error.message || String(error));
    erp.apTransactions[idx] = {
      ...erp.apTransactions[idx],
      qboSyncStatus: 'error',
      qboError: msg,
      qboErrorAt: new Date().toISOString()
    };
    writeErp(erp);
    res.status(500).json({ error: msg });
  }
});

function bestQboVendorIdByName(erp, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return '';
  const rows = erp?.qboCache?.vendors || [];
  const exact = rows.find(v => String(v?.name || '').trim().toLowerCase() === n);
  if (exact?.qboId) return String(exact.qboId);
  // Fallback: contains match (avoid over-matching very short names)
  if (n.length < 4) return '';
  const contains = rows.find(v => String(v?.name || '').trim().toLowerCase().includes(n));
  return contains?.qboId ? String(contains.qboId) : '';
}

function bestFuelExpenseAccountId(erp) {
  const rows = erp?.qboCache?.accountsExpense || [];
  const pick = (pred) => rows.find(a => pred(String(a?.name || '').toLowerCase()));
  return (
    pick(n => n.includes('fuel'))?.qboId ||
    pick(n => n.includes('diesel'))?.qboId ||
    pick(n => n.includes('gas'))?.qboId ||
    rows[0]?.qboId ||
    ''
  );
}

function bestFuelItemId(erp) {
  const items = erp?.qboCache?.items || [];
  const hit = items.find(i => /diesel|fuel|def|reefer/i.test(String(i.name || '')));
  return hit?.qboId ? String(hit.qboId) : '';
}

function normAcctKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Match QBO expense account to Relay-style category path (e.g. Fuel Expenses:Fuel-Truck Diesel). */
function matchQboExpenseAccountIdFromCategoryPath(erp, qbCategoryPath) {
  const raw = String(qbCategoryPath || '').trim();
  if (!raw) return '';
  const rows = erp?.qboCache?.accountsExpense || [];
  if (!rows.length) return '';
  const c = normAcctKey(raw);
  const leaf = raw.split(':').map(x => x.trim()).filter(Boolean).pop() || '';
  const leafN = normAcctKey(leaf);
  let hit = rows.find(
    a => normAcctKey(a.fullyQualifiedName) === c || normAcctKey(a.name) === c
  );
  if (hit?.qboId) return String(hit.qboId);
  if (leafN.length >= 2) {
    hit = rows.find(a => normAcctKey(a.name) === leafN || normAcctKey(a.fullyQualifiedName || a.name) === leafN);
    if (hit?.qboId) return String(hit.qboId);
    hit = rows.find(
      a =>
        normAcctKey(a.fullyQualifiedName || '').endsWith(leafN) ||
        normAcctKey(a.fullyQualifiedName || '').includes(':' + leafN)
    );
    if (hit?.qboId) return String(hit.qboId);
  }
  const tail = c.includes(':') ? c.split(':').pop().trim() : c;
  hit = rows.find(a => normAcctKey(a.name).includes(tail) || tail.includes(normAcctKey(a.name)));
  return hit?.qboId ? String(hit.qboId) : '';
}

function bestFuelExpenseAccountIdByProduct(erp, productType) {
  const k = String(productType || '').toLowerCase();
  const rows = erp?.qboCache?.accountsExpense || [];
  const pick = re => rows.find(a => re.test(String(a.name || '').toLowerCase()));
  if (k.includes('def')) return pick(n => /def|exhaust|fluid|urea/i.test(n))?.qboId || '';
  if (k.includes('reefer')) return pick(n => /reefer|reef/i.test(n))?.qboId || '';
  if (k.includes('relay') || k.includes('fee')) return pick(n => /bank|fee|relay/i.test(n))?.qboId || '';
  return pick(n => /diesel|truck.*fuel|fuel.*diesel|^fuel$/i.test(n))?.qboId || '';
}

function inferredFuelQbCategory(fp) {
  const existing = String(fp?.qbCategory || '').trim();
  if (existing) return existing;
  const pt = String(fp?.productType || 'diesel').trim();
  return relayQuickBooksCategory({ kind: pt, productsText: '' });
}

function resolveFuelPurchaseExpenseAccountId(erp, fp, bodyAccountId, draft) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const explicit = String(bodyAccountId || d.qboAccountId || '')
    .trim()
    .replace(/[^\d]/g, '');
  if (explicit) return explicit;
  const fromRelay = matchQboExpenseAccountIdFromCategoryPath(erp, inferredFuelQbCategory(fp));
  if (fromRelay) return fromRelay;
  const byProd = bestFuelExpenseAccountIdByProduct(erp, fp?.productType);
  if (byProd) return byProd;
  return bestFuelExpenseAccountId(erp);
}

function sanitizeQboDocNumber(raw, maxLen = 21) {
  let s = String(raw || '')
    .replace(/[^\w.-]/g, '')
    .trim();
  if (!s) return '';
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function workOrderDocNumberForQbo(wo) {
  const a = sanitizeQboDocNumber(String(wo.vendorInvoiceNumber || '').trim());
  const b = sanitizeQboDocNumber(String(wo.internalWorkOrderNumber || '').trim());
  const c = sanitizeQboDocNumber(String(wo.workOrderNumber || '').trim());
  const out = a || b || c;
  return out || undefined;
}

function buildFuelPurchaseDocNumber(fp) {
  const fpObj = fp && typeof fp === 'object' ? fp : {};
  const draft = fpObj.fuelExpenseDraft && typeof fpObj.fuelExpenseDraft === 'object' ? fpObj.fuelExpenseDraft : {};
  const manualBase = sanitizeQboDocNumber(
    String(fpObj.expenseDocNumber || draft.expenseDocNumber || '').trim()
  );
  if (manualBase) return manualBase;
  const fromRelay = String(fpObj.relayDocNumber || '').trim() || String(fpObj.relayExpenseNo || '').trim();
  if (fromRelay) return sanitizeQboDocNumber(fromRelay.replace(/\s+/g, ''));
  const ext = String(fpObj.relayNote || '')
    .match(/\btxn_[A-Za-z0-9]+\b/);
  if (ext) return sanitizeQboDocNumber(ext[0].replace(/_/g, '').slice(0, 18));
  const unit = String(fpObj.unit || 'U').replace(/[^A-Za-z0-9_-]/g, '');
  const d = sliceIsoDate(fpObj.txnDate || '') || 'nodate';
  const id = String(fpObj.id || 'x').replace(/[^A-Za-z0-9]/g, '');
  const tail = id.slice(-6) || 'new';
  return sanitizeQboDocNumber(`F-${d}-${unit}-${tail}`);
}

function buildFuelPurchaseLineDescription(fp) {
  const custom = String(fp?.lineDescription || '').trim();
  if (custom) return sanitizeName(custom, 'Fuel expense');
  const unit = String(fp?.unit || '').trim();
  const prod = relayLineLabel(String(fp?.productType || 'diesel'));
  const loc = String(fp?.location || '').trim();
  const vendor = String(fp?.vendor || '').trim();
  const bits = [prod + ' purchase', unit && `unit ${unit}`, loc && loc.slice(0, 40), vendor && vendor.slice(0, 40)].filter(Boolean);
  return sanitizeName(bits.join(' · '), 'Fuel expense');
}

app.post('/api/qbo/post-fuel-purchase/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ error: 'QuickBooks is not connected' });
    }

    const erp = readErp();
    const idx = (erp.fuelPurchases || []).findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Fuel purchase not found' });
    const fp = erp.fuelPurchases[idx];
    const draft = fp.fuelExpenseDraft && typeof fp.fuelExpenseDraft === 'object' ? fp.fuelExpenseDraft : {};

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const detailMode =
      String(body.detailMode || draft.detailMode || 'category').toLowerCase() === 'item' ? 'item' : 'category';

    let amount = safeNum(fp.totalCost, 0) || 0;
    if (body.amount != null && String(body.amount).trim() !== '') {
      const a = safeNum(body.amount, 0);
      if (a > 0) amount = Math.round(a * 100) / 100;
    }
    if (!(amount > 0)) return res.status(400).json({ error: 'Fuel amount must be greater than zero' });

    let qty =
      fp.gallons != null && Number.isFinite(Number(fp.gallons)) && Number(fp.gallons) > 0 ? Number(fp.gallons) : 1;
    if (body.qty != null && String(body.qty).trim() !== '') {
      const q = safeNum(body.qty, 0);
      if (q > 0) qty = Math.round(q * 100000) / 100000;
    }

    const vendorId =
      String(body.qboVendorId || '')
        .trim()
        .replace(/[^\d]/g, '') ||
      bestQboVendorIdByName(erp, fp.vendor || '');
    if (!vendorId) {
      return res.status(400).json({
        error: 'Match fuel vendor to a QuickBooks vendor (refresh QBO master or pick vendor on the row).'
      });
    }

    const qboBankAccountId = String(
      body.qboBankAccountId || draft.qboBankAccountId || ''
    )
      .trim()
      .replace(/[^\d]/g, '');
    const qboAccountId = resolveFuelPurchaseExpenseAccountId(
      erp,
      fp,
      String(body.qboAccountId || '').trim().replace(/[^\d]/g, ''),
      draft
    );
    if (!qboAccountId) {
      return res.status(400).json({
        error:
          'No matching QuickBooks expense account — refresh QBO master, pick a category on the fuel tab, or ensure accounts exist for paths like Fuel Expenses:Fuel-Truck Diesel.'
      });
    }

    const qboClassId = String(body.qboClassId || '')
      .trim()
      .replace(/[^\d]/g, '');
    const qboItemId =
      String(body.qboItemId || '')
        .trim()
        .replace(/[^\d]/g, '') ||
      String(draft.itemId || '')
        .trim()
        .replace(/[^\d]/g, '') ||
      (detailMode === 'item' ? bestFuelItemId(erp) : '');
    if (detailMode === 'item' && !qboItemId) {
      return res.status(400).json({
        error: 'Choose a QuickBooks item for the fuel line (item + qty + price), or switch to category mode.'
      });
    }

    const qboCustomerId = String(body.qboCustomerId || '')
      .trim()
      .replace(/[^\d]/g, '');
    const driverVendorId = String(body.driverVendorQboId || '')
      .trim()
      .replace(/[^\d]/g, '');
    const driverMemo = String(body.driverMemo || '').trim().slice(0, 120);

    const unit = String(fp.unit || '').trim();
    const txnDate = sliceIsoDate(fp.txnDate || '') || new Date().toISOString().slice(0, 10);
    const gallons = fp.gallons != null ? Number(fp.gallons) : null;
    const product = String(fp.productType || 'diesel').trim();
    const loc = String(fp.location || '').trim();

    const memoParts = [
      unit ? `Unit ${unit}` : '',
      gallons != null && Number.isFinite(gallons) ? `${gallons} gal` : '',
      product ? product : '',
      loc ? loc : '',
      inferredFuelQbCategory(fp) ? `QB path: ${inferredFuelQbCategory(fp)}` : '',
      driverMemo ? `Driver: ${driverMemo}` : '',
      driverVendorId ? `Driver vendor QBO ${driverVendorId}` : ''
    ].filter(Boolean);
    const memo = memoParts.join(' · ');

    const bodyDoc = sanitizeQboDocNumber(String(body.docNumber || body.expenseDocNumber || '').trim());
    const docNumber =
      bodyDoc ||
      sanitizeQboDocNumber(
        String(draft.expenseDocNumber || fp.expenseDocNumber || '').trim()
      ) ||
      sanitizeQboDocNumber(buildFuelPurchaseDocNumber(fp));
    const lineDescription = buildFuelPurchaseLineDescription(fp);

    const paymentMethodIdRaw = String(body.paymentMethodId || draft.paymentMethodId || '')
      .trim()
      .replace(/[^\w.-]/g, '');
    const paymentMethodId = paymentMethodIdRaw || 'pm_other';

    const ap = {
      txnType: 'expense',
      detailMode,
      qboVendorId: vendorId,
      paymentMethodId,
      qboBankAccountId,
      qboAccountId,
      qboItemId,
      qty: detailMode === 'item' ? qty : 1,
      amount,
      txnDate,
      dueDate: '',
      docNumber,
      description: lineDescription,
      memo,
      assetUnit: unit,
      qboClassId,
      qboCustomerId: qboCustomerId || undefined
    };

    if (detailMode === 'item') {
      const unitPrice = qty > 0 ? amount / qty : amount;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ error: 'Invalid quantity or amount for item line' });
      }
      if (Math.abs(qty * unitPrice - amount) > 0.06) {
        return res.status(400).json({ error: 'Line total must equal quantity × unit price (within $0.06).' });
      }
    }

    const result = await qboCreateApTransaction(ap);
    const effectiveClassId = (qboClassId || qboClassIdForUnit(unit, erp) || '').trim() || null;
    erp.fuelPurchases[idx] = {
      ...fp,
      qboSyncStatus: 'posted',
      qboEntityType: result.qboEntityType,
      qboEntityId: result.qboEntityId,
      qboPostedAt: new Date().toISOString(),
      qboError: '',
      qboErrorAt: '',
      fuelPostedQty: detailMode === 'item' ? qty : null,
      fuelPostedAmount: amount,
      fuelPostedClassId: effectiveClassId,
      fuelPostedItemId: detailMode === 'item' ? qboItemId || null : null,
      fuelPostedAccountId: detailMode === 'category' ? qboAccountId || null : qboAccountId || null,
      fuelPostedDocNumber: docNumber || null,
      fuelPostedQbCategory: inferredFuelQbCategory(fp) || null,
      fuelPostedVendorId: vendorId,
      fuelPostedDriverVendorId: driverVendorId || null,
      fuelPostedDriverMemo: driverMemo || null,
      fuelPostedCustomerId: qboCustomerId || null
    };
    delete erp.fuelPurchases[idx].fuelExpenseDraft;
    delete erp.fuelPurchases[idx].fuelExpenseDraftUpdatedAt;
    writeErp(erp);
    logQboEvent('FUEL_PURCHASE_POST_OK', {
      erpFuelId: id,
      qboEntityType: result.qboEntityType,
      qboEntityId: result.qboEntityId,
      docNumber: docNumber || '',
      detailMode,
      amount
    });
    res.json({ ok: true, fuelPurchase: erp.fuelPurchases[idx] });
  } catch (error) {
    logError('api/qbo/post-fuel-purchase', error);
    const msg = enrichQboInvalidReferenceMessage(error.message || String(error));
    try {
      const erpErr = readErp();
      const ixe = (erpErr.fuelPurchases || []).findIndex(x => String(x.id) === id);
      if (ixe >= 0) {
        erpErr.fuelPurchases[ixe] = {
          ...erpErr.fuelPurchases[ixe],
          qboSyncStatus: 'error',
          qboError: msg,
          qboErrorAt: new Date().toISOString()
        };
        writeErp(erpErr);
      }
    } catch (_) {
      /* ignore secondary persist errors */
    }
    res.status(500).json({ error: msg });
  }
});

function qboEntityPathFromType(qboEntityType) {
  const t = String(qboEntityType || '').trim();
  if (t === 'Purchase') return 'purchase';
  if (t === 'Bill') return 'bill';
  return '';
}

/** Read Purchase or Bill by Id; returns null if missing or unsupported (does not throw on 404). */
async function qboFetchPurchaseOrBill(entityPath, entityId) {
  const id = String(entityId || '').trim();
  const path = String(entityPath || '').trim().toLowerCase();
  if (!id || (path !== 'purchase' && path !== 'bill')) return null;
  try {
    const data = await qboGet(`${path}/${encodeURIComponent(id)}`);
    return path === 'purchase' ? data?.Purchase || null : data?.Bill || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Deletes the Purchase/Bill in QuickBooks and clears local posting fields.
 * kind: 'ap' | 'wo' | 'record' | 'fuel'
 */
async function revertQboPostedTransaction(kind, erpId) {
  const id = String(erpId || '').trim();
  if (!id) throw new Error('id is required');
  const k = String(kind || '').trim().toLowerCase();
  if (!['ap', 'wo', 'record', 'fuel'].includes(k)) throw new Error('kind must be ap, wo, record, or fuel');

  let erp = readErp();
  let qboType = '';
  let qboId = '';

  if (k === 'ap') {
    const ap = (erp.apTransactions || []).find(x => String(x.id) === id);
    if (!ap) throw new Error('AP transaction not found');
    qboType = ap.qboEntityType;
    qboId = String(ap.qboEntityId || '').trim();
  } else if (k === 'wo') {
    const wo = (erp.workOrders || []).find(x => String(x.id) === id);
    if (!wo) throw new Error('Work order not found');
    qboType = wo.qboEntityType;
    qboId = String(wo.qboEntityId || '').trim();
  } else if (k === 'fuel') {
    const fp = (erp.fuelPurchases || []).find(x => String(x.id) === id);
    if (!fp) throw new Error('Fuel purchase not found');
    qboType = fp.qboEntityType;
    qboId = String(fp.qboEntityId || '').trim();
  } else {
    const rec = (erp.records || []).find(x => String(x.id) === id);
    if (!rec) throw new Error('Maintenance record not found');
    qboType = rec.qboEntityType;
    qboId = String(rec.qboPurchaseId || rec.qboEntityId || '').trim();
  }

  if (!qboId || !qboType) {
    throw new Error('Nothing posted to QuickBooks for this row');
  }
  const path = qboEntityPathFromType(qboType);
  if (!path) throw new Error(`Unsupported QuickBooks entity type: ${qboType}`);

  await qboDeletePurchaseOrBill(path, qboId);
  logQboEvent('REVERT_OK', { kind: k, erpId: id, qboEntityType: qboType, qboEntityId: qboId, qboPath: path });

  erp = readErp();
  const cleared = {
    qboSyncStatus: '',
    qboEntityType: '',
    qboEntityId: '',
    qboPostedAt: '',
    qboError: '',
    qboErrorAt: ''
  };
  if (k === 'ap') {
    const idx = (erp.apTransactions || []).findIndex(x => String(x.id) === id);
    if (idx === -1) throw new Error('AP transaction not found after QuickBooks delete');
    erp.apTransactions[idx] = { ...erp.apTransactions[idx], ...cleared };
  } else if (k === 'wo') {
    const idx = (erp.workOrders || []).findIndex(x => String(x.id) === id);
    if (idx === -1) throw new Error('Work order not found after QuickBooks delete');
    erp.workOrders[idx] = { ...erp.workOrders[idx], ...cleared };
  } else if (k === 'fuel') {
    const idx = (erp.fuelPurchases || []).findIndex(x => String(x.id) === id);
    if (idx === -1) throw new Error('Fuel purchase not found after QuickBooks delete');
    erp.fuelPurchases[idx] = {
      ...erp.fuelPurchases[idx],
      ...cleared,
      fuelPostedQty: null,
      fuelPostedAmount: null,
      fuelPostedClassId: null,
      fuelPostedItemId: null,
      fuelPostedAccountId: null,
      fuelPostedDocNumber: null,
      fuelPostedQbCategory: null,
      fuelPostedVendorId: null,
      fuelPostedDriverVendorId: null,
      fuelPostedDriverMemo: null,
      fuelPostedCustomerId: null
    };
  } else {
    const idx = (erp.records || []).findIndex(x => String(x.id) === id);
    if (idx === -1) throw new Error('Record not found after QuickBooks delete');
    erp.records[idx] = {
      ...erp.records[idx],
      ...cleared,
      qboPurchaseId: ''
    };
  }
  writeErp(erp);
}

app.post('/api/qbo/revert-posted', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    const id = String(req.body?.id || '').trim();
    if (!kind || !id) return res.status(400).json({ error: 'kind and id are required' });
    await revertQboPostedTransaction(kind, id);
    res.json({ ok: true, kind, id });
  } catch (error) {
    logError('api/qbo/revert-posted', error);
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

/**
 * Confirms a Purchase/Bill still exists in QuickBooks for a row this app marked posted.
 * body: { kind: 'fuel'|'ap'|'wo'|'record', id: erp row id }
 */
app.post('/api/qbo/verify-posted', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ error: 'QuickBooks is not connected' });
    }
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    const erpId = String(req.body?.id || '').trim();
    if (!kind || !erpId) return res.status(400).json({ error: 'kind and id are required' });
    if (!['fuel', 'ap', 'wo', 'record'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be fuel, ap, wo, or record' });
    }

    const erp = readErp();
    let qboType = '';
    let qboId = '';
    let rowSync = '';
    if (kind === 'ap') {
      const ap = (erp.apTransactions || []).find(x => String(x.id) === erpId);
      if (!ap) return res.status(404).json({ error: 'AP transaction not found' });
      rowSync = String(ap.qboSyncStatus || '');
      qboType = String(ap.qboEntityType || '').trim();
      qboId = String(ap.qboEntityId || '').trim();
    } else if (kind === 'wo') {
      const wo = (erp.workOrders || []).find(x => String(x.id) === erpId);
      if (!wo) return res.status(404).json({ error: 'Work order not found' });
      rowSync = String(wo.qboSyncStatus || '');
      qboType = String(wo.qboEntityType || '').trim();
      qboId = String(wo.qboEntityId || '').trim();
    } else if (kind === 'fuel') {
      const fp = (erp.fuelPurchases || []).find(x => String(x.id) === erpId);
      if (!fp) return res.status(404).json({ error: 'Fuel purchase not found' });
      rowSync = String(fp.qboSyncStatus || '');
      qboType = String(fp.qboEntityType || '').trim();
      qboId = String(fp.qboEntityId || '').trim();
    } else {
      const rec = (erp.records || []).find(x => String(x.id) === erpId);
      if (!rec) return res.status(404).json({ error: 'Maintenance record not found' });
      rowSync = String(rec.qboSyncStatus || '');
      qboType = String(rec.qboEntityType || '').trim();
      qboId = String(rec.qboPurchaseId || rec.qboEntityId || '').trim();
    }

    const erpMarkedPosted = rowSync.toLowerCase() === 'posted';

    if (!qboId || !qboType) {
      return res.json({
        ok: true,
        kind,
        erpId,
        erpMarkedPosted,
        existsInQuickBooks: null,
        message: 'This row has no QuickBooks entity id stored — not recorded via this app yet.'
      });
    }

    const path = qboEntityPathFromType(qboType);
    if (!path) {
      return res.json({
        ok: true,
        kind,
        erpId,
        erpMarkedPosted,
        existsInQuickBooks: null,
        qboEntityType: qboType,
        qboEntityId: qboId,
        message: `Stored entity type "${qboType}" is not verified here (only Purchase and Bill).`
      });
    }

    const entity = await qboFetchPurchaseOrBill(path, qboId);
    const exists = !!entity;
    logQboEvent('VERIFY_POSTED', { kind, erpId, qboEntityType: qboType, qboEntityId: qboId, exists });

    res.json({
      ok: true,
      kind,
      erpId,
      erpMarkedPosted,
      existsInQuickBooks: exists,
      qboEntityType: qboType,
      qboEntityId: qboId,
      qboTxnDate: entity?.TxnDate || '',
      qboDocNumber: entity?.DocNumber || '',
      message: exists
        ? `Found in QuickBooks: ${qboType} ${qboId}${entity?.DocNumber ? ` · Doc # ${entity.DocNumber}` : ''}.`
        : `Not found in QuickBooks for ${qboType} id ${qboId}. It may have been deleted in QBO while this app still shows posted — use Revert or refresh posting.`
    });
  } catch (error) {
    logError('api/qbo/verify-posted', error);
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

app.post('/api/qbo/revert-posted-batch', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'items array is required' });
    const results = [];
    for (const it of items.slice(0, 100)) {
      const kind = String(it?.kind || '').trim().toLowerCase();
      const id = String(it?.id || '').trim();
      if (!kind || !id) {
        results.push({ kind, id, ok: false, error: 'kind and id required' });
        continue;
      }
      try {
        await revertQboPostedTransaction(kind, id);
        results.push({ kind, id, ok: true });
      } catch (e) {
        results.push({
          kind,
          id,
          ok: false,
          error: enrichQboInvalidReferenceMessage(e.message || String(e))
        });
      }
    }
    res.json({ ok: true, results });
  } catch (error) {
    logError('api/qbo/revert-posted-batch', error);
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

/**
 * Delete a Bill Payment in QuickBooks AND mark the ERP log entry as reversed.
 * body: { erpLogId } OR { qboBillPaymentId }
 */
app.post('/api/qbo/revert-bill-payment', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const store = readQbo();
    if (!store.tokens?.access_token) {
      return res.status(400).json({ ok: false, error: 'QuickBooks is not connected' });
    }
    const erp = readErp();
    const erpLogId = String(req.body?.erpLogId || '').trim();
    const qboBillPaymentIdInput = String(req.body?.qboBillPaymentId || '').trim();

    let idx = -1;
    if (erpLogId) {
      idx = (erp.qboBillPaymentLog || []).findIndex(x => String(x?.id || '') === erpLogId);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'ERP bill payment log entry not found' });
    } else if (qboBillPaymentIdInput) {
      idx = (erp.qboBillPaymentLog || []).findIndex(x => String(x?.qboBillPaymentId || '') === qboBillPaymentIdInput);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'No ERP log entry for this QBO bill payment id' });
    } else {
      return res.status(400).json({ ok: false, error: 'erpLogId or qboBillPaymentId is required' });
    }

    const entry = (erp.qboBillPaymentLog || [])[idx];
    if (!entry?.qboBillPaymentId) return res.status(400).json({ ok: false, error: 'ERP log entry missing qboBillPaymentId' });
    if (entry.reversedAt) {
      return res.json({ ok: true, alreadyReversed: true, erpLogId: entry.id, qboBillPaymentId: entry.qboBillPaymentId });
    }

    const deleted = await qboDeleteBillPayment(entry.qboBillPaymentId);

    const by =
      req.authUser?.email ||
      req.authUser?.name ||
      (erpWriteAuthOk(req) ? 'erp_write_secret' : 'unknown');
    erp.qboBillPaymentLog[idx] = {
      ...entry,
      reversedAt: new Date().toISOString(),
      reversedBy: by,
      qboDeleteResult: {
        time: new Date().toISOString(),
        deletedId: deleted?.BillPayment?.Id || entry.qboBillPaymentId
      }
    };
    writeErp(erp);
    res.json({
      ok: true,
      erpLogId: erp.qboBillPaymentLog[idx].id,
      qboBillPaymentId: entry.qboBillPaymentId,
      reversedAt: erp.qboBillPaymentLog[idx].reversedAt
    });
  } catch (error) {
    logError('api/qbo/revert-bill-payment', error);
    res.status(500).json({ ok: false, error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

app.get('/api/erp/import-batches', (_req, res) => {
  try {
    const erp = readErp();
    res.json({
      ok: true,
      erpImportBatches: erp.erpImportBatches || [],
      fuelImportBatches: erp.fuelImportBatches || []
    });
  } catch (error) {
    logError('api/erp/import-batches', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Bill payments recorded in ERP (from this app). Query: from, to (YYYY-MM-DD on txnDate/createdAt),
 * vendorId (QBO vendor id), limit (1–500), format=json|csv
 */
app.get('/api/erp/bill-payment-log', (req, res) => {
  try {
    const erp = readErp();
    const log = erp.qboBillPaymentLog || [];
    const q = {
      from: req.query.from,
      to: req.query.to,
      vendorId: req.query.vendorId,
      limit: req.query.limit
    };
    const entries = filterBillPaymentLogEntries(log, q);
    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      const body = buildBillPaymentLogCsv(entries);
      const day = sliceIsoDate(new Date().toISOString()) || 'export';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bill-payment-log-${day}.csv"`);
      return res.send(body);
    }
    res.json({ ok: true, entries, count: entries.length, totalInErp: log.length });
  } catch (error) {
    logError('api/erp/bill-payment-log', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** QBO bills/purchases/bill payments + local ERP expense rows for bank matching. */
app.get('/api/banking/snapshot', async (req, res) => {
  try {
    const days = Math.min(366, Math.max(7, Number(req.query.days) || 60));
    const erp = readErp();
    let qbo = { bills: [], purchases: [], billPayments: [], vendorCredits: [] };
    try {
      qbo = await qboFetchBankingWindow(days);
    } catch (e) {
      logError('api/banking/snapshot qbo', e);
    }
    qbo.billPayments = attachErpBillPaymentMetaToQboBillPayments(qbo.billPayments, erp);
    res.json({
      ok: true,
      days,
      windowStart: qboTxnWindowStartIso(days),
      qbo,
      erpCandidates: buildErpExpenseCandidates(erp),
      bankImports: erp.bankStatementImports || [],
      matchLinks: erp.bankMatchLinks || []
    });
  } catch (error) {
    logError('api/banking/snapshot', error);
    res.status(500).json({ error: error.message });
  }
});

/** Paste bank CSV (Date, Amount, Description). Creates an import batch for matching. */
app.post('/api/banking/import-csv', (req, res) => {
  try {
    const text = String(req.body?.csvText || '');
    if (!text.trim()) return res.status(400).json({ error: 'csvText required' });
    const parsed = parseBankCsvText(text);
    if (!parsed.rows.length) {
      return res.status(400).json({ error: 'No rows parsed — include Date and Amount columns (header row optional).' });
    }
    const erp = readErp();
    const importBatchId = uid('bankcsv');
    const rows = parsed.rows.map((r, i) => ({
      id: uid('brow'),
      rowIndex: i,
      date: r.date,
      amount: r.amount,
      memo: r.memo || ''
    }));
    if (!Array.isArray(erp.bankStatementImports)) erp.bankStatementImports = [];
    erp.bankStatementImports.push({
      importBatchId,
      importedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows
    });
    erp.bankStatementImports = erp.bankStatementImports.slice(-30);
    writeErp(erp);
    res.json({ ok: true, importBatchId, rowCount: rows.length, preview: rows.slice(0, 20) });
  } catch (error) {
    logError('api/banking/import-csv', error);
    res.status(500).json({ error: error.message });
  }
});

/** Suggest QBO / ERP matches for each row in a bank CSV import. */
app.post('/api/banking/suggest', async (req, res) => {
  try {
    const importBatchId = String(req.body?.importBatchId || '').trim();
    const days = Math.min(366, Math.max(7, Number(req.body?.days) || 90));
    if (!importBatchId) return res.status(400).json({ error: 'importBatchId required' });
    const erp = readErp();
    const imp = (erp.bankStatementImports || []).find(x => x.importBatchId === importBatchId);
    if (!imp) return res.status(404).json({ error: 'Import batch not found' });
    let qbo = { bills: [], purchases: [], billPayments: [], vendorCredits: [] };
    try {
      qbo = await qboFetchBankingWindow(days);
    } catch (e) {
      logError('api/banking/suggest qbo', e);
    }
    qbo.billPayments = attachErpBillPaymentMetaToQboBillPayments(qbo.billPayments, erp);
    const erpCandidates = buildErpExpenseCandidates(erp);
    const suggestions = [];
    for (const row of imp.rows || []) {
      const bankRow = { date: row.date, amount: row.amount, memo: row.memo || '' };
      const sug = suggestForBankRow(
        bankRow,
        qbo.purchases,
        qbo.bills,
        qbo.billPayments,
        erpCandidates
      );
      suggestions.push({ bankRowId: row.id, date: row.date, amount: row.amount, memo: row.memo, suggestions: sug });
    }
    res.json({ ok: true, importBatchId, suggestions });
  } catch (error) {
    logError('api/banking/suggest', error);
    res.status(500).json({ error: error.message });
  }
});

/** Record a manual match between a bank CSV row and QBO / ERP (audit trail only — does not post to QBO). */
app.post('/api/banking/link', (req, res) => {
  try {
    const body = req.body || {};
    const bankRowId = String(body.bankRowId || '').trim();
    const importBatchId = String(body.importBatchId || '').trim();
    const matchType = String(body.matchType || '').trim();
    const ref = String(body.ref || '').trim();
    if (!bankRowId || !importBatchId || !matchType || !ref) {
      return res.status(400).json({ error: 'bankRowId, importBatchId, matchType, and ref are required' });
    }
    const erp = readErp();
    if (!Array.isArray(erp.bankMatchLinks)) erp.bankMatchLinks = [];
    erp.bankMatchLinks = erp.bankMatchLinks.filter(
      l => !(l.bankRowId === bankRowId && l.importBatchId === importBatchId)
    );
    erp.bankMatchLinks.push({
      id: uid('bml'),
      importBatchId,
      bankRowId,
      matchType,
      ref,
      qboEntityType: String(body.qboEntityType || '').trim(),
      qboEntityId: String(body.qboEntityId || '').trim(),
      createdAt: new Date().toISOString()
    });
    erp.bankMatchLinks = erp.bankMatchLinks.slice(-2000);
    writeErp(erp);
    res.json({ ok: true });
  } catch (error) {
    logError('api/banking/link', error);
    res.status(500).json({ error: error.message });
  }
});

/** Undo ERP-only rows from a maintenance or AP spreadsheet import (does not touch QuickBooks). */
app.post('/api/import/erp-batch/undo', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const batchId = String(req.body?.importBatchId || '').trim();
    const kind = String(req.body?.kind || '').trim().toLowerCase();
    if (!batchId || !kind) {
      return res.status(400).json({ error: 'importBatchId and kind are required' });
    }
    if (kind !== 'maintenance' && kind !== 'ap') {
      return res.status(400).json({ error: 'kind must be maintenance or ap' });
    }

    const erp = readErp();
    let removedWo = 0;
    let removedAp = 0;
    if (kind === 'maintenance') {
      const before = (erp.workOrders || []).length;
      erp.workOrders = (erp.workOrders || []).filter(w => String(w.importBatchId || '') !== batchId);
      removedWo = before - erp.workOrders.length;
    } else {
      const before = (erp.apTransactions || []).length;
      erp.apTransactions = (erp.apTransactions || []).filter(a => String(a.importBatchId || '') !== batchId);
      removedAp = before - erp.apTransactions.length;
    }

    for (const b of erp.erpImportBatches || []) {
      if (String(b.importBatchId || '') === batchId && !b.undoneAt) {
        b.undoneAt = new Date().toISOString();
        break;
      }
    }

    writeErp(erp);
    res.json({ ok: true, importBatchId: batchId, kind, removedWo, removedAp });
  } catch (error) {
    logError('api/import/erp-batch/undo', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/qbo/status', (_req, res) => {
  const store = readQbo();
  const syncMinRaw = Number(process.env.QBO_AUTO_SYNC_MINUTES ?? 360);
  const catalogAutoSyncMinutes = Math.max(5, Number.isFinite(syncMinRaw) ? syncMinRaw : 360);
  const uiPollRaw = Number(process.env.QBO_CATALOG_UI_POLL_MINUTES ?? 0);
  const catalogUiPollMinutes =
    Number.isFinite(uiPollRaw) && uiPollRaw > 0 ? Math.min(24 * 60, Math.floor(uiPollRaw)) : 0;
  let catalogLastSyncedAt = lastQboCatalogServerSyncAt;
  if (!catalogLastSyncedAt) {
    try {
      const erp = readErp();
      catalogLastSyncedAt = erp?.qboCache?.refreshedAt || null;
    } catch (_) {
      catalogLastSyncedAt = null;
    }
  }
  res.json({
    configured: qboConfigured(),
    connected: !!store.tokens?.access_token,
    realmId: store.tokens?.realmId || '',
    connectedAt: store.tokens?.connected_at || '',
    companyName: store.tokens?.companyName || '',
    catalogAutoSyncMinutes,
    catalogUiPollMinutes,
    catalogLastSyncedAt
  });
});

const QBO_SYNC_ALERT_LOOKBACK_DAYS = Math.min(366, Math.max(30, Number(process.env.QBO_SYNC_ALERT_LOOKBACK_DAYS) || 120));

function qboAlertRowWithinLookback(serviceDate, createdAt) {
  const raw = String(serviceDate || '').trim() || String(createdAt || '').trim();
  if (!raw) return true;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - QBO_SYNC_ALERT_LOOKBACK_DAYS);
  return d >= cutoff;
}

function qboAlertPostedRecord(rec) {
  const id = String(rec.qboPurchaseId || rec.qboEntityId || '').trim();
  return String(rec.qboSyncStatus || '').toLowerCase() === 'posted' && id && String(rec.qboEntityType || '').trim();
}

function qboAlertPostedAp(ap) {
  return (
    String(ap.qboSyncStatus || '').toLowerCase() === 'posted' &&
    String(ap.qboEntityId || '').trim() &&
    String(ap.qboEntityType || '').trim()
  );
}

function qboAlertPostedWo(wo) {
  return (
    String(wo.qboSyncStatus || '').toLowerCase() === 'posted' &&
    String(wo.qboEntityId || '').trim() &&
    String(wo.qboEntityType || '').trim()
  );
}

function qboAlertWorkOrderLineTotal(wo) {
  const lines = Array.isArray(wo.lines) ? wo.lines : [];
  let t = 0;
  for (const ln of lines) {
    const a = safeNum(ln.amount, 0) || 0;
    if (a > 0) t += a;
  }
  return Math.round(t * 100) / 100;
}

/**
 * Surfaces QuickBooks sync gaps: connection off, post errors, and (when QBO is connected) rows with money still not posted.
 */
app.get('/api/qbo/sync-alerts', (_req, res) => {
  try {
    const store = readQbo();
    const connected = !!store.tokens?.access_token;
    const configured = qboConfigured();
    const erp = readErp();
    const alerts = [];

    if (configured && !connected) {
      alerts.push({
        severity: 'high',
        code: 'qbo_not_connected',
        title: 'QuickBooks is not connected',
        detail:
          'Automatic posting to QuickBooks is paused until OAuth is completed. Use Connect QuickBooks from Settings or the top bar.',
        kind: 'system',
        id: ''
      });
    }

    for (const rec of erp.records || []) {
      const cost = safeNum(rec.cost, 0) || 0;
      if (!(cost > 0)) continue;
      if (!qboAlertRowWithinLookback(rec.serviceDate, rec.createdAt)) continue;
      const posted = qboAlertPostedRecord(rec);
      const st = String(rec.qboSyncStatus || '').toLowerCase();
      if (st === 'error') {
        alerts.push({
          severity: 'high',
          code: 'record_post_error',
          title: `Maintenance record (${rec.unit || 'unit'} · ${rec.serviceType || 'service'}) failed in QuickBooks`,
          detail: String(rec.qboError || 'Unknown error').slice(0, 420),
          kind: 'record',
          id: String(rec.id || '')
        });
        continue;
      }
      if (posted) continue;
      if (connected) {
        alerts.push({
          severity: 'medium',
          code: 'record_not_posted',
          title: `Maintenance (${rec.unit || ''}) — $${cost.toFixed(2)} not posted to QuickBooks`,
          detail: 'Open Accounting or post from the unit history card.',
          kind: 'record',
          id: String(rec.id || '')
        });
      }
    }

    for (const ap of erp.apTransactions || []) {
      const amt = safeNum(ap.amount, 0) || 0;
      if (!(amt > 0)) continue;
      if (!qboAlertRowWithinLookback(ap.txnDate, ap.createdAt)) continue;
      if (qboAlertPostedAp(ap)) continue;
      const st = String(ap.qboSyncStatus || '').toLowerCase();
      if (st === 'error') {
        alerts.push({
          severity: 'high',
          code: 'ap_post_error',
          title: `AP / expense row failed in QuickBooks (${ap.description || ap.docNumber || ap.id})`,
          detail: String(ap.qboError || 'Unknown error').slice(0, 420),
          kind: 'ap',
          id: String(ap.id || '')
        });
      } else if (connected) {
        alerts.push({
          severity: 'medium',
          code: 'ap_not_posted',
          title: `AP / expense — $${amt.toFixed(2)} not posted (${ap.description || ap.docNumber || 'no description'})`,
          detail: 'Post from Accounting → Maintenance expense transactions.',
          kind: 'ap',
          id: String(ap.id || '')
        });
      }
    }

    for (const wo of erpActiveWorkOrders(erp)) {
      const total = qboAlertWorkOrderLineTotal(wo);
      if (!(total > 0)) continue;
      if (!qboAlertRowWithinLookback(wo.serviceDate, wo.createdAt)) continue;
      if (qboAlertPostedWo(wo)) continue;
      const st = String(wo.qboSyncStatus || '').toLowerCase();
      if (st === 'error') {
        alerts.push({
          severity: 'high',
          code: 'wo_post_error',
          title: `Work order failed in QuickBooks (${wo.unit || ''} · load ${wo.loadNumber || '—'})`,
          detail: String(wo.qboError || 'Unknown error').slice(0, 420),
          kind: 'work_order',
          id: String(wo.id || '')
        });
      } else if (connected) {
        alerts.push({
          severity: 'medium',
          code: 'wo_not_posted',
          title: `Work order — $${total.toFixed(2)} not posted (${wo.unit || ''} · load ${wo.loadNumber || '—'})`,
          detail: 'Post the work order from Accounting.',
          kind: 'work_order',
          id: String(wo.id || '')
        });
      }
    }

    const sevRank = { high: 0, medium: 1, low: 2 };
    alerts.sort(
      (a, b) =>
        (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9) ||
        String(a.title || '').localeCompare(String(b.title || ''))
    );

    const high = alerts.filter(a => a.severity === 'high').length;
    const medium = alerts.filter(a => a.severity === 'medium').length;
    const low = alerts.filter(a => a.severity === 'low').length;

    res.json({
      ok: true,
      connected,
      configured,
      lookbackDays: QBO_SYNC_ALERT_LOOKBACK_DAYS,
      generatedAt: new Date().toISOString(),
      counts: { high, medium, low, total: alerts.length },
      alerts: alerts.slice(0, 150)
    });
  } catch (error) {
    logError('api/qbo/sync-alerts', error);
    res.status(500).json({
      ok: false,
      error: enrichQboInvalidReferenceMessage(error.message || String(error)),
      alerts: [],
      counts: {}
    });
  }
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
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    res.status(500).json({ ok: false, error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    res.status(500).json({ ok: false, error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
      error: enrichQboInvalidReferenceMessage(error.message || String(error)),
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
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

app.post('/api/qbo/create-customer', async (req, res) => {
  try {
    const result = await qboCreateCustomerFromApp(req.body || {});
    const cache = await qboSyncMasterData();
    res.json({ ok: true, created: result.created, customer: result.customer, cache });
  } catch (error) {
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

app.post('/api/qbo/create-item', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const result = await qboCreateItemFromApp(req.body || {});
    const cache = await qboSyncMasterData();
    res.json({ ok: true, created: result.created, item: result.item, cache });
  } catch (error) {
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
  }
});

app.post('/api/qbo/create-account', async (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const result = await qboCreateAccountFromApp(req.body || {});
    const cache = await qboSyncMasterData();
    res.json({ ok: true, created: result.created, account: result.account, cache });
  } catch (error) {
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    res.status(500).json({ error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    res.status(500).json({ ok: false, error: enrichQboInvalidReferenceMessage(error.message || String(error)) });
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
    const importBatchId = uid('erp_imp');
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
        workOrderNumber: allocNextWorkOrderNumber(erp),
        voided: false,
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
        importBatchId,
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

    if (imported > 0) {
      if (!Array.isArray(erp.erpImportBatches)) erp.erpImportBatches = [];
      erp.erpImportBatches.push({
        importBatchId,
        kind: 'maintenance',
        importConfirmedAt: new Date().toISOString(),
        imported,
        undoneAt: null
      });
      erp.erpImportBatches = erp.erpImportBatches.slice(-50);
    }

    writeErp(erp);
    res.json({ ok: true, imported, importBatchId: imported ? importBatchId : null });
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
    const importBatchId = uid('erp_imp');
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
        importBatchId,
        createdAt: new Date().toISOString()
      });
      imported += 1;
    }

    if (imported > 0) {
      if (!Array.isArray(erp.erpImportBatches)) erp.erpImportBatches = [];
      erp.erpImportBatches.push({
        importBatchId,
        kind: 'ap',
        importConfirmedAt: new Date().toISOString(),
        imported,
        undoneAt: null
      });
      erp.erpImportBatches = erp.erpImportBatches.slice(-50);
    }

    writeErp(erp);
    res.json({ ok: true, imported, importBatchId: imported ? importBatchId : null });
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

/** Parse fuel/Relay file — returns preview rows only (no ERP write). Use POST /api/import/fuel/confirm to save. */
app.post('/api/import/fuel', upload.single('file'), (req, res) => {
  try {
    if (!requireErpWrite(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

    const { fuelPurchases, relayExpenses, imported, relayLines } = buildRelayFuelImportFromRows(rows);
    const erp = readErp();
    const duplicates = findRelayPreviewDuplicates(relayExpenses, erp);
    const summary = {
      fuel: summarizeFuelPreview(fuelPurchases),
      relay: summarizeRelayPreview(relayExpenses)
    };
    res.json({
      ok: true,
      preview: true,
      imported,
      relayLines,
      fuelPurchases,
      relayExpenses,
      summary,
      duplicates,
      hint: 'Review the preview, then confirm to append to the ERP fuel ledger and Relay expense staging. Does not post to QuickBooks.'
    });
  } catch (error) {
    logError('api/import/fuel', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Append previewed fuel purchases and Relay expense lines to ERP.
 * Body: { fuelPurchases?: [...], relayExpenses?: [...], alreadyInQbo?: boolean }
 * Set alreadyInQbo when lines are for reconciliation / export test only (already in QuickBooks).
 */
app.post('/api/import/fuel/confirm', (req, res) => {
  try {
    if (!requireErpWrite(req, res)) return;
    const body = req.body || {};
    const fuelIn = Array.isArray(body.fuelPurchases) ? body.fuelPurchases : [];
    const relayIn = Array.isArray(body.relayExpenses) ? body.relayExpenses : [];
    if (!fuelIn.length && !relayIn.length) {
      return res.status(400).json({ error: 'Nothing to import — include fuelPurchases and/or relayExpenses from the preview.' });
    }
    if (fuelIn.length > 20000 || relayIn.length > 20000) {
      return res.status(400).json({ error: 'Too many rows in one confirm batch.' });
    }

    const alreadyInQbo = body.alreadyInQbo !== false;
    const importBatchId = uid('fuelimp');
    const importConfirmedAt = new Date().toISOString();
    const erp = readErp();
    if (!Array.isArray(erp.fuelPurchases)) erp.fuelPurchases = [];
    if (!Array.isArray(erp.relayExpenses)) erp.relayExpenses = [];

    let savedFuel = 0;
    let savedRelay = 0;

    for (const row of fuelIn) {
      const p = sanitizeFuelPurchase(row);
      if (!p) continue;
      const productType = String(row.productType || row.kind || 'diesel').trim() || 'diesel';
      erp.fuelPurchases.push({
        id: uid('imp_fuel'),
        ...p,
        productType,
        relayNote: String(row.relayNote || '').trim().slice(0, 200),
        relayExpenseNo: String(row.relayExpenseNo || '').trim().slice(0, 40),
        importBatchId,
        importConfirmedAt,
        createdAt: new Date().toISOString()
      });
      savedFuel++;
    }

    for (const row of relayIn) {
      const amount = safeNum(row.amount, null);
      if (amount == null || !Number.isFinite(amount) || amount <= 0) continue;
      const unitRel = sanitizeName(row.unit, '');
      if (!unitRel) continue;
      const gallons = row.gallons == null || row.gallons === '' ? null : safeNum(row.gallons, null);
      const pricePerGallon =
        row.pricePerGallon == null || row.pricePerGallon === '' ? null : safeNum(row.pricePerGallon, null);
      const odometerMiles =
        row.odometerMiles == null || row.odometerMiles === '' ? null : safeNum(row.odometerMiles, null);
      erp.relayExpenses.push({
        id: uid('rel'),
        docNumber: String(row.docNumber || '').trim().slice(0, 80),
        txnDate: sliceIsoDate(row.txnDate || ''),
        unit: unitRel,
        vendor: String(row.vendor || '').trim().slice(0, 120),
        expenseType: String(row.expenseType || '').trim().slice(0, 80),
        spreadsheetCategory: String(row.spreadsheetCategory || row.expenseType || '').trim().slice(0, 160),
        qbCategory: String(row.qbCategory || '').trim().slice(0, 140),
        amount,
        gallons: gallons != null && Number.isFinite(gallons) && gallons > 0 ? gallons : null,
        pricePerGallon: pricePerGallon != null && Number.isFinite(pricePerGallon) && pricePerGallon > 0 ? pricePerGallon : null,
        odometerMiles: odometerMiles != null && Number.isFinite(odometerMiles) && odometerMiles > 0 ? odometerMiles : null,
        location: String(row.location || '').trim().slice(0, 180),
        memo: String(row.memo || '').trim().slice(0, 500),
        alreadyInQbo,
        importBatchId,
        importConfirmedAt
      });
      savedRelay++;
    }

    erp.lastFuelImportBatch = {
      importBatchId,
      importConfirmedAt,
      savedFuel,
      savedRelay,
      alreadyInQbo
    };
    if (!Array.isArray(erp.fuelImportBatches)) erp.fuelImportBatches = [];
    erp.fuelImportBatches.push({
      importBatchId,
      importConfirmedAt,
      savedFuel,
      savedRelay,
      alreadyInQbo,
      undoneAt: null
    });
    erp.fuelImportBatches = erp.fuelImportBatches.slice(-20);
    writeErp(erp);
    res.json({ ok: true, savedFuel, savedRelay, alreadyInQbo, importBatchId, importConfirmedAt });
  } catch (error) {
    logError('api/import/fuel/confirm', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/import/fuel/last-batch', (_req, res) => {
  try {
    const erp = readErp();
    const b = erp.lastFuelImportBatch;
    if (!b || typeof b !== 'object' || !String(b.importBatchId || '').trim()) {
      return res.json({ ok: true, lastBatch: null });
    }
    res.json({
      ok: true,
      lastBatch: {
        importBatchId: String(b.importBatchId || '').trim(),
        importConfirmedAt: String(b.importConfirmedAt || '').trim(),
        savedFuel: safeNum(b.savedFuel, 0) || 0,
        savedRelay: safeNum(b.savedRelay, 0) || 0,
        alreadyInQbo: !!b.alreadyInQbo
      }
    });
  } catch (error) {
    logError('api/import/fuel/last-batch', error);
    res.status(500).json({ error: error.message });
  }
});

/** Undo a previously confirmed fuel import batch by importBatchId. */
app.post('/api/import/fuel/undo', (req, res) => {
  try {
    if (!requireErpWriteOrAdmin(req, res)) return;
    const body = req.body || {};
    const batchId = String(body.importBatchId || '').trim();
    if (!batchId) return res.status(400).json({ error: 'importBatchId is required' });

    const erp = readErp();
    const beforeFuel = (erp.fuelPurchases || []).length;
    const beforeRelay = (erp.relayExpenses || []).length;

    erp.fuelPurchases = (erp.fuelPurchases || []).filter(r => String(r.importBatchId || '') !== batchId);
    erp.relayExpenses = (erp.relayExpenses || []).filter(r => String(r.importBatchId || '') !== batchId);

    const removedFuel = beforeFuel - erp.fuelPurchases.length;
    const removedRelay = beforeRelay - erp.relayExpenses.length;

    if (String(erp.lastFuelImportBatch?.importBatchId || '') === batchId) {
      erp.lastFuelImportBatch = null;
    }

    for (const b of erp.fuelImportBatches || []) {
      if (String(b.importBatchId || '') === batchId && !b.undoneAt) {
        b.undoneAt = new Date().toISOString();
        break;
      }
    }

    writeErp(erp);
    res.json({ ok: true, importBatchId: batchId, removedFuel, removedRelay });
  } catch (error) {
    logError('api/import/fuel/undo', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/maintenance.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

app.get('/banking.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'banking.html'));
});

app.get('/settings.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
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

function bootstrapAdminFromEnv() {
  const email = String(process.env.IH35_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const pass = String(process.env.IH35_BOOTSTRAP_ADMIN_PASSWORD || '').trim();
  if (!email || !pass || pass.length < 8) return;
  const st = readUsersStore();
  if (st.users.length) return;
  st.users.push({
    id: uid('usr'),
    email,
    name: 'Administrator',
    role: 'admin',
    passwordHash: hashPassword(pass),
    createdAt: new Date().toISOString()
  });
  writeUsersStore(st);
  console.log('[auth] Bootstrap admin from IH35_BOOTSTRAP_ADMIN_* env:', email);
}

async function startServer() {
  await ensureTmsSchema();
  await ensureMaintenanceServiceCatalog();
  bootstrapAdminFromEnv();
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });

  const syncMin = Number(process.env.QBO_AUTO_SYNC_MINUTES ?? 360);
  const catalogAutoSyncMinutes = Math.max(5, Number.isFinite(syncMin) ? syncMin : 360);
  const QBO_SYNC_MS = catalogAutoSyncMinutes * 60 * 1000;
  console.log(
    `[qbo] catalog auto-sync: every ${catalogAutoSyncMinutes} min (set QBO_AUTO_SYNC_MINUTES; min 5)`
  );
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
