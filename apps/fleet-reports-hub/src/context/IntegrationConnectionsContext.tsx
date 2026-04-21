import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type IntegrationConnStatus = 'connected' | 'disconnected' | 'checking'

export type IntegrationServiceState = {
  status: IntegrationConnStatus
  /** Last successful sync (ms); kept when status flips to disconnected. */
  lastSyncAt: number | null
}

type IntegrationConnectionsContextValue = {
  qbo: IntegrationServiceState
  samsara: IntegrationServiceState
  /** Browser online/offline from `navigator.onLine` + events. */
  networkOnline: boolean
  /** True while a probe cycle is in flight (sidebar dots in checking state). */
  isProbing: boolean
  /** User reconnect / browser back-online: show top “Checking…” banner while true. */
  userInitiatedProbe: boolean
  /** Manual or post-offline reconnect: runs a full probe cycle. */
  recheckAll: () => Promise<void>
}

const IntegrationConnectionsContext =
  createContext<IntegrationConnectionsContextValue | null>(null)

const FIVE_MIN_MS = 5 * 60 * 1000

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export function formatLastSyncTime(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function IntegrationConnectionsProvider({ children }: { children: ReactNode }) {
  const [networkOnline, setNetworkOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [qbo, setQbo] = useState<IntegrationServiceState>({
    status: 'checking',
    lastSyncAt: null,
  })
  const [samsara, setSamsara] = useState<IntegrationServiceState>({
    status: 'checking',
    lastSyncAt: null,
  })
  const [isProbing, setIsProbing] = useState(false)
  const [userInitiatedProbe, setUserInitiatedProbe] = useState(false)
  const probeGeneration = useRef(0)

  const applyOffline = useCallback(() => {
    setQbo((prev) => ({ ...prev, status: 'disconnected' }))
    setSamsara((prev) => ({ ...prev, status: 'disconnected' }))
    setIsProbing(false)
    setUserInitiatedProbe(false)
  }, [])

  const runProbe = useCallback(
    async (opts?: { userInitiated?: boolean }) => {
      const gen = ++probeGeneration.current
      if (opts?.userInitiated) setUserInitiatedProbe(true)
      setIsProbing(true)
      setQbo((prev) => ({ ...prev, status: 'checking' }))
      setSamsara((prev) => ({ ...prev, status: 'checking' }))

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (gen !== probeGeneration.current) {
          setUserInitiatedProbe(false)
          return
        }
        applyOffline()
        return
      }

      await delay(550 + Math.floor(Math.random() * 350))
      if (gen !== probeGeneration.current) {
        setUserInitiatedProbe(false)
        return
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        applyOffline()
        return
      }

      const now = Date.now()
      setQbo(() => ({
        status: 'connected',
        lastSyncAt: now,
      }))
      setSamsara(() => ({
        status: 'connected',
        lastSyncAt: now,
      }))
      setIsProbing(false)
      setUserInitiatedProbe(false)
    },
    [applyOffline],
  )

  useEffect(() => {
    void runProbe()
  }, [runProbe])

  useEffect(() => {
    const id = window.setInterval(() => {
      void runProbe()
    }, FIVE_MIN_MS)
    return () => window.clearInterval(id)
  }, [runProbe])

  useEffect(() => {
    const onOff = () => {
      setNetworkOnline(false)
      applyOffline()
    }
    const onOn = () => {
      setNetworkOnline(true)
      void runProbe({ userInitiated: true })
    }
    window.addEventListener('offline', onOff)
    window.addEventListener('online', onOn)
    return () => {
      window.removeEventListener('offline', onOff)
      window.removeEventListener('online', onOn)
    }
  }, [applyOffline, runProbe])

  const recheckAll = useCallback(async () => {
    await runProbe({ userInitiated: true })
  }, [runProbe])

  const value = useMemo(
    () => ({
      qbo,
      samsara,
      networkOnline,
      isProbing,
      userInitiatedProbe,
      recheckAll,
    }),
    [qbo, samsara, networkOnline, isProbing, userInitiatedProbe, recheckAll],
  )

  return (
    <IntegrationConnectionsContext.Provider value={value}>
      {children}
    </IntegrationConnectionsContext.Provider>
  )
}

export function useIntegrationConnections() {
  const ctx = useContext(IntegrationConnectionsContext)
  if (!ctx) {
    throw new Error(
      'useIntegrationConnections must be used within IntegrationConnectionsProvider',
    )
  }
  return ctx
}
