-- TMS core: customers, fleet, loads, stops (Always Track–style dispatch)

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mc_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  qbo_vendor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_name ON drivers (name);

CREATE TABLE IF NOT EXISTS trucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_code)
);

CREATE TABLE IF NOT EXISTS trailers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (unit_code)
);

CREATE TABLE IF NOT EXISTS loads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  customer_id UUID REFERENCES customers (id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers (id) ON DELETE SET NULL,
  truck_id UUID REFERENCES trucks (id) ON DELETE SET NULL,
  trailer_id UUID REFERENCES trailers (id) ON DELETE SET NULL,
  dispatcher_name TEXT,
  start_date DATE,
  end_date DATE,
  practical_loaded_miles NUMERIC(12, 2) DEFAULT 0,
  practical_empty_miles NUMERIC(12, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (load_number)
);

CREATE INDEX IF NOT EXISTS idx_loads_status ON loads (status);
CREATE INDEX IF NOT EXISTS idx_loads_created ON loads (created_at DESC);

CREATE TABLE IF NOT EXISTS load_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id UUID NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
  sequence_order INT NOT NULL,
  stop_type TEXT NOT NULL,
  location_name TEXT,
  address TEXT,
  practical_miles NUMERIC(12, 2) DEFAULT 0,
  shortest_miles NUMERIC(12, 2) DEFAULT 0,
  stop_at TIMESTAMPTZ,
  window_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_load_stops_load ON load_stops (load_id, sequence_order);

INSERT INTO schema_migrations (filename) VALUES ('002_tms_core.sql') ON CONFLICT DO NOTHING;
