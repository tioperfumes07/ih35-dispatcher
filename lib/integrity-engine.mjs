/**
 * Read-only integrity / anomaly evaluation against ERP JSON.
 * Persistence and HTTP live in server.js.
 */

export function defaultIntegrityThresholds() {
  return {
    maxTiresPerUnit90d: 8,
    maxSameTirePosition180d: 3,
    tireCostAnomalyMult: 2.5,
    maxFleetTiresPerMonth: 20,
    maxRepairsPerDriver90d: 3,
    maxAccidentsPerDriver12mo: 2,
    maxRepairCostDriver90d: 5000,
    maxRepairsSameDriverUnit60d: 2,
    fuelConsumptionIncreasePct: 30,
    unusualGallonsMult: 2,
    fuelPriceSpikePct: 20,
    serviceCostAnomalyMult: 3,
    maxMonthlyCostPerUnit: 4000,
    maxServiceRecordsPerUnit60d: 6,
    vendorInvoiceIncreasePct: 40,
    accidentQuarterlyCostUsd: 15000,
    accidentQuarterlyCostYoYPct: 50
  };
}

export function mergeIntegrityThresholds(erp) {
  const d = defaultIntegrityThresholds();
  const raw = erp && erp.integrityThresholds && typeof erp.integrityThresholds === 'object' ? erp.integrityThresholds : {};
  const out = { ...d };
  for (const k of Object.keys(d)) {
    if (raw[k] == null || raw[k] === '') continue;
    const n = Number(raw[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

function cmpDate(a, b) {
  const x = sliceD(a);
  const y = sliceD(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

function addDays(iso, days) {
  const d = new Date(`${sliceD(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inRange(iso, fromIso, toIso) {
  const d = sliceD(iso);
  if (!d) return false;
  if (fromIso && cmpDate(d, fromIso) < 0) return false;
  if (toIso && cmpDate(d, toIso) > 0) return false;
  return true;
}

function monthStart(iso) {
  const d = sliceD(iso);
  if (d.length < 7) return '';
  return d.slice(0, 7) + '-01';
}

function quarterBounds(iso) {
  const d = sliceD(iso);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) || 1;
  const q = Math.floor((m - 1) / 3);
  const startM = q * 3 + 1;
  const endM = startM + 2;
  const pad = n => String(n).padStart(2, '0');
  const start = `${y}-${pad(startM)}-01`;
  const endDay = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  const end = `${y}-${pad(endM)}-${String(endDay).padStart(2, '0')}`;
  return { start, end, q, y };
}

function prevYearQuarterBounds(iso) {
  const { start, end, q } = quarterBounds(iso);
  const y = Number(start.slice(0, 4)) - 1;
  const pad = n => String(n).padStart(2, '0');
  const startM = q * 3 + 1;
  const endM = startM + 2;
  const start2 = `${y}-${pad(startM)}-01`;
  const endDay = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  const end2 = `${y}-${pad(endM)}-${String(endDay).padStart(2, '0')}`;
  return { start: start2, end: end2 };
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function driverNameFromErp(erp, driverId) {
  const id = String(driverId || '').trim();
  if (!id) return '';
  const p = (erp.driverProfiles || []).find(d => String(d.id) === id);
  return p ? String(p.name || '').trim() : '';
}

function isPmLike(serviceType, recordType) {
  const s = String(serviceType || '').toLowerCase();
  const r = String(recordType || '').toLowerCase();
  if (r === 'pm') return true;
  return /pm\b|preventive|oil change|lube|grease/i.test(s);
}

function isTireLine(line) {
  if (!line || typeof line !== 'object') return false;
  const pos = String(line.tirePosition || line.partPosition || '').trim();
  if (pos) return true;
  const st = String(line.serviceType || '').toLowerCase();
  const pc = String(line.partCategory || '').toLowerCase();
  return st.includes('tire') || pc.includes('tire');
}

function woTotal(w) {
  const lines = w.lines || [];
  return lines.reduce((s, l) => s + money(l.amount), 0);
}

function recordCost(r) {
  return money(r.cost);
}

function isTireMaintenanceRecord(r) {
  return String(r.recordType || '').trim() === 'tire';
}

function isRepairMaintenanceRecord(r) {
  return String(r.recordType || '').trim() === 'repair';
}

function isAccidentMaintenanceRecord(r) {
  return String(r.recordType || '').trim() === 'accident';
}

function isTireWorkOrder(ctx, wo) {
  const mt = String(ctx.maintRecordType || wo?.maintRecordType || '').toLowerCase();
  if (mt === 'tire') return true;
  const lines = wo?.lines || ctx.lines || [];
  return Array.isArray(lines) && lines.some(isTireLine);
}

function isRepairWorkOrder(ctx) {
  const mt = String(ctx.maintRecordType || '').toLowerCase();
  if (mt === 'repair') return true;
  const st = String(ctx.serviceType || '').toLowerCase();
  return st.includes('repair') && !isPmLike(ctx.serviceType, '');
}

function isAccidentWorkOrder(ctx) {
  const mt = String(ctx.maintRecordType || '').toLowerCase();
  if (mt === 'accident') return true;
  const st = String(ctx.serviceType || '').toLowerCase();
  return st.includes('accident') || st.includes('collision');
}

function collectTireEvents(erp, unit, fromIso, toIso) {
  const events = [];
  for (const r of erp.records || []) {
    if (String(r.unit || '').trim() !== unit) continue;
    if (!isTireMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    events.push({
      kind: 'record',
      id: r.id,
      date: sliceD(r.serviceDate),
      position: String(r.tirePositionText || r.tirePosition || '').trim() || '—',
      cost: recordCost(r),
      serviceType: r.serviceType
    });
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.unit || '').trim() !== unit) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    const lines = w.lines || [];
    for (const ln of lines) {
      if (!isTireLine(ln)) continue;
      events.push({
        kind: 'wo_line',
        id: w.id,
        lineId: ln.id,
        date: sliceD(w.serviceDate),
        position: String(ln.tirePositionText || ln.tirePosition || ln.partPosition || '').trim() || '—',
        cost: money(ln.amount),
        serviceType: ln.serviceType || w.serviceType
      });
    }
  }
  return events;
}

function erpActiveWos(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

function fleetTireCosts12m(erp, asOfIso) {
  const from = addDays(asOfIso, -365);
  const costs = [];
  for (const r of erp.records || []) {
    if (!isTireMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, from, asOfIso)) continue;
    const c = recordCost(r);
    if (c > 0) costs.push(c);
  }
  for (const w of erpActiveWos(erp)) {
    if (!inRange(w.serviceDate, from, asOfIso)) continue;
    for (const ln of w.lines || []) {
      if (!isTireLine(ln)) continue;
      const c = money(ln.amount);
      if (c > 0) costs.push(c);
    }
  }
  return costs;
}

function countFleetTiresMonth(erp, monthPrefix) {
  let n = 0;
  for (const r of erp.records || []) {
    if (!isTireMaintenanceRecord(r)) continue;
    if (!String(r.serviceDate || '').startsWith(monthPrefix)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (!String(w.serviceDate || '').startsWith(monthPrefix)) continue;
    for (const ln of w.lines || []) {
      if (isTireLine(ln)) n += 1;
    }
  }
  return n;
}

function sumAccidentCosts(erp, fromIso, toIso) {
  let s = 0;
  for (const r of erp.records || []) {
    if (!isAccidentMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    s += recordCost(r);
  }
  for (const w of erpActiveWos(erp)) {
    if (!isAccidentWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    s += woTotal(w);
  }
  return s;
}

function countRepairsForDriver(erp, driverId, fromIso, toIso) {
  const id = String(driverId || '').trim();
  if (!id) return 0;
  let n = 0;
  for (const r of erp.records || []) {
    if (String(r.driverId || '').trim() !== id) continue;
    if (!isRepairMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.driverId || '').trim() !== id) continue;
    if (!isRepairWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  return n;
}

function countAccidentsForDriver(erp, driverId, fromIso, toIso) {
  const id = String(driverId || '').trim();
  if (!id) return 0;
  let n = 0;
  for (const r of erp.records || []) {
    if (String(r.driverId || '').trim() !== id) continue;
    if (!isAccidentMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.driverId || '').trim() !== id) continue;
    if (!isAccidentWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  return n;
}

function sumRepairCostsForDriver(erp, driverId, fromIso, toIso) {
  const id = String(driverId || '').trim();
  if (!id) return 0;
  let s = 0;
  for (const r of erp.records || []) {
    if (String(r.driverId || '').trim() !== id) continue;
    if (!isRepairMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    s += recordCost(r);
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.driverId || '').trim() !== id) continue;
    if (!isRepairWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    s += woTotal(w);
  }
  return s;
}

function countRepairsDriverUnit(erp, driverId, unit, fromIso, toIso) {
  const id = String(driverId || '').trim();
  const u = String(unit || '').trim();
  if (!id || !u) return 0;
  let n = 0;
  for (const r of erp.records || []) {
    if (String(r.driverId || '').trim() !== id) continue;
    if (String(r.unit || '').trim() !== u) continue;
    if (!isRepairMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.driverId || '').trim() !== id) continue;
    if (String(w.unit || '').trim() !== u) continue;
    if (!isRepairWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  return n;
}

function countAccidentsForUnit(erp, unit, fromIso, toIso) {
  const u = String(unit || '').trim();
  let n = 0;
  for (const r of erp.records || []) {
    if (String(r.unit || '').trim() !== u) continue;
    if (!isAccidentMaintenanceRecord(r)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    if (!isAccidentWorkOrder({ maintRecordType: w.maintRecordType, serviceType: w.serviceType })) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  return n;
}

function avgForServiceType(erp, serviceType, fromIso, toIso) {
  const key = String(serviceType || '').trim().toLowerCase();
  if (!key) return null;
  const vals = [];
  for (const r of erp.records || []) {
    if (String(r.serviceType || '').trim().toLowerCase() !== key) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    const c = recordCost(r);
    if (c > 0) vals.push(c);
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.serviceType || '').trim().toLowerCase() !== key) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    const t = woTotal(w);
    if (t > 0) vals.push(t);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function vendorAvgForService(erp, vendorNorm, serviceType, fromIso, toIso) {
  const st = String(serviceType || '').trim().toLowerCase();
  const vn = String(vendorNorm || '').trim().toLowerCase();
  if (!vn || !st) return null;
  const vals = [];
  for (const r of erp.records || []) {
    if (String(r.serviceType || '').trim().toLowerCase() !== st) continue;
    if (String(r.vendor || '').trim().toLowerCase() !== vn) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    const c = recordCost(r);
    if (c > 0) vals.push(c);
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.serviceType || '').trim().toLowerCase() !== st) continue;
    if (String(w.vendor || '').trim().toLowerCase() !== vn) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    const t = woTotal(w);
    if (t > 0) vals.push(t);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function countNonPmServicesUnit(erp, unit, fromIso, toIso) {
  const u = String(unit || '').trim();
  let n = 0;
  for (const r of erp.records || []) {
    if (String(r.unit || '').trim() !== u) continue;
    if (isPmLike(r.serviceType, r.recordType)) continue;
    if (!inRange(r.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    if (isPmLike(w.serviceType, w.maintRecordType)) continue;
    if (!inRange(w.serviceDate, fromIso, toIso)) continue;
    n += 1;
  }
  return n;
}

function sumMonthlyMaintenanceUnit(erp, unit, monthPrefix) {
  const u = String(unit || '').trim();
  let s = 0;
  for (const r of erp.records || []) {
    if (String(r.unit || '').trim() !== u) continue;
    if (!String(r.serviceDate || '').startsWith(monthPrefix)) continue;
    s += recordCost(r);
  }
  for (const w of erpActiveWos(erp)) {
    if (String(w.unit || '').trim() !== u) continue;
    if (!String(w.serviceDate || '').startsWith(monthPrefix)) continue;
    s += woTotal(w);
  }
  return s;
}

function fuelRowsForUnit(erp, unit, fromIso, toIso) {
  const u = String(unit || '').trim();
  return (erp.fuelPurchases || []).filter(
    p => String(p.unit || '').trim() === u && inRange(p.txnDate, fromIso, toIso)
  );
}

function fuelRowsForDriver(erp, driverId, fromIso, toIso) {
  const id = String(driverId || '').trim();
  return (erp.fuelPurchases || []).filter(
    p => String(p.driverId || '').trim() === id && inRange(p.txnDate, fromIso, toIso)
  );
}

function avgPpgFleet30d(erp, asOfIso) {
  const from = addDays(asOfIso, -30);
  const ppgs = [];
  for (const p of erp.fuelPurchases || []) {
    if (!inRange(p.txnDate, from, asOfIso)) continue;
    const g = Number(p.gallons);
    const t = money(p.totalCost);
    const pp = Number(p.pricePerGallon);
    let ppg = Number.isFinite(pp) && pp > 0 ? pp : null;
    if (ppg == null && Number.isFinite(g) && g > 0 && t > 0) ppg = t / g;
    if (ppg != null && ppg > 0) ppgs.push(ppg);
  }
  if (!ppgs.length) return null;
  return ppgs.reduce((a, b) => a + b, 0) / ppgs.length;
}

/**
 * @param {object} ctx — normalized save context from API
 * @param {object} erp — full ERP JSON
 * @returns {{ alerts: object[] }}
 */
export function evaluateIntegrityCheck(ctx, erp) {
  const th = mergeIntegrityThresholds(erp);
  const alerts = [];
  const rt = String(ctx.recordType || '').trim();
  const unit = String(ctx.unitId || ctx.unit || '').trim();
  const refDate = sliceD(ctx.date || ctx.serviceDate || new Date().toISOString());
  const driverId = String(ctx.driverId || '').trim();
  const driverName = String(ctx.driverName || '').trim() || driverNameFromErp(erp, driverId);
  const amt = money(ctx.amount);
  const serviceType = String(ctx.serviceType || '').trim();
  const recordSubtype = String(ctx.recordSubtype || ctx.maintRecordType || '').trim().toLowerCase();
  const fleetAvgMilesPerMonth =
    Number(ctx.fleetAvgMilesPerMonth) > 0 ? Number(ctx.fleetAvgMilesPerMonth) : null;

  const push = (type, severity, message, details, dedupeKey) => {
    alerts.push({
      type,
      severity,
      message,
      details: details || {},
      dedupeKey: String(dedupeKey || `${type}:${ctx.recordId || 'new'}:${refDate}`)
    });
  };

  try {
    if (rt === 'fuel_purchase') {
      const gal = Number(ctx.gallons);
      const ppg = Number(ctx.pricePerGallon);
      const total = money(ctx.totalCost);
      const effPpg =
        Number.isFinite(ppg) && ppg > 0 ? ppg : Number.isFinite(gal) && gal > 0 && total > 0 ? total / gal : NaN;

      if (unit) {
        const d30 = addDays(refDate, -30);
        const d90 = addDays(refDate, -90);
        const rows30 = fuelRowsForUnit(erp, unit, d30, refDate);
        const sum30 = rows30.reduce((s, p) => s + (Number(p.gallons) || 0), 0);
        const rows90 = fuelRowsForUnit(erp, unit, d90, refDate);
        const sum90 = rows90.reduce((s, p) => s + (Number(p.gallons) || 0), 0);
        const avgDaily90 = sum90 > 0 ? sum90 / 90 : 0;
        const expected30 = avgDaily90 * 30;
        if (expected30 > 0 && sum30 > expected30 * (1 + th.fuelConsumptionIncreasePct / 100)) {
          const pct = Math.round(((sum30 / expected30 - 1) * 100 + Number.EPSILON) * 10) / 10;
          push(
            'F1',
            'AMBER',
            `Unit ${unit} has consumed ${sum30.toFixed(1)} gallons this month, which is ${pct}% above its 90-day average. Check for fuel leaks, idle time, or unauthorized fuel use.`,
            { unit, sum30, expected30, thresholdPct: th.fuelConsumptionIncreasePct },
            `F1:${unit}:${monthStart(refDate)}`
          );
        }

        const fills = fuelRowsForUnit(erp, unit, addDays(refDate, -90), refDate).filter(
          p => Number(p.gallons) > 0
        );
        const avgGal =
          fills.length > 0
            ? fills.reduce((s, p) => s + (Number(p.gallons) || 0), 0) / fills.length
            : 0;
        if (Number.isFinite(gal) && gal > 0 && avgGal > 0 && gal > avgGal * th.unusualGallonsMult) {
          push(
            'F3',
            'AMBER',
            `This fuel transaction (${gal} gal) is significantly above the average fill for unit ${unit} (${avgGal.toFixed(1)} gal). Verify this is correct.`,
            { unit, gallons: gal, avgGallons: avgGal },
            `F3:${ctx.recordId || unit + ':' + refDate}`
          );
        }

        const sameDay = (erp.fuelPurchases || []).filter(
          p => String(p.unit || '').trim() === unit && sliceD(p.txnDate) === refDate
        );
        if (sameDay.length >= 2) {
          push(
            'F5',
            'AMBER',
            `Unit ${unit} already has a fuel record for today. Is this a duplicate entry or a second fuel stop?`,
            { unit, date: refDate, count: sameDay.length },
            `F5:${unit}:${refDate}`
          );
        }
      }

      if (driverId) {
        const d30 = addDays(refDate, -30);
        const d90 = addDays(refDate, -90);
        const r30 = fuelRowsForDriver(erp, driverId, d30, refDate);
        const sum30 = r30.reduce((s, p) => s + (Number(p.gallons) || 0), 0);
        const r90 = fuelRowsForDriver(erp, driverId, d90, refDate);
        const sum90 = r90.reduce((s, p) => s + (Number(p.gallons) || 0), 0);
        const avgDaily90 = sum90 > 0 ? sum90 / 90 : 0;
        const expected30 = avgDaily90 * 30;
        if (expected30 > 0 && sum30 > expected30 * (1 + th.fuelConsumptionIncreasePct / 100)) {
          const pct = Math.round(((sum30 / expected30 - 1) * 100 + Number.EPSILON) * 10) / 10;
          push(
            'F2',
            'AMBER',
            `Driver ${driverName || driverId} has used ${sum30.toFixed(1)} gallons this month, which is ${pct}% above their average. Review route and driving behavior.`,
            { driverId, driverName, sum30, expected30 },
            `F2:${driverId}:${monthStart(refDate)}`
          );
        }
      }

      const fleetPpg = avgPpgFleet30d(erp, refDate);
      if (Number.isFinite(effPpg) && effPpg > 0 && fleetPpg != null && effPpg > fleetPpg * (1 + th.fuelPriceSpikePct / 100)) {
        push(
          'F4',
          'AMBER',
          `This fuel transaction ($${effPpg.toFixed(3)}/gal) is above the recent average ($${fleetPpg.toFixed(3)}/gal). Verify the price is correct and not a data entry error.`,
          { pricePerGallon: effPpg, fleetAvgPpg: fleetPpg },
          `F4:${ctx.recordId || refDate}`
        );
      }
    }

    const runTire =
      recordSubtype === 'tire' ||
      (rt === 'work_order' && isTireWorkOrder(ctx, { lines: ctx.lines || [], maintRecordType: ctx.maintRecordType }));
    const runAccident =
      recordSubtype === 'accident' || (rt === 'work_order' && isAccidentWorkOrder(ctx));
    const runRepairDriver =
      driverId && (recordSubtype === 'repair' || (rt === 'work_order' && isRepairWorkOrder(ctx)));

    if (runTire && unit) {
      const from90 = addDays(refDate, -90);
      const ev = collectTireEvents(erp, unit, from90, refDate);
      if (ev.length > th.maxTiresPerUnit90d) {
        push(
          'T1',
          'AMBER',
          `Unit ${unit} has had ${ev.length} tires replaced in the last 90 days. This is above the normal threshold of ${th.maxTiresPerUnit90d}. Review tire condition and driver behavior.`,
          { unit, count: ev.length, threshold: th.maxTiresPerUnit90d },
          `T1:${unit}:${from90}:${refDate}`
        );
      }

      const from180 = addDays(refDate, -180);
      const ev180 = collectTireEvents(erp, unit, from180, refDate);
      const posKey = String(ctx.tirePositionText || ctx.tirePosition || '').trim() || '—';
      const samePos = ev180.filter(e => e.position === posKey);
      if (posKey && samePos.length >= th.maxSameTirePosition180d) {
        push(
          'T2',
          'RED',
          `Position ${posKey} on unit ${unit} has been replaced ${samePos.length} times in 6 months. This may indicate a recurring mechanical issue (wheel end, alignment, suspension).`,
          { unit, position: posKey, count: samePos.length, threshold: th.maxSameTirePosition180d },
          `T2:${unit}:${posKey}`
        );
      }

      const tireCosts = fleetTireCosts12m(erp, refDate);
      if (tireCosts.length && amt > 0) {
        const avg = tireCosts.reduce((a, b) => a + b, 0) / tireCosts.length;
        if (avg > 0 && amt > avg * th.tireCostAnomalyMult) {
          push(
            'T3',
            'AMBER',
            `This tire replacement ($${amt.toFixed(2)}) is significantly above the fleet average ($${avg.toFixed(2)}). Verify the invoice amount.`,
            { amount: amt, fleetAvg: avg },
            `T3:${ctx.recordId || unit}`
          );
        }
      }

      const mp = monthStart(refDate);
      const fleetMonth = countFleetTiresMonth(erp, mp.slice(0, 7));
      if (fleetMonth > th.maxFleetTiresPerMonth) {
        push(
          'T4',
          'AMBER',
          `The fleet has replaced ${fleetMonth} tires this month. This is unusually high. Check road conditions and routes.`,
          { count: fleetMonth, threshold: th.maxFleetTiresPerMonth, month: mp.slice(0, 7) },
          `T4:${mp.slice(0, 7)}`
        );
      }
    }

    if (runRepairDriver) {
      const d90 = addDays(refDate, -90);
      const d60 = addDays(refDate, -60);
      const d365 = addDays(refDate, -365);
      const nRep = countRepairsForDriver(erp, driverId, d90, refDate);
      if (nRep >= th.maxRepairsPerDriver90d) {
        push(
          'D1',
          'AMBER',
          `Driver ${driverName || driverId} has been linked to ${nRep} repair records in the last 90 days. Review driving habits and vehicle condition.`,
          { driverId, driverName, count: nRep, threshold: th.maxRepairsPerDriver90d },
          `D1:${driverId}:${d90}`
        );
      }
      const nAcc = countAccidentsForDriver(erp, driverId, d365, refDate);
      if (nAcc >= th.maxAccidentsPerDriver12mo) {
        push(
          'D2',
          'RED',
          `Driver ${driverName || driverId} has ${nAcc} accidents recorded in the last 12 months. This driver may need safety coaching.`,
          { driverId, driverName, count: nAcc, threshold: th.maxAccidentsPerDriver12mo },
          `D2:${driverId}`
        );
      }
      const costSum = sumRepairCostsForDriver(erp, driverId, d90, refDate);
      if (costSum > th.maxRepairCostDriver90d) {
        push(
          'D3',
          'RED',
          `Driver ${driverName || driverId} has been linked to $${costSum.toFixed(
            2
          )} in repair costs in the last 90 days. Review and investigate.`,
          { driverId, driverName, amount: costSum, threshold: th.maxRepairCostDriver90d },
          `D3:${driverId}:${d90}`
        );
      }
      if (unit) {
        const nDU = countRepairsDriverUnit(erp, driverId, unit, d60, refDate);
        if (nDU >= th.maxRepairsSameDriverUnit60d) {
          push(
            'D4',
            'AMBER',
            `Driver ${driverName || driverId} has had ${nDU} repairs on unit ${unit} in the last 60 days. Investigate potential abuse or mechanical issue with this unit.`,
            { driverId, driverName, unit, count: nDU, threshold: th.maxRepairsSameDriverUnit60d },
            `D4:${driverId}:${unit}`
          );
        }
      }
    }

    if (runAccident && unit) {
      const from180 = addDays(refDate, -180);
      const na = countAccidentsForUnit(erp, unit, from180, refDate);
      if (na >= 2) {
        push(
          'A1',
          'RED',
          `Unit ${unit} has ${na} accident records in the last 6 months. Consider a mechanical inspection and driver review.`,
          { unit, count: na },
          `A1:${unit}`
        );
      }

      const q = quarterBounds(refDate);
      const curQ = sumAccidentCosts(erp, q.start, q.end);
      const pq = prevYearQuarterBounds(refDate);
      const prevQ = sumAccidentCosts(erp, pq.start, pq.end);
      let a2 = false;
      if (curQ > th.accidentQuarterlyCostUsd) a2 = true;
      if (prevQ > 0 && curQ > prevQ * (1 + th.accidentQuarterlyCostYoYPct / 100)) a2 = true;
      if (a2) {
        push(
          'A2',
          'AMBER',
          `Accident repair costs this quarter ($${curQ.toFixed(
            2
          )}) are above the normal threshold. Review safety policies and driver training.`,
          { quarterCost: curQ, priorYearQuarter: prevQ },
          `A2:${q.y}-Q${q.q + 1}`
        );
      }
    }

    if (runAccident && ctx.dotReportable) {
      push(
        'A3',
        'RED',
        'This accident is marked as DOT reportable. Ensure it is recorded in the company accident register within the required timeframe. Review FMCSA 49 CFR 390.15 requirements.',
        { dotReportable: true },
        `A3:${ctx.recordId || 'new'}`
      );
    }

    if (rt === 'maintenance_record' || rt === 'work_order') {
      const from12 = addDays(refDate, -365);
      const avgSt = avgForServiceType(erp, serviceType, from12, refDate);
      if (avgSt != null && amt > 0 && amt > avgSt * th.serviceCostAnomalyMult) {
        push(
          'M1',
          'AMBER',
          `This ${serviceType || 'service'} record ($${amt.toFixed(
            2
          )}) is significantly above the fleet average for this service type ($${avgSt.toFixed(2)} avg). Verify the invoice amount.`,
          { serviceType, amount: amt, fleetAvg: avgSt },
          `M1:${serviceType}:${ctx.recordId}`
        );
      }

      if (unit) {
        const mp = monthStart(refDate);
        const monthCost = sumMonthlyMaintenanceUnit(erp, unit, mp.slice(0, 7));
        if (monthCost > th.maxMonthlyCostPerUnit) {
          const pace =
            fleetAvgMilesPerMonth != null
              ? ` Fleet pace reference: ${fleetAvgMilesPerMonth.toLocaleString('en-US')} mi/truck/mo (from Settings / Postgres).`
              : '';
          push(
            'M2',
            'AMBER',
            `Unit ${unit} has $${monthCost.toFixed(
              2
            )} in maintenance costs this month. This is above the normal threshold. Consider whether this unit needs retirement or major overhaul evaluation.${pace}`,
            { unit, monthCost, threshold: th.maxMonthlyCostPerUnit, fleetAvgMilesPerMonth },
            `M2:${unit}:${mp.slice(0, 7)}`
          );
        }

        const d60 = addDays(refDate, -60);
        const svcCount = countNonPmServicesUnit(erp, unit, d60, refDate);
        if (svcCount >= th.maxServiceRecordsPerUnit60d) {
          const pace60 =
            fleetAvgMilesPerMonth != null
              ? ` At ${fleetAvgMilesPerMonth.toLocaleString('en-US')} mi/mo, 60 days ≈ ${Math.round(
                  (60 / 30.44) * fleetAvgMilesPerMonth
                ).toLocaleString('en-US')} mi — multiple legitimate PM/touch visits can be normal.`
              : '';
          push(
            'M3',
            'AMBER',
            `Unit ${unit} has had ${svcCount} service records in the last 60 days. This unit may have an underlying mechanical issue requiring inspection.${pace60}`,
            { unit, count: svcCount, threshold: th.maxServiceRecordsPerUnit60d, fleetAvgMilesPerMonth },
            `M3:${unit}`
          );
        }

        const vn = String(ctx.vendor || '').trim().toLowerCase();
        const vAvg = vendorAvgForService(erp, vn, serviceType, from12, refDate);
        if (vn && vAvg != null && amt > vAvg * (1 + th.vendorInvoiceIncreasePct / 100)) {
          push(
            'M4',
            'AMBER',
            `This invoice from ${ctx.vendor} ($${amt.toFixed(
              2
            )}) is above their usual amount for ${serviceType} ($${vAvg.toFixed(2)} avg). Verify the invoice before posting to QBO.`,
            { vendor: ctx.vendor, amount: amt, vendorAvg: vAvg, serviceType },
            `M4:${vn}:${serviceType}`
          );
        }
      }
    }
  } catch (_) {
    /* caller returns empty on total failure */
  }

  return { alerts };
}

export function alertCategory(type) {
  const t = String(type || '');
  if (t === 'MAINTENANCE_OVERDUE' || t === 'MAINTENANCE_DUE_SOON') return 'predictive';
  if (/^(OD|EH|FC|IT|VU|MR|DB)/.test(t)) return 'samsara';
  if (t.startsWith('T')) return 'tires';
  if (t.startsWith('D')) return 'drivers';
  if (t.startsWith('A')) return 'accidents';
  if (t.startsWith('F')) return 'fuel';
  if (t.startsWith('M')) return 'maintenance';
  return 'maintenance';
}

/** Stored `category` when present; otherwise derived from `alertType` / `type` (legacy rows). */
export function effectiveIntegrityAlertCategory(alert) {
  const c = String(alert?.category || '').trim().toLowerCase();
  if (c) return c;
  return alertCategory(String(alert?.alertType || alert?.type || ''));
}

/** Newest `triggeredDate` (else `createdAt` day) first; tie-break `createdAt` ISO string descending. */
export function compareIntegrityAlertsDesc(a, b) {
  const da = sliceD(a.triggeredDate || a.createdAt || '');
  const db = sliceD(b.triggeredDate || b.createdAt || '');
  const byTrig = db.localeCompare(da);
  if (byTrig !== 0) return byTrig;
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

export function buildInvestigateRecords(alert, erp) {
  const rows = [];
  const det = alert.details || {};
  const t = String(alert.alertType || alert.type || '');
  try {
    if (t === 'T1' || t === 'T2') {
      const unit = det.unit || alert.unitId;
      const from = addDays(alert.triggeredDate || sliceD(alert.createdAt), -90);
      const ev = collectTireEvents(erp, unit, from, sliceD(alert.triggeredDate));
      for (const e of ev.slice(0, 40)) {
        rows.push({
          date: e.date,
          unit,
          position: e.position,
          part: e.serviceType || '',
          cost: e.cost,
          wo: e.kind === 'wo_line' ? e.id : e.id
        });
      }
    } else if (t.startsWith('D')) {
      const id = alert.driverId || det.driverId;
      const from = addDays(sliceD(alert.triggeredDate), -90);
      for (const r of erp.records || []) {
        if (String(r.driverId || '') !== String(id || '')) continue;
        if (!inRange(r.serviceDate, from, sliceD(alert.triggeredDate))) continue;
        rows.push({
          date: sliceD(r.serviceDate),
          driver: det.driverName || id,
          unit: r.unit,
          type: r.recordType,
          cost: recordCost(r),
          wo: r.id
        });
      }
      for (const w of erpActiveWos(erp)) {
        if (String(w.driverId || '') !== String(id || '')) continue;
        if (!inRange(w.serviceDate, from, sliceD(alert.triggeredDate))) continue;
        rows.push({
          date: sliceD(w.serviceDate),
          driver: det.driverName || id,
          unit: w.unit,
          type: 'work_order',
          cost: woTotal(w),
          wo: w.id
        });
      }
    } else if (t === 'MAINTENANCE_OVERDUE' || t === 'MAINTENANCE_DUE_SOON') {
      for (const [k, v] of Object.entries(det)) {
        if (k === 'dedupeKey') continue;
        const val = v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        rows.push({ field: k, value: val.slice(0, 500) });
      }
    } else if (t.startsWith('F')) {
      const unit = det.unit || alert.unitId;
      const from = addDays(sliceD(alert.triggeredDate), -30);
      for (const p of fuelRowsForUnit(erp, unit, from, sliceD(alert.triggeredDate))) {
        const g = Number(p.gallons);
        const tco = money(p.totalCost);
        const ppg = Number(p.pricePerGallon);
        rows.push({
          date: sliceD(p.txnDate),
          unit: p.unit,
          driver: p.driverName || p.driverId || '',
          gallons: g,
          ppg: Number.isFinite(ppg) ? ppg : g > 0 ? tco / g : '',
          total: tco,
          wo: p.id
        });
      }
    } else {
      const unit = det.unit || alert.unitId;
      const from = addDays(sliceD(alert.triggeredDate), -60);
      for (const r of erp.records || []) {
        if (unit && String(r.unit || '').trim() !== String(unit)) continue;
        if (!inRange(r.serviceDate, from, sliceD(alert.triggeredDate))) continue;
        rows.push({
          date: sliceD(r.serviceDate),
          unit: r.unit,
          service: r.serviceType,
          vendor: r.vendor,
          cost: recordCost(r),
          wo: r.id
        });
      }
      for (const w of erpActiveWos(erp)) {
        if (unit && String(w.unit || '').trim() !== String(unit)) continue;
        if (!inRange(w.serviceDate, from, sliceD(alert.triggeredDate))) continue;
        rows.push({
          date: sliceD(w.serviceDate),
          unit: w.unit,
          service: w.serviceType,
          vendor: w.vendor,
          cost: woTotal(w),
          wo: w.id
        });
      }
    }
  } catch (_) {
    /* empty */
  }
  return rows.slice(0, 80);
}

/**
 * Same key order as Settings → Integrity thresholds (`public/settings.html` labels).
 * Keep label text in sync with `<label for="intTh_*">` there so PDF/XLSX match the admin UI.
 */
const INTEGRITY_THRESHOLD_DESCRIPTOR_LIST = [
  { key: 'maxTiresPerUnit90d', label: 'Max tire services per unit (90 days)', unitLabel: 'count' },
  { key: 'maxSameTirePosition180d', label: 'Same tire position repeats (180 days)', unitLabel: 'count' },
  { key: 'tireCostAnomalyMult', label: 'Tire invoice cost anomaly (× fleet)', unitLabel: 'multiplier' },
  { key: 'maxFleetTiresPerMonth', label: 'Fleet tire services per month', unitLabel: 'count' },
  { key: 'maxRepairsPerDriver90d', label: 'Max repairs per driver (90 days)', unitLabel: 'count' },
  { key: 'maxAccidentsPerDriver12mo', label: 'Max accidents per driver (12 months)', unitLabel: 'count' },
  { key: 'maxRepairCostDriver90d', label: 'Max driver repair spend (90 days, USD)', unitLabel: 'USD' },
  { key: 'maxRepairsSameDriverUnit60d', label: 'Same driver + unit repairs (60 days)', unitLabel: 'count' },
  { key: 'fuelConsumptionIncreasePct', label: 'Fuel use spike (% vs baseline)', unitLabel: '%' },
  { key: 'unusualGallonsMult', label: 'Unusual fill volume (× average)', unitLabel: 'multiplier' },
  { key: 'fuelPriceSpikePct', label: 'Fuel price spike (%)', unitLabel: '%' },
  { key: 'serviceCostAnomalyMult', label: 'Service cost vs fleet (×)', unitLabel: 'multiplier' },
  { key: 'maxMonthlyCostPerUnit', label: 'Max maint. spend / unit / month (USD)', unitLabel: 'USD' },
  { key: 'maxServiceRecordsPerUnit60d', label: 'Service records per unit (60 days)', unitLabel: 'count' },
  { key: 'vendorInvoiceIncreasePct', label: 'Vendor invoice spike (%)', unitLabel: '%' },
  { key: 'accidentQuarterlyCostUsd', label: 'Accident quarterly cost cap (USD)', unitLabel: 'USD' },
  { key: 'accidentQuarterlyCostYoYPct', label: 'Accident cost YoY cap (%)', unitLabel: '%' }
];

/**
 * @param {Record<string, number>} th — merged map from mergeIntegrityThresholds(erp)
 * @returns {{ key: string, label: string, unitLabel: string, value: number }[]}
 */
export function integrityThresholdExportRows(th) {
  const merged = th && typeof th === 'object' ? th : defaultIntegrityThresholds();
  const base = defaultIntegrityThresholds();
  return INTEGRITY_THRESHOLD_DESCRIPTOR_LIST.map(({ key, label, unitLabel }) => {
    const v = merged[key];
    const value = Number.isFinite(Number(v)) ? Number(v) : base[key];
    return { key, label, unitLabel, value };
  });
}

/**
 * Static reference for exports / PDF appendix — aligns with evaluateIntegrityCheck,
 * lib/integrity-samsara-crossref.mjs, and evaluatePredictiveMaintenanceAlerts.
 */
export function integrityAlertRuleCatalogSections() {
  return [
    {
      title: 'Tires — save-time rules (evaluateIntegrityCheck)',
      rules: [
        {
          code: 'T1',
          summary: 'Tire events on unit in last 90d exceed maxTiresPerUnit90d.',
          thresholdKeys: ['maxTiresPerUnit90d']
        },
        {
          code: 'T2',
          summary: 'Same tire position replaced maxSameTirePosition180d times within 180d.',
          thresholdKeys: ['maxSameTirePosition180d']
        },
        {
          code: 'T3',
          summary: 'Tire line cost exceeds fleet 12m tire-cost average × tireCostAnomalyMult.',
          thresholdKeys: ['tireCostAnomalyMult']
        },
        {
          code: 'T4',
          summary: 'Fleet-wide tire services in calendar month exceed maxFleetTiresPerMonth.',
          thresholdKeys: ['maxFleetTiresPerMonth']
        }
      ]
    },
    {
      title: 'Drivers — save-time rules',
      rules: [
        {
          code: 'D1',
          summary: 'Repair records linked to driver in 90d ≥ maxRepairsPerDriver90d.',
          thresholdKeys: ['maxRepairsPerDriver90d']
        },
        {
          code: 'D2',
          summary: 'Accident records for driver in 12mo ≥ maxAccidentsPerDriver12mo.',
          thresholdKeys: ['maxAccidentsPerDriver12mo']
        },
        {
          code: 'D3',
          summary: 'Repair spend linked to driver in 90d > maxRepairCostDriver90d (USD).',
          thresholdKeys: ['maxRepairCostDriver90d']
        },
        {
          code: 'D4',
          summary: 'Repairs for same driver+unit in 60d ≥ maxRepairsSameDriverUnit60d.',
          thresholdKeys: ['maxRepairsSameDriverUnit60d']
        }
      ]
    },
    {
      title: 'Accidents — save-time rules',
      rules: [
        {
          code: 'A1',
          summary: 'Two or more accident records on unit in last 180d (fixed count).',
          thresholdKeys: []
        },
        {
          code: 'A2',
          summary: 'Quarter accident repair total exceeds accidentQuarterlyCostUsd or YoY vs prior-year same quarter by accidentQuarterlyCostYoYPct.',
          thresholdKeys: ['accidentQuarterlyCostUsd', 'accidentQuarterlyCostYoYPct']
        },
        {
          code: 'A3',
          summary: 'Accident flagged DOT reportable — compliance reminder (no numeric threshold).',
          thresholdKeys: []
        }
      ]
    },
    {
      title: 'Fuel — save-time rules',
      rules: [
        {
          code: 'F1',
          summary: 'Unit 30d gallons vs 90d implied baseline exceeds fuelConsumptionIncreasePct.',
          thresholdKeys: ['fuelConsumptionIncreasePct']
        },
        {
          code: 'F2',
          summary: 'Driver 30d gallons vs baseline exceeds fuelConsumptionIncreasePct.',
          thresholdKeys: ['fuelConsumptionIncreasePct']
        },
        {
          code: 'F3',
          summary: 'Single fill gallons > unit’s recent average × unusualGallonsMult.',
          thresholdKeys: ['unusualGallonsMult']
        },
        {
          code: 'F4',
          summary: 'Effective PPG > 30d fleet average × (1 + fuelPriceSpikePct/100).',
          thresholdKeys: ['fuelPriceSpikePct']
        },
        {
          code: 'F5',
          summary: 'Second fuel purchase same unit same day — possible duplicate (no threshold).',
          thresholdKeys: []
        }
      ]
    },
    {
      title: 'Maintenance — save-time rules',
      rules: [
        {
          code: 'M1',
          summary: 'Record/WO cost > fleet average for same service type (12mo) × serviceCostAnomalyMult.',
          thresholdKeys: ['serviceCostAnomalyMult']
        },
        {
          code: 'M2',
          summary: 'Unit maintenance cost in calendar month > maxMonthlyCostPerUnit (uses fleet mi/mo context when set).',
          thresholdKeys: ['maxMonthlyCostPerUnit']
        },
        {
          code: 'M3',
          summary: 'Non-PM service touches for unit in 60d ≥ maxServiceRecordsPerUnit60d.',
          thresholdKeys: ['maxServiceRecordsPerUnit60d']
        },
        {
          code: 'M4',
          summary: "Vendor line > vendor's historical average for service type x (1 + vendorInvoiceIncreasePct/100).",
          thresholdKeys: ['vendorInvoiceIncreasePct']
        }
      ]
    },
    {
      title: 'Telematics / Samsara — bundle rules (integrity-samsara-crossref)',
      rules: [
        {
          code: 'OD1',
          summary: 'Samsara odometer vs last ERP WO mileage — large gap (25k mi constant in engine).',
          thresholdKeys: []
        },
        {
          code: 'OD2',
          summary: 'Miles since last PM-like service vs PM interval (from Settings / fleet defaults).',
          thresholdKeys: []
        },
        {
          code: 'OD3',
          summary: 'Implied MPG from Samsara trip miles vs ERP fuel outside 4–12 band.',
          thresholdKeys: []
        },
        { code: 'EH1', summary: 'Low miles per engine hour (idle vs distance heuristic).', thresholdKeys: [] },
        {
          code: 'EH2',
          summary: 'Engine hours exceed next scheduled interval from last ERP WO.',
          thresholdKeys: []
        },
        { code: 'IT1', summary: 'Idle percent 30d > 30%.', thresholdKeys: [] },
        {
          code: 'IT2',
          summary: 'High idle plus unit fuel cost/mile > 125% of fleet average.',
          thresholdKeys: []
        },
        {
          code: 'VU1',
          summary: 'In-service unit with almost no GPS movement in 7d.',
          thresholdKeys: []
        },
        {
          code: 'VU2',
          summary: 'Unassigned Samsara trip miles in 30d high.',
          thresholdKeys: []
        },
        {
          code: 'VU3',
          summary: 'Samsara primary driver name differs from TMS active driver on unit.',
          thresholdKeys: []
        },
        {
          code: 'FC1',
          summary: 'Active Samsara fault codes with no WO in last 7d.',
          thresholdKeys: []
        },
        {
          code: 'FC2',
          summary: 'Same fault code count > 2 in 90d snapshot history.',
          thresholdKeys: []
        },
        {
          code: 'MR1',
          summary: 'Rolling 7d miles without ERP fuel purchase > 500 mi.',
          thresholdKeys: []
        },
        {
          code: 'MR2',
          summary: 'Work orders on unit not posted to QuickBooks beyond age threshold.',
          thresholdKeys: []
        },
        {
          code: 'MR3',
          summary: 'Annual inspection last date in 11–12+ month window.',
          thresholdKeys: []
        },
        {
          code: 'DB1',
          summary: 'Safety event type count ≥ 2× fleet avg and ≥ 3 events.',
          thresholdKeys: []
        },
        {
          code: 'DB2',
          summary: 'Unit in top quartile for repair spend and safety-event volume.',
          thresholdKeys: []
        },
        {
          code: 'DB3',
          summary: 'Speeding events high with fuel cost/mile elevated vs fleet.',
          thresholdKeys: []
        }
      ]
    },
    {
      title: 'Predictive — fleet schedule (MAINTENANCE_OVERDUE / MAINTENANCE_DUE_SOON)',
      rules: [
        {
          code: 'MAINTENANCE_OVERDUE',
          summary: 'Manufacturer / fleet PM schedule row status OVERDUE (Postgres fleet due).',
          thresholdKeys: []
        },
        {
          code: 'MAINTENANCE_DUE_SOON',
          summary: 'Schedule row status DUE SOON (miles or days remaining).',
          thresholdKeys: []
        }
      ]
    }
  ];
}

/** Flat rows for spreadsheet export (one row per alert code). */
export function integrityAlertRuleCatalogFlat() {
  const rows = [];
  for (const sec of integrityAlertRuleCatalogSections()) {
    for (const r of sec.rules) {
      rows.push({
        section: sec.title,
        code: r.code,
        summary: r.summary,
        thresholdKeys: (r.thresholdKeys || []).join(', ')
      });
    }
  }
  return rows;
}
