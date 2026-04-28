-- Canonical core ops schema for Wave 1/2 foundation

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  transaction_type TEXT NOT NULL,
  unit_id TEXT,
  unit_number TEXT,
  asset_category TEXT,
  driver_id TEXT,
  driver_name TEXT,
  vendor_id TEXT,
  vendor_name TEXT,
  service_type TEXT,
  description TEXT,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  amount_estimated NUMERIC(12,2),
  amount_actual NUMERIC(12,2),
  load_number TEXT,
  location_type TEXT,
  qbo_status TEXT DEFAULT 'pending',
  qbo_txn_id TEXT,
  sync_error TEXT,
  created_by TEXT,
  updated_by TEXT,
  source_module TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_state JSONB,
  after_state JSONB,
  source_module TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  employee_id TEXT UNIQUE,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'dispatcher',
  status TEXT DEFAULT 'active',
  hire_date DATE,
  pin_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_migrations (filename) VALUES ('024_canonical_schema_core_tables.sql') ON CONFLICT DO NOTHING;
