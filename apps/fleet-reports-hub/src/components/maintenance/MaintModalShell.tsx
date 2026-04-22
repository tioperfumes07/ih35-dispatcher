import { useEffect, useId, useRef } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'

export type MaintSaveVisualState = 'idle' | 'loading' | 'success' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  documentTypePill: string
  /** e.g. Unit 101 · Cascadia — hidden if empty */
  unitInfo?: string | null
  children: React.ReactNode
  saveBar: React.ReactNode
  /** Optional class on root dialog for width */
  className?: string
}

export function MaintModalShell({
  open,
  onClose,
  documentTypePill,
  unitInfo,
  children,
  saveBar,
  className = '',
}: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const { isFullScreen, toggle } = useFullScreen()

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      const el = returnFocusRef.current
      if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0)
      return
    }
    const id = window.setTimeout(() => {
      const root = dialogRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  const print = () => {
    window.print()
  }

  return (
    <div
      className="maint-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={'maint-modal' + (className ? ` ${className}` : '')}
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="maint-modal__titlebar">
          <div className="maint-modal__titlebar-left">
            <span id={titleId} className="maint-modal__pill">
              {documentTypePill}
            </span>
            {unitInfo ? <span className="maint-modal__unit">{unitInfo}</span> : null}
          </div>
          <div className="maint-modal__titlebar-actions">
            <button type="button" className="maint-modal__tb-btn" onClick={print}>
              Print
            </button>
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              className="maint-modal__tb-btn"
            />
            <button type="button" className="maint-modal__tb-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>
        <div className="maint-modal__body">{children}</div>
        <footer className="maint-modal__savebar">{saveBar}</footer>
      </div>
    </div>
  )
}

type SaveButtonProps = {
  state: MaintSaveVisualState
  onClick: () => void
  disabled?: boolean
  label?: string
}

export function MaintModalSaveButton({
  state,
  onClick,
  disabled,
  label = 'Save',
}: SaveButtonProps) {
  return (
    <button
      type="button"
      className={
        'maint-modal-savebtn btn primary' +
        (state === 'success' ? ' maint-modal-savebtn--ok' : '') +
        (state === 'error' ? ' maint-modal-savebtn--err' : '')
      }
      disabled={disabled || state === 'loading'}
      onClick={onClick}
    >
      {state === 'loading' ? (
        <span className="maint-modal-savebtn__spin" aria-hidden />
      ) : state === 'success' ? (
        '✓'
      ) : state === 'error' ? (
        'Error'
      ) : (
        label
      )}
    </button>
  )
}
