/**
 * Per-vehicle integrity checks (Samsara + ERP cross-reference).
 * Codes: OD*, EH*, FC*, DB*, IT*, VU*, MR*
 */

function milesFromMeters(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 0.000621371 * 10) / 10;
}

function fleetAvgSafetyPerUnit(unitsObj) {
  const units = Object.values(unitsObj || {}).filter((u) => u && !u.error);
  if (!units.length) return 0;
  let s = 0;
  for (const u of units) {
    const n = Number(u.safetyEventsCount || 0);
    if (Number.isFinite(n)) s += n;
  }
  return s / units.length;
}

function fleetAvgTripMiles90(unitsObj) {
  const units = Object.values(unitsObj || {}).filter((u) => u && !u.error);
  if (!units.length) return 1;
  let s = 0;
  for (const u of units) s += Number(u.tripMiles90d || 0);
  return s / units.length || 1;
}

function repairCost90d(erp, unit) {
  const u = String(unit || '').trim();
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  let sum = 0;
  for (const w of erp.workOrders || []) {
    if (String(w.unit || '').trim() !== u) continue;
    const d = String(w.serviceDate || '').slice(0, 10);
    if (!d || d < cutoff) continue;
    sum += Number(w.amount || 0);
  }
  return sum;
}

function wosLast7d(erp, unit) {
  const u = String(unit || '').trim();
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return (erp.workOrders || []).filter((w) => {
    if (String(w.unit || '').trim() !== u) return false;
    const d = String(w.serviceDate || '').slice(0, 10);
    return d && d >= cutoff;
  });
}

function unpostedQboWos(erp, unit, days) {
  const u = String(unit || '').trim();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return (erp.workOrders || []).filter((w) => {
    if (String(w.unit || '').trim() !== u) return false;
    const d = String(w.savedAt || w.serviceDate || '').slice(0, 10);
    const st = String(w.qboSyncStatus || '').toLowerCase();
    return d && d < cutoff && st !== 'synced' && st !== 'posted';
  });
}

function lastPmMiles(erp, unit) {
  const u = String(unit || '').trim();
  let best = null;
  for (const w of erp.workOrders || []) {
    if (String(w.unit || '').trim() !== u) continue;
    if (!/pm|preventive|lube/i.test(String(w.serviceType || ''))) continue;
    const m = Number(w.serviceMileage);
    if (!Number.isFinite(m)) continue;
    if (best == null || m > best) best = m;
  }
  return best;
}

export function runVehicleIntegrityChecks(fleetData, erp) {
  const units = fleetData?.units || {};
  const fleetSafetyAvg = fleetAvgSafetyPerUnit(units);
  const fleetTripAvg = fleetAvgTripMiles90(units);
  const out = {};

  for (const [unitName, u] of Object.entries(units)) {
    if (!u || u.error) continue;
    const alerts = [];
    const name = u.unitName || unitName;

    const erpOdo = erp.unitOdometerErp?.[name];
    const samMi = u.odometerMilesSamsara;
    if (erpOdo != null && samMi != null) {
      const gap = Math.abs(Number(erpOdo) - Number(samMi));
      if (gap > 5000) {
        alerts.push({
          code: 'OD1',
          severity: 'amber',
          title: 'ERP vs Samsara odometer gap',
          detail: `${gap.toFixed(0)} mi apart (threshold 5000)`,
        });
      }
    }

    const pm = lastPmMiles(erp, name);
    const curMi = samMi ?? milesFromMeters(u.odometerHistory90d?.at(-1)?.meters);
    if (pm != null && curMi != null && curMi - pm > 25000) {
      alerts.push({
        code: 'OD2',
        severity: 'red',
        title: 'PM overdue by Samsara miles',
        detail: `~${(curMi - pm).toFixed(0)} mi since last PM mileage`,
      });
    }

    const gal = (erp.fuelPurchases || [])
      .filter((p) => String(p.unit || '').trim() === name)
      .reduce((s, p) => s + (Number(p.gallons) || 0), 0);
    const mpg = gal > 0.5 && u.tripMiles90d > 10 ? u.tripMiles90d / gal : null;
    if (mpg != null && (mpg < 4 || mpg > 12)) {
      alerts.push({
        code: 'OD3',
        severity: 'amber',
        title: 'Implausible MPG',
        detail: `${mpg.toFixed(1)} MPG (expected 4–12 demo window)`,
      });
    }

    const mph = u.tripMiles90d / Math.max(u.engineHoursDelta90d || 0.01, 0.01);
    if (mph < 8 && u.engineHoursDelta90d > 20) {
      alerts.push({
        code: 'EH1',
        severity: 'amber',
        title: 'Low miles per engine hour (idle-heavy)',
        detail: `${mph.toFixed(1)} mi/engine-hr over 90d`,
      });
    }

    const faults = u.faultCodes || [];
    if (faults.length && !wosLast7d(erp, name).length) {
      alerts.push({
        code: 'FC1',
        severity: 'red',
        title: 'Active fault codes without WO (7d)',
        detail: faults.map((f) => f.code).join(', '),
      });
    }
    const codes = faults.map((f) => String(f.code || '')).filter(Boolean);
    const freq = {};
    for (const c of codes) freq[c] = (freq[c] || 0) + 1;
    if (Object.values(freq).some((n) => n >= 3)) {
      alerts.push({
        code: 'FC2',
        severity: 'amber',
        title: 'Recurring fault codes (snapshot)',
        detail: JSON.stringify(freq),
      });
    }

    const evc = Number(u.safetyEventsCount || 0);
    if (fleetSafetyAvg > 0 && evc > fleetSafetyAvg * 2) {
      alerts.push({
        code: 'DB1',
        severity: 'amber',
        title: 'Safety events >2× fleet average',
        detail: `${evc} vs avg ${fleetSafetyAvg.toFixed(1)}`,
      });
    }
    const rc = repairCost90d(erp, name);
    if (evc >= 5 && rc > 8000) {
      alerts.push({
        code: 'DB2',
        severity: 'amber',
        title: 'High events + high repair cost',
        detail: `Events ${evc}, repair 90d $${rc}`,
      });
    }
    const fuelCost = (erp.fuelPurchases || [])
      .filter((p) => String(p.unit || '').trim() === name)
      .reduce((s, p) => s + (Number(p.totalCost) || 0), 0);
    const speeding = u.safetyLocal?.speeding || 0;
    if (speeding >= 3 && fuelCost > 4000) {
      alerts.push({
        code: 'DB3',
        severity: 'amber',
        title: 'Speeding + fuel cost correlation',
        detail: `${speeding} speeding events, fuel $${fuelCost}`,
      });
    }

    if (u.idlePercent90d > 30) {
      alerts.push({
        code: 'IT1',
        severity: 'amber',
        title: '>30% idle time (90d)',
        detail: `${u.idlePercent90d.toFixed(1)}%`,
      });
    }
    if (u.idlePercent90d > 45 && fuelCost > 6000) {
      alerts.push({
        code: 'IT2',
        severity: 'red',
        title: 'High idle + high fuel (escalated)',
        detail: `Idle ${u.idlePercent90d.toFixed(1)}%, fuel $${fuelCost}`,
      });
    }

    if (String(erp.dispatchStatus?.[name] || '') === 'In service' && u.tripMiles90d < 5 && u.engineHoursDelta90d > 30) {
      alerts.push({
        code: 'VU1',
        severity: 'amber',
        title: 'No GPS movement pattern vs in service',
        detail: 'Very low trip miles with high engine hours',
      });
    }
    if (u.unassignedTripMiles90d > 500) {
      alerts.push({
        code: 'VU2',
        severity: 'amber',
        title: 'Unassigned driving miles',
        detail: `${u.unassignedTripMiles90d.toFixed(0)} mi unassigned`,
      });
    }
    const topD = u.safetyLocal?.topDriver || '';
    const erpD = erp.erpDriverByUnit?.[name] || '';
    if (topD && erpD && topD !== erpD && topD !== 'Unknown') {
      alerts.push({
        code: 'VU3',
        severity: 'amber',
        title: 'Samsara driver ≠ ERP driver',
        detail: `Samsara: ${topD} · ERP: ${erpD}`,
      });
    }

    if (u.maxRolling7dMilesWithoutFuel > 800) {
      alerts.push({
        code: 'MR1',
        severity: 'amber',
        title: 'Miles with no fuel record',
        detail: `7d rolling gap ~${u.maxRolling7dMilesWithoutFuel.toFixed(0)} mi`,
      });
    }
    const stale = unpostedQboWos(erp, name, 7);
    if (stale.length) {
      alerts.push({
        code: 'MR2',
        severity: 'amber',
        title: 'WOs not posted to QBO >7 days',
        detail: `${stale.length} open`,
      });
    }
    const lastInsp = (erp.workOrders || [])
      .filter((w) => String(w.unit || '').trim() === name && /annual.*inspection|dot inspection/i.test(String(w.serviceType || '')))
      .map((w) => String(w.serviceDate || '').slice(0, 10))
      .sort()
      .pop();
    if (lastInsp) {
      const days = (Date.now() - new Date(lastInsp).getTime()) / 86400000;
      if (days > 365) {
        alerts.push({
          code: 'MR3',
          severity: 'red',
          title: 'Inspection overdue',
          detail: `Last annual ${lastInsp}`,
        });
      }
    }

    let score = 100;
    for (const a of alerts) {
      score -= a.severity === 'red' ? 15 : 6;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    let band = 'GOOD';
    if (score < 55) band = 'CRITICAL';
    else if (score < 75) band = 'ATTENTION';
    else if (score < 90) band = 'REVIEW';

    out[name] = { score, band, alerts, bundle: u };
  }
  return { vehicles: out, fleetSafetyAvg, fleetTripAvg90: fleetTripAvg };
}

export function scoreToGauge(score) {
  return { score, pct: score };
}
