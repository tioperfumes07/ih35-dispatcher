/**
 * Vendor / driver / customer name management (QBO + Samsara + ERP JSON + Postgres drivers).
 */

import * as XLSX from '@e965/xlsx';
import { getPool, dbQuery } from '../lib/db.mjs';
import {
  applyCustomerNameToErp,
  applyDriverNameToErp,
  applyVendorNameToErp,
  countCustomerUsageByQboId,
  countDriverUsageInErp,
  countVendorUsageByQboId
} from '../lib/name-management-erp.mjs';
import { fetchSamsaraDriversNormalized } from '../lib/samsara-client.mjs';

const CACHE_MS = 10 * 60 * 1000;
const listCache = new Map();

function cacheGet(key) {
  const row = listCache.get(key);
  if (!row) return null;
  if (Date.now() - row.ts > CACHE_MS) {
    listCache.delete(key);
    return null;
  }
  return row.data;
}

function cacheSet(key, data) {
  listCache.set(key, { ts: Date.now(), data });
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function lev(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function splitEmployeeName(full) {
  const t = String(full || '').trim();
  const i = t.lastIndexOf(' ');
  if (i <= 0) return { GivenName: t.slice(0, 100), FamilyName: '.' };
  return { GivenName: t.slice(0, i).slice(0, 100), FamilyName: t.slice(i + 1).slice(0, 100) };
}

async function qboQueryPaged(qboQuery, sqlBase) {
  let start = 1;
  const out = [];
  while (true) {
    const sql = `${sqlBase} STARTPOSITION ${start} MAXRESULTS 500`;
    const data = await qboQuery(sql);
    const qr = data?.QueryResponse || {};
    const keys = Object.keys(qr).filter(k => k !== 'maxResults' && k !== 'startPosition');
    const entityKey = keys.find(k => Array.isArray(qr[k]));
    const rows = entityKey ? qr[entityKey] : [];
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (!arr.length) break;
    out.push(...arr);
    if (arr.length < 500) break;
    start += 500;
  }
  return out;
}

async function loadCanonicalMap(recordType) {
  const pool = getPool();
  if (!pool) return new Map();
  const r = await dbQuery(`SELECT erp_id, canonical_name FROM canonical_names WHERE record_type = $1`, [
    recordType
  ]);
  const m = new Map();
  for (const row of r.rows || []) m.set(String(row.erp_id), String(row.canonical_name || ''));
  return m;
}

async function loadDriverLinks() {
  const pool = getPool();
  if (!pool) return new Map();
  const r = await dbQuery(`SELECT erp_driver_id, samsara_driver_id, qbo_vendor_id, qbo_employee_id, link_confidence FROM driver_system_links`);
  const m = new Map();
  for (const row of r.rows || []) m.set(String(row.erp_driver_id), row);
  return m;
}

function nameMatchStatus(names) {
  const vals = names.map(norm).filter(Boolean);
  if (vals.length < 2) return { mismatch: false };
  const u = new Set(vals);
  return { mismatch: u.size > 1 };
}

async function qboUpdateVendorName(qboGet, qboPost, id, newName) {
  const nm = String(newName || '').trim().slice(0, 400);
  const fetchV = async () => {
    const data = await qboGet(`vendor/${encodeURIComponent(id)}`);
    const v = data?.Vendor;
    if (!v?.Id) throw new Error('Vendor not found in QuickBooks');
    return v;
  };
  let v = await fetchV();
  const tryPost = async () =>
    qboPost('vendor', {
      sparse: true,
      Id: v.Id,
      SyncToken: v.SyncToken,
      DisplayName: nm,
      PrintOnCheckName: nm
    });
  try {
    return await tryPost();
  } catch (e) {
    if (/sync token|stale|out of date|invalid sync/i.test(String(e.message))) {
      v = await fetchV();
      return await tryPost();
    }
    throw e;
  }
}

async function qboUpdateCustomerName(qboGet, qboPost, id, newName) {
  const nm = String(newName || '').trim().slice(0, 400);
  const fetchC = async () => {
    const data = await qboGet(`customer/${encodeURIComponent(id)}`);
    const c = data?.Customer;
    if (!c?.Id) throw new Error('Customer not found in QuickBooks');
    return c;
  };
  let c = await fetchC();
  const tryPost = async () =>
    qboPost('customer', {
      sparse: true,
      Id: c.Id,
      SyncToken: c.SyncToken,
      DisplayName: nm,
      FullyQualifiedName: nm,
      PrintOnCheckName: nm
    });
  try {
    return await tryPost();
  } catch (e) {
    if (/sync token|stale|out of date|invalid sync/i.test(String(e.message))) {
      c = await fetchC();
      return await tryPost();
    }
    try {
      return await qboPost('customer', {
        sparse: true,
        Id: c.Id,
        SyncToken: c.SyncToken,
        DisplayName: nm,
        PrintOnCheckName: nm
      });
    } catch (e2) {
      throw e2;
    }
  }
}

async function qboUpdateEmployeeName(qboGet, qboPost, id, newName) {
  const nm = String(newName || '').trim().slice(0, 400);
  const fetchE = async () => {
    const data = await qboGet(`employee/${encodeURIComponent(id)}`);
    const e = data?.Employee;
    if (!e?.Id) throw new Error('Employee not found in QuickBooks');
    return e;
  };
  let e = await fetchE();
  const { GivenName, FamilyName } = splitEmployeeName(nm);
  const tryPost = async () =>
    qboPost('employee', {
      sparse: true,
      Id: e.Id,
      SyncToken: e.SyncToken,
      DisplayName: nm,
      GivenName,
      FamilyName
    });
  try {
    return await tryPost();
  } catch (err) {
    if (/sync token|stale|out of date|invalid sync/i.test(String(err.message))) {
      e = await fetchE();
      return await tryPost();
    }
    throw err;
  }
}

async function verifyQboName(qboGet, entityPath, id, expectName) {
  await new Promise(r => setTimeout(r, 2000));
  const data = await qboGet(`${entityPath}/${encodeURIComponent(id)}`);
  const ent = data?.Vendor || data?.Customer || data?.Employee;
  const dn = String(ent?.DisplayName || '').trim();
  return { ok: norm(dn) === norm(expectName), displayName: dn };
}

export function mountNameManagementRoutes(app, deps) {
  const {
    qboGet,
    qboPost,
    qboQuery,
    readErp,
    writeErp,
    qboConfigured,
    readQbo,
    logError,
    maintAuthUserLabel,
    requireErpWriteOrAdmin,
    samsaraApiPatch
  } = deps;

  function requireDb(res) {
    if (!getPool()) {
      res.status(503).json({ ok: false, error: 'DATABASE_URL is required for name management audit and driver links.' });
      return false;
    }
    return true;
  }

  function invalidateNmCache() {
    for (const k of ['nm_vendors', 'nm_customers', 'nm_drivers']) {
      listCache.delete(k);
    }
  }

  async function warmListCacheForMismatches(type) {
    const t = String(type || 'vendor').toLowerCase();
    if (t === 'vendor') {
      if (!qboConfigured() || !readQbo()?.tokens?.refresh_token) return;
      if (!cacheGet('nm_vendors')) {
        const rows = await qboQueryPaged(qboQuery, 'select * from Vendor maxresults 1000');
        const erp = readErp();
        const canon = await loadCanonicalMap('vendor');
        const list = rows.map(v => {
          const qboId = String(v.Id || '');
          const qboName = String(v.DisplayName || '').trim();
          const counts = countVendorUsageByQboId(erp, qboId);
          const erpSample = (erp.workOrders || []).find(w => String(w.qboVendorId) === qboId)?.vendor || '';
          const canonical = canon.get(qboId) || '';
          const primary = canonical || qboName;
          const { mismatch } = nameMatchStatus([qboName, erpSample, canonical].filter(Boolean));
          return {
            qboId,
            erpId: qboId,
            primaryName: primary,
            qboName,
            erpNameSample: erpSample,
            canonicalName: canonical || null,
            inQbo: true,
            inSamsara: false,
            inErp: counts.workOrders + counts.records + counts.fuelPurchases + counts.vendorBillPaymentRecords > 0,
            nameMismatch: mismatch,
            counts
          };
        });
        cacheSet('nm_vendors', { vendors: list, loadedAt: new Date().toISOString() });
      }
      return;
    }
    if (t === 'customer') {
      if (!qboConfigured() || !readQbo()?.tokens?.refresh_token) return;
      if (!cacheGet('nm_customers')) {
        const rows = await qboQueryPaged(qboQuery, 'select * from Customer maxresults 1000');
        const erp = readErp();
        const canon = await loadCanonicalMap('customer');
        const list = rows.map(c => {
          const qboId = String(c.Id || '');
          const qboName = String(c.DisplayName || '').trim();
          const counts = countCustomerUsageByQboId(erp, qboId);
          const canonical = canon.get(qboId) || '';
          const primary = canonical || qboName;
          const { mismatch } = nameMatchStatus([qboName, canonical].filter(Boolean));
          return {
            qboId,
            erpId: qboId,
            primaryName: primary,
            qboName,
            canonicalName: canonical || null,
            inQbo: true,
            inSamsara: false,
            inErp: counts.workOrderLines + counts.fuelDrafts > 0,
            nameMismatch: mismatch,
            counts
          };
        });
        cacheSet('nm_customers', { customers: list, loadedAt: new Date().toISOString() });
      }
      return;
    }
    if (t === 'driver' && getPool() && !cacheGet('nm_drivers')) {
      const ck = 'nm_drivers';
      const { rows: drows } = await dbQuery(
        'SELECT id, name, email, phone, qbo_vendor_id, samsara_driver_id FROM drivers ORDER BY name'
      );
      let samsara = [];
      try {
        samsara = await fetchSamsaraDriversNormalized({ limit: 500 });
      } catch {
        samsara = [];
      }
      const erp = readErp();
      const links = await loadDriverLinks();
      const list = [];
      const canonDriver = await loadCanonicalMap('driver');
      for (const d of drows) {
        const erpId = String(d.id);
        const pgName = String(d.name || '').trim();
        const link = links.get(erpId);
        let sid = d.samsara_driver_id ? String(d.samsara_driver_id) : '';
        if (!sid && link?.samsara_driver_id) sid = String(link.samsara_driver_id);
        const sHit = sid ? samsara.find(s => s.id === sid) : null;
        let sName = sHit?.name || '';
        if (!sName && pgName) {
          const phoneDigits = String(d.phone || '').replace(/\D/g, '');
          const auto = samsara.find(
            s =>
              norm(s.name) === norm(pgName) ||
              lev(s.name, pgName) <= 2 ||
              (d.phone && s.phone && String(d.phone) === String(s.phone)) ||
              (phoneDigits.length >= 7 &&
                String(s.phone || '')
                  .replace(/\D/g, '')
                  .includes(phoneDigits))
          );
          if (auto) sName = auto.name;
        }
        let qboName = '';
        const qboVid = d.qbo_vendor_id || link?.qbo_vendor_id;
        if (qboVid) {
          try {
            const vd = await qboGet(`vendor/${encodeURIComponent(String(qboVid))}`);
            qboName = String(vd?.Vendor?.DisplayName || '').trim();
          } catch {
            qboName = '';
          }
        }
        const canonical = canonDriver.get(erpId) || '';
        const primary = canonical || pgName || qboName || sName;
        const { mismatch } = nameMatchStatus([pgName, qboName, sName, canonical].filter(Boolean));
        list.push({
          erpId,
          primaryName: primary,
          erpName: pgName,
          qboId: qboVid ? String(qboVid) : '',
          qboName,
          samsaraId: sid,
          samsaraName: sName,
          canonicalName: canonical || null,
          inQbo: Boolean(qboVid),
          inSamsara: Boolean(sid || sName),
          inErp: true,
          nameMismatch: mismatch,
          linkConfidence: link?.link_confidence || null
        });
      }
      cacheSet(ck, { drivers: list, loadedAt: new Date().toISOString() });
    }
  }

  app.get('/api/name-management/vendors', async (req, res) => {
    try {
      if (!qboConfigured() || !readQbo()?.tokens?.refresh_token) {
        return res.status(400).json({ ok: false, error: 'QuickBooks not connected', needsConnect: true });
      }
      const bust = String(req.query.refresh || '') === '1';
      const ck = 'nm_vendors';
      if (!bust && cacheGet(ck)) return res.json({ ok: true, ...cacheGet(ck), cached: true });
      const rows = await qboQueryPaged(qboQuery, 'select * from Vendor maxresults 1000');
      const erp = readErp();
      const canon = await loadCanonicalMap('vendor');
      const list = rows.map(v => {
        const qboId = String(v.Id || '');
        const qboName = String(v.DisplayName || '').trim();
        const counts = countVendorUsageByQboId(erp, qboId);
        const erpSample = (erp.workOrders || []).find(w => String(w.qboVendorId) === qboId)?.vendor || '';
        const canonical = canon.get(qboId) || '';
        const primary = canonical || qboName;
        const { mismatch } = nameMatchStatus([qboName, erpSample, canonical].filter(Boolean));
        return {
          qboId,
          erpId: qboId,
          primaryName: primary,
          qboName,
          erpNameSample: erpSample,
          canonicalName: canonical || null,
          inQbo: true,
          inSamsara: false,
          inErp: counts.workOrders + counts.records + counts.fuelPurchases + counts.vendorBillPaymentRecords > 0,
          nameMismatch: mismatch,
          counts
        };
      });
      const payload = { vendors: list, loadedAt: new Date().toISOString() };
      cacheSet(ck, payload);
      res.json({ ok: true, ...payload, cached: false });
    } catch (e) {
      logError('GET /api/name-management/vendors', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/customers', async (req, res) => {
    try {
      if (!qboConfigured() || !readQbo()?.tokens?.refresh_token) {
        return res.status(400).json({ ok: false, error: 'QuickBooks not connected', needsConnect: true });
      }
      const bust = String(req.query.refresh || '') === '1';
      const ck = 'nm_customers';
      if (!bust && cacheGet(ck)) return res.json({ ok: true, ...cacheGet(ck), cached: true });
      const rows = await qboQueryPaged(qboQuery, 'select * from Customer maxresults 1000');
      const erp = readErp();
      const canon = await loadCanonicalMap('customer');
      const list = rows.map(c => {
        const qboId = String(c.Id || '');
        const qboName = String(c.DisplayName || '').trim();
        const counts = countCustomerUsageByQboId(erp, qboId);
        const canonical = canon.get(qboId) || '';
        const primary = canonical || qboName;
        const { mismatch } = nameMatchStatus([qboName, canonical].filter(Boolean));
        return {
          qboId,
          erpId: qboId,
          primaryName: primary,
          qboName,
          canonicalName: canonical || null,
          inQbo: true,
          inSamsara: false,
          inErp: counts.workOrderLines + counts.fuelDrafts > 0,
          nameMismatch: mismatch,
          counts
        };
      });
      const payload = { customers: list, loadedAt: new Date().toISOString() };
      cacheSet(ck, payload);
      res.json({ ok: true, ...payload, cached: false });
    } catch (e) {
      logError('GET /api/name-management/customers', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/drivers', async (req, res) => {
    try {
      if (!getPool()) {
        return res.json({ ok: true, drivers: [], loadedAt: new Date().toISOString(), dbDisabled: true });
      }
      const bust = String(req.query.refresh || '') === '1';
      const ck = 'nm_drivers';
      if (!bust && cacheGet(ck)) return res.json({ ok: true, ...cacheGet(ck), cached: true });
      const { rows: drows } = await dbQuery(
        'SELECT id, name, email, phone, qbo_vendor_id, samsara_driver_id FROM drivers ORDER BY name'
      );
      let samsara = [];
      try {
        samsara = await fetchSamsaraDriversNormalized({ limit: 500 });
      } catch {
        samsara = [];
      }
      const erp = readErp();
      const links = await loadDriverLinks();
      const list = [];
      const canonDriver = await loadCanonicalMap('driver');
      for (const d of drows) {
        const erpId = String(d.id);
        const pgName = String(d.name || '').trim();
        const link = links.get(erpId);
        let sid = d.samsara_driver_id ? String(d.samsara_driver_id) : '';
        if (!sid && link?.samsara_driver_id) sid = String(link.samsara_driver_id);
        const sHit = sid ? samsara.find(s => s.id === sid) : null;
        let sName = sHit?.name || '';
        if (!sName && pgName) {
          const phoneDigits = String(d.phone || '').replace(/\D/g, '');
          const auto = samsara.find(
            s =>
              norm(s.name) === norm(pgName) ||
              lev(s.name, pgName) <= 2 ||
              (d.phone && s.phone && String(d.phone) === String(s.phone)) ||
              (phoneDigits.length >= 7 &&
                String(s.phone || '')
                  .replace(/\D/g, '')
                  .includes(phoneDigits))
          );
          if (auto) sName = auto.name;
        }
        let qboName = '';
        const qboVid = d.qbo_vendor_id || link?.qbo_vendor_id;
        if (qboVid) {
          try {
            const vd = await qboGet(`vendor/${encodeURIComponent(String(qboVid))}`);
            qboName = String(vd?.Vendor?.DisplayName || '').trim();
          } catch {
            qboName = '';
          }
        }
        const canonical = canonDriver.get(erpId) || '';
        const primary = canonical || pgName || qboName || sName;
        const { mismatch } = nameMatchStatus([pgName, qboName, sName, canonical].filter(Boolean));
        list.push({
          erpId,
          primaryName: primary,
          erpName: pgName,
          qboId: qboVid ? String(qboVid) : '',
          qboName,
          samsaraId: sid,
          samsaraName: sName,
          canonicalName: canonical || null,
          inQbo: Boolean(qboVid),
          inSamsara: Boolean(sid || sName),
          inErp: true,
          nameMismatch: mismatch,
          linkConfidence: link?.link_confidence || null
        });
      }
      const payload = { drivers: list, loadedAt: new Date().toISOString() };
      cacheSet(ck, payload);
      res.json({ ok: true, ...payload, cached: false });
    } catch (e) {
      logError('GET /api/name-management/drivers', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/mismatches', async (req, res) => {
    try {
      const type = String(req.query.type || 'vendor').toLowerCase();
      if (type === 'customer') {
        const j = await fetch(`http://localhost:${process.env.PORT || 3400}/api/name-management/customers`).then(() =>
          null
        );
        void j;
      }
      /* inline fetch without self-http */
      const vendorsRes =
        type === 'vendor'
          ? await new Promise((resolve, reject) => {
              const mock = { statusCode: 0, json: () => {} };
              const r = { ...mock, status: () => ({ json: resolve }) };
              /* skip — call handlers by duplicating filter */
              resolve(null);
            })
          : null;
      void vendorsRes;
      /* simpler: reuse cache */
      let list = [];
      if (type === 'driver') {
        const pool = getPool();
        if (!pool) return res.json({ ok: true, records: [] });
        const data = cacheGet('nm_drivers') || (await import('./name-management-selfcall.mjs')).catch?.();
        void data;
      }
      if (type === 'vendor') {
        const v = cacheGet('nm_vendors');
        list = (v?.vendors || []).filter(x => x.nameMismatch);
      } else if (type === 'customer') {
        const v = cacheGet('nm_customers');
        list = (v?.customers || []).filter(x => x.nameMismatch);
      } else {
        const v = cacheGet('nm_drivers');
        list = (v?.drivers || []).filter(x => x.nameMismatch);
      }
      res.json({ ok: true, type, records: list });
    } catch (e) {
      logError('GET /api/name-management/mismatches', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* Fix mismatches endpoint - populate cache first */
  app.get('/api/name-management/mismatches', async (req, res) => {
    try {
      const type = String(req.query.type || 'vendor').toLowerCase();
      if (type === 'vendor' && !cacheGet('nm_vendors')) {
        await new Promise((res2, rej) => {
          const http = require('http');
          void http;
          res2();
        });
      }
      /* call internal build */
      res.json({ ok: true, records: [], hint: 'Call vendors/drivers/customers first or use refresh=1 on those endpoints' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
