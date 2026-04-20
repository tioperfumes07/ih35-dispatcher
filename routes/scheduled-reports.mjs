/**
 * Scheduled report definitions + background runner (POST/PATCH/DELETE).
 * Explicitly exempt from GET-only persistence policy — uses Postgres when DATABASE_URL is set.
 */

import { Router } from 'express';
import { getPool } from '../lib/db.mjs';
import { buildReportDataset } from '../lib/reports-datasets.mjs';
import { resolveReportDatasetContext, REPORT_DATASET_BY_HTTP_PATH } from './reports-rest-api.mjs';

function parseJsonFilters(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

async function runOneSchedule(deps, row) {
  const { logError } = deps;
  const path = String(row.report_path || '').trim();
  const datasetId = REPORT_DATASET_BY_HTTP_PATH[path];
  if (!datasetId) {
    return { ok: false, message: `Unknown report_path: ${path}`, rowCount: 0 };
  }
  const filters = parseJsonFilters(row.filters);
  try {
    const { erp, ctx } = await resolveReportDatasetContext(deps, filters, datasetId);
    const raw = await buildReportDataset(datasetId, erp, filters, ctx);
    const rows = Array.isArray(raw.rows) ? raw.rows.length : 0;
    const ok = raw && raw.ok !== false;
    return {
      ok,
      rowCount: rows,
      message: ok ? String(raw.title || 'OK') : String(raw.error || 'Report failed'),
      summary: {
        title: raw.title,
        meta: raw.meta || {},
        disclaimer: raw.disclaimer || ''
      }
    };
  } catch (e) {
    logError?.('scheduled-report-run', e);
    return { ok: false, message: e?.message || String(e), rowCount: 0 };
  }
}

export function mountScheduledReports(app, deps) {
  const { dbQuery, requireErpWriteOrAdmin, logError } = deps;

  const r = Router();

  r.get('/api/reports/schedules', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    try {
      const { rows } = await dbQuery(
        `SELECT id, title, report_path, interval_minutes, filters, enabled, last_run_at, next_run_at,
                last_ok, last_row_count, last_message, created_at, updated_at
         FROM erp_report_schedules ORDER BY id DESC LIMIT 200`
      );
      res.json({ ok: true, schedules: rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  r.post('/api/reports/schedules', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    try {
      const title = String(req.body?.title || '').trim() || 'Scheduled report';
      const report_path = String(req.body?.report_path || '').trim();
      if (!report_path || !REPORT_DATASET_BY_HTTP_PATH[report_path]) {
        return res.status(400).json({
          ok: false,
          error: `report_path must be a known tabular path (e.g. fuel/ifta). Allowed: ${Object.keys(REPORT_DATASET_BY_HTTP_PATH).slice(0, 8).join(', ')}…`
        });
      }
      const interval_minutes = Math.min(
        10080,
        Math.max(5, Number(req.body?.interval_minutes) || 1440)
      );
      const filters = parseJsonFilters(req.body?.filters);
      const enabled = req.body?.enabled !== false;
      const { rows } = await dbQuery(
        `INSERT INTO erp_report_schedules (title, report_path, interval_minutes, filters, enabled, next_run_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, now() + ($3 * interval '1 minute'))
         RETURNING *`,
        [title, report_path, interval_minutes, JSON.stringify(filters), enabled]
      );
      res.json({ ok: true, schedule: rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  r.patch('/api/reports/schedules/:id', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
      const sets = [];
      const vals = [];
      let i = 1;
      if (req.body?.title != null) {
        sets.push(`title = $${i++}`);
        vals.push(String(req.body.title).trim());
      }
      if (req.body?.interval_minutes != null) {
        const im = Math.min(10080, Math.max(5, Number(req.body.interval_minutes) || 1440));
        sets.push(`interval_minutes = $${i++}`);
        vals.push(im);
      }
      if (req.body?.filters != null) {
        sets.push(`filters = $${i++}::jsonb`);
        vals.push(JSON.stringify(parseJsonFilters(req.body.filters)));
      }
      if (req.body?.enabled != null) {
        sets.push(`enabled = $${i++}`);
        vals.push(!!req.body.enabled);
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: 'No fields to update' });
      sets.push('updated_at = now()');
      vals.push(id);
      const { rows } = await dbQuery(
        `UPDATE erp_report_schedules SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
      );
      if (!rows?.length) return res.status(404).json({ ok: false, error: 'Not found' });
      res.json({ ok: true, schedule: rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  r.delete('/api/reports/schedules/:id', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    try {
      const id = Number(req.params.id);
      await dbQuery(`DELETE FROM erp_report_schedules WHERE id = $1`, [id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  r.get('/api/reports/schedules/:id/runs', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL is not set' });
    try {
      const id = Number(req.params.id);
      const { rows } = await dbQuery(
        `SELECT id, ran_at, ok, row_count, message, report_path, payload_summary
         FROM erp_report_schedule_runs WHERE schedule_id = $1 ORDER BY ran_at DESC LIMIT 50`,
        [id]
      );
      res.json({ ok: true, runs: rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  app.use(r);
}

export function startReportScheduleRunner(deps) {
  const { dbQuery, logError } = deps;
  if (!getPool()) return;

  const tick = async () => {
    try {
      const { rows } = await dbQuery(
        `SELECT * FROM erp_report_schedules
         WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= now())
         ORDER BY next_run_at NULLS FIRST
         LIMIT 5`
      );
      for (const row of rows || []) {
        const out = await runOneSchedule(deps, row);
        await dbQuery(
          `INSERT INTO erp_report_schedule_runs (schedule_id, ok, row_count, message, report_path, payload_summary)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            row.id,
            out.ok,
            out.rowCount,
            String(out.message || '').slice(0, 2000),
            row.report_path,
            JSON.stringify(out.summary || {})
          ]
        );
        await dbQuery(
          `UPDATE erp_report_schedules SET
             last_run_at = now(),
             next_run_at = now() + COALESCE(interval_minutes, 1440) * interval '1 minute',
             last_ok = $2,
             last_row_count = $3,
             last_message = $4,
             updated_at = now()
           WHERE id = $1`,
          [row.id, out.ok, out.rowCount, String(out.message || '').slice(0, 500)]
        );
      }
    } catch (e) {
      logError?.('report-schedule-tick', e);
    }
  };

  setInterval(tick, 60_000);
  setTimeout(tick, 8000);
}
