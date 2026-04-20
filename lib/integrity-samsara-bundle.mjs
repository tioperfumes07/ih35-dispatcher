/**
 * Build integrity API payloads: vehicle bundle, fleet overview, scoring helpers.
 */

import { runSamsaraCrossrefChecks, repairCost90dForFleet } from './integrity-samsara-crossref.mjs';
import { compareIntegrityAlertsDesc } from './integrity-engine.mjs';
import {
  fetchVehicleStatsHistory,
  fetchVehicleTripsWindow,
  fetchSafetyEventsWindow,
  fetchVehicleStatsSupplement,
  parseStatsHistorySeries,
  sumTripMiles,
  sumUnassignedTripMiles,
  summarizeSafetyEvents,
  metersToMiles,
  hasSamsaraReadToken
} from './samsara-integrity-fetch.mjs';

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

function activeAlertsForUnit(erp, unit) {
  const u = String(unit || '').trim();
  return (erp.integrityAlerts || []).filter(
    a => String(a.status || 'active') === 'active' && String(a.unitId || '').trim() === u
  );
}

export function computeIntegrityScoreFromAlerts(activeList, opts = {}) {
  let score = 100;
  const o = opts || {};
  let red = 0;
  let amber = 0;
  let missing = 0;
  for (const a of activeList || []) {
    const t = String(a.alertType || a.type || '');
    const sev = String(a.severity || '').toUpperCase();
    if (sev === 'RED') {
      red++;
      score -= 15;
    } else {
      amber++;
      score -= 5;
    }
    if (/MR1|MR2/.test(t)) missing++;
    if (t === 'OD2' && sev === 'RED') score -= 20;
    if (t === 'MR3' && sev === 'RED') score -= 25;
  }
  score -= missing * 10;
  if (o.overduePm) score -= 20;
  if (o.overdueInspection) score -= 25;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  let band = 'GOOD';
  if (score < 60) band = 'ATTENTION';
  else if (score < 80) band = 'REVIEW';
  return { score: Math.round(score), band, red, amber, active: activeList.length };
}

export function getFuelCostPerMileForUnit(erp, unit, days, milesOverride) {
  const u = String(unit || '').trim();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cs = cutoff.toISOString().slice(0, 10);
  let gal = 0;
  let cost = 0;
  for (const p of erp.fuelPurchases || []) {
    if (String(p.unit || '').trim() !== u) continue;
    const d = sliceD(p.txnDate || '');
    if (!d || d < cs) continue;
    gal += Number(p.gallons) || 0;
    cost += Number(p.totalCost) || 0;
  }
  if (gal <= 0) return 0;
  const miles =
    Number(milesOverride) > 10 ? Number(milesOverride) : Math.max(gal * 6.5, 1);
  return cost / miles;
}

function fleetAvgFuelCostPerMile(erp, units, days, milesByUnit) {
  const arr = [];
  const mMap = milesByUnit || {};
  for (const u of units || []) {
    const x = getFuelCostPerMileForUnit(erp, u, days, mMap[u]);
    if (x > 0) arr.push(x);
  }
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function rolling7dMilesWithoutFuel(erp, tripByDay, unit) {
  const u = String(unit || '').trim();
  const days = Object.keys(tripByDay || {})
    .sort()
    .slice(-14);
  let maxGap = 0;
  for (let i = 0; i <= days.length - 7; i++) {
    const window = days.slice(i, i + 7);
    let miles = 0;
    for (const d of window) miles += Number(tripByDay[d] || 0);
    const start = window[0];
    const end = window[6];
    const gal = fuelGallonsBetween(erp, u, start, end);
    if (miles > 500 && gal < 1) maxGap = Math.max(maxGap, miles);
  }
  return maxGap;
}

function fuelGallonsBetween(erp, unit, fromD, toD) {
  const u = String(unit || '').trim();
  let g = 0;
  for (const p of erp.fuelPurchases || []) {
    if (String(p.unit || '').trim() !== u) continue;
    const d = sliceD(p.txnDate || '');
    if (!d || d < fromD || d > toD) continue;
    g += Number(p.gallons) || 0;
  }
  return g;
}

function tripMilesByDay(trips) {
  const by = {};
  for (const t of trips || []) {
    const st = String(t.startTime || t.startMs || '').slice(0, 10);
    if (!st) continue;
    const dm = Number(t.distanceMeters || 0);
    if (!Number.isFinite(dm)) continue;
    by[st] = (by[st] || 0) + (metersToMiles(dm) || 0);
  }
  return by;
}

function sumTripByDayRange(byDay, days) {
  const keys = Object.keys(byDay || {}).sort();
  let s = 0;
  for (const k of keys.slice(-days)) s += Number(byDay[k] || 0);
  return s;
}

async function buildCacheUnitDeep(erp, unitName, vehicleId) {
  const now = Date.now();
  const endIso = new Date().toISOString();
  const start90 = new Date(now - 90 * 86400000).toISOString();
  const start30 = new Date(now - 30 * 86400000).toISOString();
  const start7 = new Date(now - 7 * 86400000).toISOString();

  let odoHist = { dates: [], values: [] };
  let engHist = { dates: [], values: [] };
  let idleHist = { dates: [], values: [] };
  try {
    const pOdo = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'obdOdometerMeters');
    odoHist = parseStatsHistorySeries(pOdo, ['obdOdometerMeters', 'gpsOdometerMeters']);
  } catch {
    /* optional */
  }
  try {
    const pE = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'engineSeconds');
    engHist = parseStatsHistorySeries(pE, ['engineSeconds']);
  } catch {
    /* optional */
  }
  try {
    const pI = await fetchVehicleStatsHistory(vehicleId, start30, endIso, 'idleEngineSeconds');
    idleHist = parseStatsHistorySeries(pI, ['idleEngineSeconds']);
  } catch {
    try {
      const pI2 = await fetchVehicleStatsHistory(vehicleId, start30, endIso, 'idlingDurationMilliseconds');
      idleHist = parseStatsHistorySeries(pI2, ['idlingDurationMilliseconds']);
    } catch {
      /* optional */
    }
  }

  let trips30 = [];
  let trips7 = [];
  try {
    trips30 = await fetchVehicleTripsWindow(vehicleId, start30, endIso);
    trips7 = await fetchVehicleTripsWindow(vehicleId, start7, endIso);
  } catch {
    trips30 = [];
    trips7 = [];
  }

  const tripByDay = tripMilesByDay(trips30);
  const tripMiles30d = sumTripMiles(trips30);
  const tripMiles7d = sumTripMiles(trips7);
  const unassignedTripMiles30d = sumUnassignedTripMiles(trips30);

  const engFirst = engHist.values.length ? Number(engHist.values[0]) : null;
  const engLast = engHist.values.length ? Number(engHist.values[engHist.values.length - 1]) : null;
  const engineHoursDelta30d =
    engFirst != null && engLast != null ? Math.max(0, (engLast - engFirst) / 3600) : 0;

  let idleHours30d = 0;
  if (idleHist.values.length) {
    const first = Number(idleHist.values[0]) || 0;
    const last = Number(idleHist.values[idleHist.values.length - 1]) || 0;
    const raw = last - first;
    idleHours30d = raw > 1e6 ? raw / 3600000 : raw / 3600;
    if (!Number.isFinite(idleHours30d) || idleHours30d < 0) idleHours30d = 0;
  }

  const idlePercent30d =
    engineHoursDelta30d > 0.1 ? Math.min(100, (idleHours30d / engineHoursDelta30d) * 100) : 0;

  const sup = await fetchVehicleStatsSupplement(vehicleId);

  const safetyEvents = await fetchSafetyEventsWindow({
    startDate: start30.slice(0, 10),
    endDate: endIso.slice(0, 10),
    vehicleId
  });
  const locSafety = summarizeSafetyEvents(safetyEvents, unitName);
  let topDriver = '';
  let maxEv = 0;
  for (const [dn, o] of Object.entries(locSafety.byDriver || {})) {
    const t = o.harshBrake + o.harshAccel + o.speeding + o.distracted + o.collisionRisk;
    if (t > maxEv) {
      maxEv = t;
      topDriver = dn;
    }
  }
  locSafety.topDriver = topDriver;

  const maxRolling7dMilesWithoutFuel = rolling7dMilesWithoutFuel(erp, tripByDay, unitName);

  return {
    samsaraVehicleId: String(vehicleId),
    tripMiles30d,
    tripMiles7d,
    unassignedTripMiles30d,
    engineHoursDelta30d,
    idleHours30d,
    idlePercent30d,
    engineHoursTotal: sup.engineSeconds != null ? sup.engineSeconds / 3600 : null,
    faultCodes: sup.faultCodes || [],
    odometerHistory90d: odoHist.dates.map((d, i) => ({ date: d, meters: odoHist.values[i] })),
    engineHistory90d: engHist.dates.map((d, i) => ({ date: d, engineSeconds: engHist.values[i] })),
    idleByDay30d: idleHist.dates.map((d, i) => ({ date: d, value: idleHist.values[i] })),
    tripMilesByDay: tripByDay,
    safetyLocal: locSafety,
    maxRolling7dMilesWithoutFuel
  };
}

export async function mergeDeepIntoFleetCache(erp, enrichedVehicles, opts = {}) {
  if (!hasSamsaraReadToken()) return erp;
  if (!erp.integritySamsaraCache || typeof erp.integritySamsaraCache !== 'object') {
    erp.integritySamsaraCache = { refreshedAt: '', deepRefreshedAt: '', units: {} };
  }
  if (!erp.integritySamsaraFaultSnapshots || typeof erp.integritySamsaraFaultSnapshots !== 'object') {
    erp.integritySamsaraFaultSnapshots = {};
  }
  const units = erp.integritySamsaraCache.units || {};
  const maxUnits = Number(opts.maxUnitsPerRun) > 0 ? Number(opts.maxUnitsPerRun) : 8;
  const day = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const v of enrichedVehicles || []) {
    if (n >= maxUnits) break;
    const name = String(v.name || '').trim();
    const vid = String(v.id || v.vehicleId || v.ids?.samsaraId || '').trim();
    if (!name || !vid) continue;
    const prev = units[name] || {};
    try {
      const deep = await buildCacheUnitDeep(erp, name, vid);
      const faults = deep.faultCodes || [];
      const codes = faults.map(f => String(f.code || '').trim()).filter(Boolean);
      const snapArr = [...(erp.integritySamsaraFaultSnapshots[name] || []), { date: day, codes }].filter(
        row => row && sliceD(row.date) >= sliceD(new Date(Date.now() - 90 * 86400000).toISOString())
      );
      erp.integritySamsaraFaultSnapshots[name] = snapArr.slice(-120);
      const fcMap = {};
      for (const row of erp.integritySamsaraFaultSnapshots[name] || []) {
        for (const c of row.codes || []) {
          if (!c) continue;
          fcMap[c] = (fcMap[c] || 0) + 1;
        }
      }
      units[name] = {
        ...prev,
        ...deep,
        faultCodeCounts90d: fcMap,
        odometerMiles: v.odometerMiles ?? prev.odometerMiles ?? null,
        latitude: v.latitude ?? prev.latitude ?? null,
        longitude: v.longitude ?? prev.longitude ?? null,
        fuelPercent: v.fuelPercent ?? prev.fuelPercent ?? null,
        liveStatsUpdatedAt: v.liveStatsUpdatedAt || prev.liveStatsUpdatedAt || '',
        driverName: prev.driverName || ''
      };
      n++;
    } catch {
      /* one vehicle */
    }
  }
  erp.integritySamsaraCache.units = units;
  erp.integritySamsaraCache.deepRefreshedAt = new Date().toISOString();
  return erp;
}

export function lightRefreshFleetCache(erp, enrichedVehicles) {
  if (!erp.integritySamsaraCache || typeof erp.integritySamsaraCache !== 'object') {
    erp.integritySamsaraCache = { refreshedAt: '', deepRefreshedAt: '', units: {} };
  }
  const units = { ...(erp.integritySamsaraCache.units || {}) };
  for (const v of enrichedVehicles || []) {
    const name = String(v.name || '').trim();
    if (!name) continue;
    const prev = units[name] || {};
    units[name] = {
      ...prev,
      samsaraVehicleId: String(v.id || v.vehicleId || v.ids?.samsaraId || ''),
      odometerMiles: v.odometerMiles ?? prev.odometerMiles ?? null,
      latitude: v.latitude ?? prev.latitude ?? null,
      longitude: v.longitude ?? prev.longitude ?? null,
      fuelPercent: v.fuelPercent ?? prev.fuelPercent ?? null,
      liveStatsUpdatedAt: v.liveStatsUpdatedAt || prev.liveStatsUpdatedAt || '',
      engineState: v.engineState || prev.engineState || ''
    };
  }
  erp.integritySamsaraCache.units = units;
  erp.integritySamsaraCache.refreshedAt = new Date().toISOString();
  return erp;
}

export async function fetchOrgSafetyEvents30d() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return fetchSafetyEventsWindow({ startDate: start, endDate: end, vehicleId: '' });
}

export function aggregateSafetyByUnit(events) {
  const map = {};
  for (const ev of events || []) {
    const u = String(ev?.vehicle?.name || '').trim();
    if (!u) continue;
    if (!map[u]) map[u] = { total: 0, harshBrake: 0, harshAccel: 0, speeding: 0, distracted: 0, collisionRisk: 0 };
    const s = summarizeSafetyEvents([ev], u);
    map[u].harshBrake += s.harshBrake;
    map[u].harshAccel += s.harshAccel;
    map[u].speeding += s.speeding;
    map[u].distracted += s.distracted;
    map[u].collisionRisk += s.collisionRisk;
    map[u].total += s.harshBrake + s.harshAccel + s.speeding + s.distracted + s.collisionRisk;
  }
  const sums = { harshBrake: 0, harshAccel: 0, speeding: 0, distracted: 0, collisionRisk: 0 };
  let nu = 0;
  for (const o of Object.values(map)) {
    nu++;
    sums.harshBrake += o.harshBrake;
    sums.harshAccel += o.harshAccel;
    sums.speeding += o.speeding;
    sums.distracted += o.distracted;
    sums.collisionRisk += o.collisionRisk;
  }
  const avg = {
    harshBrake: nu ? sums.harshBrake / nu : 0,
    harshAccel: nu ? sums.harshAccel / nu : 0,
    speeding: nu ? sums.speeding / nu : 0,
    distracted: nu ? sums.distracted / nu : 0,
    collisionRisk: nu ? sums.collisionRisk / nu : 0
  };
  return { byUnit: map, avg };
}

export async function buildVehicleIntegrityBundle({
  erp,
  unitId,
  enrichedVehicles,
  tmsDriverByUnit,
  orgSafetyEvents,
  fleetAvgMilesPerMonth
}) {
  const u = String(unitId || '').trim();
  const vrow = (enrichedVehicles || []).find(x => String(x.name || '').trim() === u);
  if (!vrow) {
    return { ok: false, error: 'Unit not in active fleet snapshot' };
  }
  const vid = String(vrow.id || vrow.vehicleId || vrow.ids?.samsaraId || '').trim();
  let cacheUnit = (erp.integritySamsaraCache?.units || {})[u] || {};
  if (hasSamsaraReadToken() && vid) {
    try {
      cacheUnit = { ...cacheUnit, ...(await buildCacheUnitDeep(erp, u, vid)) };
    } catch {
      /* use cache */
    }
  }
  cacheUnit.odometerMiles = vrow.odometerMiles ?? cacheUnit.odometerMiles ?? null;

  const unitList = (enrichedVehicles || []).map(x => String(x.name || '').trim()).filter(Boolean);
  const milesByUnit = {};
  for (const un of unitList) {
    const cu = (erp.integritySamsaraCache?.units || {})[un] || {};
    if (Number(cu.tripMiles30d) > 10) milesByUnit[un] = cu.tripMiles30d;
  }
  const fleetAvgFuel = fleetAvgFuelCostPerMile(erp, unitList, 30, milesByUnit);
  const unitFuel = getFuelCostPerMileForUnit(erp, u, 30, cacheUnit.tripMiles30d);
  const evs = orgSafetyEvents || (await fetchOrgSafetyEvents30d());
  const { avg, byUnit } = aggregateSafetyByUnit(evs);
  const repairCostByUnit = repairCost90dForFleet(erp);
  const safetyTotalsByUnit = byUnit;

  const alerts = runSamsaraCrossrefChecks({
    unit: u,
    erp,
    cacheUnit,
    fleetSafetyAgg: { avg },
    repairCostByUnit,
    safetyTotalsByUnit,
    tmsDriverName: tmsDriverByUnit?.[u] || '',
    samsaraDriverName: cacheUnit.driverName,
    fleetAvgFuelCostPerMile: fleetAvgFuel,
    unitFuelCostPerMile30d: unitFuel,
    localSafety: cacheUnit.safetyLocal || {},
    fleetAvgMilesPerMonth: fleetAvgMilesPerMonth ?? undefined
  });

  const active = activeAlertsForUnit(erp, u);
  const overduePm = alerts.some(x => x.type === 'OD2' && x.severity === 'RED');
  const overdueInsp = alerts.some(x => x.type === 'MR3' && x.severity === 'RED');
  const score = computeIntegrityScoreFromAlerts(active, { overduePm, overdueInspection: overdueInsp });

  const maintMonthly = maintCostMonthly(erp, u, 12);

  return {
    ok: true,
    unit: u,
    integrityScore: score,
    samsara: cacheUnit,
    erp: {
      assetStatus: (erp.assetStatusByUnit || {})[u] || null,
      vin: vrow.vin || '',
      make: vrow.make || '',
      model: vrow.model || '',
      year: vrow.year || ''
    },
    alertsSuggested: alerts,
    panels: {
      odometerHistory90d: cacheUnit.odometerHistory90d || [],
      maintMonthly,
      faultCodes: cacheUnit.faultCodes || [],
      safetyBars: cacheUnit.safetyLocal || {},
      idleByDay: cacheUnit.idleByDay30d || [],
      alertHistory: (erp.integrityAlerts || [])
        .filter(a => String(a.unitId || '') === u)
        .sort(compareIntegrityAlertsDesc)
        .slice(0, 80)
    }
  };
}

function maintCostMonthly(erp, unit, monthsBack) {
  const u = String(unit || '').trim();
  const byMonth = {};
  for (const w of erp.workOrders || []) {
    if (w.voided) continue;
    if (String(w.unit || '').trim() !== u) continue;
    const m = String(w.serviceDate || '').slice(0, 7);
    if (!m || m.length < 7) continue;
    byMonth[m] = (byMonth[m] || 0) + woTotalSafe(w);
  }
  const keys = Object.keys(byMonth).sort().slice(-monthsBack);
  return keys.map(k => ({ month: k, cost: byMonth[k] }));
}

function woTotalSafe(w) {
  return (w.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

export function buildFleetOverviewRows(erp, enrichedVehicles, extra = {}) {
  const units = erp.integritySamsaraCache?.units || {};
  const rows = [];
  for (const v of enrichedVehicles || []) {
    const u = String(v.name || '').trim();
    if (!u) continue;
    const c = units[u] || {};
    const active = activeAlertsForUnit(erp, u);
    const score = computeIntegrityScoreFromAlerts(active, {});
    const lastWo = lastWoDate(erp, u);
    const lastFuel = lastFuelDate(erp, u);
    const lastInsp = lastInspectionDate(erp, u);
    rows.push({
      unit: u,
      ymm: [v.year, v.make, v.model].filter(Boolean).join(' '),
      integrityScore: score.score,
      scoreBand: score.band,
      activeAlerts: active.length,
      red: active.filter(x => String(x.severity || '').toUpperCase() === 'RED').length,
      amber: active.filter(x => String(x.severity || '').toUpperCase() !== 'RED').length,
      samsaraOdo: c.odometerMiles ?? v.odometerMiles ?? null,
      lastWoDate: lastWo,
      lastFuelDate: lastFuel,
      lastInspectionDate: lastInsp,
      pmStatus: extra.pmByUnit?.[u] || '—',
      faultCount: (c.faultCodes || []).length
    });
  }
  rows.sort((a, b) => a.integrityScore - b.integrityScore);
  return rows;
}

function lastWoDate(erp, unit) {
  let best = '';
  for (const w of erp.workOrders || []) {
    if (w.voided) continue;
    if (String(w.unit || '').trim() !== String(unit || '').trim()) continue;
    const d = sliceD(w.serviceDate || '');
    if (d > best) best = d;
  }
  return best;
}

function lastFuelDate(erp, unit) {
  let best = '';
  const u = String(unit || '').trim();
  for (const p of erp.fuelPurchases || []) {
    if (String(p.unit || '').trim() !== u) continue;
    const d = sliceD(p.txnDate || '');
    if (d > best) best = d;
  }
  return best;
}

function lastInspectionDate(erp, unit) {
  let best = '';
  const u = String(unit || '').trim();
  for (const w of erp.workOrders || []) {
    if (w.voided) continue;
    if (String(w.unit || '').trim() !== u) continue;
    const st = String(w.serviceType || '').toLowerCase();
    if (!st.includes('annual') || !st.includes('inspection')) continue;
    const d = sliceD(w.serviceDate || '');
    if (d > best) best = d;
  }
  return best;
}

/** Shared context for per-unit telematics crossref (nightly + manual all-units). */
export function buildFleetTelematicsContext(erp, enrichedVehicles, orgSafetyEvents, tmsDriverByUnit) {
  const unitList = (enrichedVehicles || []).map(x => String(x.name || '').trim()).filter(Boolean);
  const milesByUnit = {};
  for (const un of unitList) {
    const cu = (erp.integritySamsaraCache?.units || {})[un] || {};
    if (Number(cu.tripMiles30d) > 10) milesByUnit[un] = cu.tripMiles30d;
  }
  const fleetAvgFuel = fleetAvgFuelCostPerMile(erp, unitList, 30, milesByUnit);
  const { avg, byUnit } = aggregateSafetyByUnit(orgSafetyEvents || []);
  const repairCostByUnit = repairCost90dForFleet(erp);
  return { fleetAvgFuel, fleetSafetyAgg: { avg }, safetyTotalsByUnit: byUnit, repairCostByUnit, tmsDriverByUnit: tmsDriverByUnit || {} };
}
