import { useCallback, useEffect, useMemo, useState } from 'react'
import { useColumnResize } from '../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../lib/tableExportXlsx'
import {
  getOpenBills,
  getPaymentHistory,
  searchVendors,
  type VendorRecord,
} from '../data/billPaymentMock'
import { paymentNumberForBill } from '../lib/paymentNumber'
import { DateFilterBar } from './DateFilterBar'
import { ModalFullscreenToggle } from './ModalFullscreenToggle'
import type { DateFilterRange } from '../lib/dateFilterQuickRanges'
import {
  defaultHistoryDateRange,
  toIsoDate,
} from '../lib/dateFilterQuickRanges'

function wideOpenBillsDateRange(): DateFilterRange {
  const now = new Date()
  const start = new Date(now.getFullYear() - 2, 0, 1)
  return { from: toIsoDate(start), to: toIsoDate(now) }
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function dueTone(dueIso: string): 'overdue' | 'thisWeek' | 'ok' {
  const due = startOfDay(new Date(dueIso + 'T12:00:00'))
  if (Number.isNaN(due.getTime())) return 'ok'
  const today = startOfDay(new Date())
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)
  if (due < today) return 'overdue'
  if (due <= weekEnd) return 'thisWeek'
  return 'ok'
}

function money(n: number) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

type BillPayState = Record<string, { checked: boolean; amount: string }>

export type BillPaymentPageProps = {
  /** Hide instructional copy (numbering hints, empty-state prose, drawer explainer). */
  suppressHelpText?: boolean
  /** Omit the in-page “Bill payment” heading when the parent section supplies a title. */
  hidePageTitle?: boolean
}

export function BillPaymentPage({
  suppressHelpText = false,
  hidePageTitle = false,
}: BillPaymentPageProps = {}) {
  const [vendorQuery, setVendorQuery] = useState('')
  const [selected, setSelected] = useState<VendorRecord | null>(null)
  const [payAccount, setPayAccount] = useState('Operating · 1020')
  const [payDate, setPayDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [payMethod, setPayMethod] = useState('Check')
  const [checkNo, setCheckNo] = useState('')
  const [memo, setMemo] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [billState, setBillState] = useState<BillPayState>({})
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null)
  const [payDrawerFs, setPayDrawerFs] = useState(false)
  const openBillsCol = useColumnResize([44, 112, 92, 92, 200, 88, 88, 88, 88, 104, 140])
  const historyCol = useColumnResize([120, 92, 104, 92, 92, 92, 92, 100, 140, 72, 200, 96])
  const detailPayCol = useColumnResize([120, 104, 92, 100, 88])

  useEffect(() => {
    if (!detailBatchId) setPayDrawerFs(false)
  }, [detailBatchId])

  useEffect(() => {
    if (!detailBatchId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailBatchId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailBatchId])
  const [openBillsDateRange, setOpenBillsDateRange] = useState<DateFilterRange>(
    () => wideOpenBillsDateRange(),
  )
  const [historyDateRange, setHistoryDateRange] = useState<DateFilterRange>(
    () => defaultHistoryDateRange(),
  )

  const matches = useMemo(
    () => searchVendors(vendorQuery),
    [vendorQuery],
  )

  const allOpenBills = useMemo(
    () => (selected ? getOpenBills(selected.id) : []),
    [selected],
  )

  const openBills = useMemo(
    () =>
      allOpenBills.filter(
        (b) =>
          b.billDate >= openBillsDateRange.from &&
          b.billDate <= openBillsDateRange.to,
      ),
    [allOpenBills, openBillsDateRange],
  )

  const history = useMemo(
    () => (selected ? getPaymentHistory(selected.id) : []),
    [selected],
  )

  const filteredPaymentHistory = useMemo(
    () =>
      history.filter(
        (h) => h.date >= historyDateRange.from && h.date <= historyDateRange.to,
      ),
    [history, historyDateRange],
  )

  const batchSizes = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of filteredPaymentHistory) {
      m.set(h.batchId, (m.get(h.batchId) ?? 0) + 1)
    }
    return m
  }, [filteredPaymentHistory])

  const pickVendor = useCallback((v: VendorRecord) => {
    setSelected(v)
    setSaveMsg(null)
    setVendorQuery(v.name)
    setBillState({})
    setDetailBatchId(null)
    setHistoryDateRange(defaultHistoryDateRange())
    setOpenBillsDateRange(wideOpenBillsDateRange())
  }, [])

  const clearVendor = useCallback(() => {
    setSelected(null)
    setSaveMsg(null)
    setVendorQuery('')
    setBillState({})
    setDetailBatchId(null)
    setHistoryDateRange(defaultHistoryDateRange())
    setOpenBillsDateRange(wideOpenBillsDateRange())
  }, [])

  const setRow = (id: string, patch: Partial<{ checked: boolean; amount: string }>) => {
    setBillState((prev) => {
      const row = openBills.find((b) => b.id === id)
      const open = row?.openBalance ?? 0
      const cur = prev[id] ?? { checked: false, amount: '' }
      const next = { ...cur, ...patch }
      if (patch.checked === true) {
        next.amount = open > 0 ? String(open) : ''
      }
      if (patch.checked === false) {
        next.amount = ''
      }
      return { ...prev, [id]: next }
    })
  }

  const totals = useMemo(() => {
    let t = 0
    const errs: Record<string, string> = {}
    for (const b of openBills) {
      const st = billState[b.id]
      if (!st?.checked) continue
      const amt = parseFloat(st.amount)
      if (!Number.isFinite(amt) || amt <= 0) {
        errs[b.id] = 'Enter a payment amount'
        continue
      }
      if (amt > b.openBalance + 1e-6) {
        errs[b.id] = `Cannot exceed open balance (${money(b.openBalance)})`
        continue
      }
      t += amt
    }
    return { payTotal: t, errors: errs }
  }, [openBills, billState])

  const saveDisabled =
    totals.payTotal <= 0 || Object.keys(totals.errors).length > 0

  const savePayment = () => {
    if (saveDisabled || !selected) return
    const batchId = crypto.randomUUID()
    void batchId
    setSaveMsg(
      `Saved payment batch. Total: $${money(totals.payTotal)}. Bills linked by batch_id (demo — wire to API).`,
    )
    setBillState({})
    setCheckNo('')
    setMemo('')
  }

  const detailLines = useMemo(() => {
    if (!detailBatchId) return []
    return history.filter((h) => h.batchId === detailBatchId)
  }, [history, detailBatchId])

  const printReceipt = () => {
    if (!selected || detailLines.length === 0) return
    const w = window.open('', '_blank')
    if (!w) return
    const title = `Payment receipt · ${selected.name}`
    const rows = detailLines
      .map(
        (r) =>
          `<tr><td>${r.paymentNo}</td><td>${r.billNoPaid}</td><td>${r.billDate}</td><td class="r">${money(r.paymentAmount)}</td><td>${r.method}</td><td>${r.account}</td><td>${r.checkNo}</td></tr>`,
      )
      .join('')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111;max-width:720px;margin:0 auto}
        h1{font-size:18px;margin:0 0 4px}
        .sub{color:#555;font-size:13px;margin-bottom:20px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{border:1px solid #ddd;padding:8px;text-align:left}
        th{background:#f4f4f5}
        .r{text-align:right}
        .foot{margin-top:16px;font-size:14px}
        @media print{button{display:none}}
      </style></head><body>`)
    w.document.write(`<h1>${title}</h1>`)
    w.document.write(
      `<div class="sub">Date ${payDate} · Memo ${memo || '—'}</div>`,
    )
    w.document.write(
      '<table><thead><tr><th>Payment #</th><th>Bill</th><th>Bill date</th><th class="r">Paid</th><th>Method</th><th>Account</th><th>Check #</th></tr></thead><tbody>',
    )
    w.document.write(rows)
    w.document.write('</tbody></table>')
    const sum = detailLines.reduce((s, r) => s + r.paymentAmount, 0)
    w.document.write(
      `<p class="foot"><strong>Total paid:</strong> ${money(sum)}</p>`,
    )
    w.document.write(
      '<button type="button" onclick="window.print()">Print</button></body></html>',
    )
    w.document.close()
  }

  return (
    <div className="bill-pay">
      <div className="bill-pay__vendor-search">
        <label className="bill-pay__vendor-label">
          <span className="sr-only">Search vendor</span>
          <input
            className="bill-pay__vendor-input"
            value={vendorQuery}
            onChange={(e) => {
              setVendorQuery(e.target.value)
              setSelected(null)
            }}
            placeholder="Search vendor by name…"
            autoComplete="off"
          />
        </label>
        {!selected && vendorQuery.trim() && (
          <ul className="bill-pay__vendor-suggest" role="listbox">
            {matches.length === 0 ? (
              <li className="bill-pay__vendor-suggest-empty">No matches</li>
            ) : (
              matches.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    className="bill-pay__vendor-option"
                    onClick={() => pickVendor(v)}
                  >
                    <span className="bill-pay__vendor-option-name">{v.name}</span>
                    <span className="bill-pay__vendor-option-meta">
                      Open {money(v.openBalance)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {selected && (
        <>
          <div className="bill-pay__toolbar">
            {!hidePageTitle && (
              <h2 className="bill-pay__page-title">Bill payment</h2>
            )}
            <button type="button" className="btn sm ghost" onClick={clearVendor}>
              Change vendor
            </button>
          </div>

          <section className="bill-pay__vendor-bar" aria-label="Vendor summary">
            <div>
              <span className="bill-pay__vendor-name">{selected.name}</span>
            </div>
            <div className="bill-pay__vendor-stats">
              <div>
                <span className="muted tiny">Open balance</span>
                <span
                  className={
                    'bill-pay__stat-val' +
                    (selected.openBalance > 0 ? ' is-negative' : '')
                  }
                >
                  {money(selected.openBalance)}
                </span>
              </div>
              <div>
                <span className="muted tiny">Oldest bill</span>
                <span className="bill-pay__stat-val">{selected.oldestBillDate}</span>
              </div>
              <div>
                <span className="muted tiny">Bills</span>
                <span className="bill-pay__stat-val">{selected.billCount}</span>
              </div>
              <div>
                <span className="muted tiny">Overdue</span>
                <span className="bill-pay__stat-val">{selected.overdueCount}</span>
              </div>
            </div>
          </section>

          <section className="bill-pay__pay-header" aria-label="Payment details">
            <h3 className="bill-pay__section-title">Payment</h3>
            {saveMsg ? (
              <p className="nm-banner nm-banner--ok" role="status">
                {saveMsg}
              </p>
            ) : null}
            <div className="bill-pay__pay-grid">
              <label className="field">
                <span>Pay from account</span>
                <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
                  <option>Operating · 1020</option>
                  <option>Payroll clearing · 2100</option>
                  <option>Line of credit · 3100</option>
                </select>
              </label>
              <label className="field">
                <span>Payment date</span>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Payment method</span>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option>Check</option>
                  <option>ACH</option>
                  <option>Card</option>
                  <option>Cash</option>
                </select>
              </label>
              <label className="field">
                <span>Check #</span>
                <input
                  value={checkNo}
                  onChange={(e) => setCheckNo(e.target.value)}
                  placeholder="—"
                />
              </label>
              <label className="field bill-pay__field-span">
                <span>Memo</span>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Optional memo for QBO / bank"
                />
              </label>
            </div>
          </section>

          <section className="bill-pay__table-block" aria-label="Open bills">
            <h3 className="bill-pay__section-title">Open bills</h3>
            <DateFilterBar
              value={openBillsDateRange}
              onApply={setOpenBillsDateRange}
              recordCount={openBills.length}
            />
            {!suppressHelpText && (
              <p className="muted small bill-pay__numbering-hint">
                Payment numbers: first on bill <code>1500</code> → <code>1500</code>;
                next → <code>1500-1</code>, then <code>1500-2</code>. Same for{' '}
                <code>INS-JAN</code> → <code>INS-JAN-1</code>. Bills linked by{' '}
                <code>batch_id</code> on save.
              </p>
            )}
            <div className="bill-pay__table-toolbar">
              <button
                type="button"
                className="btn sm"
                disabled={!selected}
                onClick={() =>
                  exportDomTableToXlsx(
                    openBillsCol.tableRef.current,
                    selected ? `OpenBills-${selected.name.replace(/\s+/g, '_')}` : 'OpenBills',
                  )
                }
              >
                Export to Excel
              </button>
            </div>
            <div className="bill-pay__scroll">
              <table
                ref={openBillsCol.tableRef}
                className="bill-pay__table fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {openBillsCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(
                      [
                        { h: '', cls: 'th-check' },
                        { h: 'BILL #', cls: '' },
                        { h: 'BILL DATE', cls: '' },
                        { h: 'DUE DATE', cls: '' },
                        { h: 'DESCRIPTION', cls: '' },
                        { h: 'ORIGINAL', cls: 'num' },
                        { h: 'AMOUNT PAID', cls: 'num' },
                        { h: 'OPEN BALANCE', cls: 'num' },
                        { h: 'CREDITS', cls: 'num' },
                        { h: 'PAYMENT AMOUNT', cls: 'num' },
                        { h: 'Next payment #', cls: '' },
                      ] as const
                    ).map((cell, i) => (
                      <th key={i} className={`fr-th-resizable ${cell.cls}`.trim()}>
                        {cell.h}
                        {i < openBillsCol.widths.length - 1 ? (
                          <span
                            className="fr-col-resize"
                            role="presentation"
                            onMouseDown={openBillsCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openBills.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty-cell">
                        No open bills in this date range.
                      </td>
                    </tr>
                  ) : (
                    openBills.map((b) => {
                    const st = billState[b.id] ?? {
                      checked: false,
                      amount: '',
                    }
                    const tone = dueTone(b.dueDate)
                    const err = totals.errors[b.id]
                    const nextPayNo = paymentNumberForBill(
                      b.billNo,
                      b.priorPaymentCount,
                    )
                    return (
                      <tr key={b.id}>
                        <td>
                          <input
                            type="checkbox"
                            disabled={b.openBalance <= 0}
                            checked={st.checked}
                            onChange={(e) =>
                              setRow(b.id, { checked: e.target.checked })
                            }
                            aria-label={`Select bill ${b.billNo}`}
                          />
                        </td>
                        <td className="mono">{b.billNo}</td>
                        <td>{b.billDate}</td>
                        <td>
                          <span
                            className={
                              'due-pill' +
                              (tone === 'overdue'
                                ? ' due-pill--overdue'
                                : tone === 'thisWeek'
                                  ? ' due-pill--week'
                                  : '')
                            }
                          >
                            {b.dueDate}
                          </span>
                        </td>
                        <td>{b.description}</td>
                        <td className="num">{money(b.original)}</td>
                        <td className="num">{money(b.amountPaid)}</td>
                        <td className="num">{money(b.openBalance)}</td>
                        <td className="num">{money(b.credits)}</td>
                        <td className="num">
                          <div className="bill-pay__amt-cell">
                            <input
                              className={
                                'bill-pay__pay-input' +
                                (err ? ' has-error' : '')
                              }
                              disabled={!st.checked || b.openBalance <= 0}
                              inputMode="decimal"
                              value={st.amount}
                              onChange={(e) =>
                                setRow(b.id, { amount: e.target.value })
                              }
                              aria-invalid={!!err}
                            />
                            {err && (
                              <span className="bill-pay__row-err">{err}</span>
                            )}
                          </div>
                        </td>
                        <td className="mono small">{nextPayNo}</td>
                      </tr>
                    )
                  })
                  )}
                </tbody>
              </table>
            </div>
            <div className="bill-pay__save-row">
              <button
                type="button"
                className="btn primary"
                disabled={saveDisabled}
                onClick={savePayment}
              >
                Save payment · ${money(totals.payTotal)}
              </button>
            </div>
          </section>

          <section className="bill-pay__table-block" aria-label="Payment history">
            <h3 className="bill-pay__section-title">Payment history</h3>
            <DateFilterBar
              value={historyDateRange}
              onApply={setHistoryDateRange}
              recordCount={filteredPaymentHistory.length}
            />
            <div className="bill-pay__table-toolbar">
              <button
                type="button"
                className="btn sm"
                disabled={!selected}
                onClick={() =>
                  exportDomTableToXlsx(
                    historyCol.tableRef.current,
                    selected ? `PaymentHistory-${selected.name.replace(/\s+/g, '_')}` : 'PaymentHistory',
                  )
                }
              >
                Export to Excel
              </button>
            </div>
            <div className="bill-pay__scroll">
              <table
                ref={historyCol.tableRef}
                className="bill-pay__table bill-pay__table--history fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {historyCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(
                      [
                        ['PAYMENT #', ''],
                        ['DATE', ''],
                        ['BILL # PAID', ''],
                        ['BILL DATE', ''],
                        ['BILL AMOUNT', 'num'],
                        ['PAYMENT AMOUNT', 'num'],
                        ['REMAINING', 'num'],
                        ['METHOD', ''],
                        ['ACCOUNT', ''],
                        ['CHECK #', ''],
                        ['MEMO', ''],
                        ['QBO STATUS', ''],
                      ] as const
                    ).map(([label, cls], i) => (
                      <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                        {label}
                        {i < historyCol.widths.length - 1 ? (
                          <span
                            className="fr-col-resize"
                            role="presentation"
                            onMouseDown={historyCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="empty-cell">
                        No payments yet for this vendor.
                      </td>
                    </tr>
                  ) : filteredPaymentHistory.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="empty-cell">
                        No payments in this date range.
                      </td>
                    </tr>
                  ) : (
                    filteredPaymentHistory.map((h, i) => {
                      const multi =
                        (batchSizes.get(h.batchId) ?? 0) > 1
                      return (
                      <tr
                        key={`${h.batchId}-${i}`}
                        className={
                          'bill-pay__hist-row' +
                          (multi ? ' bill-pay__hist-row--batch' : '')
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="bill-pay__paylink"
                            onClick={() => setDetailBatchId(h.batchId)}
                          >
                            {h.paymentNo}
                          </button>
                        </td>
                        <td>{h.date}</td>
                        <td className="mono">{h.billNoPaid}</td>
                        <td>{h.billDate}</td>
                        <td className="num">{money(h.billAmount)}</td>
                        <td className="num">{money(h.paymentAmount)}</td>
                        <td className="num">{money(h.remaining)}</td>
                        <td>{h.method}</td>
                        <td>{h.account}</td>
                        <td>{h.checkNo}</td>
                        <td>{h.memo}</td>
                        <td>{h.qboStatus}</td>
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!selected && !suppressHelpText && (
        <p className="muted bill-pay__hint">
          Select a vendor to load balances, open bills, and payment history.
        </p>
      )}

      {detailBatchId && selected && (
        <div
          className={
            'bill-pay__drawer-backdrop' +
            (payDrawerFs ? ' app-modal-backdrop--fullscreen' : '')
          }
          role="presentation"
          onClick={() => setDetailBatchId(null)}
        >
          <aside
            className={
              'bill-pay__drawer' +
              (payDrawerFs ? ' app-modal-panel--fullscreen' : '')
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bill-pay__drawer-head">
              <div>
                <h2 id="pay-drawer-title">Payment detail</h2>
                <p className="muted small mono">{detailBatchId}</p>
              </div>
              <div className="modal-generic-head__actions">
                <ModalFullscreenToggle
                  isFullScreen={payDrawerFs}
                  onToggle={() => setPayDrawerFs((v) => !v)}
                  className="btn sm ghost"
                />
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setDetailBatchId(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </header>
            {!suppressHelpText && (
              <p className="muted small">
                Payment series (same <code>batch_id</code>)
              </p>
            )}
            <div className="bill-pay__table-toolbar">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  exportDomTableToXlsx(
                    detailPayCol.tableRef.current,
                    `PaymentDetail-${detailBatchId ?? 'batch'}`,
                  )
                }
              >
                Export to Excel
              </button>
            </div>
            <div className="bill-pay__scroll">
              <table
                ref={detailPayCol.tableRef}
                className="bill-pay__table fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {detailPayCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(
                      [
                        ['PAYMENT #', ''],
                        ['BILL #', ''],
                        ['AMOUNT', 'num'],
                        ['METHOD', ''],
                        ['CHECK #', ''],
                      ] as const
                    ).map(([label, cls], i) => (
                      <th key={label} className={`fr-th-resizable ${cls}`.trim()}>
                        {label}
                        {i < detailPayCol.widths.length - 1 ? (
                          <span
                            className="fr-col-resize"
                            role="presentation"
                            onMouseDown={detailPayCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detailLines.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.paymentNo}</td>
                      <td className="mono">{r.billNoPaid}</td>
                      <td className="num">{money(r.paymentAmount)}</td>
                      <td>{r.method}</td>
                      <td>{r.checkNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="bill-pay__drawer-foot">
              <button type="button" className="btn primary" onClick={printReceipt}>
                Print receipt
              </button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  )
}
