/**
 * Official Form 425C — profiles + QBO-backed Exhibit C (sales-related deposits).
 */

import { Router } from 'express';
import { createQboApiClient } from '../lib/qbo-api-client.mjs';
import {
  readForm425cProfiles,
  writeForm425cProfiles,
  getCompanyProfile
} from '../lib/form-425c-store.mjs';
import { fetch425cSalesDepositReceipts, fetchQboBankAccounts } from '../lib/form-425c-qbo-receipts.mjs';

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

  return router;
}
