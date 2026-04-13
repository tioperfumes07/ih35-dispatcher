-- Link TMS loads/stops to QuickBooks (customer, item, expense category)

ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;

ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_item_id TEXT;
ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_account_id TEXT;

INSERT INTO schema_migrations (filename) VALUES ('003_loads_qbo_refs.sql') ON CONFLICT DO NOTHING;
