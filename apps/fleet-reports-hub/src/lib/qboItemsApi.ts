export type QboItemRow = {
  id: string
  name: string
  category: string
  sku?: string
}

export async function fetchQboItems(q?: string): Promise<QboItemRow[]> {
  const sp = new URLSearchParams()
  if (q?.trim()) sp.set('q', q.trim())
  const res = await fetch(`/api/accounting/qbo-items?${sp}`)
  const data = (await res.json()) as { items?: QboItemRow[]; error?: string }
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data.items ?? []
}
