-- Maintenance intelligence: OEM-style schedules + parts benchmarks (read-only reference).
-- Separate from operational 015 tables (service_types / vehicle_maintenance_schedules / vehicle_parts_reference).

ALTER TABLE trucks
  ADD COLUMN IF NOT EXISTS vehicle_year INT,
  ADD COLUMN IF NOT EXISTS vehicle_make TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
  ADD COLUMN IF NOT EXISTS vin TEXT,
  ADD COLUMN IF NOT EXISTS engine_serial TEXT;

CREATE TABLE IF NOT EXISTS research_oem_vehicle_schedules (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_from INT NOT NULL,
  year_to INT NOT NULL,
  engine_family TEXT,
  service_type TEXT NOT NULL,
  interval_miles INT,
  interval_months INT,
  interval_engine_hours INT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'OEM / fleet intelligence reference',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_oem_sched_lookup
  ON research_oem_vehicle_schedules (lower(make), lower(model), year_from, year_to);

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_oem_service
  ON research_oem_vehicle_schedules (make, model, year_from, year_to, service_type);

CREATE TABLE IF NOT EXISTS research_vehicle_parts_benchmark (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL DEFAULT 'ALL',
  model TEXT NOT NULL DEFAULT 'ALL',
  year_from INT NOT NULL DEFAULT 2000,
  year_to INT NOT NULL DEFAULT 2026,
  part_category TEXT NOT NULL,
  part_name TEXT NOT NULL,
  avg_replacement_miles INT,
  avg_replacement_months INT,
  avg_cost_low NUMERIC(12, 2),
  avg_cost_high NUMERIC(12, 2),
  avg_cost_mid NUMERIC(12, 2),
  notes TEXT,
  last_updated DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_research_parts_lookup
  ON research_vehicle_parts_benchmark (lower(make), lower(model));

CREATE UNIQUE INDEX IF NOT EXISTS uq_research_parts_row
  ON research_vehicle_parts_benchmark (make, model, year_from, year_to, part_name);

CREATE TABLE IF NOT EXISTS research_company_custom_parts (
  id BIGSERIAL PRIMARY KEY,
  make TEXT NOT NULL DEFAULT 'ALL',
  model TEXT NOT NULL DEFAULT 'ALL',
  part_name TEXT NOT NULL,
  avg_life_miles INT,
  avg_life_months INT,
  cost_low NUMERIC(12, 2),
  cost_high NUMERIC(12, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Freightliner Cascadia (2007–2026)
INSERT INTO research_oem_vehicle_schedules (make, model, year_from, year_to, service_type, interval_miles, interval_months, interval_engine_hours, notes, source) VALUES
('Freightliner', 'Cascadia', 2007, 2026, 'Engine oil and filter change', 25000, 6, NULL, 'Detroit DD13/DD15/DD16 with CJ-4 oil. Extended drain up to 50,000 mi with oil analysis program.', 'Freightliner / Detroit'),
('Freightliner', 'Cascadia', 2007, 2026, 'Fuel filter (primary and secondary)', 25000, 12, NULL, 'Replace both primary and secondary. More frequent if fuel quality is poor.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Air filter (engine)', 50000, 12, NULL, 'Check restriction indicator. Replace when indicator shows red.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Transmission service (Automated)', 500000, 48, NULL, 'DT12 automated transmission. Fluid life monitoring via dash display.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Differential service (front and rear)', 250000, 24, NULL, 'Drain and refill with approved synthetic gear oil.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Coolant system / antifreeze', 600000, 60, NULL, 'Extended life coolant. Test SCA concentration every PM service.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Belt and tensioner inspection', 100000, 12, NULL, 'Inspect serpentine belt for cracks. Replace at 200,000 miles or if worn.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Brake adjustment (all axles)', 25000, 3, NULL, 'S-cam brakes require regular adjustment. Check stroke at each PM.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Brake linings / shoes inspection', 50000, 6, NULL, 'Replace when lining thickness drops below 1/4 inch.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Wheel bearing inspection', 100000, 12, NULL, 'Check end play and preload. Repack or replace as needed.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Tire rotation', 50000, NULL, NULL, 'Rotate and check tread depth. Replace at 4/32 inch tread depth.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Steering system inspection', 25000, 6, NULL, 'Check tie rod ends, king pins, steering linkage for wear.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Air dryer cartridge', 150000, 12, NULL, 'Bendix or Wabco air dryer. Replace cartridge annually or as needed.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Fuel injector inspection', 500000, NULL, NULL, 'Detroit engine injectors. Service based on performance data.', 'Detroit'),
('Freightliner', 'Cascadia', 2007, 2026, 'EGR system cleaning', 200000, NULL, NULL, 'Exhaust gas recirculation system. Clean cooler and valve.', 'Detroit'),
('Freightliner', 'Cascadia', 2007, 2026, 'DPF cleaning (diesel particulate filter)', 200000, 24, NULL, 'Forced regen if ash load >90%. Physical cleaning when needed.', 'Freightliner'),
('Freightliner', 'Cascadia', 2007, 2026, 'Cab air suspension inspection', 100000, 12, NULL, 'Check air bags, shocks, height control valve.', 'Freightliner')
ON CONFLICT (make, model, year_from, year_to, service_type) DO NOTHING;

-- Mack Anthem (2018–2026)
INSERT INTO research_oem_vehicle_schedules (make, model, year_from, year_to, service_type, interval_miles, interval_months, notes, source) VALUES
('Mack', 'Anthem', 2018, 2026, 'Engine oil and filter', 25000, 6, 'Mack MP8 engine. Use CJ-4 or FA-4 oil. Extended to 50,000 mi with Mack oil analysis (GOLD+ program).', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Fuel filter', 25000, 12, 'Spin-on primary filter. Replace at each oil change in poor fuel areas.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Air filter', 50000, 12, 'Check restriction indicator monthly. Replace immediately if restricted.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'mDRIVE transmission fluid', 500000, 48, 'Mack mDrive automated transmission. Lifetime fluid unless contaminated.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Differential / drive axle oil', 250000, 24, 'Mack rear tandem axles. Use approved synthetic 75W-90.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Coolant (ELC)', 600000, 60, 'Mack extended life coolant. SCA not required — DCA4 added only if switching coolant types.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Brake adjustment', 25000, 3, 'All axles. Critical for DOT compliance. Check cam rotation.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Brake lining inspection', 50000, 6, NULL, 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'DPF cleaning', 200000, 24, 'Forced active regen first. Physical cleaning when ash accumulates.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Air dryer cartridge', 150000, 12, 'Check desiccant cartridge. Replace if contaminated with oil.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Steering linkage inspection', 25000, 6, NULL, 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Wheel end / hub oil', 100000, 12, 'Meritor hub oil. Check level and look for leaks at each PM.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Fifth wheel inspection and lubrication', 25000, 3, 'Grease top plate. Check for cracks, wear on locking mechanism.', 'Mack'),
('Mack', 'Anthem', 2018, 2026, 'Battery inspection', 50000, 6, 'Check terminal corrosion, load test batteries annually.', 'Mack')
ON CONFLICT (make, model, year_from, year_to, service_type) DO NOTHING;

-- Peterbilt 579 (2012–2026)
INSERT INTO research_oem_vehicle_schedules (make, model, year_from, year_to, service_type, interval_miles, interval_months, notes, source) VALUES
('Peterbilt', '579', 2012, 2026, 'Engine oil and filter', 25000, 6, 'PACCAR MX-13 engine. CJ-4 oil. Extended drain available with PACCAR oil analysis.', 'Peterbilt / PACCAR'),
('Peterbilt', '579', 2012, 2026, 'Fuel filter (primary)', 15000, 6, 'More frequent than other makes due to MX-13 fuel system sensitivity.', 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Fuel filter (secondary)', 25000, 12, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Air filter', 50000, 12, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Transmission (PACCAR TX-12)', 500000, 48, 'Automated manual transmission. Lifetime fill. Change only if contaminated or after major repair.', 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Rear axle / differential', 250000, 24, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Coolant', 600000, 60, 'PACCAR extended life coolant.', 'PACCAR'),
('Peterbilt', '579', 2012, 2026, 'DPF / aftertreatment cleaning', 200000, 24, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Brake adjustment (all axles)', 25000, 3, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Brake lining inspection', 50000, 6, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Air dryer cartridge', 150000, 12, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Steering inspection', 25000, 6, NULL, 'Peterbilt'),
('Peterbilt', '579', 2012, 2026, 'Fifth wheel lubrication', 25000, 3, NULL, 'Peterbilt')
ON CONFLICT (make, model, year_from, year_to, service_type) DO NOTHING;

-- Generic ALL / ALL (2000–2026)
INSERT INTO research_oem_vehicle_schedules (make, model, year_from, year_to, service_type, interval_miles, interval_months, notes, source) VALUES
('ALL', 'ALL', 2000, 2026, 'Engine oil and filter', 25000, 6, 'General commercial truck standard. Verify with OEM manual for your engine.', 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Fuel filter', 25000, 12, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Air filter', 50000, 12, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Transmission service', 250000, 24, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Differential / axle oil', 250000, 24, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Brake adjustment', 25000, 3, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Brake lining inspection', 50000, 6, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Annual DOT inspection', NULL, 12, 'Required by FMCSA for all CMVs. Must be performed by certified inspector.', 'FMCSA'),
('ALL', 'ALL', 2000, 2026, 'Tire inspection and rotation', 50000, 6, NULL, 'Industry reference'),
('ALL', 'ALL', 2000, 2026, 'Fifth wheel lubrication', 25000, 3, NULL, 'Industry reference')
ON CONFLICT (make, model, year_from, year_to, service_type) DO NOTHING;

-- Parts benchmarks (Class 8 long-haul — industry averages)
INSERT INTO research_vehicle_parts_benchmark (make, model, year_from, year_to, part_category, part_name, avg_replacement_miles, avg_replacement_months, avg_cost_low, avg_cost_high, avg_cost_mid, notes) VALUES
('ALL', 'ALL', 2000, 2026, 'Tires', 'Steer tire (front)', 100000, NULL, 350, 600, 475, 'Premium brands at high end. Highway use extends life.'),
('ALL', 'ALL', 2000, 2026, 'Tires', 'Drive tire (rear, per tire)', 150000, NULL, 300, 550, 425, 'Tandem drive axle tires. Proper inflation critical.'),
('ALL', 'ALL', 2000, 2026, 'Tires', 'Trailer tire (if applicable)', 100000, NULL, 200, 400, 300, NULL),
('ALL', 'ALL', 2000, 2026, 'Tires', 'Tire mounting and balancing (per tire)', NULL, NULL, 25, 75, 45, NULL),
('ALL', 'ALL', 2000, 2026, 'Brakes', 'Brake lining / shoes (per axle set)', 100000, NULL, 150, 400, 250, 'Drive axle linings wear faster than steer.'),
('ALL', 'ALL', 2000, 2026, 'Brakes', 'Brake drum (per drum)', 300000, NULL, 100, 250, 175, NULL),
('ALL', 'ALL', 2000, 2026, 'Brakes', 'Slack adjuster (per unit)', 200000, NULL, 50, 150, 85, NULL),
('ALL', 'ALL', 2000, 2026, 'Suspension', 'Air bag / air spring (per bag)', 200000, NULL, 100, 300, 175, 'Cab vs trailer bags differ.'),
('ALL', 'ALL', 2000, 2026, 'Suspension', 'Shock absorber (per unit)', 150000, NULL, 75, 200, 125, NULL),
('ALL', 'ALL', 2000, 2026, 'Electrical', 'Battery (per unit, Group 31)', 150000, 36, 150, 350, 225, 'Class 8 trucks typically run 4-6 batteries.'),
('ALL', 'ALL', 2000, 2026, 'Engine', 'Injector set (all cylinders)', 500000, NULL, 3000, 8000, 5000, 'Detroit DD15 style; labor varies.'),
('ALL', 'ALL', 2000, 2026, 'Engine', 'Turbocharger', 400000, NULL, 1500, 4000, 2500, NULL),
('ALL', 'ALL', 2000, 2026, 'Engine', 'EGR valve', 200000, NULL, 500, 1500, 900, NULL),
('ALL', 'ALL', 2000, 2026, 'Engine', 'Water pump', 300000, NULL, 300, 800, 500, NULL),
('ALL', 'ALL', 2000, 2026, 'Engine', 'Alternator', 250000, NULL, 300, 700, 475, NULL),
('ALL', 'ALL', 2000, 2026, 'Engine', 'Air compressor', 300000, NULL, 500, 1500, 900, NULL),
('ALL', 'ALL', 2000, 2026, 'Exhaust', 'DPF (diesel particulate filter)', 500000, NULL, 2000, 5000, 3200, 'Often cleaned; cleaning $300-600.'),
('ALL', 'ALL', 2000, 2026, 'Exhaust', 'SCR catalyst', 500000, NULL, 3000, 8000, 5000, NULL),
('ALL', 'ALL', 2000, 2026, 'Drivetrain', 'Clutch (manual transmission)', 300000, NULL, 1500, 4000, 2500, NULL),
('ALL', 'ALL', 2000, 2026, 'Drivetrain', 'U-joint / driveshaft', 200000, NULL, 200, 600, 350, NULL),
('ALL', 'ALL', 2000, 2026, 'Drivetrain', 'Fifth wheel (complete)', 500000, NULL, 800, 2000, 1200, NULL),
('ALL', 'ALL', 2000, 2026, 'Filters', 'Engine oil filter', 25000, NULL, 15, 45, 28, NULL),
('ALL', 'ALL', 2000, 2026, 'Filters', 'Fuel filter set', 25000, NULL, 50, 120, 75, NULL),
('ALL', 'ALL', 2000, 2026, 'Filters', 'Air filter element', 50000, NULL, 40, 100, 65, NULL),
('ALL', 'ALL', 2000, 2026, 'Filters', 'Air dryer cartridge', 150000, NULL, 50, 150, 90, NULL)
ON CONFLICT (make, model, year_from, year_to, part_name) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('017_research_maintenance_intel.sql') ON CONFLICT DO NOTHING;
