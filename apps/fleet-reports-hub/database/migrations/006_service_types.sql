-- Canonical service catalog (maintenance + repair). Months = FLOOR(interval_miles / fleet_avg); fleet_avg default 12,000.

CREATE TABLE IF NOT EXISTS service_types (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key               VARCHAR(64) NOT NULL UNIQUE,
  service_name              VARCHAR(200) NOT NULL,
  interval_miles            INTEGER CHECK (interval_miles IS NULL OR interval_miles > 0),
  interval_months           INTEGER CHECK (interval_months IS NULL OR interval_months >= 0),
  uses_position_map         BOOLEAN NOT NULL DEFAULT FALSE,
  position_map_type         VARCHAR(64),
  service_category          VARCHAR(80) NOT NULL,
  record_type               VARCHAR(32) NOT NULL CHECK (record_type IN ('maintenance', 'repair')),
  avg_cost_low              DECIMAL(12, 2),
  avg_cost_high             DECIMAL(12, 2),
  applies_to_makes          JSONB NOT NULL DEFAULT '["all"]',
  notes                       TEXT,
  is_manufacturer_required    BOOLEAN NOT NULL DEFAULT FALSE,
  display_order               INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_types_record ON service_types (record_type, display_order);
CREATE INDEX IF NOT EXISTS idx_service_types_category ON service_types (service_category);

-- Seed source of truth for local dev: server/data/service-types.json (import via ETL in production).
