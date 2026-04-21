/** Local calendar date YYYY-MM-DD (no UTC shift for "today"). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export type DateFilterRange = { from: string; to: string }

export function rangeToday(): DateFilterRange {
  const t = toIsoDate(new Date())
  return { from: t, to: t }
}

function startOfMondayWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  const diff = x.getDate() - day + (day === 0 ? -6 : 1)
  x.setDate(diff)
  return x
}

/** Monday–Sunday week containing today. */
export function rangeThisWeek(): DateFilterRange {
  const now = new Date()
  const start = startOfMondayWeek(now)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { from: toIsoDate(start), to: toIsoDate(end) }
}

export function rangeThisMonth(): DateFilterRange {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from: toIsoDate(start), to: toIsoDate(end) }
}

export function rangeLastMonth(): DateFilterRange {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  return { from: toIsoDate(start), to: toIsoDate(end) }
}

/** Rolling ~90 days ending today. */
export function rangeLast3Months(): DateFilterRange {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - 3, end.getDate())
  return { from: toIsoDate(start), to: toIsoDate(end) }
}

/** Previous calendar year (local). */
export function rangeLastCalendarYear(): DateFilterRange {
  const y = new Date().getFullYear() - 1
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

export function defaultHistoryDateRange(): DateFilterRange {
  return rangeLastMonth()
}

export type DateQuickPickId =
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'last-3mo'
  | 'last-year'

export function rangeForQuickPick(id: DateQuickPickId): DateFilterRange {
  switch (id) {
    case 'today':
      return rangeToday()
    case 'this-week':
      return rangeThisWeek()
    case 'this-month':
      return rangeThisMonth()
    case 'last-month':
      return rangeLastMonth()
    case 'last-3mo':
      return rangeLast3Months()
    case 'last-year':
      return rangeLastCalendarYear()
  }
}
