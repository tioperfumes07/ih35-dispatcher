/** Demo seed rows for Lists & catalogs — operational status + fleet writes (local state only). */

export type OperationalStatusRow = {
  id: string
  label: string
  color: string
  description: string
  status: string
  sort: string
}

export type FleetWriteRow = {
  id: string
  unit: string
  writeType: string
  value: string
  lastWritten: string
  status: string
}

export const INITIAL_OPERATIONAL_STATUS_ROWS: OperationalStatusRow[] = [
  {
    id: '1',
    label: 'Active',
    color: 'var(--ok)',
    description: 'Unit in revenue service',
    status: 'active',
    sort: '10',
  },
  {
    id: '3',
    label: 'Hold',
    color: 'var(--muted)',
    description: 'Administrative hold',
    status: 'inactive',
    sort: '30',
  },
  {
    id: '2',
    label: 'Shop',
    color: 'var(--warn)',
    description: 'In maintenance bay',
    status: 'active',
    sort: '20',
  },
]

export const INITIAL_FLEET_WRITE_ROWS: FleetWriteRow[] = [
  {
    id: 'w2',
    unit: 'T118',
    writeType: 'Engine hours',
    value: '12,400',
    lastWritten: '2026-04-18',
    status: 'active',
  },
  {
    id: 'w1',
    unit: 'T120',
    writeType: 'Odometer',
    value: '402,110',
    lastWritten: '2026-04-19',
    status: 'active',
  },
]
