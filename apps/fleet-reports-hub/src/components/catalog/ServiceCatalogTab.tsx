import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ServiceRecordType, ServiceTypeRow } from '../../types/serviceCatalog'
import { fetchServiceTypes, saveServiceType } from '../../lib/serviceCatalogApi'
import { ServiceTypeEditorModal } from './ServiceTypeEditorModal'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { ResizeTableTh } from '../table/ResizeTableTh'

type Props = {
  recordType: ServiceRecordType
}

function formatInterval(s: ServiceTypeRow) {
  if (s.interval_miles == null) return '—'
  const mo = s.interval_months != null ? s.interval_months : '—'
  return `${s.interval_miles.toLocaleString()} mi · ${mo} mo`
}

function formatCost(s: ServiceTypeRow) {
  if (s.avg_cost_low == null && s.avg_cost_high == null) return '—'
  const a = s.avg_cost_low ?? 0
  const b = s.avg_cost_high ?? 0
  return `$${Math.round(a).toLocaleString()} – $${Math.round(b).toLocaleString()}`
}

function makesShort(s: ServiceTypeRow) {
  const m = s.applies_to_makes || []
  if (m.includes('all')) return 'All makes'
  return m.slice(0, 3).join(', ') + (m.length > 3 ? '…' : '')
}

export function ServiceCatalogTab({ recordType }: Props) {
  const gridCol = useColumnResize([200, 100, 80, 120, 100, 120, 72, 80])
  const [rows, setRows] = useState<ServiceTypeRow[]>([])
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editRow, setEditRow] = useState<ServiceTypeRow | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const list = await fetchServiceTypes({ recordType, q, category })
      setRows(list)
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [recordType, q, category])

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => {
    const u = new Set<string>()
    for (const r of rows) u.add(r.service_category)
    return [...u].sort()
  }, [rows])

  const onSave = async (svc: Partial<ServiceTypeRow> & { service_key: string; service_name: string }) => {
    await saveServiceType(svc)
    await load()
  }

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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, key, category…" />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setEditRow(null)
            setModalOpen(true)
          }}
        >
          Add service
        </button>
      </div>

      <div className="svc-cat__tablewrap">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              exportDomTableToXlsx(
                gridCol.tableRef.current,
                `ServiceCatalog-${recordType}`,
              )
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
                Name
              </ResizeTableTh>
              <ResizeTableTh colIndex={1} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Category
              </ResizeTableTh>
              <ResizeTableTh colIndex={2} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Record
              </ResizeTableTh>
              <ResizeTableTh colIndex={3} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Interval
              </ResizeTableTh>
              <ResizeTableTh colIndex={4} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Cost
              </ResizeTableTh>
              <ResizeTableTh colIndex={5} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Makes
              </ResizeTableTh>
              <ResizeTableTh colIndex={6} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                Map
              </ResizeTableTh>
              <ResizeTableTh colIndex={7} widths={gridCol.widths} onResizeMouseDown={gridCol.onResizeMouseDown}>
                {' '}
              </ResizeTableTh>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  No service types in this view (adjust filters or start the catalog API).
                </td>
              </tr>
            ) : (
              rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.service_name}</strong>
                  <div className="muted tiny mono">{r.service_key}</div>
                </td>
                <td>
                  <span className="pill pill--cat">{r.service_category}</span>
                </td>
                <td>
                  <span className={`pill pill--rt pill--rt-${r.record_type}`}>{r.record_type}</span>
                </td>
                <td className="tiny">{formatInterval(r)}</td>
                <td className="tiny">{formatCost(r)}</td>
                <td className="tiny">{makesShort(r)}</td>
                <td className="tiny">{r.uses_position_map ? r.position_map_type || 'yes' : '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setEditRow(r)
                      setModalOpen(true)
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
        <p className="muted tiny" style={{ marginTop: 6 }}>
          Drag column edges to resize
        </p>
      </div>

      <ServiceTypeEditorModal
        open={modalOpen}
        initial={editRow}
        recordTypeDefault={recordType}
        onClose={() => setModalOpen(false)}
        onSave={(row) => void onSave(row)}
      />
    </div>
  )
}
