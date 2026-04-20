import { getPool, dbQuery } from './db.mjs';

/**
 * Ensures Postgres objects used by dedupe merge, name management, scheduled reports,
 * and optional support tables exist. Safe on every boot (CREATE IF NOT EXISTS only).
 * Does not alter or drop existing tables.
 *
 * Mirrors migrations 012–014 where those files were never applied.
 */

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

export async function ensureAppDatabaseObjects() {
  if (!getPool()) {
    console.log('[db] ensure app objects skipped (no DATABASE_URL)');
    return;
  }

  console.log('[db] Ensuring merge_log, dedupe, rename, report schedule, and support tables…');
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

  console.log('[db] merge_log / dedup / rename / schedules / company_settings ready (IF NOT EXISTS).');
}
