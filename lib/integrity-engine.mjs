/**
 * Fleet integrity rules (save-time + dashboard). Alert codes: T*, D*, A*, F*, M*, plus Samsara / predictive OD*.
 */

export function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

export function isWithinDays(inputDate, days, ref = new Date()) {
  if (!inputDate) return false;
  const dt = new Date(inputDate);
  if (Number.isNaN(dt.getTime())) return false;
  const diffMs = ref.getTime() - dt.getTime();
  const diffDays = diffMs / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/** @returns {Record<string, number>} */
export function defaultIntegrityThresholds() {
  return {
    maxTiresPerUnit90d: 8,
    maxSameTirePosition180d: 3,
    tireCostMultiplierVsAvg: 2.5,
    maxFleetTiresPerMonth: 20,
    maxRepairsPerDriver90d: 3,
    maxAccidentsPerDriverYear: 2,
    maxDriverSpend90d: 5000,
    maxSameDriverUnitEvents60d: 2,
    maxAccidentsPerUnit365d: 2,
    accidentQuarterlyCostHighUsd: 25000,
    fuelConsumptionPctAboveAvg: 30,
    fuelPriceSpikePct: 20,
    maxFuelSameUnitPerDay: 2,
    singleRepairMultiplierVsAvg: 3,
    maxMonthlySpendPerUnit: 4000,
    maxMaintenanceRecordsPerUnit60d: 6,
    vendorInvoicePctAboveAvg: 40
  };
}

const THRESHOLD_LABELS = {
  maxTiresPerUnit90d: { label: 'T1 — Max tire services per unit (90 days)', unitLabel: 'count' },
  maxSameTirePosition180d: { label: 'T2 — Same wheel position events before alert (180 days)', unitLabel: 'events' },
  tireCostMultiplierVsAvg: { label: 'T3 — Tire line cost vs fleet average', unitLabel: '× avg' },
  maxFleetTiresPerMonth: { label: 'T4 — Fleet tire services per calendar month', unitLabel: 'count' },
  maxRepairsPerDriver90d: { label: 'D1 — Repairs per driver (90 days)', unitLabel: 'count' },
  maxAccidentsPerDriverYear: { label: 'D2 — Accidents per driver (rolling year)', unitLabel: 'count' },
  maxDriverSpend90d: { label: 'D3 — Driver-attributed maintenance spend (90 days)', unitLabel: 'USD' },
  maxSameDriverUnitEvents60d: { label: 'D4 — Same driver + unit events (60 days)', unitLabel: 'count' },
  maxAccidentsPerUnit365d: { label: 'A1 — Accidents per unit (365 days)', unitLabel: 'count' },
  accidentQuarterlyCostHighUsd: { label: 'A2 — Accident spend for unit (90-day window)', unitLabel: 'USD' },
  fuelConsumptionPctAboveAvg: { label: 'F1 — Fuel volume vs unit average', unitLabel: '%' },
  fuelPriceSpikePct: { label: 'F4 — Price vs recent fleet average', unitLabel: '%' },
  maxFuelSameUnitPerDay: { label: 'F5 — Fuel purchases same unit per day', unitLabel: 'count' },
  singleRepairMultiplierVsAvg: { label: 'M1 — Single repair vs fleet average', unitLabel: '× avg' },
  maxMonthlySpendPerUnit: { label: 'M2 — Maintenance spend cap per unit per month', unitLabel: 'USD' },
  maxMaintenanceRecordsPerUnit60d: { label: 'M3 — Maintenance records per unit (60 days)', unitLabel: 'count' },
  vendorInvoicePctAboveAvg: { label: 'M4 — Vendor bill vs vendor average', unitLabel: '%' }
};

export function integrityThresholdExportRows(thresholds) {
  const th = thresholds && typeof thresholds === 'object' ? thresholds : defaultIntegrityThresholds();
  const keys = Object.keys(defaultIntegrityThresholds());
  return keys.map(key => {
    const meta = THRESHOLD_LABELS[key] || { label: key, unitLabel: '' };
    return {
      key,
      label: meta.label,
      unitLabel: meta.unitLabel,
      value: Number(th[key])
    };
  });
}

export function integrityAlertRuleCatalogFlat() {
  const rows = [
    { code: 'T1', summary: 'Tire service frequency per unit exceeds threshold (90 days).' },
    { code: 'T2', summary: 'Same tire position serviced repeatedly (180 days).' },
    { code: 'T3', summary: 'Tire line cost far above fleet average.' },
    { code: 'T4', summary: 'Fleet-wide tire activity spike in calendar month.' },
    { code: 'D1', summary: 'Driver repair frequency high (90 days).' },
    { code: 'D2', summary: 'Driver accident count high (rolling year).' },
    { code: 'D3', summary: 'Driver-attributed spend high (90 days).' },
    { code: 'D4', summary: 'Same driver and unit combination often (60 days).' },
    { code: 'A1', summary: 'Multiple accidents on same unit.' },
    { code: 'A2', summary: 'Accident-related cost high for unit (90 days).' },
    { code: 'A3', summary: 'DOT-reportable accident — always review for compliance.' },
    { code: 'F1', summary: 'Fuel volume materially above unit average.' },
    { code: 'F2', summary: 'Driver fuel pattern differs from norm.' },
    { code: 'F3', summary: 'Unusually large fuel purchase (gallons).' },
    { code: 'F4', summary: 'Price per gallon spike vs fleet average.' },
    { code: 'F5', summary: 'Multiple fuel purchases for same unit same day.' },
    { code: 'M1', summary: 'Single repair cost far above fleet average.' },
    { code: 'M2', summary: 'Monthly maintenance spend high for unit.' },
    { code: 'M3', summary: 'Many maintenance records for unit (60 days).' },
    { code: 'M4', summary: 'Vendor bill above vendor historical average.' },
    { code: 'OD1', summary: 'Samsara / telematics predictive signal (bundle).' },
    { code: 'MAINTENANCE_OVERDUE', summary: 'PM or interval overdue vs schedule.' },
    { code: 'MAINTENANCE_DUE_SOON', summary: 'PM or interval due soon.' }
  ];
  return rows;
}

/**
 * @param {string|{type?:string,category?:string,message?:string,alertType?:string}} alert
 * @returns {'tires'|'drivers'|'accidents'|'fuel'|'maintenance'|'predictive'|'samsara'|'service'|'repair'|'general'}
 */
export function alertCategory(alert) {
  if (typeof alert === 'string') {
    const c = alert.trim().toUpperCase();
    if (c.startsWith('T')) return 'tires';
    if (c.startsWith('D')) return 'drivers';
    if (c.startsWith('A')) return 'accidents';
    if (c.startsWith('F')) return 'fuel';
    if (c.startsWith('M')) return 'maintenance';
    if (c.startsWith('OD') || c.startsWith('VU') || c.startsWith('MAINTENANCE_')) return 'predictive';
    const t = alert.toLowerCase();
    if (t.includes('tire')) return 'tires';
    if (t.includes('accident')) return 'accidents';
    if (t.includes('fuel')) return 'fuel';
    if (t.includes('driver')) return 'drivers';
    return 'general';
  }
  const cat = String(alert.category || '').toLowerCase();
  if (cat && cat !== 'general') {
    if (cat === 'samsara') return 'samsara';
    if (['tires', 'drivers', 'accidents', 'fuel', 'maintenance', 'predictive'].includes(cat)) return cat;
  }
  const type = String(alert.alertType || alert.type || '').trim().toUpperCase();
  if (type.startsWith('T')) return 'tires';
  if (type.startsWith('D')) return 'drivers';
  if (type.startsWith('A')) return 'accidents';
  if (type.startsWith('F')) return 'fuel';
  if (type.startsWith('M')) return 'maintenance';
  if (type.startsWith('OD') || type.startsWith('VU') || type.includes('MAINTENANCE_')) return 'predictive';
  const message = String(alert.message || '').toLowerCase();
  if (message.includes('tire')) return 'tires';
  if (message.includes('accident')) return 'accidents';
  if (message.includes('fuel')) return 'fuel';
  return 'general';
}

export function buildAlert(input = {}) {
  return {
    type: input.type || 'general',
    category: input.category || alertCategory(input),
    severity: input.severity || 'AMBER',
    message: input.message || '',
    unitNumber: input.unitNumber || input.unit || null,
    createdAt: input.createdAt || new Date().toISOString(),
    ...input
  };
}

export function mergeIntegrityThresholds(overrides = {}) {
  const defs = defaultIntegrityThresholds();
  if (!overrides || typeof overrides !== 'object') return { ...defs };
  if (overrides.integrityThresholds && typeof overrides.integrityThresholds === 'object') {
    return { ...defs, ...overrides.integrityThresholds };
  }
  const extra = {};
  for (const k of Object.keys(defs)) {
    if (overrides[k] == null) continue;
    const n = Number(overrides[k]);
    if (Number.isFinite(n)) extra[k] = n;
  }
  return { ...defs, ...extra };
}

function voidedWo(w) {
  return !!(w && w.voided);
}

function woDate(w) {
  return sliceD(w.serviceDate || w.service_date || '');
}

function recDate(r) {
  return sliceD(r.serviceDate || r.date || '');
}

function recordCost(r) {
  return toNumber(r.cost, 0);
}

function woAmount(w) {
  const lines = Array.isArray(w.lines) ? w.lines : [];
  const sum = lines.reduce((s, l) => s + toNumber(l.amount, 0), 0);
  if (sum > 0) return sum;
  return toNumber(w.total, toNumber(w.amount, 0));
}

function isTireish(obj) {
  const rt = String(obj.recordType || obj.maintRecordType || obj.recordSubtype || '').toLowerCase();
  if (rt === 'tire') return true;
  const st = String(obj.serviceType || '').toLowerCase();
  if (st.includes('tire')) return true;
  return false;
}

function isRepairish(obj) {
  const rt = String(obj.recordType || obj.maintRecordType || '').toLowerCase();
  if (rt === 'repair') return true;
  const st = String(obj.serviceType || '').toLowerCase();
  return st.includes('repair') && !st.includes('accident');
}

function isAccidentish(obj) {
  const rt = String(obj.recordType || obj.maintRecordType || obj.recordSubtype || '').toLowerCase();
  if (rt === 'accident') return true;
  const st = String(obj.serviceType || '').toLowerCase();
  return st.includes('accident');
}

function tirePositionOf(obj) {
  const p =
    String(obj.tirePositionText || '').trim() ||
    String(obj.tirePosition || '').trim() ||
    String(obj.partPosition || '').trim();
  return p.toLowerCase() || '';
}

function collectTirePositionsFromLines(lines) {
  const out = [];
  for (const l of lines || []) {
    const pos = String(l.partPosition || l.position || '').trim();
    if (pos) out.push(pos.toLowerCase());
  }
  return out;
}

function evidenceRow(kind, o) {
  return {
    kind,
    id: String(o.id || ''),
    date: sliceD(o.serviceDate || o.txnDate || o.date || ''),
    unit: String(o.unit || o.unitId || ''),
    amount: toNumber(o.amount ?? o.cost ?? o.totalCost, 0),
    summary: String(o.summary || o.serviceType || o.memo || '').slice(0, 200)
  };
}

/**
 * @returns {{ alerts: Array<{type:string,category:string,severity:string,message:string,details:object,dedupeKey:string}> }}
 */
export function evaluateIntegrityCheck(ctx = {}, erp = {}) {
  const thresholds = mergeIntegrityThresholds(erp);
  const alerts = [];
  const now = new Date();

  const workOrders = (erp.workOrders || []).filter(w => !voidedWo(w));
  const records = Array.isArray(erp.records) ? erp.records : [];
  const fuel = Array.isArray(erp.fuelPurchases) ? erp.fuelPurchases : [];

  const unit = String(ctx.unitId || ctx.unit || '').trim();
  const driverId = String(ctx.driverId || '').trim();
  const ctxDay = sliceD(ctx.date || ctx.serviceDate || '');

  function pushAlert(code, sev, msg, dedupeKey, details = {}) {
    const cat = alertCategory(code);
    alerts.push({
      type: code,
      category: cat,
      severity: sev,
      message: msg,
      details: { ...details, dedupeKey: dedupeKey || `${code}:${unit || 'fleet'}:${ctxDay}` },
      dedupeKey: dedupeKey || `${code}:${unit || 'fleet'}:${ctxDay}`
    });
  }

  // --- T1 / T2 / T3 (unit-scoped) ---
  if (unit) {
    const tireEvents = [];
    for (const r of records) {
      if (String(r.unit || '') !== unit) continue;
      if (!isTireish(r)) continue;
      const d = recDate(r);
      if (!d) continue;
      if (isWithinDays(d, 90, now)) {
        tireEvents.push({ kind: 'maintenance_record', ...r, _d: d, amount: recordCost(r) });
      }
    }
    for (const w of workOrders) {
      if (String(w.unit || '') !== unit) continue;
      if (!isTireish(w)) continue;
      const d = woDate(w);
      if (!d) continue;
      if (isWithinDays(d, 90, now)) {
        tireEvents.push({ kind: 'work_order', ...w, _d: d, amount: woAmount(w) });
      }
    }

    const tireCount90 = tireEvents.length;
    if (tireCount90 > thresholds.maxTiresPerUnit90d) {
      pushAlert(
        'T1',
        'AMBER',
        `Unit ${unit}: ${tireCount90} tire-related services in 90 days (threshold ${thresholds.maxTiresPerUnit90d}).`,
        `T1:${unit}:90d`,
        {
          evidence: tireEvents.slice(0, 12).map(e =>
            evidenceRow(e.kind === 'work_order' ? 'work_order' : 'maintenance_record', {
              id: e.id,
              serviceDate: e._d,
              unit,
              amount: e.amount,
              serviceType: e.serviceType || e.maintRecordType
            })
          )
        }
      );
    }

    const posBuckets = new Map();
    for (const r of records) {
      if (String(r.unit || '') !== unit || !isTireish(r)) continue;
      const d = recDate(r);
      if (!d || !isWithinDays(d, 180, now)) continue;
      let positions = [tirePositionOf(r), ...collectTirePositionsFromLines(r.costLines)].filter(Boolean);
      if (!positions.length) positions = ['(position not set)'];
      for (const p of positions) {
        posBuckets.set(p, (posBuckets.get(p) || 0) + 1);
      }
    }
    for (const w of workOrders) {
      if (String(w.unit || '') !== unit || !isTireish(w)) continue;
      const d = woDate(w);
      if (!d || !isWithinDays(d, 180, now)) continue;
      const positions = collectTirePositionsFromLines(w.lines);
      const use = positions.length ? positions : ['(position not set)'];
      for (const p of use) {
        const k = p.toLowerCase();
        posBuckets.set(k, (posBuckets.get(k) || 0) + 1);
      }
    }
    for (const [pos, n] of posBuckets) {
      if (n >= thresholds.maxSameTirePosition180d) {
        pushAlert(
          'T2',
          'AMBER',
          `Unit ${unit}: tire position "${pos}" serviced ${n} times in 180 days (threshold ${thresholds.maxSameTirePosition180d}).`,
          `T2:${unit}:${pos}:180d`,
          { tirePosition: pos, count: n }
        );
      }
    }

    const tireAmounts = [];
    for (const r of records) {
      if (isTireish(r)) tireAmounts.push(recordCost(r));
    }
    for (const w of workOrders) {
      if (isTireish(w)) tireAmounts.push(woAmount(w));
    }
    const avgTire =
      tireAmounts.length > 0 ? tireAmounts.reduce((a, b) => a + b, 0) / tireAmounts.length : 0;
    if (avgTire > 0 && isTireish(ctx)) {
      const amt = toNumber(ctx.amount, 0);
      if (amt > avgTire * thresholds.tireCostMultiplierVsAvg) {
        pushAlert(
          'T3',
          'RED',
          `Tire job cost $${amt.toFixed(0)} is above ${thresholds.tireCostMultiplierVsAvg}× fleet avg tire job (~$${avgTire.toFixed(0)}).`,
          `T3:${unit}:${ctx.recordId || 'new'}`,
          { avgTire, amount: amt }
        );
      }
    }
  }

  // T4 fleet tires this month
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let fleetTireMonth = 0;
  for (const r of records) {
    const d = recDate(r);
    if (!d || !d.startsWith(ym.slice(0, 7))) continue;
    if (isTireish(r)) fleetTireMonth++;
  }
  for (const w of workOrders) {
    const d = woDate(w);
    if (!d || !d.startsWith(ym.slice(0, 7))) continue;
    if (isTireish(w)) fleetTireMonth++;
  }
  if (fleetTireMonth > thresholds.maxFleetTiresPerMonth) {
    pushAlert(
      'T4',
      'AMBER',
      `Fleet tire-related services this month: ${fleetTireMonth} (threshold ${thresholds.maxFleetTiresPerMonth}).`,
      `T4:fleet:${ym}`,
      { month: ym, count: fleetTireMonth }
    );
  }

  // --- Driver rules D1–D4 ---
  if (driverId) {
    let repairs = 0;
    let accids = 0;
    let spend90 = 0;
    const driverUnit = [];
    for (const r of records) {
      if (String(r.driverId || '') !== driverId) continue;
      const d = recDate(r);
      if (d && isWithinDays(d, 90, now)) {
        spend90 += recordCost(r);
        if (isRepairish(r)) repairs++;
        if (String(r.unit || '') === unit && unit) {
          driverUnit.push({ t: d, u: r.unit });
        }
      }
    }
    for (const w of workOrders) {
      if (String(w.driverId || '') !== driverId) continue;
      const d = woDate(w);
      if (d && isWithinDays(d, 90, now)) {
        spend90 += woAmount(w);
        const mrt = String(w.maintRecordType || '').toLowerCase();
        if (mrt === 'repair' || isRepairish(w)) repairs++;
        if (String(w.unit || '') === unit && unit) {
          driverUnit.push({ t: d, u: w.unit });
        }
      }
    }
    for (const r of records) {
      if (String(r.driverId || '') !== driverId) continue;
      const d = recDate(r);
      if (d && isWithinDays(d, 365, now) && isAccidentish(r)) accids++;
    }
    for (const w of workOrders) {
      if (String(w.driverId || '') !== driverId) continue;
      const d = woDate(w);
      if (d && isWithinDays(d, 365, now) && isAccidentish(w)) accids++;
    }

    if (repairs > thresholds.maxRepairsPerDriver90d) {
      pushAlert('D1', 'AMBER', `Driver has ${repairs} repair events in 90 days (threshold ${thresholds.maxRepairsPerDriver90d}).`, `D1:${driverId}:90d`, {
        count: repairs
      });
    }
    if (accids > thresholds.maxAccidentsPerDriverYear) {
      pushAlert('D2', 'RED', `Driver has ${accids} accident-related events in 365 days (threshold ${thresholds.maxAccidentsPerDriverYear}).`, `D2:${driverId}:365d`, {
        count: accids
      });
    }
    if (spend90 > thresholds.maxDriverSpend90d) {
      pushAlert(
        'D3',
        'AMBER',
        `Driver-attributed maintenance spend $${spend90.toFixed(0)} in 90 days exceeds $${thresholds.maxDriverSpend90d}.`,
        `D3:${driverId}:90d`,
        { spend90 }
      );
    }
    if (unit) {
      let pair = 0;
      for (const x of driverUnit) {
        if (x.u === unit && x.t && isWithinDays(x.t, 60, now)) pair++;
      }
      if (pair >= thresholds.maxSameDriverUnitEvents60d) {
        pushAlert(
          'D4',
          'AMBER',
          `Driver + unit ${unit}: ${pair} events in 60 days (threshold ${thresholds.maxSameDriverUnitEvents60d}).`,
          `D4:${driverId}:${unit}:60d`,
          { pair }
        );
      }
    }
  }

  // --- Accidents A1–A3 ---
  if (unit) {
    let accN = 0;
    let accCost = 0;
    for (const r of records) {
      if (String(r.unit || '') !== unit || !isAccidentish(r)) continue;
      const d = recDate(r);
      if (!d || !isWithinDays(d, 365, now)) continue;
      accN++;
      accCost += recordCost(r);
    }
    for (const w of workOrders) {
      if (String(w.unit || '') !== unit || !isAccidentish(w)) continue;
      const d = woDate(w);
      if (!d || !isWithinDays(d, 365, now)) continue;
      accN++;
      accCost += woAmount(w);
    }
    if (accN > thresholds.maxAccidentsPerUnit365d) {
      pushAlert(
        'A1',
        'RED',
        `Unit ${unit}: ${accN} accident-related events in 365 days (threshold ${thresholds.maxAccidentsPerUnit365d}).`,
        `A1:${unit}:365d`,
        { count: accN }
      );
    }
    let qCost = 0;
    for (const r of records) {
      if (String(r.unit || '') !== unit || !isAccidentish(r)) continue;
      const d = recDate(r);
      if (!d || !isWithinDays(d, 90, now)) continue;
      qCost += recordCost(r);
    }
    for (const w of workOrders) {
      if (String(w.unit || '') !== unit || !isAccidentish(w)) continue;
      const d = woDate(w);
      if (!d || !isWithinDays(d, 90, now)) continue;
      qCost += woAmount(w);
    }
    if (qCost > thresholds.accidentQuarterlyCostHighUsd) {
      pushAlert(
        'A2',
        'AMBER',
        `Unit ${unit}: accident-related spend $${qCost.toFixed(0)} in 90 days exceeds $${thresholds.accidentQuarterlyCostHighUsd}.`,
        `A2:${unit}:90d`,
        { qCost }
      );
    }
  }

  const ctxAccident = String(ctx.recordSubtype || ctx.maintRecordType || '').toLowerCase() === 'accident';
  if (ctxAccident && ctx.dotReportable) {
    pushAlert(
      'A3',
      'RED',
      'DOT-reportable accident — confirm filings, retention, and insurance handoff.',
      `A3:${ctx.recordId || unit || 'new'}:${ctxDay}`,
      { recordId: ctx.recordId }
    );
  }

  // --- Fuel F1–F5 ---
  const fuel300 = 300;
  const unitFuels = fuel.filter(f => String(f.unit || '') === unit && toNumber(f.gallons, 0) > 0);
  const galVals = unitFuels.map(f => toNumber(f.gallons, 0)).filter(g => g > 0);
  const avgGal = galVals.length ? galVals.reduce((a, b) => a + b, 0) / galVals.length : 0;
  if (ctx.recordType === 'fuel_purchase' && unit) {
    const g = toNumber(ctx.gallons, 0);
    if (avgGal > 0 && g > avgGal * (1 + thresholds.fuelConsumptionPctAboveAvg / 100)) {
      pushAlert(
        'F1',
        'AMBER',
        `Fuel gallons ${g.toFixed(1)} vs unit recent average ${avgGal.toFixed(1)} (+${thresholds.fuelConsumptionPctAboveAvg}% threshold).`,
        `F1:${unit}:${ctx.recordId || 'new'}`,
        { gallons: g, avgGal }
      );
    }
    if (driverId) {
      const drvFuels = fuel.filter(f => String(f.driverId || '') === driverId);
      const dg = drvFuels.map(f => toNumber(f.gallons, 0)).filter(x => x > 0);
      const dAvg = dg.length ? dg.reduce((a, b) => a + b, 0) / dg.length : 0;
      if (dAvg > 0 && g > dAvg * 1.35) {
        pushAlert('F2', 'AMBER', `Fuel volume above this driver's typical fill pattern.`, `F2:${driverId}:${ctx.recordId || 'new'}`, {
          gallons: g,
          dAvg
        });
      }
    }
    if (g > fuel300) {
      pushAlert('F3', 'AMBER', `Unusually large fuel purchase: ${g.toFixed(1)} gal.`, `F3:${unit}:${ctxDay}`, { gallons: g });
    }
    const prices = fuel
      .map(f => toNumber(f.pricePerGallon, 0))
      .filter(p => p > 0);
    const avgP = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const ppg = toNumber(ctx.pricePerGallon, 0);
    if (avgP > 0 && ppg > avgP * (1 + thresholds.fuelPriceSpikePct / 100)) {
      pushAlert(
        'F4',
        'AMBER',
        `Price $${ppg.toFixed(3)}/gal vs fleet avg $${avgP.toFixed(3)} (+${thresholds.fuelPriceSpikePct}%).`,
        `F4:${ctx.recordId || 'new'}:${ctxDay}`,
        { ppg, avgP }
      );
    }
    const sameDay = fuel.filter(
      f =>
        String(f.unit || '') === unit && sliceD(f.txnDate || f.date || '') === ctxDay && String(f.id) !== String(ctx.recordId || '')
    );
    if (sameDay.length >= thresholds.maxFuelSameUnitPerDay - 1) {
      pushAlert('F5', 'AMBER', `Unit ${unit}: multiple fuel purchases on ${ctxDay}.`, `F5:${unit}:${ctxDay}`, {
        count: sameDay.length + 1
      });
    }
  }

  // --- Maintenance M1–M4 ---
  const repairAmts = [];
  for (const r of records) {
    if (isRepairish(r) || String(r.recordType || '').toLowerCase() === 'maintenance') {
      const x = recordCost(r);
      if (x > 0) repairAmts.push(x);
    }
  }
  for (const w of workOrders) {
    const a = woAmount(w);
    if (a > 0) repairAmts.push(a);
  }
  const avgRepair = repairAmts.length ? repairAmts.reduce((x, y) => x + y, 0) / repairAmts.length : 0;

  if (avgRepair > 0 && ctx.recordId && (ctx.recordType === 'maintenance_record' || ctx.recordType === 'work_order')) {
    const amt = toNumber(ctx.amount, 0);
    if (amt > avgRepair * thresholds.singleRepairMultiplierVsAvg) {
      pushAlert(
        'M1',
        'AMBER',
        `Repair cost $${amt.toFixed(0)} exceeds ${thresholds.singleRepairMultiplierVsAvg}× rolling avg (~$${avgRepair.toFixed(0)}).`,
        `M1:${ctx.recordId}:${ctxDay}`,
        { amt, avgRepair }
      );
    }
  }

  if (unit) {
    let monthSpend = 0;
    for (const r of records) {
      if (String(r.unit || '') !== unit) continue;
      const d = recDate(r);
      if (!d || !d.startsWith(ym.slice(0, 7))) continue;
      monthSpend += recordCost(r);
    }
    for (const w of workOrders) {
      if (String(w.unit || '') !== unit) continue;
      const d = woDate(w);
      if (!d || !d.startsWith(ym.slice(0, 7))) continue;
      monthSpend += woAmount(w);
    }
    if (monthSpend > thresholds.maxMonthlySpendPerUnit) {
      pushAlert(
        'M2',
        'AMBER',
        `Unit ${unit}: maintenance spend $${monthSpend.toFixed(0)} this month exceeds $${thresholds.maxMonthlySpendPerUnit}.`,
        `M2:${unit}:${ym}`,
        { monthSpend }
      );
    }

    let svc60 = 0;
    for (const r of records) {
      if (String(r.unit || '') !== unit) continue;
      const d = recDate(r);
      if (!d || !isWithinDays(d, 60, now)) continue;
      svc60++;
    }
    if (svc60 > thresholds.maxMaintenanceRecordsPerUnit60d) {
      pushAlert(
        'M3',
        'AMBER',
        `Unit ${unit}: ${svc60} maintenance records in 60 days (threshold ${thresholds.maxMaintenanceRecordsPerUnit60d}).`,
        `M3:${unit}:60d`,
        { svc60 }
      );
    }
  }

  const vId = String(ctx.qboVendorId || '').trim();
  if (vId && ctx.recordType === 'work_order') {
    const vendorAmts = [];
    for (const w of workOrders) {
      if (String(w.qboVendorId || '') !== vId) continue;
      const a = woAmount(w);
      if (a > 0) vendorAmts.push(a);
    }
    const vAvg = vendorAmts.length ? vendorAmts.reduce((x, y) => x + y, 0) / vendorAmts.length : 0;
    const amt = toNumber(ctx.amount, 0);
    if (vAvg > 0 && amt > vAvg * (1 + thresholds.vendorInvoicePctAboveAvg / 100)) {
      pushAlert(
        'M4',
        'AMBER',
        `Vendor bill $${amt.toFixed(0)} is ${thresholds.vendorInvoicePctAboveAvg}%+ above this vendor's average (~$${vAvg.toFixed(0)}).`,
        `M4:${vId}:${ctx.recordId || 'new'}`,
        { amt, vAvg }
      );
    }
  }

  return { alerts };
}

export function compareIntegrityAlertsDesc(a, b) {
  const da = sliceD(a?.triggeredDate || a?.createdAt || '');
  const db = sliceD(b?.triggeredDate || b?.createdAt || '');
  if (da !== db) return db.localeCompare(da);
  const ta = new Date(a?.createdAt || 0).getTime();
  const tb = new Date(b?.createdAt || 0).getTime();
  return tb - ta;
}

export function effectiveIntegrityAlertCategory(alert = {}) {
  const c = String(alert.category || '').trim();
  if (c) {
    const low = c.toLowerCase();
    if (low === 'fuel') return 'fuel';
    return low;
  }
  return alertCategory(alert);
}

export function buildInvestigateRecords(alert = {}, erp = {}) {
  return {
    alert,
    relatedRecords: [],
    erpSnapshot: erp || {},
    generatedAt: new Date().toISOString()
  };
}

export function summarizeUnitIntegrity() {
  return { ok: true, alerts: [] };
}

export function summarizeFleetIntegrity() {
  return { ok: true, alerts: [] };
}

export function evaluateIntegrity() {
  return { ok: true, alerts: [] };
}

export default {
  defaultIntegrityThresholds,
  mergeIntegrityThresholds,
  evaluateIntegrityCheck,
  alertCategory,
  integrityThresholdExportRows,
  integrityAlertRuleCatalogFlat
};
