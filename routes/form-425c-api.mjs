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
  getPriorMonthEndingCash
} from '../lib/form-425c-history.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 45 * 1024 * 1024, files: 40 }
});

export function createForm425cRouter({ logError = console.error } = {}) {
  const router = Router();

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
      const saved = writeForm425cReport(companyId, month, rest);
      res.json({ ok: true, report: saved });
    } catch (e) {
      logError(e);
      res.status(400).json({ error: String(e.message || e) });
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
