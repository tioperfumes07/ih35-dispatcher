-- Name management audit + driver crosswalk (PostgreSQL reference; SQLite mirror in server/data/accounting.db)

CREATE TABLE IF NOT EXISTS rename_log (
  id                  TEXT PRIMARY KEY,
  entity_id           TEXT NOT NULL,
  entity_kind         TEXT NOT NULL,
  canonical_after     TEXT NOT NULL,
  old_snapshot        JSONB NOT NULL,
  new_snapshot        JSONB NOT NULL,
  systems_requested     JSONB NOT NULL,
  systems_result      JSONB NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('success', 'partial', 'fail')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rename_log_entity ON rename_log (entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS driver_system_links (
  id                  TEXT PRIMARY KEY,
  erp_driver_id       TEXT NOT NULL UNIQUE,
  samsara_driver_id   TEXT NOT NULL UNIQUE,
  link_type           TEXT NOT NULL CHECK (link_type IN ('auto', 'manual')),
  confidence          INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
