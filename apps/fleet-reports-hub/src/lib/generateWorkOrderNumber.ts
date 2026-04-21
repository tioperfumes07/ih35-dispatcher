/** Internal / external / roadside work order number (spec: IWO-UNIT-YYYYMMDD, duplicate suffix -2, -3, …). */
export type WorkOrderNumberKind = 'IWO' | 'EWO' | 'RSWO'

export function formatWorkOrderNumber(
  kind: WorkOrderNumberKind,
  unitCode: string,
  date: Date = new Date(),
  /** 0 = first of day, 1 → `-2`, 2 → `-3` */
  sameDayDuplicateIndex = 0,
): string {
  const u = String(unitCode || 'UNIT')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const suffix = sameDayDuplicateIndex <= 0 ? '' : `-${sameDayDuplicateIndex + 1}`
  return `${kind}-${u}-${y}${m}${d}${suffix}`
}

/** Session key for counting same-day WO saves (drives -2, -3 suffix on the next draft). */
export function workOrderDupStorageKey(
  kind: WorkOrderNumberKind,
  unitCode: string,
  date: Date,
): string {
  const u = String(unitCode || 'UNIT')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `fleet-wo-dup:${kind}-${u}-${y}${m}${d}`
}

export function readWorkOrderDupSeq(key: string): number {
  try {
    const n = parseInt(sessionStorage.getItem(key) ?? '0', 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function bumpWorkOrderDupSeq(key: string) {
  try {
    const next = readWorkOrderDupSeq(key) + 1
    sessionStorage.setItem(key, String(next))
  } catch {
    /* ignore */
  }
}
