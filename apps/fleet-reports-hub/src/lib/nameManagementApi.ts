export type NameEntityRow = {
  id: string
  kind: string
  label: string
  sources: string[]
  nameMismatch: boolean
  recentlyRenamed: boolean
  lastRenamedAt: string | null
}

export type SystemCell = {
  system: string
  name: string | null
  aligned: boolean | null
}

export type NameEntityDetail = {
  entity: Record<string, unknown>
  systems: SystemCell[]
  consensusHint: string
  erpRefCount: number
  driverLink: { samsara_driver_id: string; erp_driver_id: string; link_type: string } | null
  needsManualDriverLink: boolean
  allNamesMatch: boolean
}

export async function fetchNameEntities(q: string, filter: string) {
  const res = await fetch(
    `/api/name-management/entities?${new URLSearchParams({ q, filter })}`,
  )
  const data = (await res.json()) as { entities?: NameEntityRow[]; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.entities ?? []
}

export async function fetchNameEntityDetail(id: string) {
  const res = await fetch(`/api/name-management/entities/${encodeURIComponent(id)}`)
  const data = (await res.json()) as NameEntityDetail & { error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export async function fetchSamsaraDriverPool() {
  const res = await fetch('/api/name-management/samsara-options')
  const data = (await res.json()) as { drivers?: { id: string; name: string }[]; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.drivers ?? []
}

export async function postApplyRename(body: {
  entityId: string
  canonical: string
  updateQbo: boolean
  updateSamsara: boolean
  updateErp: boolean
}) {
  const res = await fetch('/api/name-management/apply-rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as {
    status?: string
    results?: Record<string, { status: string; detail: string }>
    error?: string
  }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return {
    status: data.status ?? 'unknown',
    results: data.results ?? {},
  }
}

export async function postBulkRename(items: Record<string, unknown>[]) {
  const res = await fetch('/api/name-management/bulk-rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const data = (await res.json()) as {
    summary?: string
    results?: unknown[]
    error?: string
  }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export async function postDriverLink(erpDriverId: string, samsaraDriverId: string) {
  const res = await fetch('/api/name-management/driver-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ erpDriverId, samsaraDriverId }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}
