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
import { BulkActionBar, type BulkActionBarAction } from '../ui/BulkActionBar'

export type SharedListColumn<T extends Record<string, unknown>> = {
  id: string
  label: string
  width: number
  render: (row: T) => ReactNode
  className?: string
}

export type SharedListBulkAction<T extends Record<string, unknown>> = {
  label: string
  icon?: string
  variant?: 'danger' | 'warning' | 'default'
  onClick: (rows: T[]) => void | Promise<void>
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
  addRowFields?: ReactNode
  onExportExcel?: () => void
  toolbarExtra?: ReactNode
  bulkActions?: SharedListBulkAction<T>[]
  onBulkStatusChange?: (status: string, rows: T[]) => void | Promise<void>
  onBulkTypeChange?: (type: string, rows: T[]) => void | Promise<void>
}

const PAGE_OPTS = [10, 25, 50] as const

function exportRowsToCsv<T extends Record<string, unknown>>(rows: T[], columns: SharedListColumn<T>[], filename: string) {
  const esc = (value: unknown) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  const header = columns.map((c) => esc(c.label)).join(',')
  const body = rows
    .map((row) => columns.map((c) => esc(c.render(row))).join(','))
    .join('\n')
  const csv = `${header}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

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
  bulkActions = [],
  onBulkStatusChange,
  onBulkTypeChange,
}: Props<T>) {
  const uid = useId()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [pageSize, setPageSize] = useState<(typeof PAGE_OPTS)[number]>(25)
  const [page, setPage] = useState(1)
  const [order, setOrder] = useState<T[]>(() => [...data])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    setOrder([...data])
  }, [data])

  const initialWidths = useMemo(
    () => [36, 40, ...columns.map((c) => c.width), 132],
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

  const filteredKeySet = useMemo(() => new Set(filtered.map((row) => rowKey(row))), [filtered, rowKey])
  const selectedCount = useMemo(() => {
    let count = 0
    selected.forEach((id) => {
      if (filteredKeySet.has(id)) count += 1
    })
    return count
  }, [filteredKeySet, selected])

  const selectedRows = useMemo(() => filtered.filter((row) => selected.has(rowKey(row))), [filtered, rowKey, selected])

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const next = new Set<string>()
      for (const id of prev) if (filteredKeySet.has(id)) next.add(id)
      if (next.size === prev.size) return prev
      return next
    })
  }, [filteredKeySet])

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

  const toggleRow = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const selectAllFiltered = useCallback(() => {
    setSelected(new Set(filtered.map((row) => rowKey(row))))
  }, [filtered, rowKey])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const resolvedBulkActions = useMemo<BulkActionBarAction[]>(() => {
    const provided = bulkActions.map((action) => ({
      label: action.label,
      icon: action.icon,
      variant: action.variant,
      onClick: () => void action.onClick(selectedRows),
    }))
    return [
      ...provided,
      {
        label: 'Export selected',
        icon: '⬇',
        onClick: () => exportRowsToCsv(selectedRows, columns, `${exportFilename}-selected`),
      },
    ]
  }, [bulkActions, columns, exportFilename, selectedRows])

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
              <th className="shared-list__th" aria-label="Select all">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedCount === filtered.length}
                  onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())}
                />
              </th>
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
                      onMouseDown={col.onResizeMouseDown(i + 2)}
                    />
                  ) : null}
                </th>
              ))}
              <th className="shared-list__th shared-list__th--actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => {
              const id = rowKey(row)
              const isSelected = selected.has(id)
              return (
                <tr
                  key={id}
                  className="shared-list__tr"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropRow(i)}
                  style={{ backgroundColor: isSelected ? 'rgba(59,130,246,0.1)' : 'transparent' }}
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
                  <td className="shared-list__td">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleRow(id, e.target.checked)}
                    />
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
                <td colSpan={columns.length + 3} className="empty-cell">
                  No rows match the current search/filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <BulkActionBar
        selectedCount={selectedCount}
        totalCount={filtered.length}
        onSelectAll={selectAllFiltered}
        onClearSelection={clearSelection}
        actions={resolvedBulkActions}
        onStatusChange={(status) => {
          if (!onBulkStatusChange) return
          void onBulkStatusChange(status, selectedRows)
        }}
        onTypeChange={(type) => {
          if (!onBulkTypeChange) return
          void onBulkTypeChange(type, selectedRows)
        }}
      />

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
