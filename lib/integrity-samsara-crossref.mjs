/**
 * ERP + Samsara cross-reference integrity checks (read-only evaluation).
 * Returns alert objects compatible with `persistIntegrityAlerts` in server.js.
 */

import { mergeIntegrityThresholds } from './integrity-engine.mjs';

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

function activeWorkOrders(erp) {
  return (erp?.workOrders || []).filter(w => !w.voided);
}

export function lastWorkOrderMileageForUnit(erp, unit) {
  const u = String(unit || '').trim();
  let best = null;
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    const sm = Number(wo.serviceMileage);
    if (!Number.isFinite(sm)) continue;
    const d = sliceD(wo.serviceDate);
    if (!best || (d && d > best.date)) best = { miles: sm, date: d, id: wo.id, number: wo.workOrderNumber || '' };
    else if (d === best.date && sm > best.miles) best = { miles: sm, date: d, id: wo.id, number: wo.workOrderNumber || '' };
  }
  return best;
}

export function lastPmMileageForUnit(erp, unit) {
  const u = String(unit || '').trim();
  const pmNeedles = ['pm service', 'pm ', 'preventive', 'trailer pm', 'reefer pm'];
  let best = null;
  const consider = rec => {
    if (String(rec.unit || '').trim() !== u) return;
    const st = String(rec.serviceType || '').toLowerCase();
    if (!pmNeedles.some(n => st.includes(n.replace(/\s+$/, '')))) return;
    const sm = Number(rec.serviceMileage);
    if (!Number.isFinite(sm)) return;
    const d = sliceD(rec.serviceDate);
    if (!best || (d && d > best.date)) best = { miles: sm, date: d };
  };
  for (const r of erp?.records || []) consider(r);
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    for (const line of wo.lines || []) {
      consider({
        unit: wo.unit,
        serviceType: line.serviceType || wo.maintRecordType || '',
        serviceMileage: line.serviceMileage ?? wo.serviceMileage,
        serviceDate: wo.serviceDate
      });
    }
  }
  return best;
}

export function fuelGallonsBetween(erp, unit, startD, endD) {
  const u = String(unit || '').trim();
  let gal = 0;
  for (const p of erp?.fuelPurchases || []) {
    if (String(p.unit || '').trim() !== u) continue;
    const d = sliceD(p.txnDate || p.date || p.createdAt);
    if (!d || d < startD || d > endD) continue;
    const g = Number(p.gallons);
    if (Number.isFinite(g) && g > 0) gal += g;
  }
  return gal;
}

export function lastFuelDateForUnit(erp, unit) {
  const u = String(unit || '').trim();
  let best = '';
  for (const p of erp?.fuelPurchases || []) {
    if (String(p.unit || '').trim() !== u) continue;
    const d = sliceD(p.txnDate || p.date || p.createdAt);
    if (d && d > best) best = d;
  }
  return best;
}

export function lastAnnualInspectionDate(erp, unit) {
  const u = String(unit || '').trim();
  let best = '';
  const needle = /annual inspection|dot inspection|inspection/i;
  for (const r of erp?.records || []) {
    if (String(r.unit || '').trim() !== u) continue;
    if (!needle.test(String(r.serviceType || ''))) continue;
    const d = sliceD(r.serviceDate);
    if (d && d > best) best = d;
  }
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    for (const line of wo.lines || []) {
      if (!needle.test(String(line.serviceType || ''))) continue;
      const d = sliceD(wo.serviceDate);
      if (d && d > best) best = d;
    }
  }
  return best;
}

export function repairCostLastDays(erp, unit, days) {
  const u = String(unit || '').trim();
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const startD = start.toISOString().slice(0, 10);
  let sum = 0;
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    const d = sliceD(wo.serviceDate);
    if (!d || d < startD) continue;
    const mt = String(wo.maintRecordType || '').toLowerCase();
    if (mt === 'pm') continue;
    const cat = String(wo.category || wo.workOrderCategory || '').toLowerCase();
    if (cat.includes('pm') && !cat.includes('repair')) continue;
    sum += Number(wo.totalCost || wo.amount || 0) || 0;
    for (const ln of wo.lines || []) {
      sum += Number(ln.amount || 0) || 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

export function workOrdersUnpostedOlderThanDays(erp, unit, days) {
  const u = String(unit || '').trim();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    const st = String(wo.qboSyncStatus || '').toLowerCase();
    if (st === 'posted' || st === 'synced') continue;
    const d = sliceD(wo.serviceDate);
    if (d && d < cutoff) out.push({ id: wo.id, date: d, number: wo.workOrderNumber || '' });
  }
  return out;
}

export function recentWorkOrderForFault(erp, unit, days) {
  const u = String(unit || '').trim();
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  for (const wo of activeWorkOrders(erp)) {
    if (String(wo.unit || '').trim() !== u) continue;
    const d = sliceD(wo.serviceDate);
    if (!d || d < start) continue;
    const blob = `${wo.title || ''} ${wo.notes || ''} ${(wo.lines || []).map(l => l.serviceType).join(' ')}`.toLowerCase();
    if (blob.includes('fault') || blob.includes('check engine') || blob.includes('dtc') || blob.includes('diagnostic')) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} params
 * @returns {{ alerts: object[], debug?: object }}
 */
export function runSamsaraCrossrefChecks(params) {
  const {
    erp,
    unit,
    samsaraVehicleId,
    liveOdometerMiles,
    tripMiles30d,
    tripMiles7d = null,
    engineHoursDelta30d,
    idleEngineSeconds30d,
    safetyCounts,
    faultCodes,
    fleetAvgSafety,
    fleetRepairCosts30d,
    fleetFuelRatios,
    tmsDispatchDriverName,
    samsaraDriverName,
    assetStatus
  } = params;

  mergeIntegrityThresholds(erp || {});
  const pmIntervalMiles = Number.isFinite(Number(erp?.companyProfile?.pmIntervalMiles))
    ? Number(erp.companyProfile.pmIntervalMiles)
    : 25000;

  const alerts = [];
  const u = String(unit || '').trim();
  if (!u) return { alerts };

  const lastWo = lastWorkOrderMileageForUnit(erp, u);
  const lastPm = lastPmMileageForUnit(erp, u);
  const lastFuel = lastFuelDateForUnit(erp, u);
  const lastInsp = lastAnnualInspectionDate(erp, u);
  const repair30 = repairCostLastDays(erp, u, 30);

  const samOdo = liveOdometerMiles != null && Number.isFinite(Number(liveOdometerMiles)) ? Number(liveOdometerMiles) : null;
  const erpOdo = lastWo?.miles != null ? Number(lastWo.miles) : null;

  // OD1
  if (samOdo != null && erpOdo != null) {
    const diff = Math.abs(samOdo - erpOdo);
    if (diff > 5000) {
      alerts.push({
        type: 'OD1',
        unitId: u,
        severity: 'AMBER',
        message: `Unit ${u} — Odometer mismatch. Last ERP record: ${erpOdo.toFixed(0)} mi. Samsara current: ${samOdo.toFixed(0)} mi. Difference: ${diff.toFixed(0)} mi. Work orders may be missing or odometer was not recorded correctly.`,
        details: { erpOdo, samOdo, diff, lastWoDate: lastWo?.date || '' },
        dedupeKey: `OD1:${u}:${Math.floor(samOdo / 5000)}`
      });
    }
  }

  // OD2 PM overdue / due soon
  if (samOdo != null && lastPm?.miles != null) {
    const since = samOdo - lastPm.miles;
    const overdueBy = since - pmIntervalMiles;
    if (overdueBy > 5000) {
      alerts.push({
        unitId: u,
        type: 'OD2',
        severity: 'RED',
        message: `Unit ${u} is ${Math.round(overdueBy)} miles overdue for PM service. Last PM was at ${lastPm.miles} mi. Current Samsara odometer: ${samOdo.toFixed(0)} mi.`,
        details: { since, pmIntervalMiles, lastPm: lastPm.miles, samOdo, overdueBy },
        dedupeKey: `OD2:${u}:${Math.floor(samOdo / 10000)}`
      });
    } else if (overdueBy > 0) {
      alerts.push({
        unitId: u,
        type: 'OD2',
        severity: 'AMBER',
        message: `Unit ${u} is ${Math.round(overdueBy)} miles past PM interval (${pmIntervalMiles} mi). Last PM at ${lastPm.miles} mi; Samsara odometer ${samOdo.toFixed(0)} mi.`,
        details: { since, pmIntervalMiles, lastPm: lastPm.miles, samOdo, overdueBy },
        dedupeKey: `OD2amber:${u}:${Math.floor(samOdo / 5000)}`
      });
    } else if (since > pmIntervalMiles - 2000) {
      alerts.push({
        unitId: u,
        type: 'OD2',
        severity: 'AMBER',
        message: `Unit ${u} is within 2,000 miles of PM due by mileage (${Math.round(since)} mi since last PM, interval ${pmIntervalMiles} mi).`,
        details: { since, pmIntervalMiles, lastPm: lastPm.miles, samOdo },
        dedupeKey: `OD2soon:${u}:${Math.floor(samOdo / 5000)}`
      });
    }
  }

  // OD3 MPG anomaly (30d)
  const gal30 = fuelGallonsBetween(erp, u, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  if (tripMiles30d > 100 && gal30 > 5) {
    const mpg = tripMiles30d / gal30;
    if (mpg < 4 || mpg > 12) {
      alerts.push({
        unitId: u,
        type: 'OD3',
        severity: 'AMBER',
        message: `Unit ${u} shows ${mpg.toFixed(2)} MPG based on Samsara miles and ERP fuel records. This is outside the normal range (4–12 MPG). Check for missing fuel records or odometer errors.`,
        details: { mpg, tripMiles30d, gal30 },
        dedupeKey: `OD3:${u}:${Math.floor(tripMiles30d / 200)}`
      });
    }
  }

  // EH1 miles per engine hour
  if (engineHoursDelta30d > 1 && tripMiles30d > 50) {
    const mph = tripMiles30d / (engineHoursDelta30d / 3600);
    if (mph < 20) {
      alerts.push({
        unitId: u,
        type: 'EH1',
        severity: 'AMBER',
        message: `Unit ${u} is averaging ${mph.toFixed(1)} miles per engine hour in the last 30 days. This may indicate excessive idle time affecting fuel efficiency.`,
        details: { mph, tripMiles30d, engineHoursDelta30d },
        dedupeKey: `EH1:${u}`
      });
    }
  }

  // IT1 idle %
  if (idleEngineSeconds30d > 3600 && engineHoursDelta30d > 3600) {
    const idlePct = (idleEngineSeconds30d / engineHoursDelta30d) * 100;
    if (idlePct > 30) {
      alerts.push({
        unitId: u,
        type: 'IT1',
        severity: 'AMBER',
        message: `Unit ${u} has ${idlePct.toFixed(0)}% idle time in the last 30 days. Excessive idling wastes fuel and increases wear.`,
        details: { idlePct, idleEngineSeconds30d, engineHoursDelta30d },
        dedupeKey: `IT1:${u}`
      });
    }
  }

  // IT2 idle + fuel
  if (fleetFuelRatios && typeof fleetFuelRatios === 'object') {
    const ratio = fleetFuelRatios[u];
    if (ratio > 1.25 && idleEngineSeconds30d / Math.max(engineHoursDelta30d, 1) > 0.25) {
      alerts.push({
        unitId: u,
        type: 'IT2',
        severity: 'RED',
        message: `Unit ${u} shows both high idle time and above-average fuel consumption. Idling is likely a significant fuel cost driver.`,
        details: { ratio },
        dedupeKey: `IT2:${u}`
      });
    }
  }

  // VU1 no movement + in service
  const st = String(assetStatus || '').toLowerCase();
  const move7 = tripMiles7d != null ? Number(tripMiles7d) : (tripMiles30d * 7) / 30;
  if (st === 'in_service' && move7 < 5) {
    alerts.push({
      unitId: u,
      type: 'VU1',
      severity: 'AMBER',
      message: `Unit ${u} shows no GPS movement in the last 7 days but is marked in service. Verify the unit status and Samsara GPS connection.`,
      details: { tripMiles7d: move7 },
      dedupeKey: `VU1:${u}`
    });
  }

  // FC1 faults + no WO
  if (Array.isArray(faultCodes) && faultCodes.length) {
    const woFault = recentWorkOrderForFault(erp, u, 7);
    if (!woFault) {
      const crit = faultCodes.some(f => /engine|brake|egr|def|aftertreatment/i.test(`${f.code} ${f.description}`));
      alerts.push({
        unitId: u,
        type: 'FC1',
        severity: crit ? 'RED' : 'AMBER',
        message: `Unit ${u} has ${faultCodes.length} active fault code(s) from Samsara with no corresponding work order in the last 7 days: ${faultCodes
          .slice(0, 6)
          .map(f => f.code)
          .join(', ')}. Create a work order to address these codes.`,
        details: { faultCodes: faultCodes.slice(0, 12) },
        dedupeKey: `FC1:${u}:${faultCodes.map(f => f.code).join('|').slice(0, 120)}`
      });
    }
  }

  // MR1 miles no fuel (7d window approximated with tripMiles7d param if passed — here use 7d fraction of 30d)
  const miles7 = tripMiles7d != null ? Number(tripMiles7d) : tripMiles30d * (7 / 30);
  const gal7 = fuelGallonsBetween(erp, u, new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  if (miles7 > 500 && gal7 < 1) {
    alerts.push({
      unitId: u,
      type: 'MR1',
      severity: 'AMBER',
      message: `Unit ${u} drove about ${Math.round(miles7)} miles in a week with no fuel record in the ERP. Fuel expense records may be missing.`,
      details: { miles7, gal7 },
      dedupeKey: `MR1:${u}`
    });
  }

  // MR2
  const unposted = workOrdersUnpostedOlderThanDays(erp, u, 7);
  if (unposted.length) {
    alerts.push({
      unitId: u,
      type: 'MR2',
      severity: 'AMBER',
      message: `Unit ${u} has ${unposted.length} work order(s) saved but not posted to QuickBooks, oldest from ${unposted[unposted.length - 1]?.date || ''}. Post these to keep accounting current.`,
      details: { count: unposted.length, samples: unposted.slice(0, 5) },
      dedupeKey: `MR2:${u}:${unposted.length}`
    });
  }

  // MR3 inspection
  if (lastInsp) {
    const months = (Date.now() - new Date(`${lastInsp}T12:00:00Z`).getTime()) / (30.44 * 86400000);
    if (months > 11) {
      alerts.push({
        unitId: u,
        type: 'MR3',
        severity: months > 12 ? 'RED' : 'AMBER',
        message: `Unit ${u}'s annual inspection was ${months.toFixed(1)} months ago. Schedule inspection before the 12-month mark.`,
        details: { lastInsp, months },
        dedupeKey: `MR3:${u}:${lastInsp.slice(0, 7)}`
      });
    }
  }

  // DB1 vs fleet avg
  if (fleetAvgSafety && safetyCounts) {
    for (const k of ['harshBrake', 'harshAccel', 'speeding', 'distracted', 'collisionRisk']) {
      const v = safetyCounts[k] || 0;
      const avg = fleetAvgSafety[k] || 0.0001;
      if (v > avg * 2 && v >= 3) {
        alerts.push({
          unitId: u,
          type: 'DB1',
          severity: 'AMBER',
          message: `Elevated ${k.replace(/([A-Z])/g, ' $1')} events on unit ${u} (${v} vs fleet avg ~${avg.toFixed(1)}). Review coaching.`,
          details: { key: k, count: v, fleetAvg: avg },
          dedupeKey: `DB1:${u}:${k}`
        });
        break;
      }
    }
  }

  // DB2 top quartile heuristic
  if (fleetRepairCosts30d?.length && repair30 > 0) {
    const sorted = [...fleetRepairCosts30d].sort((a, b) => a - b);
    const q75 = sorted[Math.floor(sorted.length * 0.75)] || 0;
    const sevTotal =
      (safetyCounts?.harshBrake || 0) +
      (safetyCounts?.harshAccel || 0) +
      (safetyCounts?.speeding || 0) +
      (safetyCounts?.collisionRisk || 0);
    if (repair30 >= q75 && sevTotal >= 6) {
      alerts.push({
        unitId: u,
        type: 'DB2',
        severity: 'RED',
        message: `Unit ${u} is in the top quartile of both safety events and repair costs. Driver behavior may be contributing to repair frequency.`,
        details: { repair30, q75, sevTotal },
        dedupeKey: `DB2:${u}`
      });
    }
  }

  // VU3 dispatch vs Samsara driver name (fuzzy)
  const tmsD = String(tmsDispatchDriverName || '').trim().toLowerCase();
  const samD = String(samsaraDriverName || '').trim().toLowerCase();
  if (tmsD && samD && !tmsD.includes(samD.split(' ')[0]) && !samD.includes(tmsD.split(' ')[0])) {
    alerts.push({
      unitId: u,
      type: 'VU3',
      severity: 'AMBER',
      message: `Samsara shows "${samsaraDriverName}" on unit ${u} but ERP dispatch shows "${tmsDispatchDriverName}". Verify the correct driver assignment.`,
      details: { tmsDispatchDriverName, samsaraDriverName },
      dedupeKey: `VU3:${u}`
    });
  }

  return { alerts, meta: { lastWo, lastPm, lastFuel, lastInsp, repair30 } };
}

export function computeVehicleIntegrityScore({ redCount, amberCount, overduePm, overdueInspection, missingHints }) {
  let score = 100;
  score -= redCount * 15;
  score -= amberCount * 5;
  score -= (missingHints || 0) * 10;
  if (overduePm) score -= 20;
  if (overdueInspection) score -= 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}
