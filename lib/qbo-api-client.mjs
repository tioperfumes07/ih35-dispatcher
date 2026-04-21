/**
 * QuickBooks Online v3 JSON API — GET entity, POST sparse/full entity, GET query.
 * Uses `data/qbo_tokens.json` + `qboRefreshIfNeededLib` from `qbo-attachments.mjs`.
 */

import { readQboStore, qboRefreshIfNeededLib } from './qbo-attachments.mjs';

const QBO_API_BASE = 'https://quickbooks.api.intuit.com';
const QBO_MINOR_VERSION = String(process.env.QBO_MINOR_VERSION || '65').trim();

/** Lowercase URL segment → JSON root key for POST body. */
const POST_BODY_ROOT = {
  vendor: 'Vendor',
  customer: 'Customer',
  employee: 'Employee',
  bill: 'Bill',
  purchase: 'Purchase',
  billpayment: 'BillPayment',
  vendorcredit: 'VendorCredit',
  purchaseorder: 'PurchaseOrder',
  invoice: 'Invoice',
  salesreceipt: 'SalesReceipt',
  payment: 'Payment',
  creditmemo: 'CreditMemo'
};

function intuitErrorMessage(data, fallback) {
  const e0 = data?.Fault?.Error?.[0];
  const msg = e0?.Message || e0?.Detail || data?.Message || data?.error;
  if (msg) return String(msg);
  try {
    return JSON.stringify(data).slice(0, 500);
  } catch {
    return fallback || 'QuickBooks request failed';
  }
}

async function authContext() {
  await qboRefreshIfNeededLib();
  const store = readQboStore();
  const realmId = store?.tokens?.realmId || store?.tokens?.realm_id;
  const accessToken = store?.tokens?.access_token;
  if (!realmId || !accessToken) {
    throw new Error('QuickBooks is not connected (missing realmId or access_token in qbo_tokens.json).');
  }
  return { realmId: String(realmId), accessToken: String(accessToken) };
}

function buildMinorQuery(pathHasQuery) {
  return `${pathHasQuery ? '&' : '?'}minorversion=${encodeURIComponent(QBO_MINOR_VERSION)}`;
}

/**
 * @returns {{ qboGet: (relPath: string) => Promise<any>, qboPost: (entityLower: string, payload: object) => Promise<any>, qboQuery: (sql: string) => Promise<any> }}
 */
export function createQboApiClient() {
  async function qboGet(relPath) {
    const { realmId, accessToken } = await authContext();
    const path = String(relPath || '').replace(/^\//, '');
    const hasQ = path.includes('?');
    const url = `${QBO_API_BASE}/v3/company/${encodeURIComponent(realmId)}/${path}${buildMinorQuery(hasQ)}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
    const text = await r.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 400) };
    }
    if (!r.ok) {
      throw new Error(intuitErrorMessage(data, text.slice(0, 400)) || `QBO GET HTTP ${r.status}`);
    }
    return data;
  }

  async function qboPost(entityLower, payload) {
    const { realmId, accessToken } = await authContext();
    const el = String(entityLower || '')
      .replace(/^\//, '')
      .toLowerCase();
    const root = POST_BODY_ROOT[el];
    if (!root) {
      throw new Error(`Unsupported QBO POST entity: ${entityLower} (add mapping in qbo-api-client.mjs)`);
    }
    const body = { [root]: payload };
    const url = `${QBO_API_BASE}/v3/company/${encodeURIComponent(realmId)}/${encodeURIComponent(el)}${buildMinorQuery(false)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 400) };
    }
    if (!r.ok) {
      throw new Error(intuitErrorMessage(data, text.slice(0, 400)) || `QBO POST HTTP ${r.status}`);
    }
    return data;
  }

  async function qboQuery(sql) {
    const { realmId, accessToken } = await authContext();
    const u = new URL(`${QBO_API_BASE}/v3/company/${encodeURIComponent(realmId)}/query`);
    u.searchParams.set('query', String(sql));
    u.searchParams.set('minorversion', QBO_MINOR_VERSION);
    const r = await fetch(u.href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
    const text = await r.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 400) };
    }
    if (!r.ok) {
      throw new Error(intuitErrorMessage(data, text.slice(0, 400)) || `QBO query HTTP ${r.status}`);
    }
    return data;
  }

  return { qboGet, qboPost, qboQuery };
}
