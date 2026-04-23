import fs from 'fs';
import path from 'path';
import { DATA_DIR, ERP_FILE } from './data-dirs.mjs';
import { readFullErpJson } from './read-erp.mjs';

const QBO_FILE = path.join(DATA_DIR, 'qbo_tokens.json');

function readQboStore() {
  try {
    if (!fs.existsSync(QBO_FILE)) return { tokens: null };
    return JSON.parse(fs.readFileSync(QBO_FILE, 'utf8'));
  } catch {
    return { tokens: null };
  }
}

/**
 * Shared deps for `mountDedupeRoutes` / `mountNameManagementRoutes` on the starter server.
 * QBO HTTP is not wired here; when tokens exist, wire `qboGet` / `qboPost` / `qboQuery` from your integration layer.
 */
export function createMaintIntegrationDeps() {
  const readErp = () => readFullErpJson();
  const writeErp = data => {
    fs.mkdirSync(path.dirname(ERP_FILE), { recursive: true });
    fs.writeFileSync(ERP_FILE, JSON.stringify(data, null, 2));
  };
  const readQbo = () => readQboStore();
  const qboConfigured = () => Boolean(readQboStore().tokens?.refresh_token);
  const qboGet = async () => {
    throw new Error('QuickBooks API not wired on this process (set up qboGet in maint-server-deps or full server).');
  };
  const qboPost = async () => {
    throw new Error('QuickBooks API not wired on this process.');
  };
  const qboQuery = async () => {
    throw new Error('QuickBooks API not wired on this process.');
  };

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
    samsaraApiPatch: null
  };
}
