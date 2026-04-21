import type { IntegrityAlert } from '../types/integrity'
import { loadStoredAlerts, mergeAlertsIntoStore } from '../api/postIntegrityCheck'

export function seedIntegrityDemoIfEmpty() {
  if (loadStoredAlerts().length > 0) return
  const demo: IntegrityAlert[] = [
    {
      id: 'seed-t1',
      checkCode: 'T1',
      category: 'tires',
      severity: 'amber',
      title: 'Tire installs exceed rolling window',
      message: 'Unit 305 exceeds configured tire count per 90d (demo seed).',
      triggeringRecords: [
        { id: '1', label: 'WO-7712 position 1L', unit: '305', date: '2026-02-10' },
        { id: '2', label: 'WO-8010 position 1L', unit: '305', date: '2026-03-02' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'seed-d2',
      checkCode: 'D2',
      category: 'drivers',
      severity: 'amber',
      title: 'Accident frequency — driver review',
      message: 'Driver exceeds configured accidents/year threshold (demo).',
      triggeringRecords: [
        { id: '1', label: 'M. Chen', driver: 'M. Chen', date: '2026-01-04' },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'seed-m2',
      checkCode: 'M2',
      category: 'maintenance',
      severity: 'red',
      title: 'Monthly spend per unit threshold',
      message: 'Unit 412 over monthly maintenance cap (demo seed).',
      triggeringRecords: [{ id: '1', label: 'Unit 412 rollup', unit: '412' }],
      createdAt: new Date().toISOString(),
    },
  ]
  mergeAlertsIntoStore(demo)
}
