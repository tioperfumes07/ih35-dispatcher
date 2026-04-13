-- QuickBooks invoice id on load (after Create in QBO); load_documents QBO attachable sync

ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT;

ALTER TABLE load_documents ADD COLUMN IF NOT EXISTS qbo_attachable_id TEXT;
ALTER TABLE load_documents ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_loads_qbo_invoice_id ON loads (qbo_invoice_id) WHERE qbo_invoice_id IS NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('008_loads_qbo_invoice_doc_attachments.sql') ON CONFLICT DO NOTHING;
