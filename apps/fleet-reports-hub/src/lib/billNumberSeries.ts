/** Bill # pattern detection + series (simple cost lines — no position / parts / part#). */

const MONTHS3 = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const

function monthIndex3(m: string): number {
  const u = m.toUpperCase()
  return MONTHS3.indexOf(u as (typeof MONTHS3)[number])
}

function padNum(n: number, width: number) {
  return String(n).padStart(width, '0')
}

export type BillNumberPattern =
  | { kind: 'month_only' }
  | { kind: 'quarter_suffix' }
  | { kind: 'weekly_w' }
  | { kind: 'prefix_month3' }
  | { kind: 'prefix_month2' }
  | { kind: 'trailing_digits' }
  | { kind: 'literal' }

export function detectPattern(seed: string): BillNumberPattern {
  const s = seed.trim()
  if (!s) return { kind: 'literal' }

  if (/^[A-Za-z]{3}$/.test(s) && monthIndex3(s) >= 0) return { kind: 'month_only' }

  if (/^(.*)-Q([1-4])$/i.test(s)) return { kind: 'quarter_suffix' }

  if (/^W\d+$/i.test(s)) return { kind: 'weekly_w' }

  const pm = s.match(/^(.+)-([A-Z]{3})$/i)
  if (pm && monthIndex3(pm[2]) >= 0) return { kind: 'prefix_month3' }

  const p3 = s.match(/^(.+)-(\d{3,})$/i)
  if (p3) return { kind: 'trailing_digits' }

  const p2 = s.match(/^(.+)-(\d{2})$/i)
  if (p2) {
    const mm = parseInt(p2[2], 10)
    if (mm >= 1 && mm <= 12) return { kind: 'prefix_month2' }
  }

  if (/^(.*?)(\d+)$/.test(s)) return { kind: 'trailing_digits' }

  return { kind: 'literal' }
}

export function nextBillNumber(current: string, pattern: BillNumberPattern): string {
  const s = current.trim()
  switch (pattern.kind) {
    case 'month_only': {
      const i = monthIndex3(s)
      if (i < 0) return s
      return MONTHS3[(i + 1) % 12]
    }
    case 'quarter_suffix': {
      const m = s.match(/^(.*)-Q([1-4])$/i)
      if (!m) return s
      const q = parseInt(m[2], 10)
      const nq = q >= 4 ? 1 : q + 1
      return `${m[1]}-Q${nq}`
    }
    case 'weekly_w': {
      const m = s.match(/^W(\d+)$/i)
      if (!m) return s
      return `W${parseInt(m[1], 10) + 1}`
    }
    case 'prefix_month3': {
      const mm = s.match(/^(.+)-([A-Z]{3})$/i)
      if (!mm) return s
      const idx = monthIndex3(mm[2])
      if (idx < 0) return s
      return `${mm[1]}-${MONTHS3[(idx + 1) % 12]}`
    }
    case 'prefix_month2': {
      const mm = s.match(/^(.+)-(\d{2})$/i)
      if (!mm) return s
      let m = parseInt(mm[2], 10)
      m = m >= 12 ? 1 : m + 1
      return `${mm[1]}-${padNum(m, 2)}`
    }
    case 'trailing_digits': {
      const m = s.match(/^(.*?)(\d+)$/)
      if (!m) return s
      const n = parseInt(m[2], 10) + 1
      return `${m[1]}${padNum(n, m[2].length)}`
    }
    default: {
      const m = s.match(/^(.*?)(\d+)$/)
      if (m) {
        const n = parseInt(m[2], 10) + 1
        return `${m[1]}${padNum(n, m[2].length)}`
      }
      return `${s}-002`
    }
  }
}

export function generateBillNumbers(seed: string, count: number): string[] {
  const c = Math.max(0, Math.floor(count))
  if (c === 0) return []
  const first = seed.trim() || 'BILL-001'
  const out: string[] = [first]
  for (let i = 1; i < c; i++) {
    const prev = out[i - 1]!
    out.push(nextBillNumber(prev, detectPattern(prev)))
  }
  return out
}

export function previewBillFormats(seed: string): string[] {
  const s = seed.trim() || 'BILL-001'
  return generateBillNumbers(s, 3)
}
