import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchFleetCache,
  fetchFleetIntegrity,
  fetchVehicleIntegrity,
  invalidateTelematicsClientCache,
  postRefreshSamsara,
} from '../../lib/telematicsApi'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { useColumnResize } from '../../hooks/useColumnResize'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE } from '../../hooks/useFullScreen'

type FleetRow = {
  unit: string
  score: number
  band: string
  alertCount: number
  codes: string[]
  tripMiles90d?: number
  idlePct?: number
  faults?: number
}

type IntegrityResp = {
  refreshedAt: string
  fromCache?: boolean
  cacheAgeMs?: number
  table: FleetRow[]
  checks: { vehicles: Record<string, VehicleCheck> }
}

type VehicleCheck = {
  score: number
  band: string
  alerts: { code: string; severity: string; title: string; detail: string }[]
  bundle: {
    odometerHistory90d: { date: string; meters: number }[]
    tripMilesByDay: Record<string, number>
    faultCodes: { code: string; description?: string }[]
    safetyLocal: Record<string, unknown>
    idleByDay90d: { date: string; value: number }[]
  }
}

function Sparkline({
  points,
  color,
}: {
  points: { x: string; y: number }[]
  color: string
}) {
  if (!points.length) return <p className="muted tiny">No series</p>
  const ys = points.map((p) => p.y)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const pad = 4
  const W = 280
  const H = 72
  const dx = (W - pad * 2) / Math.max(1, points.length - 1)
  const pts = points.map((p, i) => {
    const nx = pad + i * dx
    const t = maxY === minY ? 0.5 : (p.y - minY) / (maxY - minY)
    const ny = H - pad - t * (H - pad * 2)
    return `${nx},${ny}`
  })
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="spark-svg spark-svg--fluid"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={pts.join(' ')}
      />
    </svg>
  )
}

function Gauge({ score }: { score: number }) {
  const rot = Math.max(0, Math.min(100, score)) * 1.8 - 90
  return (
    <div className="gauge" aria-label={`Integrity score ${score}`}>
      <div className="gauge__arc" />
      <div className="gauge__needle" style={{ transform: `rotate(${rot}deg)` }} />
      <div className="gauge__label">{score}</div>
      <span className="muted tiny">0–100</span>
    </div>
  )
}

export function TelematicsFleetPage() {
  const fleetCol = useColumnResize([88, 56, 72, 64, 200, 80, 64, 56])
  const [data, setData] = useState<IntegrityResp | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [unit, setUnit] = useState<string | null>(null)
  const [detail, setDetail] = useState<VehicleCheck | null>(null)
  const [telemDrawerFs, setTelemDrawerFs] = useState(false)

  useEffect(() => {
    if (!unit) setTelemDrawerFs(false)
  }, [unit])
  const [tab, setTab] = useState<
    'wos' | 'fuel' | 'inspections' | 'tires' | 'accidents' | 'faults'
  >('wos')
  const [bandChip, setBandChip] = useState<string>('')
  const [codeChip, setCodeChip] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      await fetchFleetCache()
      const j = (await fetchFleetIntegrity()) as IntegrityResp
      setData(j)
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!unit) {
      setDetail(null)
      return
    }
    let cancelled = false
    void fetchVehicleIntegrity(unit).then((d) => {
      if (!cancelled) setDetail(d as VehicleCheck)
    })
    return () => {
      cancelled = true
    }
  }, [unit])

  const filteredTable = useMemo(() => {
    const t = data?.table ?? []
    return t.filter((r) => {
      if (bandChip && r.band !== bandChip) return false
      if (codeChip && !r.codes.includes(codeChip)) return false
      return true
    })
  }, [data, bandChip, codeChip])

  const exportCsv = () => {
    const rows = filteredTable
    const h = ['unit', 'score', 'band', 'alerts', 'codes', 'trip90', 'idlePct', 'faults']
    const lines = [
      h.join(','),
      ...rows.map((r) =>
        [
          r.unit,
          r.score,
          r.band,
          r.alertCount,
          r.codes.join(';'),
          r.tripMiles90d ?? '',
          r.idlePct != null ? r.idlePct.toFixed(1) : '',
          r.faults ?? '',
        ].join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fleet-integrity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const odoPoints = useMemo(() => {
    const s = detail?.bundle?.odometerHistory90d ?? []
    return s.map((p, i) => ({
      x: p.date,
      y: Number(p.meters) / 1609.34 || i,
    }))
  }, [detail])

  const idlePoints = useMemo(() => {
    const s = detail?.bundle?.idleByDay90d ?? []
    return s.map((p, i) => ({ x: p.date, y: Number(p.value) || i }))
  }, [detail])

  return (
    <div className="telematics-page" data-telematics-fleet-page>
      <header className="telematics-page__head">
        <div>
          <h3>Fleet telematics · Samsara</h3>
          <p className="muted small">
            Uses existing Samsara client modules copied from your dispatch starter
            (<code>server/lib/samsara-client.mjs</code>,{' '}
            <code>samsara-report-fetch.mjs</code>,{' '}
            <code>samsara-integrity-fetch.mjs</code>). Bundle: odometer 90d, engine hours,
            DTCs, safety, trips, idle — cached <strong>5 minutes</strong> (server + this
            UI). Checks: OD1–OD3, EH1, FC1–FC2, DB1–DB3, IT1–IT2, VU1–VU3, MR1–MR3. Nightly
            job <strong>2:00</strong> <code>node-cron</code> (TZ{' '}
            <code>America/Chicago</code> or <code>CRON_TZ</code>), deduped by day + unit +
            code.
          </p>
        </div>
        <div className="telematics-page__actions">
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              invalidateTelematicsClientCache()
              void load()
            }}
          >
            Refresh (client cache)
          </button>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => void postRefreshSamsara().then(() => load())}
          >
            Force Samsara refetch
          </button>
        </div>
      </header>

      {err && <p className="maint-form__err">{err}</p>}
      {loading && <p className="muted">Loading…</p>}

      {data && (
        <div className="telematics-split">
          <div className="telematics-split__list">
            <div className="telematics-page__track">
              <p className="muted small">
                Server: {data.refreshedAt}
                {data.fromCache ? ' · served from cache' : ' · fresh fetch'}
              </p>

              <div className="telematics-chips">
                <span className="muted tiny">Filter</span>
                {['', 'ATTENTION', 'CRITICAL', 'REVIEW', 'GOOD'].map((b) => (
                  <button
                    key={b || 'all-band'}
                    type="button"
                    className={bandChip === b ? 'chip sm active' : 'chip sm'}
                    onClick={() => setBandChip(b)}
                  >
                    {b || 'All bands'}
                  </button>
                ))}
                {['', 'OD1', 'OD2', 'FC1', 'IT1', 'MR2', 'DB1'].map((c) => (
                  <button
                    key={c || 'all-code'}
                    type="button"
                    className={codeChip === c ? 'chip sm active' : 'chip sm'}
                    onClick={() => setCodeChip(c)}
                  >
                    {c || 'All codes'}
                  </button>
                ))}
              </div>

              <div className="telematics-table-wrap" aria-label="Fleet integrity table">
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      exportDomTableToXlsx(fleetCol.tableRef.current, 'MaintenanceFleetIntegrity')
                    }
                  >
                    Export to Excel
                  </button>
                </div>
                <table
                  ref={fleetCol.tableRef}
                  className="bill-pay__table telematics-table fr-data-table telematics-fleet-integrity-table"
                  style={{ width: '100%' }}
                >
                  <colgroup>
                    {fleetCol.widths.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {[
                        { h: 'Unit', num: false },
                        { h: 'Score', num: true },
                        { h: 'Band', num: false },
                        { h: 'Alerts', num: true },
                        { h: 'Codes', num: false },
                        { h: 'Trip 90d', num: true },
                        { h: 'Idle %', num: true },
                        { h: 'Faults', num: true },
                      ].map((cell, i) => (
                        <th
                          key={cell.h}
                          className={'fr-th-resizable' + (cell.num ? ' num' : '')}
                          style={{ width: fleetCol.widths[i] }}
                        >
                          {cell.h}
                          {i < fleetCol.widths.length - 1 ? (
                            <span
                              className="fr-col-resize"
                              role="separator"
                              aria-hidden
                              onMouseDown={fleetCol.onResizeMouseDown(i)}
                            />
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTable.map((r) => (
                      <tr
                        key={r.unit}
                        className={unit === r.unit ? 'is-selected' : ''}
                      >
                        <td>
                          <button
                            type="button"
                            className="bill-pay__paylink"
                            onClick={() => setUnit(r.unit)}
                          >
                            {r.unit}
                          </button>
                        </td>
                        <td className="num">{r.score}</td>
                        <td>{r.band}</td>
                        <td className="num">{r.alertCount}</td>
                        <td className="mono small">{r.codes.join(', ') || '—'}</td>
                        <td className="num">{r.tripMiles90d?.toFixed(0) ?? '—'}</td>
                        <td className="num">
                          {r.idlePct != null ? r.idlePct.toFixed(1) : '—'}
                        </td>
                        <td className="num">{r.faults ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted tiny" style={{ marginTop: 6 }}>
                  Drag column edges to resize
                </p>
              </div>
              <div className="telematics-export">
                <button type="button" className="btn ghost" onClick={exportCsv}>
                  Export CSV (filtered)
                </button>
              </div>
            </div>
          </div>

          <aside
            className={
              'telematics-split__detail bill-pay__drawer telematics-drawer' +
              (telemDrawerFs ? ' app-modal-panel--fullscreen' : '')
            }
            style={telemDrawerFs ? MODAL_FULLSCREEN_STYLE : undefined}
            aria-label="Vehicle detail"
          >
            {!unit ? (
              <div className="telematics-split__placeholder muted small">
                <p>
                  Select a unit from the fleet list to open live vehicle detail (integrity
                  score, series, and tabs).
                </p>
              </div>
            ) : !detail ? (
              <div className="telematics-split__placeholder muted small">
                <p>Loading vehicle data…</p>
              </div>
            ) : (
              <>
                <header className="bill-pay__drawer-head">
                  <div>
                    <h2>Vehicle investigation · {unit}</h2>
                    <p className="muted small">
                      Integrity score + Samsara series (WO markers overlaid on odometer
                      chart when ERP wired).
                    </p>
                  </div>
                  <div className="modal-generic-head__actions">
                    <ModalFullscreenToggle
                      isFullScreen={telemDrawerFs}
                      onToggle={() => setTelemDrawerFs((v) => !v)}
                      className="btn sm ghost"
                    />
                    <button type="button" className="btn sm ghost" onClick={() => setUnit(null)}>
                      ×
                    </button>
                  </div>
                </header>

                <div className="telematics-inv-top">
                  <Gauge score={detail.score} />
                  <div className="telematics-inv-top__meta">
                    <p className="muted tiny">Band</p>
                    <strong>{detail.band}</strong>
                    <ul className="telematics-alert-list">
                      {detail.alerts.map((a) => (
                        <li key={a.code + a.title}>
                          <span className={`sev sev--${a.severity}`}>{a.code}</span>
                          {a.title} — {a.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <h3 className="integrity-drawer__sub">Odometer (90d) + WO dates (placeholder)</h3>
                <Sparkline points={odoPoints} color="#5b8cff" />

                <h3 className="integrity-drawer__sub">Idle time (90d)</h3>
                <Sparkline points={idlePoints} color="#fbbf24" />

                <h3 className="integrity-drawer__sub">Fault codes / DTCs</h3>
                <ul className="telematics-fault-list">
                  {(detail.bundle.faultCodes || []).map((f) => (
                    <li key={f.code}>
                      <code>{f.code}</code> {f.description}
                    </li>
                  ))}
                  {!(detail.bundle.faultCodes || []).length && (
                    <li className="muted">None in latest snapshot</li>
                  )}
                </ul>

                <h3 className="integrity-drawer__sub">Driver behavior (safety summary)</h3>
                <pre className="telematics-pre">
                  {JSON.stringify(detail.bundle.safetyLocal, null, 2)}
                </pre>

                <div className="integrity-tabs telematics-drawer-tabs" role="tablist">
                  {(
                    [
                      ['accidents', 'Accidents'],
                      ['faults', 'Fault history'],
                      ['fuel', 'Fuel'],
                      ['inspections', 'Inspections'],
                      ['tires', 'Tires'],
                      ['wos', 'WOs'],
                    ] as const
                  )
                    .slice()
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      className={tab === id ? 'integrity-tab active' : 'integrity-tab'}
                      onClick={() => setTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="telematics-tab-body muted small">
                  {tab === 'wos' && (
                    <p>
                      ERP work orders for {unit} (wire /api/erp/work-orders?unit=…).
                    </p>
                  )}
                  {tab === 'fuel' && (
                    <p>
                      MPG and purchase history will show here when wired to Samsara fuel events.{' '}
                      <strong>Fuel bills, DEF bills, fuel expenses, and combined fuel/DEF</strong> are
                      created only in <strong>Accounting</strong> (+ New → DEF bill / Fuel bill / …).
                    </p>
                  )}
                  {tab === 'inspections' && <p>DOT / annual inspection dates.</p>}
                  {tab === 'tires' && <p>Tire positions &amp; install history.</p>}
                  {tab === 'accidents' && <p>Accident WO linkage.</p>}
                  {tab === 'faults' && (
                    <p>Historical DTC stream (extend server fault snapshots).</p>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
