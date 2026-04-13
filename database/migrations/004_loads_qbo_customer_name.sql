-- Denormalized display name for QBO customer (source of truth is QuickBooks)

ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_name TEXT;

INSERT INTO schema_migrations (filename) VALUES ('004_loads_qbo_customer_name.sql') ON CONFLICT DO NOTHING;
