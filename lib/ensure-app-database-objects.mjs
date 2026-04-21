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

/** Fleet sample tables: nice-to-have; failures must not block QBO merge or server boot. */
const FLEET_CATALOG_TABLE_NAMES = new Set(['vehicle_maintenance_schedules', 'vehicle_parts_reference']);

async function assertTablesPresent(tableNames, label) {
  const { rows } = await dbQuery(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames]
  );
  const have = new Set((rows || []).map(r => r.table_name));
  const missing = tableNames.filter(n => !have.has(n));
  if (missing.length) {
    throw new Error(`[db] ${label} tables missing after DDL: ${missing.join(', ')}`);
  }
}

async function assertMergeAuditRegclass() {
  const { rows } = await dbQuery(
    `SELECT to_regclass('public.merge_log') AS merge_log, to_regclass('public.dedup_skipped') AS dedup_skipped`
  );
  const r = rows?.[0];
  if (!r?.merge_log) throw new Error('[db] public.merge_log missing after DDL (to_regclass)');
  if (!r?.dedup_skipped) throw new Error('[db] public.dedup_skipped missing after DDL (to_regclass)');
}

/**
 * Merge audit + skip list only — must succeed before any QBO merge INSERT.
 * Kept separate so a failure in rename/integrity DDL can never block these tables.
 * Uses public.* and IF NOT EXISTS only (never drops or alters existing tables).
 * `group_signature` is required by routes/dedupe.mjs (skip + ON CONFLICT).
 */
async function ensureMergeAuditTables() {
  const blocks = [
    {
      name: 'merge_log',
      sqls: [
        `CREATE TABLE IF NOT EXISTS public.merge_log (
  id SERIAL PRIMARY KEY,
  merge_type TEXT NOT NULL,
  kept_qbo_id TEXT,
  kept_name TEXT,
  merged_qbo_id TEXT,
  merged_name TEXT,
  merged_by TEXT,
  merged_at TIMESTAMP DEFAULT NOW(),
  transactions_transferred INTEGER DEFAULT 0,
  erp_records_updated INTEGER DEFAULT 0,
  qbo_api_responses TEXT,
  status TEXT DEFAULT 'success',
  error_details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)`,
        `CREATE INDEX IF NOT EXISTS idx_merge_log_merged_at ON public.merge_log (merged_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_merge_log_type_status ON public.merge_log (merge_type, status)`
      ]
    },
    {
      name: 'dedup_skipped',
      sqls: [
        `CREATE TABLE IF NOT EXISTS public.dedup_skipped (
  id SERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  qbo_id_a TEXT NOT NULL,
  qbo_id_b TEXT NOT NULL,
  skipped_by TEXT,
  skipped_at TIMESTAMP DEFAULT NOW(),
  reason TEXT,
  group_signature TEXT NOT NULL
)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS dedup_skipped_unique_group ON public.dedup_skipped (record_type, group_signature)`
      ]
    }
  ];
  for (const b of blocks) {
    for (const sql of b.sqls) {
      await dbQuery(sql);
    }
    console.log('[DB] Table ready:', b.name);
  }
  await assertTablesPresent(['merge_log', 'dedup_skipped'], 'Merge audit / dedupe skip');
  await assertMergeAuditRegclass();
}

/**
 * Remaining core support DDL (rename, links, integrity, schedules, migrations).
 * Applied best-effort per statement so one failure does not roll back merge_log (already committed).
 */
const OTHER_CORE_DEDUPE_DDL = [
  `-- 013_name_management.sql
CREATE TABLE IF NOT EXISTS public.rename_log (
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
  `CREATE INDEX IF NOT EXISTS idx_rename_log_renamed_at ON public.rename_log (renamed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_rename_log_type ON public.rename_log (record_type)`,

  `CREATE TABLE IF NOT EXISTS public.driver_system_links (
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

  `CREATE TABLE IF NOT EXISTS public.canonical_names (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  erp_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE (record_type, erp_id)
)`,

  `-- Optional PG mirror for integrity (ERP file remains source of truth for the app today)
CREATE TABLE IF NOT EXISTS public.integrity_alerts (
  id BIGSERIAL PRIMARY KEY,
  erp_alert_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'AMBER',
  message TEXT NOT NULL,
  details TEXT,
  details_json JSONB,
  triggered_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  unit_id TEXT,
  driver_id TEXT,
  record_id TEXT,
  record_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  dedupe_key TEXT,
  category TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_alerts_erp_alert_id ON public.integrity_alerts (erp_alert_id)`,

  `-- Legacy / alternate scheduled report mailbox (not erp_report_schedules)
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
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

  `CREATE TABLE IF NOT EXISTS public.company_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,

  `-- 001_init.sql (minimal) — lets npm run db:migrate record rows even if 001 was never applied
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`
];

/** Depends on pgcrypto (`gen_random_uuid`); failures are isolated so QBO merge still works. */
const FLEET_CATALOG_DDL = [
  `CREATE TABLE IF NOT EXISTS public.service_types (
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

  `CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES public.service_types (id) ON DELETE CASCADE,
  unit_code TEXT,
  interval_miles INT,
  interval_months INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_maint_sched_type_unit
   ON public.vehicle_maintenance_schedules (service_type_id, (COALESCE(unit_code, '')))`,

  `CREATE TABLE IF NOT EXISTS public.vehicle_parts_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_mid NUMERIC(12, 2)
)`
];

/** Nice-to-have; failures are logged only — never blocks merge_log / dedupe tables. */
const OPTIONAL_DDL = [
  `-- 014_report_schedules.sql
CREATE TABLE IF NOT EXISTS public.erp_report_schedules (
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
  `CREATE TABLE IF NOT EXISTS public.erp_report_schedule_runs (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES public.erp_report_schedules (id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  row_count INT,
  message TEXT,
  report_path TEXT,
  payload_summary JSONB
)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_report_schedules_next ON public.erp_report_schedules (next_run_at)
  WHERE enabled = true`,
  `CREATE INDEX IF NOT EXISTS idx_erp_report_schedule_runs_sched ON public.erp_report_schedule_runs (schedule_id, ran_at DESC)`,

  `-- 015_fleet_intervals singleton (separate from the ten dedupe/support tables)
CREATE TABLE IF NOT EXISTS public.erp_fleet_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  fleet_avg_miles_per_month INT NOT NULL DEFAULT 12000
    CHECK (fleet_avg_miles_per_month >= 1000 AND fleet_avg_miles_per_month <= 30000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT erp_fleet_defaults_singleton CHECK (id = 1)
)`,
  `INSERT INTO public.erp_fleet_defaults (id, fleet_avg_miles_per_month) VALUES (1, 12000)
   ON CONFLICT (id) DO NOTHING`
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

async function seedDefaultSettings() {
  for (const [key, value] of COMPANY_SETTINGS_SEED) {
    await dbQuery(
      `INSERT INTO public.company_settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO NOTHING`,
      [key, value]
    );
  }
}

async function runFleetCatalogDdlSafe() {
  try {
    await dbQuery('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (err) {
    console.error('[db] CREATE EXTENSION pgcrypto:', err?.message || err);
  }
  for (const sql of FLEET_CATALOG_DDL) {
    const trimmed = stripLeadingComments(sql);
    if (!trimmed) continue;
    try {
      await dbQuery(trimmed);
      const m = trimmed.match(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/i);
      if (m) console.log('[DB] Table ready:', m[1]);
    } catch (err) {
      console.error('[db] fleet catalog DDL failed:', err?.message || err);
    }
  }
}

/**
 * Creates merge_log, dedup_skipped, rename, links, canonical names, integrity, scheduled_reports,
 * company_settings, and schema_migrations. Safe to call before every merge/skip write (IF NOT EXISTS only).
 */
export async function ensureDedupeWritePathObjects() {
  if (!getPool()) {
    console.warn(
      '[DB] DATABASE_URL is not set — merge_log / dedup_skipped cannot be created until Postgres is configured.'
    );
    return;
  }
  await ensureMergeAuditTables();

  for (const sql of OTHER_CORE_DEDUPE_DDL) {
    const trimmed = stripLeadingComments(sql);
    if (!trimmed) continue;
    try {
      await dbQuery(trimmed);
      const m = trimmed.match(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/i);
      if (m) console.log('[DB] Table ready:', m[1]);
    } catch (err) {
      console.error('[db] non-fatal support DDL:', err?.message || err);
    }
  }

  try {
    await seedDefaultSettings();
  } catch (err) {
    console.error('[db] company_settings seed:', err?.message || err);
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

  console.log('[db] Ensuring required tables (core: merge_log, dedupe, rename, integrity, schedules, settings)…');
  await ensureDedupeWritePathObjects();

  console.log('[db] Fleet catalog (service_types, maintenance schedules, parts reference)…');
  await runFleetCatalogDdlSafe();

  console.log('[db] Optional objects (erp report schedules, fleet defaults singleton)…');
  for (const sql of OPTIONAL_DDL) {
    const trimmed = stripLeadingComments(sql);
    if (!trimmed) continue;
    try {
      await dbQuery(trimmed);
    } catch (err) {
      console.error('[db] optional ensure failed:', err?.message || err);
    }
  }

  await bootstrapFleetCatalogSamples();

  const { rows } = await dbQuery(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [DEDUPE_SUPPORT_TABLE_NAMES]
  );
  const have = new Set((rows || []).map(r => r.table_name));
  const missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have.has(n));
  const mergeCritical = new Set(['merge_log', 'dedup_skipped']);
  const fatalMissing = missing.filter(n => mergeCritical.has(n));
  const softMissing = missing.filter(n => !mergeCritical.has(n));
  const fleetMissing = softMissing.filter(n => FLEET_CATALOG_TABLE_NAMES.has(n));
  const otherSoft = softMissing.filter(n => !FLEET_CATALOG_TABLE_NAMES.has(n));

  if (otherSoft.length) {
    console.error(
      '[db] Some support tables are missing (QBO merge still works if merge_log exists):',
      otherSoft.join(', ')
    );
  }
  if (fleetMissing.length) {
    console.error(
      '[db] Fleet catalog tables missing:',
      fleetMissing.join(', '),
      '— enable pgcrypto or fix fleet DDL errors above.'
    );
  }
  if (fatalMissing.length) {
    throw new Error(
      `[db] Merge audit tables missing after initialization: ${fatalMissing.join(', ')}. Fix database permissions or errors above.`
    );
  }

  console.log(
    '[db] Core support tables ready (merge_log + dedupe required; rename/integrity/schedules best-effort' +
      (missing.length ? `; still missing: ${missing.join(', ')}` : '; all ten support names present') +
      ').'
  );
}

/**
 * Server boot guard: Postgres + IF NOT EXISTS for all app support objects (merge audit first).
 * Idempotent; never drops or ALTERs existing tables.
 */
export async function initializeDatabase() {
  console.log('[DB] Checking required tables (Postgres, CREATE IF NOT EXISTS only)…');
  await ensureAppDatabaseObjects();
  if (!getPool()) return;
  const { rows } = await dbQuery(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [DEDUPE_SUPPORT_TABLE_NAMES]
  );
  const names = (rows || []).map(r => r.table_name);
  console.log('[DB] Dedupe/support table check:', names.join(', ') || '(none of the ten names found)');
}
