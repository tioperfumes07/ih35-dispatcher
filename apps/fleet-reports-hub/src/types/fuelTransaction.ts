/** Unified fuel-side accounting entry (bills / expenses / DEF). */
export type FuelTransactionType =
  | 'fuel-bill'
  | 'fuel-expense'
  | 'def-bill'
  | 'fuel-def-combined'

export const FUEL_TRANSACTION_TYPE_LABELS: Record<FuelTransactionType, string> = {
  'def-bill': 'DEF bill',
  'fuel-bill': 'Fuel bill',
  'fuel-expense': 'Fuel expense',
  'fuel-def-combined': 'Fuel/DEF combined',
}

export const FUEL_TRANSACTION_TYPE_OPTIONS: FuelTransactionType[] = [
  'def-bill',
  'fuel-bill',
  'fuel-expense',
  'fuel-def-combined',
]

/** All fuel entry types sorted A→Z by `FUEL_TRANSACTION_TYPE_LABELS` (menus + type selector). */
export function fuelTransactionTypesAlphabetical(): FuelTransactionType[] {
  return [...FUEL_TRANSACTION_TYPE_OPTIONS].sort((a, b) =>
    FUEL_TRANSACTION_TYPE_LABELS[a].localeCompare(FUEL_TRANSACTION_TYPE_LABELS[b]),
  )
}
