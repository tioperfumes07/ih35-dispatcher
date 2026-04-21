import { useEffect, useMemo, useState } from 'react'
import {
  INTEGRITY_ALERTS_CHANGED_EVENT,
  loadStoredAlerts,
} from '../../api/postIntegrityCheck'
import { INTEGRITY_LIVE_FEED_INTERVAL_MS } from '../../hooks/useIntegrityAlertsFeed'
import type { IntegrityAlert } from '../../types/integrity'
import { IntegrityAlertsKpiWidget } from './IntegrityAlertsKpiWidget'

type Props = {
  onViewAllIntegrity: () => void
}

function catLabel(c: IntegrityAlert['category']) {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

function sevLabel(s: IntegrityAlert['severity']) {
  return s === 'red' ? 'Error' : s === 'amber' ? 'Warning' : String(s)
}

/** Maintenance main column · workspace snapshot KPI strip + integrity live feed. */
export function WorkspaceSnapshot({ onViewAllIntegrity }: Props) {
  const [storeTick, setStoreTick] = useState(0)

  useEffect(() => {
    const bump = () => {
      loadStoredAlerts()
      setStoreTick((t) => t + 1)
    }
    const id = window.setInterval(bump, INTEGRITY_LIVE_FEED_INTERVAL_MS)
    window.addEventListener(INTEGRITY_ALERTS_CHANGED_EVENT, bump)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(INTEGRITY_ALERTS_CHANGED_EVENT, bump)
    }
  }, [])

  const { openCount, recent5Lines } = useMemo(() => {
    void storeTick
    const all = loadStoredAlerts()
    const open = all.filter((a) => !a.reviewedAt)
    const sorted = [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const recent5Lines = sorted.slice(0, 5).map(
      (a) => `${catLabel(a.category)} · ${sevLabel(a.severity)}`,
    )
    return { openCount: open.length, recent5Lines }
  }, [storeTick])

  return (
    <div className="maint-ws-snapshot" aria-label="Workspace snapshot">
      <div className="maint-ws-snapshot-kpis">
        <div className="acct-dash__kpi">
          <span className="acct-dash__kpi-label">Tracked assets</span>
          <span className="acct-dash__kpi-val">41</span>
        </div>
        <div className="acct-dash__kpi">
          <span className="acct-dash__kpi-label">Assigned / working</span>
          <span className="acct-dash__kpi-val">10</span>
        </div>
        <div className="acct-dash__kpi">
          <span className="acct-dash__kpi-label">Maintenance past due</span>
          <span className="acct-dash__kpi-val">0</span>
        </div>
        <div className="acct-dash__kpi">
          <span className="acct-dash__kpi-label">QBO vendors</span>
          <span className="acct-dash__kpi-val">477</span>
        </div>
        <div className="acct-dash__kpi maint-ws-snapshot-integrity-kpi">
          <span className="acct-dash__kpi-label">Integrity Alerts</span>
          <span className="acct-dash__kpi-val" aria-live="polite">
            {openCount}
          </span>
          <ul
            className="maint-ws-snapshot-integrity-kpi__list"
            aria-label="Five most recent open alerts"
          >
            {recent5Lines.length === 0 ? (
              <li className="muted tiny maint-ws-snapshot-integrity-kpi__empty">No open alerts.</li>
            ) : (
              recent5Lines.map((line, i) => (
                <li key={`${line}-${i}`} className="tiny maint-ws-snapshot-integrity-kpi__line">
                  {line}
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            className="maint-ws-snapshot-integrity-kpi__viewall"
            onClick={onViewAllIntegrity}
          >
            View all →
          </button>
        </div>
      </div>
      <div className="maint-ws-snapshot-integrity-feed">
        <IntegrityAlertsKpiWidget variant="strip-only" onViewAll={onViewAllIntegrity} />
      </div>
    </div>
  )
}
