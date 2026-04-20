-- Vendor / driver / customer rename audit, Samsara↔ERP driver links, canonical display names.

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
);

CREATE INDEX IF NOT EXISTS idx_rename_log_renamed_at ON rename_log (renamed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rename_log_type ON rename_log (record_type);

CREATE TABLE IF NOT EXISTS driver_system_links (
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
);

CREATE TABLE IF NOT EXISTS canonical_names (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,
  erp_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  set_by TEXT,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  UNIQUE (record_type, erp_id)
);

INSERT INTO schema_migrations (filename) VALUES ('013_name_management.sql') ON CONFLICT DO NOTHING;
