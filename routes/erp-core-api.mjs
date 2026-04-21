
import { readFullErpJson, writeFullErpJson } from '../lib/read-erp.mjs';
import { mergeIntegrityThresholds, evaluateIntegrityCheck, defaultIntegrityThresholds } from '../lib/integrity-engine.mjs';
import {
  mergeEngineAlertsIntoErp,
  enrichIntegrityAlertRow,
  filterAlertsForQuery,
  computeIntegrityKpis,
  findAlertById,
  buildInvestigatePayload,
  sortEnrichedAlertsDesc
} from '../lib/integrity-persist.mjs';

  function maintActor(req) {
    return String(req.headers['x-ih35-user'] || req.headers['x-user-email'] || 'operator').trim() || 'operator';
  }
        let missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have.has(n));
        if (missing.includes('merge_log') || missing.includes('dedup_skipped')) {
          try {
            const { ensureDedupeWritePathObjects } = await import('../lib/ensure-app-database-objects.mjs');
            await ensureDedupeWritePathObjects();
            const r2 = await dbQuery(
              `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
              [DEDUPE_SUPPORT_TABLE_NAMES]
            );
            const have2 = new Set((r2.rows || []).map(r => r.table_name));
            missing = DEDUPE_SUPPORT_TABLE_NAMES.filter(n => !have2.has(n));
            supportTables = { ok: missing.length === 0, missing, healedMergeAudit: true };
          } catch (healErr) {
            supportTables = {
              ok: false,
              missing,
              healedMergeAudit: false,
              healError: healErr?.message || String(healErr)
            };
          }
        } else {
          supportTables = { ok: missing.length === 0, missing };
        }
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const q = req.query || {};
      const filtered = filterAlertsForQuery(raw, q);
      const enriched = sortEnrichedAlertsDesc(filtered.map(enrichIntegrityAlertRow));
      const kpi = computeIntegrityKpis(raw);
      res.json({
        ok: true,
        alerts: enriched,
        kpi,
        query: q
      });
    } catch (e) {
      logError('GET /api/integrity/dashboard', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const kpi = computeIntegrityKpis(raw);
      res.json({
        ok: true,
        active: kpi.active,
        red: kpi.red,
        amber: kpi.amber,
        resolvedThisMonth: kpi.resolvedThisMonth
      });
    } catch (e) {
      logError('GET /api/integrity/counts', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }

  app.post('/api/integrity/thresholds', (req, res) => {
    try {
      const erp = readFullErpJson();
      if (!erp.integrityThresholds || typeof erp.integrityThresholds !== 'object') {
        erp.integrityThresholds = {};
      }
      if (req.body && req.body.reset) {
        erp.integrityThresholds = {};
      } else {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const defs = defaultIntegrityThresholds();
        for (const k of Object.keys(body)) {
          if (k === 'reset') continue;
          if (!(k in defs)) continue;
          const n = Number(body[k]);
          if (Number.isFinite(n)) erp.integrityThresholds[k] = n;
        }
      }
      writeFullErpJson(erp);
      res.json({ ok: true, thresholds: mergeIntegrityThresholds(erp) });
    } catch (e) {
      logError('POST /api/integrity/thresholds', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  /** Runs after client save — never blocks the save path; merges alerts into maintenance.json. */
  app.post('/api/integrity/check', (req, res) => {
    try {
      const ctx = req.body && typeof req.body === 'object' ? req.body : {};
      const erp = readFullErpJson();
      const { alerts: fresh } = evaluateIntegrityCheck(ctx, erp);
      const normalized = (fresh || []).map(a => ({
        type: a.type,
        severity: a.severity,
        message: a.message,
        details: a.details || {},
        dedupeKey: a.dedupeKey
      }));
      mergeEngineAlertsIntoErp(erp, ctx, normalized);
      writeFullErpJson(erp);
      const dkSet = new Set(normalized.map(x => String(x.dedupeKey || '')));
      const mergedRows = (erp.integrityAlerts || []).filter(
        a =>
          dkSet.has(String(a.dedupeKey || '')) ||
          dkSet.has(String(a.details?.dedupeKey || ''))
      );
      res.json({ ok: true, alerts: mergedRows.map(enrichIntegrityAlertRow) });
    } catch (e) {
      logError('POST /api/integrity/check', e);
      res.status(200).json({ ok: true, alerts: [], error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/alert/:id/records', (req, res) => {
    try {
      const erp = readFullErpJson();
      const alert = findAlertById(erp, req.params.id);
      if (!alert) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const records = buildInvestigatePayload(alert, erp);
      res.json({ ok: true, records });
    } catch (e) {
      logError('GET /api/integrity/alert/:id/records', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrity/alert/:id/notes', (req, res) => {
    try {
      const erp = readFullErpJson();
      const list = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const idx = list.findIndex(a => String(a.id) === String(req.params.id));
      if (idx < 0) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const notes = String(req.body?.notes ?? '');
      list[idx] = { ...list[idx], notes };
      erp.integrityAlerts = list;
      writeFullErpJson(erp);
      res.json({ ok: true, alert: enrichIntegrityAlertRow(list[idx]) });
    } catch (e) {
      logError('POST /api/integrity/alert/:id/notes', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/integrity/alert/:id/review', (req, res) => {
    try {
      const erp = readFullErpJson();
      const list = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const idx = list.findIndex(a => String(a.id) === String(req.params.id));
      if (idx < 0) return res.status(404).json({ ok: false, error: 'Alert not found' });
      const notes = req.body?.notes != null ? String(req.body.notes) : list[idx].notes;
      const by = maintActor(req);
      const now = new Date().toISOString();
      list[idx] = {
        ...list[idx],
        notes,
        status: 'reviewed',
        reviewedBy: by,
        reviewedAt: now
      };
      erp.integrityAlerts = list;
      writeFullErpJson(erp);
      res.json({ ok: true, alert: enrichIntegrityAlertRow(list[idx]) });
    } catch (e) {
      logError('POST /api/integrity/alert/:id/review', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/integrity/export', (req, res) => {
    try {
      const erp = readFullErpJson();
      const raw = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
      const q = req.query || {};
      const rows = sortEnrichedAlertsDesc(filterAlertsForQuery(raw, q).map(enrichIntegrityAlertRow));
      const fmt = String(req.query.format || 'csv').toLowerCase();
      if (fmt === 'xlsx' || fmt === 'pdf') {
        return res.status(501).json({
          ok: false,
          error: 'Excel/PDF integrity export requires the reports worker; use format=csv for now.'
        });
      }
      const cols = ['id', 'alertType', 'severity', 'status', 'triggeredDate', 'unitId', 'driverId', 'message'];
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = cols.join(',');
      const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="integrity-alerts.csv"');
      res.send(`${head}\n${body}`);
    } catch (e) {
      logError('GET /api/integrity/export', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });