import type { ReportDef, ReportFilters } from '../types'
import { MOCK_SERVICE_TYPES } from '../data/reports'

export type MockLocationType = 'internal' | 'external' | 'roadside' | 'dealer'

export interface MockRow {
  date: string
  unit: string
  driver: string
  vendor: string
  amount: number
  category: string
  location: string
  locationType: MockLocationType
  recordKind: string
}

function hashSeed(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const units = ['101', '102', '204', '305', '412', '530']
const drivers = ['J. Ruiz', 'M. Chen', 'T. Okafor', 'S. Patel', 'L. Nguyen']
const vendors = ['Freightliner', 'TA Petro', 'Love’s', 'Goodyear', 'DealerNet']
const locNames = [
  'Dallas Terminal — Bay 3',
  'Houston Terminal — Lane A',
  'TA Petro Waco',
  'Love’s Ardmore',
  'Freightliner of Dallas',
  'I-45 mm 180',
]
const locTypes: MockLocationType[] = ['internal', 'external', 'roadside', 'dealer']

const RECORD_KINDS = [
  'Work order',
  'Repair order',
  'PM service',
  'Inspection',
  'Bill',
  'DVIR',
  'Fuel',
]

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

function rowMatchesFilters(r: MockRow, filters: ReportFilters) {
  const qr = quickRangeBounds(filters.dateQuick)
  const d = r.date.slice(0, 10)
  if (qr) {
    if (d < qr.from || d > qr.to) return false
  } else {
    if (filters.dateFrom && d < filters.dateFrom) return false
    if (filters.dateTo && d > filters.dateTo) return false
  }
  if (filters.units.length && !filters.units.includes(r.unit)) return false
  if (filters.serviceTypes.length && !filters.serviceTypes.includes(r.category)) return false
  if (filters.recordTypes?.length) {
    const ok = filters.recordTypes.some(
      (rt) => r.recordKind.toLowerCase() === String(rt).toLowerCase(),
    )
    if (!ok) return false
  }
  if (filters.location.trim()) {
    const n = filters.location.trim().toLowerCase()
    if (!r.location.toLowerCase().includes(n) && !r.vendor.toLowerCase().includes(n)) return false
  }
  if (filters.locationType && r.locationType !== filters.locationType) return false
  if (filters.vendor.trim() && !r.vendor.toLowerCase().includes(filters.vendor.trim().toLowerCase())) {
    return false
  }
  if (filters.driver.trim() && !r.driver.toLowerCase().includes(filters.driver.trim().toLowerCase())) {
    return false
  }
  if (filters.costMin.trim()) {
    const m = parseFloat(filters.costMin)
    if (!Number.isNaN(m) && r.amount < m) return false
  }
  if (filters.costMax.trim()) {
    const m = parseFloat(filters.costMax)
    if (!Number.isNaN(m) && r.amount > m) return false
  }
  return true
}

export function buildMockRows(
  report: ReportDef,
  filters: ReportFilters,
  page: number,
  pageSize: number,
): { rows: MockRow[]; total: number } {
  const rnd = mulberry32(hashSeed(report.id + JSON.stringify(filters)))
  const totalRaw = 87 + (hashSeed(report.id) % 40)

  const all: MockRow[] = []
  for (let idx = 0; idx < totalRaw; idx++) {
    const u = filters.units[0] ?? units[idx % units.length]
    all.push({
      date: new Date(Date.now() - idx * 86400000 * (0.5 + rnd())).toISOString().slice(0, 10),
      unit: u,
      driver: drivers[idx % drivers.length],
      vendor: vendors[idx % vendors.length],
      amount: Math.round((200 + rnd() * 4800) * 100) / 100,
      category: MOCK_SERVICE_TYPES[idx % MOCK_SERVICE_TYPES.length],
      location: locNames[idx % locNames.length],
      locationType: locTypes[idx % locTypes.length],
      recordKind: RECORD_KINDS[idx % RECORD_KINDS.length]!,
    })
  }

  const filtered = all.filter((r) => rowMatchesFilters(r, filters))
  const total = filtered.length
  const start = (page - 1) * pageSize
  const rows = filtered.slice(start, start + pageSize)
  return { rows, total }
}

export function chartBarsFromRows(rows: MockRow[]) {
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.category, (map.get(r.category) ?? 0) + r.amount)
  }
  const max = Math.max(1, ...map.values())
  return [...map.entries()].map(([label, value]) => ({
    label,
    value,
    pct: Math.round((value / max) * 100),
  }))
}
