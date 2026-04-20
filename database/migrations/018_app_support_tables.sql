-- Optional support tables (also ensured on server boot via lib/ensure-app-database-objects.mjs).
-- IF NOT EXISTS only — safe when objects already exist from prior runs.

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
);

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
);

CREATE TABLE IF NOT EXISTS company_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO company_settings (setting_key, setting_value) VALUES
  ('company_name', 'IH 35 Transportation LLC'),
  ('city_state', 'Laredo, TX'),
  ('fleet_avg_miles_per_month', '12000'),
  ('pm_interval_miles', '25000'),
  ('usdot_number', ''),
  ('mc_number', ''),
  ('phone', ''),
  ('address', '')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('018_app_support_tables.sql') ON CONFLICT DO NOTHING;
