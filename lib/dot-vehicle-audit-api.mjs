/**
 * GET /api/reports/dot/vehicle-audit — compound DOT response (read-only).
 */

import { buildDotAuditJson } from './dot-audit-build.mjs';
import { buildDvirRows } from './reports-safety-live.mjs';

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export async function buildDotVehicleAuditV1(erp, unitId, startDate, endDate, companyProfile = {}) {
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

  return {
    title: 'DOT vehicle audit',
    generatedAt: new Date().toISOString(),
    filters: { unitId, startDate, endDate },
    columns: [],
    rows: [],
    totals: {},
    sections: {
      vehicle_info: base.section1,
      annual_inspections: base.section2Annual,
      pm_history: base.section3Pm,
      repair_history: base.section4Repairs,
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
      disclaimer:
        'Samsara DVIR section uses live API when configured; other sections use ERP work orders. Verify all fields before DOT submission.'
    }
  };
}
