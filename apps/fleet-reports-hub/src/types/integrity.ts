export type IntegrityCategory =
  | 'tires'
  | 'drivers'
  | 'accidents'
  | 'fuel'
  | 'maintenance'
  | 'predictive'
  | 'all'

export type IntegrityCheckCode =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'D1'
  | 'D2'
  | 'D3'
  | 'D4'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'M1'
  | 'M2'
  | 'M3'
  | 'M4'
  | 'M5'
  | 'M6'
  | 'P1'

export type TriggeringRecord = {
  id: string
  label: string
  date?: string
  amount?: number
  unit?: string
  driver?: string
  detail?: string
}

export type IntegrityAlert = {
  id: string
  checkCode: IntegrityCheckCode
  category: Exclude<IntegrityCategory, 'all'>
  severity: 'amber' | 'red'
  title: string
  message: string
  entityType?: string
  entityId?: string
  triggeringRecords: TriggeringRecord[]
  reviewedAt?: string
  reviewedBy?: string
  sourceSaveType?: string
  sourceSaveId?: string
  createdAt: string
}

export type IntegrityCheckRequest = {
  saveType:
    | 'repair_work_order'
    | 'accident_work_order'
    | 'maintenance_expense'
    | 'maintenance_bill'
    | 'fuel_transaction'
    | 'generic'
  saveId?: string
  payload: Record<string, unknown>
}

export type IntegrityCheckResponse = {
  alerts: IntegrityAlert[]
}
