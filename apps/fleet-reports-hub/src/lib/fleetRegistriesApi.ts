export type DriverRow = {
  id: number
  samsara_id: string | null
  full_name: string
  first_name: string | null
  last_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  email: string | null
  cdl_number: string | null
  cdl_state: string | null
  cdl_expiry: string | null
  assigned_unit: string | null
  qbo_vendor_id: string | null
  qbo_synced: boolean
  qbo_synced_at: string | null
  status: string
  samsara_synced_at: string | null
  created_at: string
  updated_at: string
}

export type VendorLocalRow = {
  id: number
  qbo_vendor_id: string | null
  display_name: string
  company_name: string | null
  first_name: string | null
  last_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  phone: string | null
  email: string | null
  vendor_type: string | null
  tax_id: string | null
  payment_terms: string | null
  qbo_synced: boolean
  qbo_synced_at: string | null
  status: string
  created_at: string
  updated_at: string
}

export type AssetRow = {
  id: number
  samsara_id: string | null
  unit_number: string
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  license_plate: string | null
  license_state: string | null
  odometer_miles: number | null
  engine_hours: number | null
  fuel_type: string | null
  asset_type: string
  qbo_class_id: string | null
  qbo_class_name: string | null
  qbo_synced: boolean
  status: string
  samsara_synced_at: string | null
  created_at: string
  updated_at: string
}


export type FleetAssetProfile = {
  samsara_id: string
  unit_number: string
  asset_type: 'Truck' | 'Reefer Van' | 'Flatbed' | 'Dry Van' | 'Company Vehicle' | 'Trailer' | 'Other'
  status: 'Active' | 'In Shop' | 'Out of Service' | 'Sold' | 'Crashed/Total Loss' | 'Permanently Removed'
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  licensePlate: string | null
  notes: string | null
  odometerMiles: number | null
  engineHours: number | null
  lastGpsLat: number | null
  lastGpsLng: number | null
  lastGpsTime: string | null
  updated_at: string | null
}

export type FleetAssetProfilePatch = {
  unit_number?: string | null
  asset_type?: FleetAssetProfile['asset_type']
  status?: FleetAssetProfile['status']
  vin_override?: string | null
  license_plate_override?: string | null
  year_override?: number | null
  make_override?: string | null
  model_override?: string | null
  notes?: string | null
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export async function fetchDrivers() {
  return j<{ drivers: DriverRow[] }>('/api/drivers')
}

export async function syncDriversSamsara() {
  return j<{ synced: number; errors?: { id: number; error: string }[]; message?: string }>(
    '/api/drivers/sync-samsara',
  )
}

export async function syncDriversQbo() {
  return j<{
    synced: number
    errors?: { id: number; error: string }[]
    message?: string
    updated?: number
  }>('/api/drivers/sync-qbo', { method: 'POST' })
}

export async function fetchVendorsLocal() {
  return j<{ vendors: VendorLocalRow[] }>('/api/vendors-local')
}

export async function syncVendorsFromQbo() {
  return j<{ synced: number; refreshedAt?: string; message?: string }>('/api/vendors-local/sync-qbo')
}

export async function fetchAssets() {
  return j<{ assets: AssetRow[] }>('/api/assets')
}

export async function syncAssetsSamsara() {
  return j<{
    synced: number
    inserted?: number
    skippedNoUnit?: number
    totalVehicles?: number
    errors?: unknown[]
    message?: string
  }>('/api/assets/sync-samsara')
}

export async function syncAssetsQboClasses() {
  return j<{
    synced: number
    errors?: { id: number; unit?: string; error: string }[]
    message?: string
    updated?: number
  }>('/api/assets/sync-qbo-classes', {
    method: 'POST',
  })
}

export type DriverPatch = Partial<
  Pick<
    DriverRow,
    | 'full_name'
    | 'first_name'
    | 'last_name'
    | 'address'
    | 'city'
    | 'state'
    | 'zip'
    | 'country'
    | 'phone'
    | 'email'
    | 'cdl_number'
    | 'cdl_state'
    | 'cdl_expiry'
    | 'assigned_unit'
    | 'status'
    | 'qbo_vendor_id'
  >
>

export async function createDriver(body: { full_name: string }) {
  return j<{ driver: DriverRow }>('/api/drivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function patchDriver(id: number, body: DriverPatch) {
  return j<{ driver: DriverRow }>(`/api/drivers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteDriver(id: number) {
  return j<{ ok: boolean; deleted: number }>(`/api/drivers/${id}`, { method: 'DELETE' })
}

export type VendorLocalPatch = Partial<
  Pick<
    VendorLocalRow,
    | 'display_name'
    | 'company_name'
    | 'address'
    | 'city'
    | 'state'
    | 'zip'
    | 'country'
    | 'phone'
    | 'email'
    | 'vendor_type'
    | 'tax_id'
    | 'payment_terms'
    | 'status'
  >
>

export async function createVendorLocal(body: { display_name: string; qbo_vendor_id?: string }) {
  return j<{ vendor: VendorLocalRow }>('/api/vendors-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function patchVendorLocal(id: number, body: VendorLocalPatch) {
  return j<{ vendor: VendorLocalRow }>(`/api/vendors-local/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteVendorLocal(id: number) {
  return j<{ ok: boolean; deleted: number }>(`/api/vendors-local/${id}`, { method: 'DELETE' })
}

export type AssetPatch = Partial<
  Pick<
    AssetRow,
    | 'unit_number'
    | 'year'
    | 'make'
    | 'model'
    | 'vin'
    | 'license_plate'
    | 'license_state'
    | 'odometer_miles'
    | 'engine_hours'
    | 'fuel_type'
    | 'asset_type'
    | 'status'
    | 'qbo_class_name'
    | 'qbo_class_id'
    | 'samsara_id'
  >
>

export async function createAsset(body: { unit_number: string }) {
  return j<{ asset: AssetRow }>('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function patchAsset(id: number, body: AssetPatch) {
  return j<{ asset: AssetRow }>(`/api/assets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteAsset(id: number) {
  return j<{ ok: boolean; deleted: number }>(`/api/assets/${id}`, { method: 'DELETE' })
}


export async function fetchFleetAssetProfiles() {
  return j<{ ok: boolean; assets: FleetAssetProfile[]; count: number }>('/api/fleet/assets')
}

export async function updateFleetAssetProfile(samsaraId: string, body: FleetAssetProfilePatch) {
  return j<{ ok: boolean; asset: FleetAssetProfile | null }>(`/api/fleet/assets/${encodeURIComponent(samsaraId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchFleetAssetUnits() {
  return j<{
    ok: boolean
    units: Array<{
      samsara_id: string
      unit_number: string
      asset_type: FleetAssetProfile['asset_type']
      status: FleetAssetProfile['status']
      make: string | null
      model: string | null
      year: number | null
      vin: string | null
      licensePlate: string | null
    }>
    count: number
  }>('/api/fleet/assets/units')
}
