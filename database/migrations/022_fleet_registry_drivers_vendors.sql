-- Packet 9 — Fleet registries (Postgres mirror of hub SQLite drivers / vendors_local).
-- Safe to run when DATABASE_URL is set; uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
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
  cdl_expiry DATE,
  assigned_unit TEXT,
  qbo_vendor_id TEXT,
  qbo_synced BOOLEAN DEFAULT false,
  qbo_synced_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  samsara_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers (status);
CREATE INDEX IF NOT EXISTS idx_drivers_full_name ON drivers (full_name);

CREATE TABLE IF NOT EXISTS vendors_local (
  id SERIAL PRIMARY KEY,
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
  qbo_synced BOOLEAN DEFAULT false,
  qbo_synced_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendors_local_display_name ON vendors_local (display_name);
