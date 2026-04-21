-- Integrity alerts: populated by POST /api/integrity/check after saves (async advisory; never blocks writes).
-- Application may also INSERT rows from the check worker.
-- PostgreSQL 13+ gen_random_uuid(). On older PG use: CREATE EXTENSION IF NOT EXISTS pgcrypto; and uuid_generate_v4().

CREATE TABLE IF NOT EXISTS integrity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_code VARCHAR(12) NOT NULL,
  category VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'amber',
  title TEXT NOT NULL,
  message TEXT,
  entity_type VARCHAR(64),
  entity_id VARCHAR(64),
  triggering_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(128),
  source_save_type VARCHAR(64),
  source_save_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_category_created
  ON integrity_alerts (category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_open
  ON integrity_alerts ((reviewed_at IS NULL), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_check
  ON integrity_alerts (check_code);

COMMENT ON TABLE integrity_alerts IS 'Fleet integrity / anomaly alerts; T*=tire, D*=driver, A*=accident, F*=fuel, M*=maintenance, P*=predictive';
