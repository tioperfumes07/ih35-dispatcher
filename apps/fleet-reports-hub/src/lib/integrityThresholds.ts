/** Default + persisted configurable thresholds for integrity checks. */

export type IntegrityThresholds = {
  /** Used for FLOOR(months) = miles ÷ fleet_avg_miles_per_month on PM lines */
  fleet_avg_miles_per_month: number
  t1_max_tires_per_unit_90d: number
  t2_same_position_max_180d: number
  t3_cost_vs_avg_multiplier: number
  t4_fleet_tires_per_month: number
  d1_repairs_per_driver_90d: number
  d2_accidents_per_driver_year: number
  d3_driver_spend_90d: number
  d4_same_driver_unit_60d: number
  f1_consumption_pct_above_avg: number
  f4_price_spike_pct: number
  m1_single_repair_vs_avg: number
  m2_monthly_spend_per_unit: number
  m3_records_per_unit_60d: number
  m4_vendor_invoice_pct_above_avg: number
}

export const DEFAULT_THRESHOLDS: IntegrityThresholds = {
  fleet_avg_miles_per_month: 12000,
  t1_max_tires_per_unit_90d: 8,
  t2_same_position_max_180d: 3,
  t3_cost_vs_avg_multiplier: 2.5,
  t4_fleet_tires_per_month: 20,
  d1_repairs_per_driver_90d: 3,
  d2_accidents_per_driver_year: 2,
  d3_driver_spend_90d: 5000,
  d4_same_driver_unit_60d: 2,
  f1_consumption_pct_above_avg: 30,
  f4_price_spike_pct: 20,
  m1_single_repair_vs_avg: 3,
  m2_monthly_spend_per_unit: 4000,
  m3_records_per_unit_60d: 6,
  m4_vendor_invoice_pct_above_avg: 40,
}

const KEY = 'fleet:integrity-thresholds'

export function loadThresholds(): IntegrityThresholds {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_THRESHOLDS }
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_THRESHOLDS }
  }
}

export function saveThresholds(t: Partial<IntegrityThresholds>) {
  const merged = { ...loadThresholds(), ...t }
  localStorage.setItem(KEY, JSON.stringify(merged))
  return merged
}
