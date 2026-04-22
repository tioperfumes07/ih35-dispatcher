/**
 * Column resize for hub data tables (Packet 3 — canonical behavior).
 * ERP parity: `public/js/erp-ui.js` → `erpInitColumnResize` / `erpInitFleetTableChrome`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'

const DEFAULT_COL_PX = 120

function resolveInitialWidths(
  arg0: number | number[],
  arg1?: number[],
): number[] {
  if (typeof arg0 === 'number') {
    const n = Math.max(0, Math.floor(arg0))
    if (n === 0) return []
    const seed =
      arg1 && arg1.length > 0
        ? arg1.map((w) => (Number.isFinite(w) && w > 0 ? w : DEFAULT_COL_PX))
        : null
    if (!seed) {
      return Array.from({ length: n }, () => DEFAULT_COL_PX)
    }
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      out.push(seed[i] ?? seed[seed.length - 1] ?? DEFAULT_COL_PX)
    }
    return out
  }
  return [...arg0]
}

export type UseColumnResizeResult = {
  tableRef: RefObject<HTMLTableElement | null>
  widths: number[]
  /** Column index → width (px), for callers that prefer a keyed map. */
  columnWidths: Readonly<Record<number, number>>
  onResizeMouseDown: (colIndex: number) => (e: ReactMouseEvent) => void
  /** Same as `onResizeMouseDown(colIndex)(e)` — matches spec-style `startResize` API. */
  startResize: (colIndex: number, e: ReactMouseEvent) => void
}

/**
 * Column resize for tables: mousedown on a handle updates that column's width (px).
 * Apply `widths[i]` to `<col style={{ width }}>` or `<th style={{ width }}>`.
 *
 * @overload Pass explicit pixel widths per column (existing callers).
 * @overload Pass column count and optional seed widths (shorter arrays repeat last seed, then 120px).
 */
export function useColumnResize(initialWidthsPx: number[]): UseColumnResizeResult
export function useColumnResize(
  columnCount: number,
  defaultWidths?: number[],
): UseColumnResizeResult
export function useColumnResize(
  arg0: number | number[],
  arg1?: number[],
): UseColumnResizeResult {
  const initialWidthsPx = resolveInitialWidths(arg0, arg1)
  const tableRef = useRef<HTMLTableElement>(null)
  const [widths, setWidths] = useState<number[]>(() => [...initialWidthsPx])
  const dragRef = useRef<{ col: number; startX: number; startWidths: number[] } | null>(
    null,
  )

  const onResizeMouseDown = useCallback(
    (colIndex: number) => (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        col: colIndex,
        startX: e.clientX,
        startWidths: [...widths],
      }
    },
    [widths],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const delta = e.clientX - d.startX
      setWidths(() => {
        const next = [...d.startWidths]
        next[d.col] = Math.max(40, d.startWidths[d.col]! + delta)
        return next
      })
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startResize = useCallback(
    (colIndex: number, e: ReactMouseEvent) => {
      onResizeMouseDown(colIndex)(e)
    },
    [onResizeMouseDown],
  )

  const columnWidths = useMemo(() => {
    const o: Record<number, number> = {}
    widths.forEach((w, i) => {
      o[i] = w
    })
    return o
  }, [widths])

  return { tableRef, widths, columnWidths, onResizeMouseDown, startResize }
}
