export type MaintFleetCategory =
  | 'trucks'
  | 'ref_vans'
  | 'flatbeds'
  | 'dry_vans'
  | 'company'

export type MaintFleetUnit = {
  id: string
  unitNo: string
  makeModel: string
  /** Matches `VEHICLE_MAKE_OPTIONS` keys for PM schedule */
  vehicleMakeKey: string
  mileage: number
  /** 0–100 */
  fuelPct: number
  fleet: MaintFleetCategory
  pastDue: boolean
  dueSoon: boolean
  /** Lowercase haystack for “filter by service” */
  serviceHaystack: string
}

export const MAINT_FLEET_CHIPS: { id: MaintFleetCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trucks', label: 'Trucks' },
  { id: 'ref_vans', label: 'Ref Vans' },
  { id: 'flatbeds', label: 'Flatbeds' },
  { id: 'dry_vans', label: 'Dry Vans' },
  { id: 'company', label: 'Company' },
]

export const MAINT_FLEET_UNITS: MaintFleetUnit[] = [
  {
    id: '101',
    unitNo: '101',
    makeModel: 'Freightliner Cascadia',
    vehicleMakeKey: 'freightliner_cascadia',
    mileage: 418200,
    fuelPct: 72,
    fleet: 'trucks',
    pastDue: false,
    dueSoon: true,
    serviceHaystack: 'oil pm brake inspection',
  },
  {
    id: '104',
    unitNo: '104',
    makeModel: 'Volvo VNL 860',
    vehicleMakeKey: 'volvo_vnl',
    mileage: 392100,
    fuelPct: 45,
    fleet: 'trucks',
    pastDue: true,
    dueSoon: false,
    serviceHaystack: 'dpf derate coolant leak',
  },
  {
    id: '204',
    unitNo: '204',
    makeModel: 'Great Dane Reefer',
    vehicleMakeKey: 'generic',
    mileage: 289400,
    fuelPct: 88,
    fleet: 'ref_vans',
    pastDue: false,
    dueSoon: false,
    serviceHaystack: 'reefer annual door seal',
  },
  {
    id: '312',
    unitNo: '312',
    makeModel: 'Wabash Dry Van',
    vehicleMakeKey: 'generic',
    mileage: 501200,
    fuelPct: 33,
    fleet: 'dry_vans',
    pastDue: true,
    dueSoon: false,
    serviceHaystack: 'landing gear roof patch',
  },
  {
    id: '415',
    unitNo: '415',
    makeModel: 'Fontaine Flatbed',
    vehicleMakeKey: 'generic',
    mileage: 178900,
    fuelPct: 61,
    fleet: 'flatbeds',
    pastDue: false,
    dueSoon: true,
    serviceHaystack: 'binders winch deck weld',
  },
  {
    id: '501',
    unitNo: '501',
    makeModel: 'Ford F-550 Service',
    vehicleMakeKey: 'generic',
    mileage: 84200,
    fuelPct: 94,
    fleet: 'company',
    pastDue: false,
    dueSoon: false,
    serviceHaystack: 'dot annual light bar',
  },
  {
    id: '118',
    unitNo: '118',
    makeModel: 'Kenworth T680',
    vehicleMakeKey: 'generic',
    mileage: 612000,
    fuelPct: 22,
    fleet: 'trucks',
    pastDue: true,
    dueSoon: true,
    serviceHaystack: 'tires alignment turbo',
  },
  {
    id: '220',
    unitNo: '220',
    makeModel: 'Utility Reefer',
    vehicleMakeKey: 'generic',
    mileage: 334000,
    fuelPct: 77,
    fleet: 'ref_vans',
    pastDue: false,
    dueSoon: true,
    serviceHaystack: 'pm reefer unit belt',
  },
]
