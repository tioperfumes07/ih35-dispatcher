-- One invoice per load: default linehaul QBO item + optional extra charge lines (JSON)

ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_linehaul_item_id TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS invoice_extra_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO schema_migrations (filename) VALUES ('007_loads_invoice_linehaul_extras.sql') ON CONFLICT DO NOTHING;
