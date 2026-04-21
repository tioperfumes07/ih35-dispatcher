-- Recompute stored month columns from mileage at current fleet_avg (FLOOR, min 1).
-- Supersedes migration 016 ROUND-based values for existing databases.

UPDATE service_types SET interval_months = CASE
  WHEN interval_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(interval_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END
WHERE interval_miles IS NOT NULL;

UPDATE vehicle_maintenance_schedules SET interval_months = CASE
  WHEN interval_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(interval_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END
WHERE interval_miles IS NOT NULL;

UPDATE vehicle_parts_reference SET avg_replacement_months = CASE
  WHEN avg_replacement_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(avg_replacement_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END
WHERE avg_replacement_miles IS NOT NULL;

-- Fleet-wide schedules mirror service_types month + mile columns.
UPDATE vehicle_maintenance_schedules v SET
  interval_miles = st.interval_miles,
  interval_months = st.interval_months
FROM service_types st
WHERE v.service_type_id = st.id AND v.unit_code IS NULL;

INSERT INTO schema_migrations (filename) VALUES ('019_fleet_catalog_interval_months_floor.sql') ON CONFLICT DO NOTHING;
