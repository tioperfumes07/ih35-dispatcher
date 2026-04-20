-- QuickBooks vendor/customer deduplication audit + skipped duplicate groups.

CREATE TABLE IF NOT EXISTS merge_log (
  id BIGSERIAL PRIMARY KEY,
  merge_type TEXT NOT NULL CHECK (merge_type IN ('vendor', 'customer')),
  kept_qbo_id TEXT NOT NULL,
  kept_name TEXT NOT NULL,
  merged_qbo_id TEXT NOT NULL,
  merged_name TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transactions_transferred INTEGER NOT NULL DEFAULT 0,
  erp_records_updated INTEGER NOT NULL DEFAULT 0,
  qbo_api_responses JSONB,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_error', 'failed')),
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merge_log_merged_at ON merge_log (merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_merge_log_type_status ON merge_log (merge_type, status);

CREATE TABLE IF NOT EXISTS dedup_skipped (
  id BIGSERIAL PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('vendor', 'customer')),
  qbo_id_a TEXT NOT NULL,
  qbo_id_b TEXT NOT NULL,
  skipped_by TEXT,
  skipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  group_signature TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS dedup_skipped_unique_group ON dedup_skipped (record_type, group_signature);

INSERT INTO schema_migrations (filename) VALUES ('012_qbo_dedupe_merge_log.sql') ON CONFLICT DO NOTHING;
