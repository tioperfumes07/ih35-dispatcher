/**
 * GET /api/reports/dot/vehicle-audit — compound DOT response (read-only).
 */

import { buildDotAuditJson } from './dot-audit-build.mjs';
import { buildDvirRows } from './reports-safety-live.mjs';
import { recordCategoryKey, workOrderPassesReportFilters, primaryServiceType } from './reports-datasets.mjs';

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function woLineTotal(wo) {
  return (wo.lines || []).reduce((s, l) => s + (safeNum(l.amount, 0) || 0), 0);
}

function activeWos(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

function inRange(d, startDate, endDate) {
  const x = sliceIso(d);
  if (!x) return false;
  if (startDate && x < sliceIso(startDate)) return false;
  if (endDate && x > sliceIso(endDate)) return false;
  return true;
}

function mapWoToRepairRow(wo) {
  return {
    date: sliceIso(wo.serviceDate),
    wo: wo.workOrderNumber || '',
    recordType: wo.txnType || '',
    serviceType: wo.serviceType || '',
    description: wo.notes || '',
    vendor: wo.vendor || '',
    mileage: Math.max(0, ...(wo.lines || []).map(l => safeNum(l.serviceMileage, 0) || 0)),
    cost: woLineTotal(wo)
  };
}

export async function buildDotVehicleAuditV1(erp, unitId, startDate, endDate, companyProfile = {}, queryOpts = {}) {
  const base = buildDotAuditJson(erp, unitId, startDate, endDate, companyProfile);
  let dvirRows = [];
  let dvirErr = '';
  try {
    const r = await buildDvirRows({ startDate, endDate, unit: unitId });
    dvirRows = r.rows || [];
    if (r.error) dvirErr = r.error;
  } catch (e) {
    dvirErr = e.message || String(e);
  }

  const today = sliceIso(new Date().toISOString());
  const regExp = base.section1?.registrationExp ? sliceIso(base.section1.registrationExp) : '';
  const annualRows = base.section2Annual || [];
  const lastInsp = annualRows.map(r => sliceIso(r.date)).filter(Boolean).sort().pop();
  let annual_inspection_current = false;
  if (lastInsp) {
    const a = new Date(lastInsp + 'T12:00:00');
    const b = new Date((sliceIso(endDate) || today) + 'T12:00:00');
    const days = (b - a) / 86400000;
    annual_inspection_current = days >= 0 && days <= 365;
  }
  const pmRows = base.section3Pm || [];
  const lastPmMiles = pmRows.map(r => Number(r.mileage)).filter(n => Number.isFinite(n) && n > 0).sort((x, y) => y - x)[0];
  const pmInterval = Number(companyProfile.pmIntervalMiles) > 0 ? Number(companyProfile.pmIntervalMiles) : 25000;
  const curMiles = Number(erp.currentMileage?.[String(unitId).trim()] || 0) || null;
  const nextPmDue = lastPmMiles != null && Number.isFinite(lastPmMiles) ? lastPmMiles + pmInterval : null;
  const miles_remaining = nextPmDue != null && curMiles != null ? nextPmDue - curMiles : null;
  const pm_schedule_current = miles_remaining != null && miles_remaining > 0;
  const registration_current = !regExp || regExp > today;
  const openDefects = dvirRows.filter(r => String(r.defects_found).toUpperCase() === 'Y' && String(r.corrected).toUpperCase() !== 'Y');
  const no_open_violations = openDefects.length === 0;
  const dvir_on_file_90_days = dvirRows.length > 0;
  const oosRows = base.section7Oos || [];
  const no_oos_events = !oosRows.length;

  let falseCount = 0;
  if (!annual_inspection_current) falseCount++;
  if (!pm_schedule_current) falseCount++;
  if (!registration_current) falseCount++;
  if (!no_open_violations) falseCount++;
  if (!dvir_on_file_90_days) falseCount++;
  if (!no_oos_events) falseCount++;
  const overall_status =
    falseCount === 0 ? 'compliant' : falseCount <= 2 ? 'attention' : 'non_compliant';

  const u = String(unitId || '').trim();
  const qf = { ...queryOpts, units: u, unit: u };
  const fleetCtx = { fleetByUnit: {} };
  const unitWos = activeWos(erp).filter(w => String(w.unit || '').trim() === u && inRange(w.serviceDate, startDate, endDate));
  const filteredWos = unitWos.filter(w => workOrderPassesReportFilters(w, qf, fleetCtx));

  const buckets = {
    pm_service: [],
    maintenance: [],
    repair: [],
    tire: [],
    air_bag: [],
    battery: [],
    body: [],
    inspection: [],
    other: []
  };
  for (const wo of filteredWos) {
    const cat = recordCategoryKey(wo);
    const row = mapWoToRepairRow(wo);
    if (cat === 'pm_service') buckets.pm_service.push(row);
    else if (cat === 'maintenance') buckets.maintenance.push(row);
    else if (cat === 'repair') buckets.repair.push(row);
    else if (cat === 'tire') buckets.tire.push(row);
    else if (cat === 'air_bag') buckets.air_bag.push(row);
    else if (cat === 'battery') buckets.battery.push(row);
    else if (cat === 'body') buckets.body.push(row);
    else if (cat === 'inspection') buckets.inspection.push(row);
    else buckets.other.push(row);
  }

  const locGroups = new Map();
  for (const wo of filteredWos) {
    const lab = String(wo.repairLocationLabel || '').trim() || String(wo.repairLocationType || '').trim() || '—';
    if (!locGroups.has(lab)) locGroups.set(lab, []);
    locGroups.get(lab).push({
      date: sliceIso(wo.serviceDate),
      service: primaryServiceType(wo),
      cost: woLineTotal(wo)
    });
  }
  const section4i = [...locGroups.entries()].map(([locationName, recs]) => {
    const woRef = filteredWos.find(w => {
      const lab = String(w.repairLocationLabel || '').trim() || String(w.repairLocationType || '').trim() || '—';
      return lab === locationName;
    });
    return {
      locationName,
      locationType: String(woRef?.repairLocationType || ''),
      records: recs.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    };
  });

  const internalCost = filteredWos
    .filter(w => String(w.repairLocationType || '').toLowerCase() === 'in-house')
    .reduce((s, w) => s + woLineTotal(w), 0);
  const externalCost = filteredWos
    .filter(w => !['in-house', 'road-service', 'roadside', ''].includes(String(w.repairLocationType || '').toLowerCase()))
    .reduce((s, w) => s + woLineTotal(w), 0);
  const roadCost = filteredWos
    .filter(w => ['road-service', 'roadside'].includes(String(w.repairLocationType || '').toLowerCase()))
    .reduce((s, w) => s + woLineTotal(w), 0);
  const totSvc = internalCost + externalCost + roadCost || 1;
  const section4_location_summary = {
    pct_internal: Math.round((internalCost / totSvc) * 10000) / 100,
    pct_external: Math.round((externalCost / totSvc) * 10000) / 100,
    pct_roadside: Math.round((roadCost / totSvc) * 10000) / 100
  };

  const repairHistoryChrono = filteredWos
    .slice()
    .sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || '')))
    .map(mapWoToRepairRow);

  return {
    title: 'DOT vehicle audit',
    generatedAt: new Date().toISOString(),
    filters: { unitId, startDate, endDate, ...queryOpts },
    columns: [],
    rows: [],
    totals: {},
    sections: {
      vehicle_info: base.section1,
      annual_inspections: base.section2Annual,
      pm_history: base.section3Pm,
      repair_history: repairHistoryChrono,
      section4_pm_service: buckets.pm_service,
      section4_maintenance: buckets.maintenance,
      section4_repair: buckets.repair,
      section4_tire: buckets.tire,
      section4_air_bag: buckets.air_bag,
      section4_battery: buckets.battery,
      section4_body: buckets.body,
      section4_inspection: buckets.inspection,
      section4_other: buckets.other,
      section4i_service_locations: section4i,
      section4_location_summary,
      accident_history: base.section5Accidents,
      dvir_history: dvirRows.length ? dvirRows : base.section6Dvir,
      out_of_service: base.section7Oos,
      tire_records: base.section8Tires
    },
    compliance_checklist: {
      annual_inspection_current,
      annual_inspection_date: lastInsp || null,
      pm_schedule_current,
      registration_current,
      registration_expiry: regExp || null,
      no_open_violations,
      dvir_on_file_90_days,
      no_oos_events,
      overall_status,
      dvir_note: dvirErr || null
    },
    meta: {
      hasChart: false,
      totalRows: 0,
      compound: true,
      groupBy: String(queryOpts.groupBy || 'service_type'),
      disclaimer:
        'Samsara DVIR section uses live API when configured; other sections use ERP work orders. Verify all fields before DOT submission.'
    }
  };
}
