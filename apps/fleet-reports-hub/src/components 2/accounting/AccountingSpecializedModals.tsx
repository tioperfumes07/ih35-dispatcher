import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { DateFilterBar } from '../DateFilterBar'
import type { DateFilterRange } from '../../lib/dateFilterQuickRanges'
import { defaultHistoryDateRange } from '../../lib/dateFilterQuickRanges'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { ResizeTableTh } from '../table/ResizeTableTh'

export type SpecializedModalId =
  | 'driver-settlement'
  | 'load-tms'
  | 'journal'
  | 'transfer'

type Props = {
  open: SpecializedModalId | null
  onClose: () => void
}

const WIDTH_STEPS = [680, 820, 960, 1100, 1240]

type HistoryRow = { id: string; date: string; label: string; amount?: string }

function HistorySection({
  title,
  rows,
  exportBase,
}: {
  title: string
  rows: HistoryRow[]
  exportBase: string
}) {
  const [range, setRange] = useState<DateFilterRange>(() => defaultHistoryDateRange())
  const col = useColumnResize([96, 260, 100])
  const filtered = useMemo(
    () => rows.filter((r) => r.date >= range.from && r.date <= range.to),
    [rows, range],
  )
  return (
    <section className="acct-spec-history" aria-label={title}>
      <div className="acct-spec-history__head">
        <h4 className="acct-spec-history__title">{title}</h4>
      </div>
      <DateFilterBar value={range} onApply={setRange} recordCount={filtered.length} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn sm"
          onClick={() => exportDomTableToXlsx(col.tableRef.current, exportBase)}
        >
          Export to Excel
        </button>
      </div>
      <div className="acct-spec-table-wrap">
        <table
          ref={col.tableRef}
          className="data-table acct-spec-table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {col.widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <ResizeTableTh colIndex={0} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Date
              </ResizeTableTh>
              <ResizeTableTh colIndex={1} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Description
              </ResizeTableTh>
              <ResizeTableTh colIndex={2} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                <span className="num">Amount</span>
              </ResizeTableTh>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No rows in this date range.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.label}</td>
                  <td className="num">{r.amount ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted tiny" style={{ marginTop: 6 }}>
        Drag column edges to resize
      </p>
    </section>
  )
}

function ModalShell({
  open,
  title,
  subtitle,
  children,
  saveBar,
  onClose,
}: {
  open: boolean
  title: string
  subtitle?: string
  children: React.ReactNode
  saveBar: React.ReactNode
  onClose: () => void
}) {
  const titleId = useId()
  const { isFullScreen, toggle } = useFullScreen()
  const [wIdx, setWIdx] = useState(2)

  useEffect(() => {
    if (!open) {
      setWIdx(2)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widthPx = WIDTH_STEPS[Math.min(WIDTH_STEPS.length - 1, Math.max(0, wIdx))]!

  return (
    <div className="acct-spec-modal" role="presentation" onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="acct-spec-modal__dialog"
        style={
          isFullScreen
            ? MODAL_FULLSCREEN_STYLE
            : { width: `min(${widthPx}px, 100% - 24px)` }
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="acct-spec-modal__title-bar">
          <div className="acct-spec-modal__title-bar-main">
            <p id={titleId} className="acct-spec-modal__title">
              {title}
            </p>
          </div>
          <div className="acct-spec-modal__title-bar-actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
            />
            <button type="button" className="modal-fs-toggle" onClick={onClose} aria-label="Close">
              <span className="modal-fs-toggle__icon" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </header>
        <div className="acct-spec-modal__scroll-body">
          {subtitle ? <p className="muted small acct-spec-modal__subtitle">{subtitle}</p> : null}
          {children}
        </div>
        <footer className="acct-spec-modal__save-bar">{saveBar}</footer>
        <div
          className="acct-spec-modal__resize-handle"
          role="separator"
          aria-label="Modal width"
        >
          <span className="acct-spec-modal__resize-grip" aria-hidden />
          <button
            type="button"
            className="btn sm ghost"
            disabled={isFullScreen || wIdx <= 0}
            onClick={() => setWIdx((i) => Math.max(0, i - 1))}
          >
            Resize −
          </button>
          <button
            type="button"
            className="btn sm ghost"
            disabled={isFullScreen || wIdx >= WIDTH_STEPS.length - 1}
            onClick={() => setWIdx((i) => Math.min(WIDTH_STEPS.length - 1, i + 1))}
          >
            Resize +
          </button>
        </div>
      </div>
    </div>
  )
}

const MOCK_ACCOUNTS: { id: string; label: string; balance: number }[] = [
  { id: '1000', label: '1000 · Operating checking', balance: 48250.33 },
  { id: '1010', label: '1010 · Payroll clearing', balance: 12400.0 },
  { id: '2100', label: '2100 · AP trade', balance: -8932.12 },
  { id: '5200', label: '5200 · Fuel expense', balance: 0 },
]

function money(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function DriverSettlementModal({ onClose }: { onClose: () => void }) {
  const [driver, setDriver] = useState('J. Martinez')
  const [settlementNo, setSettlementNo] = useState('ST-2026-0412')
  const [periodFrom, setPeriodFrom] = useState('2026-04-07')
  const [periodTo, setPeriodTo] = useState('2026-04-13')
  const [payFrom, setPayFrom] = useState('1010')
  const [method, setMethod] = useState('ACH')
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [checkNo, setCheckNo] = useState('')
  const loads = useMemo(
    () => [
      { id: 'L1', load: 'LD-8891', miles: '612', revenue: 3200, fuel: 420, other: 35 },
      { id: 'L2', load: 'LD-8897', miles: '544', revenue: 2980, fuel: 380, other: 0 },
    ],
    [],
  )
  const deductions = useMemo(
    () => [
      { id: 'd1', desc: 'Cash advance', amt: 200 },
      { id: 'd2', desc: 'Lumper', amt: 75 },
    ],
    [],
  )
  const gross = loads.reduce((s, r) => s + r.revenue, 0)
  const dedTotal = deductions.reduce((s, r) => s + r.amt, 0) + loads.reduce((s, r) => s + r.fuel + r.other, 0)
  const net = gross - dedTotal
  const historyRows: HistoryRow[] = useMemo(
    () => [
      { id: 's1', date: '2026-04-06', label: 'ST-2026-0399 · NET $2,841', amount: '$2,841.00' },
      { id: 's2', date: '2026-03-30', label: 'ST-2026-0381 · NET $3,102', amount: '$3,102.00' },
    ],
    [],
  )

  const loadsCol = useColumnResize([120, 88, 120, 120])
  const dedCol = useColumnResize([240, 100])

  const printSettlement = useCallback(() => {
    const w = window.open('', '_blank')
    if (!w) return
    const loadRows = loads
      .map(
        (r) =>
          `<tr><td>${r.load}</td><td class="r">${r.miles}</td><td class="r">${money(r.revenue)}</td><td class="r">${money(r.fuel + r.other)}</td></tr>`,
      )
      .join('')
    const dedRows = deductions
      .map((r) => `<tr><td>${r.desc}</td><td class="r">${money(r.amt)}</td></tr>`)
      .join('')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Settlement ${settlementNo}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:760px;margin:0 auto}
        h1{font-size:20px;margin:0 0 8px}
        .sub{color:#555;font-size:13px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px}
        th,td{border:1px solid #ddd;padding:8px;text-align:left}
        th{background:#f4f4f5}
        .r{text-align:right}
        .net{font-size:22px;font-weight:700;color:#15803d;margin-top:12px}
        @media print{button{display:none}}
      </style></head><body>`)
    w.document.write(`<h1>Driver settlement · ${driver}</h1>`)
    w.document.write(
      `<div class="sub">${settlementNo} · ${periodFrom} → ${periodTo} · ${method} · ${payDate}${checkNo ? ` · Check #${checkNo}` : ''}</div>`,
    )
    w.document.write('<h2>Loads</h2><table><thead><tr><th>Load</th><th class="r">Miles</th><th class="r">Revenue</th><th class="r">Charges</th></tr></thead><tbody>')
    w.document.write(loadRows)
    w.document.write('</tbody></table><h2>Deductions</h2><table><thead><tr><th>Item</th><th class="r">Amount</th></tr></thead><tbody>')
    w.document.write(dedRows)
    w.document.write('</tbody></table>')
    w.document.write(
      `<p>Gross: <strong>${money(gross)}</strong> · Deductions &amp; charges: <strong>${money(dedTotal)}</strong></p>`,
    )
    w.document.write(`<p class="net">NET PAY ${money(net)}</p>`)
    w.document.write('<button type="button" onclick="window.print()">Print</button></body></html>')
    w.document.close()
  }, [checkNo, deductions, driver, gross, dedTotal, loads, method, net, payDate, periodFrom, periodTo, settlementNo])

  return (
    <ModalShell
      open
      title="Driver settlement"
      onClose={onClose}
      saveBar={
        <>
          <button type="button" className="btn primary">
            Save
          </button>
          <button type="button" className="btn secondary">
            Post to QBO
          </button>
          <button type="button" className="btn sm ghost" onClick={printSettlement}>
            Print settlement
          </button>
        </>
      }
    >
      <div className="acct-spec-form">
        <div className="acct-spec-grid acct-spec-grid--4">
          <label className="acct-spec-field">
            <span>Driver</span>
            <input value={driver} onChange={(e) => setDriver(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Settlement#</span>
            <input value={settlementNo} onChange={(e) => setSettlementNo(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Period from</span>
            <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Period to</span>
            <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </label>
        </div>
        <div className="acct-spec-grid acct-spec-grid--4">
          <label className="acct-spec-field">
            <span>Pay from</span>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)}>
              {MOCK_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="acct-spec-field">
            <span>Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>ACH</option>
              <option>Check</option>
              <option>Instant pay</option>
            </select>
          </label>
          <label className="acct-spec-field">
            <span>Date</span>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Check#</span>
            <input
              value={checkNo}
              onChange={(e) => setCheckNo(e.target.value)}
              placeholder="If check"
              disabled={method !== 'Check'}
            />
          </label>
        </div>

        <h4 className="acct-spec-h4">Loads (this driver · period)</h4>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => exportDomTableToXlsx(loadsCol.tableRef.current, 'DriverSettlementLoads')}
          >
            Export loads to Excel
          </button>
        </div>
        <div className="acct-spec-table-wrap">
          <table
            ref={loadsCol.tableRef}
            className="data-table acct-spec-table fr-data-table"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              {loadsCol.widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <ResizeTableTh colIndex={0} widths={loadsCol.widths} onResizeMouseDown={loadsCol.onResizeMouseDown}>
                  Load#
                </ResizeTableTh>
                <ResizeTableTh colIndex={1} widths={loadsCol.widths} onResizeMouseDown={loadsCol.onResizeMouseDown}>
                  <span className="num">Miles</span>
                </ResizeTableTh>
                <ResizeTableTh colIndex={2} widths={loadsCol.widths} onResizeMouseDown={loadsCol.onResizeMouseDown}>
                  <span className="num">Revenue</span>
                </ResizeTableTh>
                <ResizeTableTh colIndex={3} widths={loadsCol.widths} onResizeMouseDown={loadsCol.onResizeMouseDown}>
                  <span className="num">Fuel + other</span>
                </ResizeTableTh>
              </tr>
            </thead>
            <tbody>
              {loads.map((r) => (
                <tr key={r.id}>
                  <td>{r.load}</td>
                  <td className="num">{r.miles}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className="num">{money(r.fuel + r.other)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted tiny" style={{ margin: '4px 0 12px' }}>
          Drag column edges to resize
        </p>

        <h4 className="acct-spec-h4">Deductions</h4>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => exportDomTableToXlsx(dedCol.tableRef.current, 'DriverSettlementDeductions')}
          >
            Export deductions to Excel
          </button>
        </div>
        <div className="acct-spec-table-wrap">
          <table
            ref={dedCol.tableRef}
            className="data-table acct-spec-table fr-data-table"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              {dedCol.widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <ResizeTableTh colIndex={0} widths={dedCol.widths} onResizeMouseDown={dedCol.onResizeMouseDown}>
                  Description
                </ResizeTableTh>
                <ResizeTableTh colIndex={1} widths={dedCol.widths} onResizeMouseDown={dedCol.onResizeMouseDown}>
                  <span className="num">Amount</span>
                </ResizeTableTh>
              </tr>
            </thead>
            <tbody>
              {deductions.map((r) => (
                <tr key={r.id}>
                  <td>{r.desc}</td>
                  <td className="num">{money(r.amt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted tiny" style={{ margin: '4px 0 12px' }}>
          Drag column edges to resize
        </p>

        <div className="acct-spec-summary">
          <div>
            <span className="muted">Gross</span>
            <p className="acct-spec-summary__val">{money(gross)}</p>
          </div>
          <div>
            <span className="muted">Deductions &amp; charges</span>
            <p className="acct-spec-summary__val">{money(dedTotal)}</p>
          </div>
          <div className="acct-spec-summary__net-wrap">
            <span className="muted">NET PAY</span>
            <p className="acct-spec-summary__net">{money(net)}</p>
          </div>
        </div>
      </div>
      <HistorySection
        title="Settlement history"
        rows={historyRows}
        exportBase="DriverSettlementHistory"
      />
    </ModalShell>
  )
}

function LoadTmsModal({ onClose }: { onClose: () => void }) {
  const [loadNo, setLoadNo] = useState('LD-9001')
  const [status, setStatus] = useState('Delivered')
  const [pickup, setPickup] = useState('2026-04-16')
  const [delivery, setDelivery] = useState('2026-04-18')
  const [driver, setDriver] = useState('A. Chen')
  const [unit, setUnit] = useState('Unit 104')
  const [customer, setCustomer] = useState('Acme Foods')
  const [revenue, setRevenue] = useState('2850')
  const [origin, setOrigin] = useState('Dallas, TX')
  const [dest, setDest] = useState('Denver, CO')
  const [miles, setMiles] = useState('782')
  const [invoiceNo, setInvoiceNo] = useState('INV-77821')
  const historyRows: HistoryRow[] = useMemo(
    () => [
      { id: 'l1', date: '2026-04-17', label: 'LD-8990 · Delivered', amount: '$3,100' },
      { id: 'l2', date: '2026-04-10', label: 'LD-8971 · Invoiced', amount: '$2,640' },
    ],
    [],
  )

  return (
    <ModalShell
      open
      title="Load / TMS entry"
      onClose={onClose}
      saveBar={
        <button type="button" className="btn primary">
          Save
        </button>
      }
    >
      <div className="acct-spec-form">
        <div className="acct-spec-grid acct-spec-grid--4">
          <label className="acct-spec-field">
            <span>Load#</span>
            <input value={loadNo} onChange={(e) => setLoadNo(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>Booked</option>
              <option>In transit</option>
              <option>Delivered</option>
              <option>Invoiced</option>
            </select>
          </label>
          <label className="acct-spec-field">
            <span>Pickup date</span>
            <input type="date" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Delivery date</span>
            <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </label>
        </div>
        <div className="acct-spec-grid acct-spec-grid--4">
          <label className="acct-spec-field">
            <span>Driver</span>
            <input value={driver} onChange={(e) => setDriver(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Unit</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Customer</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Revenue</span>
            <input value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </label>
        </div>
        <div className="acct-spec-grid acct-spec-grid--4">
          <label className="acct-spec-field">
            <span>Origin</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Destination</span>
            <input value={dest} onChange={(e) => setDest(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Miles</span>
            <input value={miles} onChange={(e) => setMiles(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Invoice#</span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </label>
        </div>
      </div>
      <HistorySection title="Load history" rows={historyRows} exportBase="LoadTmsHistory" />
    </ModalShell>
  )
}

type JeLine = {
  id: string
  account: string
  desc: string
  debit: string
  credit: string
  name: string
  qbClass: string
}

function JournalEntryModal({ onClose }: { onClose: () => void }) {
  const [jeDate, setJeDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [jeNo, setJeNo] = useState('JE-10442')
  const [memo, setMemo] = useState('Period fuel accrual')
  const [lines, setLines] = useState<JeLine[]>([
    {
      id: '1',
      account: '5200',
      desc: 'Fuel expense',
      debit: '500.00',
      credit: '',
      name: 'Fleet',
      qbClass: 'Linehaul',
    },
    {
      id: '2',
      account: '2100',
      desc: 'AP accrual',
      debit: '',
      credit: '500.00',
      name: 'Pilot',
      qbClass: 'Linehaul',
    },
  ])

  const totals = useMemo(() => {
    let d = 0
    let c = 0
    for (const row of lines) {
      d += parseFloat(row.debit) || 0
      c += parseFloat(row.credit) || 0
    }
    return { debit: d, credit: c, diff: d - c }
  }, [lines])
  const balanced = Math.abs(totals.diff) < 0.005
  const jeLinesCol = useColumnResize([120, 160, 88, 88, 120, 100])

  const patchLine = (id: string, patch: Partial<JeLine>) =>
    setLines((L) => L.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const historyRows: HistoryRow[] = useMemo(
    () => [
      { id: 'j1', date: '2026-04-12', label: 'JE-10430 · Accrual true-up', amount: '$0.00' },
      { id: 'j2', date: '2026-04-01', label: 'JE-10401 · Month close', amount: '$0.00' },
    ],
    [],
  )

  return (
    <ModalShell
      open
      title="Journal entry"
      onClose={onClose}
      saveBar={
        <>
          <button type="button" className="btn primary" disabled={!balanced}>
            Save
          </button>
          <button type="button" className="btn secondary" disabled={!balanced}>
            Post to QBO
          </button>
        </>
      }
    >
      <div className="acct-spec-form">
        <div className="acct-spec-grid acct-spec-grid--3">
          <label className="acct-spec-field">
            <span>Date</span>
            <input type="date" value={jeDate} onChange={(e) => setJeDate(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Journal#</span>
            <input value={jeNo} onChange={(e) => setJeNo(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Memo</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>

        <div className="acct-spec-section-head">
          <h4>Lines</h4>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() =>
              setLines((L) => [
                ...L,
                {
                  id: crypto.randomUUID(),
                  account: '',
                  desc: '',
                  debit: '',
                  credit: '',
                  name: '',
                  qbClass: '',
                },
              ])
            }
          >
            + Line
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => exportDomTableToXlsx(jeLinesCol.tableRef.current, 'JournalEntryLines')}
          >
            Export lines to Excel
          </button>
        </div>
        <div className="acct-spec-table-wrap acct-spec-table-wrap--wide">
          <table
            ref={jeLinesCol.tableRef}
            className="data-table acct-spec-table fr-data-table"
            style={{ tableLayout: 'fixed', width: '100%' }}
          >
            <colgroup>
              {jeLinesCol.widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <ResizeTableTh colIndex={0} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  Account
                </ResizeTableTh>
                <ResizeTableTh colIndex={1} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  Desc
                </ResizeTableTh>
                <ResizeTableTh colIndex={2} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  <span className="num">Debit</span>
                </ResizeTableTh>
                <ResizeTableTh colIndex={3} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  <span className="num">Credit</span>
                </ResizeTableTh>
                <ResizeTableTh colIndex={4} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  Name
                </ResizeTableTh>
                <ResizeTableTh colIndex={5} widths={jeLinesCol.widths} onResizeMouseDown={jeLinesCol.onResizeMouseDown}>
                  Class
                </ResizeTableTh>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      className="acct-spec-table-input"
                      value={row.account}
                      onChange={(e) => patchLine(row.id, { account: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="acct-spec-table-input"
                      value={row.desc}
                      onChange={(e) => patchLine(row.id, { desc: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="acct-spec-table-input num"
                      value={row.debit}
                      onChange={(e) => patchLine(row.id, { debit: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="acct-spec-table-input num"
                      value={row.credit}
                      onChange={(e) => patchLine(row.id, { credit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="acct-spec-table-input"
                      value={row.name}
                      onChange={(e) => patchLine(row.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="acct-spec-table-input"
                      value={row.qbClass}
                      onChange={(e) => patchLine(row.id, { qbClass: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Running totals</strong>
                  {!balanced ? (
                    <span className="acct-spec-imbalance"> · Out of balance by {money(Math.abs(totals.diff))}</span>
                  ) : (
                    <span className="acct-spec-balanced"> · Balanced</span>
                  )}
                </td>
                <td className="num">
                  <strong>{money(totals.debit)}</strong>
                </td>
                <td className="num">
                  <strong>{money(totals.credit)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted tiny" style={{ marginTop: 6 }}>
          Drag column edges to resize
        </p>
      </div>
      <HistorySection title="Journal history" rows={historyRows} exportBase="JournalEntryHistory" />
    </ModalShell>
  )
}

function TransferModal({ onClose }: { onClose: () => void }) {
  const [fromId, setFromId] = useState('1000')
  const [toId, setToId] = useState('1010')
  const [amount, setAmount] = useState('2500')
  const [memo, setMemo] = useState('Operating → payroll prefund')
  const [refNo, setRefNo] = useState('TRF-2026-0088')

  const fromAcc = MOCK_ACCOUNTS.find((a) => a.id === fromId)
  const toAcc = MOCK_ACCOUNTS.find((a) => a.id === toId)
  const amt = parseFloat(amount) || 0
  const same = fromId === toId
  const preview = useMemo(() => {
    if (!fromAcc || !toAcc) return null
    const fromAfter = fromAcc.balance - amt
    const toAfter = toAcc.balance + amt
    return { fromAfter, toAfter }
  }, [fromAcc, toAcc, amt])

  const historyRows: HistoryRow[] = useMemo(
    () => [
      { id: 't1', date: '2026-04-11', label: '1000 → 1010 · Prefund', amount: '$1,800.00' },
      { id: 't2', date: '2026-04-02', label: '1000 → 2100 · Vendor hold', amount: '$600.00' },
    ],
    [],
  )

  return (
    <ModalShell
      open
      title="Transfer"
      onClose={onClose}
      saveBar={
        <>
          <button type="button" className="btn primary" disabled={same || amt <= 0}>
            Save
          </button>
          <button type="button" className="btn secondary" disabled={same || amt <= 0}>
            Post to QBO
          </button>
        </>
      }
    >
      <div className="acct-spec-form">
        <div className="acct-spec-grid acct-spec-grid--2">
          <label className="acct-spec-field">
            <span>From account</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {MOCK_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="acct-spec-field">
            <span>To account</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              {MOCK_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {same ? (
          <p className="acct-spec-error" role="alert">
            Choose two different accounts.
          </p>
        ) : null}

        <div className="acct-spec-grid acct-spec-grid--3">
          <label className="acct-spec-field">
            <span>Amount</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Memo</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
          <label className="acct-spec-field">
            <span>Reference#</span>
            <input value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </label>
        </div>

        {fromAcc && toAcc && preview && !same ? (
          <div className="acct-spec-balance-preview" aria-live="polite">
            <p className="acct-spec-balance-preview__title">Balance preview (after transfer)</p>
            <ul className="acct-spec-balance-preview__list">
              <li>
                <span className="muted">{fromAcc.label}</span>
                <span>
                  {money(fromAcc.balance)} → <strong>{money(preview.fromAfter)}</strong>
                </span>
              </li>
              <li>
                <span className="muted">{toAcc.label}</span>
                <span>
                  {money(toAcc.balance)} → <strong>{money(preview.toAfter)}</strong>
                </span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>
      <HistorySection title="Transfer history" rows={historyRows} exportBase="TransferHistory" />
    </ModalShell>
  )
}

export function AccountingSpecializedModals({ open, onClose }: Props) {
  if (!open) return null
  switch (open) {
    case 'driver-settlement':
      return <DriverSettlementModal onClose={onClose} />
    case 'load-tms':
      return <LoadTmsModal onClose={onClose} />
    case 'journal':
      return <JournalEntryModal onClose={onClose} />
    case 'transfer':
      return <TransferModal onClose={onClose} />
    default:
      return null
  }
}
