/** Local fallback when `/api/catalog/parts` is unavailable (dev / offline). */
import type { PartRefApiRow } from '../types/serviceCatalog'

export const PARTS_CATALOG_SEED: PartRefApiRow[] = [
  {
    category: 'engine',
    part_name: 'Oil filter (spin-on)',
    cost_low: 18,
    cost_mid: 22,
    cost_high: 28,
    notes: 'OEM spec',
  },
  {
    category: 'engine',
    part_name: 'Coolant (50/50 prediluted)',
    cost_low: 22,
    cost_mid: 26,
    cost_high: 32,
  },
  {
    category: 'brakes',
    part_name: 'Brake shoe kit — steer',
    cost_low: 210,
    cost_mid: 245,
    cost_high: 290,
  },
  {
    category: 'brakes',
    part_name: 'Drum — 16.5 in',
    cost_low: 380,
    cost_mid: 420,
    cost_high: 480,
  },
  {
    category: 'tires',
    part_name: 'Steer tire 295/75R22.5',
    cost_low: 420,
    cost_mid: 465,
    cost_high: 520,
  },
  {
    category: 'tires',
    part_name: 'Drive tire 11R22.5',
    cost_low: 360,
    cost_mid: 395,
    cost_high: 450,
  },
  {
    category: 'electrical',
    part_name: 'Battery group 31',
    cost_low: 140,
    cost_mid: 165,
    cost_high: 195,
  },
  {
    category: 'body',
    part_name: 'Marker lamp — LED',
    cost_low: 12,
    cost_mid: 16,
    cost_high: 22,
  },
]
