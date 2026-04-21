import fs from 'fs';
import path from 'path';
import { ERP_FILE } from './data-dirs.mjs';
import { readFullErpJson } from './read-erp.mjs';
import { readQboStore } from './qbo-attachments.mjs';
import { createQboApiClient } from './qbo-api-client.mjs';

/**
 * Shared deps for `mountDedupeRoutes` / `mountNameManagementRoutes`.
 * QBO: live Intuit v3 calls when `data/qbo_tokens.json` has refresh_token + realmId and `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` can refresh access.
 */

function qboFullyConfigured() {
  try {
    const s = readQboStore();
    const t = s?.tokens;
    return Boolean(t?.refresh_token && (t.realmId || t.realm_id));
  } catch {
    return false;
  }
}

async function samsaraApiPatch(relPath, body) {
  const tok = String(process.env.SAMSARA_API_TOKEN || '').trim();
  if (!tok) throw new Error('SAMSARA_API_TOKEN is not set');
  const p = String(relPath || '').trim();
  const url = p.startsWith('http')
    ? p
    : `https://api.samsara.com${p.startsWith('/') ? '' : '/'}${p.replace(/^\//, '')}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body && typeof body === 'object' ? body : {})
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.message || data?.error || r.statusText || `Samsara PATCH ${r.status}`);
  }
  return data;
}

export function createMaintIntegrationDeps() {
  const readErp = () => readFullErpJson();
  const writeErp = data => {
    fs.mkdirSync(path.dirname(ERP_FILE), { recursive: true });
    fs.writeFileSync(ERP_FILE, JSON.stringify(data, null, 2));
  };
  const readQbo = () => readQboStore();
  const qboConfigured = () => qboFullyConfigured();

  const { qboGet, qboPost, qboQuery } = createQboApiClient();

  return {
    readErp,
    writeErp,
    readQbo,
    qboConfigured,
    qboGet,
    qboPost,
    qboQuery,
    logError: console.error,
    maintAuthUserLabel: req => String(req.headers['x-ih35-user'] || req.headers['x-user-email'] || 'dev'),
    requireErpWriteOrAdmin: () => true,
    samsaraApiPatch
  };
}
