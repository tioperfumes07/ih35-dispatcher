import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportJsonRowsToXlsx } from '../../lib/tableExportXlsx'
import { fetchPartsCatalog } from '../../lib/serviceCatalogApi'
import type { PartRefApiRow } from '../../types/serviceCatalog'
import { PARTS_CATALOG_SEED } from '../../data/partsCatalogSeed'

type DisplayRow = PartRefApiRow & {
  id: string
  partNo: string
  stock: number
  status: 'in' | 'low' | 'out'
}

function deriveStatus(r: PartRefApiRow): DisplayRow['status'] {
  const span = r.cost_high - r.cost_mid
  if (r.cost_mid < 120) return 'out'
  if (span > 400) return 'low'
  return 'in'
}

function partKey(r: PartRefApiRow) {
  return `${r.category}||${r.part_name}`.toLowerCase()
}

function toDisplay(r: PartRefApiRow, i: number): DisplayRow {
  return {
    ...r,
    id: `${r.category}::${r.part_name}::${i}`,
    partNo: `${r.category.slice(0, 3).toUpperCase()}-${1000 + i}`,
    stock: Math.max(0, Math.floor(140 - r.cost_mid / 45)),
    status: deriveStatus(r),
  }
}

/** Prefer API rows; fill gaps from embedded seed so the panel always has catalog data. */
function mergePartsCatalog(api: PartRefApiRow[], seed: PartRefApiRow[]): DisplayRow[] {
  const m = new Map<string, DisplayRow>()
  let n = 0
  for (const r of api) {
    const k = partKey(r)
    if (!m.has(k)) m.set(k, toDisplay(r, n++))
  }
  for (const r of seed) {
    const k = partKey(r)
    if (!m.has(k)) m.set(k, toDisplay(r, n++))
  }
  return [...m.values()]
}

function statusLabel(s: DisplayRow['status']) {
  if (s === 'in') return 'In stock'
  if (s === 'low') return 'Low stock'
  return 'Out of stock'
}

export function PartsCatalogPanel() {
  const { isFullScreen, toggle } = useFullScreen()
  const col = useColumnResize([160, 88, 100, 64, 80, 88, 72])
  const newNameRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<DisplayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [usedFallback, setUsedFallback] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [status, setStatus] = useState<'all' | 'in' | 'low' | 'out'>('all')
  const [draftName, setDraftName] = useState('')
  const [draftNo, setDraftNo] = useState('')
  const [draftCat, setDraftCat] = useState('general')
  const [draftQty, setDraftQty] = useState('1')
  const [draftCost, setDraftCost] = useState('')

  /** Merge API parts with embedded seed so rows always appear when the API is empty or partial. */
  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setUsedFallback(false)
    const seed = PARTS_CATALOG_SEED
    try {
      const list = await fetchPartsCatalog()
      setRows(mergePartsCatalog(list, seed))
      if (!list.length) setUsedFallback(true)
    } catch (e) {
      setErr(String((e as Error).message || e))
      setRows(seed.map((r, i) => toDisplay(r, i)))
      setUsedFallback(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => {
    const u = new Set<string>()
    for (const r of rows) u.add(r.category)
    return [...u].sort()
  }, [rows])

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      const n = q.trim().toLowerCase()
      if (
        n &&
        !r.part_name.toLowerCase().includes(n) &&
        !r.category.toLowerCase().includes(n) &&
        !r.partNo.toLowerCase().includes(n)
      ) {
        return false
      }
      if (cat && r.category !== cat) return false
      return true
    })
  }, [rows, q, cat, status])

  const exportCsv = () => {
    const h = ['part_name', 'part_no', 'category', 'stock', 'unit_cost', 'status']
    const lines = [
      h.join(','),
      ...visible.map((r) =>
        [
          JSON.stringify(r.part_name),
          r.partNo,
          r.category,
          r.stock,
          r.cost_mid,
          r.status,
        ].join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `PartsCatalog-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportXlsx = () => {
    const rows =
      visible.length > 0
        ? visible.map((r) => ({
            partName: r.part_name,
            partNo: r.partNo,
            category: r.category,
            stock: r.stock,
            unitCost: r.cost_mid,
            status: statusLabel(r.status),
          }))
        : [
            {
              partName: '',
              partNo: '',
              category: '',
              stock: '',
              unitCost: '',
              status: '',
            },
          ]
    exportJsonRowsToXlsx(rows, 'PartsCatalog')
  }

  const addRow = () => {
    const name = draftName.trim()
    if (!name) return
    const cost = parseFloat(draftCost) || 0
    const base: PartRefApiRow = {
      category: draftCat.trim() || 'custom',
      part_name: name,
      cost_low: cost * 0.9,
      cost_mid: cost,
      cost_high: cost * 1.1,
      notes: draftNo ? `PN ${draftNo}` : '',
    }
    setRows((prev) => [...prev, toDisplay(base, prev.length)])
    setDraftName('')
    setDraftNo('')
    setDraftQty('1')
    setDraftCost('')
  }

  const rootStyle = isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined

  return (
    <section className="fr-parts" style={rootStyle}>
      <header className="fr-parts__head">
        <h2 className="fr-parts__title">Parts catalog</h2>
        <div className="fr-parts__head-actions">
          <button type="button" className="btn sm fr-parts__tb-btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="btn sm fr-parts__tb-btn" onClick={exportXlsx}>
            Export to Excel
          </button>
          <button
            type="button"
            className="btn sm primary fr-parts__tb-btn"
            onClick={() => {
              newNameRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              window.setTimeout(() => newNameRef.current?.focus(), 200)
            }}
          >
            + Add part
          </button>
          <ModalFullscreenToggle
            isFullScreen={isFullScreen}
            onToggle={toggle}
            className="fr-parts__fs"
          />
        </div>
      </header>

      <div className="fr-parts__toolbar">
        <input
          className="fr-parts__search"
          placeholder="Search part name, number, category..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="fr-parts__sel" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="fr-parts__sel"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">All status</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
      </div>

      {err && (
        <p className="fr-parts__err" role="alert">
          {err}
        </p>
      )}
      {usedFallback && !loading && (
        <p className="muted fr-parts__loading" role="status">
          Showing embedded parts reference — API catalog {err ? 'unavailable' : 'returned no rows'}.
        </p>
      )}
      {loading && <p className="muted fr-parts__loading">Loading catalog…</p>}

      <div className="fr-parts__tablewrap">
        <table
          ref={col.tableRef}
          className="fr-parts__table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {col.widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(
                [
                  'Part name',
                  'Part #',
                  'Category',
                  'Stock',
                  'Unit cost',
                  'Status',
                  '',
                ] as const
              ).map((h, i) => (
                <th key={h || 'act'} className="fr-parts__th fr-th-resizable" style={{ width: col.widths[i] }}>
                  {h}
                  {i < 6 ? (
                    <span
                      className="fr-col-resize"
                      role="presentation"
                      onMouseDown={col.onResizeMouseDown(i)}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="fr-parts__tr">
                <td>{r.part_name}</td>
                <td className="mono tiny">{r.partNo}</td>
                <td>
                  <span className="pill pill--cat">{r.category}</span>
                </td>
                <td className="num">{r.stock}</td>
                <td className="num mono">${r.cost_mid.toFixed(0)}</td>
                <td>
                  <span className={'fr-parts__badge fr-parts__badge--' + r.status}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td>
                  <button type="button" className="btn sm">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="fr-parts__newrow">
        <span className="fr-parts__newrow-lbl muted">New row:</span>
        <input
          ref={newNameRef}
          className="fr-parts__cell-inp fr-parts__cell-inp--grow"
          placeholder="Part name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <input
          className="fr-parts__cell-inp"
          placeholder="Part #"
          value={draftNo}
          onChange={(e) => setDraftNo(e.target.value)}
        />
        <select
          className="fr-parts__cell-inp fr-parts__cell-sel"
          value={draftCat}
          onChange={(e) => setDraftCat(e.target.value)}
        >
          <option value="general">Category</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className="fr-parts__cell-inp fr-parts__cell-qty"
          placeholder="Qty"
          value={draftQty}
          onChange={(e) => setDraftQty(e.target.value)}
        />
        <input
          className="fr-parts__cell-inp fr-parts__cell-cost"
          placeholder="Cost"
          value={draftCost}
          onChange={(e) => setDraftCost(e.target.value)}
        />
        <button type="button" className="btn sm fr-parts__add-row" onClick={addRow}>
          + Add row
        </button>
      </div>

      <p className="fr-parts__hint muted">Drag column edges to resize · Tab to navigate</p>
    </section>
  )
}
