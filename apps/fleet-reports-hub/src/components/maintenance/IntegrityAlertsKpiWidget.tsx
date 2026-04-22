import type { IntegrityAlert } from '../../types/integrity'
import { useIntegrityAlertsFeed } from '../../hooks/useIntegrityAlertsFeed'

function catLabel(c: IntegrityAlert['category']) {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function sevLabel(s: IntegrityAlert['severity']) {
  return s === 'red' ? 'Error' : 'Warning'
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

type Props = {
  onViewAll: () => void
  /** `strip-only` keeps the errors / View summary row without the large card (used under snapshot KPI row). */
  variant?: 'full' | 'strip-only'
}

export function IntegrityAlertsKpiWidget({ onViewAll, variant = 'full' }: Props) {
  const { recent5, totalOpen, reds, ambers } = useIntegrityAlertsFeed()

  const headline =
    reds > 0
      ? `${reds} error${reds === 1 ? '' : 's'}`
      : totalOpen > 0
        ? `${totalOpen} open`
        : '0 open'

  const sub =
    totalOpen === 0
      ? 'All clear'
      : reds > 0
        ? `${ambers} warning${ambers === 1 ? '' : 's'} · ${totalOpen} total`
        : `${ambers} warning${ambers === 1 ? '' : 's'}`

  const strip = (
    <div className="maint-integrity-kpi__strip muted tiny">
        {totalOpen === 0 ? (
          <span>No open integrity alerts.</span>
        ) : (
          <span>
            {reds} error{reds === 1 ? '' : 's'} · {ambers} warning{ambers === 1 ? '' : 's'} · {totalOpen}{' '}
            open
          </span>
        )}
        <button type="button" className="maint-integrity-kpi__strip-link" onClick={onViewAll}>
          View
        </button>
    </div>
  )

  if (variant === 'strip-only') {
    return <div className="maint-integrity-kpi maint-integrity-kpi--strip-only">{strip}</div>
  }

  return (
    <div className="maint-integrity-kpi">
      <div className="maint-integrity-kpi__card" aria-labelledby="maint-integrity-kpi-title">
        <div className="maint-integrity-kpi__head">
          <h4 id="maint-integrity-kpi-title" className="maint-integrity-kpi__title">
            Integrity Alerts
          </h4>
          <button type="button" className="maint-integrity-kpi__viewall" onClick={onViewAll}>
            View all
          </button>
        </div>
        <p className="maint-integrity-kpi__metric" aria-live="polite">
          {headline}
        </p>
        <p className="maint-integrity-kpi__sub muted tiny">{sub}</p>
        <ul className="maint-integrity-kpi__list" aria-label="Recent open alerts">
          {recent5.length === 0 ? (
            <li className="maint-integrity-kpi__empty muted tiny">No open alerts.</li>
          ) : (
            recent5.map((a) => (
              <li key={a.id} className="maint-integrity-kpi__item">
                <span className={`maint-integrity-kpi__sev maint-integrity-kpi__sev--${a.severity}`}>
                  {sevLabel(a.severity)}
                </span>
                <span className="maint-integrity-kpi__cat">{catLabel(a.category)}</span>
                <span className="maint-integrity-kpi__desc" title={a.message || a.title}>
                  {truncate((a.message || a.title).trim(), 72)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      {strip}
    </div>
  )
}
