/** Standard footer copy for resizable data tables (Packet 3). */
export function TableResizeHintFooter({ extra }: { extra?: string }) {
  return (
    <p className="fr-table-resize-hint">
      Drag column edges to resize · Tab to navigate
      {extra ? ` · ${extra}` : ''}
    </p>
  )
}
