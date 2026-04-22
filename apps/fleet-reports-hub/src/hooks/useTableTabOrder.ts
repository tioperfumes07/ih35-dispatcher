import { useLayoutEffect, type RefObject } from 'react'

const FOCUSABLE =
  'tbody input:not([type="hidden"]):not([disabled]), tbody select:not([disabled]), tbody textarea:not([disabled]), tbody button:not([disabled])'

/**
 * Assigns sequential tabIndex (1…) to focusable controls in table body, left-to-right / row-by-row.
 * Skips elements that already have tabindex="-1" or `[data-skip-tab-order]`.
 */
export function useTableTabOrder(
  tableRef: RefObject<HTMLTableElement | null>,
  deps: readonly unknown[],
) {
  useLayoutEffect(() => {
    const t = tableRef.current
    if (!t) return
    const cells = t.querySelectorAll(FOCUSABLE)
    const touched: HTMLElement[] = []
    let i = 1
    cells.forEach((el) => {
      if (!(el instanceof HTMLElement)) return
      if (el.closest('[data-skip-tab-order]')) return
      const cur = el.getAttribute('tabindex')
      if (cur === '-1') return
      if (el.hasAttribute('data-fr-preserve-tabindex')) return
      touched.push(el)
      el.tabIndex = i++
    })
    return () => {
      for (const el of touched) {
        el.removeAttribute('tabindex')
      }
    }
  }, [tableRef, ...deps])
}
