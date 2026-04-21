/** Shared maintenance / WO shapes — all include driver; accident WO requires driver. */

export type WorkOrderBase = {
  unitId: string
  driverId: string
  driverName: string
  description: string
  estimatedCost: number
}

export type RepairWorkOrder = WorkOrderBase & {
  type: 'repair'
  serviceType: string
}

export type AccidentWorkOrder = WorkOrderBase & {
  type: 'accident'
  /** Required for accident work orders */
  driverId: string
  driverName: string
  claimNumber?: string
}

export type MaintenanceExpense = {
  unitId: string
  driverId: string
  driverName: string
  category: string
  amount: number
  expenseDate: string
  vendor?: string
}

export type MaintenanceBill = {
  unitId: string
  driverId: string
  driverName: string
  billNumber: string
  amount: number
  billDate: string
  vendor?: string
}
