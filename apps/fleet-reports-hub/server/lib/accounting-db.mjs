/**
 * SQLite accounting + fleet metadata (single file: server/data/accounting.db).
 * Call initializeDatabase() once at process startup before registering routes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'accounting.db');

/** Every table that must exist after initializeDatabase(). */
export const REQUIRED_TABLES = [
  'merge_log',
  'dedup_skipped',
  'rename_log',
  'driver_system_links',
  'canonical_names',
  'integrity_alerts',
  'vehicle_maintenance_schedules',
  'vehicle_parts_reference',
  'scheduled_reports',
  'company_settings',
  'drivers',
  'vendors_local',
  'assets',
];

const DDL = `
CREATE TABLE IF NOT EXISTS merge_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  kept_party_id TEXT NOT NULL,
  merged_party_id TEXT NOT NULL,
  kept_name_final TEXT NOT NULL,
  merged_name_final TEXT NOT NULL,
  confidence_pct INTEGER NOT NULL,
  confidence_band TEXT NOT NULL,
  rules_matched TEXT NOT NULL,
  qbo_verified INTEGER NOT NULL,
  transfers_json TEXT NOT NULL,
  erp_updated INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merge_log_created ON merge_log (created_at DESC);

CREATE TABLE IF NOT EXISTS dedup_skipped (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  party_id_a TEXT NOT NULL,
  party_id_b TEXT NOT NULL,
  group_key TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedup_skipped_created ON dedup_skipped (created_at DESC);

CREATE TABLE IF NOT EXISTS rename_log (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  canonical_after TEXT NOT NULL,
  old_snapshot TEXT NOT NULL,
  new_snapshot TEXT NOT NULL,
  systems_requested TEXT NOT NULL,
  systems_result TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rename_log_entity ON rename_log (entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS driver_system_links (
  id TEXT PRIMARY KEY,
  erp_driver_id TEXT NOT NULL UNIQUE,
  samsara_driver_id TEXT NOT NULL UNIQUE,
  link_type TEXT NOT NULL,
  confidence INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_names (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (entity_kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_names_kind ON canonical_names (entity_kind);

CREATE TABLE IF NOT EXISTS integrity_alerts (
  id TEXT PRIMARY KEY,
  check_code TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'amber',
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id TEXT,
  triggering_records TEXT NOT NULL DEFAULT '[]',
  reviewed_at TEXT,
  reviewed_by TEXT,
  source_save_type TEXT,
  source_save_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_category_created
  ON integrity_alerts (category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_check ON integrity_alerts (check_code);

CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id TEXT PRIMARY KEY,
  vehicle_make_key TEXT NOT NULL,
  service_key TEXT NOT NULL,
  service_label TEXT NOT NULL,
  interval_miles INTEGER NOT NULL,
  interval_months_floor INTEGER NOT NULL,
  UNIQUE (vehicle_make_key, service_key)
);

CREATE INDEX IF NOT EXISTS idx_vms_make ON vehicle_maintenance_schedules (vehicle_make_key);

CREATE TABLE IF NOT EXISTS vehicle_parts_reference (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  part_name TEXT NOT NULL,
  cost_low REAL NOT NULL,
  cost_mid REAL NOT NULL,
  cost_high REAL NOT NULL,
  notes TEXT,
  UNIQUE (category, part_name)
);

CREATE INDEX IF NOT EXISTS idx_vpr_category ON vehicle_parts_reference (category);

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  schedule_cron TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_report ON scheduled_reports (report_id);

CREATE TABLE IF NOT EXISTS company_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  samsara_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT,
  cdl_number TEXT,
  cdl_state TEXT,
  cdl_expiry TEXT,
  assigned_unit TEXT,
  qbo_vendor_id TEXT,
  qbo_synced INTEGER NOT NULL DEFAULT 0,
  qbo_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  samsara_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
CREATE INDEX IF NOT EXISTS idx_drivers_name ON drivers (full_name);

CREATE TABLE IF NOT EXISTS vendors_local (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qbo_vendor_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  company_name TEXT,
  first_name TEXT,
  last_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT,
  vendor_type TEXT,
  tax_id TEXT,
  payment_terms TEXT,
  qbo_synced INTEGER NOT NULL DEFAULT 0,
  qbo_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendors_local_name ON vendors_local (display_name);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  samsara_id TEXT UNIQUE,
  unit_number TEXT NOT NULL,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT,
  license_plate TEXT,
  license_state TEXT,
  odometer_miles INTEGER,
  engine_hours REAL,
  fuel_type TEXT,
  asset_type TEXT NOT NULL DEFAULT 'truck',
  qbo_class_id TEXT,
  qbo_class_name TEXT,
  qbo_synced INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  samsara_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_unit ON assets (unit_number);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status);
`;

const COMPANY_SETTINGS_SEED = `
INSERT INTO company_settings (key, value) VALUES
  ('company_name', 'IH 35 Transportation LLC'),
  ('city_state', 'Laredo, TX'),
  ('fleet_avg_miles_per_month', '12000'),
  ('pm_interval_miles', '25000'),
  ('usdot_number', ''),
  ('mc_number', ''),
  ('phone', ''),
  ('address', '')
ON CONFLICT(key) DO NOTHING;
`;

let _db;

function listMissingTables(db) {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(',')})`,
    )
    .all(...REQUIRED_TABLES);
  const have = new Set(rows.map((r) => r.name));
  return REQUIRED_TABLES.filter((t) => !have.has(t));
}

/**
 * Creates all tables (IF NOT EXISTS), seeds company_settings, verifies names.
 * Idempotent. Must run before any route uses getAccountingDb().
 */
export function initializeDatabase() {
  if (_db) {
    const missing = listMissingTables(_db);
    if (missing.length) {
      throw new Error(`[db] accounting.db open but missing tables: ${missing.join(', ')}`);
    }
    return { ok: true, tables: REQUIRED_TABLES, alreadyOpen: true };
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(DDL);
  db.exec(COMPANY_SETTINGS_SEED);

  const missing = listMissingTables(db);
  if (missing.length) {
    db.close();
    throw new Error(
      `[db] After DDL + seed, missing tables: ${missing.join(', ')} (path: ${DB_PATH})`,
    );
  }

  _db = db;
  console.log(`[db] initialized SQLite (${REQUIRED_TABLES.length} tables) at ${DB_PATH}`);
  return { ok: true, tables: REQUIRED_TABLES, path: DB_PATH };
}

export function getAccountingDb() {
  if (!_db) {
    throw new Error(
      '[db] getAccountingDb() called before initializeDatabase() — ensure server startup calls initializeDatabase() first.',
    );
  }
  return _db;
}

export function accountingTablesReady() {
  try {
    if (!_db) return false;
    return listMissingTables(_db).length === 0;
  } catch {
    return false;
  }
}

/** For /api/accounting/db-status diagnostics when ok is false. */
export function missingDatabaseTables() {
  if (!_db) return [...REQUIRED_TABLES];
  return listMissingTables(_db);
}

export function mergeLogCountLastHour() {
  const db = getAccountingDb();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM merge_log WHERE created_at > ?`).get(since);
  return row?.c ?? 0;
}
