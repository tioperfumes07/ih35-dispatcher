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

  const BANKING_OCA_KEYWORDS = ['cash', 'checking', 'savings', 'prepay', 'escrow', 'reserves', 'factoring'];

  function monthBounds(month) {
    const m = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return null;
    const start = `${m}-01`;
    const [yy, mm] = m.split('-').map((v) => Number(v));
    const d0 = new Date(Date.UTC(yy, mm - 1, 1));
    const d1 = new Date(Date.UTC(yy, mm, 1));
    const prev = new Date(Date.UTC(yy, mm - 2, 1));
    const asIso = (d) => d.toISOString().slice(0, 10);
    const end = asIso(new Date(d1.getTime() - 24 * 60 * 60 * 1000));
    const prevEnd = asIso(new Date(d0.getTime() - 24 * 60 * 60 * 1000));
    return {
      month: m,
      start_date: start,
      end_date: end,
      prev_start_date: asIso(prev),
      prev_end_date: prevEnd,
    };
  }

  function parseAccountIds(raw) {
    if (Array.isArray(raw)) return raw.map((v) => String(v || '').trim()).filter(Boolean);
    return String(raw || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  function bankingEligibleByType(name, accountType) {
    const nm = String(name || '').trim().toLowerCase();
    const type = String(accountType || '').trim().toLowerCase();
    if (type === 'bank' || type === 'credit card' || type === 'creditcard') return true;
    if (type === 'other current asset' || type === 'othercurrentasset') {
      return BANKING_OCA_KEYWORDS.some((k) => nm.includes(k));
    }
    return false;
  }

  async function listDipVisibleAccounts() {
    if (!getPool()) return [];
    const { rows: accRows } = await dbQuery(
      `SELECT qbo_id, name, full_data
         FROM qbo_catalog_cache
        WHERE entity_type = 'account'
        ORDER BY name ASC
        LIMIT 3000`
    );
    const { rows: txnRows } = await dbQuery(
      `SELECT DISTINCT account_id, account_name
         FROM banking_transactions
        WHERE account_id IS NOT NULL
          AND TRIM(account_id) <> ''
        ORDER BY account_name ASC NULLS LAST
        LIMIT 3000`
    );
    const { rows: dipRows } = await dbQuery(
      `SELECT DISTINCT account_id, account_name, account_type
         FROM dip_bank_account_balances
        WHERE account_id IS NOT NULL
          AND TRIM(account_id) <> ''
        ORDER BY account_name ASC NULLS LAST
        LIMIT 3000`
    );
    const { rows: prefRows } = await dbQuery(
      `SELECT account_id, visible, is_dip
         FROM bank_account_preferences`
    );
    const prefById = new Map();
    (prefRows || []).forEach((r) => prefById.set(String(r?.account_id || '').trim(), r));
    const out = [];
    const pushAccount = (accountIdRaw, accountNameRaw, accountTypeRaw = 'Bank', allowNonEligible = false) => {
      const accountId = String(accountIdRaw || '').trim();
      if (!accountId) return;
      if (out.some((a) => String(a.account_id) === accountId)) return;
      const accountName = String(accountNameRaw || '').trim() || accountId;
      const accountType = String(accountTypeRaw || '').trim() || 'Bank';
      if (!allowNonEligible && !bankingEligibleByType(accountName, accountType)) return;
      const pref = prefById.get(accountId) || null;
      const visible = pref?.visible == null ? true : Boolean(pref.visible);
      const isDip = pref?.is_dip == null ? true : Boolean(pref.is_dip);
      if (!visible || !isDip) return;
      out.push({
        account_id: accountId,
        account_name: accountName,
        account_type: accountType,
        visible,
        is_dip: isDip,
      });
    };
    for (const r of accRows || []) {
      const accountId = String(r?.qbo_id || '').trim();
      if (!accountId) continue;
      const full = r?.full_data && typeof r.full_data === 'object' ? r.full_data : {};
      const accountName = String(r?.name || full?.Name || '').trim() || accountId;
      const accountType = String(full?.AccountType || full?.accountType || '').trim();
      pushAccount(accountId, accountName, accountType || 'Bank', false);
    }
    (dipRows || []).forEach((r) => pushAccount(r?.account_id, r?.account_name, r?.account_type || 'Bank', true));
    (txnRows || []).forEach((r) => pushAccount(r?.account_id, r?.account_name, 'Bank', true));
    out.sort((a, b) => String(a.account_name || '').localeCompare(String(b.account_name || '')));
    return out;
  }

  async function computeBankingSummary({ month, accountIds = [] }) {
    const bounds = monthBounds(month);
    if (!bounds) throw new Error('month must be YYYY-MM');
    if (!getPool()) {
      return {
        ok: true,
        month: bounds.month,
        accounts_used: [],
        line_19: 0,
        line_20: 0,
        line_21: 0,
        line_22: 0,
        line_23: 0,
        source: 'banking_transactions',
      };
    }
    const visibleDip = await listDipVisibleAccounts();
    const visibleById = new Map(visibleDip.map((a) => [String(a.account_id), a]));
    const picked = (accountIds || []).filter((id) => visibleById.has(String(id)));
    const accountList = picked.length ? picked : visibleDip.map((a) => String(a.account_id));
    if (!accountList.length) {
      return {
        ok: true,
        month: bounds.month,
        accounts_used: [],
        line_19: 0,
        line_20: 0,
        line_21: 0,
        line_22: 0,
        line_23: 0,
        source: 'banking_transactions',
      };
    }
    const { rows: sumRows } = await dbQuery(
      `SELECT
          COALESCE(SUM(CASE WHEN bt.amount > 0 THEN bt.amount ELSE 0 END), 0)::numeric AS receipts,
          COALESCE(SUM(CASE WHEN bt.amount < 0 THEN ABS(bt.amount) ELSE 0 END), 0)::numeric AS disbursements
         FROM banking_transactions bt
        WHERE bt.account_id = ANY($1::text[])
          AND bt.txn_date >= $2::date
          AND bt.txn_date <= $3::date`,
      [accountList, bounds.start_date, bounds.end_date]
    );
    const { rows: openRows } = await dbQuery(
      `SELECT account_id, running_balance
         FROM (
           SELECT bt.account_id,
                  bt.running_balance,
                  ROW_NUMBER() OVER (PARTITION BY bt.account_id ORDER BY bt.txn_date DESC, bt.id DESC) AS rn
             FROM banking_transactions bt
            WHERE bt.account_id = ANY($1::text[])
              AND bt.txn_date <= $2::date
              AND bt.running_balance IS NOT NULL
         ) x
        WHERE rn = 1`,
      [accountList, bounds.prev_end_date]
    );
    const { rows: endRows } = await dbQuery(
      `SELECT account_id, running_balance
         FROM (
           SELECT bt.account_id,
                  bt.running_balance,
                  ROW_NUMBER() OVER (PARTITION BY bt.account_id ORDER BY bt.txn_date DESC, bt.id DESC) AS rn
             FROM banking_transactions bt
            WHERE bt.account_id = ANY($1::text[])
              AND bt.txn_date <= $2::date
              AND bt.running_balance IS NOT NULL
         ) x
        WHERE rn = 1`,
      [accountList, bounds.end_date]
    );
    const receipts = Number(sumRows?.[0]?.receipts || 0);
    const disbursements = Number(sumRows?.[0]?.disbursements || 0);
    let opening = (openRows || []).reduce((s, r) => s + Number(r?.running_balance || 0), 0);
    let ending = (endRows || []).reduce((s, r) => s + Number(r?.running_balance || 0), 0);
    if (!(openRows || []).length || !(endRows || []).length) {
      const { rows: balRows } = await dbQuery(
        `SELECT month_key,
                COALESCE(SUM(opening_balance), 0)::numeric AS opening_balance,
                COALESCE(SUM(ending_balance), 0)::numeric AS ending_balance,
                COALESCE(SUM(receipts), 0)::numeric AS receipts,
                COALESCE(SUM(disbursements), 0)::numeric AS disbursements
           FROM dip_bank_account_balances
          WHERE account_id = ANY($1::text[])
            AND month_key IN ($2, $3)
          GROUP BY month_key`,
        [accountList, bounds.month, bounds.prev_start_date.slice(0, 7)]
      );
      const byMonth = new Map((balRows || []).map((r) => [String(r?.month_key || ''), r]));
      const cur = byMonth.get(bounds.month) || null;
      const prev = byMonth.get(bounds.prev_start_date.slice(0, 7)) || null;
      if (!(openRows || []).length && prev) opening = Number(prev?.ending_balance || prev?.opening_balance || opening || 0);
      if (!(endRows || []).length && cur) ending = Number(cur?.ending_balance || ending || 0);
    }
    const net = receipts - disbursements;
    return {
      ok: true,
      month: bounds.month,
      accounts_used: accountList.map((id) => ({
        account_id: id,
        account_name: String(visibleById.get(String(id))?.account_name || id),
      })),
      line_19: Math.round(opening * 100) / 100,
      line_20: Math.round(receipts * 100) / 100,
      line_21: Math.round(disbursements * 100) / 100,
      line_22: Math.round(net * 100) / 100,
      line_23: Math.round(ending * 100) / 100,
      source: 'banking_transactions',
    };
  }

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

  router.get('/banking-summary/accounts', async (_req, res) => {
    try {
      const accounts = await listDipVisibleAccounts();
      return res.json({ ok: true, accounts });
    } catch (e) {
      logError(e);
      return res.status(500).json({ ok: false, error: String(e.message || e), accounts: [] });
    }
  });

  router.get('/banking-summary', async (req, res) => {
    try {
      const month = String(req.query?.month || '').trim();
      const accountIds = parseAccountIds(req.query?.account_ids);
      const payload = await computeBankingSummary({ month, accountIds });
      return res.json(payload);
    } catch (e) {
      logError(e);
      return res.status(400).json({ ok: false, error: String(e.message || e) });
    }
  });

  router.post('/import-banking', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const month = String(body.month || '').trim();
      const debtorId = String(body.debtor_id || body.companyId || '').trim() || null;
      const accountIds = parseAccountIds(body.account_ids);
      const payload = await computeBankingSummary({ month, accountIds });
      return res.json({ ...payload, debtor_id: debtorId });
    } catch (e) {
      logError(e);
      return res.status(400).json({ ok: false, error: String(e.message || e) });
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
