/**
 * Fleet average miles per truck per month — stored in Postgres `erp_fleet_defaults`.
 * Catalog `interval_months` uses FLOOR(miles / avg), minimum 1, plus slug overrides (see `applyFleetCatalogMonthOverrides`).
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
 * Months from miles at given fleet average (FLOOR, minimum 1 when miles > 0). Matches catalog SQL.
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

/** @deprecated Catalog uses {@link milesToFloorMonths}; kept for older imports. */
export function milesToRoundMonths(miles, avgPerMonth) {
  return milesToFloorMonths(miles, avgPerMonth);
}

/** After FLOOR-based recompute, align catalog rows with fleet scheduling overrides. */
export async function applyFleetCatalogMonthOverrides(dbQuery) {
  if (!dbQuery) return;
  await dbQuery(
    `UPDATE service_types SET interval_months = 12
     WHERE slug IN (
       'air_dryer_cartridge_replacement',
       'tire_replacement_drive',
       'dpf_cleaning_volvo_vnr',
       'dpf_cleaning_peterbilt_567'
     )
       AND interval_miles IS NOT NULL
       AND interval_miles BETWEEN 140000 AND 160000`
  );
  await dbQuery(
    `UPDATE service_types SET interval_months = 18
     WHERE slug IN ('dpf_cleaning', 'egr_valve_service')
       AND interval_miles >= 190000 AND interval_miles <= 210000`
  );
  await dbQuery(
    `UPDATE service_types SET interval_months = 42
     WHERE slug IN ('fuel_injector_service', 'transmission_fluid_service')
       AND interval_miles >= 450000`
  );
  await dbQuery(
    `UPDATE vehicle_maintenance_schedules v
     SET interval_miles = st.interval_miles, interval_months = st.interval_months
     FROM service_types st
     WHERE v.service_type_id = st.id AND v.unit_code IS NULL`
  );
  await dbQuery(
    `UPDATE vehicle_parts_reference SET avg_replacement_months = 12
     WHERE part_key IN ('drive_tire', 'air_dryer_cartridge')
       AND avg_replacement_miles IS NOT NULL
       AND avg_replacement_miles BETWEEN 140000 AND 160000`
  );
  await dbQuery(
    `UPDATE vehicle_parts_reference SET avg_replacement_months = 18
     WHERE part_key = 'egr_valve' AND avg_replacement_miles BETWEEN 190000 AND 210000`
  );
  await dbQuery(
    `UPDATE vehicle_parts_reference SET avg_replacement_months = 42
     WHERE part_key IN ('fuel_injector_set', 'dpf', 'scr_catalyst', 'fifth_wheel_complete')
       AND avg_replacement_miles >= 450000`
  );
}

/** Recompute stored month columns from mileage columns at a new fleet average (FLOOR, min 1). */
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
      months_overdue: null
    };
  }
  const months = mr / fa;
  if (mr < 0) {
    const mo = Math.abs(months);
    return {
      months_remaining: Math.round(months * 10) / 10,
      weeks_remaining: null,
      days_remaining: null,
      time_unit: 'months',
      estimated_due_date: null,
      months_overdue: Math.round(mo * 10) / 10
    };
  }
  const approxDays = months * 30;
  if (approxDays > 60) {
    return {
      months_remaining: Math.round(months * 10) / 10,
      weeks_remaining: null,
      days_remaining: null,
      time_unit: 'months',
      estimated_due_date: addCalendarDays(new Date(), Math.round(approxDays)).toISOString().slice(0, 10),
      months_overdue: null
    };
  }
  if (approxDays > 7) {
    const wk = Math.max(1, Math.round(approxDays / 7));
    return {
      months_remaining: Math.round(months * 10) / 10,
      weeks_remaining: wk,
      days_remaining: null,
      time_unit: 'weeks',
      estimated_due_date: addCalendarDays(new Date(), Math.round(approxDays)).toISOString().slice(0, 10),
      months_overdue: null
    };
  }
  const d = Math.max(1, Math.round(approxDays));
  return {
    months_remaining: Math.round(months * 10) / 10,
    weeks_remaining: null,
    days_remaining: d,
    time_unit: 'days',
    estimated_due_date: addCalendarDays(new Date(), d).toISOString().slice(0, 10),
    months_overdue: null
  };
}

function addCalendarDays(d, days) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export function formatIntervalDualLine(intervalMiles, intervalMonths, fleetAvg) {
  const mi = intervalMiles != null && Number.isFinite(Number(intervalMiles)) ? Number(intervalMiles) : null;
  const mo = intervalMonths != null && Number.isFinite(Number(intervalMonths)) ? Number(intervalMonths) : null;
  if (mi != null && mo != null) {
    return {
      milesLine: `${mi.toLocaleString('en-US')} mi`,
      monthsLine: `≈ ${mo} mo at ${Number(fleetAvg || FALLBACK).toLocaleString('en-US')} mi/mo avg`
    };
  }
  if (mi != null) {
    const est = milesToFloorMonths(mi, fleetAvg);
    return {
      milesLine: `${mi.toLocaleString('en-US')} mi`,
      monthsLine: est != null ? `≈ ${est} mo at fleet avg` : ''
    };
  }
  if (mo != null) {
    return { milesLine: 'Time-based', monthsLine: `Every ${mo} mo` };
  }
  return { milesLine: 'As needed', monthsLine: '' };
}
