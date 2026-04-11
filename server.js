import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3400;
const TOKEN = process.env.SAMSARA_API_TOKEN || '';
const DATA_DIR = path.join(__dirname, 'data');
const MAINT_FILE = path.join(DATA_DIR, 'maintenance.json');

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function authHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
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
    throw new Error(`Non-JSON response from ${url}: ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    const msg = data?.message || data?.error || response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MAINT_FILE)) {
    fs.writeFileSync(
      MAINT_FILE,
      JSON.stringify(
        {
          currentMileage: {},
          records: [],
          unitOverrides: {}
        },
        null,
        2
      )
    );
  }
}

function readMaint() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(MAINT_FILE, 'utf8'));
}

function writeMaint(data) {
  ensureDataFile();
  fs.writeFileSync(MAINT_FILE, JSON.stringify(data, null, 2));
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseUnitNumber(name) {
  const m = String(name || '').match(/^T(\d+)$/i);
  return m ? Number(m[1]) : null;
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

  const states = [milesState, dateState];
  if (states.includes('past due')) return 'past due';
  if (states.includes('due soon')) return 'due soon';
  return 'current';
}

function buildDashboardRows(vehicles, maintStore) {
  const records = maintStore.records || [];
  const currentMileage = maintStore.currentMileage || {};
  const unitOverrides = maintStore.unitOverrides || {};

  return vehicles.map(v => {
    const unit = v.name;
    const rules = unitOverrides[unit]?.rules || defaultRulesForVehicle(v);
    const unitRecords = records.filter(r => r.unit === unit);

    const rows = rules.map(rule => {
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
        status: calcStatus(nextDueMiles, nextDueDate, currentMiles)
      };
    });

    return rows;
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: !!TOKEN,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/maintenance/vehicles', async (_req, res) => {
  try {
    const data = await fetchJson('https://api.samsara.com/fleet/vehicles', {
      headers: authHeaders()
    });

    const tracked = (data.data || [])
      .filter(isTrackedAsset)
      .reduce((acc, v) => {
        const key = String(v.name || '').trim().toUpperCase();
        if (!key) return acc;
        if (!acc.has(key)) acc.set(key, v);
        else {
          const existing = acc.get(key);
          const oldTs = String(existing.updatedAtTime || '');
          const newTs = String(v.updatedAtTime || '');
          if (newTs > oldTs) acc.set(key, v);
        }
        return acc;
      }, new Map());

    const result = Array.from(tracked.values()).sort((a, b) => {
      const ua = parseUnitNumber(a.name);
      const ub = parseUnitNumber(b.name);
      if (ua == null && ub == null) return String(a.name).localeCompare(String(b.name));
      if (ua == null) return 1;
      if (ub == null) return -1;
      return ua - ub;
    });

    res.json({ data: result });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/api/maintenance/dashboard', async (_req, res) => {
  try {
    const vehiclesRes = await fetchJson('https://api.samsara.com/fleet/vehicles', {
      headers: authHeaders()
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

    const maintStore = readMaint();
    const dashboard = buildDashboardRows(tracked, maintStore);
    const tireAlerts = buildTireAlerts(maintStore.records || []);

    res.json({
      vehicles: tracked,
      dashboard,
      tireAlerts
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/api/maintenance/records', (_req, res) => {
  const data = readMaint();
  res.json(data);
});

app.post('/api/maintenance/mileage', (req, res) => {
  const { unit, currentMileage } = req.body || {};
  if (!unit) return res.status(400).json({ error: 'unit is required' });

  const store = readMaint();
  if (!store.currentMileage) store.currentMileage = {};
  store.currentMileage[unit] = safeNum(currentMileage, null);
  writeMaint(store);

  res.json({ ok: true });
});

app.post('/api/maintenance/record', (req, res) => {
  const body = req.body || {};
  if (!body.unit || !body.serviceType) {
    return res.status(400).json({ error: 'unit and serviceType are required' });
  }

  const store = readMaint();
  if (!Array.isArray(store.records)) store.records = [];

  store.records.push({
    id: Date.now().toString(),
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

    repairLocationType: body.repairLocationType || ''
  });

  writeMaint(store);
  res.json({ ok: true });
});

app.post('/api/maintenance/rules', (req, res) => {
  const { unit, rules } = req.body || {};
  if (!unit || !Array.isArray(rules)) {
    return res.status(400).json({ error: 'unit and rules array are required' });
  }

  const store = readMaint();
  if (!store.unitOverrides) store.unitOverrides = {};
  store.unitOverrides[unit] = { rules };
  writeMaint(store);

  res.json({ ok: true });
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
