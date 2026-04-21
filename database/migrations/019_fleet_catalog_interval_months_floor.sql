-- Recompute stored month columns from mileage using FLOOR(miles / fleet_avg), minimum 1.
-- Replaces 016's ROUND-based values; then re-applies fleet scheduling overrides (must match lib/fleet-mileage-settings.mjs applyFleetCatalogMonthOverrides).

UPDATE service_types
SET interval_months = CASE
  WHEN interval_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(interval_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END;

UPDATE vehicle_maintenance_schedules
SET interval_months = CASE
  WHEN interval_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(interval_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END;

UPDATE vehicle_parts_reference
SET avg_replacement_months = CASE
  WHEN avg_replacement_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(avg_replacement_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END;

UPDATE service_types
SET interval_months = 12
WHERE slug IN (
    'air_dryer_cartridge_replacement',
    'tire_replacement_drive',
    'dpf_cleaning_volvo_vnr',
    'dpf_cleaning_peterbilt_567'
  )
  AND interval_miles IS NOT NULL
  AND interval_miles BETWEEN 140000 AND 160000;

UPDATE service_types
SET interval_months = 18
WHERE slug IN ('dpf_cleaning', 'egr_valve_service')
  AND interval_miles >= 190000
  AND interval_miles <= 210000;

UPDATE service_types
SET interval_months = 42
WHERE slug IN ('fuel_injector_service', 'transmission_fluid_service')
  AND interval_miles >= 450000;

UPDATE vehicle_maintenance_schedules v
SET interval_miles = st.interval_miles,
  interval_months = st.interval_months
FROM service_types st
WHERE v.service_type_id = st.id
  AND v.unit_code IS NULL;

UPDATE vehicle_parts_reference
SET avg_replacement_months = 12
WHERE part_key IN ('drive_tire', 'air_dryer_cartridge')
  AND avg_replacement_miles IS NOT NULL
  AND avg_replacement_miles BETWEEN 140000 AND 160000;

UPDATE vehicle_parts_reference
SET avg_replacement_months = 18
WHERE part_key = 'egr_valve'
  AND avg_replacement_miles BETWEEN 190000 AND 210000;

UPDATE vehicle_parts_reference
SET avg_replacement_months = 42
WHERE part_key IN ('fuel_injector_set', 'dpf', 'scr_catalyst', 'fifth_wheel_complete')
  AND avg_replacement_miles >= 450000;

INSERT INTO schema_migrations (filename) VALUES ('019_fleet_catalog_interval_months_floor.sql') ON CONFLICT DO NOTHING;
