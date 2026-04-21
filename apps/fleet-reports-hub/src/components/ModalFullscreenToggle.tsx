import type { ButtonHTMLAttributes } from 'react'

export type ModalFullscreenToggleProps = {
  isFullScreen: boolean
  onToggle: () => void
  /** Compact corner glyphs (report cards) instead of ⛶ / ⊡. */
  glyph?: 'unicode' | 'corners'
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title' | 'disabled'>

/**
 * Shared expand / compress control for modal and drawer shells.
 * Pair with `useFullScreen()` and `MODAL_FULLSCREEN_STYLE` from `hooks/useFullScreen`.
 */
const expandCornersPath =
  'M1 1h4v2H3v2H1V1zm6 0h4v4H9V3H7V1zM1 7h2v2h2v2H1V7zm8 0h2v4H7V9h2V7z'
const compressCornersPath =
  'M3 3h2v2H3V3zm4 0h2v2H7V3zM3 7h2v2H3V7zm4 0h2v2H7V7zM5 5h2v2H5V5z'

export function ModalFullscreenToggle({
  isFullScreen,
  onToggle,
  disabled,
  className,
  title = 'Toggle full screen',
  glyph = 'unicode',
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
      {glyph === 'corners' ? (
        <svg
          className="modal-fs-toggle__svg"
          width="9"
          height="9"
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path
            fill="currentColor"
            d={isFullScreen ? compressCornersPath : expandCornersPath}
          />
        </svg>
      ) : (
        <span className="modal-fs-toggle__icon" aria-hidden>
          {isFullScreen ? '⊡' : '⛶'}
        </span>
      )}
    </button>
  )
}
