-- Wave 6 equipment assignment history + bulk assignment support

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id SERIAL PRIMARY KEY,
  equipment_id TEXT NOT NULL,
  unit_number TEXT NOT NULL,
  assigned_date TIMESTAMPTZ DEFAULT NOW(),
  unassigned_date TIMESTAMPTZ,
  assigned_by TEXT,
  notes TEXT,
  status TEXT DEFAULT 'assigned',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_assignments_equipment
  ON equipment_assignments (equipment_id, status, assigned_date DESC);

CREATE INDEX IF NOT EXISTS idx_equipment_assignments_unit
  ON equipment_assignments (unit_number, status, assigned_date DESC);

INSERT INTO schema_migrations (filename) VALUES ('025_equipment_assignments.sql') ON CONFLICT DO NOTHING;
