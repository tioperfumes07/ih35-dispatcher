import { useEffect, useId, useState, type ReactNode } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'

type Props = {
  open: boolean
  title: string
  subtitle?: string
  children: ReactNode
  saveLabel?: string
  extraSaveButton?: ReactNode
  onClose: () => void
  onSave: () => void | Promise<void>
}

export function ListItemEditModal({
  open,
  title,
  subtitle,
  children,
  saveLabel = 'Save',
  extraSaveButton,
  onClose,
  onSave,
}: Props) {
  const titleId = useId()
  const { isFullScreen, toggle } = useFullScreen()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const runSave = async () => {
    setBusy(true)
    try {
      await onSave()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="list-edit-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="list-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="list-edit-modal__head">
          <div>
            <h2 id={titleId} className="list-edit-modal__title">
              {title}
            </h2>
            {subtitle ? <p className="list-edit-modal__sub muted tiny">{subtitle}</p> : null}
          </div>
          <div className="list-edit-modal__head-actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              className="btn sm ghost list-edit-modal__icon-btn"
              title="Full screen"
            />
            <button type="button" className="btn sm ghost" onClick={onClose}>
              Cancel
            </button>
            {extraSaveButton}
            <button type="button" className="btn sm success" disabled={busy} onClick={() => void runSave()}>
              {saveLabel}
            </button>
          </div>
        </header>
        <div className="list-edit-modal__body">{children}</div>
      </div>
    </div>
  )
}
