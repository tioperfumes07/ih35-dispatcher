-- Driver on load = QuickBooks vendor; per-load file attachments (rate con, POD, etc.)

ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_id TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_name TEXT;

CREATE TABLE IF NOT EXISTS load_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id UUID NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'other',
  original_name TEXT NOT NULL DEFAULT '',
  stored_path TEXT NOT NULL,
  mime_type TEXT,
  byte_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_load_documents_load_id ON load_documents (load_id);

INSERT INTO schema_migrations (filename) VALUES ('006_loads_qbo_driver_vendor_documents.sql') ON CONFLICT DO NOTHING;
