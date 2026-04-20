-- Fleet mileage pace + canonical service / parts intervals (month columns derived from miles ÷ fleet_avg; FLOOR, min 1).
-- Does not remove existing maintenance_service_catalog rows.

CREATE TABLE IF NOT EXISTS erp_fleet_defaults (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  fleet_avg_miles_per_month INT NOT NULL DEFAULT 12000
    CHECK (fleet_avg_miles_per_month >= 1000 AND fleet_avg_miles_per_month <= 30000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT erp_fleet_defaults_singleton CHECK (id = 1)
);

INSERT INTO erp_fleet_defaults (id, fleet_avg_miles_per_month) VALUES (1, 12000)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  interval_miles INT,
  interval_months INT,
  notes TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES service_types (id) ON DELETE CASCADE,
  unit_code TEXT,
  interval_miles INT,
  interval_months INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_maint_sched_type_unit
  ON vehicle_maintenance_schedules (service_type_id, (COALESCE(unit_code, '')));

CREATE TABLE IF NOT EXISTS vehicle_parts_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_mid NUMERIC(12, 2)
);

INSERT INTO service_types (slug, name, category, interval_miles, interval_months, notes, vehicle_make, vehicle_model) VALUES
('engine_oil_filter_change', 'Engine oil and filter change', 'Engine', 25000, 2, 'At fleet average, oil change approximately every 2 months.', NULL, NULL),
('fuel_filter_primary', 'Fuel filter replacement (primary)', 'Engine', 25000, 2, NULL, NULL, NULL),
('fuel_filter_secondary', 'Fuel filter replacement (secondary)', 'Engine', 25000, 2, NULL, NULL, NULL),
('air_filter_replacement', 'Air filter replacement', 'Engine', 50000, 4, NULL, NULL, NULL),
('coolant_flush_refill', 'Coolant flush and refill', 'Engine', 600000, 50, NULL, NULL, NULL),
('turbocharger_replacement', 'Turbocharger replacement', 'Engine', 400000, 33, NULL, NULL, NULL),
('fuel_injector_service', 'Fuel injector service', 'Engine', 500000, 41, NULL, NULL, NULL),
('egr_valve_service', 'EGR valve cleaning or replacement', 'Engine', 200000, 16, NULL, NULL, NULL),
('water_pump_replacement', 'Water pump replacement', 'Engine', 300000, 25, NULL, NULL, NULL),
('alternator_replacement', 'Alternator replacement', 'Engine', 250000, 20, NULL, NULL, NULL),
('air_compressor_service', 'Air compressor service', 'Engine', 300000, 25, NULL, NULL, NULL),
('dpf_cleaning', 'DPF cleaning', 'Exhaust', 200000, 16, NULL, NULL, NULL),
('dpf_replacement', 'DPF replacement', 'Exhaust', 500000, 41, NULL, NULL, NULL),
('scr_catalyst_replacement', 'SCR catalyst replacement', 'Exhaust', 500000, 41, NULL, NULL, NULL),
('def_system_service', 'DEF system service', 'Exhaust', 50000, 4, NULL, NULL, NULL),
('brake_adjustment_all_axles', 'Brake adjustment (all axles)', 'Brakes', 25000, 2, 'Critical for DOT compliance at fleet mileage pace.', NULL, NULL),
('brake_lining_inspection', 'Brake lining inspection', 'Brakes', 50000, 4, NULL, NULL, NULL),
('brake_lining_replacement', 'Brake lining replacement', 'Brakes', 100000, 8, NULL, NULL, NULL),
('brake_drum_replacement', 'Brake drum replacement', 'Brakes', 300000, 25, NULL, NULL, NULL),
('slack_adjuster_replacement', 'Slack adjuster replacement', 'Brakes', 200000, 16, NULL, NULL, NULL),
('tire_replacement_steer', 'Tire replacement (steer)', 'Tires', 100000, 8, NULL, NULL, NULL),
('tire_replacement_drive', 'Tire replacement (drive)', 'Tires', 150000, 12, NULL, NULL, NULL),
('tire_rotation', 'Tire rotation', 'Tires', 50000, 4, NULL, NULL, NULL),
('tire_mount_balance', 'Tire mounting and balancing', 'Tires', NULL, NULL, 'As needed — no fixed interval.', NULL, NULL),
('air_bag_replacement_cab', 'Air bag replacement (cab)', 'Suspension', 200000, 16, NULL, NULL, NULL),
('air_bag_replacement_drive', 'Air bag replacement (drive axle)', 'Suspension', 200000, 16, NULL, NULL, NULL),
('shock_absorber_replacement', 'Shock absorber replacement', 'Suspension', 150000, 12, NULL, NULL, NULL),
('spring_leaf_inspection', 'Spring / leaf spring inspection', 'Suspension', 50000, 4, NULL, NULL, NULL),
('steering_linkage_inspection', 'Steering linkage inspection', 'Suspension', 25000, 2, NULL, NULL, NULL),
('power_steering_fluid_service', 'Power steering fluid service', 'Suspension', 100000, 8, NULL, NULL, NULL),
('wheel_bearing_inspection', 'Wheel bearing inspection', 'Suspension', 100000, 8, NULL, NULL, NULL),
('transmission_fluid_service', 'Transmission fluid service', 'Drivetrain', 500000, 41, NULL, NULL, NULL),
('differential_axle_oil_change', 'Differential / axle oil change', 'Drivetrain', 250000, 20, NULL, NULL, NULL),
('driveshaft_u_joint_inspection', 'Driveshaft / U-joint inspection', 'Drivetrain', 50000, 4, NULL, NULL, NULL),
('u_joint_replacement', 'U-joint replacement', 'Drivetrain', 200000, 16, NULL, NULL, NULL),
('clutch_replacement', 'Clutch replacement', 'Drivetrain', 300000, 25, NULL, NULL, NULL),
('battery_inspection_test', 'Battery inspection and test', 'Electrical', 50000, 4, NULL, NULL, NULL),
('battery_replacement', 'Battery replacement', 'Electrical', 150000, 12, NULL, NULL, NULL),
('lighting_inspection', 'Lighting inspection', 'Electrical', 25000, 2, NULL, NULL, NULL),
('fifth_wheel_inspection', 'Fifth wheel inspection', 'Chassis', 25000, 2, NULL, NULL, NULL),
('fifth_wheel_lubrication', 'Fifth wheel lubrication', 'Chassis', 25000, 2, NULL, NULL, NULL),
('frame_inspection', 'Frame inspection', 'Chassis', 100000, 8, NULL, NULL, NULL),
('air_dryer_cartridge_replacement', 'Air dryer cartridge replacement', 'Air system', 150000, 12, NULL, NULL, NULL),
('air_system_inspection', 'Air system inspection', 'Air system', 25000, 2, NULL, NULL, NULL),
('engine_oil_volvo_vnl', 'Engine oil and filter change (Volvo VNL)', 'Engine', 40000, 3, 'Volvo D13 extended drain; check oil analysis at 3 months.', 'Volvo', 'VNL'),
('engine_oil_volvo_vnr', 'Engine oil and filter change (Volvo VNR)', 'Engine', 35000, 2, 'Regional use; inspect at 2 months.', 'Volvo', 'VNR'),
('dpf_cleaning_volvo_vnr', 'DPF cleaning (Volvo VNR)', 'Exhaust', 150000, 12, 'More frequent due to regional stop-and-go.', 'Volvo', 'VNR'),
('brake_adjust_volvo_vnr', 'Brake adjustment (Volvo VNR)', 'Brakes', 20000, 1, 'Monthly brake check for regional use.', 'Volvo', 'VNR'),
('engine_oil_peterbilt_567', 'Engine oil and filter change (Peterbilt 567)', 'Engine', 20000, 1, 'Heavy vocational use; monthly oil changes.', 'Peterbilt', '567'),
('fuel_filter_primary_peterbilt_567', 'Fuel filter replacement — primary (Peterbilt 567)', 'Engine', 15000, 1, '15k mi vocational interval; check monthly.', 'Peterbilt', '567'),
('dpf_cleaning_peterbilt_567', 'DPF cleaning (Peterbilt 567)', 'Exhaust', 150000, 12, NULL, 'Peterbilt', '567'),
('brake_adjust_peterbilt_567', 'Brake adjustment (Peterbilt 567)', 'Brakes', 20000, 1, NULL, 'Peterbilt', '567')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  interval_miles = EXCLUDED.interval_miles,
  interval_months = EXCLUDED.interval_months,
  notes = EXCLUDED.notes,
  vehicle_make = EXCLUDED.vehicle_make,
  vehicle_model = EXCLUDED.vehicle_model,
  active = true;

UPDATE service_types st SET interval_months = CASE
  WHEN st.interval_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(st.interval_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END;

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

INSERT INTO vehicle_parts_reference (part_key, label, avg_replacement_miles, avg_replacement_months, avg_cost_mid) VALUES
('steer_tire', 'Steer tire', 100000, 8, 550),
('drive_tire', 'Drive tire', 150000, 12, 450),
('brake_lining_axle', 'Brake lining per axle', 100000, 8, 320),
('brake_drum', 'Brake drum', 300000, 25, 400),
('air_bag', 'Air bag / air spring', 200000, 16, 280),
('shock_absorber', 'Shock absorber', 150000, 12, 180),
('battery_group_31', 'Battery Group 31', 150000, 12, 350),
('fuel_injector_set', 'Fuel injector set', 500000, 41, 2200),
('turbocharger', 'Turbocharger', 400000, 33, 3500),
('egr_valve', 'EGR valve', 200000, 16, 900),
('water_pump', 'Water pump', 300000, 25, 650),
('alternator', 'Alternator', 250000, 20, 550),
('dpf', 'DPF', 500000, 41, 2500),
('scr_catalyst', 'SCR catalyst', 500000, 41, 4000),
('clutch', 'Clutch', 300000, 25, 4500),
('u_joint', 'U-joint', 200000, 16, 120),
('fifth_wheel_complete', 'Fifth wheel complete', 500000, 41, 1800),
('engine_oil_filter', 'Engine oil filter', 25000, 2, 45),
('fuel_filter_set', 'Fuel filter set', 25000, 2, 85),
('air_filter', 'Air filter', 50000, 4, 95),
('air_dryer_cartridge', 'Air dryer cartridge', 150000, 12, 140)
ON CONFLICT (part_key) DO UPDATE SET
  label = EXCLUDED.label,
  avg_replacement_miles = EXCLUDED.avg_replacement_miles,
  avg_replacement_months = EXCLUDED.avg_replacement_months,
  avg_cost_mid = EXCLUDED.avg_cost_mid;

UPDATE vehicle_parts_reference pr SET avg_replacement_months = CASE
  WHEN pr.avg_replacement_miles IS NULL THEN NULL
  ELSE GREATEST(
    1,
    FLOOR(pr.avg_replacement_miles::numeric / (SELECT fleet_avg_miles_per_month FROM erp_fleet_defaults WHERE id = 1))
  )
END;

INSERT INTO schema_migrations (filename) VALUES ('015_fleet_intervals_and_settings.sql') ON CONFLICT DO NOTHING;
