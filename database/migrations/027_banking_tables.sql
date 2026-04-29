CREATE TABLE IF NOT EXISTS dip_bank_account_balances (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  account_name TEXT,
  account_last4 TEXT,
  account_type TEXT,
  month_key TEXT NOT NULL,
  opening_balance NUMERIC(14,2) DEFAULT 0,
  receipts NUMERIC(14,2) DEFAULT 0,
  disbursements NUMERIC(14,2) DEFAULT 0,
  ending_balance NUMERIC(14,2) DEFAULT 0,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, month_key)
);

CREATE TABLE IF NOT EXISTS banking_transactions (
  id SERIAL PRIMARY KEY,
  qbo_txn_id TEXT UNIQUE,
  account_id TEXT NOT NULL,
  account_name TEXT,
  txn_type TEXT,
  txn_date DATE,
  amount NUMERIC(14,2),
  running_balance NUMERIC(14,2),
  description TEXT,
  vendor_name TEXT,
  memo TEXT,
  cleared BOOLEAN DEFAULT false,
  reconciled BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'qbo',
  qbo_status TEXT DEFAULT 'synced',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banking_transactions_account_date
  ON banking_transactions (account_id, txn_date DESC);

CREATE INDEX IF NOT EXISTS idx_banking_transactions_source
  ON banking_transactions (source, txn_date DESC);

ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS transaction_date DATE;

INSERT INTO schema_migrations (filename)
VALUES ('027_banking_tables.sql')
ON CONFLICT DO NOTHING;
