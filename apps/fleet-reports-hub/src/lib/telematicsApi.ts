/** Client-side cache (5 min) aligned with server Samsara fleet bundle TTL. */

const TTL_MS = 5 * 60 * 1000

type CacheEntry<T> = { at: number; data: T }

let fleetCache: CacheEntry<unknown> | null = null
let integrityCache: CacheEntry<unknown> | null = null

export async function fetchFleetCache<T = unknown>(): Promise<T> {
  if (fleetCache && Date.now() - fleetCache.at < TTL_MS) {
    return fleetCache.data as T
  }
  const res = await fetch('/api/samsara/fleet-cache')
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as T
  fleetCache = { at: Date.now(), data }
  return data
}

export async function fetchFleetIntegrity<T = unknown>(): Promise<T> {
  if (integrityCache && Date.now() - integrityCache.at < TTL_MS) {
    return integrityCache.data as T
  }
  const res = await fetch('/api/integrity/fleet-vehicles')
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as T
  integrityCache = { at: Date.now(), data }
  return data
}

export function invalidateTelematicsClientCache() {
  fleetCache = null
  integrityCache = null
}

export async function postRefreshSamsara() {
  invalidateTelematicsClientCache()
  const res = await fetch('/api/samsara/refresh', { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchVehicleIntegrity(unit: string) {
  const res = await fetch(
    `/api/integrity/vehicle/${encodeURIComponent(unit)}`,
  )
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
