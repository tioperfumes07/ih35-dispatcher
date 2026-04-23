import type { IntegrityAlert } from '../../types/integrity'

type Props = {
  alerts: IntegrityAlert[] | null
  onDismiss: () => void
  onOpenDashboard: () => void
}

export function PostSaveIntegrityPanel({
  alerts,
  onDismiss,
  onOpenDashboard,
}: Props) {
  if (!alerts || alerts.length === 0) return null

  return (
    <div className="integrity-post-panel" role="status">
      <div className="integrity-post-panel__inner">
        <div>
          <strong>Integrity check completed</strong>
          <p className="muted small">
            POST <code>/api/integrity/check</code> ran after save (non-blocking).
            Review advisory alerts below.
          </p>
          <ul className="integrity-post-panel__list">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className={`sev sev--${a.severity}`}>{a.checkCode}</span>
                {a.title}
              </li>
            ))}
          </ul>
        </div>
        <div className="integrity-post-panel__actions">
          <button type="button" className="btn sm ghost" onClick={onOpenDashboard}>
            Open integrity dashboard
          </button>
          <button type="button" className="btn sm ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
