-- ERP-side address directory for QBO-linked vendors and TMS customers (fuel / AP forms).

CREATE TABLE IF NOT EXISTS vendors (
  qbo_vendor_id TEXT PRIMARY KEY,
  display_name TEXT,
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'USA';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT;

-- QBO customer list in name management is keyed by QuickBooks Id (not TMS customers.id).
CREATE TABLE IF NOT EXISTS qbo_customer_addresses (
  qbo_customer_id TEXT PRIMARY KEY,
  display_name TEXT,
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (filename) VALUES ('020_vendor_customer_addresses.sql') ON CONFLICT DO NOTHING;
