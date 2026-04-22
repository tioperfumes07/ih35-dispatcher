-- Vendor / customer deduplication audit (PostgreSQL reference; app uses SQLite mirror in server/data/accounting.db)
-- Required before merge execution in production pipelines.

CREATE TABLE IF NOT EXISTS merge_log (
  id                TEXT PRIMARY KEY,
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('vendor', 'customer')),
  kept_party_id     TEXT NOT NULL,
  merged_party_id   TEXT NOT NULL,
  kept_name_final   TEXT NOT NULL,
  merged_name_final TEXT NOT NULL,
  confidence_pct    INTEGER NOT NULL,
  confidence_band   TEXT NOT NULL CHECK (confidence_band IN ('HIGH', 'MEDIUM')),
  rules_matched     JSONB NOT NULL DEFAULT '[]',
  qbo_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  transfers_json    JSONB NOT NULL DEFAULT '{}',
  erp_updated       BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limit_window TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merge_log_created ON merge_log (created_at DESC);

CREATE TABLE IF NOT EXISTS dedup_skipped (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('vendor', 'customer')),
  party_id_a   TEXT NOT NULL,
  party_id_b   TEXT NOT NULL,
  group_key    TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dedup_skipped_entity ON dedup_skipped (entity_type, created_at DESC);
