-- Prompt 5b: line persistence tables for work orders and transactions.
-- Verified in Neon before authoring:
-- - transactions.id is INTEGER (int4)
-- - work_orders table was not present yet in this project
-- FK columns below use INTEGER to match existing int4 ids.

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  unit_number TEXT,
  service_type TEXT,
  description TEXT,
  vendor TEXT,
  estimated_cost NUMERIC,
  priority TEXT,
  status TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_category_lines (
  id BIGSERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_category_lines_work_order_id
  ON work_order_category_lines(work_order_id);

CREATE TABLE IF NOT EXISTS work_order_item_lines (
  id BIGSERIAL PRIMARY KEY,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  location TEXT,
  qty NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_item_lines_work_order_id
  ON work_order_item_lines(work_order_id);

CREATE TABLE IF NOT EXISTS transaction_category_lines (
  id BIGSERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_category_lines_transaction_id
  ON transaction_category_lines(transaction_id);

CREATE TABLE IF NOT EXISTS transaction_item_lines (
  id BIGSERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  location TEXT,
  qty NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_item_lines_transaction_id
  ON transaction_item_lines(transaction_id);
