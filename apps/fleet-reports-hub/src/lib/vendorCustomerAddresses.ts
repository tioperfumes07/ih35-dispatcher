/**
 * Vendor / customer address helpers.
 * Persists to localStorage until API + DB columns are wired; migration SQL
 * documents the intended schema for Postgres.
 */

export type VendorCustomerAddress = {
  street_address: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
}

const LS_ENTITY = 'fleet-reports:entity-address:'
const LS_NAME = 'fleet-reports:vendor-name-address:'

const SEED_BY_VENDOR: Record<string, VendorCustomerAddress> = {
  'ta petro': {
    street_address: '2468 Petro Plaza',
    city: 'Dallas',
    state: 'TX',
    zip: '75201',
    country: 'USA',
    phone: '(214) 555-0100',
  },
  'loves': {
    street_address: '1 Love\'s Dr',
    city: 'Oklahoma City',
    state: 'OK',
    zip: '73108',
    country: 'USA',
  },
  pilot: {
    street_address: '5501 Marathon Pkwy',
    city: 'Knoxville',
    state: 'TN',
    zip: '37909',
    country: 'USA',
  },
  def: {
    street_address: 'Bulk DEF Yard',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    country: 'USA',
  },
}

function normKey(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
}

function readLs<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeLs(key: string, v: VendorCustomerAddress) {
  localStorage.setItem(key, JSON.stringify(v))
}

export function lookupVendorAddressByName(vendorName: string): VendorCustomerAddress | null {
  const k = normKey(vendorName)
  if (!k) return null
  const fromLs = readLs<VendorCustomerAddress>(LS_NAME + k)
  if (fromLs && (fromLs.street_address || fromLs.city)) return fromLs
  for (const [seedKey, addr] of Object.entries(SEED_BY_VENDOR)) {
    if (k.includes(seedKey) || seedKey.includes(k)) return { ...addr }
  }
  return null
}

export function saveVendorAddressByName(vendorName: string, addr: VendorCustomerAddress) {
  const k = normKey(vendorName)
  if (!k) return
  writeLs(LS_NAME + k, addr)
}

export function getStoredEntityAddress(entityId: string): VendorCustomerAddress | null {
  return readLs<VendorCustomerAddress>(LS_ENTITY + entityId)
}

export function saveEntityAddress(entityId: string, addr: VendorCustomerAddress) {
  writeLs(LS_ENTITY + entityId, addr)
}

export function emptyAddress(): VendorCustomerAddress {
  return {
    street_address: '',
    city: '',
    state: '',
    zip: '',
    country: 'USA',
    phone: '',
    email: '',
  }
}
