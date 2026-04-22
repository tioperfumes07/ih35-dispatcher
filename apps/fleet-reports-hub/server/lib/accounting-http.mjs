import crypto from 'crypto';
import {
  accountingTablesReady,
  getAccountingDb,
  mergeLogCountLastHour,
  missingDatabaseTables,
} from './accounting-db.mjs';
import {
  buildCandidateGroups,
  findParty,
  listParties,
  listQboItems,
  searchParties,
  applyMergeInCatalog,
} from './accounting-catalog.mjs';
import { scoreDuplicatePair, pairKey } from './vendor-dedup-engine.mjs';

const MERGE_LIMIT_PER_HOUR = 10;

export function registerAccountingRoutes(app) {
  app.get('/api/accounting/db-status', (_req, res) => {
    const ready = accountingTablesReady();
    const missing = missingDatabaseTables();
    res.json({
      ok: ready,
      mergeLogTable: ready && !missing.includes('merge_log'),
      dedupSkippedTable: ready && !missing.includes('dedup_skipped'),
      mergesLastHour: ready ? mergeLogCountLastHour() : null,
      missingTables: missing,
      message: ready
        ? 'All required SQLite tables are present.'
        : `Missing tables: ${missing.join(', ') || '(unknown)'}`,
    });
  });

  app.get('/api/accounting/dedup/counts', (_req, res) => {
    try {
      const v = buildCandidateGroups('vendor').length;
      const c = buildCandidateGroups('customer').length;
      res.json({ vendorGroupCount: v, customerGroupCount: c });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/accounting/dedup/candidates', (req, res) => {
    try {
      const entityType = req.query.entityType === 'customer' ? 'customer' : 'vendor';
      const groups = buildCandidateGroups(entityType);
      res.json({ entityType, groups });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/accounting/parties/search', (req, res) => {
    try {
      const entityType = req.query.entityType === 'customer' ? 'customer' : 'vendor';
      const q = String(req.query.q || '');
      res.json({ entityType, parties: searchParties(entityType, q) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/accounting/qbo-items', (req, res) => {
    try {
      const q = String(req.query.q || '');
      res.json({ ok: true, items: listQboItems(q) });
    } catch (e) {
      res.status(200).json({
        ok: false,
        items: [],
        warning: String(e?.message || e),
      });
    }
  });

  app.get('/api/accounting/merge-history', (req, res) => {
    try {
      if (!accountingTablesReady()) {
        return res.status(503).json({ error: 'merge_log table not available' });
      }
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const db = getAccountingDb();
      const rows = db
        .prepare(
          `SELECT id, entity_type, kept_party_id, merged_party_id, kept_name_final, merged_name_final,
                  confidence_pct, confidence_band, rules_matched, qbo_verified, transfers_json, erp_updated, created_at
           FROM merge_log ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit);
      res.json({
        rows: rows.map((r) => ({
          ...r,
          rulesMatched: safeJson(r.rules_matched, []),
          transfers: safeJson(r.transfers_json, {}),
          qboVerified: Boolean(r.qbo_verified),
          erpUpdated: Boolean(r.erp_updated),
        })),
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/accounting/dedup-skip', (req, res) => {
    try {
      if (!accountingTablesReady()) {
        return res.status(503).json({ error: 'dedup_skipped table not available' });
      }
      const entityType = req.body?.entityType === 'customer' ? 'customer' : 'vendor';
      const partyIdA = String(req.body?.partyIdA || '').trim();
      const partyIdB = String(req.body?.partyIdB || '').trim();
      if (!partyIdA || !partyIdB) {
        return res.status(400).json({ error: 'partyIdA and partyIdB required' });
      }
      const id = crypto.randomUUID();
      const groupKey = req.body?.groupKey || pairKey(partyIdA, partyIdB);
      const reason = req.body?.reason ? String(req.body.reason) : null;
      const createdAt = new Date().toISOString();
      const db = getAccountingDb();
      db.prepare(
        `INSERT INTO dedup_skipped (id, entity_type, party_id_a, party_id_b, group_key, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, entityType, partyIdA, partyIdB, groupKey, reason, createdAt);
      res.json({ ok: true, id, groupKey });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/accounting/merge-execute', (req, res) => {
    try {
      if (!accountingTablesReady()) {
        return res.status(503).json({
          error:
            'merge_log / dedup_skipped tables must exist before any merge runs. Initialize accounting.db.',
        });
      }

      const n = mergeLogCountLastHour();
      if (n >= MERGE_LIMIT_PER_HOUR) {
        return res.status(429).json({
          error: `Rate limited: ${MERGE_LIMIT_PER_HOUR} merges per hour. Try again later.`,
          mergesLastHour: n,
        });
      }

      const entityType = req.body?.entityType === 'customer' ? 'customer' : 'vendor';
      const keepId = String(req.body?.keepId || '').trim();
      const mergeId = String(req.body?.mergeId || '').trim();
      if (!keepId || !mergeId || keepId === mergeId) {
        return res.status(400).json({ error: 'keepId and mergeId must differ' });
      }

      const keep = findParty(entityType, keepId);
      const merge = findParty(entityType, mergeId);
      if (!keep || !merge) {
        return res.status(404).json({ error: 'One or both parties not found or inactive' });
      }

      const { confidencePct, band, rules } = scoreDuplicatePair(keep, merge);
      if (band === 'LOW' || confidencePct < 50) {
        return res.status(400).json({ error: 'Confidence too low to merge' });
      }

      const qboVerified = Boolean(keep.qboId && merge.qboId);
      if (!qboVerified) {
        return res.status(400).json({ error: 'QBO verification failed: missing qboId on one party' });
      }

      const transfers = {
        billsRepointed: merge.billsCount || 0,
        expensesRepointed: merge.expensesCount || 0,
        posRepointed: merge.posCount || 0,
        note: 'Demo: counts consolidated onto kept vendor/customer; QBO bill/vendor links would repoint in production.',
      };

      const { keep: keptAfter, merge: mergedAfter } = applyMergeInCatalog(entityType, keepId, mergeId);

      const logId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const db = getAccountingDb();
      db.prepare(
        `INSERT INTO merge_log (
          id, entity_type, kept_party_id, merged_party_id, kept_name_final, merged_name_final,
          confidence_pct, confidence_band, rules_matched, qbo_verified, transfers_json, erp_updated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        logId,
        entityType,
        keepId,
        mergeId,
        keptAfter.name,
        mergedAfter.name,
        confidencePct,
        band,
        JSON.stringify(rules),
        qboVerified ? 1 : 0,
        JSON.stringify(transfers),
        1,
        createdAt,
      );

      res.json({
        ok: true,
        mergeLogId: logId,
        kept: { id: keptAfter.id, name: keptAfter.name, qboId: keptAfter.qboId },
        merged: {
          id: mergedAfter.id,
          name: mergedAfter.name,
          qboId: mergedAfter.qboId,
          qboActive: false,
          deactivatedInQbo: true,
        },
        qboVerified,
        transfers,
        erpUpdated: true,
        rulesMatched: rules,
        confidencePct,
        confidenceBand: band,
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
