import type { ButtonHTMLAttributes } from 'react'

export type ModalFullscreenToggleProps = {
  isFullScreen: boolean
  onToggle: () => void
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title' | 'disabled'>

/**
 * Shared expand / compress control for modal and drawer shells.
 * Pair with `useFullScreen()` and `MODAL_FULLSCREEN_STYLE` from `hooks/useFullScreen`.
 */
export function ModalFullscreenToggle({
  isFullScreen,
  onToggle,
  disabled,
  className,
  title = 'Toggle full screen',
}: ModalFullscreenToggleProps) {
  return (
    <button
      type="button"
      className={['modal-fs-toggle', className].filter(Boolean).join(' ')}
      onClick={onToggle}
      disabled={disabled}
      aria-label="Toggle full screen"
      title={title}
    >
      <span className="modal-fs-toggle__icon" aria-hidden>
        {isFullScreen ? '⊡' : '⛶'}
      </span>
    </button>
  )
}
