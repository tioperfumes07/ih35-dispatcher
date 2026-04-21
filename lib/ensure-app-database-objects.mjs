import { getPool, dbQuery } from './db.mjs';
import { ensureMaintenanceServiceCatalog } from './maintenance-service-catalog.mjs';

/**
 * Ensures Postgres objects used by dedupe merge, name management, scheduled reports,
 * fleet catalog, research reference tables, and TMS-adjacent support tables.
 * Safe on every boot (CREATE IF NOT EXISTS only). Does not drop tables.
 *
 * Mirrors migrations 001–018 when `npm run db:migrate` was never applied.
 */

/** Tables required for dedupe merge, rename tools, integrity, fleet samples, and company print settings. */
export const DEDUPE_SUPPORT_TABLE_NAMES = [
  'merge_log',
  'dedup_skipped',
  'rename_log',
  'driver_system_links',
  'canonical_names',
  'integrity_alerts',
  'vehicle_maintenance_schedules',
  'vehicle_parts_reference',
  'scheduled_reports',
  'company_settings'
];

export const APP_SUPPORT_TABLE_NAMES = [
  'schema_migrations',
  'merge_log',
  'dedup_skipped',
  'rename_log',
  'driver_system_links',
  'canonical_names',
  'erp_report_schedules',
  'erp_report_schedule_runs',
  'integrity_alerts',
  'scheduled_reports',
  'company_settings',
  'erp_fleet_defaults',
  'service_types',
  'vehicle_maintenance_schedules',
  'vehicle_parts_reference'
];

/** Full set verified after bootstrap (Step 4 + Step 6 extras). */
export const VERIFY_TABLE_LIST = [
  ...DEDUPE_SUPPORT_TABLE_NAMES,
  'schema_migrations',
  'erp_report_schedules',
  'erp_report_schedule_runs',
  'erp_fleet_defaults',
  'service_types',
  'maintenance_service_catalog',
  'research_oem_vehicle_schedules',
  'research_vehicle_parts_benchmark',
  'research_company_custom_parts'
];

/**
 * @typedef {{ table: string, creates: string[], indexes?: string[] }} BootChunk
 */

/** @type {BootChunk[]} */
const BOOT_TABLES = [
  {
    table: 'schema_migrations',
    creates: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'merge_log',
    creates: [
      `CREATE TABLE IF NOT EXISTS merge_log (
  id BIGSERIAL PRIMARY KEY,
  merge_type TEXT NOT NULL CHECK (merge_type IN ('vendor', 'customer')),
  kept_qbo_id TEXT NOT NULL,
  kept_name TEXT NOT NULL,
  merged_qbo_id TEXT NOT NULL,
  merged_name TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transactions_transferred INTEGER NOT NULL DEFAULT 0,
  erp_records_updated INTEGER NOT NULL DEFAULT 0,
  qbo_api_responses JSONB,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_error', 'failed')),
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_merge_log_merged_at ON merge_log (merged_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_merge_log_type_status ON merge_log (merge_type, status)`
    ]
  },
  {
    table: 'dedup_skipped',
    creates: [
      `CREATE TABLE IF NOT EXISTS dedup_skipped (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('vendor', 'customer')),
  qbo_id_a TEXT NOT NULL,
  qbo_id_b TEXT NOT NULL,
  skipped_by TEXT,
  skipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  group_signature TEXT NOT NULL
)`
    ],
    indexes: [
      `CREATE UNIQUE INDEX IF NOT EXISTS dedup_skipped_unique_group ON dedup_skipped (record_type, group_signature)`
    ]
  },
  {
    table: 'rename_log',
    creates: [
      `CREATE TABLE IF NOT EXISTS rename_log (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('vendor', 'driver', 'customer')),
  erp_id TEXT,
  qbo_id TEXT,
  samsara_id TEXT,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  update_qbo_requested BOOLEAN NOT NULL DEFAULT false,
  update_samsara_requested BOOLEAN NOT NULL DEFAULT false,
  update_erp_requested BOOLEAN NOT NULL DEFAULT false,
  qbo_updated BOOLEAN NOT NULL DEFAULT false,
  qbo_error TEXT,
  samsara_updated BOOLEAN NOT NULL DEFAULT false,
  samsara_error TEXT,
  erp_records_updated INTEGER NOT NULL DEFAULT 0,
  erp_error TEXT,
  renamed_by TEXT NOT NULL,
  renamed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  systems_attempted JSONB,
  systems_succeeded JSONB,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_rename_log_renamed_at ON rename_log (renamed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_rename_log_type ON rename_log (record_type)`
    ]
  },
  {
    table: 'driver_system_links',
    creates: [
      `CREATE TABLE IF NOT EXISTS driver_system_links (
  id BIGSERIAL PRIMARY KEY,
  erp_driver_id TEXT NOT NULL UNIQUE,
  samsara_driver_id TEXT,
  qbo_vendor_id TEXT,
  qbo_employee_id TEXT,
  link_confidence TEXT NOT NULL DEFAULT 'manual' CHECK (link_confidence IN ('auto', 'manual', 'confirmed')),
  auto_match_score NUMERIC(6, 3),
  linked_by TEXT,
  linked_at TIMESTAMPTZ,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'canonical_names',
    creates: [
      `CREATE TABLE IF NOT EXISTS canonical_names (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  erp_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE (record_type, erp_id)
)`
    ]
  },
  {
    table: 'erp_report_schedules',
    creates: [
      `CREATE TABLE IF NOT EXISTS erp_report_schedules (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  report_path TEXT NOT NULL,
  interval_minutes INT NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 5 AND interval_minutes <= 10080),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_ok BOOLEAN,
  last_row_count INT,
  last_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_erp_report_schedules_next ON erp_report_schedules (next_run_at)
  WHERE enabled = true`
    ]
  },
  {
    table: 'erp_report_schedule_runs',
    creates: [
      `CREATE TABLE IF NOT EXISTS erp_report_schedule_runs (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES erp_report_schedules (id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  row_count INT,
  message TEXT,
  report_path TEXT,
  payload_summary JSONB
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_erp_report_schedule_runs_sched ON erp_report_schedule_runs (schedule_id, ran_at DESC)`
    ]
  },
  {
    table: 'integrity_alerts',
    creates: [
      `CREATE TABLE IF NOT EXISTS integrity_alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'AMBER',
  message TEXT NOT NULL,
  details TEXT,
  triggered_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  unit_id TEXT,
  driver_id TEXT,
  record_id TEXT,
  record_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'scheduled_reports',
    creates: [
      `CREATE TABLE IF NOT EXISTS scheduled_reports (
  id BIGSERIAL PRIMARY KEY,
  report_name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  frequency TEXT NOT NULL,
  delivery_time TEXT,
  day_of_week INTEGER,
  day_of_month INTEGER,
  export_format TEXT NOT NULL DEFAULT 'excel',
  recipients TEXT,
  subject_line TEXT,
  filters_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'company_settings',
    creates: [
      `CREATE TABLE IF NOT EXISTS company_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'erp_fleet_defaults',
    creates: [
      `CREATE TABLE IF NOT EXISTS erp_fleet_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  fleet_avg_miles_per_month INT NOT NULL DEFAULT 12000
    CHECK (fleet_avg_miles_per_month >= 1000 AND fleet_avg_miles_per_month <= 30000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT erp_fleet_defaults_singleton CHECK (id = 1)
)`,
      `INSERT INTO erp_fleet_defaults (id, fleet_avg_miles_per_month) VALUES (1, 12000)
   ON CONFLICT (id) DO NOTHING`
    ]
  },
  {
    table: 'service_types',
    creates: [
      `CREATE TABLE IF NOT EXISTS service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  interval_miles INT,
  interval_months INT,
  notes TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'vehicle_maintenance_schedules',
    creates: [
      `CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES service_types (id) ON DELETE CASCADE,
  unit_code TEXT,
  interval_miles INT,
  interval_months INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ],
    indexes: [
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_maint_sched_type_unit
   ON vehicle_maintenance_schedules (service_type_id, (COALESCE(unit_code, '')))`
    ]
  },
  {
    table: 'vehicle_parts_reference',
    creates: [
      `CREATE TABLE IF NOT EXISTS vehicle_parts_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_low NUMERIC(12, 2),
  avg_cost_high NUMERIC(12, 2),
  avg_cost_mid NUMERIC(12, 2),
  notes TEXT,
  source TEXT,
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  },
  {
    table: 'maintenance_service_catalog',
    creates: [
      `CREATE TABLE IF NOT EXISTS maintenance_service_catalog (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT maintenance_service_catalog_name_key UNIQUE (name)
      )`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_maint_svc_cat_active
      ON maintenance_service_catalog (active, sort_order, name)`
    ]
  }
];

/** Research / intel tables used by `lib/maintenance-research.mjs` (Step 6). */
const RESEARCH_TABLES = [
  {
    table: 'research_oem_vehicle_schedules',
    creates: [
      `CREATE TABLE IF NOT EXISTS research_oem_vehicle_schedules (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_from INT NOT NULL,
  year_to INT NOT NULL,
  engine_family TEXT,
  service_type TEXT NOT NULL,
  interval_miles INT,
  interval_months INT,
  interval_engine_hours INT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'OEM / fleet intelligence reference',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_research_oem_sched_lookup
  ON research_oem_vehicle_schedules (lower(make), lower(model), year_from, year_to)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_research_oem_service
  ON research_oem_vehicle_schedules (make, model, year_from, year_to, service_type)`
    ]
  },
  {
    table: 'research_vehicle_parts_benchmark',
    creates: [
      `CREATE TABLE IF NOT EXISTS research_vehicle_parts_benchmark (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL DEFAULT 'ALL',
  model TEXT NOT NULL DEFAULT 'ALL',
  year_from INT NOT NULL DEFAULT 2000,
  year_to INT NOT NULL DEFAULT 2026,
  part_category TEXT NOT NULL,
  part_name TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_low NUMERIC(12, 2),
  avg_cost_high NUMERIC(12, 2),
  avg_cost_mid NUMERIC(12, 2),
  notes TEXT,
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE
)`
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_research_parts_lookup
  ON research_vehicle_parts_benchmark (lower(make), lower(model))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_research_parts_row
  ON research_vehicle_parts_benchmark (make, model, year_from, year_to, part_name)`
    ]
  },
  {
    table: 'research_company_custom_parts',
    creates: [
      `CREATE TABLE IF NOT EXISTS research_company_custom_parts (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL DEFAULT 'ALL',
  model TEXT NOT NULL DEFAULT 'ALL',
  part_name TEXT NOT NULL,
  avg_life_miles INT,
  avg_life_months INT,
  cost_low NUMERIC(12, 2),
  cost_high NUMERIC(12, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
    ]
  }
];

/** Older DBs created before extra columns on `vehicle_parts_reference`. */
const LEGACY_ALTER_STATEMENTS = [
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS avg_cost_low NUMERIC(12, 2)`,
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS avg_cost_high NUMERIC(12, 2)`,
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ`,
  `ALTER TABLE vehicle_parts_reference ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
];

const COMPANY_SETTINGS_SEED = [
  ['company_name', 'IH 35 Transportation LLC'],
  ['city_state', 'Laredo, TX'],
  ['fleet_avg_miles_per_month', '12000'],
  ['pm_interval_miles', '25000'],
  ['usdot_number', ''],
  ['mc_number', ''],
  ['phone', ''],
  ['address', '']
];

async function runBootChunk(chunk) {
  const { table, creates = [], indexes = [] } = chunk;
  let createOk = true;
  for (const sql of creates) {
    try {
      await dbQuery(sql);
    } catch (err) {
      console.error(`[DB] Table failed: ${table}`, err?.message || err);
      createOk = false;
      break;
    }
  }
  if (createOk) {
    console.log(`[DB] Table ready: ${table}`);
  }
  for (const sql of indexes || []) {
    try {
      await dbQuery(sql);
    } catch (err) {
      console.error(`[DB] Index failed (${table})`, err?.message || err);
    }
  }
}

/** When migrations were never applied, interval tables exist but are empty — add a tiny safe sample. */
async function bootstrapFleetCatalogSamples() {
  try {
    const st = await dbQuery('SELECT COUNT(*)::int AS c FROM service_types');
    if ((st.rows[0]?.c ?? 0) === 0) {
      await dbQuery(`INSERT INTO service_types (slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model) VALUES
        ('engine_oil_filter_change', 'Engine oil and filter change', 'Engine', 25000, 2, 'Auto-seeded on first boot (run npm run db:migrate for full catalog).', NULL, NULL),
        ('fuel_filter_primary', 'Fuel filter replacement (primary)', 'Engine', 25000, 2, NULL, NULL, NULL),
        ('brake_adjustment_all_axles', 'Brake adjustment (all axles)', 'Brakes', 25000, 2, NULL, NULL, NULL)
      ON CONFLICT (slug) DO NOTHING`);
      await dbQuery(`
        INSERT INTO vehicle_maintenance_schedules (service_type_id, unit_code, interval_miles, interval_months)
        SELECT st.id, NULL, st.interval_miles, st.interval_months
        FROM service_types st
        WHERE st.slug IN ('engine_oil_filter_change', 'fuel_filter_primary', 'brake_adjustment_all_axles')
          AND NOT EXISTS (
            SELECT 1 FROM vehicle_maintenance_schedules v
            WHERE v.service_type_id = st.id AND COALESCE(v.unit_code, '') = ''
          )`);
      console.log('[DB] fleet catalog: seeded minimal service_types + fleet-wide schedules (empty DB).');
    }
    const pr = await dbQuery('SELECT COUNT(*)::int AS c FROM vehicle_parts_reference');
    if ((pr.rows[0]?.c ?? 0) === 0) {
      await dbQuery(`INSERT INTO vehicle_parts_reference (part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid) VALUES
        ('drive_tire', 'Drive tires (set)', 150000, 12, 450.00),
        ('engine_oil_service', 'Engine oil service', 25000, 2, 350.00)
      ON CONFLICT (part_key) DO NOTHING`);
      console.log('[DB] fleet catalog: seeded minimal vehicle_parts_reference (empty DB).');
    }
  } catch (err) {
    console.error('[DB] fleet catalog bootstrap:', err?.message || err);
  }
}

async function verifyTablesPresent() {
  try {
    const { rows } = await dbQuery(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [VERIFY_TABLE_LIST]
    );
    const have = new Set((rows || []).map(r => r.table_name));
    const missing = VERIFY_TABLE_LIST.filter(n => !have.has(n));
    console.log(
      `[DB] Verification: ${have.size}/${VERIFY_TABLE_LIST.length} expected tables present in public schema.`
    );
    if (missing.length) {
      console.error('[DB] Missing tables:', missing.join(', '));
    }
    return { have, missing };
  } catch (e) {
    console.error('[DB] Verification query failed:', e?.message || e);
    return { have: new Set(), missing: VERIFY_TABLE_LIST };
  }
}

/**
 * Creates application tables (IF NOT EXISTS), seeds company defaults, fleet samples,
 * and maintenance service catalog rows. Logs `[DB] Table ready: …` per logical table.
 */
export async function initializeDatabase() {
  if (!getPool()) {
    console.log('[DB] initializeDatabase skipped (no DATABASE_URL)');
    return;
  }

  console.log('[DB] Initializing application tables (CREATE IF NOT EXISTS)…');

  for (const chunk of BOOT_TABLES) {
    await runBootChunk(chunk);
  }
  for (const chunk of RESEARCH_TABLES) {
    await runBootChunk(chunk);
  }

  for (const sql of LEGACY_ALTER_STATEMENTS) {
    try {
      await dbQuery(sql);
    } catch (err) {
      console.error('[DB] Legacy ALTER failed:', err?.message || err);
    }
  }

  for (const [key, value] of COMPANY_SETTINGS_SEED) {
    try {
      await dbQuery(
        `INSERT INTO company_settings (setting_key, setting_value) VALUES ($1, $2)
         ON CONFLICT (setting_key) DO NOTHING`,
        [key, value]
      );
    } catch (err) {
      console.error('[DB] company_settings seed row failed:', key, err?.message || err);
    }
  }
  console.log('[DB] company_settings defaults applied (ON CONFLICT DO NOTHING).');

  await bootstrapFleetCatalogSamples();

  await ensureMaintenanceServiceCatalog();

  const { missing } = await verifyTablesPresent();
  if (missing.length) {
    console.error('[DB] CRITICAL: expected tables still missing after init —', missing.join(', '));
  }

  console.log('[DB] initializeDatabase finished.');
}

/** Backward-compatible name for migrations / scripts. */
export async function ensureAppDatabaseObjects() {
  return initializeDatabase();
}
