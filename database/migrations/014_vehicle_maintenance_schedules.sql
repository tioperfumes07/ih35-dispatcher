-- OEM-style preventive maintenance intervals for fleet intelligence / PM planning.
CREATE TABLE IF NOT EXISTS vehicle_maintenance_schedules (
  id BIGSERIAL PRIMARY KEY,
  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  year_min INT NOT NULL,
  year_max INT NOT NULL,
  service_name TEXT NOT NULL,
  interval_miles INT,
  interval_months INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maint_sched_lookup
  ON vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max);

-- Volvo VNL (2019-2024)
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Volvo','VNL',2019,2024,'Engine oil and filter',40000,6,'Volvo D13 engine. Extended drain with Volvo Oil Service (VOS) program up to 80,000 miles. Uses CK-4 oil.'),
('Volvo','VNL',2019,2024,'Fuel filter',40000,12,'Primary and secondary filters. More frequent in poor fuel areas.'),
('Volvo','VNL',2019,2024,'Air filter',60000,12,NULL),
('Volvo','VNL',2019,2024,'I-Shift transmission (automated)',500000,60,'Volvo I-Shift AMT. Lifetime fill unless contaminated.'),
('Volvo','VNL',2019,2024,'Differential / drive axle',250000,24,NULL),
('Volvo','VNL',2019,2024,'Coolant (NOAT extended life)',600000,60,'Volvo NOAT coolant. Do not mix with OAT or HOAT coolants.'),
('Volvo','VNL',2019,2024,'DPF cleaning',200000,24,'Volvo after-treatment system. Forced regen first, physical clean when ash load is high.'),
('Volvo','VNL',2019,2024,'Brake adjustment',25000,3,NULL),
('Volvo','VNL',2019,2024,'Brake lining inspection',50000,6,NULL),
('Volvo','VNL',2019,2024,'Air dryer cartridge',150000,12,NULL),
('Volvo','VNL',2019,2024,'Fifth wheel lubrication',25000,3,NULL),
('Volvo','VNL',2019,2024,'Battery inspection',50000,6,'Volvo trucks run 4-8 batteries. Test load capacity annually.');

-- Volvo VNR (2018-2024)
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Volvo','VNR',2018,2024,'Engine oil and filter',35000,6,'Volvo D11 or D13. VNR typically used for regional routes — check more frequently for stop-and-go routes.'),
('Volvo','VNR',2018,2024,'Fuel filter',35000,12,NULL),
('Volvo','VNR',2018,2024,'Air filter',50000,12,NULL),
('Volvo','VNR',2018,2024,'I-Shift transmission',500000,60,NULL),
('Volvo','VNR',2018,2024,'Differential / drive axle',250000,24,NULL),
('Volvo','VNR',2018,2024,'Coolant',600000,60,NULL),
('Volvo','VNR',2018,2024,'DPF cleaning',150000,18,'More frequent than VNL due to regional/stop-go driving patterns.'),
('Volvo','VNR',2018,2024,'Brake adjustment',20000,3,'More frequent for regional use.'),
('Volvo','VNR',2018,2024,'Brake lining inspection',40000,6,NULL),
('Volvo','VNR',2018,2024,'Air dryer',100000,12,NULL),
('Volvo','VNR',2018,2024,'Fifth wheel lubrication',25000,3,NULL);

-- Peterbilt 389 (2019-2024) — Cummins X15 common
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Peterbilt','389',2019,2024,'Engine oil and filter (Cummins X15)',25000,6,'Cummins X15 engine. CK-4 or CJ-4 oil. Cummins recommends 25k for highway use.'),
('Peterbilt','389',2019,2024,'Fuel filter (Cummins)',25000,12,NULL),
('Peterbilt','389',2019,2024,'Air filter',50000,12,NULL),
('Peterbilt','389',2019,2024,'Transmission (Eaton Fuller or Automated)',500000,48,NULL),
('Peterbilt','389',2019,2024,'Rear axle / differential',250000,24,NULL),
('Peterbilt','389',2019,2024,'Coolant',600000,60,'Cummins fully formulated coolant or equivalent NOAT/HOAT.'),
('Peterbilt','389',2019,2024,'DPF / aftertreatment',200000,24,NULL),
('Peterbilt','389',2019,2024,'Brake adjustment',25000,3,NULL),
('Peterbilt','389',2019,2024,'Brake lining inspection',50000,6,NULL),
('Peterbilt','389',2019,2024,'Air dryer',150000,12,NULL),
('Peterbilt','389',2019,2024,'Steering inspection',25000,6,NULL),
('Peterbilt','389',2019,2024,'Fifth wheel lubrication',25000,3,NULL);

-- Peterbilt 567 (2018-2024) — PACCAR MX-13
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Peterbilt','567',2018,2024,'Engine oil and filter',20000,6,'PACCAR MX-13. More frequent than 579 due to heavier duty cycle. Check oil analysis for extended drain.'),
('Peterbilt','567',2018,2024,'Fuel filter (primary)',15000,6,NULL),
('Peterbilt','567',2018,2024,'Fuel filter (secondary)',20000,12,NULL),
('Peterbilt','567',2018,2024,'Air filter',50000,12,NULL),
('Peterbilt','567',2018,2024,'Transmission',500000,48,NULL),
('Peterbilt','567',2018,2024,'Rear axle / differential',250000,24,NULL),
('Peterbilt','567',2018,2024,'Coolant',600000,60,NULL),
('Peterbilt','567',2018,2024,'DPF cleaning',150000,18,'More frequent due to heavier duty vocational use.'),
('Peterbilt','567',2018,2024,'Brake adjustment',20000,3,NULL),
('Peterbilt','567',2018,2024,'Brake lining inspection',40000,6,NULL),
('Peterbilt','567',2018,2024,'Air dryer',100000,12,NULL),
('Peterbilt','567',2018,2024,'Fifth wheel lubrication',25000,3,NULL);

-- Mack Anthem 2023 (extends fleet coverage for 2023 MY Anthem units)
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Mack','Anthem',2023,2023,'Engine oil and filter',25000,6,'MP8 engine typical; follow Mack EOS-4.5 / CK-4 for US07+ emissions hardware.'),
('Mack','Anthem',2023,2023,'Fuel filters',25000,12,'Primary and secondary per Mack severe-duty schedule.'),
('Mack','Anthem',2023,2023,'Differential service',250000,24,NULL),
('Mack','Anthem',2023,2023,'DPF ash service',250000,24,'Ash load monitor; forced regen before shop clean.'),
('Mack','Anthem',2023,2023,'Brake stroke / S-cam inspection',25000,3,NULL);

-- Peterbilt 579 (2022 / 2024 MY coverage — same PACCAR MX as late 579 production)
INSERT INTO vehicle_maintenance_schedules (vehicle_make, vehicle_model, year_min, year_max, service_name, interval_miles, interval_months, notes) VALUES
('Peterbilt','579',2022,2022,'Engine oil and filter',25000,6,'PACCAR MX-13 typical; align with OEM oil analysis for extended drain.'),
('Peterbilt','579',2022,2022,'Fuel filter',25000,12,NULL),
('Peterbilt','579',2024,2024,'Engine oil and filter',25000,6,'PACCAR MX-13 typical; align with OEM oil analysis for extended drain.'),
('Peterbilt','579',2024,2024,'Fuel filter',25000,12,NULL);

INSERT INTO schema_migrations (filename) VALUES ('014_vehicle_maintenance_schedules.sql') ON CONFLICT DO NOTHING;
