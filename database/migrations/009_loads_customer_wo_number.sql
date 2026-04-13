-- Customer work order / reference # (separate from TMS load # / invoice #)

ALTER TABLE loads ADD COLUMN IF NOT EXISTS customer_wo_number TEXT;

INSERT INTO schema_migrations (filename) VALUES ('009_loads_customer_wo_number.sql') ON CONFLICT DO NOTHING;
