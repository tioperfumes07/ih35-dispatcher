import type { PartRefApiRow, ServiceRecordType, ServiceTypeRow } from '../types/serviceCatalog'

export async function fetchServiceTypes(opts?: {
  recordType?: ServiceRecordType | 'all'
  q?: string
  category?: string
}) {
  const sp = new URLSearchParams()
  if (opts?.recordType && opts.recordType !== 'all') sp.set('recordType', opts.recordType)
  if (opts?.q) sp.set('q', opts.q)
  if (opts?.category) sp.set('category', opts.category)
  const res = await fetch(`/api/catalog/service-types?${sp}`)
  const data = (await res.json()) as { services?: ServiceTypeRow[]; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.services ?? []
}

export async function saveServiceType(service: Partial<ServiceTypeRow> & { service_key: string; service_name: string }) {
  const res = await fetch('/api/catalog/service-types/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service }),
  })
  const data = (await res.json()) as { service?: ServiceTypeRow; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.service!
}

export async function fetchPartsCatalog(q?: string, category?: string) {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (category) sp.set('category', category)
  const res = await fetch(`/api/catalog/parts?${sp}`)
  const data = (await res.json()) as { parts?: PartRefApiRow[]; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.parts ?? []
}

export async function savePart(part: PartRefApiRow) {
  const res = await fetch('/api/catalog/parts/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ part }),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
}
