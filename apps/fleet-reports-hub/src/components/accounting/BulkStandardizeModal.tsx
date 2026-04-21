import { useEffect, useMemo, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { ResizeTableTh } from '../table/ResizeTableTh'
import type { NameEntityRow } from '../../lib/nameManagementApi'
import { fetchNameEntities, postBulkRename } from '../../lib/nameManagementApi'

type Row = NameEntityRow & { canonical: string; selected: boolean }

type Props = {
  open: boolean
  onClose: () => void
  onApplied: () => void
}

export function BulkStandardizeModal({ open, onClose, onApplied }: Props) {
  const bulkCol = useColumnResize([48, 88, 160, 220])
  const { isFullScreen, toggle } = useFullScreen()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const [updQbo, setUpdQbo] = useState(true)
  const [updSam, setUpdSam] = useState(true)
  const [updErp, setUpdErp] = useState(true)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      setSummary(null)
      try {
        const list = await fetchNameEntities('', 'mismatch')
        if (cancelled) return
        setRows(
          list.map((r) => ({
            ...r,
            canonical: r.label,
            selected: true,
          })),
        )
      } catch (e) {
        if (!cancelled) setErr(String((e as Error).message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const selected = useMemo(() => rows.filter((r) => r.selected), [rows])

  const apply = async () => {
    setBusy(true)
    setErr(null)
    setSummary(null)
    try {
      const items = selected.map((r) => ({
        entityId: r.id,
        canonical: r.canonical.trim() || r.label,
        updateQbo: updQbo,
        updateSamsara: updSam,
        updateErp: updErp,
      }))
      const out = await postBulkRename(items)
      setSummary(out.summary ?? 'done')
      onApplied()
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="modal nm-bulk-modal"
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nm-bulk-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-generic-head">
          <h3 id="nm-bulk-title">Bulk standardize names</h3>
          <div className="modal-generic-head__actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              disabled={busy}
            />
            <button
              type="button"
              className="modal-fs-toggle"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <span className="modal-fs-toggle__icon" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </header>
        <p className="muted small">
          All rows with a name mismatch. Edit canonical names, choose systems to update, then apply
          to selected rows. Each rename is logged to <code>rename_log</code>.
        </p>

        <div className="nm-bulk-flags">
          <label>
            <input type="checkbox" checked={updQbo} onChange={(e) => setUpdQbo(e.target.checked)} />
            Update QBO
          </label>
          <label>
            <input type="checkbox" checked={updSam} onChange={(e) => setUpdSam(e.target.checked)} />
            Update Samsara
          </label>
          <label>
            <input type="checkbox" checked={updErp} onChange={(e) => setUpdErp(e.target.checked)} />
            Update ERP
          </label>
        </div>

        {err && (
          <p className="nm-bulk-err" role="alert">
            {err}
          </p>
        )}
        {summary && <p className="nm-bulk-summary">Batch result: {summary}</p>}

        <div className="nm-bulk-tablewrap">
          {loading ? (
            <p className="muted pad">Loading…</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    exportDomTableToXlsx(bulkCol.tableRef.current, 'BulkStandardizeNames')
                  }
                >
                  Export to Excel
                </button>
              </div>
              <table
                ref={bulkCol.tableRef}
                className="data-table fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <thead>
                  <tr>
                    <ResizeTableTh colIndex={0} widths={bulkCol.widths} onResizeMouseDown={bulkCol.onResizeMouseDown}>
                      {' '}
                    </ResizeTableTh>
                    <ResizeTableTh colIndex={1} widths={bulkCol.widths} onResizeMouseDown={bulkCol.onResizeMouseDown}>
                      Kind
                    </ResizeTableTh>
                    <ResizeTableTh colIndex={2} widths={bulkCol.widths} onResizeMouseDown={bulkCol.onResizeMouseDown}>
                      Systems
                    </ResizeTableTh>
                    <ResizeTableTh colIndex={3} widths={bulkCol.widths} onResizeMouseDown={bulkCol.onResizeMouseDown}>
                      Suggested / canonical
                    </ResizeTableTh>
                  </tr>
                </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, selected: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>{r.kind}</td>
                    <td className="tiny">{r.sources.join(' · ')}</td>
                    <td>
                      <input
                        className="nm-bulk-input"
                        value={r.canonical}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, canonical: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              <p className="muted tiny" style={{ marginTop: 6 }}>
                Drag column edges to resize
              </p>
            </>
          )}
        </div>

        <div className="nm-bulk-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || selected.length === 0}
            onClick={() => void apply()}
          >
            {busy ? 'Applying…' : `Apply to ${selected.length} selected`}
          </button>
        </div>
      </div>
    </div>
  )
}
