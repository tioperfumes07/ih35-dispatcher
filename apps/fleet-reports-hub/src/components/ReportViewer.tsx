import { useMemo, useState } from 'react'
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
  const dataCol = useColumnResize([96, 72, 120, 140, 88, 120, 120, 88, 100])
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'date' | 'amount'>('date')
  const [sched, setSched] = useState(false)
  const [schedFreq, setSchedFreq] = useState<'daily' | 'weekly'>('weekly')

  const custom = report.viewer
  const isEmbed = Boolean(report.embedToolUrl)

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

  const empty = !custom && !isEmbed && total === 0

  useTableTabOrder(dataCol.tableRef, [sorted, empty])

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
