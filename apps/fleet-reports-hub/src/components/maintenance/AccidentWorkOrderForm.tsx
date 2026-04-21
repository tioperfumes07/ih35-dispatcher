import type { IntegrityAlert } from '../../types/integrity'
import { RepairWorkOrderForm } from './RepairWorkOrderForm'

type Props = {
  onIntegrityBatch: (alerts: IntegrityAlert[]) => void
}

/** Accident records use the shared work order shell and accident integrity save type. */
export function AccidentWorkOrderForm({ onIntegrityBatch }: Props) {
  return (
    <RepairWorkOrderForm
      onIntegrityBatch={onIntegrityBatch}
      initialUnitId="204"
      initialDescription="Rear corner impact — guard damage"
      initialEstimatedCost="12000"
      integritySaveType="accident_work_order"
    />
  )
}
