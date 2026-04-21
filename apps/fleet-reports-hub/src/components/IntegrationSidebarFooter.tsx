import {
  formatLastSyncTime,
  useIntegrationConnections,
} from '../context/IntegrationConnectionsContext'

function statusDotClass(status: string) {
  if (status === 'degraded') return 'int-dot int-dot--degraded'
  return `int-dot int-dot--${status}`
}

export function IntegrationSidebarFooter() {
  const { qbo, samsara } = useIntegrationConnections()

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
              ? `Last check ${formatLastSyncTime(qbo.lastSyncAt)}`
              : qbo.status === 'degraded'
                ? 'Recent API error'
                : qbo.status === 'checking'
                  ? 'Checking…'
                  : 'Disconnected'}
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
              ? `Last sync ${formatLastSyncTime(samsara.lastSyncAt)}`
              : samsara.status === 'checking'
                ? 'Checking…'
                : 'Disconnected'}
          </span>
        </li>
      </ul>
    </div>
  )
}
