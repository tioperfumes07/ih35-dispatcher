import { useMemo, useState } from 'react'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import {
  FLEET_AVG_MILES_PER_MONTH,
  PARTS_REFERENCE,
  formatIntervalHuman,
} from '../../data/maintenanceScheduleData'
import {
  fleetWideDueRows,
  scheduleIntegrityAlerts,
} from '../../lib/maintenanceScheduleAlerts'
import { loadThresholds } from '../../lib/integrityThresholds'
import { mergeAlertsIntoStore } from '../../api/postIntegrityCheck'

type Tab = 'due' | 'brand' | 'predictor' | 'parts' | 'benchmarks'

const BRAND_COMPARE = [
  { make: 'Freightliner Cascadia', actual: 0.112, industry: 0.104 },
  { make: 'Volvo VNL', actual: 0.098, industry: 0.106 },
  { make: 'Peterbilt 579', actual: 0.121, industry: 0.108 },
  { make: 'Mack Anthem', actual: 0.115, industry: 0.11 },
]

export function MaintenanceIntelligencePage() {
  const partsCol = useColumnResize([120, 200, 72, 72, 72, 200])
  const benchCol = useColumnResize([220, 88, 88, 200])
  const [tab, setTab] = useState<Tab>('due')
  const [partQ, setPartQ] = useState('')
  const [predUnit, setPredUnit] = useState('101')
  const fleetAvg = loadThresholds().fleet_avg_miles_per_month ?? FLEET_AVG_MILES_PER_MONTH

  const dueRows = useMemo(() => fleetWideDueRows(), [])
  const flatAlerts = useMemo(() => {
    const a: ReturnType<typeof scheduleIntegrityAlerts> = []
    for (const s of dueRows) {
      a.push(...scheduleIntegrityAlerts(s))
    }
    return a
  }, [dueRows])

  const partsFiltered = useMemo(() => {
    const q = partQ.trim().toLowerCase()
    if (!q) return PARTS_REFERENCE
    return PARTS_REFERENCE.filter(
      (p) =>
        p.partName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    )
  }, [partQ])

  const publishScheduleAlerts = () => {
    mergeAlertsIntoStore(flatAlerts)
    alert(`Published ${flatAlerts.length} schedule alerts (M5 overdue / M6 due soon) to integrity store.`)
  }

  const forecast = useMemo(() => {
    const months = 18
    const pts: { m: number; cost: number }[] = []
    let c = 8000 + (predUnit.charCodeAt(0) % 5) * 900
    for (let m = 0; m < months; m++) {
      c += 2200 + Math.sin(m / 3) * 400
      pts.push({ m, cost: Math.round(c) })
    }
    return pts
  }, [predUnit])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'due', label: 'Due schedule' },
    { id: 'brand', label: 'Brand comparison' },
    { id: 'predictor', label: 'Per-vehicle predictor' },
    { id: 'parts', label: 'Parts reference' },
    { id: 'benchmarks', label: 'Cost benchmarks' },
  ]

  return (
    <div className="maint-intel">
      <header className="maint-intel__head">
        <div>
          <h3>Maintenance intelligence</h3>
          <p className="muted small">
            DB tables <code>vehicle_maintenance_schedules</code>,{' '}
            <code>vehicle_parts_reference</code>, setting{' '}
            <code>fleet_avg_miles_per_month</code> (default {FLEET_AVG_MILES_PER_MONTH.toLocaleString()} mi/mo).
            Month floor: <code>FLOOR(miles ÷ fleet_avg)</code>.
          </p>
        </div>
      </header>

      <div className="integrity-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'integrity-tab active' : 'integrity-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'due' && (
        <section className="maint-intel__panel">
          <div className="maint-intel__toolbar">
            <p className="muted small">
              Fleet-wide due view (color: <span className="tag danger">overdue</span>{' '}
              <span className="tag warn">due soon</span> <span className="tag ok">ok</span>).
              Overdue → <strong>RED</strong> integrity (M5), due soon → <strong>AMBER</strong> (M6).
            </p>
            <button type="button" className="btn primary" onClick={publishScheduleAlerts}>
              Publish M5/M6 to integrity
            </button>
          </div>
          <div className="maint-intel__due-grid">
            {dueRows.map((snap) => (
              <article key={snap.unitId} className="maint-intel__unit-card">
                <h4>
                  Unit {snap.unitId}{' '}
                  <span className="muted tiny mono">({snap.vehicleMakeKey})</span>
                </h4>
                <p className="muted tiny">Odometer {snap.currentOdometer.toLocaleString()} mi</p>
                <ul className="maint-intel__due-list">
                  {snap.items.map((it) => (
                    <li
                      key={it.serviceKey}
                      className={
                        it.status === 'overdue'
                          ? 'is-overdue'
                          : it.status === 'due_soon'
                            ? 'is-soon'
                            : ''
                      }
                    >
                      <strong>{it.serviceLabel}</strong>
                      <span className="muted tiny">
                        {formatIntervalHuman(it.intervalMiles, fleetAvg)} · next ~{' '}
                        {it.nextDueMiles.toLocaleString()} mi
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'brand' && (
        <section className="maint-intel__panel">
          <p className="muted small">
            Actual $/mi vs industry benchmark (demo). Bars = delta (actual − industry).
          </p>
          <div className="maint-intel__bars">
            {BRAND_COMPARE.map((b) => {
              const delta = b.actual - b.industry
              const w = Math.min(100, Math.abs(delta) * 800)
              return (
                <div key={b.make} className="maint-intel__bar-row">
                  <span className="maint-intel__bar-label">{b.make}</span>
                  <div className="maint-intel__bar-track">
                    <div
                      className={`maint-intel__bar-fill ${delta > 0 ? 'bad' : 'good'}`}
                      style={{ width: `${w}%` }}
                    />
                  </div>
                  <span className="mono tiny">
                    {delta > 0 ? '+' : ''}
                    {(delta * 1000).toFixed(1)} bp
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'predictor' && (
        <section className="maint-intel__panel">
          <label className="field">
            <span>Unit</span>
            <select value={predUnit} onChange={(e) => setPredUnit(e.target.value)}>
              {['101', '102', '204', '305', '412'].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Cumulative maintenance cost forecast (demo curve).</p>
          <div className="maint-intel__chart">
            <svg width="100%" height="140" viewBox="0 0 360 140" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#5b8cff"
                strokeWidth="2"
                points={forecast
                  .map((p, i) => `${(i / (forecast.length - 1)) * 340 + 10},${120 - (p.cost / 60000) * 100}`)
                  .join(' ')}
              />
            </svg>
          </div>
        </section>
      )}

      {tab === 'parts' && (
        <section className="maint-intel__panel">
          <label className="field">
            <span>Search parts</span>
            <input
              value={partQ}
              onChange={(e) => setPartQ(e.target.value)}
              placeholder="tire, brake, battery…"
            />
          </label>
          <div className="bill-pay__table-toolbar">
            <button
              type="button"
              className="btn sm"
              onClick={() => exportDomTableToXlsx(partsCol.tableRef.current, 'MaintIntelParts')}
            >
              Export to Excel
            </button>
          </div>
          <div className="maint-intel__tablewrap">
            <table
              ref={partsCol.tableRef}
              className="bill-pay__table fr-data-table"
              style={{ tableLayout: 'fixed', width: '100%' }}
            >
              <colgroup>
                {partsCol.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {(
                    [
                      ['Category', ''],
                      ['Part', ''],
                      ['Low', 'num'],
                      ['Mid', 'num'],
                      ['High', 'num'],
                      ['Notes', ''],
                    ] as const
                  ).map(([label, cls], i) => (
                    <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                      {label}
                      {i < partsCol.widths.length - 1 ? (
                        <span
                          className="fr-col-resize"
                          role="presentation"
                          onMouseDown={partsCol.onResizeMouseDown(i)}
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partsFiltered.map((p) => (
                  <tr key={p.category + p.partName}>
                    <td>{p.category}</td>
                    <td>{p.partName}</td>
                    <td className="num">{p.costLow}</td>
                    <td className="num">{p.costMid}</td>
                    <td className="num">{p.costHigh}</td>
                    <td className="muted tiny">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'benchmarks' && (
        <section className="maint-intel__panel">
          <div className="bill-pay__table-toolbar">
            <button
              type="button"
              className="btn sm"
              onClick={() => exportDomTableToXlsx(benchCol.tableRef.current, 'MaintIntelBenchmarks')}
            >
              Export to Excel
            </button>
          </div>
          <table
            ref={benchCol.tableRef}
            className="bill-pay__table fr-data-table"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              {benchCol.widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {(
                  [
                    ['Metric', ''],
                    ['Fleet', 'num'],
                    ['Industry', 'num'],
                    ['Notes', ''],
                  ] as const
                ).map(([label, cls], i) => (
                  <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                    {label}
                    {i < benchCol.widths.length - 1 ? (
                      <span
                        className="fr-col-resize"
                        role="presentation"
                        onMouseDown={benchCol.onResizeMouseDown(i)}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>$/mi (rolling)</td>
                <td className="num">0.114</td>
                <td className="num">0.108</td>
                <td className="muted tiny">Demo</td>
              </tr>
              <tr>
                <td>PM compliance %</td>
                <td className="num">92%</td>
                <td className="num">88%</td>
                <td className="muted tiny">Demo</td>
              </tr>
              <tr>
                <td>Unscheduled downtime hrs/mo</td>
                <td className="num">6.2</td>
                <td className="num">8.1</td>
                <td className="muted tiny">Lower is better</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
