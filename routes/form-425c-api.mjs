/**
 * Official Form 425C — profiles, QBO receipts, QB paste, saved reports, ZIP package.
 */

import { Router } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { createQboApiClient } from '../lib/qbo-api-client.mjs';
import {
  readForm425cProfiles,
  writeForm425cProfiles,
  getCompanyProfile
} from '../lib/form-425c-store.mjs';
import { fetch425cSalesDepositReceipts, fetchQboBankAccounts } from '../lib/form-425c-qbo-receipts.mjs';
import { parseQBDepositPaste } from '../lib/form-425c-qb-paste.mjs';
import {
  listForm425cReports,
  readForm425cReport,
  writeForm425cReport,
  getPriorMonthEndingCash,
  deleteForm425cReport,
  appendForm425cReportExportEvent
} from '../lib/form-425c-history.mjs';
import { verifySessionToken } from '../lib/auth-users.mjs';
import { dbQuery, getPool } from '../lib/db.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 45 * 1024 * 1024, files: 40 }
});

export function createForm425cRouter({ logError = console.error } = {}) {
  const router = Router();

  function readActor(req) {
    const headerActor = String(req.headers['x-ih35-user'] || req.headers['x-user-email'] || '').trim();
    const roleHeader = String(req.headers['x-ih35-role'] || req.headers['x-user-role'] || req.headers['x-role'] || '').trim();
    if (headerActor) return { actor: headerActor, role: roleHeader || '' };
    const auth = String(req.headers.authorization || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim();
      const p = verifySessionToken(token);
      if (p) {
        return {
          actor: String(p.email || p.name || 'operator').trim() || 'operator',
          role: String(p.role || '').trim().toLowerCase()
        };
      }
    }
    return { actor: 'operator', role: '' };
  }

  function requireAdmin(req, res) {
    const who = readActor(req);
    if (['admin', 'administrator'].includes(String(who.role || '').toLowerCase())) return who;
    if (!getPool()) return who; // local/dev fallback
    res.status(403).json({ ok: false, error: 'Admin role required' });
    return null;
  }

  async function ensureAuditLogTable() {
    if (!getPool()) return false;
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        actor TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        before_state JSONB,
        after_state JSONB,
        source_module TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    return true;
  }

  async function writeAudit(req, payload = {}) {
    if (!getPool()) return;
    await ensureAuditLogTable();
    const who = readActor(req);
    await dbQuery(
      `INSERT INTO audit_log (
        actor, action, entity_type, entity_id,
        before_state, after_state, source_module, ip_address, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,now())`,
      [
        String(payload.actor || who.actor || 'operator').trim() || 'operator',
        String(payload.action || 'form_425c_action').trim(),
        String(payload.entity_type || 'form_425c').trim(),
        String(payload.entity_id || '').trim() || null,
        payload.before_state == null ? null : JSON.stringify(payload.before_state),
        payload.after_state == null ? null : JSON.stringify(payload.after_state),
        'form_425c',
        String(req.headers['x-forwarded-for'] || req.ip || '').trim() || null,
      ]
    );
  }

  router.get('/profiles', (_req, res) => {
    try {
      res.json(readForm425cProfiles());
    } catch (e) {
      logError(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  router.put('/profiles', (req, res) => {
    try {
      const saved = writeForm425cProfiles(req.body);
      writeAudit(req, {
        action: 'profile_changes',
        entity_type: 'form_425c_profile',
        entity_id: 'profiles',
        before_state: null,
        after_state: { companies: (saved?.companies || []).length }
      }).catch(() => null);
      res.json(saved);
    } catch (e) {
      logError(e);
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  router.get('/qbo-bank-accounts', async (_req, res) => {
    try {
      const { qboQuery } = createQboApiClient();
      const accounts = await fetchQboBankAccounts(qboQuery);
      res.json({ ok: true, accounts });
    } catch (e) {
      logError(e);
      res.status(502).json({ ok: false, error: String(e.message || e), accounts: [] });
    }
  });

  router.get('/receipts', async (req, res) => {
    try {
      const companyId = String(req.query.companyId || '').trim();
      const month = String(req.query.month || '').trim();
      if (!companyId || !month) {
        return res.status(400).json({ error: 'companyId and month (YYYY-MM) required' });
      }
      const profiles = readForm425cProfiles();
      const company = getCompanyProfile(profiles, companyId);
      if (!company) return res.status(404).json({ error: 'Unknown companyId' });

      const { qboQuery } = createQboApiClient();
      const data = await fetch425cSalesDepositReceipts({
        qboQuery,
        bankAccountQboIds: company.bankAccountQboIds,
        month,
        flags: {
          includeUnclassifiedDepositLines: company.includeUnclassifiedDepositLines,
          includeJournalEntryDepositLines: company.includeJournalEntryDepositLines
        }
      });
      res.json({ ...data, companyId, displayName: company.displayName });
    } catch (e) {
      logError(e);
      res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  });

  /** Paste QuickBooks “Deposit Detail” / register export — classifies transfers out. */
  router.post('/parse-qb-paste', (req, res) => {
    try {
      const text = String(req.body?.text || '');
      const companyId = String(req.body?.companyId || '').trim();
      const profiles = readForm425cProfiles();
      const company = companyId ? getCompanyProfile(profiles, companyId) : null;
      const hints = [];
      if (company) {
        hints.push(...(company.bankPasteHints || []));
        hints.push(...(company.bankAccountLabels || []));
      }
      const uniqueHints = [...new Set(hints.map((s) => String(s).trim()).filter(Boolean))];
      const parsed = parseQBDepositPaste(text, {
        bankNameSubstrings: uniqueHints.length ? uniqueHints : undefined
      });
      res.json(parsed);
    } catch (e) {
      logError(e);
      res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.get('/saved-reports', (_req, res) => {
    try {
      res.json({ ok: true, reports: listForm425cReports() });
    } catch (e) {
      logError(e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.get('/saved-report', (req, res) => {
    try {
      const companyId = String(req.query.companyId || '').trim();
      const month = String(req.query.month || '').trim();
      if (!companyId || !month) return res.status(400).json({ error: 'companyId and month required' });
      const data = readForm425cReport(companyId, month);
      if (!data) return res.status(404).json({ error: 'Not found' });
      writeAudit(req, {
        action: 'load_report',
        entity_type: 'form_425c_report',
        entity_id: `${companyId}:${month}`,
        before_state: null,
        after_state: { companyId, month }
      }).catch(() => null);
      res.json({ ok: true, report: data });
    } catch (e) {
      logError(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  router.put('/saved-report', (req, res) => {
    try {
      const companyId = String(req.body?.companyId || '').trim();
      const month = String(req.body?.month || '').trim();
      if (!companyId || !month) return res.status(400).json({ error: 'companyId and month required' });
      const { companyId: _c, month: _m, ...rest } = req.body;
      const before = readForm425cReport(companyId, month);
      const actor = readActor(req).actor;
      const nowIso = new Date().toISOString();
      const saved = writeForm425cReport(companyId, month, {
        ...rest,
        savedAt: before?.savedAt || nowIso,
        savedBy: before?.savedBy || actor,
        lastModifiedAt: nowIso,
        lastModifiedBy: actor
      });
      writeAudit(req, {
        action: 'save_report',
        entity_type: 'form_425c_report',
        entity_id: `${companyId}:${month}`,
        before_state: before ? { updatedAt: before.updatedAt, lastModifiedAt: before.lastModifiedAt } : null,
        after_state: { updatedAt: saved.updatedAt, lastModifiedAt: saved.lastModifiedAt, savedBy: saved.savedBy }
      }).catch(() => null);
      res.json({ ok: true, report: saved });
    } catch (e) {
      logError(e);
      res.status(400).json({ error: String(e.message || e) });
    }
  });

  router.delete('/saved-report', (req, res) => {
    try {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const companyId = String(req.query.companyId || req.body?.companyId || '').trim();
      const month = String(req.query.month || req.body?.month || '').trim();
      if (!companyId || !month) return res.status(400).json({ ok: false, error: 'companyId and month required' });
      const before = readForm425cReport(companyId, month);
      if (!before) return res.status(404).json({ ok: false, error: 'Not found' });
      const ok = deleteForm425cReport(companyId, month);
      if (!ok) return res.status(500).json({ ok: false, error: 'Failed to delete report file' });
      writeAudit(req, {
        actor: admin.actor,
        action: 'delete_report',
        entity_type: 'form_425c_report',
        entity_id: `${companyId}:${month}`,
        before_state: { updatedAt: before.updatedAt, savedBy: before.savedBy },
        after_state: null
      }).catch(() => null);
      return res.json({ ok: true, deleted: true, companyId, month });
    } catch (e) {
      logError(e);
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.post('/saved-report/export-event', (req, res) => {
    try {
      const companyId = String(req.body?.companyId || '').trim();
      const month = String(req.body?.month || '').trim();
      const type = String(req.body?.type || '').trim() || 'export';
      if (!companyId || !month) return res.status(400).json({ ok: false, error: 'companyId and month required' });
      const who = readActor(req);
      const saved = appendForm425cReportExportEvent(companyId, month, {
        type,
        at: new Date().toISOString(),
        by: who.actor,
        note: String(req.body?.note || '').trim() || null
      });
      if (!saved) return res.status(404).json({ ok: false, error: 'Report not found' });
      writeAudit(req, {
        action: type === 'print' ? 'export_print' : 'export_download',
        entity_type: 'form_425c_report',
        entity_id: `${companyId}:${month}`,
        before_state: null,
        after_state: { type, at: saved.lastModifiedAt, by: who.actor }
      }).catch(() => null);
      return res.json({ ok: true, report: saved });
    } catch (e) {
      logError(e);
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.post('/audit', (req, res) => {
    const action = String(req.body?.action || '').trim();
    if (!action) return res.status(400).json({ ok: false, error: 'action is required' });
    writeAudit(req, {
      action,
      entity_type: String(req.body?.entity_type || 'form_425c').trim() || 'form_425c',
      entity_id: String(req.body?.entity_id || '').trim() || null,
      before_state: req.body?.before_state ?? null,
      after_state: req.body?.after_state ?? null,
      actor: String(req.body?.actor || '').trim() || undefined
    })
      .then(() => res.json({ ok: true }))
      .catch((e) => {
        logError(e);
        res.status(500).json({ ok: false, error: String(e.message || e) });
      });
  });

  router.get('/audit-log', async (req, res) => {
    try {
      if (!getPool()) return res.json({ ok: true, data: [] });
      await ensureAuditLogTable();
      const action = String(req.query?.action || '').trim();
      const actor = String(req.query?.actor || '').trim();
      const limitRaw = Number(req.query?.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;
      const where = [`source_module = 'form_425c'`];
      const vals = [];
      if (action) {
        vals.push(action);
        where.push(`action = $${vals.length}`);
      }
      if (actor) {
        vals.push(actor);
        where.push(`actor = $${vals.length}`);
      }
      vals.push(limit);
      const { rows } = await dbQuery(
        `SELECT id, actor, action, entity_type, entity_id, before_state, after_state, source_module, created_at
           FROM audit_log
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${vals.length}`,
        vals
      );
      return res.json({ ok: true, data: rows || [] });
    } catch (e) {
      logError(e);
      return res.status(500).json({ ok: false, error: String(e.message || e), data: [] });
    }
  });

  router.get('/prior-balance', (req, res) => {
    try {
      const companyId = String(req.query.companyId || '').trim();
      const month = String(req.query.month || '').trim();
      if (!companyId || !month) return res.status(400).json({ error: 'companyId and month required' });
      const r = getPriorMonthEndingCash(companyId, month);
      res.json({ ok: true, ...r });
    } catch (e) {
      logError(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Build a single .zip from uploaded PDFs + optional server-side manifest. */
  router.post('/package', upload.array('files', 40), async (req, res) => {
    try {
      const zip = new JSZip();
      const files = req.files || [];
      for (const f of files) {
        const name = f.originalname || `upload-${Date.now()}`;
        zip.file(name.replace(/[/\\]/g, '_'), f.buffer);
      }
      let manifest = { generatedAt: new Date().toISOString(), ih35Group: true, note: 'Form 425C filing package' };
      if (req.body?.manifestJson) {
        try {
          manifest = { ...manifest, ...JSON.parse(String(req.body.manifestJson)) };
        } catch {
          /* ignore */
        }
      }
      zip.file('package-manifest.json', JSON.stringify(manifest, null, 2));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      writeAudit(req, {
        action: 'export_package_zip',
        entity_type: 'form_425c_report',
        entity_id: `${String(req.body?.companyId || '').trim()}:${String(req.body?.month || '').trim()}`,
        before_state: null,
        after_state: { files: files.length, generatedAt: manifest.generatedAt || null }
      }).catch(() => null);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="IH35-Form425C-package.zip"');
      res.send(buf);
    } catch (e) {
      logError(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  return router;
}
