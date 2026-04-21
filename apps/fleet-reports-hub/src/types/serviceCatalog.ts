export type ServiceRecordType = 'maintenance' | 'repair'

export type ServiceTypeRow = {
  id: string
  service_key: string
  service_name: string
  interval_miles: number | null
  interval_months: number | null
  uses_position_map: boolean
  position_map_type: string | null
  service_category: string
  record_type: ServiceRecordType
  avg_cost_low: number | null
  avg_cost_high: number | null
  applies_to_makes: string[]
  notes: string
  is_manufacturer_required: boolean
  display_order: number
}

export type PartRefApiRow = {
  category: string
  part_name: string
  cost_low: number
  cost_mid: number
  cost_high: number
  notes?: string
}
