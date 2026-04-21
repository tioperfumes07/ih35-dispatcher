import { useMemo, useState } from 'react'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import type { ReportFilters } from '../../types'
import type { ServiceLocationRecord, ServiceLocationType } from '../../data/serviceLocationRecords'
import { SERVICE_LOCATION_RECORDS } from '../../data/serviceLocationRecords'
import { filterServiceLocationRecords } from '../../lib/filterServiceLocationRecords'

type ApplyFn = (patch: Partial<ReportFilters>) => void

function pillClass(t: ServiceLocationType) {
  if (t === 'internal') return 'loc-pill loc-pill--internal'
  if (t === 'external') return 'loc-pill loc-pill--external'
  if (t === 'roadside') return 'loc-pill loc-pill--roadside'
  return 'loc-pill loc-pill--dealer'
}

function labelType(t: ServiceLocationType) {
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function groupByLocation(rows: ServiceLocationRecord[]) {
  const m = new Map<
    string,
    { type: ServiceLocationType; items: ServiceLocationRecord[] }
  >()
  for (const r of rows) {
    const g = m.get(r.locationName)
    if (!g) m.set(r.locationName, { type: r.locationType, items: [r] })
    else g.items.push(r)
  }
  return m
}

function serviceSpendBars(items: ServiceLocationRecord[]) {
  const sums = new Map<string, number>()
  for (const r of items) {
    sums.set(r.serviceType, (sums.get(r.serviceType) ?? 0) + r.cost)
  }
  const max = Math.max(1, ...sums.values())
  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, v]) => ({ label, value: v, pct: Math.round((v / max) * 100) }))
}

export function WorkByServiceLocationReport({
  filters,
}: {
  filters: ReportFilters
}) {
  const data = useMemo(
    () => filterServiceLocationRecords(SERVICE_LOCATION_RECORDS, filters),
    [filters],
  )
  const groups = useMemo(() => groupByLocation(data), [data])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const summary = useMemo(() => {
    const locs = [...groups.keys()]
    let mostUsed = ''
    let mostCount = 0
    let hiSpend = ''
    let hiVal = 0
    let totalCost = 0
    let visits = 0
    for (const name of locs) {
      const { items } = groups.get(name)!
      const c = items.length
      const sum = items.reduce((s, r) => s + r.cost, 0)
      visits += c
      totalCost += sum
      if (c > mostCount) {
        mostCount = c
        mostUsed = name
      }
      if (sum > hiVal) {
        hiVal = sum
        hiSpend = name
      }
    }
    return {
      totalLocs: locs.length,
      mostUsed,
      mostCount,
      hiSpend,
      hiVal,
      avgVisit: visits ? totalCost / visits : 0,
    }
  }, [groups])

  const sortedLocs = useMemo(
    () =>
      [...groups.entries()].sort(
        (a, b) =>
          b[1].items.reduce((s, r) => s + r.cost, 0) -
          a[1].items.reduce((s, r) => s + r.cost, 0),
      ),
    [groups],
  )

  return (
    <div className="loc-report">
      <p className="muted small">
        Uses shared <strong>Filters</strong> (dates, units, service types, location text,{' '}
        <strong>location type</strong>, vendor, driver, make, cost band).
      </p>
      <div className="loc-summary-cards">
        <div className="loc-card">
          <span className="loc-card__k">Total locations</span>
          <span className="loc-card__v">{summary.totalLocs}</span>
        </div>
        <div className="loc-card">
          <span className="loc-card__k">Most used</span>
          <span className="loc-card__v">{summary.mostUsed || '—'}</span>
          <span className="loc-card__s">{summary.mostCount} visits</span>
        </div>
        <div className="loc-card">
          <span className="loc-card__k">Highest spend</span>
          <span className="loc-card__v">{summary.hiSpend || '—'}</span>
          <span className="loc-card__s">${Math.round(summary.hiVal).toLocaleString()}</span>
        </div>
        <div className="loc-card">
          <span className="loc-card__k">Avg cost / visit</span>
          <span className="loc-card__v">${Math.round(summary.avgVisit).toLocaleString()}</span>
        </div>
      </div>

      <section className="loc-sections">
        {sortedLocs.map(([name, { type, items }]) => {
          const total = items.reduce((s, r) => s + r.cost, 0)
          const bars = serviceSpendBars(items)
          const isOpen = open[name] ?? false
          return (
            <div key={name} className="loc-accordion">
              <button
                type="button"
                className="loc-accordion__head"
                onClick={() => setOpen((o) => ({ ...o, [name]: !isOpen }))}
              >
                <span className={pillClass(type)}>{labelType(type)}</span>
                <span className="loc-accordion__title">{name}</span>
                <span className="loc-accordion__meta muted small">
                  {items.length} WO · ${Math.round(total).toLocaleString()}
                </span>
                <span className="loc-accordion__chev">{isOpen ? '▼' : '▶'}</span>
              </button>
              {isOpen && (
                <div className="loc-accordion__body">
                  <p className="muted tiny">Service type spend</p>
                  <div className="loc-mini-bars">
                    {bars.map((b) => (
                      <div key={b.label} className="loc-mini-bar-row">
                        <span className="loc-mini-bar-label">{b.label}</span>
                        <div className="loc-mini-bar-track">
                          <div className="loc-mini-bar-fill" style={{ width: `${b.pct}%` }} />
                        </div>
                        <span className="loc-mini-bar-val">${Math.round(b.value).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

export function InternalExternalAnalysisReport({ filters }: { filters: ReportFilters }) {
  const data = useMemo(
    () => filterServiceLocationRecords(SERVICE_LOCATION_RECORDS, filters),
    [filters],
  )
  const { internal, external } = useMemo(() => {
    let i = 0
    let e = 0
    const iByCat = new Map<string, number>()
    const eByCat = new Map<string, number>()
    for (const r of data) {
      if (r.locationType === 'internal') {
        i += r.cost
        iByCat.set(r.serviceType, (iByCat.get(r.serviceType) ?? 0) + r.cost)
      } else {
        e += r.cost
        eByCat.set(r.serviceType, (eByCat.get(r.serviceType) ?? 0) + r.cost)
      }
    }
    return {
      internal: { total: i, byCat: iByCat },
      external: { total: e, byCat: eByCat },
    }
  }, [data])

  const extShare = internal.total + external.total > 0 ? external.total / (internal.total + external.total) : 0
  const inHouseHint = Math.round(extShare * 42)

  const bars = (m: Map<string, number>, side: 'int' | 'ext') => {
    const max = Math.max(1, ...m.values())
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, v]) => ({
        label,
        pct: Math.round((v / max) * 100),
        value: v,
        key: `${side}-${label}`,
      }))
  }

  return (
    <div className="loc-report">
      <p className="muted small">
        <strong>Internal</strong> vs <strong>all non-internal</strong> (external + roadside + dealer). Filters
        apply to the same WO set as other location reports.
      </p>
      <div className="loc-ix-grid">
        <div className="loc-ix-col">
          <h3 className="loc-ix-h">Internal</h3>
          <p className="loc-ix-total">${Math.round(internal.total).toLocaleString()}</p>
          <div className="loc-mini-bars">
            {bars(internal.byCat, 'int').map((b) => (
              <div key={b.key} className="loc-mini-bar-row">
                <span className="loc-mini-bar-label">{b.label}</span>
                <div className="loc-mini-bar-track loc-mini-bar-track--int">
                  <div className="loc-mini-bar-fill loc-mini-bar-fill--int" style={{ width: `${b.pct}%` }} />
                </div>
                <span className="loc-mini-bar-val">${Math.round(b.value).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="loc-ix-col">
          <h3 className="loc-ix-h">External &amp; field</h3>
          <p className="loc-ix-total">${Math.round(external.total).toLocaleString()}</p>
          <div className="loc-mini-bars">
            {bars(external.byCat, 'ext').map((b) => (
              <div key={b.key} className="loc-mini-bar-row">
                <span className="loc-mini-bar-label">{b.label}</span>
                <div className="loc-mini-bar-track loc-mini-bar-track--ext">
                  <div className="loc-mini-bar-fill loc-mini-bar-fill--ext" style={{ width: `${b.pct}%` }} />
                </div>
                <span className="loc-mini-bar-val">${Math.round(b.value).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="loc-callout">
        <strong>In-house opportunity (demo heuristic):</strong> roughly {inHouseHint}% of external &amp; field
        spend is PM-style work that could be scheduled at internal bays with parts pre-staged — review top
        categories on the right.
      </div>
    </div>
  )
}

function modeService(items: ServiceLocationRecord[]) {
  const m = new Map<string, number>()
  for (const r of items) m.set(r.serviceType, (m.get(r.serviceType) ?? 0) + 1)
  let best = ''
  let n = 0
  for (const [k, v] of m) {
    if (v > n) {
      n = v
      best = k
    }
  }
  return best || '—'
}

export function AllLocationsSummaryReport({
  filters,
  onApplyFilters,
}: {
  filters: ReportFilters
  onApplyFilters?: ApplyFn
}) {
  const locCol = useColumnResize([160, 100, 72, 88, 88, 72, 140, 88, 88])
  const data = useMemo(
    () => filterServiceLocationRecords(SERVICE_LOCATION_RECORDS, filters),
    [filters],
  )
  const rows = useMemo(() => {
    const g = groupByLocation(data)
    return [...g.entries()].map(([name, { type, items }]) => {
      const dates = items.map((r) => r.date).sort()
      const units = new Set(items.map((r) => r.unitId))
      const total = items.reduce((s, r) => s + r.cost, 0)
      return {
        name,
        type,
        count: items.length,
        total,
        avg: total / items.length,
        vehicles: units.size,
        common: modeService(items),
        first: dates[0] ?? '',
        last: dates[dates.length - 1] ?? '',
      }
    })
  }, [data])

  return (
    <div className="loc-report">
      <p className="muted small">
        One row per location after filters. Click a row to set the <strong>Location</strong> filter and refine
        in other maintenance reports.
      </p>
      <div className="bill-pay__table-toolbar">
        <button
          type="button"
          className="btn sm"
          onClick={() => exportDomTableToXlsx(locCol.tableRef.current, 'LocationSummary')}
        >
          Export to Excel
        </button>
      </div>
      <div className="svc-cat__tablewrap">
        <table
          ref={locCol.tableRef}
          className="data-table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {locCol.widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(
                [
                  ['Location', ''],
                  ['Type', ''],
                  ['Records', 'num'],
                  ['Total $', 'num'],
                  ['Avg / visit', 'num'],
                  ['Units', 'num'],
                  ['Top service', ''],
                  ['First', ''],
                  ['Last', ''],
                ] as const
              ).map(([label, cls], i) => (
                <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                  {label}
                  {i < locCol.widths.length - 1 ? (
                    <span
                      className="fr-col-resize"
                      role="presentation"
                      onMouseDown={locCol.onResizeMouseDown(i)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="loc-drill-row"
                onClick={() => onApplyFilters?.({ location: r.name })}
                title="Apply location filter"
              >
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td>
                  <span className={pillClass(r.type)}>{labelType(r.type)}</span>
                </td>
                <td className="num">{r.count}</td>
                <td className="num">${Math.round(r.total).toLocaleString()}</td>
                <td className="num">${Math.round(r.avg).toLocaleString()}</td>
                <td className="num">{r.vehicles}</td>
                <td>{r.common}</td>
                <td className="tiny mono">{r.first}</td>
                <td className="tiny mono">{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function dotBucket(t: ServiceLocationType) {
  if (t === 'internal') return 'internal'
  if (t === 'roadside') return 'roadside'
  return 'external'
}

export function Dot4iServiceLocationsReport({ filters }: { filters: ReportFilters }) {
  const dotCol = useColumnResize([160, 120, 72, 72, 72, 72])
  const data = useMemo(
    () => filterServiceLocationRecords(SERVICE_LOCATION_RECORDS, filters),
    [filters],
  )
  const pct = useMemo(() => {
    let a = 0,
      b = 0,
      c = 0
    for (const r of data) {
      const k = dotBucket(r.locationType)
      if (k === 'internal') a += 1
      else if (k === 'roadside') c += 1
      else b += 1
    }
    const n = a + b + c || 1
    return {
      internal: Math.round((a / n) * 1000) / 10,
      external: Math.round((b / n) * 1000) / 10,
      roadside: Math.round((c / n) * 1000) / 10,
      counts: { internal: a, external: b, roadside: c },
    }
  }, [data])

  const byLoc = useMemo(() => {
    const m = groupByLocation(data)
    return [...m.entries()].map(([name, { type, items }]) => ({
      name,
      type,
      n: items.length,
      internal: items.filter((r) => dotBucket(r.locationType) === 'internal').length,
      external: items.filter((r) => dotBucket(r.locationType) === 'external').length,
      roadside: items.filter((r) => dotBucket(r.locationType) === 'roadside').length,
    }))
  }, [data])

  return (
    <div className="loc-report">
      <h3 className="loc-dot-h">DOT Section 4I · Service locations</h3>
      <p className="muted small">
        Grouped records with <strong>internal / external / roadside</strong> mix (dealer &amp; network counted as
        external for this split). Honors fleet filter panel.
      </p>
      <div className="loc-dot-split">
        <div
          className="loc-dot-seg loc-dot-seg--int"
          style={{ flex: Math.max(pct.internal, 6), minWidth: '12%' }}
        >
          <span>Internal {pct.internal}%</span>
        </div>
        <div
          className="loc-dot-seg loc-dot-seg--ext"
          style={{ flex: Math.max(pct.external, 6), minWidth: '12%' }}
        >
          <span>External {pct.external}%</span>
        </div>
        <div
          className="loc-dot-seg loc-dot-seg--road"
          style={{ flex: Math.max(pct.roadside, 6), minWidth: '12%' }}
        >
          <span>Roadside {pct.roadside}%</span>
        </div>
      </div>
      <p className="muted tiny">
        Counts: internal {pct.counts.internal}, external {pct.counts.external}, roadside {pct.counts.roadside}{' '}
        (filtered set)
      </p>
      <div className="bill-pay__table-toolbar">
        <button
          type="button"
          className="btn sm"
          onClick={() => exportDomTableToXlsx(dotCol.tableRef.current, 'Dot4iServiceLocations')}
        >
          Export to Excel
        </button>
      </div>
      <div className="svc-cat__tablewrap">
        <table
          ref={dotCol.tableRef}
          className="data-table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {dotCol.widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(
                [
                  ['Location', ''],
                  ['Primary type', ''],
                  ['Records', 'num'],
                  ['Int.', 'num'],
                  ['Ext.', 'num'],
                  ['Road.', 'num'],
                ] as const
              ).map(([label, cls], i) => (
                <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                  {label}
                  {i < dotCol.widths.length - 1 ? (
                    <span
                      className="fr-col-resize"
                      role="presentation"
                      onMouseDown={dotCol.onResizeMouseDown(i)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byLoc.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>
                  <span className={pillClass(r.type)}>{labelType(r.type)}</span>
                </td>
                <td className="num">{r.n}</td>
                <td className="num">{r.internal}</td>
                <td className="num">{r.external}</td>
                <td className="num">{r.roadside}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
