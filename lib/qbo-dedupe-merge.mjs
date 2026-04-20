/**
 * QBO vendor/customer merge: repoint transactions, deactivate merged entity, ERP + DB id swaps.
 * All network I/O is injected via { qboGet, qboPost, qboQuery } from the main server client.
 */

import { getPool } from './db.mjs';

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
    for (const row of arr) {
      if (row?.Id) out.push({ Id: row.Id, SyncToken: row.SyncToken });
    }
    if (arr.length < 500) break;
    start += 500;
  }
  return out;
}

async function listVendorTxnIds(qboQuery, vendorId) {
  const vid = String(vendorId || '').trim();
  const bills = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from Bill where VendorRef = '${vid}'`
  );
  const purchases = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from Purchase where EntityRef = '${vid}'`
  );
  const vcs = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from VendorCredit where VendorRef = '${vid}'`
  );
  const pos = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from PurchaseOrder where VendorRef = '${vid}'`
  );
  let pays = [];
  try {
    pays = await qboQueryPaged(
      qboQuery,
      `select Id, SyncToken from BillPayment where VendorRef = '${vid}'`
    );
  } catch {
    pays = [];
  }
  return { bills, purchases, vendorCredits: vcs, purchaseOrders: pos, billPayments: pays };
}

async function listCustomerTxnIds(qboQuery, customerId) {
  const cid = String(customerId || '').trim();
  const invoices = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from Invoice where CustomerRef = '${cid}'`
  );
  const receipts = await qboQueryPaged(
    qboQuery,
    `select Id, SyncToken from SalesReceipt where CustomerRef = '${cid}'`
  );
  let payments = [];
  let memos = [];
  try {
    payments = await qboQueryPaged(
      qboQuery,
      `select Id, SyncToken from Payment where CustomerRef = '${cid}'`
    );
  } catch {
    payments = [];
  }
  try {
    memos = await qboQueryPaged(
      qboQuery,
      `select Id, SyncToken from CreditMemo where CustomerRef = '${cid}'`
    );
  } catch {
    memos = [];
  }
  return { invoices, salesReceipts: receipts, payments, creditMemos: memos };
}

function countTxnBuckets(b) {
  let n = 0;
  for (const k of Object.keys(b)) n += (b[k] || []).length;
  return n;
}

async function postFullEntity(qboPost, entityPath, entity) {
  return qboPost(entityPath, entity);
}

export async function countVendorTransactions(qboQuery, mergedVendorId) {
  const b = await listVendorTxnIds(qboQuery, mergedVendorId);
  return { buckets: b, total: countTxnBuckets(b) };
}

export async function countCustomerTransactions(qboQuery, mergedCustomerId) {
  const b = await listCustomerTxnIds(qboQuery, mergedCustomerId);
  return { buckets: b, total: countTxnBuckets(b) };
}

async function repointVendorTxns(qboGet, qboPost, qboQuery, mergedVendorId, keptVendorId, audit) {
  const vid = String(mergedVendorId);
  const kept = String(keptVendorId);
  const buckets = await listVendorTxnIds(qboQuery, vid);
  let moved = 0;

  for (const { Id } of buckets.bills) {
    const data = await qboGet(`bill/${encodeURIComponent(Id)}`);
    const ent = data?.Bill;
    if (!ent?.Id) continue;
    if (String(ent.VendorRef?.value || '') !== vid) continue;
    ent.VendorRef = { value: kept, name: ent.VendorRef?.name };
    const resp = await postFullEntity(qboPost, 'bill', ent);
    audit.push({ op: 'bill', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.purchases) {
    const data = await qboGet(`purchase/${encodeURIComponent(Id)}`);
    const ent = data?.Purchase;
    if (!ent?.Id) continue;
    const ref = ent.EntityRef;
    if (String(ref?.value || '') !== vid || String(ref?.type || '').toLowerCase() !== 'vendor') continue;
    ent.EntityRef = { type: 'Vendor', value: kept, name: ref?.name };
    const resp = await postFullEntity(qboPost, 'purchase', ent);
    audit.push({ op: 'purchase', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.vendorCredits) {
    const data = await qboGet(`vendorcredit/${encodeURIComponent(Id)}`);
    const ent = data?.VendorCredit;
    if (!ent?.Id) continue;
    if (String(ent.VendorRef?.value || '') !== vid) continue;
    ent.VendorRef = { value: kept, name: ent.VendorRef?.name };
    const resp = await postFullEntity(qboPost, 'vendorcredit', ent);
    audit.push({ op: 'vendorcredit', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.purchaseOrders) {
    const data = await qboGet(`purchaseorder/${encodeURIComponent(Id)}`);
    const ent = data?.PurchaseOrder;
    if (!ent?.Id) continue;
    if (String(ent.VendorRef?.value || '') !== vid) continue;
    ent.VendorRef = { value: kept, name: ent.VendorRef?.name };
    const resp = await postFullEntity(qboPost, 'purchaseorder', ent);
    audit.push({ op: 'purchaseorder', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.billPayments) {
    const data = await qboGet(`billpayment/${encodeURIComponent(Id)}`);
    const ent = data?.BillPayment;
    if (!ent?.Id) continue;
    if (String(ent.VendorRef?.value || '') !== vid) continue;
    ent.VendorRef = { value: kept, name: ent.VendorRef?.name };
    const resp = await postFullEntity(qboPost, 'billpayment', ent);
    audit.push({ op: 'billpayment', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  return moved;
}

async function repointCustomerTxns(qboGet, qboPost, qboQuery, mergedCustomerId, keptCustomerId, audit) {
  const cid = String(mergedCustomerId);
  const kept = String(keptCustomerId);
  const buckets = await listCustomerTxnIds(qboQuery, cid);
  let moved = 0;

  for (const { Id } of buckets.invoices) {
    const data = await qboGet(`invoice/${encodeURIComponent(Id)}`);
    const ent = data?.Invoice;
    if (!ent?.Id) continue;
    if (String(ent.CustomerRef?.value || '') !== cid) continue;
    ent.CustomerRef = { value: kept, name: ent.CustomerRef?.name };
    const resp = await postFullEntity(qboPost, 'invoice', ent);
    audit.push({ op: 'invoice', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.salesReceipts) {
    const data = await qboGet(`salesreceipt/${encodeURIComponent(Id)}`);
    const ent = data?.SalesReceipt;
    if (!ent?.Id) continue;
    if (String(ent.CustomerRef?.value || '') !== cid) continue;
    ent.CustomerRef = { value: kept, name: ent.CustomerRef?.name };
    const resp = await postFullEntity(qboPost, 'salesreceipt', ent);
    audit.push({ op: 'salesreceipt', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.payments) {
    const data = await qboGet(`payment/${encodeURIComponent(Id)}`);
    const ent = data?.Payment;
    if (!ent?.Id) continue;
    if (String(ent.CustomerRef?.value || '') !== cid) continue;
    ent.CustomerRef = { value: kept, name: ent.CustomerRef?.name };
    const resp = await postFullEntity(qboPost, 'payment', ent);
    audit.push({ op: 'payment', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  for (const { Id } of buckets.creditMemos) {
    const data = await qboGet(`creditmemo/${encodeURIComponent(Id)}`);
    const ent = data?.CreditMemo;
    if (!ent?.Id) continue;
    if (String(ent.CustomerRef?.value || '') !== cid) continue;
    ent.CustomerRef = { value: kept, name: ent.CustomerRef?.name };
    const resp = await postFullEntity(qboPost, 'creditmemo', ent);
    audit.push({ op: 'creditmemo', id: Id, ok: true, resp: summarizeQbo(resp) });
    moved++;
  }
  return moved;
}

function summarizeQbo(resp) {
  const keys = resp && typeof resp === 'object' ? Object.keys(resp) : [];
  const top = keys[0];
  const id = top && resp[top]?.Id ? String(resp[top].Id) : '';
  return { top, id };
}

export function applyErpVendorIdMerge(erp, mergedId, keptId) {
  const from = String(mergedId);
  const to = String(keptId);
  let n = 0;
  const visit = o => {
    if (Array.isArray(o)) {
      for (const x of o) visit(x);
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if ((k === 'qboVendorId' || k === 'vendorQboId') && String(o[k]) === from) {
        o[k] = to;
        n++;
      } else visit(o[k]);
    }
  };
  visit(erp);
  return n;
}

export function applyErpCustomerIdMerge(erp, mergedId, keptId) {
  const from = String(mergedId);
  const to = String(keptId);
  let n = 0;
  const visit = o => {
    if (Array.isArray(o)) {
      for (const x of o) visit(x);
      return;
    }
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if ((k === 'qboCustomerId' || k === 'fuelPostedCustomerId') && String(o[k]) === from) {
        o[k] = to;
        n++;
      } else visit(o[k]);
    }
  };
  visit(erp);
  return n;
}

export async function updatePostgresVendorRefs(mergedId, keptId) {
  const pool = getPool();
  if (!pool) return 0;
  let total = 0;
  const from = String(mergedId);
  const to = String(keptId);
  const r1 = await pool.query(`UPDATE drivers SET qbo_vendor_id = $1 WHERE qbo_vendor_id = $2`, [to, from]);
  total += r1.rowCount || 0;
  const r2 = await pool.query(`UPDATE loads SET qbo_driver_vendor_id = $1 WHERE qbo_driver_vendor_id = $2`, [to, from]);
  total += r2.rowCount || 0;
  return total;
}

export async function updatePostgresCustomerRefs(mergedId, keptId) {
  const pool = getPool();
  if (!pool) return 0;
  const from = String(mergedId);
  const to = String(keptId);
  const r = await pool.query(`UPDATE loads SET qbo_customer_id = $1 WHERE qbo_customer_id = $2`, [to, from]);
  return r.rowCount || 0;
}

export async function deactivateQboVendor(qboGet, qboPost, vendorId, displayNameBase) {
  const id = String(vendorId || '').trim();
  const data = await qboGet(`vendor/${encodeURIComponent(id)}`);
  const v = data?.Vendor;
  if (!v?.Id) throw new Error('Merged vendor not found in QuickBooks');
  const name = String(displayNameBase || v.DisplayName || 'Vendor').trim();
  const body = {
    sparse: true,
    Id: v.Id,
    SyncToken: v.SyncToken,
    DisplayName: `${name} [MERGED]`.slice(0, 500),
    Active: false
  };
  return qboPost('vendor', body);
}

/**
 * @returns {Promise<{ transactionsTransferred: number, erpRecordsUpdated: number, audit: object[], qboDeactivate: any }>}
 */
export async function executeVendorMerge({ qboGet, qboPost, qboQuery }, { keepId, mergeId, readErp, writeErp }) {
  const kept = String(keepId).trim();
  const merged = String(mergeId).trim();
  if (!kept || !merged || kept === merged) throw new Error('Invalid vendor ids');

  const vKeep = await qboGet(`vendor/${encodeURIComponent(kept)}`);
  const vMerge = await qboGet(`vendor/${encodeURIComponent(merged)}`);
  if (!vKeep?.Vendor?.Id) throw new Error('Kept vendor not found in QuickBooks');
  if (!vMerge?.Vendor?.Id) throw new Error('Merged vendor not found in QuickBooks');

  const audit = [];
  const txnMoved = await repointVendorTxns(qboGet, qboPost, qboQuery, merged, kept, audit);

  const deact = await deactivateQboVendor(
    qboGet,
    qboPost,
    merged,
    vMerge.Vendor.DisplayName || vMerge.Vendor.CompanyName
  );
  audit.push({ op: 'vendor_deactivate', id: merged, resp: summarizeQbo(deact) });

  const erp = readErp();
  const erpN = applyErpVendorIdMerge(erp, merged, kept);
  writeErp(erp);

  let pgN = 0;
  try {
    pgN = await updatePostgresVendorRefs(merged, kept);
  } catch (e) {
    audit.push({ op: 'postgres_drivers_loads', ok: false, error: String(e?.message || e) });
  }

  return {
    transactionsTransferred: txnMoved,
    erpRecordsUpdated: erpN + pgN,
    erpJsonUpdates: erpN,
    postgresUpdates: pgN,
    audit,
    qboDeactivate: deact
  };
}

export async function executeCustomerMerge({ qboGet, qboPost, qboQuery }, { keepId, mergeId, readErp, writeErp }) {
  const kept = String(keepId).trim();
  const merged = String(mergeId).trim();
  if (!kept || !merged || kept === merged) throw new Error('Invalid customer ids');

  const cKeep = await qboGet(`customer/${encodeURIComponent(kept)}`);
  const cMerge = await qboGet(`customer/${encodeURIComponent(merged)}`);
  if (!cKeep?.Customer?.Id) throw new Error('Kept customer not found in QuickBooks');
  if (!cMerge?.Customer?.Id) throw new Error('Merged customer not found in QuickBooks');

  const audit = [];
  const txnMoved = await repointCustomerTxns(qboGet, qboPost, qboQuery, merged, kept, audit);

  const cm = cMerge.Customer;
  const name = String(cm.DisplayName || cm.CompanyName || 'Customer').trim();
  const body = {
    sparse: true,
    Id: cm.Id,
    SyncToken: cm.SyncToken,
    DisplayName: `${name} [MERGED]`.slice(0, 500),
    Active: false
  };
  const deact = await qboPost('customer', body);
  audit.push({ op: 'customer_deactivate', id: merged, resp: summarizeQbo(deact) });

  const erp = readErp();
  const erpN = applyErpCustomerIdMerge(erp, merged, kept);
  writeErp(erp);

  let pgN = 0;
  try {
    pgN = await updatePostgresCustomerRefs(merged, kept);
  } catch (e) {
    audit.push({ op: 'postgres_loads_customer', ok: false, error: String(e?.message || e) });
  }

  return {
    transactionsTransferred: txnMoved,
    erpRecordsUpdated: erpN + pgN,
    erpJsonUpdates: erpN,
    postgresUpdates: pgN,
    audit,
    qboDeactivate: deact
  };
}
