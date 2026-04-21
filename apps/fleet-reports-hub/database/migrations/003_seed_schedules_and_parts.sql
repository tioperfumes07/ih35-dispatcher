-- Seed schedules (all makes share same interval table; adjust per-make later if needed).
INSERT INTO vehicle_maintenance_schedules (
  vehicle_make_key,
  service_key,
  service_label,
  interval_miles,
  interval_months_floor
)
SELECT
  m.k,
  s.sk,
  s.lbl,
  s.mi,
  FLOOR(
    s.mi::numeric
    / COALESCE(
      (SELECT value_numeric FROM fleet_settings WHERE key = 'fleet_avg_miles_per_month' LIMIT 1),
      12000
    )
  )::int
FROM (
  VALUES
    ('generic'),
    ('freightliner_cascadia'),
    ('mack_anthem'),
    ('peterbilt_579'),
    ('peterbilt_567'),
    ('peterbilt_389'),
    ('volvo_vnl'),
    ('volvo_vnr')
) AS m (k)
CROSS JOIN (
  VALUES
    ('oil_change', 'Oil change', 25000),
    ('brake_adjustment', 'Brake adjustment', 25000),
    ('air_filter', 'Air filter', 50000),
    ('tire_steer', 'Tire steer', 100000),
    ('tire_drive', 'Tire drive', 150000),
    ('dpf_cleaning', 'DPF cleaning', 200000),
    ('battery', 'Battery', 150000),
    ('differential', 'Differential', 250000),
    ('transmission', 'Transmission', 500000),
    ('coolant', 'Coolant', 600000)
) AS s (sk, lbl, mi)
ON CONFLICT (vehicle_make_key, service_key) DO NOTHING;

INSERT INTO vehicle_parts_reference (category, part_name, cost_low, cost_mid, cost_high, notes)
VALUES
  ('tires', 'Steer position (single)', 420, 780, 1250, 'Regional variance'),
  ('tires', 'Drive position (single)', 380, 720, 1180, NULL),
  ('brakes', 'Brake shoe kit (axle)', 180, 420, 890, NULL),
  ('brakes', 'Drum resurfacing', 90, 160, 320, NULL),
  ('air_bags', 'Air spring assembly', 220, 480, 920, NULL),
  ('batteries', 'Group 31 flooded', 140, 260, 420, NULL),
  ('batteries', 'AGM starting', 220, 380, 620, NULL),
  ('engine_components', 'Turbo cartridge', 1200, 2800, 5200, NULL),
  ('engine_components', 'Aftertreatment sensor kit', 180, 420, 980, NULL),
  ('drivetrain', 'Differential bearing kit', 320, 780, 1600, NULL),
  ('drivetrain', 'Transmission clutch pack', 2200, 4800, 9200, NULL)
ON CONFLICT (category, part_name) DO NOTHING;
