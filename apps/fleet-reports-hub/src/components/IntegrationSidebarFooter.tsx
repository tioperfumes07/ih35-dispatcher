import { useEffect, useState } from 'react'
import {
  useIntegrationConnections,
} from '../context/IntegrationConnectionsContext'

function statusDotClass(status: string) {
  if (status === 'degraded') return 'int-dot int-dot--degraded'
  return `int-dot int-dot--${status}`
}

export function IntegrationSidebarFooter() {
  const { qbo, samsara } = useIntegrationConnections()
  const [qboCacheAge, setQboCacheAge] = useState<number | null>(null)
  const [samsaraVehicleCount, setSamsaraVehicleCount] = useState<number | null>(null)
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    const loadMeta = async () => {
      const [qboSt, health, queue] = await Promise.all([
        fetch('/api/qbo/status', { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => null),
        fetch('/api/health', { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => null),
        fetch('/api/qbo/sync-queue', { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => null),
      ])
      if (cancelled) return
      setQboCacheAge(Number.isFinite(Number(qboSt?.cacheAgeMinutes)) ? Number(qboSt?.cacheAgeMinutes) : null)
      setSamsaraVehicleCount(Number.isFinite(Number(health?.samsaraVehicles)) ? Number(health?.samsaraVehicles) : null)
      setPendingSyncCount(Number(queue?.pending || 0) + Number(queue?.failed || 0))
    }
    void loadMeta()
    const id = window.setInterval(() => void loadMeta(), 60000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  return (
    <div className="filter-panel__integrations" aria-label="Integration status">
      <h3 className="filter-panel__integrations-title">Connections</h3>
      <ul className="int-footer-list">
        <li className="int-footer-row">
          <span
            className={statusDotClass(qbo.status)}
            title={`QuickBooks Online: ${qbo.status}`}
            aria-label={`QuickBooks Online ${qbo.status}`}
          />
          <span className="int-footer-label">QBO</span>
          <span className="int-footer-sync muted tiny">
            {qbo.status === 'connected'
              ? `QBO connected · cache: ${qboCacheAge == null ? '—' : `${qboCacheAge}m ago`}`
              : qbo.status === 'degraded'
                ? `QBO degraded · cache: ${qboCacheAge == null ? '—' : `${qboCacheAge}m ago`}`
                : qbo.status === 'checking'
                  ? 'Checking…'
                  : `QBO offline · cache: ${qboCacheAge == null ? '—' : `${qboCacheAge}m ago`}`}
          </span>
        </li>
        <li className="int-footer-row">
          <span
            className={statusDotClass(samsara.status)}
            title={`Samsara: ${samsara.status}`}
            aria-label={`Samsara ${samsara.status}`}
          />
          <span className="int-footer-label">Samsara</span>
          <span className="int-footer-sync muted tiny">
            {samsara.status === 'connected'
              ? `Samsara connected · ${samsaraVehicleCount == null ? '—' : samsaraVehicleCount} vehicles`
              : samsara.status === 'checking'
                ? 'Checking…'
                : `Samsara cache · ${samsaraVehicleCount == null ? '—' : samsaraVehicleCount} vehicles`}
          </span>
        </li>
      </ul>
      <div className="muted tiny" style={{ marginTop: 6, color: pendingSyncCount > 0 ? '#fca5a5' : undefined }}>
        {pendingSyncCount > 0 ? `${pendingSyncCount} pending sync` : '0 pending sync'}
      </div>
    </div>
  )
}
