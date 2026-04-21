import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { levenshtein, stripPunctuation } from './vendor-dedup-engine.mjs';
import { getAccountingDb } from './accounting-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'name-registry.json');

function readRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeRegistry(obj) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

export function normName(s) {
  return stripPunctuation(String(s || '')).toLowerCase();
}

export function namesAllMatch(e) {
  const parts = [];
  if (e.qbo?.displayName) parts.push(normName(e.qbo.displayName));
  if (e.samsara?.name) parts.push(normName(e.samsara.name));
  if (e.erp?.name) parts.push(normName(e.erp.name));
  if (parts.length < 2) return true;
  const first = parts[0];
  return parts.every((p) => p === first);
}

export function hasMismatch(e) {
  return !namesAllMatch(e);
}

export function listEntities({ q = '', filter = 'all' } = {}) {
  const { entities } = readRegistry();
  const needle = String(q || '').trim().toLowerCase();
  const now = Date.now();
  const thirty = 30 * 24 * 3600 * 1000;

  return entities
    .map((e) => {
      const mismatch = hasMismatch(e);
      const label =
        e.qbo?.displayName || e.samsara?.name || e.erp?.name || e.id;
      const sources = [];
      if (e.qbo) sources.push('QBO');
      if (e.samsara) sources.push('Samsara');
      if (e.erp) sources.push('ERP');
      const recent =
        e.lastRenamedAt && now - new Date(e.lastRenamedAt).getTime() < thirty;
      return {
        id: e.id,
        kind: e.kind,
        label,
        sources,
        nameMismatch: mismatch,
        recentlyRenamed: Boolean(recent),
        lastRenamedAt: e.lastRenamedAt || null,
      };
    })
    .filter((row) => {
      if (needle && !row.label.toLowerCase().includes(needle) && !row.id.toLowerCase().includes(needle)) {
        return false;
      }
      if (filter === 'mismatch') return row.nameMismatch;
      if (filter === 'renamed') return row.recentlyRenamed;
      return true;
    });
}

export function getEntityById(id) {
  const { entities } = readRegistry();
  return entities.find((e) => e.id === id) || null;
}

export function getDriverLinkForErp(erpDriverId) {
  if (!erpDriverId) return null;
  const db = getAccountingDb();
  return db
    .prepare(`SELECT * FROM driver_system_links WHERE erp_driver_id = ?`)
    .get(erpDriverId);
}

export function fuzzyDriverNamesOk(erpName, samsaraName) {
  const clean = (s) =>
    normName(s)
      .replace(/\b(sr|jr|ii|iii|iv)\b\.?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = clean(erpName);
  const b = clean(samsaraName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return levenshtein(a, b) <= 4;
}

export function recomputeDriverLinks() {
  const reg = readRegistry();
  const db = getAccountingDb();
  const now = new Date().toISOString();
  let n = 0;
  for (const e of reg.entities) {
    if (e.kind !== 'driver' || !e.erp?.driverId || !e.samsara?.id) continue;
    const existing = db
      .prepare(`SELECT id FROM driver_system_links WHERE erp_driver_id = ?`)
      .get(e.erp.driverId);
    if (existing) continue;
    if (!fuzzyDriverNamesOk(e.erp.name, e.samsara.name)) continue;
    const id = `link-${e.erp.driverId}`;
    const conf = Math.max(
      0,
      100 - levenshtein(normName(e.erp.name), normName(e.samsara.name)) * 12,
    );
    db.prepare(
      `INSERT INTO driver_system_links (id, erp_driver_id, samsara_driver_id, link_type, confidence, created_at, updated_at)
       VALUES (?, ?, ?, 'auto', ?, ?, ?)`,
    ).run(id, e.erp.driverId, e.samsara.id, conf, now, now);
    n += 1;
  }
  return n;
}

export function upsertManualDriverLink(erpDriverId, samsaraDriverId) {
  const db = getAccountingDb();
  const now = new Date().toISOString();
  const id = `link-manual-${erpDriverId}`;
  db.prepare(`DELETE FROM driver_system_links WHERE erp_driver_id = ? OR samsara_driver_id = ?`).run(
    erpDriverId,
    samsaraDriverId,
  );
  db.prepare(
    `INSERT INTO driver_system_links (id, erp_driver_id, samsara_driver_id, link_type, confidence, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', 100, ?, ?)`,
  ).run(id, erpDriverId, samsaraDriverId, now, now);
  return { id, erpDriverId, samsaraDriverId };
}

export { readRegistry, writeRegistry, REGISTRY_PATH };
