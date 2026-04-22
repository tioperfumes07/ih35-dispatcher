-- Packet 9 — Fleet assets registry (Postgres mirror of hub SQLite assets).

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  samsara_id TEXT UNIQUE,
  unit_number TEXT NOT NULL,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT,
  license_plate TEXT,
  license_state TEXT,
  odometer_miles INTEGER,
  engine_hours NUMERIC,
  fuel_type TEXT,
  asset_type TEXT DEFAULT 'truck',
  qbo_class_id TEXT,
  qbo_class_name TEXT,
  qbo_synced BOOLEAN DEFAULT false,
  qbo_synced_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  samsara_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_unit_number ON assets (unit_number);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets (status);
