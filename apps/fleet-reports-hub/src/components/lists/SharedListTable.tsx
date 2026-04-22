import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useColumnResize } from '../../hooks/useColumnResize'
import { useTableTabOrder } from '../../hooks/useTableTabOrder'
import { exportJsonRowsToXlsx } from '../../lib/tableExportXlsx'
import { TableResizeHintFooter } from '../table/TableResizeHintFooter'

export type SharedListColumn<T extends Record<string, unknown>> = {
  id: string
  label: string
  /** Default column width in px (excludes drag column). */
  width: number
  render: (row: T) => ReactNode
  className?: string
}

type Props<T extends Record<string, unknown>> = {
  title: string
  itemCount: number
  columns: SharedListColumn<T>[]
  data: T[]
  rowKey: (row: T) => string
  searchPlaceholder?: string
  searchKeys?: (keyof T)[]
  exportFilename: string
  onCloseList?: () => void
  onAddNew?: () => void
  onEdit?: (row: T) => void
  onDelete?: (row: T) => void
  onActivate?: (row: T) => void
  onDeactivate?: (row: T) => void
  /** Optional: render inputs in footer add-row; parent handles submit via onAddRow */
  addRowFields?: ReactNode
  onExportExcel?: () => void
  /** Extra controls rendered in the list header toolbar (e.g. sync actions). */
  toolbarExtra?: ReactNode
}

const PAGE_OPTS = [10, 25, 50] as const

export function SharedListTable<T extends Record<string, unknown>>({
  title,
  itemCount,
  columns,
  data,
  rowKey,
  searchPlaceholder = 'Search…',
  searchKeys,
  exportFilename,
  onCloseList,
  onAddNew,
  onEdit,
  onDelete,
  onActivate,
  onDeactivate,
  addRowFields,
  onExportExcel,
  toolbarExtra,
}: Props<T>) {
  const uid = useId()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [pageSize, setPageSize] = useState<(typeof PAGE_OPTS)[number]>(25)
  const [page, setPage] = useState(1)
  const [order, setOrder] = useState<T[]>(() => [...data])

  useEffect(() => {
    setOrder([...data])
  }, [data])

  const initialWidths = useMemo(
    () => [36, ...columns.map((c) => c.width), 132],
    [columns],
  )
  const col = useColumnResize(initialWidths)

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return order.filter((row) => {
      if (status !== 'all') {
        const st = String((row as { status?: string }).status ?? 'active').toLowerCase()
        if (status === 'active' && st !== 'active') return false
        if (status === 'inactive' && st === 'active') return false
      }
      if (!qq) return true
      if (searchKeys?.length) {
        return searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(qq))
      }
      return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(qq))
    })
  }, [order, q, status, searchKeys])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageSafe = Math.min(page, pageCount)
  const slice = useMemo(() => {
    const start = (pageSafe - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, pageSafe, pageSize])

  useTableTabOrder(col.tableRef, [slice, columns, pageSafe, pageSize])

  useEffect(() => {
    setPage(1)
  }, [q, status, pageSize, filtered.length])

  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', String(idx))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDropRow = (toIdx: number) => (e: React.DragEvent) => {
    e.preventDefault()
    const from = Number(e.dataTransfer.getData('text/plain'))
    if (!Number.isFinite(from)) return
    const start = (pageSafe - 1) * pageSize
    const fromGlobal = start + from
    const toGlobal = start + toIdx
    if (fromGlobal === toGlobal) return
    setOrder((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromGlobal, 1)
      next.splice(toGlobal, 0, moved!)
      return next
    })
  }

  const defaultExport = useCallback(() => {
    const rows = filtered.map((row) => {
      const o: Record<string, unknown> = {}
      for (const c of columns) {
        const cell = c.render(row)
        o[c.id] = typeof cell === 'string' || typeof cell === 'number' ? cell : String(cell)
      }
      return o
    })
    void exportJsonRowsToXlsx(rows, exportFilename, 'Lines')
  }, [columns, exportFilename, filtered])

  return (
    <div className="shared-list">
      <header className="shared-list__head">
        <span className="shared-list__head-title">
          {title} — {itemCount} items
        </span>
        <div className="shared-list__head-actions">
          {toolbarExtra}
          <button
            type="button"
            className="shared-list__head-btn fr-table-excel-export"
            onClick={onExportExcel ?? defaultExport}
          >
            Export Excel
          </button>
          {onAddNew ? (
            <button type="button" className="btn sm primary shared-list__head-btn" onClick={onAddNew}>
              Add new
            </button>
          ) : null}
          {onCloseList ? (
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={onCloseList}>
              ← Close list
            </button>
          ) : null}
        </div>
      </header>

      <div className="shared-list__filters">
        <input
          className="shared-list__search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search"
        />
        <select
          className="shared-list__sel"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Status"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="shared-list__table-wrap">
        <table
          ref={col.tableRef}
          className="shared-list__table fr-data-table"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {col.widths.map((w, i) => (
              <col key={`${uid}-c${i}`} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="shared-list__th shared-list__th--drag" aria-label="Reorder" />
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  className={`shared-list__th fr-th-resizable ${c.className ?? ''}`.trim()}
                >
                  {c.label}
                  {i < columns.length ? (
                    <span
                      className="fr-col-resize"
                      role="presentation"
                      onMouseDown={col.onResizeMouseDown(i + 1)}
                    />
                  ) : null}
                </th>
              ))}
              <th className="shared-list__th shared-list__th--actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => {
              return (
                <tr
                  key={rowKey(row)}
                  className="shared-list__tr"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropRow(i)}
                >
                  <td className="shared-list__drag">
                    <span
                      draggable
                      onDragStart={onDragStart(i)}
                      className="shared-list__drag-handle"
                      aria-hidden
                    >
                      ⠿
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className={`shared-list__td ${c.className ?? ''}`.trim()}>
                      {c.render(row)}
                    </td>
                  ))}
                  <td className="shared-list__td shared-list__td--actions">
                    {onEdit ? (
                      <button type="button" className="shared-list__act shared-list__act--info" onClick={() => onEdit(row)}>
                        Edit
                      </button>
                    ) : null}
                    {onDeactivate && String((row as { status?: string }).status) === 'active' ? (
                      <button
                        type="button"
                        className="shared-list__act shared-list__act--warn"
                        onClick={() => onDeactivate(row)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                    {onActivate && String((row as { status?: string }).status) !== 'active' ? (
                      <button
                        type="button"
                        className="shared-list__act shared-list__act--ok"
                        onClick={() => onActivate(row)}
                      >
                        Activate
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button type="button" className="shared-list__act shared-list__act--danger" onClick={() => onDelete(row)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
            {slice.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="empty-cell">
                  No rows match the current search/filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <TableResizeHintFooter />

      {addRowFields ? <div className="shared-list__addrow">{addRowFields}</div> : null}

      <footer className="shared-list__pager">
        <span className="shared-list__pager-info muted">
          {filtered.length === 0
            ? '0 items'
            : `${(pageSafe - 1) * pageSize + 1}–${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} items`}
        </span>
        <div className="shared-list__pager-ctrl">
          <button
            type="button"
            className="btn sm ghost shared-list__pg-btn"
            disabled={pageSafe <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="muted shared-list__pg-meta">
            Page {pageSafe}/{pageCount}
          </span>
          <button
            type="button"
            className="btn sm ghost shared-list__pg-btn"
            disabled={pageSafe >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
          <select
            className="shared-list__pg-sel"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_OPTS)[number])}
            aria-label="Rows per page"
          >
            {PAGE_OPTS.map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
        </div>
      </footer>
    </div>
  )
}
