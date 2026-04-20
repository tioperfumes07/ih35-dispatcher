/**
 * Samsara + ERP integrity bundle builder (read-only Samsara; alerts persisted by caller).
 */

import {
  fetchVehicleStatsHistory,
  fetchVehicleStatsSnapshot,
  fetchSafetyEventsForVehicle,
  fetchTripsForVehicle,
  summarizeSafetyEvents,
  sumTripMeters,
  extractFaultCodesFromStatsPayload
} from './samsara-integrity-fetch.mjs';
import { samsaraPaginate, hasSamsaraReadToken } from './samsara-report-fetch.mjs';
import {
  runSamsaraCrossrefChecks,
  computeVehicleIntegrityScore,
  lastWorkOrderMileageForUnit,
  lastFuelDateForUnit,
  lastAnnualInspectionDate,
  repairCostLastDays,
  lastPmMileageForUnit,
  fuelGallonsBetween
} from './integrity-samsara-crossref.mjs';

function iso(d) {
  return d.toISOString();
}

function seriesDeltaInWindow(points, startMs) {
  if (!Array.isArray(points) || !points.length) return 0;
  const inR = points.filter(p => new Date(p.time).getTime() >= startMs);
  if (inR.length < 2) return 0;
  const a = inR[0].value;
  const b = inR[inR.length - 1].value;
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return b - a;
}

function dailyOdometerMilesSeries(odoPoints) {
  if (!Array.isArray(odoPoints) || !odoPoints.length) return [];
  const byDay = new Map();
  for (const p of odoPoints) {
    const day = String(p.time || '').slice(0, 10);
    if (!day) continue;
    const mi = p.value != null ? Number(p.value) / 1609.34 : null;
    if (!Number.isFinite(mi)) continue;
    byDay.set(day, mi);
  }
  const days = [...byDay.keys()].sort();
  const out = [];
  for (let i = 1; i < days.length; i++) {
    const d0 = days[i - 1];
    const d1 = days[i];
    const delta = byDay.get(d1) - byDay.get(d0);
    if (Number.isFinite(delta) && delta >= 0 && delta < 2000) {
      out.push({ date: d1, miles: Math.round(delta * 10) / 10 });
    }
  }
  return out.slice(-90);
}

/** @param {unknown[]} events */
export function aggregateSafetyByUnit(events, unitNames) {
  const set = new Set((unitNames || []).map(u => String(u || '').trim()).filter(Boolean));
  const sums = {};
  let fleet = {
    harshBrake: 0,
    harshAccel: 0,
    speeding: 0,
    distracted: 0,
    collisionRisk: 0,
    other: 0,
    n: 0
  };
  for (const ev of events || []) {
    const vn = String(ev?.vehicle?.name || '').trim();
    if (!set.has(vn)) continue;
    const one = summarizeSafetyEvents([ev]);
    if (!sums[vn]) {
      sums[vn] = {
        harshBrake: 0,
        harshAccel: 0,
        speeding: 0,
        distracted: 0,
        collisionRisk: 0,
        other: 0
      };
    }
    for (const k of Object.keys(sums[vn])) {
      sums[vn][k] += one[k] || 0;
      fleet[k] += one[k] || 0;
    }
    fleet.n += 1;
  }
  const nUnits = Math.max(1, set.size);
  const fleetAvg = {
    harshBrake: fleet.harshBrake / nUnits,
    harshAccel: fleet.harshAccel / nUnits,
    speeding: fleet.speeding / nUnits,
    distracted: fleet.distracted / nUnits,
    collisionRisk: fleet.collisionRisk / nUnits,
    other: fleet.other / nUnits
  };
  return { byUnit: sums, fleetAvg };
}

export async function fetchOrgSafetyEvents30d() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  try {
    return await samsaraPaginate(
      '/fleet/safety/events',
      { startTime: iso(start), endTime: iso(end) },
      { maxPages: 10, limit: 200 }
    );
  } catch {
    try {
      return await samsaraPaginate(
        '/fleet/safety-events',
        { startTime: iso(start), endTime: iso(end) },
        { maxPages: 10, limit: 200 }
      );
    } catch {
      return [];
    }
  }
}

/**
 * @param {object} opts
 * @param {object} opts.erp
 * @param {string} opts.unit
 * @param {object} opts.row enriched vehicle row from fetchTrackedFleetSnapshot
 * @param {{ fleetAvgSafety?: object, fleetRepairCosts30d?: number[], fleetFuelRatios?: Record<string, number>, tmsDispatchByUnit?: Record<string, string>, samsaraDriverByUnit?: Record<string, string> }} [opts.fleetCtx]
 */
export async function buildVehicleIntegrityBundle(opts) {
  const { erp, unit, row, fleetCtx = {} } = opts;
  const u = String(unit || '').trim();
  const vehicleId = String(row?.id || row?.vehicleId || row?.ids?.samsaraId || '').trim();
  const end = new Date();
  const start30 = new Date(end.getTime() - 30 * 86400000);
  const start7 = new Date(end.getTime() - 7 * 86400000);
  const start90 = new Date(end.getTime() - 90 * 86400000);
  const endIso = iso(end);

  let trips30 = [];
  let trips7 = [];
  let safetyEvents = [];
  let hist = { points: {} };
  let statsSnap = null;
  let faultCodes = [];

  if (vehicleId && hasSamsaraReadToken()) {
    [trips30, trips7, safetyEvents, hist, statsSnap] = await Promise.all([
      fetchTripsForVehicle(vehicleId, iso(start30), endIso),
      fetchTripsForVehicle(vehicleId, iso(start7), endIso),
      fetchSafetyEventsForVehicle(vehicleId, iso(start30), endIso),
      fetchVehicleStatsHistory(vehicleId, iso(start90), endIso, 'obdOdometerMeters,obdEngineSeconds,engineIdleSeconds'),
      fetchVehicleStatsSnapshot(vehicleId, 'faultCodes,obdEngineSeconds,obdOdometerMeters')
    ]);
    faultCodes = extractFaultCodesFromStatsPayload(statsSnap);
  }

  const tripMiles30d = sumTripMeters(trips30) / 1609.34;
  const tripMiles7d = sumTripMeters(trips7) / 1609.34;
  const engPts = hist.points?.obdEngineSeconds || [];
  const idlePts = hist.points?.engineIdleSeconds || [];
  const odoPts = hist.points?.obdOdometerMeters || [];
  const engineHoursDelta30d = seriesDeltaInWindow(engPts, start30.getTime()) || 0;
  const idleEngineSeconds30d = seriesDeltaInWindow(idlePts, start30.getTime()) || 0;
  const odoSeries = dailyOdometerMilesSeries(odoPts);

  const safetyCounts = summarizeSafetyEvents(safetyEvents);
  const liveOdo = row?.odometerMiles != null ? Number(row.odometerMiles) : null;
  const assetStatus = String(erp?.assetStatusByUnit?.[u]?.status || '').trim();

  const { alerts, meta } = runSamsaraCrossrefChecks({
    erp,
    unit: u,
    samsaraVehicleId: vehicleId,
    liveOdometerMiles: liveOdo,
    tripMiles30d,
    tripMiles7d,
    engineHoursDelta30d,
    idleEngineSeconds30d,
    safetyCounts,
    faultCodes,
    fleetAvgSafety: fleetCtx.fleetAvgSafety,
    fleetRepairCosts30d: fleetCtx.fleetRepairCosts30d,
    fleetFuelRatios: fleetCtx.fleetFuelRatios,
    tmsDispatchDriverName: fleetCtx.tmsDispatchByUnit?.[u] || '',
    samsaraDriverName: fleetCtx.samsaraDriverByUnit?.[u] || '',
    assetStatus
  });

  const unitAlerts = (erp.integrityAlerts || []).filter(
    a => String(a.unitId || '') === u && String(a.status || 'active') === 'active'
  );
  const redCount = unitAlerts.filter(x => String(x.severity || '').toUpperCase() === 'RED').length;
  const amberCount = unitAlerts.filter(x => String(x.severity || '').toUpperCase() !== 'RED').length;
  const lastPm = lastPmMileageForUnit(erp, u);
  const overduePm = liveOdo != null && lastPm?.miles != null && liveOdo - lastPm.miles > (Number(erp?.companyProfile?.pmIntervalMiles) || 25000);
  const lastInsp = lastAnnualInspectionDate(erp, u);
  const monthsInsp = lastInsp
    ? (Date.now() - new Date(`${lastInsp}T12:00:00Z`).getTime()) / (30.44 * 86400000)
    : 999;
  const overdueInspection = monthsInsp > 11;
  const missingHints =
    (tripMiles7d > 200 && fuelGallonsBetween(erp, u, iso(start7), endIso.slice(0, 10)) < 0.5 ? 1 : 0) +
    (workOrdersUnpostedCount(erp, u) > 0 ? 1 : 0);

  const score = computeVehicleIntegrityScore({
    redCount,
    amberCount,
    overduePm,
    overdueInspection,
    missingHints
  });

  const monthlyMaint = monthlyMaintenanceCostSeries(erp, u, 12);

  return {
    ok: true,
    unit: u,
    integrityScore: score,
    samsara: {
      vehicleId,
      odometerMiles: liveOdo,
      engineHoursDelta30d,
      idleEngineSeconds30d,
      tripMiles30d,
      tripMiles7d,
      faultCodes,
      safetyCounts,
      gpsUpdatedAt: row?.liveStatsUpdatedAt || '',
      fuelPercent: row?.fuelPercent ?? null,
      latitude: row?.latitude ?? null,
      longitude: row?.longitude ?? null
    },
    erp: {
      lastWorkOrderMileage: meta?.lastWo || null,
      lastPm: meta?.lastPm || null,
      lastFuelDate: meta?.lastFuel || '',
      lastInspectionDate: meta?.lastInsp || '',
      repairCost30d: meta?.repair30 ?? 0
    },
    panels: {
      odometerSeries: odoSeries,
      maintenanceMonthly: monthlyMaint,
      safetyBars: safetyCounts,
      idleDaily: [],
      faultCodes,
      alerts90: unitAlerts
        .filter(a => {
          const d = String(a.triggeredDate || a.createdAt || '').slice(0, 10);
          return d >= iso(start90).slice(0, 10);
        })
        .slice(0, 80)
    },
    crossrefAlerts: alerts,
    activeAlertsSummary: { red: redCount, amber: amberCount, total: unitAlerts.length }
  };
}

function workOrdersUnpostedCount(erp, unit) {
  const u = String(unit || '').trim();
  let n = 0;
  for (const wo of erp?.workOrders || []) {
    if (wo.voided) continue;
    if (String(wo.unit || '').trim() !== u) continue;
    const st = String(wo.qboSyncStatus || '').toLowerCase();
    if (st === 'posted' || st === 'synced') continue;
    n++;
  }
  return n;
}

function monthlyMaintenanceCostSeries(erp, unit, months) {
  const u = String(unit || '').trim();
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
  const buckets = {};
  for (const wo of erp?.workOrders || []) {
    if (wo.voided) continue;
    if (String(wo.unit || '').trim() !== u) continue;
    const d = String(wo.serviceDate || '').slice(0, 7);
    if (!d || d < start.toISOString().slice(0, 7)) continue;
    const lineSum = (wo.lines || []).reduce((s, ln) => s + (Number(ln.amount) || 0), 0);
    const amt = lineSum > 0 ? lineSum : Number(wo.totalCost || wo.amount || 0) || 0;
    buckets[d] = (buckets[d] || 0) + amt;
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 }));
}

export async function buildFleetOverviewRows(erp, enrichedVehicles, fleetCtx) {
  const repairList = [];
  const fuelRatios = {};
  let totalGal = 0;
  const start30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endD = new Date().toISOString().slice(0, 10);
  for (const v of enrichedVehicles || []) {
    const u = String(v.name || '').trim();
    if (!u) continue;
    repairList.push(repairCostLastDays(erp, u, 30));
    const g = fuelGallonsBetween(erp, u, start30, endD);
    totalGal += g;
  }
  const avgGal = totalGal / Math.max(1, (enrichedVehicles || []).length);
  for (const v of enrichedVehicles || []) {
    const u = String(v.name || '').trim();
    const g = fuelGallonsBetween(erp, u, start30, endD);
    fuelRatios[u] = avgGal > 0 ? g / avgGal : 1;
  }

  const rows = [];
  for (const v of enrichedVehicles || []) {
    const u = String(v.name || '').trim();
    const vid = String(v.id || v.vehicleId || v.ids?.samsaraId || '').trim();
    const lastWo = lastWorkOrderMileageForUnit(erp, u);
    const lastFuel = lastFuelDateForUnit(erp, u);
    const lastInsp = lastAnnualInspectionDate(erp, u);
    const pm = lastPmMileageForUnit(erp, u);
    const liveOdo = v.odometerMiles != null ? Number(v.odometerMiles) : null;
    const pmInterval = Number(erp?.companyProfile?.pmIntervalMiles) || 25000;
    let pmStatus = 'Current';
    let pmRank = 0;
    if (liveOdo != null && pm?.miles != null) {
      const since = liveOdo - pm.miles;
      if (since > pmInterval + 5000) {
        pmStatus = 'Overdue';
        pmRank = 2;
      } else if (since > pmInterval - 2000) {
        pmStatus = 'Due soon';
        pmRank = 1;
      }
    }
    const unitAlerts = (erp.integrityAlerts || []).filter(
      a => String(a.unitId || '') === u && String(a.status || 'active') === 'active'
    );
    const red = unitAlerts.filter(x => String(x.severity || '').toUpperCase() === 'RED').length;
    const amber = unitAlerts.filter(x => String(x.severity || '').toUpperCase() !== 'RED').length;
    const score = computeVehicleIntegrityScore({
      redCount: red,
      amberCount: amber,
      overduePm: pmStatus === 'Overdue',
      overdueInspection: lastInsp
        ? (Date.now() - new Date(`${lastInsp}T12:00:00Z`).getTime()) / (30.44 * 86400000) > 11
        : false,
      missingHints: 0
    });
    const daysSinceWo = lastWo?.date
      ? Math.floor((Date.now() - new Date(`${lastWo.date}T12:00:00Z`).getTime()) / 86400000)
      : 999;
    const daysSinceFuel = lastFuel
      ? Math.floor((Date.now() - new Date(`${lastFuel}T12:00:00Z`).getTime()) / 86400000)
      : 999;
    rows.push({
      unit: u,
      vehicleId: vid,
      ymm: [v.year, v.make, v.model].filter(Boolean).join(' '),
      integrityScore: score,
      activeAlerts: unitAlerts.length,
      red,
      amber,
      samsaraOdometer: liveOdo,
      lastWoDate: lastWo?.date || '',
      lastFuelDate: lastFuel || '',
      lastInspectionDate: lastInsp || '',
      pmStatus,
      pmRank,
      faultCodeCount: fleetCtx?.faultCountByUnit?.[u] || 0,
      daysSinceWo,
      daysSinceFuel,
      assetStatus: erp?.assetStatusByUnit?.[u]?.status || ''
    });
  }
  rows.sort((a, b) => a.integrityScore - b.integrityScore);
  return { rows, repairList, fuelRatios };
}
