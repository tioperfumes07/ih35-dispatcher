import { getPool, dbQuery } from './db.mjs';

/** Seeded once; extend via POST /api/maintenance/service-types or SQL. */
export const MAINTENANCE_SERVICE_CATALOG_SEEDS = [
  'PM Service',
  'Oil Change',
  'Lubrication',
  'Air Dryer Cartridge',
  'Power Steering Service',
  'Differential Service',
  'Coolant Filter',
  'Air Filters',
  'Second Fuel Filter',
  'Valve Adjustment',
  'DPF Burn Check',
  'DPF Ash Clean',
  'Annual Inspection',
  'DOT inspection',
  'Brakes',
  'Tires',
  'Trailer PM',
  'Reefer PM',
  'Reefer Oil Service',
  'Reefer Fuel Filter',
  'Reefer Air Filter',
  'Wheel alignment',
  'A/C service',
  'Transmission service',
  'Coolant flush',
  'Suspension / shocks',
  'Lighting / electrical',
  'Windshield / glass',
  'Body / paint',
  'Reefer unit service',
  'Liftgate service',
  'Trailer service',
  'Repair',
  'Road service',
  'Tow',
  'Registration / permits',
  'Accident Report',
  'Out of service'
];

/**
 * Creates maintenance_service_catalog and inserts default rows (idempotent).
 * Safe when DATABASE_URL is unset (no-op).
 */
export async function ensureMaintenanceServiceCatalog() {
  const pool = getPool();
  if (!pool) return;
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS maintenance_service_catalog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT maintenance_service_catalog_name_key UNIQUE (name)
      )
    `);
    await dbQuery(`
      CREATE INDEX IF NOT EXISTS idx_maint_svc_cat_active
      ON maintenance_service_catalog (active, sort_order, name)
    `);
    let order = 0;
    for (const name of MAINTENANCE_SERVICE_CATALOG_SEEDS) {
      await dbQuery(
        `INSERT INTO maintenance_service_catalog (name, sort_order) VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING`,
        [name, order]
      );
      order += 1;
    }
  } catch (err) {
    console.error('[maintenance-catalog] ensure failed:', err?.message || err);
  }
}
