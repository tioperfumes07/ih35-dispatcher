import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './data-dirs.mjs';
import { ERP_DATA_DIR } from './erp-data.mjs';
import { dbQuery } from './db.mjs';

const QBO_FILE = path.join(DATA_DIR, 'qbo_tokens.json');
const QBO_API_BASE = 'https://quickbooks.api.intuit.com';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_MINOR_VERSION = String(process.env.QBO_MINOR_VERSION || '65').trim();

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';

function ensureQboFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QBO_FILE)) fs.writeFileSync(QBO_FILE, JSON.stringify({ tokens: null }, null, 2));
}

export function readQboStore() {
  ensureQboFile();
  return JSON.parse(fs.readFileSync(QBO_FILE, 'utf8'));
}

export function writeQboStore(data) {
  ensureQboFile();
  fs.writeFileSync(QBO_FILE, JSON.stringify(data, null, 2));
}

/** Persists last Intuit/token error so `/api/qbo/status` and UIs can show degraded state. */
export function recordQboConnectionFailure(message) {
  try {
    const store = readQboStore();
    store.connectionHealth = {
      lastError: String(message || 'Unknown error').slice(0, 500),
      lastErrorAt: new Date().toISOString()
    };
    writeQboStore(store);
  } catch {
    /* ignore disk errors */
  }
}

export function clearQboConnectionFailure() {
  try {
    const store = readQboStore();
    if (store.connectionHealth) {
      delete store.connectionHealth;
      writeQboStore(store);
    }
  } catch {
    /* ignore */
  }
}

/** Ensures `access_token` is fresh; persists token rotation to `qbo_tokens.json`. */
export async function qboRefreshIfNeededLib() {
  const store = readQboStore();
  const tokens = store.tokens;
  if (!tokens?.refresh_token) throw new Error('QuickBooks is not connected');
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Number(tokens.expires_at || 0);
  if (expiresAt && expiresAt - nowSec > 300 && tokens.access_token) {
    return store.tokens;
  }
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) throw new Error('QBO_CLIENT_ID / QBO_CLIENT_SECRET not set');

  const basic = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', tokens.refresh_token);

  let response;
  try {
    response = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
  } catch (netErr) {
    recordQboConnectionFailure(netErr?.message || 'QuickBooks refresh: network error');
    throw netErr;
  }
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    recordQboConnectionFailure('QuickBooks token refresh: non-JSON response');
    throw new Error('QuickBooks token refresh: non-JSON response');
  }
  if (!response.ok) {
    const msg = data?.error_description || data?.error || 'QuickBooks refresh failed';
    recordQboConnectionFailure(msg);
    throw new Error(msg);
  }
  store.tokens = {
    ...store.tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || store.tokens.refresh_token,
    id_token: data.id_token || store.tokens.id_token || '',
    expires_in: data.expires_in,
    expires_at: nowSec + Number(data.expires_in || 3600)
  };
  writeQboStore(store);
  clearQboConnectionFailure();
  return store.tokens;
}

/**
 * Upload one file as a QBO Attachable linked to an entity (e.g. Invoice).
 * @returns {Promise<{ id: string }|null>}
 */
export async function qboUploadAttachableToEntity(entityType, entityId, absFilePath, displayFileName, contentType) {
  const store = readQboStore();
  if (!store.tokens?.realmId) throw new Error('QuickBooks realmId is missing');
  const tokens = await qboRefreshIfNeededLib();

  const safeName = String(displayFileName || path.basename(absFilePath) || 'attachment')
    .replace(/[\r\n"]/g, '_')
    .slice(0, 120);
  const mime = String(contentType || 'application/octet-stream').slice(0, 80);
  const meta = JSON.stringify({
    AttachableRef: [{ EntityRef: { type: String(entityType), value: String(entityId) } }],
    FileName: safeName,
    ContentType: mime
  });

  const fileBuf = fs.readFileSync(absFilePath);
  const boundary = '----ih35Qbo' + crypto.randomBytes(16).toString('hex');
  const crlf = '\r\n';
  const head = Buffer.from(
    `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="file_metadata_0"${crlf}` +
      `Content-Type: application/json; charset=UTF-8${crlf}${crlf}` +
      meta +
      crlf +
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="file_content_0"; filename="${safeName.replace(/"/g, '')}"${crlf}` +
      `Content-Type: ${mime}${crlf}${crlf}`,
    'utf8'
  );
  const tail = Buffer.from(`${crlf}--${boundary}--${crlf}`, 'utf8');
  const bodyBuf = Buffer.concat([head, fileBuf, tail]);

  const url = `${QBO_API_BASE}/v3/company/${store.tokens.realmId}/upload?minorversion=${encodeURIComponent(QBO_MINOR_VERSION)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: bodyBuf
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  if (!response.ok) {
    const msg = data?.Fault?.Error?.[0]?.Message || data?.Fault?.Error?.[0]?.Detail || raw.slice(0, 400);
    throw new Error(msg || 'QuickBooks upload failed');
  }
  const att =
    data?.AttachableResponse?.[0]?.Attachable ||
    data?.AttachableResponse?.[0] ||
    data?.Attachable ||
    null;
  const id = att?.Id != null ? String(att.Id) : '';
  return id ? { id } : null;
}

/** Upload every load_document row for this load that is not yet linked to the QBO invoice. */
export async function syncAllLoadDocumentsToQboInvoice(loadId, qboInvoiceId) {
  if (!loadId || !qboInvoiceId) return { uploaded: 0, skipped: 0, errors: [] };
  const { rows } = await dbQuery(
    `SELECT id, stored_path, original_name, mime_type, qbo_attachable_id
     FROM load_documents WHERE load_id = $1::uuid ORDER BY created_at`,
    [loadId]
  );
  const errors = [];
  let uploaded = 0;
  let skipped = 0;
  for (const d of rows) {
    if (d.qbo_attachable_id) {
      skipped += 1;
      continue;
    }
    const abs = path.join(ERP_DATA_DIR, d.stored_path);
    if (!fs.existsSync(abs)) {
      errors.push({ id: d.id, error: 'file missing on disk' });
      await dbQuery(`UPDATE load_documents SET qbo_sync_error = $1 WHERE id = $2::uuid`, ['file missing on disk', d.id]);
      continue;
    }
    try {
      const res = await qboUploadAttachableToEntity(
        'Invoice',
        qboInvoiceId,
        abs,
        d.original_name || path.basename(abs),
        d.mime_type || 'application/octet-stream'
      );
      const aid = res?.id || '';
      if (!aid) throw new Error('QuickBooks did not return attachable id');
      await dbQuery(
        `UPDATE load_documents SET qbo_attachable_id = $1, qbo_sync_error = NULL WHERE id = $2::uuid`,
        [aid, d.id]
      );
      uploaded += 1;
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 500);
      errors.push({ id: d.id, error: msg });
      await dbQuery(`UPDATE load_documents SET qbo_sync_error = $1 WHERE id = $2::uuid`, [msg, d.id]);
    }
  }
  return { uploaded, skipped, errors };
}

/** After a new document is saved: if the load already has a QBO invoice, attach this file. */
export async function syncSingleLoadDocumentToQbo(loadId, documentId) {
  const { rows } = await dbQuery(
    `SELECT l.qbo_invoice_id, d.id, d.stored_path, d.original_name, d.mime_type, d.qbo_attachable_id
     FROM load_documents d
     JOIN loads l ON l.id = d.load_id
     WHERE d.load_id = $1::uuid AND d.id = $2::uuid`,
    [loadId, documentId]
  );
  const row = rows[0];
  if (!row?.qbo_invoice_id) return { ok: true, skipped: true, reason: 'no_invoice_on_load' };
  if (row.qbo_attachable_id) return { ok: true, skipped: true, reason: 'already_attached' };
  const abs = path.join(ERP_DATA_DIR, row.stored_path);
  if (!fs.existsSync(abs)) {
    await dbQuery(`UPDATE load_documents SET qbo_sync_error = $1 WHERE id = $2::uuid`, ['file missing on disk', documentId]);
    return { ok: false, error: 'file missing' };
  }
  try {
    const res = await qboUploadAttachableToEntity(
      'Invoice',
      row.qbo_invoice_id,
      abs,
      row.original_name || path.basename(abs),
      row.mime_type || 'application/octet-stream'
    );
    const aid = res?.id || '';
    if (!aid) throw new Error('QuickBooks did not return attachable id');
    await dbQuery(`UPDATE load_documents SET qbo_attachable_id = $1, qbo_sync_error = NULL WHERE id = $2::uuid`, [
      aid,
      documentId
    ]);
    return { ok: true, qboAttachableId: aid };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    await dbQuery(`UPDATE load_documents SET qbo_sync_error = $1 WHERE id = $2::uuid`, [msg, documentId]);
    throw e;
  }
}
