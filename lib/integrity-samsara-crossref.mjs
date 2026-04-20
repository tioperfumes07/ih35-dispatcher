/**
 * Cross-reference Samsara telematics snapshot vs ERP maintenance / fuel / dispatch.
 * Returns alert objects for `persistIntegrityAlerts` (read-only evaluation).
 */

import { mergeIntegrityThresholds } from './integrity-engine.mjs';

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function isPmLike(serviceType, recordType) {
  const s = String(serviceType || '').toLowerCase();
  const r = String(recordType || '').toLowerCase();
  if (r === 'pm') return true;
  return /pm\b|preventive|oil change|lube|grease|pm service/i.test(s);
}

function woTotal(w) {
  return (w.lines || []).reduce((s, l) => s + money(l.amount), 0);
}

function activeWos(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

function lastWoOdometer(erp, unit) {
  const u = String(unit || '').trim();
  let best = null;
  for (const w of activeWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    const sm = Number(w.serviceMileage);
    const d = sliceD(w.serviceDate || '');
    if (!d) continue;
    if (!Number.isFinite(sm)) continue;
    if (!best || d >= best.date) best = { miles: sm, date: d, id: w.id };
  }
  return best;
}

function lastPmMileage(erp, unit) {
  const u = String(unit || '').trim();
  let best = null;
  for (const w of activeWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    if (!isPmLike(w.serviceType, w.maintRecordType)) continue;
    const sm = Number(w.serviceMileage);
    const d = sliceD(w.serviceDate || '');
    if (!Number.isFinite(sm) || !d) continue;
    if (!best || sm > best.miles) best = { miles: sm, date: d };
  }
  return best;
}

function lastAnnualInspectionDate(erp, unit) {
  const u = String(unit || '').trim();
  let best = '';
  for (const w of activeWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    const st = String(w.serviceType || '').toLowerCase();
    if (!st.includes('annual') || !st.includes('inspection')) continue;
    const d = sliceD(w.serviceDate || '');
    if (d && d > best) best = d;
  }
  return best;
}

function fuelGallonsWindow(erp, unit, fromD, toD) {
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

function woRecentForUnit(erp, unit, days) {
  const u = String(unit || '').trim();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cs = cutoff.toISOString().slice(0, 10);
  return activeWos(erp).filter(w => String(w.unit || '').trim() === u && sliceD(w.serviceDate || '') >= cs);
}

function repairCostWindow(erp, unit, days) {
  const u = String(unit || '').trim();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cs = cutoff.toISOString().slice(0, 10);
  let sum = 0;
  for (const w of activeWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    const d = sliceD(w.serviceDate || '');
    if (!d || d < cs) continue;
    const mt = String(w.maintRecordType || '').toLowerCase();
    const st = String(w.serviceType || '').toLowerCase();
    if (mt === 'repair' || st.includes('repair')) sum += woTotal(w);
  }
  return sum;
}

function unpostedWosOlderThan(erp, unit, days) {
  const u = String(unit || '').trim();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cs = cutoff.toISOString().slice(0, 10);
  const rows = [];
  for (const w of activeWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    const d = sliceD(w.savedAt || w.updatedAt || w.serviceDate || '');
    if (!d || d > cs) continue;
    const qs = String(w.qboSyncStatus || '').toLowerCase();
    const posted =
      qs.includes('posted') ||
      qs.includes('synced') ||
      String(w.qboEntityId || '').trim() ||
      String(w.qboPurchaseId || '').trim();
    if (posted) continue;
    rows.push({ id: w.id, date: d, number: w.workOrderNumber || w.internalWorkOrderNumber || '' });
  }
  return rows;
}

function faultSeverityRank(code, desc) {
  const t = `${code} ${desc}`.toLowerCase();
  if (/brake|egr|def|dpf|coolant|oil press|engine|overheat|misfire/.test(t)) return 'RED';
  return 'AMBER';
}

function quantile(arr, q) {
  const sorted = [...(arr || [])].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * q);
  return sorted[idx] || 0;
}

/**
 * @param {object} params
 * @param {string} params.unit
 * @param {object} params.erp
 * @param {object} params.cacheUnit
 * @param {object} [params.fleetSafetyAgg]
 * @param {object} [params.repairCostByUnit]
 * @param {object} [params.safetyTotalsByUnit]
 * @param {string} [params.tmsDriverName]
 * @param {number} [params.fleetAvgFuelCostPerMile]
 * @param {number} [params.unitFuelCostPerMile30d]
 * @param {object} [params.localSafety]
 */
export function runSamsaraCrossrefChecks(params) {
  const alerts = [];
  const u = String(params.unit || '').trim();
  if (!u) return alerts;
  const erp = params.erp || {};
  const c = params.cacheUnit || {};
  const fleetAvgMilesPerMonth =
    Number(params.fleetAvgMilesPerMonth) > 0 ? Number(params.fleetAvgMilesPerMonth) : 12000;
  mergeIntegrityThresholds(erp);

  const pmInterval = Number.isFinite(Number(erp?.companyProfile?.pmIntervalMiles))
    ? Number(erp.companyProfile.pmIntervalMiles)
    : 25000;

  const samsaraOdo = Number(c.odometerMiles);
  const tripMiles30 = Number(c.tripMiles30d || 0);
  const tripMiles7 = Number(c.tripMiles7d || 0);
  const engineHours30 = Number(c.engineHoursDelta30d || 0);
  const idleHours30 = Number(c.idleHours30d || 0);
  const idlePct = Number(c.idlePercent30d);
  const unassignedMiles = Number(c.unassignedTripMiles30d || 0);
  const samsaraEngTotalHr = Number(c.engineHoursTotal);
  const faultList = Array.isArray(c.faultCodes) ? c.faultCodes : [];
  const sDriver = String(params.samsaraDriverName || c.driverName || '').trim();
  const tmsDriver = String(params.tmsDriverName || '').trim();

  const lastWo = lastWoOdometer(erp, u);
  if (lastWo && Number.isFinite(samsaraOdo) && Number.isFinite(lastWo.miles)) {
    const diff = Math.abs(samsaraOdo - lastWo.miles);
    if (diff > 25000) {
      alerts.push({
        unitId: u,
        type: 'OD1',
        severity: 'AMBER',
        message: `Unit ${u} — odometer mismatch. Last ERP work order mileage: ${lastWo.miles} mi. Samsara current: ${samsaraOdo} mi. Difference: ${diff} mi. Work orders may be missing or odometer was not recorded correctly.`,
        details: { erpMiles: lastWo.miles, samsaraMiles: samsaraOdo, diff },
        dedupeKey: `OD1:${u}`
      });
    }
  }

  const pm = lastPmMileage(erp, u);
  if (pm && Number.isFinite(samsaraOdo) && Number.isFinite(pm.miles)) {
    const since = samsaraOdo - pm.miles;
    if (since > pmInterval) {
      const over = since - pmInterval;
      const sev = over > 3000 ? 'RED' : 'AMBER';
      const moOver = (over / fleetAvgMilesPerMonth).toFixed(1);
      const wkOver = over / (fleetAvgMilesPerMonth / 4.345);
      const approxHuman =
        Number(moOver) >= 1
          ? `approximately ${moOver} months overdue at ${fleetAvgMilesPerMonth.toLocaleString('en-US')} mi/mo fleet average`
          : wkOver >= 1
            ? `approximately ${Math.max(1, Math.round(wkOver))} weeks overdue at that pace`
            : `approximately ${Math.max(1, Math.round((over / fleetAvgMilesPerMonth) * 30))} days overdue at that pace`;
      alerts.push({
        unitId: u,
        type: 'OD2',
        severity: sev,
        message: `Unit ${u} is ${Math.round(since)} mi since last PM-like service (interval ${pmInterval} mi). Last PM mileage: ${pm.miles} mi. Samsara odometer: ${samsaraOdo} mi. Over the PM threshold by ${Math.round(
          over
        )} mi (${approxHuman}).`,
        details: {
          sincePmMiles: since,
          pmIntervalMiles: pmInterval,
          lastPmMiles: pm.miles,
          fleetAvgMilesPerMonth,
          milesOverPm: over
        },
        dedupeKey: `OD2:${u}`
      });
    }
  }

  const endD = new Date().toISOString().slice(0, 10);
  const start30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const gal30 = fuelGallonsWindow(erp, u, start30, endD);
  if (tripMiles30 > 50 && gal30 > 5) {
    const mpg = tripMiles30 / gal30;
    if (mpg < 4 || mpg > 12) {
      alerts.push({
        unitId: u,
        type: 'OD3',
        severity: 'AMBER',
        message: `Unit ${u} shows ${mpg.toFixed(1)} MPG from Samsara trip miles vs ERP fuel in the last 30 days. Normal semi range assumed 4–12 MPG — verify fuel entries or telematics.`,
        details: { mpg, tripMiles30, gallons30: gal30 },
        dedupeKey: `OD3:${u}`
      });
    }
  }

  if (engineHours30 > 5 && tripMiles30 > 10) {
    const mph = tripMiles30 / engineHours30;
    if (mph < 20) {
      alerts.push({
        unitId: u,
        type: 'EH1',
        severity: 'AMBER',
        message: `Unit ${u} averaged ${mph.toFixed(1)} miles per engine hour in the last 30 days. This may indicate excessive idling vs distance.`,
        details: { milesPerEngineHour: mph, tripMiles30, engineHours30 },
        dedupeKey: `EH1:${u}`
      });
    }
  }

  const lastEngRecorded = Number(c.lastRecordedEngineHoursOnWo);
  if (Number.isFinite(samsaraEngTotalHr) && Number.isFinite(lastEngRecorded) && lastEngRecorded > 0) {
    const dueAt = lastEngRecorded + Number(c.nextEngineHourInterval || 0);
    if (Number(c.nextEngineHourInterval) > 0 && samsaraEngTotalHr > dueAt) {
      alerts.push({
        unitId: u,
        type: 'EH2',
        severity: 'AMBER',
        message: `Unit ${u} may be due for service by engine hours. Samsara shows ${samsaraEngTotalHr.toFixed(1)} hrs vs scheduled next at ${dueAt.toFixed(1)} hrs (from last ERP interval).`,
        details: { engineHours: samsaraEngTotalHr, dueAt },
        dedupeKey: `EH2:${u}`
      });
    }
  }

  if (Number.isFinite(idlePct) && idlePct > 30) {
    alerts.push({
      unitId: u,
      type: 'IT1',
      severity: 'AMBER',
      message: `Unit ${u} has ${idlePct.toFixed(0)}% idle time in the last 30 days (${idleHours30.toFixed(1)} idle hrs vs engine time).`,
      details: { idlePercent30d: idlePct, idleHours30d: idleHours30 },
      dedupeKey: `IT1:${u}`
    });
  }

  const fuelAvg = Number(params.fleetAvgFuelCostPerMile || 0);
  const unitFuel = Number(params.unitFuelCostPerMile30d || 0);
  if (Number.isFinite(idlePct) && idlePct > 30 && fuelAvg > 0 && unitFuel > fuelAvg * 1.25) {
    alerts.push({
      unitId: u,
      type: 'IT2',
      severity: 'RED',
      message: `Unit ${u} shows both high idle (${idlePct.toFixed(0)}%) and above-average fuel cost per mile vs fleet.`,
      details: { idlePercent30d: idlePct, unitFuelCostPerMile: unitFuel, fleetAvg: fuelAvg },
      dedupeKey: `IT2:${u}`
    });
  }

  const st = String((erp.assetStatusByUnit || {})[u]?.status || 'in_service').toLowerCase();
  if (st === 'in_service' && tripMiles7 < 5) {
    alerts.push({
      unitId: u,
      type: 'VU1',
      severity: 'AMBER',
      message: `Unit ${u} shows no GPS movement in the last 7 days but is marked in service. Verify status and Samsara connectivity.`,
      details: { tripMiles7d: tripMiles7 },
      dedupeKey: `VU1:${u}`
    });
  }

  if (unassignedMiles > 150) {
    alerts.push({
      unitId: u,
      type: 'VU2',
      severity: 'RED',
      message: `Unit ${u} has about ${Math.round(unassignedMiles)} miles of unassigned driving in the last 30 days (Samsara trips). Review HOS / driver assignment.`,
      details: { unassignedTripMiles30d: unassignedMiles },
      dedupeKey: `VU2:${u}`
    });
  }

  if (sDriver && tmsDriver && sDriver.toLowerCase() !== tmsDriver.toLowerCase()) {
    alerts.push({
      unitId: u,
      type: 'VU3',
      severity: 'AMBER',
      message: `Samsara shows "${sDriver}" on unit ${u} but TMS active dispatch suggests "${tmsDriver}". Verify driver assignment.`,
      details: { samsaraDriver: sDriver, tmsDriver },
      dedupeKey: `VU3:${u}`
    });
  }

  if (faultList.length) {
    const recent = woRecentForUnit(erp, u, 7);
    const hasOpen = recent.length > 0;
    if (!hasOpen) {
      const codes = faultList.map(f => f.code).join(', ');
      const worst = faultList.some(f => faultSeverityRank(f.code, f.description) === 'RED') ? 'RED' : 'AMBER';
      alerts.push({
        unitId: u,
        type: 'FC1',
        severity: worst,
        message: `Unit ${u} has ${faultList.length} active fault code(s) from Samsara with no work order in the last 7 days: ${codes}.`,
        details: { faultCodes: faultList },
        dedupeKey: `FC1:${u}`
      });
    }
  }

  const fcHist = c.faultCodeCounts90d || {};
  for (const [code, n] of Object.entries(fcHist)) {
    if (Number(n) > 2) {
      alerts.push({
        unitId: u,
        type: 'FC2',
        severity: 'AMBER',
        message: `Unit ${u} fault code ${code} appeared ${n} times in the last 90 days (snapshot history).`,
        details: { code, count: n },
        dedupeKey: `FC2:${u}:${code}`
      });
    }
  }

  const milesNoFuel = Number(c.maxRolling7dMilesWithoutFuel || 0);
  if (milesNoFuel > 500) {
    alerts.push({
      unitId: u,
      type: 'MR1',
      severity: 'AMBER',
      message: `Unit ${u} drove about ${Math.round(milesNoFuel)} miles in a 7-day window with no ERP fuel purchase recorded.`,
      details: { miles: milesNoFuel },
      dedupeKey: `MR1:${u}`
    });
  }

  const unposted = unpostedWosOlderThan(erp, u, 7);
  if (unposted.length) {
    const oldest = unposted.map(x => x.date).sort()[0];
    alerts.push({
      unitId: u,
      type: 'MR2',
      severity: 'AMBER',
      message: `Unit ${u} has ${unposted.length} work order(s) saved but not posted to QuickBooks (oldest ${oldest}).`,
      details: { count: unposted.length, oldest },
      dedupeKey: `MR2:${u}`
    });
  }

  const ins = lastAnnualInspectionDate(erp, u);
  if (ins) {
    const months = (Date.now() - new Date(`${ins}T12:00:00Z`).getTime()) / (30.44 * 86400000);
    const dueSoon = months >= 11;
    const past = months > 12;
    if (dueSoon) {
      alerts.push({
        unitId: u,
        type: 'MR3',
        severity: past ? 'RED' : 'AMBER',
        message: `Unit ${u} annual inspection last recorded ${ins} (~${Math.round(months)} months ago). Schedule before 12-month window.`,
        details: { lastInspection: ins, monthsAgo: months },
        dedupeKey: `MR3:${u}`
      });
    }
  }

  const fleetAgg = params.fleetSafetyAgg?.avg || {};
  const locSafety = params.localSafety || {};
  for (const k of ['harshBrake', 'harshAccel', 'speeding', 'distracted', 'collisionRisk']) {
    const v = Number(locSafety[k] || 0);
    const av = Number(fleetAgg[k] || 0);
    if (av > 0 && v >= av * 2 && v >= 3) {
      const dname = String(locSafety.topDriver || '').trim() || 'Driver';
      alerts.push({
        unitId: u,
        type: 'DB1',
        severity: 'AMBER',
        message: `${dname} on unit ${u} has ${v} ${k} safety events in 30d vs fleet avg ${av.toFixed(1)}.`,
        details: { eventType: k, count: v, fleetAvg: av, driverName: dname },
        dedupeKey: `DB1:${u}:${k}`
      });
    }
  }

  const rcMap = params.repairCostByUnit || {};
  const stMap = params.safetyTotalsByUnit || {};
  const rcVals = Object.values(rcMap).filter(Number.isFinite);
  const evVals = Object.values(stMap).map(x => Number(x?.total || 0));
  const qR = quantile(rcVals, 0.75);
  const qE = quantile(evVals, 0.75);
  const myR = Number(rcMap[u] || 0);
  const myE = Number(stMap[u]?.total || 0);
  if (myR >= qR && myE >= qE && myR > 0 && myE > 0) {
    alerts.push({
      unitId: u,
      type: 'DB2',
      severity: 'RED',
      message: `Unit ${u} is in the top quartile for both safety-event volume and repair spend (90d repair / 30d safety).`,
      details: { repairCost: myR, safetyEvents: myE },
      dedupeKey: `DB2:${u}`
    });
  }

  const spd = Number(locSafety.speeding || 0);
  const fuelRatio = fuelAvg > 0 ? unitFuel / fuelAvg : 0;
  if (spd >= 6 && fuelAvg > 0 && unitFuel > fuelAvg * 1.2) {
    alerts.push({
      unitId: u,
      type: 'DB3',
      severity: 'AMBER',
      message: `Driver activity on ${u}: ${spd} speeding events and fuel cost/mile ${(fuelRatio * 100).toFixed(0)}% of fleet average.`,
      details: { speeding: spd, fuelRatio },
      dedupeKey: `DB3:${u}`
    });
  }

  return alerts;
}

export function repairCost90dForFleet(erp) {
  const out = {};
  const units = new Set();
  for (const w of activeWos(erp)) {
    const u = String(w.unit || '').trim();
    if (u) units.add(u);
  }
  for (const u of units) out[u] = repairCostWindow(erp, u, 90);
  return out;
}
