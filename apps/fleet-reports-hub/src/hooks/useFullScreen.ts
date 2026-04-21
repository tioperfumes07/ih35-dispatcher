import { useCallback, useState, type CSSProperties } from 'react'

/**
 * Viewport-sized modal state (not the browser Fullscreen API).
 * Used by WorkOrderShell, fuel modals, and WO pickers — keep a single implementation here.
 */
export function useFullScreen() {
  const [isFullScreen, setIsFullScreen] = useState(false)
  const toggle = useCallback(() => setIsFullScreen((p) => !p), [])
  const reset = useCallback(() => setIsFullScreen(false), [])
  return { isFullScreen, toggle, reset }
}

/** Full-viewport panel styles for modal shells (pair with `ModalFullscreenToggle`). */
export const MODAL_FULLSCREEN_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  borderRadius: 0,
  zIndex: 9999,
  maxWidth: '100vw',
  maxHeight: '100vh',
}
