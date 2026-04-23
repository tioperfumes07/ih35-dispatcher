import { useMemo } from 'react'
import type { ServiceTypeRow } from '../../types/serviceCatalog'
import { computeUnitDueSchedule } from '../../lib/maintenanceScheduleAlerts'
import { PositionMapSvg } from './PositionMapSvg'
import { formatServiceCostLine, formatServiceSubtitle } from './ServiceTypePicker'

type Props = {
  service: ServiceTypeRow | null
  unitId: string
  vehicleMakeKey: string
  currentOdometer: number
}

export function ServiceWorkOrderInfoPanel({
  service,
  unitId,
  vehicleMakeKey,
  currentOdometer,
}: Props) {
  const due = useMemo(() => {
    if (!service?.interval_miles) return null
    const snap = computeUnitDueSchedule(unitId, vehicleMakeKey, currentOdometer)
    return snap.items.find((i) => i.serviceKey === service.service_key) ?? null
  }, [service, unitId, vehicleMakeKey, currentOdometer])

  if (!service) {
    return <p className="muted small">Select a service type to see interval, cost, and due status.</p>
  }

  const dueLabel =
    due == null
      ? 'Not on fleet PM mileage schedule for this unit (repair / non-PM line).'
      : due.status === 'overdue'
        ? `Overdue — next ~${due.nextDueMiles.toLocaleString()} mi (${Math.abs(due.milesRemaining).toLocaleString()} mi past)`
        : due.status === 'due_soon'
          ? `Due soon — ${due.milesRemaining.toLocaleString()} mi remaining`
          : `OK — ${due.milesRemaining.toLocaleString()} mi remaining`

  return (
    <div className="svc-wo-info">
      <h4 className="svc-wo-info__h">Service details</h4>
      <dl className="svc-wo-info__dl">
        <div>
          <dt>Interval</dt>
          <dd>{formatServiceSubtitle(service)}</dd>
        </div>
        <div>
          <dt>Cost band (avg)</dt>
          <dd>{formatServiceCostLine(service)}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd>{service.notes || '—'}</dd>
        </div>
        <div>
          <dt>Due (this unit)</dt>
          <dd>{dueLabel}</dd>
        </div>
      </dl>
      {service.uses_position_map ? (
        <div className="svc-wo-info__map">
          <h4 className="svc-wo-info__h">Position map</h4>
          <PositionMapSvg positionMapType={service.position_map_type} />
        </div>
      ) : null}
    </div>
  )
}
