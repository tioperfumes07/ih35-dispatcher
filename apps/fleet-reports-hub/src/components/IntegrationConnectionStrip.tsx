import { formatLastSyncTime, useIntegrationConnections } from '../context/IntegrationConnectionsContext'

export function IntegrationConnectionStrip() {
  const { qbo, samsara, networkOnline } = useIntegrationConnections()

  const qLabel =
    qbo.status === 'connected'
      ? `QBO · last check ${formatLastSyncTime(qbo.lastSyncAt)}`
      : qbo.status === 'degraded'
        ? 'QBO · recent API error (see banner or Maintenance → Test connection)'
        : qbo.status === 'checking'
          ? 'QBO · checking'
          : 'QBO · disconnected'
  const sLabel =
    samsara.status === 'connected'
      ? `Samsara · last sync ${formatLastSyncTime(samsara.lastSyncAt)}`
      : samsara.status === 'checking'
        ? 'Samsara · checking'
        : 'Samsara · disconnected'

  return (
    <div className="connection-strip" role="status">
      <span className="connection-strip__inner">
        {!networkOnline ? (
          <>Browser offline · integration checks paused</>
        ) : (
          <>
            {qLabel} · {sLabel} · auto recheck every 5 min
          </>
        )}
      </span>
    </div>
  )
}
