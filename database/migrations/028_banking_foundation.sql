CREATE TABLE IF NOT EXISTS banking_transactions (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  account_id TEXT NOT NULL,
  account_name TEXT,
  txn_date DATE NOT NULL,
  posted_at TIMESTAMPTZ,
  description TEXT,
  vendor_name TEXT,
  memo TEXT,
  amount NUMERIC(14,2) NOT NULL,
  txn_direction TEXT DEFAULT 'debit',
  running_balance NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'uncategorized',
  category TEXT,
  category_source TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  statement_id TEXT,
  qbo_txn_id TEXT,
  qbo_sync_status TEXT DEFAULT 'queued',
  qbo_sync_error TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_account_preferences (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  account_name TEXT,
  account_type TEXT,
  visible BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_dip BOOLEAN NOT NULL DEFAULT true,
  entity TEXT NOT NULL DEFAULT 'ih35-transportation',
  color_tag TEXT,
  is_relay_account BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banking_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  match_field TEXT NOT NULL,
  match_operator TEXT NOT NULL DEFAULT 'contains',
  match_value TEXT NOT NULL,
  action_type TEXT NOT NULL,
  category TEXT,
  vendor_id TEXT,
  split_template_json JSONB,
  auto_apply BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_txn_links (
  id BIGSERIAL PRIMARY KEY,
  txn_id BIGINT NOT NULL REFERENCES banking_transactions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  amount NUMERIC(14,2),
  link_role TEXT DEFAULT 'primary',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_settlements (
  id BIGSERIAL PRIMARY KEY,
  driver_id TEXT NOT NULL,
  driver_name TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  gross_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_source TEXT NOT NULL DEFAULT 'manual',
  load_table_ref TEXT,
  fuel_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  advance_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  paid_date DATE,
  bank_txn_id BIGINT REFERENCES banking_transactions(id) ON DELETE SET NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_settlement_loads (
  id BIGSERIAL PRIMARY KEY,
  settlement_id BIGINT NOT NULL REFERENCES driver_settlements(id) ON DELETE CASCADE,
  load_number TEXT NOT NULL,
  gross_component NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factoring_advances (
  id BIGSERIAL PRIMARY KEY,
  factor_name TEXT NOT NULL,
  invoice_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  advance_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposit_date DATE,
  bank_txn_id BIGINT REFERENCES banking_transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factoring_advance_loads (
  id BIGSERIAL PRIMARY KEY,
  factoring_advance_id BIGINT NOT NULL REFERENCES factoring_advances(id) ON DELETE CASCADE,
  load_number TEXT NOT NULL,
  invoice_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  account_id TEXT,
  filename TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'preview',
  parser_notes TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_sessions (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  statement_end_date DATE,
  statement_ending_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  cleared_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  lock_reason_code TEXT,
  lock_reason_notes TEXT,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, statement_month)
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_items (
  id BIGSERIAL PRIMARY KEY,
  reconciliation_session_id BIGINT NOT NULL REFERENCES bank_reconciliation_sessions(id) ON DELETE CASCADE,
  banking_txn_id BIGINT NOT NULL REFERENCES banking_transactions(id) ON DELETE CASCADE,
  cleared BOOLEAN NOT NULL DEFAULT false,
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reconciliation_session_id, banking_txn_id)
);

CREATE TABLE IF NOT EXISTS report_cache (
  id BIGSERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cache',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_key, params_hash)
);

CREATE TABLE IF NOT EXISTS period_locks (
  id BIGSERIAL PRIMARY KEY,
  module TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  locked_by TEXT,
  lock_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module, period_key)
);

CREATE INDEX IF NOT EXISTS idx_banking_transactions_account_date
  ON banking_transactions (account_id, txn_date DESC);

CREATE INDEX IF NOT EXISTS idx_banking_transactions_status
  ON banking_transactions (status);

CREATE INDEX IF NOT EXISTS idx_banking_rules_active_priority
  ON banking_rules (active, priority);

CREATE INDEX IF NOT EXISTS idx_driver_settlements_driver_period
  ON driver_settlements (driver_id, period_start);

CREATE INDEX IF NOT EXISTS idx_bank_recon_sessions_account_month
  ON bank_reconciliation_sessions (account_id, statement_month);

CREATE INDEX IF NOT EXISTS idx_report_cache_key_generated
  ON report_cache (report_key, generated_at DESC);

CREATE OR REPLACE FUNCTION trg_banking_audit_log() RETURNS TRIGGER AS $$
DECLARE
  actor_text TEXT;
  rec_id TEXT;
BEGIN
  actor_text := COALESCE(NULLIF(current_setting('app.current_actor', true), ''), 'system');
  IF TG_OP = 'DELETE' THEN
    rec_id := COALESCE(OLD.id::TEXT, '');
    INSERT INTO audit_log (actor, action, entity_type, entity_id, before_state, after_state, source_module, ip_address, created_at)
    VALUES (actor_text, lower(TG_OP), TG_TABLE_NAME, rec_id, to_jsonb(OLD), NULL, 'banking', NULL, NOW());
    RETURN OLD;
  ELSE
    rec_id := COALESCE(NEW.id::TEXT, '');
    INSERT INTO audit_log (actor, action, entity_type, entity_id, before_state, after_state, source_module, ip_address, created_at)
    VALUES (actor_text, lower(TG_OP), TG_TABLE_NAME, rec_id, CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW), 'banking', NULL, NOW());
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_banking_transactions ON banking_transactions;
CREATE TRIGGER trg_audit_banking_transactions
AFTER INSERT OR UPDATE OR DELETE ON banking_transactions
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_bank_account_preferences ON bank_account_preferences;
CREATE TRIGGER trg_audit_bank_account_preferences
AFTER INSERT OR UPDATE OR DELETE ON bank_account_preferences
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_banking_rules ON banking_rules;
CREATE TRIGGER trg_audit_banking_rules
AFTER INSERT OR UPDATE OR DELETE ON banking_rules
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_bank_txn_links ON bank_txn_links;
CREATE TRIGGER trg_audit_bank_txn_links
AFTER INSERT OR UPDATE OR DELETE ON bank_txn_links
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_driver_settlements ON driver_settlements;
CREATE TRIGGER trg_audit_driver_settlements
AFTER INSERT OR UPDATE OR DELETE ON driver_settlements
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_driver_settlement_loads ON driver_settlement_loads;
CREATE TRIGGER trg_audit_driver_settlement_loads
AFTER INSERT OR UPDATE OR DELETE ON driver_settlement_loads
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_factoring_advances ON factoring_advances;
CREATE TRIGGER trg_audit_factoring_advances
AFTER INSERT OR UPDATE OR DELETE ON factoring_advances
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_factoring_advance_loads ON factoring_advance_loads;
CREATE TRIGGER trg_audit_factoring_advance_loads
AFTER INSERT OR UPDATE OR DELETE ON factoring_advance_loads
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_bank_import_batches ON bank_import_batches;
CREATE TRIGGER trg_audit_bank_import_batches
AFTER INSERT OR UPDATE OR DELETE ON bank_import_batches
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_bank_reconciliation_sessions ON bank_reconciliation_sessions;
CREATE TRIGGER trg_audit_bank_reconciliation_sessions
AFTER INSERT OR UPDATE OR DELETE ON bank_reconciliation_sessions
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_bank_reconciliation_items ON bank_reconciliation_items;
CREATE TRIGGER trg_audit_bank_reconciliation_items
AFTER INSERT OR UPDATE OR DELETE ON bank_reconciliation_items
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_report_cache ON report_cache;
CREATE TRIGGER trg_audit_report_cache
AFTER INSERT OR UPDATE OR DELETE ON report_cache
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

DROP TRIGGER IF EXISTS trg_audit_period_locks ON period_locks;
CREATE TRIGGER trg_audit_period_locks
AFTER INSERT OR UPDATE OR DELETE ON period_locks
FOR EACH ROW EXECUTE FUNCTION trg_banking_audit_log();

INSERT INTO schema_migrations (filename)
VALUES ('028_banking_foundation.sql')
ON CONFLICT DO NOTHING;
