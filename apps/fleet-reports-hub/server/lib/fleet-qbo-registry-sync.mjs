/**
 * Packet 9 — QuickBooks vendor / class sync for fleet SQLite registries (drivers, vendors_local, assets).
 * Uses repo-root `lib/qbo-api-client.mjs` + `data/qbo_tokens.json` when connected.
 */
import { createQboApiClient } from '../../../../lib/qbo-api-client.mjs';

export function tryCreateQboClient() {
  try {
    return createQboApiClient();
  } catch {
    return null;
  }
}

/** @param {import('better-sqlite3').Database} db */
function vendorPayloadFromDriverRow(row) {
  const displayName = String(row.full_name || '').trim().slice(0, 400) || 'Driver';
  const given = row.first_name ? String(row.first_name).trim() : '';
  const family = row.last_name ? String(row.last_name).trim() : '';
  /** @type {Record<string, unknown>} */
  const payload = {
    DisplayName: displayName,
    PrintOnCheckName: displayName.slice(0, 100),
  };
  if (given) payload.GivenName = given;
  if (family) payload.FamilyName = family;
  if (row.phone) payload.PrimaryPhone = { FreeFormNumber: String(row.phone).trim() };
  if (row.email) payload.PrimaryEmailAddr = { Address: String(row.email).trim() };
  const addr = {};
  if (row.address) addr.Line1 = String(row.address).trim();
  if (row.city) addr.City = String(row.city).trim();
  if (row.state) addr.CountrySubDivisionCode = String(row.state).trim();
  if (row.zip) addr.PostalCode = String(row.zip).trim();
  if (row.country) addr.Country = String(row.country).trim() || 'USA';
  if (Object.keys(addr).length) payload.BillAddr = addr;
  return payload;
}

/** @param {import('better-sqlite3').Database} db */
export async function upsertDriverAsQboVendor(db, driverId, { qboGet, qboPost }) {
  const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driverId);
  if (!row) throw new Error('Driver not found');
  const t = new Date().toISOString();
  const vid = String(row.qbo_vendor_id || '').trim();
  const base = vendorPayloadFromDriverRow(row);

  if (vid) {
    const data = await qboGet(`vendor/${encodeURIComponent(vid)}`);
    const v = data?.Vendor;
    if (!v?.Id) throw new Error('Vendor not found in QuickBooks');
    await qboPost('vendor', {
      sparse: true,
      Id: v.Id,
      SyncToken: v.SyncToken,
      ...base,
    });
    db.prepare('UPDATE drivers SET qbo_synced = 1, qbo_synced_at = ?, updated_at = ? WHERE id = ?').run(t, t, driverId);
    return { vendorId: vid, created: false };
  }

  const data = await qboPost('vendor', base);
  const created = data?.Vendor?.Id;
  if (!created) throw new Error('QuickBooks did not return vendor Id');
  const idStr = String(created);
  db.prepare(
    'UPDATE drivers SET qbo_vendor_id = ?, qbo_synced = 1, qbo_synced_at = ?, updated_at = ? WHERE id = ?',
  ).run(idStr, t, t, driverId);
  return { vendorId: idStr, created: true };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function syncAllActiveDriversToQbo(db, client) {
  const rows = db.prepare(`SELECT id FROM drivers WHERE status = 'active'`).all();
  const errors = [];
  let synced = 0;
  for (const r of rows) {
    try {
      await upsertDriverAsQboVendor(db, r.id, client);
      synced++;
    } catch (e) {
      errors.push({ id: r.id, error: String(e?.message || e) });
    }
  }
  return { synced, errors };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function pullVendorsFromQboIntoDb(db, { qboQuery }) {
  const data = await qboQuery('SELECT * FROM Vendor MAXRESULTS 1000');
  const vendors = data?.QueryResponse?.Vendor;
  const list = Array.isArray(vendors) ? vendors : vendors ? [vendors] : [];
  const t = new Date().toISOString();
  const ins = db.prepare(`
        INSERT INTO vendors_local (
          qbo_vendor_id, display_name, company_name, first_name, last_name,
          phone, email, address, city, state, zip, country,
          vendor_type, tax_id, payment_terms,
          qbo_synced, qbo_synced_at, status, created_at, updated_at
        ) VALUES (
          @qbo_vendor_id, @display_name, @company_name, @first_name, @last_name,
          @phone, @email, @address, @city, @state, @zip, @country,
          @vendor_type, @tax_id, @payment_terms,
          1, @t, 'active', @t, @t
        )
        ON CONFLICT(qbo_vendor_id) DO UPDATE SET
          display_name = excluded.display_name,
          company_name = excluded.company_name,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          phone = excluded.phone,
          email = excluded.email,
          address = excluded.address,
          city = excluded.city,
          state = excluded.state,
          zip = excluded.zip,
          country = excluded.country,
          vendor_type = excluded.vendor_type,
          tax_id = excluded.tax_id,
          payment_terms = excluded.payment_terms,
          qbo_synced = 1,
          qbo_synced_at = excluded.qbo_synced_at,
          updated_at = excluded.updated_at
      `);
  let n = 0;
  for (const v of list) {
    const qid = String(v.Id || '').trim();
    if (!qid) continue;
    const ba = v.BillAddr || {};
    ins.run({
      qbo_vendor_id: qid,
      display_name: String(v.DisplayName || v.CompanyName || qid).slice(0, 500),
      company_name: v.CompanyName ? String(v.CompanyName) : null,
      first_name: v.GivenName ? String(v.GivenName) : null,
      last_name: v.FamilyName ? String(v.FamilyName) : null,
      phone: v.PrimaryPhone?.FreeFormNumber ? String(v.PrimaryPhone.FreeFormNumber) : null,
      email: v.PrimaryEmailAddr?.Address ? String(v.PrimaryEmailAddr.Address) : null,
      address: ba.Line1 ? String(ba.Line1) : null,
      city: ba.City ? String(ba.City) : null,
      state: ba.CountrySubDivisionCode ? String(ba.CountrySubDivisionCode) : null,
      zip: ba.PostalCode ? String(ba.PostalCode) : null,
      country: ba.Country ? String(ba.Country) : 'USA',
      vendor_type: v.Vendor1099 ? '1099' : null,
      tax_id: v.TaxIdentifier ? String(v.TaxIdentifier) : null,
      payment_terms: (v.TermRef || v.SalesTermRef)?.name ? String((v.TermRef || v.SalesTermRef).name) : null,
      t,
    });
    n++;
  }
  return { synced: n, refreshedAt: t };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function ensureAssetQboClass(db, assetRow, { qboGet, qboPost }) {
  const t = new Date().toISOString();
  const unit = String(assetRow.unit_number || '').trim();
  if (!unit) throw new Error('Missing unit_number');
  const cid = String(assetRow.qbo_class_id || '').trim();

  if (cid) {
    try {
      await qboGet(`class/${encodeURIComponent(cid)}`);
      db.prepare('UPDATE assets SET qbo_class_name = ?, qbo_synced = 1, updated_at = ? WHERE id = ?').run(
        unit,
        t,
        assetRow.id,
      );
      return { classId: cid, reused: true };
    } catch {
      db.prepare('UPDATE assets SET qbo_class_id = NULL, qbo_class_name = NULL WHERE id = ?').run(assetRow.id);
    }
  }

  const data = await qboPost('class', { Name: unit.slice(0, 100) });
  const newId = data?.Class?.Id;
  if (!newId) throw new Error('QuickBooks did not return class Id');
  const idStr = String(newId);
  db.prepare(
    'UPDATE assets SET qbo_class_id = ?, qbo_class_name = ?, qbo_synced = 1, updated_at = ? WHERE id = ?',
  ).run(idStr, unit, t, assetRow.id);
  return { classId: idStr, reused: false };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function syncAllActiveTruckClasses(db, client) {
  const rows = db
    .prepare(`SELECT * FROM assets WHERE status = 'active' AND COALESCE(asset_type, 'truck') = 'truck'`)
    .all();
  const errors = [];
  let synced = 0;
  for (const r of rows) {
    try {
      await ensureAssetQboClass(db, r, client);
      synced++;
    } catch (e) {
      errors.push({ id: r.id, unit: r.unit_number, error: String(e?.message || e) });
    }
  }
  return { synced, errors };
}
