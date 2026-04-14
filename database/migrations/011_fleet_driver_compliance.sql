-- Fleet ↔ Samsara IDs, asset classification, and driver compliance fields (DOT / safety).
-- PII stays in your HR systems; qbo_vendor_id links payables/settlement to QuickBooks only.

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_state TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_expiry DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS med_cert_expiry DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS samsara_driver_id TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS compliance_notes TEXT;

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS samsara_vehicle_id TEXT;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS asset_category TEXT;

ALTER TABLE trailers ADD COLUMN IF NOT EXISTS samsara_vehicle_id TEXT;
ALTER TABLE trailers ADD COLUMN IF NOT EXISTS asset_category TEXT;

CREATE INDEX IF NOT EXISTS idx_drivers_qbo_vendor_id ON drivers (qbo_vendor_id) WHERE qbo_vendor_id IS NOT NULL AND btrim(qbo_vendor_id) <> '';
CREATE INDEX IF NOT EXISTS idx_drivers_samsara_driver_id ON drivers (samsara_driver_id) WHERE samsara_driver_id IS NOT NULL AND btrim(samsara_driver_id) <> '';
CREATE INDEX IF NOT EXISTS idx_trucks_samsara_vehicle_id ON trucks (samsara_vehicle_id) WHERE samsara_vehicle_id IS NOT NULL AND btrim(samsara_vehicle_id) <> '';
CREATE INDEX IF NOT EXISTS idx_trailers_samsara_vehicle_id ON trailers (samsara_vehicle_id) WHERE samsara_vehicle_id IS NOT NULL AND btrim(samsara_vehicle_id) <> '';

INSERT INTO schema_migrations (filename) VALUES ('011_fleet_driver_compliance.sql') ON CONFLICT DO NOTHING;
