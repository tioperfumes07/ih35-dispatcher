import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PartRefApiRow } from '../../types/serviceCatalog'
import { fetchPartsCatalog } from '../../lib/serviceCatalogApi'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { ResizeTableTh } from '../table/ResizeTableTh'

export function PartsReferenceCatalogTab() {
  const gridCol = useColumnResize([200, 120, 72, 72, 72, 160])
  const [rows, setRows] = useState<PartRefApiRow[]>([])
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setRows(await fetchPartsCatalog(q || undefined, category || undefined))
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [q, category])

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => {
    const u = new Set<string>()
    for (const r of rows) u.add(r.category)
    return [...u].sort()
  }, [rows])

  return (
    <div className="svc-cat">
      {err && (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      )}
      <div className="svc-cat__toolbar">
        <label className="field">
          <span>Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part or category…" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="svc-cat__tablewrap">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              exportDomTableToXlsx(gridCol.tableRef.current, 'PartsReferenceCatalog')
            }
          >
            Export to Excel
          </button>
        </div>
        <table
          ref={gridCol.tableRef}
          className="data-table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <thead>
            <tr>
              <ResizeTableTh colIndex={0} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Part
              </ResizeTableTh>
              <ResizeTableTh colIndex={1} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Category
              </ResizeTableTh>
              <ResizeTableTh colIndex={2} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Low
              </ResizeTableTh>
              <ResizeTableTh colIndex={3} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Mid
              </ResizeTableTh>
              <ResizeTableTh colIndex={4} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                High
              </ResizeTableTh>
              <ResizeTableTh colIndex={5} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Notes
              </ResizeTableTh>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No parts in this view (adjust search or start the catalog API).
                </td>
              </tr>
            ) : (
              rows.map((r) => (
              <tr key={`${r.category}-${r.part_name}`}>
                <td>
                  <strong>{r.part_name}</strong>
                </td>
                <td>
                  <span className="pill pill--cat">{r.category}</span>
                </td>
                <td className="mono tiny">${r.cost_low}</td>
                <td className="mono tiny">${r.cost_mid}</td>
                <td className="mono tiny">${r.cost_high}</td>
                <td className="muted tiny">{r.notes ?? '—'}</td>
              </tr>
            ))
            )}
          </tbody>
        </table>
        <p className="muted tiny" style={{ marginTop: 6 }}>
          Drag column edges to resize
        </p>
      </div>
    </div>
  )
}
