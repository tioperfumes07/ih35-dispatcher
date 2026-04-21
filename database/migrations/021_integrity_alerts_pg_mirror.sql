-- Postgres mirror columns for integrity alerts (ERP JSON remains canonical for the running app).

ALTER TABLE public.integrity_alerts
  ADD COLUMN IF NOT EXISTS erp_alert_id TEXT;

ALTER TABLE public.integrity_alerts
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

ALTER TABLE public.integrity_alerts
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.integrity_alerts
  ADD COLUMN IF NOT EXISTS details_json JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_integrity_alerts_erp_alert_id
  ON public.integrity_alerts (erp_alert_id)
  WHERE erp_alert_id IS NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('021_integrity_alerts_pg_mirror.sql') ON CONFLICT DO NOTHING;
