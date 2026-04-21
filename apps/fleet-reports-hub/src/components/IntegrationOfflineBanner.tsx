import { useIntegrationConnections } from '../context/IntegrationConnectionsContext'

export function IntegrationOfflineBanner() {
  const {
    qbo,
    samsara,
    networkOnline,
    isProbing,
    userInitiatedProbe,
    recheckAll,
  } = useIntegrationConnections()

  const anyDisconnected =
    qbo.status === 'disconnected' || samsara.status === 'disconnected'
  const showOfflineBanner = !networkOnline
  const showUserCheckingBanner =
    networkOnline && isProbing && userInitiatedProbe
  const showDisconnectBanner =
    networkOnline && !isProbing && anyDisconnected

  if (!showOfflineBanner && !showUserCheckingBanner && !showDisconnectBanner) {
    return null
  }

  const reconnect = () => {
    void recheckAll()
  }

  return (
    <div
      className={
        'integration-banner' +
        (showOfflineBanner || showDisconnectBanner
          ? ' integration-banner--alert'
          : ' integration-banner--checking')
      }
      role="status"
    >
      <div className="integration-banner__inner">
        {showOfflineBanner && (
          <p className="integration-banner__text">
            You are offline. QBO and Samsara sync is paused until connectivity
            returns.
          </p>
        )}
        {showUserCheckingBanner && (
          <p className="integration-banner__text">
            Checking QuickBooks Online and Samsara connections…
          </p>
        )}
        {showDisconnectBanner && (
          <p className="integration-banner__text">
            {qbo.status === 'disconnected' && samsara.status === 'disconnected'
              ? 'QuickBooks Online and Samsara are disconnected.'
              : qbo.status === 'disconnected'
                ? 'QuickBooks Online is disconnected.'
                : 'Samsara is disconnected.'}{' '}
            Data may be stale until reconnected.
          </p>
        )}
        {(showOfflineBanner || showDisconnectBanner) && (
          <button
            type="button"
            className="integration-banner__reconnect"
            onClick={reconnect}
          >
            Reconnect
          </button>
        )}
      </div>
    </div>
  )
}
