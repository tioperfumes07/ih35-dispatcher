import type {
  IntegrityAlert,
  IntegrityCheckRequest,
  IntegrityCheckResponse,
} from '../types/integrity'
import { evaluateIntegrityChecks } from '../lib/integrityEngine'
import { loadThresholds } from '../lib/integrityThresholds'

/** Same-tab + hook listeners refresh when alerts are merged or saved. */
export const INTEGRITY_ALERTS_CHANGED_EVENT = 'fleet-integrity-alerts-changed'

function pingIntegrityStoreListeners() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INTEGRITY_ALERTS_CHANGED_EVENT))
}

/**
 * POST /api/integrity/check — runs after save; must never block the save path.
 * Tries network first; falls back to client-side evaluation for local dev.
 */
export async function postIntegrityCheck(
  body: IntegrityCheckRequest,
): Promise<IntegrityCheckResponse> {
  const thresholds = loadThresholds()
  try {
    const res = await fetch('/api/integrity/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const data = (await res.json()) as IntegrityCheckResponse
      if (Array.isArray(data.alerts)) return data
    }
  } catch {
    /* no server — use local engine */
  }
  return { alerts: evaluateIntegrityChecks(body, thresholds) }
}

export function mergeAlertsIntoStore(alerts: IntegrityAlert[]) {
  const key = 'fleet:integrity-alerts'
  let existing: IntegrityAlert[] = []
  try {
    existing = JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    existing = []
  }
  const next = [...alerts, ...existing].slice(0, 200)
  localStorage.setItem(key, JSON.stringify(next))
  pingIntegrityStoreListeners()
}

export function loadStoredAlerts(): IntegrityAlert[] {
  try {
    return JSON.parse(localStorage.getItem('fleet:integrity-alerts') ?? '[]')
  } catch {
    return []
  }
}

export function saveStoredAlerts(alerts: IntegrityAlert[]) {
  localStorage.setItem('fleet:integrity-alerts', JSON.stringify(alerts.slice(0, 200)))
  pingIntegrityStoreListeners()
}

export function markAlertReviewed(alertId: string, by = 'user') {
  const all = loadStoredAlerts()
  const ix = all.findIndex((a) => a.id === alertId)
  if (ix < 0) return
  all[ix] = {
    ...all[ix]!,
    reviewedAt: new Date().toISOString(),
    reviewedBy: by,
  }
  saveStoredAlerts(all)
}

export function openAlertCount(): number {
  return loadStoredAlerts().filter((a) => !a.reviewedAt).length
}
