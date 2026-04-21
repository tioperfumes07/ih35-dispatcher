export type BillFrequency = 'weekly' | 'monthly' | 'quarterly' | 'custom'

function clone(d: Date) {
  return new Date(d.getTime())
}

function addDays(d: Date, days: number) {
  const x = clone(d)
  x.setDate(x.getDate() + days)
  return x
}

function addMonths(d: Date, months: number) {
  const x = clone(d)
  const day = x.getDate()
  x.setMonth(x.getMonth() + months)
  if (x.getDate() < day) x.setDate(0)
  return x
}

export function seriesDates(
  firstBillDate: string,
  frequency: BillFrequency,
  count: number,
  customEveryDays: number,
): Date[] {
  const start = new Date(firstBillDate + 'T12:00:00')
  if (Number.isNaN(start.getTime())) return []
  const n = Math.max(0, Math.floor(count))
  const out: Date[] = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push(clone(start))
      continue
    }
    const prev = out[i - 1]!
    if (frequency === 'weekly') out.push(addDays(prev, 7))
    else if (frequency === 'monthly') out.push(addMonths(prev, 1))
    else if (frequency === 'quarterly') out.push(addMonths(prev, 3))
    else out.push(addDays(prev, Math.max(1, Math.floor(customEveryDays || 30))))
  }
  return out
}

export function formatISODate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function isPastBill(d: Date, today = new Date()) {
  const t0 = new Date(today.toDateString())
  const d0 = new Date(d.toDateString())
  return d0 < t0
}
