import { useMemo } from 'react'
import {
  VEHICLE_MAKE_OPTIONS,
  formatIntervalHuman,
} from '../../data/maintenanceScheduleData'
import { computeUnitDueSchedule } from '../../lib/maintenanceScheduleAlerts'
import { loadThresholds } from '../../lib/integrityThresholds'

type Props = {
  unitId: string
  vehicleMakeKey: string
  currentOdometer: number
}

export function WhatsDueSidebar({
  unitId,
  vehicleMakeKey,
  currentOdometer,
}: Props) {
  const fleetAvg = loadThresholds().fleet_avg_miles_per_month ?? 12000
  const snap = useMemo(
    () => computeUnitDueSchedule(unitId, vehicleMakeKey, currentOdometer),
    [unitId, vehicleMakeKey, currentOdometer],
  )

  const makeLabel =
    VEHICLE_MAKE_OPTIONS.find((m) => m.key === vehicleMakeKey)?.label ??
    vehicleMakeKey

  return (
    <aside className="whats-due" aria-label="What is due">
      <h4>What&apos;s due</h4>
      <p className="muted tiny">
        Schedule: <strong>{makeLabel}</strong> · Odo {currentOdometer.toLocaleString()} mi ·
        Fleet avg <strong>{fleetAvg.toLocaleString()} mi/mo</strong>
      </p>
      <ul className="whats-due__list">
        {snap.items.map((it) => (
          <li
            key={it.serviceKey}
            className={
              'whats-due__item' +
              (it.status === 'overdue'
                ? ' whats-due__item--overdue'
                : it.status === 'due_soon'
                  ? ' whats-due__item--soon'
                  : '')
            }
          >
            <div className="whats-due__title">{it.serviceLabel}</div>
            <div className="whats-due__interval muted tiny">
              {formatIntervalHuman(it.intervalMiles, fleetAvg)}
            </div>
            <div className="whats-due__meta tiny">
              Next ~{it.nextDueMiles.toLocaleString()} mi ·{' '}
              {it.milesRemaining >= 0
                ? `${it.milesRemaining.toLocaleString()} mi left`
                : `${Math.abs(it.milesRemaining).toLocaleString()} mi overdue`}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
