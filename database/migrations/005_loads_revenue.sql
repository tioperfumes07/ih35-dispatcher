-- Trip revenue (linehaul / total) for settlement net vs rolled-up expenses

ALTER TABLE loads ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(12, 2);

INSERT INTO schema_migrations (filename) VALUES ('005_loads_revenue.sql') ON CONFLICT DO NOTHING;
