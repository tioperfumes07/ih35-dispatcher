-- Fleet maintenance schedules + parts reference + fleet average miles/month setting.
-- Month floor rule: interval_months_floor = FLOOR(interval_miles / fleet_avg_miles_per_month)
-- Default fleet_avg_miles_per_month = 12,000

CREATE TABLE IF NOT EXISTS fleet_settings (
  key VARCHAR(64) PRIMARY KEY,
  value_numeric DECIMAL(14, 2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO fleet_settings (key, value_numeric)
VALUES ('fleet_avg_miles_per_month', 12000)
ON CONFLICT (key) DO UPDATE SET value_numeric = EXCLUDED.value_numeric, updated_at = NOW();

CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_make_key VARCHAR(64) NOT NULL,
  service_key VARCHAR(64) NOT NULL,
  service_label VARCHAR(160) NOT NULL,
  interval_miles INTEGER NOT NULL CHECK (interval_miles > 0),
  interval_months_floor INTEGER NOT NULL CHECK (interval_months_floor >= 0),
  UNIQUE (vehicle_make_key, service_key)
);

CREATE INDEX IF NOT EXISTS idx_vms_make ON vehicle_maintenance_schedules (vehicle_make_key);

CREATE TABLE IF NOT EXISTS vehicle_parts_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(64) NOT NULL,
  part_name VARCHAR(256) NOT NULL,
  cost_low DECIMAL(12, 2) NOT NULL,
  cost_mid DECIMAL(12, 2) NOT NULL,
  cost_high DECIMAL(12, 2) NOT NULL,
  notes TEXT,
  UNIQUE (category, part_name)
);

CREATE INDEX IF NOT EXISTS idx_vpr_category ON vehicle_parts_reference (category);
