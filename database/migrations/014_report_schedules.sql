-- Server-side scheduled tabular reports (POST/PATCH/DELETE — not GET-only).
-- Runner uses resolveReportDatasetContext + buildReportDataset; see routes/scheduled-reports.mjs.

CREATE TABLE IF NOT EXISTS erp_report_schedules (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  report_path TEXT NOT NULL,
  interval_minutes INT NOT NULL DEFAULT 1440 CHECK (interval_minutes >= 5 AND interval_minutes <= 10080),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_ok BOOLEAN,
  last_row_count INT,
  last_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erp_report_schedule_runs (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES erp_report_schedules (id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  row_count INT,
  message TEXT,
  report_path TEXT,
  payload_summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_erp_report_schedules_next ON erp_report_schedules (next_run_at)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_erp_report_schedule_runs_sched ON erp_report_schedule_runs (schedule_id, ran_at DESC);
