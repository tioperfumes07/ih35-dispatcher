/**
 * QuickBooks vendor/customer deduplication REST API.
 */

import * as XLSX from '@e965/xlsx';
import { getPool, dbQuery } from '../lib/db.mjs';
import {
  buildDuplicateGroups,
  mapQboVendorRow,
  mapQboCustomerRow
} from '../lib/qbo-dedupe-detect.mjs';
import {
  countVendorTransactions,
  countCustomerTransactions,
  executeVendorMerge,
  executeCustomerMerge
} from '../lib/qbo-dedupe-merge.mjs';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

/** @type {Map<string, number[]>} userId -> merge timestamps (ms) */
const mergeRateBuckets = new Map();
const MERGE_LIMIT_PER_HOUR = 10;

function cacheKey(kind, extra = '') {
  return `${kind}:${extra}`;
}

function cacheGet(key) {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() - row.ts > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return row.data;
}

function cacheSet(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

async function loadSkippedSignatures(recordType) {
  const sigs = new Set();
  const pool = getPool();
  if (!pool) return sigs;
  try {
    const r = await dbQuery(
      `SELECT group_signature FROM dedup_skipped WHERE record_type = $1`,
      [recordType]
    );
    for (const row of r.rows || []) {
      if (row.group_signature) sigs.add(String(row.group_signature));
    }
  } catch {
    /* table missing until migrate */
  }
  return sigs;
}

async function fetchQboVendors(qboQuery) {
  const data = await qboQuery('select * from Vendor maxresults 1000');
  const rows = data?.QueryResponse?.Vendor || [];
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return arr.map(mapQboVendorRow);
}

async function fetchQboCustomers(qboQuery) {
  const data = await qboQuery('select * from Customer maxresults 1000');
  const rows = data?.QueryResponse?.Customer || [];
  const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
  return arr.map(mapQboCustomerRow);
}

function checkMergeRateLimit(userId) {
  const uid = String(userId || 'anon');
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let arr = mergeRateBuckets.get(uid) || [];
  arr = arr.filter(t => now - t < windowMs);
  if (arr.length >= MERGE_LIMIT_PER_HOUR) {
    return { ok: false, remaining: 0 };
  }
  arr.push(now);
  mergeRateBuckets.set(uid, arr);
  return { ok: true, remaining: MERGE_LIMIT_PER_HOUR - arr.length };
}

function fmtAddr(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [
    addr.Line1,
    addr.Line2,
    addr.City,
    addr.CountrySubDivisionCode,
    addr.PostalCode
  ]
    .map(x => String(x || '').trim())
    .filter(Boolean);
  return parts.join(', ');
}

export function mountDedupeRoutes(app, deps) {
  const {
    qboGet,
    qboPost,
    qboQuery,
    readQbo,
    readErp,
    writeErp,
    qboConfigured,
    logError,
    maintAuthUserLabel,
    requireErpWriteOrAdmin
  } = deps;

  async function ensureDedupeDb(res) {
    if (!getPool()) {
      res.status(503).json({
        ok: false,
        error: 'DATABASE_URL is not configured. Merge history and skip persistence require Postgres.'
      });
      return false;
    }
    return true;
  }

  app.get('/api/deduplicate/vendors', async (req, res) => {
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      const store = readQbo();
      if (!store.tokens?.refresh_token) {
        return res.status(400).json({ ok: false, error: 'Connect QuickBooks first', needsConnect: true });
      }
      const bust = String(req.query.refresh || '') === '1';
      const ck = cacheKey('vendors', 'all');
      if (!bust) {
        const hit = cacheGet(ck);
        if (hit) return res.json({ ok: true, ...hit, cached: true });
      }
      const vendors = await fetchQboVendors(qboQuery);
      const skipped = await loadSkippedSignatures('vendor');
      const { duplicateGroups, highConfidenceCount, mediumConfidenceCount } = buildDuplicateGroups(
        vendors,
        'vendor',
        skipped
      );
      const payload = {
        vendors,
        duplicateGroups,
        highConfidenceCount,
        mediumConfidenceCount,
        loadedAt: new Date().toISOString(),
        realmId: store.tokens?.realmId || null
      };
      cacheSet(ck, payload);
      res.json({ ok: true, ...payload, cached: false });
    } catch (e) {
      logError('GET /api/deduplicate/vendors', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/customers', async (req, res) => {
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      const store = readQbo();
      if (!store.tokens?.refresh_token) {
        return res.status(400).json({ ok: false, error: 'Connect QuickBooks first', needsConnect: true });
      }
      const bust = String(req.query.refresh || '') === '1';
      const ck = cacheKey('customers', 'all');
      if (!bust) {
        const hit = cacheGet(ck);
        if (hit) return res.json({ ok: true, ...hit, cached: true });
      }
      const customers = await fetchQboCustomers(qboQuery);
      const skipped = await loadSkippedSignatures('customer');
      const { duplicateGroups, highConfidenceCount, mediumConfidenceCount } = buildDuplicateGroups(
        customers,
        'customer',
        skipped
      );
      const payload = {
        customers,
        duplicateGroups,
        highConfidenceCount,
        mediumConfidenceCount,
        loadedAt: new Date().toISOString(),
        realmId: store.tokens?.realmId || null
      };
      cacheSet(ck, payload);
      res.json({ ok: true, ...payload, cached: false });
    } catch (e) {
      logError('GET /api/deduplicate/customers', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  function searchCached(kind, q) {
    const needle = String(q || '').trim().toLowerCase();
    const ck = cacheKey(kind, 'all');
    const hit = cacheGet(ck);
    const list = kind === 'vendor' ? hit?.vendors : hit?.customers;
    if (!needle || !Array.isArray(list)) return [];
    return list
      .filter(r => {
        const hay = `${r.name} ${r.companyName} ${r.qboId}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 40);
  }

  app.get('/api/deduplicate/search/vendors', async (req, res) => {
    try {
      if (!cacheGet(cacheKey('vendors', 'all'))) {
        await fetchQboVendors(qboQuery).then(vendors => {
          cacheSet(cacheKey('vendors', 'all'), {
            vendors,
            duplicateGroups: [],
            highConfidenceCount: 0,
            mediumConfidenceCount: 0,
            loadedAt: new Date().toISOString()
          });
        });
      }
      const q = req.query.q;
      res.json({ ok: true, vendors: searchCached('vendor', q) });
    } catch (e) {
      logError('GET /api/deduplicate/search/vendors', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/search/customers', async (req, res) => {
    try {
      if (!cacheGet(cacheKey('customers', 'all'))) {
        await fetchQboCustomers(qboQuery).then(customers => {
          cacheSet(cacheKey('customers', 'all'), {
            customers,
            duplicateGroups: [],
            highConfidenceCount: 0,
            mediumConfidenceCount: 0,
            loadedAt: new Date().toISOString()
          });
        });
      }
      const q = req.query.q;
      res.json({ ok: true, customers: searchCached('customer', q) });
    } catch (e) {
      logError('GET /api/deduplicate/search/customers', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/vendor/:id', async (req, res) => {
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      const id = String(req.params.id || '').trim();
      const data = await qboGet(`vendor/${encodeURIComponent(id)}`);
      const v = data?.Vendor;
      if (!v?.Id) return res.status(404).json({ ok: false, error: 'Vendor not found' });
      const row = mapQboVendorRow(v);
      const { buckets, total } = await countVendorTransactions(qboQuery, id);
      const billsOpen = (buckets.bills || []).length;
      res.json({
        ok: true,
        vendor: row,
        txnSummary: {
          totalLinked: total,
          buckets: {
            bills: (buckets.bills || []).length,
            purchases: (buckets.purchases || []).length,
            vendorCredits: (buckets.vendorCredits || []).length,
            purchaseOrders: (buckets.purchaseOrders || []).length,
            billPayments: (buckets.billPayments || []).length
          },
          openBillsApprox: billsOpen
        },
        address: fmtAddr(v.BillAddr),
        full: v
      });
    } catch (e) {
      logError('GET /api/deduplicate/vendor/:id', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/customer/:id', async (req, res) => {
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      const id = String(req.params.id || '').trim();
      const data = await qboGet(`customer/${encodeURIComponent(id)}`);
      const c = data?.Customer;
      if (!c?.Id) return res.status(404).json({ ok: false, error: 'Customer not found' });
      const row = mapQboCustomerRow(c);
      const { buckets, total } = await countCustomerTransactions(qboQuery, id);
      res.json({
        ok: true,
        customer: row,
        txnSummary: {
          totalLinked: total,
          buckets: {
            invoices: (buckets.invoices || []).length,
            salesReceipts: (buckets.salesReceipts || []).length,
            payments: (buckets.payments || []).length,
            creditMemos: (buckets.creditMemos || []).length
          }
        },
        address: fmtAddr(c.BillAddr || c.ShipAddr),
        full: c
      });
    } catch (e) {
      logError('GET /api/deduplicate/customer/:id', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/deduplicate/skip', async (req, res) => {
    try {
      if (!(await ensureDedupeDb(res))) return;
      const body = req.body || {};
      const recordType = String(body.recordType || '').toLowerCase();
      const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
      if (!['vendor', 'customer'].includes(recordType) || ids.length < 2) {
        return res.status(400).json({ ok: false, error: 'recordType and ids[] (2+) required' });
      }
      const sig = [...new Set(ids)].sort().join('|');
      const sorted = [...new Set(ids)].sort();
      const a = sorted[0];
      const b = sorted[sorted.length - 1];
      const by = maintAuthUserLabel(req);
      await dbQuery(
        `INSERT INTO dedup_skipped (record_type, qbo_id_a, qbo_id_b, skipped_by, reason, group_signature)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [recordType, a, b, by, body.reason || null, sig]
      ).catch(async () => {
        await dbQuery(
          `INSERT INTO dedup_skipped (record_type, qbo_id_a, qbo_id_b, skipped_by, reason, group_signature)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [recordType, a, b, by, body.reason || null, sig]
        );
      });
      cache.delete(cacheKey(recordType === 'vendor' ? 'vendors' : 'customers', 'all'));
      res.json({ ok: true, groupSignature: sig });
    } catch (e) {
      if (String(e?.message || '').includes('unique')) {
        return res.json({ ok: true, duplicate: true });
      }
      logError('POST /api/deduplicate/skip', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/deduplicate/merge/vendors', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      if (!(await ensureDedupeDb(res))) return;
      const uid = req.authUser?.id || req.authUser?.email || 'token';
      const rl = checkMergeRateLimit(uid);
      if (!rl.ok) {
        return res.status(429).json({
          ok: false,
          error:
            'You have reached the merge limit of 10 per hour. Please wait before continuing to ensure accuracy.'
        });
      }
      const body = req.body || {};
      const keepId = String(body.keepId || '').trim();
      const mergeId = String(body.mergeId || '').trim();
      if (!keepId || !mergeId || keepId === mergeId) {
        return res.status(400).json({ ok: false, error: 'keepId and mergeId are required' });
      }
      const by = maintAuthUserLabel(req);
      const vKeep = await qboGet(`vendor/${encodeURIComponent(keepId)}`);
      const vMerge = await qboGet(`vendor/${encodeURIComponent(mergeId)}`);
      const keptName = vKeep?.Vendor?.DisplayName || '';
      const mergedName = vMerge?.Vendor?.DisplayName || '';

      let result;
      let status = 'success';
      let errText = null;
      const qboResponses = { steps: [] };
      try {
        result = await executeVendorMerge(
          { qboGet, qboPost, qboQuery },
          { keepId, mergeId, readErp, writeErp }
        );
        qboResponses.steps = result.audit;
      } catch (e) {
        status = 'failed';
        errText = e?.message || String(e);
        await dbQuery(
          `INSERT INTO merge_log (merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, transactions_transferred, erp_records_updated, qbo_api_responses, status, error_details)
           VALUES ('vendor',$1,$2,$3,$4,$5,0,0,$6,'failed',$7)`,
          [keepId, keptName, mergeId, mergedName, by, JSON.stringify(qboResponses), errText]
        );
        return res.status(500).json({ ok: false, success: false, error: errText, errors: [errText] });
      }

      let partial = false;
      if (result.audit.some(x => x.ok === false)) partial = true;

      qboResponses.steps = result.audit;
      qboResponses.deactivate = result.qboDeactivate;

      if (partial) status = 'partial_error';

      await dbQuery(
        `INSERT INTO merge_log (merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, transactions_transferred, erp_records_updated, qbo_api_responses, status, error_details)
         VALUES ('vendor',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          keepId,
          keptName,
          mergeId,
          mergedName,
          by,
          result.transactionsTransferred,
          result.erpRecordsUpdated,
          JSON.stringify(qboResponses),
          status,
          partial ? 'Some audit steps reported failure' : null
        ]
      );

      cache.delete(cacheKey('vendors', 'all'));
      res.json({
        ok: true,
        success: status === 'success',
        transactionsTransferred: result.transactionsTransferred,
        erpRecordsUpdated: result.erpRecordsUpdated,
        errors: partial ? ['Some non-fatal steps failed — see merge history'] : []
      });
    } catch (e) {
      logError('POST /api/deduplicate/merge/vendors', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post('/api/deduplicate/merge/customers', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    try {
      if (!qboConfigured()) {
        return res.status(400).json({ ok: false, error: 'QuickBooks is not configured', needsQbo: true });
      }
      if (!(await ensureDedupeDb(res))) return;
      const uid = req.authUser?.id || req.authUser?.email || 'token';
      const rl = checkMergeRateLimit(uid);
      if (!rl.ok) {
        return res.status(429).json({
          ok: false,
          error:
            'You have reached the merge limit of 10 per hour. Please wait before continuing to ensure accuracy.'
        });
      }
      const body = req.body || {};
      const keepId = String(body.keepId || '').trim();
      const mergeId = String(body.mergeId || '').trim();
      if (!keepId || !mergeId || keepId === mergeId) {
        return res.status(400).json({ ok: false, error: 'keepId and mergeId are required' });
      }
      const by = maintAuthUserLabel(req);
      const cKeep = await qboGet(`customer/${encodeURIComponent(keepId)}`);
      const cMerge = await qboGet(`customer/${encodeURIComponent(mergeId)}`);
      const keptName = cKeep?.Customer?.DisplayName || '';
      const mergedName = cMerge?.Customer?.DisplayName || '';

      let result;
      let status = 'success';
      const qboResponses = { steps: [] };
      try {
        result = await executeCustomerMerge(
          { qboGet, qboPost, qboQuery },
          { keepId, mergeId, readErp, writeErp }
        );
        qboResponses.steps = result.audit;
      } catch (e) {
        const errText = e?.message || String(e);
        await dbQuery(
          `INSERT INTO merge_log (merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, transactions_transferred, erp_records_updated, qbo_api_responses, status, error_details)
           VALUES ('customer',$1,$2,$3,$4,$5,0,0,$6,'failed',$7)`,
          [keepId, keptName, mergeId, mergedName, by, JSON.stringify(qboResponses), errText]
        );
        return res.status(500).json({ ok: false, success: false, error: errText, errors: [errText] });
      }

      let partial = result.audit.some(x => x.ok === false);
      let st = partial ? 'partial_error' : 'success';
      await dbQuery(
        `INSERT INTO merge_log (merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, transactions_transferred, erp_records_updated, qbo_api_responses, status, error_details)
         VALUES ('customer',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          keepId,
          keptName,
          mergeId,
          mergedName,
          by,
          result.transactionsTransferred,
          result.erpRecordsUpdated,
          JSON.stringify({ steps: result.audit, deactivate: result.qboDeactivate }),
          st,
          partial ? 'Some audit steps reported failure' : null
        ]
      );

      cache.delete(cacheKey('customers', 'all'));
      res.json({
        ok: true,
        success: st === 'success',
        transactionsTransferred: result.transactionsTransferred,
        erpRecordsUpdated: result.erpRecordsUpdated,
        errors: partial ? ['Some non-fatal steps failed — see merge history'] : []
      });
    } catch (e) {
      logError('POST /api/deduplicate/merge/customers', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/merge-history', async (req, res) => {
    try {
      if (!(await ensureDedupeDb(res))) return;
      if (String(req.query.format || '').toLowerCase() === 'xlsx') {
        const r = await dbQuery(
          `SELECT id, merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, merged_at,
                  transactions_transferred, erp_records_updated, status, error_details
           FROM merge_log ORDER BY merged_at DESC LIMIT 5000`
        );
        const rows = r.rows || [];
        const aoa = [
          [
            'Date',
            'Type',
            'Kept ID',
            'Kept name',
            'Merged ID',
            'Merged name',
            'Transactions',
            'ERP records',
            'Merged by',
            'Status',
            'Error'
          ],
          ...rows.map(x => [
            x.merged_at ? new Date(x.merged_at).toLocaleString('en-US') : '',
            x.merge_type,
            x.kept_qbo_id,
            x.kept_name,
            x.merged_qbo_id,
            x.merged_name,
            x.transactions_transferred,
            x.erp_records_updated,
            x.merged_by,
            x.status,
            x.error_details || ''
          ])
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, ws, 'Merge history');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="qbo-merge-history.xlsx"');
        return res.send(Buffer.from(buf));
      }

      const startDate = String(req.query.startDate || '').trim();
      const endDate = String(req.query.endDate || '').trim();
      const type = String(req.query.type || '').trim().toLowerCase();
      const st = String(req.query.status || '').trim().toLowerCase();
      const mergedBy = String(req.query.mergedBy || '').trim();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const conds = [];
      const params = [];
      let i = 1;
      if (startDate) {
        conds.push(`merged_at >= $${i++}::timestamptz`);
        params.push(startDate);
      }
      if (endDate) {
        conds.push(`merged_at < ($${i++}::date + interval '1 day')`);
        params.push(endDate);
      }
      if (type === 'vendor' || type === 'customer') {
        conds.push(`merge_type = $${i++}`);
        params.push(type);
      }
      if (['success', 'partial_error', 'failed'].includes(st)) {
        conds.push(`status = $${i++}`);
        params.push(st);
      }
      if (mergedBy) {
        conds.push(`merged_by ILIKE $${i++}`);
        params.push(`%${mergedBy}%`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const cnt = await dbQuery(`SELECT COUNT(*)::int AS c FROM merge_log ${where}`, params);
      const total = cnt.rows?.[0]?.c || 0;
      const off = (page - 1) * pageSize;
      const r2 = await dbQuery(
        `SELECT id, merge_type, kept_qbo_id, kept_name, merged_qbo_id, merged_name, merged_by, merged_at,
                transactions_transferred, erp_records_updated, status, error_details
         FROM merge_log ${where}
         ORDER BY merged_at DESC
         LIMIT ${pageSize} OFFSET ${off}`,
        params
      );
      res.json({ ok: true, total, page, pageSize, rows: r2.rows || [] });
    } catch (e) {
      logError('GET /api/deduplicate/merge-history', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/merge-log/:id', async (req, res) => {
    try {
      if (!(await ensureDedupeDb(res))) return;
      const id = String(req.params.id || '').trim();
      const r = await dbQuery(`SELECT * FROM merge_log WHERE id = $1::bigint`, [id]);
      const row = r.rows?.[0];
      if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
      res.json({ ok: true, row });
    } catch (e) {
      logError('GET /api/deduplicate/merge-log/:id', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.get('/api/deduplicate/export-duplicates', async (req, res) => {
    try {
      const kind = String(req.query.type || 'vendor').toLowerCase();
      const ck = cacheKey(kind === 'customer' ? 'customers' : 'vendors', 'all');
      let data = cacheGet(ck);
      if (!data) {
        if (kind === 'customer') {
          const customers = await fetchQboCustomers(qboQuery);
          const skipped = await loadSkippedSignatures('customer');
          data = {
            ...buildDuplicateGroups(customers, 'customer', skipped),
            customers,
            duplicateGroups: buildDuplicateGroups(customers, 'customer', skipped).duplicateGroups
          };
        } else {
          const vendors = await fetchQboVendors(qboQuery);
          const skipped = await loadSkippedSignatures('vendor');
          const b = buildDuplicateGroups(vendors, 'vendor', skipped);
          data = { ...b, vendors };
        }
      }
      const groups = data.duplicateGroups || [];
      const aoa = [['Confidence', 'Matched by', 'QBO IDs', 'Names']];
      for (const g of groups) {
        const ids = (g.records || []).map(r => r.qboId).join('; ');
        const names = (g.records || []).map(r => r.name).join(' | ');
        aoa.push([g.confidence, g.matchedBy, ids, names]);
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, 'Duplicates');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="qbo-duplicate-${kind === 'customer' ? 'customers' : 'vendors'}.xlsx"`
      );
      res.send(Buffer.from(buf));
    } catch (e) {
      logError('GET /api/deduplicate/export-duplicates', e);
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
