-- Canonical list of maintenance / service labels for ERP record entry and datalists.
CREATE TABLE IF NOT EXISTS maintenance_service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_service_catalog_name_key UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_maint_svc_cat_active
  ON maintenance_service_catalog (active, sort_order, name);

INSERT INTO schema_migrations (filename) VALUES ('010_maintenance_service_catalog.sql') ON CONFLICT DO NOTHING;
