CREATE TABLE IF NOT EXISTS relay_card_assignments (
  id SERIAL PRIMARY KEY,
  card_last4 TEXT NOT NULL,
  unit_number TEXT,
  driver_name TEXT,
  vendor_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  assigned_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_card_assignments_card_last4_active
  ON relay_card_assignments (card_last4)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_relay_card_assignments_unit
  ON relay_card_assignments (unit_number, active);

CREATE TABLE IF NOT EXISTS relay_webhook_events (
  id SERIAL PRIMARY KEY,
  external_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  error_message TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_webhook_events_external_event_id
  ON relay_webhook_events (external_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relay_webhook_events_payload_hash
  ON relay_webhook_events (payload_hash);

ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS relay_event_id TEXT;
ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS relay_txn_id TEXT;
ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS relay_card_last4 TEXT;
ALTER TABLE IF EXISTS fuel_expenses ADD COLUMN IF NOT EXISTS relay_vendor TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fuel_expenses_relay_txn
  ON fuel_expenses (relay_txn_id)
  WHERE relay_txn_id IS NOT NULL;

INSERT INTO schema_migrations (filename)
VALUES ('026_relay_webhook_foundation.sql')
ON CONFLICT DO NOTHING;
