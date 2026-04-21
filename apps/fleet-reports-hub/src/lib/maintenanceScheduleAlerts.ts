import type { IntegrityAlert, IntegrityCheckCode } from '../types/integrity'
import {
  FLEET_AVG_MILES_PER_MONTH,
  mockLastServiceMiles,
  schedulesForMake,
} from '../data/maintenanceScheduleData'

const DUE_SOON_MI = 5000

export type UnitDueSnapshot = {
  unitId: string
  vehicleMakeKey: string
  currentOdometer: number
  items: {
    serviceKey: string
    serviceLabel: string
    intervalMiles: number
    nextDueMiles: number
    milesRemaining: number
    status: 'ok' | 'due_soon' | 'overdue'
  }[]
}

export function computeUnitDueSchedule(
  unitId: string,
  vehicleMakeKey: string,
  currentOdometer: number,
): UnitDueSnapshot {
  const rows = schedulesForMake(vehicleMakeKey)
  const items = rows.map((r) => {
    const last = mockLastServiceMiles(unitId, r.serviceKey)
    const nextDue = last + r.intervalMiles
    const milesRemaining = nextDue - currentOdometer
    let status: 'ok' | 'due_soon' | 'overdue' = 'ok'
    if (milesRemaining < 0) status = 'overdue'
    else if (milesRemaining <= DUE_SOON_MI) status = 'due_soon'
    return {
      serviceKey: r.serviceKey,
      serviceLabel: r.serviceLabel,
      intervalMiles: r.intervalMiles,
      nextDueMiles: nextDue,
      milesRemaining,
      status,
    }
  })
  return { unitId, vehicleMakeKey, currentOdometer, items }
}

export function scheduleIntegrityAlerts(
  snap: UnitDueSnapshot,
): IntegrityAlert[] {
  const out: IntegrityAlert[] = []
  const now = new Date().toISOString()
  for (const it of snap.items) {
    if (it.status === 'overdue') {
      out.push({
        id: `M5-${snap.unitId}-${it.serviceKey}-${crypto.randomUUID()}`,
        checkCode: 'M5' as IntegrityCheckCode,
        category: 'maintenance',
        severity: 'red',
        title: `PM overdue: ${it.serviceLabel}`,
        message: `Unit ${snap.unitId}: due at ~${it.nextDueMiles.toLocaleString()} mi (${Math.abs(it.milesRemaining).toLocaleString()} mi past)`,
        entityType: 'vehicle',
        entityId: snap.unitId,
        triggeringRecords: [
          {
            id: it.serviceKey,
            label: it.serviceLabel,
            unit: snap.unitId,
            detail: `Interval ${it.intervalMiles.toLocaleString()} mi · fleet avg ${FLEET_AVG_MILES_PER_MONTH.toLocaleString()} mi/mo`,
          },
        ],
        createdAt: now,
      })
    } else if (it.status === 'due_soon') {
      out.push({
        id: `M6-${snap.unitId}-${it.serviceKey}-${crypto.randomUUID()}`,
        checkCode: 'M6' as IntegrityCheckCode,
        category: 'maintenance',
        severity: 'amber',
        title: `PM due soon: ${it.serviceLabel}`,
        message: `Unit ${snap.unitId}: ~${it.milesRemaining.toLocaleString()} mi remaining before ${it.nextDueMiles.toLocaleString()} mi`,
        entityType: 'vehicle',
        entityId: snap.unitId,
        triggeringRecords: [
          {
            id: it.serviceKey,
            label: it.serviceLabel,
            unit: snap.unitId,
            detail: `Within ${DUE_SOON_MI.toLocaleString()} mi threshold`,
          },
        ],
        createdAt: now,
      })
    }
  }
  return out
}

export function fleetWideDueRows(): UnitDueSnapshot[] {
  const units = [
    { id: '101', make: 'freightliner_cascadia', odo: 418200 },
    { id: '102', make: 'volvo_vnl', odo: 201400 },
    { id: '204', make: 'peterbilt_579', odo: 307800 },
    { id: '305', make: 'generic', odo: 125000 },
    { id: '412', make: 'mack_anthem', odo: 502000 },
  ]
  return units.map((u) => computeUnitDueSchedule(u.id, u.make, u.odo))
}
