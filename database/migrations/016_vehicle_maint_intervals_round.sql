-- Recalculate interval_months from interval_miles at 12,000 mi/mo using ROUND (min 1).
-- Sync service_types → vehicle_maintenance_schedules (fleet-wide rows). Add DOT annual + extra inspection rows.

UPDATE vehicle_maintenance_schedules
SET interval_months = GREATEST(1, ROUND(interval_miles / 12000.0))
WHERE interval_miles IS NOT NULL;

UPDATE service_types
SET interval_months = GREATEST(1, ROUND(interval_miles / 12000.0))
WHERE interval_miles IS NOT NULL;

-- Business overrides (pure ROUND differs from fleet scheduling intent at 12k/mo)
UPDATE service_types SET interval_months = 12
WHERE slug IN (
    'air_dryer_cartridge_replacement',
    'tire_replacement_drive',
    'dpf_cleaning_volvo_vnr',
    'dpf_cleaning_peterbilt_567'
  )
  AND interval_miles IS NOT NULL
  AND interval_miles BETWEEN 140000 AND 160000;

UPDATE service_types SET interval_months = 18
WHERE slug IN ('dpf_cleaning', 'egr_valve_service')
  AND interval_miles >= 180000;

UPDATE service_types SET interval_months = 42
WHERE slug IN ('fuel_injector_service', 'transmission_fluid_service')
  AND interval_miles >= 450000;

INSERT INTO service_types (slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model, active) VALUES
('annual_dot_inspection', 'Annual DOT inspection', 'Compliance', NULL, 12, 'Calendar-based — 12 months regardless of mileage.', NULL, NULL, true),
('belt_tensioner_inspection', 'Belt and tensioner inspection', 'Engine', 100000, 8, NULL, NULL, NULL, true),
('wheel_end_hub_oil', 'Wheel end / hub oil', 'Drivetrain', 100000, 8, NULL, NULL, NULL, true),
('cab_air_suspension_inspection', 'Cab air suspension inspection', 'Suspension', 100000, 8, NULL, NULL, NULL, true),
('fuel_filter_primary_peterbilt_579', 'Fuel filter replacement — primary (Peterbilt 579)', 'Engine', 15000, 1, 'MX-13 vocational interval; check monthly.', 'Peterbilt', '579', true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  interval_miles = EXCLUDED.interval_miles,
  interval_months = EXCLUDED.interval_months,
  notes = EXCLUDED.notes,
  vehicle_make = EXCLUDED.vehicle_make,
  vehicle_model = EXCLUDED.vehicle_model,
  active = true;

UPDATE service_types SET interval_months = 12 WHERE slug = 'annual_dot_inspection';
UPDATE service_types SET interval_months = 8 WHERE slug IN ('belt_tensioner_inspection', 'wheel_end_hub_oil', 'cab_air_suspension_inspection') AND interval_miles = 100000;
UPDATE service_types SET interval_months = 1 WHERE slug = 'fuel_filter_primary_peterbilt_579' AND interval_miles = 15000;

INSERT INTO vehicle_maintenance_schedules (service_type_id, unit_code, interval_miles, interval_months)
SELECT st.id, NULL::text, st.interval_miles, st.interval_months
FROM service_types st
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_maintenance_schedules v
  WHERE v.service_type_id = st.id AND COALESCE(v.unit_code, '') = ''
);

UPDATE vehicle_maintenance_schedules v SET
  interval_miles = st.interval_miles,
  interval_months = st.interval_months
FROM service_types st
WHERE v.service_type_id = st.id AND v.unit_code IS NULL;

UPDATE vehicle_parts_reference SET avg_replacement_months = GREATEST(1, ROUND(avg_replacement_miles / 12000.0))
WHERE avg_replacement_miles IS NOT NULL;

UPDATE vehicle_parts_reference SET avg_replacement_months = 12 WHERE part_key IN ('drive_tire', 'air_dryer_cartridge');

UPDATE vehicle_parts_reference SET avg_replacement_months = 18 WHERE part_key = 'egr_valve' AND avg_replacement_miles BETWEEN 190000 AND 210000;

UPDATE vehicle_parts_reference SET avg_replacement_months = 42
WHERE part_key IN ('fuel_injector_set', 'dpf', 'scr_catalyst', 'fifth_wheel_complete') AND avg_replacement_miles >= 450000;

INSERT INTO schema_migrations (filename) VALUES ('016_vehicle_maint_intervals_round.sql') ON CONFLICT DO NOTHING;
