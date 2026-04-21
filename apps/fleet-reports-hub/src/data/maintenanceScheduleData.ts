/** Mirrors DB seed: fleet avg + schedules + parts (until API loads from Postgres). */

export const FLEET_AVG_MILES_PER_MONTH = 12000

export const VEHICLE_MAKE_OPTIONS = [
  { key: 'freightliner_cascadia', label: 'Freightliner Cascadia' },
  { key: 'mack_anthem', label: 'Mack Anthem' },
  { key: 'peterbilt_579', label: 'Peterbilt 579' },
  { key: 'peterbilt_567', label: 'Peterbilt 567' },
  { key: 'peterbilt_389', label: 'Peterbilt 389' },
  { key: 'volvo_vnl', label: 'Volvo VNL' },
  { key: 'volvo_vnr', label: 'Volvo VNR' },
  { key: 'generic', label: 'Generic (all makes fallback)' },
] as const

export type VehicleMakeKey = (typeof VEHICLE_MAKE_OPTIONS)[number]['key']

export type ScheduleRow = {
  vehicleMakeKey: VehicleMakeKey
  serviceKey: string
  serviceLabel: string
  intervalMiles: number
  intervalMonthsFloor: number
}

export const BASE_SERVICE_INTERVALS: {
  serviceKey: string
  serviceLabel: string
  intervalMiles: number
}[] = [
  { serviceKey: 'oil_change', serviceLabel: 'Oil change', intervalMiles: 25000 },
  { serviceKey: 'brake_adjustment', serviceLabel: 'Brake adjustment', intervalMiles: 25000 },
  { serviceKey: 'air_filter', serviceLabel: 'Air filter', intervalMiles: 50000 },
  { serviceKey: 'tire_steer', serviceLabel: 'Tire steer', intervalMiles: 100000 },
  { serviceKey: 'tire_drive', serviceLabel: 'Tire drive', intervalMiles: 150000 },
  { serviceKey: 'dpf_cleaning', serviceLabel: 'DPF cleaning', intervalMiles: 200000 },
  { serviceKey: 'battery', serviceLabel: 'Battery', intervalMiles: 150000 },
  { serviceKey: 'differential', serviceLabel: 'Differential', intervalMiles: 250000 },
  { serviceKey: 'transmission', serviceLabel: 'Transmission', intervalMiles: 500000 },
  { serviceKey: 'coolant', serviceLabel: 'Coolant', intervalMiles: 600000 },
]

export function monthsFloorFromMiles(
  intervalMiles: number,
  fleetAvg = FLEET_AVG_MILES_PER_MONTH,
) {
  return Math.floor(intervalMiles / fleetAvg)
}

export function buildAllScheduleRows(): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  for (const m of VEHICLE_MAKE_OPTIONS) {
    for (const s of BASE_SERVICE_INTERVALS) {
      rows.push({
        vehicleMakeKey: m.key,
        serviceKey: s.serviceKey,
        serviceLabel: s.serviceLabel,
        intervalMiles: s.intervalMiles,
        intervalMonthsFloor: monthsFloorFromMiles(s.intervalMiles),
      })
    }
  }
  return rows
}

export const ALL_SCHEDULE_ROWS = buildAllScheduleRows()

export function schedulesForMake(makeKey: string): ScheduleRow[] {
  const k = (VEHICLE_MAKE_OPTIONS.some((m) => m.key === makeKey) ? makeKey : 'generic') as VehicleMakeKey
  return ALL_SCHEDULE_ROWS.filter((r) => r.vehicleMakeKey === k)
}

export type PartRefRow = {
  category: string
  partName: string
  costLow: number
  costMid: number
  costHigh: number
  notes?: string
}

export const PARTS_REFERENCE: PartRefRow[] = [
  {
    category: 'tires',
    partName: 'Steer position (single)',
    costLow: 420,
    costMid: 780,
    costHigh: 1250,
    notes: 'Regional variance',
  },
  {
    category: 'tires',
    partName: 'Drive position (single)',
    costLow: 380,
    costMid: 720,
    costHigh: 1180,
  },
  { category: 'brakes', partName: 'Brake shoe kit (axle)', costLow: 180, costMid: 420, costHigh: 890 },
  { category: 'brakes', partName: 'Drum resurfacing', costLow: 90, costMid: 160, costHigh: 320 },
  {
    category: 'air_bags',
    partName: 'Air spring assembly',
    costLow: 220,
    costMid: 480,
    costHigh: 920,
  },
  { category: 'batteries', partName: 'Group 31 flooded', costLow: 140, costMid: 260, costHigh: 420 },
  { category: 'batteries', partName: 'AGM starting', costLow: 220, costMid: 380, costHigh: 620 },
  {
    category: 'engine_components',
    partName: 'Turbo cartridge',
    costLow: 1200,
    costMid: 2800,
    costHigh: 5200,
  },
  {
    category: 'engine_components',
    partName: 'Aftertreatment sensor kit',
    costLow: 180,
    costMid: 420,
    costHigh: 980,
  },
  {
    category: 'drivetrain',
    partName: 'Differential bearing kit',
    costLow: 320,
    costMid: 780,
    costHigh: 1600,
  },
  {
    category: 'drivetrain',
    partName: 'Transmission clutch pack',
    costLow: 2200,
    costMid: 4800,
    costHigh: 9200,
  },
]

export function formatIntervalHuman(
  intervalMiles: number,
  fleetAvg = FLEET_AVG_MILES_PER_MONTH,
) {
  const mo = monthsFloorFromMiles(intervalMiles, fleetAvg)
  const mi = intervalMiles.toLocaleString()
  return `Every ${mi} mi (≈ ${mo} months at fleet avg)`
}

/** Mock last completed mileage per service for a unit (demo). */
export function mockLastServiceMiles(
  unitId: string,
  serviceKey: string,
): number {
  const seed = (unitId + serviceKey).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const row = BASE_SERVICE_INTERVALS.find((s) => s.serviceKey === serviceKey)
  if (!row) return 0
  const phase = (seed % 9000) - 4500
  return Math.max(0, 380000 + phase - row.intervalMiles * 0.4)
}
