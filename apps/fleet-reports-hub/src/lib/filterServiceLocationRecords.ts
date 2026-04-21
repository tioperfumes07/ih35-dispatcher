import type { ReportFilters } from '../types'
import type { ServiceLocationRecord } from '../data/serviceLocationRecords'

function dateInRange(isoDate: string, from: string, to: string) {
  const d = isoDate.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function quickRangeBounds(q: ReportFilters['dateQuick']): { from: string; to: string } | null {
  if (!q) return null
  const to = new Date()
  const from = new Date(to)
  if (q === '7d') from.setDate(from.getDate() - 7)
  else if (q === '30d') from.setDate(from.getDate() - 30)
  else if (q === 'mtd') from.setDate(1)
  else if (q === 'qtd') {
    const m = to.getMonth() - (to.getMonth() % 3)
    from.setMonth(m, 1)
  } else if (q === 'ytd') {
    from.setMonth(0, 1)
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export function filterServiceLocationRecords(
  rows: ServiceLocationRecord[],
  filters: ReportFilters,
): ServiceLocationRecord[] {
  let out = rows

  const qr = quickRangeBounds(filters.dateQuick)
  if (qr) {
    out = out.filter((r) => dateInRange(r.date, qr.from, qr.to))
  } else {
    out = out.filter((r) =>
      dateInRange(r.date, filters.dateFrom || '0000-01-01', filters.dateTo || '9999-12-31'),
    )
  }

  if (filters.units.length) {
    out = out.filter((r) => filters.units.includes(r.unitId))
  }

  if (filters.serviceTypes.length) {
    out = out.filter((r) => filters.serviceTypes.includes(r.serviceType))
  }

  if (filters.recordTypes?.length) {
    out = out.filter((r) =>
      filters.recordTypes.some(
        (rt) => r.recordType.toLowerCase() === String(rt).toLowerCase(),
      ),
    )
  }

  if (filters.location.trim()) {
    const n = filters.location.trim().toLowerCase()
    out = out.filter(
      (r) =>
        r.locationName.toLowerCase().includes(n) ||
        r.vendor.toLowerCase().includes(n),
    )
  }

  if (filters.locationType) {
    out = out.filter((r) => r.locationType === filters.locationType)
  }

  if (filters.vendor.trim()) {
    const n = filters.vendor.trim().toLowerCase()
    out = out.filter((r) => r.vendor.toLowerCase().includes(n))
  }

  if (filters.driver.trim()) {
    const n = filters.driver.trim().toLowerCase()
    out = out.filter((r) => r.driver.toLowerCase().includes(n))
  }

  if (filters.make.trim()) {
    const n = filters.make.trim().toLowerCase()
    out = out.filter((r) => r.make.toLowerCase().includes(n))
  }

  if (filters.costMin.trim()) {
    const m = parseFloat(filters.costMin)
    if (!Number.isNaN(m)) out = out.filter((r) => r.cost >= m)
  }
  if (filters.costMax.trim()) {
    const m = parseFloat(filters.costMax)
    if (!Number.isNaN(m)) out = out.filter((r) => r.cost <= m)
  }

  return out
}
