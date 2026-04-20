import { getPool, dbQuery } from './db.mjs';

/**
 * Ensures Postgres objects used by dedupe merge, name management, scheduled reports,
 * and optional support tables exist. Safe on every boot (CREATE IF NOT EXISTS only).
 * Does not alter or drop existing tables.
 *
 * Mirrors migrations 012–014 where those files were never applied.
 */

/** Tables created by this module (for `/api/health/db` and ops checks). */
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

function stripLeadingComments(sql) {
  let s = String(sql || '').trim();
  while (s.startsWith('--')) {
    const nl = s.indexOf('\n');
    if (nl === -1) return '';
    s = s.slice(nl + 1).trim();
  }
  return s;
}

const DDL = [
  `-- 001_init.sql (minimal) — lets npm run db:migrate record rows even if 001 was never applied
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,

  `-- 012_qbo_dedupe_merge_log.sql
CREATE TABLE IF NOT EXISTS merge_log (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_merge_log_merged_at ON merge_log (merged_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_merge_log_type_status ON merge_log (merge_type, status)`,

  `CREATE TABLE IF NOT EXISTS dedup_skipped (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('vendor', 'customer')),
  qbo_id_a TEXT NOT NULL,
  qbo_id_b TEXT NOT NULL,
  skipped_by TEXT,
  skipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  group_signature TEXT NOT NULL
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dedup_skipped_unique_group ON dedup_skipped (record_type, group_signature)`,

  `-- 013_name_management.sql
CREATE TABLE IF NOT EXISTS rename_log (
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
)`,
  `CREATE INDEX IF NOT EXISTS idx_rename_log_renamed_at ON rename_log (renamed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_rename_log_type ON rename_log (record_type)`,

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
)`,

  `CREATE TABLE IF NOT EXISTS canonical_names (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  erp_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE (record_type, erp_id)
)`,

  `-- 014_report_schedules.sql
CREATE TABLE IF NOT EXISTS erp_report_schedules (
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
)`,
  `CREATE TABLE IF NOT EXISTS erp_report_schedule_runs (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES erp_report_schedules (id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  row_count INT,
  message TEXT,
  report_path TEXT,
  payload_summary JSONB
)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_report_schedules_next ON erp_report_schedules (next_run_at)
  WHERE enabled = true`,
  `CREATE INDEX IF NOT EXISTS idx_erp_report_schedule_runs_sched ON erp_report_schedule_runs (schedule_id, ran_at DESC)`,

  `-- Optional PG mirror for integrity (ERP file remains source of truth for the app today)
CREATE TABLE IF NOT EXISTS integrity_alerts (
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
)`,

  `-- Legacy / alternate scheduled report mailbox (not erp_report_schedules)
CREATE TABLE IF NOT EXISTS scheduled_reports (
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
)`,

  `CREATE TABLE IF NOT EXISTS company_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,

  `-- 015_fleet_intervals_and_settings.sql (structural tables only; full seed data via npm run db:migrate)
CREATE TABLE IF NOT EXISTS erp_fleet_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  fleet_avg_miles_per_month INT NOT NULL DEFAULT 12000
    CHECK (fleet_avg_miles_per_month >= 1000 AND fleet_avg_miles_per_month <= 30000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT erp_fleet_defaults_singleton CHECK (id = 1)
)`,
  `INSERT INTO erp_fleet_defaults (id, fleet_avg_miles_per_month) VALUES (1, 12000)
   ON CONFLICT (id) DO NOTHING`,

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
)`,

  `CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES service_types (id) ON DELETE CASCADE,
  unit_code TEXT,
  interval_miles INT,
  interval_months INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_maint_sched_type_unit
   ON vehicle_maintenance_schedules (service_type_id, (COALESCE(unit_code, '')))`,

  `CREATE TABLE IF NOT EXISTS vehicle_parts_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_mid NUMERIC(12, 2)
)`
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
      console.log('[db] fleet catalog: seeded minimal service_types + fleet-wide schedules (empty DB).');
    }
    const pr = await dbQuery('SELECT COUNT(*)::int AS c FROM vehicle_parts_reference');
    if ((pr.rows[0]?.c ?? 0) === 0) {
      await dbQuery(`INSERT INTO vehicle_parts_reference (part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid) VALUES
        ('drive_tire', 'Drive tires (set)', 150000, 12, 450.00),
        ('engine_oil_service', 'Engine oil service', 25000, 2, 350.00)
      ON CONFLICT (part_key) DO NOTHING`);
      console.log('[db] fleet catalog: seeded minimal vehicle_parts_reference (empty DB).');
    }
  } catch (err) {
    console.error('[db] fleet catalog bootstrap:', err?.message || err);
  }
}

export async function ensureAppDatabaseObjects() {
  if (!getPool()) {
    console.log('[db] ensure app objects skipped (no DATABASE_URL)');
    return;
  }

  console.log('[db] Ensuring merge_log, dedupe, rename, fleet catalog, report schedules, and support tables…');
  for (const sql of DDL) {
    const trimmed = stripLeadingComments(sql);
    if (!trimmed) continue;
    try {
      await dbQuery(trimmed);
    } catch (err) {
      console.error('[db] ensure failed:', err?.message || err);
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
      console.error('[db] company_settings seed:', key, err?.message || err);
    }
  }

  await bootstrapFleetCatalogSamples();

  try {
    const { rows } = await dbQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [DEDUPE_SUPPORT_TABLE_NAMES]
    );
    const have = new Set((rows || []).map(r => r.table_name));
    const missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have.has(n));
    if (missing.length) {
      console.error(
        '[db] CRITICAL: after CREATE IF NOT EXISTS, these support tables are still missing:',
        missing.join(', '),
        '— review earlier [db] ensure failed: lines.'
      );
    }
  } catch (e) {
    console.error('[db] post-ensure table verification failed:', e?.message || e);
  }

  console.log('[db] merge_log / dedup / rename / fleet catalog / schedules / company_settings ready (IF NOT EXISTS).');
}

/** Alias for server boot / docs — delegates to `ensureAppDatabaseObjects`. */
export async function initializeDatabase() {
  return ensureAppDatabaseObjects();
}
