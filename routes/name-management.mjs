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
      await warmListCacheForMismatches(type);
      let list = [];
      let loadedAt = null;
      if (type === 'vendor') {
        const v = cacheGet('nm_vendors');
        loadedAt = v?.loadedAt || null;
        list = (v?.vendors || []).filter(x => x.nameMismatch);
      } else if (type === 'customer') {
        const v = cacheGet('nm_customers');
        loadedAt = v?.loadedAt || null;
        list = (v?.customers || []).filter(x => x.nameMismatch);
      } else {
        if (!getPool()) return res.json({ ok: true, type, records: [], loadedAt: null });
        const v = cacheGet('nm_drivers');
        loadedAt = v?.loadedAt || null;
        list = (v?.drivers || []).filter(x => x.nameMismatch);
      }
      res.json({ ok: true, type, records: list, loadedAt });
    } catch (e) {
      logError('GET /api/name-management/mismatches', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/record/:type/:id', async (req, res) => {
    try {
      const type = String(req.params.type || '').toLowerCase();
      const id = decodeURIComponent(String(req.params.id || '').trim());
      if (!id || !['vendor', 'customer', 'driver'].includes(type)) {
        return res.status(400).json({ ok: false, error: 'Invalid type or id' });
      }
      const realm = String(readQbo()?.tokens?.realmId || '').trim();
      const qboCompany = realm ? `&companyId=${encodeURIComponent(realm)}` : '';
      if (type === 'vendor') {
        await warmListCacheForMismatches('vendor');
        const row = (cacheGet('nm_vendors')?.vendors || []).find(v => v.qboId === id);
        if (!row) return res.status(404).json({ ok: false, error: 'Vendor not found' });
        const erp = readErp();
        const counts = countVendorUsageByQboId(erp, id);
        return res.json({
          ok: true,
          record: {
            type: 'vendor',
            ...row,
            counts,
            qboEditUrl: `https://app.qbo.intuit.com/app/vendordetail?nameId=${encodeURIComponent(id)}${qboCompany}`
          }
        });
      }
      if (type === 'customer') {
        await warmListCacheForMismatches('customer');
        const row = (cacheGet('nm_customers')?.customers || []).find(c => c.qboId === id);
        if (!row) return res.status(404).json({ ok: false, error: 'Customer not found' });
        const erp = readErp();
        const counts = countCustomerUsageByQboId(erp, id);
        return res.json({
          ok: true,
          record: {
            type: 'customer',
            ...row,
            counts,
            qboEditUrl: `https://app.qbo.intuit.com/app/customerdetail?nameId=${encodeURIComponent(id)}${qboCompany}`
          }
        });
      }
      if (!getPool()) return res.status(503).json({ ok: false, error: 'DATABASE_URL required for driver detail' });
      await warmListCacheForMismatches('driver');
      const row = (cacheGet('nm_drivers')?.drivers || []).find(d => d.erpId === id);
      if (!row) return res.status(404).json({ ok: false, error: 'Driver not found' });
      const erp = readErp();
      const counts = countDriverUsageInErp(erp, id, row.erpName);
      const links = await loadDriverLinks();
      const link = links.get(id);
      return res.json({
        ok: true,
        record: {
          type: 'driver',
          ...row,
          counts,
          link,
          qboEditUrl: row.qboId
            ? `https://app.qbo.intuit.com/app/vendordetail?nameId=${encodeURIComponent(row.qboId)}${qboCompany}`
            : null,
          samsaraUrl: row.samsaraId ? `https://cloud.samsara.com/o/drivers/${encodeURIComponent(row.samsaraId)}` : null
        }
      });
    } catch (e) {
      logError('GET /api/name-management/record/:type/:id', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/samsara-drivers', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const drivers = await fetchSamsaraDriversNormalized({ q, limit: 400 });
      res.json({ ok: true, drivers });
    } catch (e) {
      logError('GET /api/name-management/samsara-drivers', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/name-management/link', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!requireDb(res)) return;
    try {
      const b = req.body || {};
      const erpDriverId = String(b.erp_driver_id || b.erpDriverId || '').trim();
      const samsaraDriverId = b.samsara_driver_id != null ? String(b.samsara_driver_id).trim() : null;
      const qboVendorId = b.qbo_vendor_id != null ? String(b.qbo_vendor_id).trim() : null;
      const qboEmployeeId = b.qbo_employee_id != null ? String(b.qbo_employee_id).trim() : null;
      if (!erpDriverId) return res.status(400).json({ ok: false, error: 'erp_driver_id required' });
      const by = maintAuthUserLabel(req);
      await dbQuery(
        `INSERT INTO driver_system_links (erp_driver_id, samsara_driver_id, qbo_vendor_id, qbo_employee_id, link_confidence, linked_by, linked_at, updated_at)
         VALUES ($1,$2,$3,$4,'manual',$5,now(),now())
         ON CONFLICT (erp_driver_id) DO UPDATE SET
           samsara_driver_id = EXCLUDED.samsara_driver_id,
           qbo_vendor_id = EXCLUDED.qbo_vendor_id,
           qbo_employee_id = EXCLUDED.qbo_employee_id,
           link_confidence = 'manual',
           linked_by = EXCLUDED.linked_by,
           linked_at = now(),
           updated_at = now()`,
        [erpDriverId, samsaraDriverId || null, qboVendorId || null, qboEmployeeId || null, by]
      );
      await dbQuery(
        `UPDATE drivers SET samsara_driver_id = COALESCE($2::text, samsara_driver_id), qbo_vendor_id = COALESCE($3::text, qbo_vendor_id) WHERE id = $1::uuid`,
        [erpDriverId, samsaraDriverId || null, qboVendorId || null]
      );
      invalidateNmCache();
      res.json({ ok: true });
    } catch (e) {
      logError('POST /api/name-management/link', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  async function runRenameOperation(b, by) {
    const type = String(b.type || '').toLowerCase();
    const newName = String(b.new_name || b.newName || '').trim();
    const updateQbo = b.update_qbo !== false;
    const updateErp = b.update_erp !== false;
    if (!['vendor', 'driver', 'customer'].includes(type) || newName.length < 2) {
      return { ok: false, status: 400, error: 'type and new_name (2+ chars) required' };
    }
    let qboUpdated = false;
    let qboError = null;
    let samsaraUpdated = false;
    let samsaraError = null;
    let erpN = 0;
    let erpError = null;
    const systemsAttempted = { qbo: updateQbo, samsara: false, erp: updateErp };
    const systemsSucceeded = { qbo: false, samsara: false, erp: false };
    let qboId = String(b.qbo_id || b.qboId || '').trim();
    let erpId = String(b.erp_id || b.erpId || '').trim();
    let samsaraId = String(b.samsara_id || b.samsaraId || '').trim();
    let oldName = '';
    const erpData = readErp();

    if (type === 'vendor') {
      if (!qboId) return { ok: false, status: 400, error: 'qbo_id required for vendor' };
      const vd = await qboGet(`vendor/${encodeURIComponent(qboId)}`);
      oldName = String(vd?.Vendor?.DisplayName || '').trim();
      if (updateQbo) {
        try {
          await qboUpdateVendorName(qboGet, qboPost, qboId, newName);
          qboUpdated = true;
          const ver = await verifyQboName(qboGet, 'vendor', qboId, newName);
          systemsSucceeded.qbo = ver.ok;
          if (!ver.ok) qboError = `QuickBooks accepted the update but DisplayName is still "${ver.displayName}" (propagation delay?)`;
        } catch (e) {
          qboError = e.message;
        }
      }
      if (updateErp) {
        try {
          erpN = applyVendorNameToErp(erpData, qboId, newName);
          writeErp(erpData);
          systemsSucceeded.erp = true;
        } catch (e) {
          erpError = e.message;
        }
      }
      erpId = qboId;
    } else if (type === 'customer') {
      if (!qboId) return { ok: false, status: 400, error: 'qbo_id required for customer' };
      const cd = await qboGet(`customer/${encodeURIComponent(qboId)}`);
      oldName = String(cd?.Customer?.DisplayName || '').trim();
      if (updateQbo) {
        try {
          await qboUpdateCustomerName(qboGet, qboPost, qboId, newName);
          qboUpdated = true;
          const ver = await verifyQboName(qboGet, 'customer', qboId, newName);
          systemsSucceeded.qbo = ver.ok;
          if (!ver.ok) qboError = `QuickBooks accepted the update but DisplayName is still "${ver.displayName}" (propagation delay?)`;
        } catch (e) {
          qboError = e.message;
        }
      }
      if (updateErp) {
        try {
          erpN = applyCustomerNameToErp(erpData, qboId, newName);
          writeErp(erpData);
          systemsSucceeded.erp = true;
        } catch (e) {
          erpError = e.message;
        }
      }
      erpId = qboId;
    } else if (type === 'driver') {
      if (!erpId) return { ok: false, status: 400, error: 'erp_id required for driver' };
      const { rows: dr } = await dbQuery(
        'SELECT id, name, qbo_vendor_id, samsara_driver_id FROM drivers WHERE id = $1::uuid',
        [erpId]
      );
      const d = dr?.[0];
      if (!d) return { ok: false, status: 404, error: 'Driver not found' };
      oldName = String(d.name || '').trim();
      const links = await loadDriverLinks();
      const link = links.get(erpId);
      if (!qboId) qboId = d.qbo_vendor_id ? String(d.qbo_vendor_id) : link?.qbo_vendor_id ? String(link.qbo_vendor_id) : '';
      if (!samsaraId) samsaraId = d.samsara_driver_id ? String(d.samsara_driver_id) : link?.samsara_driver_id ? String(link.samsara_driver_id) : '';
      const qboEmployeeId = link?.qbo_employee_id ? String(link.qbo_employee_id) : '';
      const updateSamsara = b.update_samsara !== false && Boolean(samsaraId);
      systemsAttempted.samsara = updateSamsara;
      if (updateQbo) {
        try {
          if (qboId) {
            await qboUpdateVendorName(qboGet, qboPost, qboId, newName);
            qboUpdated = true;
            const ver = await verifyQboName(qboGet, 'vendor', qboId, newName);
            systemsSucceeded.qbo = ver.ok;
            if (!ver.ok) qboError = `QuickBooks accepted the update but DisplayName is still "${ver.displayName}" (propagation delay?)`;
          } else if (qboEmployeeId) {
            await qboUpdateEmployeeName(qboGet, qboPost, qboEmployeeId, newName);
            qboUpdated = true;
            const ver = await verifyQboName(qboGet, 'employee', qboEmployeeId, newName);
            systemsSucceeded.qbo = ver.ok;
            if (!ver.ok) qboError = `QuickBooks accepted the update but DisplayName is still "${ver.displayName}" (propagation delay?)`;
            qboId = qboEmployeeId;
          } else {
            qboError = 'No QuickBooks vendor or employee id linked for this driver';
          }
        } catch (e) {
          qboError = e.message;
        }
      }
      if (updateSamsara && samsaraApiPatch) {
        try {
          await samsaraApiPatch(`/fleet/drivers/${encodeURIComponent(samsaraId)}`, { name: newName });
          samsaraUpdated = true;
          systemsSucceeded.samsara = true;
        } catch (e) {
          samsaraError = e.message;
        }
      }
      if (updateErp) {
        try {
          erpN = applyDriverNameToErp(erpData, erpId, oldName, newName);
          const wr = await dbQuery(`UPDATE drivers SET name = $1 WHERE id = $2::uuid AND name IS DISTINCT FROM $1`, [
            newName,
            erpId
          ]);
          erpN += Number(wr.rowCount || 0);
          writeErp(erpData);
          systemsSucceeded.erp = true;
        } catch (e) {
          erpError = e.message;
        }
      }
    } else {
      return { ok: false, status: 400, error: 'Unsupported type' };
    }

    const updateSamsaraRequested = type === 'driver' ? b.update_samsara !== false && Boolean(samsaraId) : false;
    systemsAttempted.samsara = updateSamsaraRequested;

    try {
      const erpKey = type === 'driver' ? erpId : qboId;
      await dbQuery(
        `INSERT INTO canonical_names (record_type, erp_id, canonical_name, set_by, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (record_type, erp_id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name, set_by = EXCLUDED.set_by, set_at = now()`,
        [type, erpKey, newName, by, null]
      );
    } catch {
      /* canonical_names missing until migrate */
    }

    let logId = null;
    try {
      const logRes = await dbQuery(
        `INSERT INTO rename_log (
          record_type, erp_id, qbo_id, samsara_id, old_name, new_name,
          update_qbo_requested, update_samsara_requested, update_erp_requested,
          qbo_updated, qbo_error, samsara_updated, samsara_error, erp_records_updated, erp_error,
          renamed_by, systems_attempted, systems_succeeded, error_details
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING id`,
        [
          type,
          type === 'driver' ? erpId : qboId,
          qboId || null,
          samsaraId || null,
          oldName,
          newName,
          updateQbo,
          updateSamsaraRequested,
          updateErp,
          Boolean(updateQbo && qboUpdated && !qboError),
          qboError,
          samsaraUpdated,
          samsaraError,
          erpN,
          erpError,
          by,
          JSON.stringify(systemsAttempted),
          JSON.stringify(systemsSucceeded),
          JSON.stringify({ qboError, samsaraError, erpError })
        ]
      );
      logId = logRes.rows?.[0]?.id;
    } catch (e) {
      logError('rename_log insert', e);
    }

    invalidateNmCache();
    const success =
      (updateQbo ? !qboError && systemsSucceeded.qbo !== false : true) &&
      (updateSamsaraRequested ? samsaraUpdated || !samsaraId : true) &&
      (updateErp ? !erpError : true);
    return {
      ok: true,
      success,
      qbo_updated: Boolean(updateQbo && !qboError && qboUpdated),
      qbo_error: qboError,
      samsara_updated: samsaraUpdated,
      samsara_error: samsaraError,
      erp_records_updated: erpN,
      erp_error: erpError,
      log_id: logId
    };
  }

  app.post('/api/name-management/rename', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!requireDb(res)) return;
    try {
      const by = maintAuthUserLabel(req);
      const out = await runRenameOperation(req.body || {}, by);
      if (!out.ok) return res.status(out.status || 400).json(out);
      res.json({ ok: true, ...out });
    } catch (e) {
      logError('POST /api/name-management/rename', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/name-management/bulk-rename', async (req, res) => {
    if (!requireErpWriteOrAdmin(req, res)) return;
    if (!requireDb(res)) return;
    try {
      const items = Array.isArray(req.body?.renames) ? req.body.renames : [];
      if (!items.length || items.length > 50) {
        return res.status(400).json({ ok: false, error: 'Provide 1–50 renames in body.renames' });
      }
      const by = maintAuthUserLabel(req);
      const results = [];
      for (const it of items) {
        try {
          const out = await runRenameOperation(it, by);
          results.push(out);
        } catch (e) {
          results.push({ ok: false, error: e.message });
        }
      }
      res.json({ ok: true, results });
    } catch (e) {
      logError('POST /api/name-management/bulk-rename', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/name-management/rename-history', async (req, res) => {
    try {
      if (!getPool()) {
        if (String(req.query.format || '').toLowerCase() === 'xlsx') {
          return res.status(503).json({ ok: false, error: 'DATABASE_URL not set' });
        }
        return res.json({ ok: true, rows: [], total: 0, dbDisabled: true });
      }
      const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
      const rt = String(req.query.type || '').trim();
      const by = String(req.query.renamed_by || '').trim();
      const start = String(req.query.startDate || '').trim();
      const end = String(req.query.endDate || '').trim();
      const wh = [];
      const pr = [];
      let i = 1;
      if (rt) {
        wh.push(`record_type = $${i++}`);
        pr.push(rt);
      }
      if (by) {
        wh.push(`renamed_by ILIKE $${i++}`);
        pr.push(`%${by}%`);
      }
      if (start) {
        wh.push(`renamed_at >= $${i++}::timestamptz`);
        pr.push(start);
      }
      if (end) {
        wh.push(`renamed_at < ($${i++}::timestamptz + interval '1 day')`);
        pr.push(end);
      }
      const where = wh.length ? `WHERE ${wh.join(' AND ')}` : '';
      const cnt = await dbQuery(`SELECT count(*)::int AS c FROM rename_log ${where}`, pr);
      const total = cnt.rows?.[0]?.c ?? 0;
      const r = await dbQuery(
        `SELECT id, record_type, erp_id, qbo_id, samsara_id, old_name, new_name,
                update_qbo_requested, update_samsara_requested, update_erp_requested,
                qbo_updated, qbo_error, samsara_updated, samsara_error, erp_records_updated, erp_error,
                renamed_by, renamed_at, systems_attempted, systems_succeeded, error_details
         FROM rename_log ${where} ORDER BY renamed_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...pr, limit, offset]
      );
      if (String(req.query.format || '').toLowerCase() === 'xlsx') {
        const aoa = [
          ['Date', 'Type', 'ERP id', 'Old', 'New', 'QBO ok', 'Samsara ok', 'ERP count', 'By', 'QBO err', 'Samsara err', 'ERP err'],
          ...(r.rows || []).map(x => [
            x.renamed_at ? new Date(x.renamed_at).toLocaleString('en-US') : '',
            x.record_type,
            x.erp_id,
            x.old_name,
            x.new_name,
            x.qbo_updated ? 'Y' : 'N',
            x.samsara_updated ? 'Y' : 'N',
            x.erp_records_updated,
            x.renamed_by,
            x.qbo_error || '',
            x.samsara_error || '',
            x.erp_error || ''
          ])
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, ws, 'rename_log');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="rename-history.xlsx"');
        return res.send(Buffer.from(buf));
      }
      res.json({ ok: true, rows: r.rows || [], total, limit, offset });
    } catch (e) {
      logError('GET /api/name-management/rename-history', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
