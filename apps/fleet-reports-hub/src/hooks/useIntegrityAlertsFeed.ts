import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  INTEGRITY_ALERTS_CHANGED_EVENT,
  loadStoredAlerts,
} from '../api/postIntegrityCheck'
import type { IntegrityAlert } from '../types/integrity'

/** Matches requested Samsara-style live cadence (60s). */
export const INTEGRITY_LIVE_FEED_INTERVAL_MS = 60_000

function sortOpenByNewest(open: IntegrityAlert[]) {
  return [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function useIntegrityAlertsFeed() {
  const [tick, setTick] = useState(0)

  const bump = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const id = window.setInterval(bump, INTEGRITY_LIVE_FEED_INTERVAL_MS)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'fleet:integrity-alerts' || e.key === null) bump()
    }
    const onCustom = () => bump()
    window.addEventListener('storage', onStorage)
    window.addEventListener(INTEGRITY_ALERTS_CHANGED_EVENT, onCustom)
    const onVis = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(INTEGRITY_ALERTS_CHANGED_EVENT, onCustom)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [bump])

  return useMemo(() => {
    void tick
    const all = loadStoredAlerts()
    const open = all.filter((a) => !a.reviewedAt)
    const sorted = sortOpenByNewest(open)
    const recent5 = sorted.slice(0, 5)
    const reds = open.filter((a) => a.severity === 'red').length
    const ambers = open.filter((a) => a.severity === 'amber').length
    return {
      open,
      recent5,
      totalOpen: open.length,
      reds,
      ambers,
      reload: bump,
    }
  }, [tick, bump])
}

