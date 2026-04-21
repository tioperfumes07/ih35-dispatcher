/**
 * Fleet average miles per truck per month — Postgres `erp_fleet_defaults` (and `company_settings` seed).
 * Catalog `interval_months` = FLOOR(interval_miles ÷ fleet_avg), minimum 1 when miles > 0.
 */

const FALLBACK = 12000;
const MIN_AVG = 1000;
const MAX_AVG = 30000;

export function clampFleetAvgMilesPerMonth(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return FALLBACK;
  return Math.min(MAX_AVG, Math.max(MIN_AVG, Math.round(x)));
}

/** @param {(sql: string, params?: any[]) => Promise<{ rows?: any[] }>} dbQuery */
export async function getFleetAvgMilesPerMonth(dbQuery) {
  if (!dbQuery) return FALLBACK;
  try {
    const { rows } = await dbQuery(
      `SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1`
    );
    const n = Number(rows?.[0]?.fleet_avg_miles_per_month);
    if (Number.isFinite(n) && n >= MIN_AVG && n <= MAX_AVG) return Math.round(n);
  } catch {
    /* table missing until migrate */
  }
  return FALLBACK;
}

/**
 * Months from miles at given fleet average (FLOOR, minimum 1 when miles > 0).
 * @param {number|null|undefined} miles
 * @param {number} avgPerMonth
 */
export function milesToFloorMonths(miles, avgPerMonth) {
  if (miles == null || miles === '') return null;
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= 0) return null;
  const a = Number(avgPerMonth) > 0 ? Number(avgPerMonth) : FALLBACK;
  return Math.max(1, Math.floor(m / a));
}

/** @deprecated Use milesToFloorMonths */
export const milesToRoundMonths = milesToFloorMonths;

/** Keep fleet-wide `vehicle_maintenance_schedules` rows aligned with `service_types`. */
export async function applyFleetCatalogMonthOverrides(dbQuery) {
  if (!dbQuery) return;
  await dbQuery(
    `UPDATE vehicle_maintenance_schedules v
     SET interval_miles = st.interval_miles, interval_months = st.interval_months
     FROM service_types st
     WHERE v.service_type_id = st.id AND v.unit_code IS NULL`
  );
}

/** Recompute stored month columns from mileage at a new fleet average (FLOOR, min 1). */
export async function recalcAllIntervalMonthsFromFleetAvg(dbQuery, avg) {
  const a = clampFleetAvgMilesPerMonth(avg);
  if (!dbQuery) return a;
  await dbQuery(
    `UPDATE service_types SET interval_months = CASE
       WHEN interval_miles IS NULL THEN NULL
       ELSE GREATEST(1, FLOOR(interval_miles::numeric / $1))
     END`,
    [a]
  );
  await dbQuery(
    `UPDATE vehicle_maintenance_schedules SET interval_months = CASE
       WHEN interval_miles IS NULL THEN NULL
       ELSE GREATEST(1, FLOOR(interval_miles::numeric / $1))
     END`,
    [a]
  );
  await dbQuery(
    `UPDATE vehicle_parts_reference SET avg_replacement_months = CASE
       WHEN avg_replacement_miles IS NULL THEN NULL
       ELSE GREATEST(1, FLOOR(avg_replacement_miles::numeric / $1))
     END`,
    [a]
  );
  await applyFleetCatalogMonthOverrides(dbQuery);
  return a;
}

/**
 * Human-readable remaining / overdue time from miles at fleet pace.
 * Rules: if >2 months equivalent → months; else if ≥1 week and ≤8 weeks → weeks; else days.
 * @param {number} milesRemaining — may be negative (overdue)
 */
export function formatFleetPaceDueLabel(milesRemaining, fleetAvg) {
  const mr = Number(milesRemaining);
  const fa = Number(fleetAvg) > 0 ? Number(fleetAvg) : FALLBACK;
  if (!Number.isFinite(mr) || !Number.isFinite(fa) || fa <= 0) return '—';
  const milesPerWeek = fa / 4.345;
  const equivMo = mr / fa;
  const approxDays = equivMo * 30;
  if (mr < 0) {
    const absMr = Math.abs(mr);
    const absMo = absMr / fa;
    const absDays = absMo * 30;
    if (absMo > 2) return `${Math.max(1, Math.floor(absMo))} months overdue`;
    if (absDays >= 7) return `${Math.max(1, Math.round(absMr / milesPerWeek))} weeks overdue`;
    return `${Math.max(1, Math.round(absDays))} days overdue`;
  }
  if (equivMo > 2) return `${Math.round(equivMo * 10) / 10} months`;
  if (approxDays >= 7) return `${Math.max(1, Math.round(mr / milesPerWeek))} weeks`;
  return `${Math.max(1, Math.round(approxDays))} days`;
}

/**
 * Display-scale hint for miles remaining at fleet pace (spec: months if >2mo away, weeks if 1–8 weeks, days if <1 week).
 * @param {number} milesRemaining — may be negative (overdue)
 */
export function breakdownTimeFromMilesRemaining(milesRemaining, fleetAvg) {
  const mr = Number(milesRemaining);
  const fa = Number(fleetAvg) > 0 ? Number(fleetAvg) : FALLBACK;
  if (!Number.isFinite(mr) || !Number.isFinite(fa) || fa <= 0) {
    return {
      months_remaining: null,
      weeks_remaining: null,
      days_remaining: null,
      time_unit: 'unknown',
      estimated_due_date: null,
      months_overdue: null,
      display_label: '—'
    };
  }
  const equivMo = mr / fa;
  const approxDays = equivMo * 30;
  const milesPerWeek = fa / 4.345;
  const display_label = formatFleetPaceDueLabel(mr, fa);
  if (mr < 0) {
    const absMo = Math.abs(equivMo);
    return {
      months_remaining: Math.round(equivMo * 10) / 10,
      weeks_remaining: approxDays <= -7 ? Math.round(Math.abs(mr) / milesPerWeek) : null,
      days_remaining: approxDays > -7 ? Math.max(1, Math.round(Math.abs(approxDays))) : null,
      time_unit: absMo > 2 ? 'months' : Math.abs(approxDays) >= 7 ? 'weeks' : 'days',
      estimated_due_date: null,
      months_overdue: absMo > 2 ? Math.round(absMo * 10) / 10 : null,
      display_label
    };
  }
  const approxDaysPos = approxDays;
  if (equivMo > 2) {
    return {
      months_remaining: Math.round(equivMo * 10) / 10,
      weeks_remaining: null,
      days_remaining: null,
      time_unit: 'months',
      estimated_due_date: addCalendarDays(new Date(), Math.round(approxDaysPos)).toISOString().slice(0, 10),
      months_overdue: null,
      display_label
    };
  }
  if (approxDaysPos >= 7) {
    const wk = Math.max(1, Math.round(mr / milesPerWeek));
    return {
      months_remaining: Math.round(equivMo * 10) / 10,
      weeks_remaining: wk,
      days_remaining: null,
      time_unit: 'weeks',
      estimated_due_date: addCalendarDays(new Date(), Math.round(approxDaysPos)).toISOString().slice(0, 10),
      months_overdue: null,
      display_label
    };
  }
  const d = Math.max(1, Math.round(approxDaysPos));
  return {
    months_remaining: Math.round(equivMo * 10) / 10,
    weeks_remaining: null,
    days_remaining: d,
    time_unit: 'days',
    estimated_due_date: addCalendarDays(new Date(), d).toISOString().slice(0, 10),
    months_overdue: null,
    display_label
  };
}

function addCalendarDays(d, days) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/** One-line catalog interval: "Every 25,000 mi (≈ 2 months at fleet avg)" */
export function formatIntervalDualLine(intervalMiles, intervalMonths, fleetAvg) {
  const mi = intervalMiles != null && Number.isFinite(Number(intervalMiles)) ? Number(intervalMiles) : null;
  const mo =
    intervalMonths != null && Number.isFinite(Number(intervalMonths))
      ? Number(intervalMonths)
      : mi != null
        ? milesToFloorMonths(mi, fleetAvg)
        : null;
  const avgLabel = Number(fleetAvg || FALLBACK).toLocaleString('en-US');
  if (mi != null && mo != null) {
    return {
      milesLine: `Every ${mi.toLocaleString('en-US')} mi`,
      monthsLine: `(≈ ${mo} months at fleet avg)`,
      combined: `Every ${mi.toLocaleString('en-US')} mi (≈ ${mo} months at fleet avg)`
    };
  }
  if (mi != null) {
    const est = milesToFloorMonths(mi, fleetAvg);
    return {
      milesLine: `Every ${mi.toLocaleString('en-US')} mi`,
      monthsLine: est != null ? `(≈ ${est} months at fleet avg)` : '',
      combined:
        est != null
          ? `Every ${mi.toLocaleString('en-US')} mi (≈ ${est} months at fleet avg)`
          : `Every ${mi.toLocaleString('en-US')} mi`
    };
  }
  if (mo != null) {
    return { milesLine: 'Time-based', monthsLine: `Every ${mo} mo`, combined: `Every ${mo} mo` };
  }
  return { milesLine: 'As needed', monthsLine: '', combined: 'As needed' };
}
