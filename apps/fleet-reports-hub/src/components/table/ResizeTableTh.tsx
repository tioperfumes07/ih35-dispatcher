import type { MouseEvent, ReactNode } from 'react'

type Props = {
  children: ReactNode
  colIndex: number
  widths: number[]
  onResizeMouseDown: (colIndex: number) => (e: MouseEvent) => void
}

/** Column header with drag handle (uses `fr-col-resize` from `styles/table-resize.css`). */
export function ResizeTableTh({ children, colIndex, widths, onResizeMouseDown }: Props) {
  return (
    <th className="fr-th-resizable" style={{ width: widths[colIndex] }}>
      {children}
      <span
        className="fr-col-resize"
        role="presentation"
        onMouseDown={onResizeMouseDown(colIndex)}
      />
    </th>
  )
}
