export type EntityType = 'vendor' | 'customer'

export type CatalogParty = {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  qboId?: string
  qboActive?: boolean
  active?: boolean
  billsCount?: number
  expensesCount?: number
  posCount?: number
}

export type DedupGroup = {
  groupKey: string
  confidencePct: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  rulesMatched: string[]
  recordA: CatalogParty
  recordB: CatalogParty
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText)
  }
  return data as T
}

export function fetchAccountingDbStatus() {
  return j<{
    ok: boolean
    mergeLogTable: boolean
    dedupSkippedTable: boolean
    mergesLastHour: number | null
    missingTables?: string[]
    message: string
  }>('/api/accounting/db-status')
}

export function fetchDedupCounts() {
  return j<{ vendorGroupCount: number; customerGroupCount: number }>(
    '/api/accounting/dedup/counts',
  )
}

export function fetchDedupCandidates(entityType: EntityType) {
  const q = entityType === 'customer' ? 'customer' : 'vendor'
  return j<{ entityType: EntityType; groups: DedupGroup[] }>(
    `/api/accounting/dedup/candidates?entityType=${q}`,
  )
}

export function fetchMergeHistory(limit = 50) {
  return j<{ rows: MergeHistoryRow[] }>(`/api/accounting/merge-history?limit=${limit}`)
}

export type MergeHistoryRow = {
  id: string
  entity_type: EntityType
  kept_party_id: string
  merged_party_id: string
  kept_name_final: string
  merged_name_final: string
  confidence_pct: number
  confidence_band: string
  rulesMatched: string[]
  transfers: Record<string, unknown>
  qboVerified: boolean
  erpUpdated: boolean
  created_at: string
}

export function searchCatalogParties(entityType: EntityType, q: string) {
  const et = entityType === 'customer' ? 'customer' : 'vendor'
  const enc = encodeURIComponent(q)
  return j<{ entityType: EntityType; parties: CatalogParty[] }>(
    `/api/accounting/parties/search?entityType=${et}&q=${enc}`,
  )
}

export function postDedupSkip(body: {
  entityType: EntityType
  partyIdA: string
  partyIdB: string
  groupKey?: string
  reason?: string
}) {
  return j<{ ok: boolean; id: string; groupKey: string }>('/api/accounting/dedup-skip', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function postMergeExecute(body: {
  entityType: EntityType
  keepId: string
  mergeId: string
}) {
  return j<{
    ok: boolean
    mergeLogId: string
    kept: { id: string; name: string; qboId?: string }
    merged: { id: string; name: string; qboActive: boolean; deactivatedInQbo: boolean }
    qboVerified: boolean
    transfers: Record<string, unknown>
    erpUpdated: boolean
    rulesMatched: string[]
    confidencePct: number
    confidenceBand: string
  }>('/api/accounting/merge-execute', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
