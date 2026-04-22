import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalFullscreenToggle } from './ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../hooks/useFullScreen'
import { useColumnResize } from '../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../lib/tableExportXlsx'
import type { BillFrequency } from '../lib/recurringBillDates'
import {
  formatISODate,
  isPastBill,
  seriesDates,
} from '../lib/recurringBillDates'
import { generateBillNumbers, previewBillFormats } from '../lib/billNumberSeries'

export type AmountMode = 'same' | 'total_split' | 'different'

type Phase = 'edit' | 'confirm' | 'progress' | 'success'

type Props = {
  open: boolean
  onClose: () => void
}

type RowModel = {
  idx: number
  billNo: string
  date: Date
  amount: number
}

function splitTotal(total: number, parts: number): number[] {
  if (parts <= 0) return []
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / parts)
  const rem = cents - base * parts
  const out: number[] = []
  for (let i = 0; i < parts; i++) {
    const c = base + (i === parts - 1 ? rem : 0)
    out.push(c / 100)
  }
  return out
}

export function RecurringBillsModal({ open, onClose }: Props) {
  const { isFullScreen, toggle } = useFullScreen()
  const [phase, setPhase] = useState<Phase>('edit')
  const [progress, setProgress] = useState(0)
  const [seriesId, setSeriesId] = useState<string | null>(null)

  const [vendor, setVendor] = useState('')
  const [frequency, setFrequency] = useState<BillFrequency>('monthly')
  const [firstBillDate, setFirstBillDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [numBills, setNumBills] = useState(9)
  const [billFormat, setBillFormat] = useState('BILL-001')
  const [terms, setTerms] = useState('Net 30')
  const [amountMode, setAmountMode] = useState<AmountMode>('same')
  const [sameAmount, setSameAmount] = useState('150')
  const [totalAmount, setTotalAmount] = useState('1350')
  const [customEveryDays, setCustomEveryDays] = useState(14)
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set())
  const [overrides, setOverrides] = useState<Record<number, string>>({})

  const resetForm = useCallback(() => {
    setVendor('')
    setFrequency('monthly')
    setFirstBillDate(new Date().toISOString().slice(0, 10))
    setNumBills(9)
    setBillFormat('BILL-001')
    setTerms('Net 30')
    setAmountMode('same')
    setSameAmount('150')
    setTotalAmount('1350')
    setCustomEveryDays(14)
    setExcluded(new Set())
    setOverrides({})
    setPhase('edit')
    setProgress(0)
    setSeriesId(null)
  }, [])

  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open, resetForm])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase === 'progress') return
      if (phase === 'confirm') {
        setPhase('edit')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, phase])

  const previewFormats = useMemo(() => previewBillFormats(billFormat), [billFormat])

  const baseRows = useMemo(() => {
    const n = Math.max(1, Math.min(60, Math.floor(numBills)))
    const nums = generateBillNumbers(billFormat.trim() || 'BILL-001', n)
    const dates = seriesDates(
      firstBillDate,
      frequency,
      n,
      customEveryDays,
    )
    return nums.map((billNo, idx) => ({
      idx,
      billNo,
      date: dates[idx] ?? dates[dates.length - 1]!,
    }))
  }, [billFormat, firstBillDate, frequency, numBills, customEveryDays])

  const visibleRows: RowModel[] = useMemo(() => {
    const rows = baseRows.filter((r) => !excluded.has(r.idx))
    const count = rows.length
    const same = parseFloat(sameAmount) || 0
    const total = parseFloat(totalAmount) || 0
    const splitsTotal =
      amountMode === 'total_split' && count > 0 ? splitTotal(total, count) : null
    const splitsTemplate =
      amountMode === 'different' && count > 0 ? splitTotal(total, count) : null

    return rows.map((r, i) => {
      let amount = same
      if (amountMode === 'total_split' && splitsTotal)
        amount = splitsTotal[i] ?? 0
      if (amountMode === 'different') {
        const o = overrides[r.idx]
        if (o !== undefined && o !== '') {
          const p = parseFloat(o)
          if (Number.isFinite(p)) amount = p
        } else if (splitsTemplate) {
          amount = splitsTemplate[i] ?? same
        }
      }
      return { idx: r.idx, billNo: r.billNo, date: r.date, amount }
    })
  }, [baseRows, excluded, amountMode, sameAmount, totalAmount, overrides])

  const splitHint = useMemo(() => {
    const n = Math.max(
      1,
      baseRows.filter((r) => !excluded.has(r.idx)).length,
    )
    const t = parseFloat(totalAmount) || 0
    if (amountMode !== 'total_split' || n === 0) return null
    const each = splitTotal(t, n)
    const line = each[0] ?? 0
    const last = each[each.length - 1] ?? 0
    return `$${t.toFixed(2)} ÷ ${n} → ${n > 1 ? `$${line.toFixed(2)} each, remainder on last → $${last.toFixed(2)}` : `$${last.toFixed(2)}`}`
  }, [amountMode, totalAmount, baseRows, excluded])

  const previewCol = useColumnResize([120, 140, 96, 56])

  const startCreate = () => {
    if (visibleRows.length === 0) return
    setPhase('confirm')
  }

  const runProgress = () => {
    setPhase('progress')
    setProgress(0)
    const id = crypto.randomUUID()
    const t0 = performance.now()
    const dur = 1200
    const tick = () => {
      const t = performance.now() - t0
      const p = Math.min(100, Math.round((t / dur) * 100))
      setProgress(p)
      if (t < dur) requestAnimationFrame(tick)
      else {
        setSeriesId(id)
        setPhase('success')
      }
    }
    requestAnimationFrame(tick)
  }

  if (!open) return null

  return (
    <div className="recurring-modal" role="presentation">
      <div
        className="recurring-modal__dialog"
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-title"
      >
        <header className="recurring-modal__top">
          <div>
            <p id="recurring-title" className="recurring-modal__title">
              New recurring bills
            </p>
            <p className="muted small">
              Simple cost lines · category only · no position, parts map, or
              part#
            </p>
          </div>
          <div className="recurring-modal__top-actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              disabled={phase === 'progress'}
            />
            <button
              type="button"
              className="modal-fs-toggle"
              onClick={onClose}
              disabled={phase === 'progress'}
              aria-label="Close"
            >
              <span className="modal-fs-toggle__icon" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </header>

        {phase === 'progress' && (
          <div className="recurring-modal__progress-block">
            <p className="muted">Saving bills…</p>
            <div
              className="progress-bar"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="progress-bar__fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mono small">{progress}%</p>
          </div>
        )}

        {phase === 'success' && seriesId && (
          <div className="recurring-modal__success">
            <p className="success-title">Series created</p>
            <p className="muted small">
              Bills linked by <code>recurring_series_id</code>
            </p>
            <code className="series-id">{seriesId}</code>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                resetForm()
                onClose()
              }}
            >
              Done
            </button>
          </div>
        )}

        {(phase === 'edit' || phase === 'confirm') && (
          <div className="recurring-modal__body">
            <div
              className={
                'recurring-modal__panels' +
                (phase === 'confirm' ? ' recurring-modal__panels--blocked' : '')
              }
            >
            <section className="recurring-panel recurring-panel--config">
              <h3>Configuration</h3>

              <label className="field">
                <span>Vendor</span>
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Vendor name"
                />
              </label>

              <label className="field">
                <span>Frequency</span>
                <select
                  value={frequency}
                  onChange={(e) =>
                    setFrequency(e.target.value as BillFrequency)
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              {frequency === 'custom' && (
                <label className="field">
                  <span>Every (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={customEveryDays}
                    onChange={(e) =>
                      setCustomEveryDays(parseInt(e.target.value, 10) || 30)
                    }
                  />
                </label>
              )}

              <label className="field">
                <span>First bill date</span>
                <input
                  type="date"
                  value={firstBillDate}
                  onChange={(e) => setFirstBillDate(e.target.value)}
                />
              </label>

              <label className="field">
                <span>Number of bills</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={numBills}
                  onChange={(e) => {
                    setNumBills(parseInt(e.target.value, 10) || 1)
                    setExcluded(new Set())
                  }}
                />
              </label>

              <label className="field">
                <span>Bill number format</span>
                <input
                  value={billFormat}
                  onChange={(e) => setBillFormat(e.target.value)}
                  placeholder="W7, INS-JAN, LEASE-01, TAX-Q1, BILL-001…"
                />
              </label>

              <div className="format-preview">
                <span className="muted tiny">Format preview (3 examples)</span>
                <ul>
                  {previewFormats.map((p) => (
                    <li key={p} className="mono">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="pattern-hint">
                Auto-detects: <strong>W7→W8</strong>,{' '}
                <strong>INS-JAN→INS-FEB</strong>, <strong>DEC→JAN</strong>,{' '}
                <strong>LEASE-01→02</strong>, <strong>TAX-Q1→Q4→Q1</strong>,{' '}
                <strong>BILL-001→002</strong>.
              </p>

              <label className="field">
                <span>Terms</span>
                <select value={terms} onChange={(e) => setTerms(e.target.value)}>
                  <option>Due on receipt</option>
                  <option>Net 15</option>
                  <option>Net 30</option>
                  <option>Net 45</option>
                </select>
              </label>

              <fieldset className="amount-modes">
                <legend>Amount mode</legend>
                <label className="radio">
                  <input
                    type="radio"
                    name="amode"
                    checked={amountMode === 'same'}
                    onChange={() => setAmountMode('same')}
                  />
                  Same each — every bill uses the amount below
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    name="amode"
                    checked={amountMode === 'total_split'}
                    onChange={() => setAmountMode('total_split')}
                  />
                  Total split — divide total across bills; remainder on last
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    name="amode"
                    checked={amountMode === 'different'}
                    onChange={() => setAmountMode('different')}
                  />
                  Different — edit each amount in the preview
                </label>
              </fieldset>

              {amountMode === 'same' && (
                <label className="field">
                  <span>Amount ($)</span>
                  <input
                    inputMode="decimal"
                    value={sameAmount}
                    onChange={(e) => setSameAmount(e.target.value)}
                  />
                </label>
              )}

              {amountMode === 'total_split' && (
                <label className="field">
                  <span>Total ($)</span>
                  <input
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                  />
                </label>
              )}

              {amountMode === 'total_split' && splitHint && (
                <p className="split-hint mono small">{splitHint}</p>
              )}

              {amountMode === 'different' && (
                <label className="field">
                  <span>Starting template total ($)</span>
                  <input
                    inputMode="decimal"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                  />
                  <span className="muted tiny">
                    Used to pre-fill rows until you edit them.
                  </span>
                </label>
              )}
            </section>

            <section className="recurring-panel recurring-panel--preview">
              <div className="preview-head">
                <h3>Live preview</h3>
                <div className="preview-head__actions">
                  <span className="muted small">{visibleRows.length} bills</span>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() =>
                      exportDomTableToXlsx(
                        previewCol.tableRef.current,
                        'RecurringBillsPreview',
                      )
                    }
                  >
                    Export to Excel
                  </button>
                </div>
              </div>

              <div className="preview-table-wrap">
                <table
                  ref={previewCol.tableRef}
                  className="preview-table fr-data-table"
                  style={{ tableLayout: 'fixed', width: '100%' }}
                >
                  <colgroup>
                    {previewCol.widths.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        className="fr-th-resizable"
                        style={{ width: previewCol.widths[0] }}
                      >
                        Bill #
                        <span
                          className="fr-col-resize"
                          role="presentation"
                          onMouseDown={previewCol.onResizeMouseDown(0)}
                        />
                      </th>
                      <th
                        className="fr-th-resizable"
                        style={{ width: previewCol.widths[1] }}
                      >
                        Date
                        <span
                          className="fr-col-resize"
                          role="presentation"
                          onMouseDown={previewCol.onResizeMouseDown(1)}
                        />
                      </th>
                      <th
                        className="fr-th-resizable num"
                        style={{ width: previewCol.widths[2] }}
                      >
                        Amount
                        <span
                          className="fr-col-resize"
                          role="presentation"
                          onMouseDown={previewCol.onResizeMouseDown(2)}
                        />
                      </th>
                      <th style={{ width: previewCol.widths[3] }} aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, ri) => (
                      <tr key={r.idx}>
                        <td className="mono">{r.billNo}</td>
                        <td>
                          <span className="date-cell">
                            {formatISODate(r.date)}
                            {isPastBill(r.date) && (
                              <span className="badge badge--past">Past</span>
                            )}
                          </span>
                        </td>
                        <td className="num">
                          {amountMode === 'different' ? (
                            <input
                              className="cell-input"
                              inputMode="decimal"
                              tabIndex={520 + ri}
                              value={
                                overrides[r.idx] ?? r.amount.toFixed(2)
                              }
                              onChange={(e) =>
                                setOverrides((o) => ({
                                  ...o,
                                  [r.idx]: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            r.amount.toFixed(2)
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-icon"
                            tabIndex={620 + ri}
                            title="Remove this bill"
                            aria-label={`Remove bill ${r.billNo}`}
                            onClick={() =>
                              setExcluded((prev) => {
                                const n = new Set(prev)
                                n.add(r.idx)
                                return n
                              })
                            }
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleRows.length === 0 && (
                  <p className="empty tiny">All bills removed — increase count or reset.</p>
                )}
              </div>
              <p className="muted tiny preview-table-hint">
                Drag column edges to resize · Tab to navigate
              </p>

              <footer className="preview-footer">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setExcluded(new Set())
                    setOverrides({})
                  }}
                >
                  Reset removals
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={visibleRows.length === 0}
                  onClick={startCreate}
                >
                  Create bills…
                </button>
              </footer>
            </section>
          </div>

            {phase === 'confirm' && (
              <div className="recurring-modal__overlay-confirm" role="presentation">
                <div
                  className="recurring-modal__confirm-card"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="confirm-recurring"
                >
                  <p id="confirm-recurring">
                    Create <strong>{visibleRows.length}</strong> bills for{' '}
                    <strong>{vendor || '—'}</strong>, linked by a new{' '}
                    <code>recurring_series_id</code>?
                  </p>
                  <div className="recurring-modal__confirm-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setPhase('edit')}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={runProgress}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
