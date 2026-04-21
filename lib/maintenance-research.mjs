/**
 * Maintenance intelligence: OEM schedules + parts benchmarks (Postgres),
 * cross-referenced with ERP work orders (read-only).
 */

import { getFleetAvgMilesPerMonth, formatFleetPaceDueLabel } from './fleet-mileage-settings.mjs';

const STOP = new Set(['and', 'or', 'the', 'for', 'per', 'all', 'with', 'from', 'when', 'each', 'system']);

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenizeOemServiceType(label) {
  return norm(label)
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 2 && !STOP.has(t));
}

export function woLineMatchesOemService(lineSvc, oemLabel) {
  const tokens = tokenizeOemServiceType(oemLabel);
  if (!tokens.length) return false;
  const l = norm(lineSvc);
  if (!l) return false;
  const hits = tokens.filter(t => l.includes(t));
  const need = Math.max(1, Math.ceil(tokens.length * 0.45));
  return hits.length >= need;
}

export function parseYmmFromDescription(description) {
  const d = String(description || '').trim();
  const m = d.match(/\b(19|20)\d{2}\b/);
  const year = m ? Number(m[0]) : null;
  const makes = [
    'Freightliner',
    'Mack',
    'Peterbilt',
    'Kenworth',
    'Volvo',
    'International',
    'Western Star',
    'Sterling'
  ];
  let make = '';
  for (const mk of makes) {
    if (new RegExp(`\\b${mk}\\b`, 'i').test(d)) {
      make = mk;
      break;
    }
  }
  let model = '';
  const models = ['Cascadia', 'Anthem', '579', '567', 'VNL', 'VNR', 'T680', 'W900', '389', 'LT'];
  for (const mo of models) {
    if (new RegExp(`\\b${mo}\\b`, 'i').test(d)) {
      model = mo;
      break;
    }
  }
  return { year, make, model };
}

export function resolveVehicleProfile(truck, samsaraByUnit) {
  const code = String(truck.unit_code || '').trim();
  const sam = samsaraByUnit[code] || samsaraByUnit[code.toUpperCase()] || null;
  let year = truck.vehicle_year != null ? Number(truck.vehicle_year) : null;
  let make = String(truck.vehicle_make || '').trim();
  let model = String(truck.vehicle_model || '').trim();
  const vin = String(truck.vin || sam?.vin || '').trim();
  const engineSerial = String(truck.engine_serial || sam?.engineSerialNumber || '').trim();
  if ((!year || !make || !model) && sam) {
    if (!year && sam.year != null) year = Number(sam.year);
    if (!make && sam.make) make = String(sam.make).trim();
    if (!model && sam.model) model = String(sam.model).trim();
  }
  if (!year || !make || !model) {
    const parsed = parseYmmFromDescription(truck.description || '');
    if (!year && parsed.year) year = parsed.year;
    if (!make && parsed.make) make = parsed.make;
    if (!model && parsed.model) model = parsed.model;
  }
  const odometer =
    sam?.odometerMiles != null && Number.isFinite(Number(sam.odometerMiles))
      ? Math.round(Number(sam.odometerMiles))
      : null;
  return {
    unit_code: code,
    truck_id: truck.id,
    year: year && Number.isFinite(year) ? year : null,
    make: make || 'Unknown',
    model: model || 'Unknown',
    vin,
    engine_serial: engineSerial,
    description: truck.description || '',
    fleet_added_at: truck.created_at,
    current_odometer: odometer
  };
}

function flattenWoLines(erp) {
  const out = [];
  for (const w of erp.workOrders || []) {
    if (w.voided) continue;
    const unit = String(w.unit || '').trim();
    const baseDate = String(w.serviceDate || '').slice(0, 10);
    const lines = Array.isArray(w.lines) ? w.lines : [];
    if (!lines.length) {
      out.push({
        unit,
        serviceDate: baseDate,
        serviceType: String(w.serviceType || '').trim(),
        serviceMileage:
          w.serviceMileage != null && String(w.serviceMileage).trim() !== ''
            ? Number(w.serviceMileage)
            : null,
        amount: 0,
        workOrderId: w.id
      });
      continue;
    }
    for (const line of lines) {
      const sm =
        line.serviceMileage != null && String(line.serviceMileage).trim() !== ''
          ? Number(line.serviceMileage)
          : w.serviceMileage != null && String(w.serviceMileage).trim() !== ''
            ? Number(w.serviceMileage)
            : null;
      out.push({
        unit,
        serviceDate: baseDate,
        serviceType: String(line.serviceType || '').trim(),
        serviceMileage: Number.isFinite(sm) ? sm : null,
        amount: Number(line.amount) || 0,
        workOrderId: w.id
      });
    }
  }
  return out;
}

function flattenRecordsAsPseudoLines(erp) {
  const out = [];
  for (const r of erp.records || []) {
    const unit = String(r.unit || '').trim();
    if (!unit) continue;
    const st = String(r.serviceType || '').trim();
    if (!st) continue;
    const sm =
      r.serviceMileage != null && String(r.serviceMileage).trim() !== '' ? Number(r.serviceMileage) : null;
    out.push({
      unit,
      serviceDate: String(r.serviceDate || '').slice(0, 10),
      serviceType: st,
      serviceMileage: Number.isFinite(sm) ? sm : null,
      amount: Number(r.cost) || 0,
      workOrderId: r.id
    });
  }
  return out;
}

function findLastServiceForOemType(allLines, unit, oemServiceType) {
  const u = String(unit || '').trim();
  const hits = allLines.filter(
    x => x.unit === u && x.serviceType && woLineMatchesOemService(x.serviceType, oemServiceType)
  );
  hits.sort((a, b) => {
    const da = String(a.serviceDate || '');
    const db = String(b.serviceDate || '');
    if (da !== db) return db.localeCompare(da);
    return (b.serviceMileage || 0) - (a.serviceMileage || 0);
  });
  return hits[0] || null;
}

function woTotalCost(w) {
  let t = 0;
  for (const line of w.lines || []) t += Number(line.amount) || 0;
  return t;
}

export function addCalendarMonths(isoYmd, nMonths) {
  const n = Number(nMonths);
  if (!Number.isFinite(n) || n === 0) return isoYmd ? String(isoYmd).slice(0, 10) : null;
  const base = String(isoYmd || '').slice(0, 10);
  const d = new Date(`${base || '1970-01-01'}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function daysFromToday(isoYmd) {
  const t = String(isoYmd || '').slice(0, 10);
  if (!t) return null;
  const end = new Date(`${t}T12:00:00Z`).getTime();
  const start = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime();
  return Math.floor((end - start) / 864e5);
}

function urgencyRank(status) {
  if (status === 'OVERDUE') return 0;
  if (status === 'DUE SOON') return 1;
  if (status === 'UPCOMING') return 2;
  if (status === 'CURRENT') return 3;
  return 9;
}

function classifyStatus(milesRemaining, daysRemaining) {
  const m = milesRemaining != null && Number.isFinite(milesRemaining) ? milesRemaining : null;
  const d = daysRemaining != null && Number.isFinite(daysRemaining) ? daysRemaining : null;
  const overdueM = m != null && m < 0;
  const overdueD = d != null && d < 0;
  if (overdueM || overdueD) return 'OVERDUE';
  const soonM = m != null && m < 2000;
  const soonD = d != null && d < 30;
  if (soonM || soonD) return 'DUE SOON';
  const upM = m != null && m < 5000;
  const upD = d != null && d < 60;
  if (upM || upD) return 'UPCOMING';
  return 'CURRENT';
}

async function loadSchedulesFromDb(dbQuery, make, model, year) {
  const mk = String(make || '').trim();
  const mo = String(model || '').trim();
  const y = Number(year);
  const yr = Number.isFinite(y) && y > 1980 ? y : 2020;
  const { rows } = await dbQuery(
    `SELECT id, make, model, year_from, year_to, engine_family, service_type, interval_miles, interval_months,
            interval_engine_hours, notes, source
     FROM research_oem_vehicle_schedules
     WHERE year_from <= $1 AND year_to >= $1
       AND (
         (lower(make) = lower($2) AND lower(model) = lower($3))
         OR (make = 'ALL' AND model = 'ALL')
       )
     ORDER BY CASE WHEN make = 'ALL' THEN 2 ELSE 1 END, service_type`,
    [yr, mk, mo]
  );
  const bySt = new Map();
  for (const r of rows || []) {
    const prev = bySt.get(r.service_type);
    if (!prev || (String(prev.make).toUpperCase() === 'ALL' && String(r.make).toUpperCase() !== 'ALL')) {
      bySt.set(r.service_type, r);
    }
  }
  return [...bySt.values()];
}

async function loadPartsBenchmarks(dbQuery, make, model) {
  const mk = String(make || 'ALL').trim() || 'ALL';
  const mo = String(model || 'ALL').trim() || 'ALL';
  const { rows } = await dbQuery(
    `SELECT id, make, model, year_from, year_to, part_category, part_name, avg_replacement_miles, avg_replacement_months,
            avg_cost_low, avg_cost_high, avg_cost_mid, notes, last_updated
     FROM research_vehicle_parts_benchmark
     WHERE (make = 'ALL' AND model = 'ALL')
        OR (lower(make) = lower($1) AND (model = 'ALL' OR lower(model) = lower($2)))
     ORDER BY CASE WHEN make = 'ALL' THEN 2 ELSE 1 END, part_category, part_name`,
    [mk, mo]
  );
  const { rows: custom } = await dbQuery(
    `SELECT id, make, model, part_name, avg_life_miles, avg_life_months, cost_low, cost_high, notes, created_at
     FROM research_company_custom_parts
     WHERE lower(COALESCE(make,'')) = lower($1) OR COALESCE(make,'') = '' OR make = 'ALL'
     ORDER BY created_at DESC
     LIMIT 500`,
    [mk]
  );
  const customMapped = (custom || []).map(c => ({
    id: c.id,
    make: c.make,
    model: c.model,
    year_from: 2000,
    year_to: 2035,
    part_category: 'Custom',
    part_name: c.part_name,
    avg_replacement_miles: c.avg_life_miles,
    avg_replacement_months: c.avg_life_months,
    avg_cost_low: c.cost_low,
    avg_cost_high: c.cost_high,
    avg_cost_mid:
      c.cost_low != null && c.cost_high != null
        ? (Number(c.cost_low) + Number(c.cost_high)) / 2
        : null,
    notes: c.notes ? `${c.notes} (Custom — IH 35 data)` : 'Custom — IH 35 data',
    last_updated: String(c.created_at || '').slice(0, 10),
    is_custom: true
  }));
  return [...(rows || []), ...customMapped];
}

function estimateCostRangeForService(serviceType, partsRows) {
  const tokens = tokenizeOemServiceType(serviceType);
  let best = null;
  let bestScore = 0;
  for (const p of partsRows || []) {
    const pn = norm(p.part_name);
    let sc = 0;
    for (const t of tokens) {
      if (pn.includes(t)) sc++;
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  if (best && best.avg_cost_low != null && best.avg_cost_high != null) {
    return {
      low: Number(best.avg_cost_low),
      high: Number(best.avg_cost_high),
      part_hint: best.part_name
    };
  }
  if (/oil|filter change/i.test(serviceType)) return { low: 150, high: 450, part_hint: 'PM / fluids' };
  if (/brake.*adjust/i.test(serviceType)) return { low: 80, high: 250, part_hint: 'Brake labor' };
  if (/tire|rotation/i.test(serviceType)) return { low: 40, high: 200, part_hint: 'Tire service' };
  if (/dpf|aftertreatment/i.test(serviceType)) return { low: 300, high: 1200, part_hint: 'Aftertreatment' };
  return { low: 50, high: 400, part_hint: 'General PM' };
}

export async function loadFleetTrucks(dbQuery) {
  const { rows } = await dbQuery(
    `SELECT id, unit_code, description, created_at, vehicle_year, vehicle_make, vehicle_model, vin, engine_serial
     FROM trucks
     ORDER BY unit_code`
  );
  return rows || [];
}

function groupFleetByMakeModelYear(trucksResolved) {
  const groups = new Map();
  for (const t of trucksResolved) {
    const mk = String(t.make || 'Unknown');
    const mo = String(t.model || 'Unknown');
    const y = t.year || 0;
    const bucket = Math.floor(y / 3) * 3;
    const key = `${mk}|${mo}|${bucket}`;
    if (!groups.has(key)) groups.set(key, { make: mk, model: mo, year_bucket: bucket, units: [] });
    groups.get(key).units.push(t.unit_code);
  }
  return [...groups.values()];
}

function buildSamsaraByUnit(enrichedVehicles) {
  const m = {};
  for (const v of enrichedVehicles || []) {
    const n = String(v.name || '').trim();
    if (n) m[n] = v;
  }
  return m;
}

export async function getSchedulesForVehicle(dbQuery, profile) {
  const schedules = await loadSchedulesFromDb(dbQuery, profile.make, profile.model, profile.year);
  return { ok: true, vehicle: profile, schedules };
}

export async function getPartsForVehicle(dbQuery, profile) {
  const parts = await loadPartsBenchmarks(dbQuery, profile.make, profile.model);
  return { ok: true, vehicle: profile, parts };
}

export function buildDueRowsForProfile({
  profile,
  schedules,
  woLines,
  erpCurrentMileage,
  partsRows,
  fleetAvgMilesPerMonth
}) {
  const unit = profile.unit_code;
  const cur =
    profile.current_odometer != null && Number.isFinite(profile.current_odometer)
      ? profile.current_odometer
      : erpCurrentMileage[unit] != null && String(erpCurrentMileage[unit]).trim() !== ''
        ? Math.round(Number(erpCurrentMileage[unit]))
        : null;
  const mergedLines = woLines;

  const out = [];
  const inception = String(profile.fleet_added_at || '').slice(0, 10) || '2015-01-01';

  for (const sch of schedules) {
    const stLabel = String(sch.service_type || '');
    const last = findLastServiceForOemType(mergedLines, unit, stLabel);
    const lastMiles =
      last?.serviceMileage != null && Number.isFinite(last.serviceMileage) ? Math.round(last.serviceMileage) : 0;
    const lastDate = last?.serviceDate ? String(last.serviceDate).slice(0, 10) : inception;
    const ivm = sch.interval_miles != null ? Number(sch.interval_miles) : null;
    const ivmo = sch.interval_months != null ? Number(sch.interval_months) : null;
    let nextDueMiles = null;
    if (ivm != null && Number.isFinite(ivm) && ivm > 0) {
      nextDueMiles = lastMiles + ivm;
    }
    let nextDueDate = null;
    if (ivmo != null && Number.isFinite(ivmo) && ivmo > 0) {
      nextDueDate = addCalendarMonths(lastDate, ivmo);
    }
    let milesRemaining = null;
    if (nextDueMiles != null && cur != null && Number.isFinite(cur)) milesRemaining = nextDueMiles - cur;
    let daysRemaining = null;
    if (nextDueDate) daysRemaining = daysFromToday(nextDueDate);
    const status = classifyStatus(milesRemaining, daysRemaining);
    const est = estimateCostRangeForService(stLabel, partsRows);
    const fa = Number(fleetAvgMilesPerMonth);
    const fleet_pace_eta =
      milesRemaining != null && Number.isFinite(fa) && fa > 0
        ? formatFleetPaceDueLabel(milesRemaining, fa)
        : null;
    out.push({
      service_type: stLabel,
      schedule_id: sch.id,
      last_service_date: last?.serviceDate || null,
      last_service_miles: last?.serviceMileage != null ? Math.round(last.serviceMileage) : null,
      next_due_miles: nextDueMiles,
      next_due_date: nextDueDate,
      current_miles: cur,
      miles_remaining: milesRemaining,
      days_remaining: daysRemaining,
      fleet_pace_eta,
      status,
      interval_miles: ivm,
      interval_months: ivmo,
      estimated_cost_low: est.low,
      estimated_cost_high: est.high,
      notes: sch.notes || '',
      source: sch.source || ''
    });
  }
  out.sort((a, b) => {
    const ra = urgencyRank(a.status);
    const rb = urgencyRank(b.status);
    if (ra !== rb) return ra - rb;
    const ma = a.miles_remaining != null ? a.miles_remaining : 1e12;
    const mb = b.miles_remaining != null ? b.miles_remaining : 1e12;
    return ma - mb;
  });
  return out;
}

// Fix: buildDueRowsForProfile should merge WO lines + records - caller passes erp
export function buildDueRowsForProfileFixed(profile, schedules, erp, partsRows, fleetAvgMilesPerMonth) {
  const woLines = flattenWoLines(erp);
  const recLines = flattenRecordsAsPseudoLines(erp);
  const merged = [...woLines, ...recLines];
  const erpCurrentMileage = erp.currentMileage && typeof erp.currentMileage === 'object' ? erp.currentMileage : {};
  return buildDueRowsForProfile({
    profile,
    schedules,
    woLines: merged,
    erpCurrentMileage,
    partsRows,
    fleetAvgMilesPerMonth
  });
}

export async function getVehicleDueList(dbQuery, erp, enrichedVehicles, unitId) {
  const uid = String(unitId || '').trim();
  if (!uid) return { ok: false, error: 'unitId is required' };
  const trucks = await loadFleetTrucks(dbQuery);
  const sam = buildSamsaraByUnit(enrichedVehicles);
  let truck = trucks.find(t => String(t.unit_code).toLowerCase() === uid.toLowerCase());
  if (!truck) {
    truck = {
      id: null,
      unit_code: uid,
      description: '',
      created_at: null,
      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      vin: null,
      engine_serial: null
    };
  }
  const profile = resolveVehicleProfile(truck, sam);
  const schedules = await loadSchedulesFromDb(dbQuery, profile.make, profile.model, profile.year);
  const partsRows = await loadPartsBenchmarks(dbQuery, profile.make, profile.model);
  const fleetAvg = dbQuery ? await getFleetAvgMilesPerMonth(dbQuery) : 12000;
  const items = buildDueRowsForProfileFixed(profile, schedules, erp, partsRows, fleetAvg);
  return { ok: true, unit: uid, vehicle: profile, items };
}

export async function getFleetDueSchedule(dbQuery, erp, enrichedVehicles, filters = {}) {
  const trucks = await loadFleetTrucks(dbQuery);
  const sam = buildSamsaraByUnit(enrichedVehicles);
  const fleetAvg = dbQuery ? await getFleetAvgMilesPerMonth(dbQuery) : 12000;
  const statusF = String(filters.status || 'all').toUpperCase().replace(/\s+/g, ' ');
  const makeF = String(filters.make || '').trim().toLowerCase();
  const svcF = String(filters.service_type || '').trim().toLowerCase();
  const unitF = String(filters.unit || '').trim().toLowerCase();
  const rows = [];
  for (const truck of trucks) {
    const profile = resolveVehicleProfile(truck, sam);
    if (makeF && String(profile.make || '').toLowerCase() !== makeF) continue;
    if (unitF && String(profile.unit_code).toLowerCase() !== unitF) continue;
    const schedules = await loadSchedulesFromDb(dbQuery, profile.make, profile.model, profile.year);
    const partsRows = await loadPartsBenchmarks(dbQuery, profile.make, profile.model);
    const items = buildDueRowsForProfileFixed(profile, schedules, erp, partsRows, fleetAvg);
    for (const it of items) {
      if (!['OVERDUE', 'DUE SOON', 'UPCOMING'].includes(it.status)) continue;
      if (statusF !== 'ALL' && String(it.status).toUpperCase() !== statusF) continue;
      if (svcF && !String(it.service_type || '').toLowerCase().includes(svcF)) continue;
      rows.push({
        unit: profile.unit_code,
        make: profile.make,
        model: profile.model,
        year: profile.year,
        ...it
      });
    }
  }
  rows.sort((a, b) => {
    const ra = urgencyRank(a.status);
    const rb = urgencyRank(b.status);
    if (ra !== rb) return ra - rb;
    const ma = a.miles_remaining != null ? a.miles_remaining : 1e12;
    const mb = b.miles_remaining != null ? b.miles_remaining : 1e12;
    if (ma !== mb) return ma - mb;
    return String(a.unit).localeCompare(String(b.unit));
  });
  return { ok: true, rows };
}

export async function getFleetProfileSummary(dbQuery, enrichedVehicles) {
  const trucks = await loadFleetTrucks(dbQuery);
  const sam = buildSamsaraByUnit(enrichedVehicles);
  const resolved = trucks.map(t => resolveVehicleProfile(t, sam));
  const groups = groupFleetByMakeModelYear(resolved);
  const byMake = {};
  for (const r of resolved) {
    const k = r.make || 'Unknown';
    if (!byMake[k]) byMake[k] = [];
    byMake[k].push(r.unit_code);
  }
  return {
    ok: true,
    truck_count: trucks.length,
    vehicles: resolved,
    groups,
    by_make: byMake,
    internal_summary_lines: groups.map(
      g => `${g.units.length}x ${g.make} ${g.model} (≈${g.year_bucket}–${g.year_bucket + 2})`
    )
  };
}

function monthlyBucketsForMake(erp, make, brandUnitSet, months = 12) {
  const end = new Date();
  const keys = [];
  const labels = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
    labels.push(d.toLocaleString('en-US', { month: 'short', year: 'numeric' }));
  }
  const costs = keys.map(() => 0);
  const units = brandUnitSet || new Set();
  for (const w of erp.workOrders || []) {
    if (w.voided) continue;
    const u = String(w.unit || '').trim();
    if (!units.has(u)) continue;
    const dm = String(w.serviceDate || '').slice(0, 7);
    if (!dm) continue;
    const idx = keys.indexOf(dm);
    if (idx < 0) continue;
    costs[idx] += woTotalCost(w);
  }
  return { labels, costs };
}

export async function getBrandAverages(dbQuery, erp, enrichedVehicles) {
  const trucks = await loadFleetTrucks(dbQuery);
  const sam = buildSamsaraByUnit(enrichedVehicles);
  const resolved = trucks.map(t => resolveVehicleProfile(t, sam));
  const unitToMake = {};
  const brandUnits = {};
  for (const r of resolved) {
    const mk = r.make || 'Unknown';
    unitToMake[r.unit_code] = mk;
    if (!brandUnits[mk]) brandUnits[mk] = new Set();
    brandUnits[mk].add(r.unit_code);
  }
  const windowDays = 365;
  const cutoff = new Date(Date.now() - windowDays * 864e5).toISOString().slice(0, 10);
  const byMake = {};
  for (const mk of Object.keys(brandUnits)) {
    byMake[mk] = {
      unit_count: brandUnits[mk].size,
      wos: [],
      serviceTypes: {},
      lineSpend: [],
      milesBetween: []
    };
  }
  const woSorted = [...(erp.workOrders || [])].filter(w => !w.voided && String(w.serviceDate || '') >= cutoff);
  woSorted.sort((a, b) => String(a.serviceDate).localeCompare(String(b.serviceDate)));
  const lastWoMilesByUnit = {};
  for (const w of woSorted) {
    const u = String(w.unit || '').trim();
    const mk = unitToMake[u];
    if (!mk || !byMake[mk]) continue;
    const cost = woTotalCost(w);
    byMake[mk].wos.push(w);
    for (const line of w.lines || []) {
      const st = String(line.serviceType || '').trim();
      if (!st) continue;
      byMake[mk].serviceTypes[st] = (byMake[mk].serviceTypes[st] || 0) + 1;
    }
    const sm =
      w.lines?.[0]?.serviceMileage != null
        ? Number(w.lines[0].serviceMileage)
        : w.serviceMileage != null
          ? Number(w.serviceMileage)
          : null;
    if (sm != null && Number.isFinite(sm) && lastWoMilesByUnit[u] != null) {
      const d = sm - lastWoMilesByUnit[u];
      if (d > 0 && d < 500000) byMake[mk].milesBetween.push(d);
    }
    if (sm != null && Number.isFinite(sm)) lastWoMilesByUnit[u] = sm;
  }

  const industryMaintPerMi = 0.16;
  const industryTireMi = 125000;
  const industryBrakeMi = 100000;

  const cards = [];
  for (const mk of Object.keys(brandUnits)) {
    const g = byMake[mk];
    const totalSpend = g.wos.reduce((s, w) => s + woTotalCost(w), 0);
    const n = Math.max(1, g.unit_count);
    const months = windowDays / 30.437;
    const avgMonthlyPerUnit = totalSpend / n / months;
    const avgCostPerWo = g.wos.length ? totalSpend / g.wos.length : 0;
    const avgMilesBetween =
      g.milesBetween.length > 0
        ? g.milesBetween.reduce((a, b) => a + b, 0) / g.milesBetween.length
        : null;
    let mostCommon = '';
    let mostCommonN = 0;
    for (const [k, v] of Object.entries(g.serviceTypes)) {
      if (v > mostCommonN) {
        mostCommonN = v;
        mostCommon = k;
      }
    }
    let mostExpensive = { type: '', cost: 0 };
    for (const w of g.wos) {
      const c = woTotalCost(w);
      if (c > mostExpensive.cost) {
        mostExpensive = { type: String(w.lines?.[0]?.serviceType || 'Work order'), cost: c };
      }
    }
    let odomSum = 0;
    for (const u of brandUnits[mk]) {
      const v = sam[u];
      if (v?.odometerMiles != null && Number.isFinite(Number(v.odometerMiles))) odomSum += Number(v.odometerMiles);
    }
    const costPerMile = odomSum > 0 ? totalSpend / odomSum : null;
    const vs =
      costPerMile != null && industryMaintPerMi > 0
        ? Math.round(((costPerMile - industryMaintPerMi) / industryMaintPerMi) * 100)
        : null;
    const { labels, costs } = monthlyBucketsForMake(erp, mk, brandUnits[mk], 12);
    cards.push({
      make: mk,
      unit_count: g.unit_count,
      actual: {
        avg_cost_per_wo: Math.round(avgCostPerWo * 100) / 100,
        avg_monthly_cost: Math.round(avgMonthlyPerUnit * 100) / 100,
        avg_miles_between_services: avgMilesBetween != null ? Math.round(avgMilesBetween) : null,
        most_common_service: mostCommon || null,
        most_expensive_service: mostExpensive.type ? `${mostExpensive.type} ($${mostExpensive.cost.toFixed(0)})` : null,
        total_spend: Math.round(totalSpend * 100) / 100,
        cost_per_mile: costPerMile != null ? Math.round(costPerMile * 10000) / 10000 : null,
        odometer_snapshot_sum: odomSum || null
      },
      reference: {
        recommended_pm_interval_miles: 25000,
        avg_tire_life_miles_industry: industryTireMi,
        avg_brake_life_miles_industry: industryBrakeMi,
        avg_annual_maintenance_cost_per_unit_industry: industryMaintPerMi * 120000
      },
      comparison: {
        vs_industry: vs == null ? null : `${vs >= 0 ? '+' : ''}${vs}%`,
        vs_industry_pct: vs,
        status:
          vs == null ? 'unknown' : vs > 20 ? 'above_average' : vs < -20 ? 'below_average' : 'near_average',
        industry_maintenance_cost_per_mile_mid: industryMaintPerMi
      },
      chart: {
        labels,
        costs,
        industry_avg_monthly: labels.map(() =>
          Math.round(industryMaintPerMi * 12000 * n * 100) / 100
        )
      }
    });
  }
  cards.sort((a, b) => String(a.make).localeCompare(String(b.make)));
  return { ok: true, window_days: windowDays, cards };
}

function fuelCostAndMiles(erp, days = 90) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let fuelCost = 0;
  const odoByUnit = {};
  for (const p of erp.fuelPurchases || []) {
    const d = String(p.txnDate || '').slice(0, 10);
    if (!d || d < cutoff) continue;
    fuelCost += Number(p.totalCost) || 0;
    const u = String(p.unit || '').trim();
    const o = p.odometerMiles != null ? Number(p.odometerMiles) : null;
    if (!u || !Number.isFinite(o)) continue;
    if (!odoByUnit[u]) odoByUnit[u] = [];
    odoByUnit[u].push({ d, o });
  }
  let milesProxy = 0;
  for (const u of Object.keys(odoByUnit)) {
    const arr = odoByUnit[u].sort((a, b) => a.d.localeCompare(b.d));
    if (arr.length >= 2) {
      milesProxy += Math.max(0, arr[arr.length - 1].o - arr[0].o);
    }
  }
  return { fuelCost, milesProxy };
}

function tireSpendApprox(erp, days = 365) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let t = 0;
  for (const r of erp.records || []) {
    if (String(r.serviceDate || '').slice(0, 10) < cutoff) continue;
    if (/tire|tyre/i.test(String(r.serviceType || '')) || String(r.recordType || '').toLowerCase() === 'tire') {
      t += Number(r.cost) || 0;
    }
  }
  for (const w of erp.workOrders || []) {
    if (w.voided || String(w.serviceDate || '').slice(0, 10) < cutoff) continue;
    for (const line of w.lines || []) {
      if (/tire|tyre/i.test(String(line.serviceType || ''))) t += Number(line.amount) || 0;
    }
  }
  return t;
}

export async function getCostBenchmarks(dbQuery, erp, enrichedVehicles) {
  const { fuelCost, milesProxy } = fuelCostAndMiles(erp, 90);
  const trucks = await loadFleetTrucks(dbQuery);
  const sam = buildSamsaraByUnit(enrichedVehicles);
  let odomFleet = 0;
  for (const t of trucks) {
    const p = resolveVehicleProfile(t, sam);
    if (p.current_odometer != null) odomFleet += p.current_odometer;
  }
  const cutoff365 = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const maintSpend365 = (erp.workOrders || [])
    .filter(w => !w.voided && String(w.serviceDate || '').slice(0, 10) >= cutoff365)
    .reduce((s, w) => s + woTotalCost(w), 0);
  const tireSpend = tireSpendApprox(erp, 365);
  const maintPerMi = odomFleet > 0 ? maintSpend365 / odomFleet : null;
  const tirePerMi = odomFleet > 0 ? tireSpend / odomFleet : null;
  const fuelPerMi = milesProxy > 0 ? fuelCost / milesProxy : null;
  const fleetSize = trucks.length || 1;
  return {
    ok: true,
    industry: {
      maintenance_per_mile_low: 0.14,
      maintenance_per_mile_high: 0.18,
      tires_per_mile_low: 0.04,
      tires_per_mile_high: 0.06,
      fuel_per_mile_low: 0.35,
      fuel_per_mile_high: 0.5,
      total_ownership_low: 1.5,
      total_ownership_high: 1.8
    },
    fleet: {
      maintenance_cost_per_mile: maintPerMi != null ? Math.round(maintPerMi * 10000) / 10000 : null,
      tire_cost_per_mile: tirePerMi != null ? Math.round(tirePerMi * 10000) / 10000 : null,
      fuel_cost_per_mile: fuelPerMi != null ? Math.round(fuelPerMi * 10000) / 10000 : null,
      odometer_snapshot_sum: odomFleet,
      fuel_window_days: 90,
      fuel_miles_proxy: milesProxy,
      fuel_spend_window: Math.round(fuelCost * 100) / 100
    },
    annual_projection: {
      projected_maintenance_spend: Math.round((maintSpend365 / Math.max(1, fleetSize)) * fleetSize * 100) / 100,
      note: 'Annual maintenance projection scales recent WO totals; refine with accounting exports.'
    }
  };
}

export async function getCostForecast12m(dbQuery, erp, enrichedVehicles, unitId) {
  const due = await getVehicleDueList(dbQuery, erp, enrichedVehicles, unitId);
  if (!due.ok) return due;
  const fleetAvg = dbQuery ? await getFleetAvgMilesPerMonth(dbQuery) : 12000;
  const cur = due.vehicle?.current_odometer;
  const base = Number.isFinite(cur) ? cur : 0;
  const buckets = [];
  for (let m = 1; m <= 12; m++) {
    const projected = base + m * fleetAvg;
    buckets.push({ month: m, projected_odometer: Math.round(projected), estimated_cost: 0, services: [] });
  }
  for (const row of due.items || []) {
    const iv = Number(row.interval_miles);
    if (!Number.isFinite(iv) || iv <= 0) continue;
    const last = Number(row.last_service_miles) || 0;
    let k = Math.ceil((base - last) / iv);
    if (!Number.isFinite(k)) k = 0;
    for (let m = 1; m <= 12; m++) {
      const proj = base + m * fleetAvg;
      const hitsNow = Math.floor(proj / iv);
      const prev = base + (m - 1) * fleetAvg;
      const hitsPrev = Math.floor(prev / iv);
      if (hitsNow > hitsPrev) {
        const est = ((row.estimated_cost_low || 0) + (row.estimated_cost_high || 0)) / 2;
        buckets[m - 1].estimated_cost += est;
        buckets[m - 1].services.push(row.service_type);
      }
    }
  }
  const total = buckets.reduce((s, b) => s + b.estimated_cost, 0);
  return {
    ok: true,
    unit: unitId,
    fleet_avg_miles_per_month: fleetAvg,
    current_odometer: cur ?? null,
    months: buckets,
    total_estimated_12m: Math.round(total * 100) / 100
  };
}

export async function insertCustomPart(dbQuery, body) {
  const make = String(body?.make || 'ALL').trim() || 'ALL';
  const model = String(body?.model || 'ALL').trim() || 'ALL';
  const part_name = String(body?.part_name || '').trim();
  if (!part_name) return { ok: false, error: 'part_name is required' };
  const avg_life_miles = body?.avg_life_miles != null ? Number(body.avg_life_miles) : null;
  const cost_low = body?.cost_low != null ? Number(body.cost_low) : null;
  const cost_high = body?.cost_high != null ? Number(body.cost_high) : null;
  const notes = String(body?.notes || '').trim().slice(0, 2000);
  const { rows } = await dbQuery(
    `INSERT INTO research_company_custom_parts (make, model, part_name, avg_life_miles, cost_low, cost_high, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [make, model, part_name, avg_life_miles, cost_low, cost_high, notes]
  );
  return { ok: true, row: rows[0] };
}

export async function evaluatePredictiveMaintenanceAlerts(dbQuery, erp, enrichedVehicles) {
  const fleet = await getFleetDueSchedule(dbQuery, erp, enrichedVehicles, {});
  if (!fleet.ok) return [];
  const fleetAvg = dbQuery ? await getFleetAvgMilesPerMonth(dbQuery) : 12000;
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const r of fleet.rows || []) {
    const u = String(r.unit || '');
    const svc = String(r.service_type || '');
    const slug = `${u}:${svc}`.replace(/\s+/g, '_').slice(0, 120);
    const mr = r.miles_remaining;
    const pace =
      mr != null && Number.isFinite(Number(mr))
        ? formatFleetPaceDueLabel(Number(mr), fleetAvg)
        : null;
    if (r.status === 'OVERDUE') {
      const mo = r.miles_remaining != null ? Math.abs(Math.round(r.miles_remaining)) : null;
      const dy = r.days_remaining != null ? Math.abs(Math.round(r.days_remaining)) : null;
      const overduePace = pace ? ` (${pace} at fleet pace).` : '';
      alerts.push({
        type: 'MAINTENANCE_OVERDUE',
        severity: 'RED',
        unitId: u,
        message: `Unit ${u} is overdue for ${svc}${mo != null ? ` by ${mo} mi` : ''}${dy != null ? ` / ${dy} d` : ''}${overduePace} Manufacturer baseline: every ${r.interval_miles || '—'} mi / ${r.interval_months || '—'} mo.`,
        dedupeKey: `MAINTENANCE_OVERDUE:${slug}`,
        details: {
          service_type: svc,
          next_due_miles: r.next_due_miles,
          next_due_date: r.next_due_date,
          current_miles: r.current_miles,
          interval_miles: r.interval_miles,
          interval_months: r.interval_months,
          schedule_source: r.source,
          fleet_pace_eta: r.fleet_pace_eta,
          evaluated_date: today
        }
      });
    } else if (r.status === 'DUE SOON') {
      const remain = pace ? ` (${pace} remaining at fleet pace)` : '';
      alerts.push({
        type: 'MAINTENANCE_DUE_SOON',
        severity: 'AMBER',
        unitId: u,
        message: `Unit ${u} is due soon for ${svc}: ${r.miles_remaining != null ? Math.round(r.miles_remaining) + ' mi' : '—'} / ${r.days_remaining != null ? Math.round(r.days_remaining) + ' d' : '—'}${remain}.`,
        dedupeKey: `MAINTENANCE_DUE_SOON:${slug}`,
        details: {
          service_type: svc,
          miles_remaining: r.miles_remaining,
          days_remaining: r.days_remaining,
          fleet_pace_eta: r.fleet_pace_eta,
          next_due_miles: r.next_due_miles,
          next_due_date: r.next_due_date,
          evaluated_date: today
        }
      });
    }
  }
  return alerts;
}
