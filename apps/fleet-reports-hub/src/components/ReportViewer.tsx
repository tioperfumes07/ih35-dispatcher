import { useEffect, useMemo, useRef, useState } from 'react'
import { exportDomTableToXlsx } from '../lib/tableExportXlsx'
import { useColumnResize } from '../hooks/useColumnResize'
import { useTableTabOrder } from '../hooks/useTableTabOrder'
import { TableResizeHintFooter } from './table/TableResizeHintFooter'
import { ModalFullscreenToggle } from './ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../hooks/useFullScreen'
import type { ReportDef, ReportFilters } from '../types'
import { buildMockRows, chartBarsFromRows } from '../lib/mockRows'
import { exportCsv, exportPdfPrint } from '../lib/exportReport'
import {
  AllLocationsSummaryReport,
  Dot4iServiceLocationsReport,
  InternalExternalAnalysisReport,
  WorkByServiceLocationReport,
} from './reports/LocationReports'

type Props = {
  report: ReportDef
  filters: ReportFilters
  onClose: () => void
  onApplyFilters?: (patch: Partial<ReportFilters>) => void
}

const PAGE_SIZE = 8

export function ReportViewer({ report, filters, onClose, onApplyFilters }: Props) {
  const { isFullScreen, toggle } = useFullScreen()
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dataCol = useColumnResize([96, 72, 120, 140, 88, 120, 120, 88, 100])
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'date' | 'amount'>('date')
  const [sched, setSched] = useState(false)
  const [schedFreq, setSchedFreq] = useState<'daily' | 'weekly'>('weekly')
  const [qboFrom, setQboFrom] = useState('')
  const [qboTo, setQboTo] = useState('')
  const [qboAsOf, setQboAsOf] = useState('')
  const [qboMethod, setQboMethod] = useState<'Cash' | 'Accrual'>('Cash')
  const [qboLoading, setQboLoading] = useState(false)
  const [qboErr, setQboErr] = useState('')
  const [qboSource, setQboSource] = useState('')
  const [qboGeneratedAt, setQboGeneratedAt] = useState('')
  const [qboRows, setQboRows] = useState<Array<{ type: string; depth: number; label: string; values: string[] }>>([])
  const [apiFrom, setApiFrom] = useState('')
  const [apiTo, setApiTo] = useState('')
  const [apiAsOf, setApiAsOf] = useState('')
  const [apiDriver, setApiDriver] = useState('')
  const [apiUnit, setApiUnit] = useState('')
  const [apiLoad, setApiLoad] = useState('')
  const [apiAccount, setApiAccount] = useState('')
  const [apiTxnType, setApiTxnType] = useState('')
  const [apiVendor, setApiVendor] = useState('')
  const [apiFactor, setApiFactor] = useState('')
  const [apiQuarter] = useState(String(Math.floor(new Date().getMonth() / 3) + 1))
  const [apiYear] = useState(String(new Date().getFullYear()))
  const [apiAging] = useState('30')
  const [apiLoading, setApiLoading] = useState(false)
  const [apiErr, setApiErr] = useState('')
  const [apiRows, setApiRows] = useState<Array<Record<string, any>>>([])
  const [apiSource, setApiSource] = useState('')
  const [relayRows, setRelayRows] = useState<Array<any>>([])
  const [relayLoading, setRelayLoading] = useState(false)

  const custom = report.viewer
  const isEmbed = Boolean(report.embedToolUrl)
  const isQboMirror = Boolean(report.qboReportName)
  const isRelayReport = report.id === 'D6'
  const apiEndpoint = useMemo(() => {
    const hint = String(report.apiHint || '').trim()
    const m = hint.match(/GET\s+(\S+)/i)
    return m?.[1] || ''
  }, [report.apiHint])
  const isApiReport = Boolean(apiEndpoint) && !isQboMirror && !isRelayReport

  const { rows, total } = useMemo(
    () =>
      custom || isEmbed ? { rows: [], total: 0 } : buildMockRows(report, filters, page, PAGE_SIZE),
    [report, filters, page, custom, isEmbed],
  )

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) =>
      sort === 'date' ? b.date.localeCompare(a.date) : b.amount - a.amount,
    )
    return copy
  }, [rows, sort])

  const totals = useMemo(
    () => sorted.reduce((s, r) => s + r.amount, 0),
    [sorted],
  )

  const bars = useMemo(
    () => (report.hasChart ? chartBarsFromRows(sorted) : []),
    [report.hasChart, sorted],
  )

  const empty = !custom && !isEmbed && !isQboMirror && !isRelayReport && !isApiReport && total === 0

  useTableTabOrder(dataCol.tableRef, [sorted, empty])

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const id = window.setTimeout(() => {
      const root = viewerRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
      const el = returnFocusRef.current
      if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0)
    }
  }, [onClose])

  useEffect(() => {
    if (!isQboMirror) return
    const d = new Date()
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    setQboFrom(start)
    setQboTo(end)
    setQboAsOf(end)
  }, [isQboMirror, report.id])

  const qboSupportsMethod = useMemo(() => {
    const slug = String(report.qboReportName || '')
    return slug === 'profit-loss' || slug === 'balance-sheet' || slug === 'cash-flow'
  }, [report.qboReportName])

  const qboQuickRange = (key: 'this-month' | 'last-month' | 'this-year' | 'last-year') => {
    const d = new Date()
    let from = ''
    let to = ''
    if (key === 'this-month') {
      from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    } else if (key === 'last-month') {
      from = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10)
    } else if (key === 'this-year') {
      from = new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10)
    } else {
      from = new Date(d.getFullYear() - 1, 0, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear() - 1, 11, 31).toISOString().slice(0, 10)
    }
    setQboFrom(from)
    setQboTo(to)
    setQboAsOf(to)
  }

  const apiQuickRange = (key: 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year') => {
    const d = new Date()
    let from = ''
    let to = ''
    if (key === 'this-month') {
      from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    } else if (key === 'last-month') {
      from = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10)
    } else if (key === 'this-quarter') {
      const q = Math.floor(d.getMonth() / 3)
      from = new Date(d.getFullYear(), q * 3, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10)
    } else if (key === 'last-quarter') {
      const q = Math.floor(d.getMonth() / 3) - 1
      from = new Date(d.getFullYear(), q * 3, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10)
    } else if (key === 'this-year') {
      from = new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10)
    } else {
      from = new Date(d.getFullYear() - 1, 0, 1).toISOString().slice(0, 10)
      to = new Date(d.getFullYear() - 1, 11, 31).toISOString().slice(0, 10)
    }
    setApiFrom(from)
    setApiTo(to)
    setApiAsOf(to)
  }

  const runQboReport = async (format: 'json' | 'csv' = 'json') => {
    if (!report.qboReportName) return
    const p = new URLSearchParams()
    if (qboFrom) p.set('start_date', qboFrom)
    if (qboTo) p.set('end_date', qboTo)
    if (qboAsOf) p.set('as_of_date', qboAsOf)
    if (qboSupportsMethod) p.set('accounting_method', qboMethod)
    if (format === 'csv') {
      p.set('format', 'csv')
      window.open(`/api/reports/qbo/${encodeURIComponent(report.qboReportName)}?${p.toString()}`, '_blank')
      return
    }
    setQboLoading(true)
    setQboErr('')
    try {
      const out = await fetch(`/api/reports/qbo/${encodeURIComponent(report.qboReportName)}?${p.toString()}`, {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json())
      const list: Array<{ type: string; depth: number; label: string; values: string[] }> = []
      const walk = (rowsIn: any[], depth: number) => {
        ;(Array.isArray(rowsIn) ? rowsIn : []).forEach((row) => {
          const cols = Array.isArray(row?.ColData) ? row.ColData : []
          const head = String(row?.Header?.ColData?.[0]?.value || '')
          const label = (head || String(cols?.[0]?.value || '')).trim() || '--'
          if (label || cols.length) {
            list.push({
              type: String(row?.type || row?.RowType || 'Data'),
              depth,
              label,
              values: cols.map((c: any) => String(c?.value || '')),
            })
          }
          if (Array.isArray(row?.Rows?.Row)) walk(row.Rows.Row, depth + 1)
        })
      }
      walk(out?.report?.Rows?.Row || [], 0)
      setQboRows(list)
      setQboSource(String(out?.source || ''))
      setQboGeneratedAt(String(out?.generatedAt || ''))
    } catch (e: any) {
      setQboErr(String(e?.message || e))
      setQboRows([])
    } finally {
      setQboLoading(false)
    }
  }

  useEffect(() => {
    if (!isQboMirror) return
    void runQboReport('json')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id])

  const runApiReport = async (format: 'json' | 'csv' = 'json') => {
    if (!apiEndpoint) return
    const p = new URLSearchParams()
    if (apiFrom) p.set('start_date', apiFrom)
    if (apiTo) p.set('end_date', apiTo)
    if (apiAsOf) p.set('as_of_date', apiAsOf)
    if (apiDriver) p.set('driver_id', apiDriver)
    if (apiUnit) p.set('unit_number', apiUnit)
    if (apiLoad) p.set('load_number', apiLoad)
    if (apiAccount) p.set('account_id', apiAccount)
    if (apiTxnType) p.set('transaction_type', apiTxnType)
    if (apiVendor) p.set('vendor_id', apiVendor)
    if (apiFactor) p.set('factor_name', apiFactor)
    if (apiQuarter) p.set('quarter', apiQuarter)
    if (apiYear) p.set('year', apiYear)
    if (apiAging) p.set('aging_period', apiAging)
    if (format === 'csv') {
      p.set('format', 'csv')
      window.open(`${apiEndpoint}?${p.toString()}`, '_blank')
      return
    }
    setApiLoading(true)
    setApiErr('')
    try {
      const out = await fetch(`${apiEndpoint}?${p.toString()}`, {
        headers: { Accept: 'application/json' },
      }).then((r) => r.json())
      const rows = Array.isArray(out?.rows)
        ? out.rows
        : Array.isArray(out?.transactions)
          ? out.transactions
          : Array.isArray(out?.accounts)
            ? out.accounts
            : []
      setApiRows(rows)
      setApiSource(String(out?.source || 'live'))
    } catch (e: any) {
      setApiErr(String(e?.message || e))
      setApiRows([])
      setApiSource('unavailable')
    } finally {
      setApiLoading(false)
    }
  }

  useEffect(() => {
    if (!isApiReport) return
    const d = new Date()
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    setApiFrom(start)
    setApiTo(end)
    setApiAsOf(end)
    setApiDriver('')
    setApiUnit('')
    setApiLoad('')
    setApiAccount('')
    setApiTxnType('')
    setApiVendor('')
    setApiFactor('')
    void runApiReport('json')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, isApiReport])

  useEffect(() => {
    if (!isRelayReport) return
    let cancelled = false
    const run = async () => {
      setRelayLoading(true)
      try {
        const out = await fetch('/api/fuel/expenses', { headers: { Accept: 'application/json' } }).then((r) => r.json())
        const rows = (Array.isArray(out?.data) ? out.data : []).filter(
          (r: any) => String(r?.source || '').toLowerCase() === 'relay',
        )
        if (!cancelled) setRelayRows(rows)
      } finally {
        if (!cancelled) setRelayLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [isRelayReport, report.id])

  const locationBody =
    custom === 'location_work_by_service' ? (
      <WorkByServiceLocationReport filters={filters} />
    ) : custom === 'location_internal_external' ? (
      <InternalExternalAnalysisReport filters={filters} />
    ) : custom === 'location_all_summary' ? (
      <AllLocationsSummaryReport filters={filters} onApplyFilters={onApplyFilters} />
    ) : custom === 'dot_4i_service_locations' ? (
      <Dot4iServiceLocationsReport filters={filters} />
    ) : null

  return (
    <div
      className={
        'viewer-overlay' + (isFullScreen ? ' app-modal-backdrop--fullscreen' : '')
      }
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={viewerRef}
        className={
          'viewer' +
          (report.category === 'safety' ? ' viewer--report-safety' : '')
        }
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
      >
        <header className="viewer__head">
          <div>
            <p className="eyebrow">{report.id}</p>
            <h2>{report.title}</h2>
            <p className="muted">{report.description}</p>
          </div>
          <div className="modal-generic-head__actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              className="btn ghost"
            />
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {isEmbed && report.embedToolUrl ? (
          <div
            className="viewer__scroll viewer__scroll--embed-tool"
            style={{
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
            }}
          >
            <iframe
              title={report.title}
              src={report.embedToolUrl}
              style={{
                flex: 1,
                border: 0,
                width: '100%',
                minHeight: 520,
                background: 'var(--color-bg-card, #fff)',
              }}
              referrerPolicy="same-origin"
            />
          </div>
        ) : (
        <div className="viewer__scroll">
          {custom ? (
            <div className="viewer__custom">{locationBody}</div>
          ) : isQboMirror ? (
            <>
              <section className="viewer__toolbar">
                <div className="sort" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label>
                    <span className="muted">From</span>
                    <input type="date" value={qboFrom} onChange={(e) => setQboFrom(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">To</span>
                    <input type="date" value={qboTo} onChange={(e) => setQboTo(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">As of</span>
                    <input type="date" value={qboAsOf} onChange={(e) => setQboAsOf(e.target.value)} />
                  </label>
                  {qboSupportsMethod ? (
                    <label>
                      <span className="muted">Method</span>
                      <select value={qboMethod} onChange={(e) => setQboMethod(e.target.value as 'Cash' | 'Accrual')}>
                        <option value="Cash">Cash</option>
                        <option value="Accrual">Accrual</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                <div className="exports">
                  <button type="button" className="btn sm ghost" onClick={() => qboQuickRange('this-month')}>This Month</button>
                  <button type="button" className="btn sm ghost" onClick={() => qboQuickRange('last-month')}>Last Month</button>
                  <button type="button" className="btn sm ghost" onClick={() => qboQuickRange('this-year')}>This Year</button>
                  <button type="button" className="btn sm ghost" onClick={() => void runQboReport('json')}>Run Report</button>
                  <button type="button" className="btn sm ghost" onClick={() => void runQboReport('csv')}>Export CSV</button>
                  <button type="button" className="btn sm ghost" onClick={() => window.print()}>Print</button>
                </div>
              </section>
              <section className="table-wrap reports-integrity-table-scroll">
                <p className="muted" style={{ marginBottom: 8 }}>
                  IH 35 Transportation LLC · {report.title}
                </p>
                {qboSource === 'cache' && qboGeneratedAt ? (
                  <p className="muted">Showing cached data from {qboGeneratedAt}</p>
                ) : null}
                {qboLoading ? <p className="empty">Fetching from QuickBooks...</p> : null}
                {qboErr ? <p className="empty">{qboErr}</p> : null}
                {!qboLoading && !qboErr ? (
                  <table className="data-table fr-data-table reports-integrity-data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Value 1</th>
                        <th>Value 2</th>
                        <th>Value 3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qboRows.map((r, i) => {
                        const v = r.values
                        const last = String(v[v.length - 1] || '')
                        const negative = /^\(.*\)$/.test(last) || last.startsWith('-')
                        const bold = String(r.type).toLowerCase().includes('summary') || String(r.type).toLowerCase().includes('total')
                        return (
                          <tr key={`${r.label}-${i}`}>
                            <td style={{ paddingLeft: `${r.depth * 20}px`, fontWeight: bold ? 700 : 400 }}>{r.label}</td>
                            <td>{v[1] || ''}</td>
                            <td>{v[2] || ''}</td>
                            <td style={{ fontWeight: bold ? 700 : 400, color: negative ? '#b42318' : undefined }}>{v[3] || last || ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : null}
              </section>
            </>
          ) : isApiReport ? (
            <>
              <section className="viewer__toolbar">
                <div className="sort" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <label>
                    <span className="muted">From</span>
                    <input type="date" value={apiFrom} onChange={(e) => setApiFrom(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">To</span>
                    <input type="date" value={apiTo} onChange={(e) => setApiTo(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">As of</span>
                    <input type="date" value={apiAsOf} onChange={(e) => setApiAsOf(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">Driver</span>
                    <input value={apiDriver} onChange={(e) => setApiDriver(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">Unit</span>
                    <input value={apiUnit} onChange={(e) => setApiUnit(e.target.value)} />
                  </label>
                  <label>
                    <span className="muted">Load</span>
                    <input value={apiLoad} onChange={(e) => setApiLoad(e.target.value)} />
                  </label>
                </div>
                <div className="exports">
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('this-month')}>This Month</button>
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('last-month')}>Last Month</button>
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('this-quarter')}>This Quarter</button>
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('last-quarter')}>Last Quarter</button>
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('this-year')}>This Year</button>
                  <button type="button" className="btn sm ghost" onClick={() => apiQuickRange('last-year')}>Last Year</button>
                  <button type="button" className="btn sm ghost" onClick={() => void runApiReport('json')}>Run Report</button>
                  <button type="button" className="btn sm ghost" onClick={() => void runApiReport('csv')}>Export CSV</button>
                  <button type="button" className="btn sm ghost" onClick={() => window.print()}>Print</button>
                </div>
              </section>
              <section className="table-wrap reports-integrity-table-scroll">
                <p className="muted" style={{ marginBottom: 8 }}>
                  Source: {apiSource || 'live'}
                </p>
                {apiLoading ? <p className="empty">Loading report...</p> : null}
                {apiErr ? <p className="empty">{apiErr}</p> : null}
                {!apiLoading && !apiErr ? (
                  <table className="data-table fr-data-table reports-integrity-data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <thead>
                      <tr>
                        {(Object.keys(apiRows[0] || {})).map((k) => (
                          <th key={k}>{k.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(apiRows.length ? apiRows : [{ empty: 'No rows' }]).map((r, i) => (
                        <tr key={`api-${i}`}>
                          {Object.keys(apiRows[0] || r || {}).map((k) => (
                            <td key={k}>{String((r as any)?.[k] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </section>
            </>
          ) : isRelayReport ? (
            <section className="table-wrap reports-integrity-table-scroll">
              {relayLoading ? <p className="empty">Loading relay transactions...</p> : null}
              {!relayLoading && !relayRows.length ? <p className="empty">No Relay transactions found.</p> : null}
              {!relayLoading && relayRows.length ? (
                <table className="data-table fr-data-table reports-integrity-data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Date</th><th>Driver</th><th>Unit</th><th>Gallons</th><th>Amount</th><th>Station</th><th>State</th><th>QBO</th><th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relayRows.slice(0, 1000).map((r, i) => (
                      <tr key={`${r?.id || i}`}>
                        <td>{String(r?.transaction_date || r?.submitted_at || '').slice(0, 10)}</td>
                        <td>{r?.driver_name || '--'}</td>
                        <td>{r?.unit_number || '--'}</td>
                        <td>{r?.gallons == null ? '--' : Number(r.gallons).toFixed(2)}</td>
                        <td>{Number(r?.total_amount || 0).toFixed(2)}</td>
                        <td>{r?.station_name || '--'}</td>
                        <td>{r?.state || '--'}</td>
                        <td>{r?.qbo_posted ? 'Posted' : 'Pending'}</td>
                        <td>{String(r?.source || 'relay')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : (
            <>
              <section className="viewer__toolbar">
                <div className="sort">
                  <span className="muted">Sort</span>
                  <button
                    type="button"
                    className={sort === 'date' ? 'btn sm primary' : 'btn sm ghost'}
                    onClick={() => setSort('date')}
                  >
                    Date
                  </button>
                  <button
                    type="button"
                    className={sort === 'amount' ? 'btn sm primary' : 'btn sm ghost'}
                    onClick={() => setSort('amount')}
                  >
                    Amount
                  </button>
                </div>
                <div className="exports">
                  <button
                    type="button"
                    className="btn sm ghost fr-table-excel-export"
                    onClick={() =>
                      exportDomTableToXlsx(dataCol.tableRef.current, `Report-${report.id}`)
                    }
                  >
                    Export to Excel
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => exportCsv(report, filters, sorted)}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => exportPdfPrint(report, filters, sorted)}
                  >
                    PDF
                  </button>
                </div>
              </section>

              <section className="viewer__schedule">
                <label className="sched">
                  <input
                    type="checkbox"
                    checked={sched}
                    onChange={(e) => setSched(e.target.checked)}
                  />
                  Scheduled reports
                </label>
                {sched && (
                  <div className="sched-row">
                    <label>
                      Frequency
                      <select
                        value={schedFreq}
                        onChange={(e) =>
                          setSchedFreq(e.target.value as 'daily' | 'weekly')
                        }
                      >
                        <option value="daily">Daily email</option>
                        <option value="weekly">Weekly email</option>
                      </select>
                    </label>
                    <span className="muted">
                      (Wire to your job runner / email service.)
                    </span>
                  </div>
                )}
              </section>

              {report.hasChart && bars.length > 0 && (
                <section className="chart-block" aria-label="Chart preview">
                  <h3>Trend preview</h3>
                  <div className="bars">
                    {bars.map((b) => (
                      <div key={b.label} className="bar-row">
                        <span className="bar-label">{b.label}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${b.pct}%` }} />
                        </div>
                        <span className="bar-val">{b.value.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="table-wrap reports-integrity-table-scroll">
                {empty ? (
                  <p className="empty">No rows for this range.</p>
                ) : (
                  <table
                    ref={dataCol.tableRef}
                    className="data-table fr-data-table reports-integrity-data-table"
                    style={{ tableLayout: 'fixed', width: '100%' }}
                  >
                    <colgroup>
                      {dataCol.widths.map((w, i) => (
                        <col key={i} style={{ width: w }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {(
                          [
                            ['Date', ''],
                            ['Unit', ''],
                            ['Driver', ''],
                            ['Vendor', ''],
                            ['Amount', 'num'],
                            ['Service type', ''],
                            ['Location', ''],
                            ['Loc. type', ''],
                            ['Record', ''],
                          ] as const
                        ).map(([label, cls], i) => (
                          <th
                            key={label}
                            className={`fr-th-resizable ${cls || ''}`.trim()}
                            style={{ width: dataCol.widths[i] }}
                          >
                            {label}
                            {i < dataCol.widths.length - 1 ? (
                              <span
                                className="fr-col-resize"
                                role="separator"
                                aria-hidden
                                onMouseDown={dataCol.onResizeMouseDown(i)}
                              />
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r, i) => (
                        <tr key={`${r.date}-${i}`}>
                          <td>{r.date}</td>
                          <td>{r.unit}</td>
                          <td>{r.driver}</td>
                          <td>{r.vendor}</td>
                          <td className="num">{r.amount.toFixed(2)}</td>
                          <td>{r.category}</td>
                          <td>{r.location}</td>
                          <td className="tiny">{r.locationType}</td>
                          <td className="tiny">{r.recordKind}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>Page total</td>
                        <td className="num">{totals.toFixed(2)}</td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>
                )}
                {!empty ? <TableResizeHintFooter /> : null}
              </section>

              <footer className="pager">
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className="muted">
                  Page {page} · {PAGE_SIZE} / page · {total} rows (demo)
                </span>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={page * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </footer>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
