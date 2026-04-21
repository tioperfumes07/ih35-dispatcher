import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreDuplicatePair, pairKey } from './vendor-dedup-engine.mjs';
import { getAccountingDb } from './accounting-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'accounting-catalog.json');

function readCatalog() {
  const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeCatalog(obj) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

export function listParties(entityType) {
  const c = readCatalog();
  const list = entityType === 'customer' ? c.customers : c.vendors;
  return list.filter((p) => p.active !== false);
}

export function findParty(entityType, id) {
  return listParties(entityType).find((p) => p.id === id) ?? null;
}

export function loadSkippedPairKeys(entityType) {
  const db = getAccountingDb();
  const rows = db
    .prepare(
      `SELECT party_id_a, party_id_b FROM dedup_skipped WHERE entity_type = ?`,
    )
    .all(entityType);
  const set = new Set();
  for (const r of rows) {
    set.add(pairKey(r.party_id_a, r.party_id_b));
  }
  return set;
}

export function buildCandidateGroups(entityType, { minConfidence = 50 } = {}) {
  const parties = listParties(entityType);
  const skipped = loadSkippedPairKeys(entityType);
  const groups = [];
  const seen = new Set();

  for (let i = 0; i < parties.length; i++) {
    for (let j = i + 1; j < parties.length; j++) {
      const A = parties[i];
      const B = parties[j];
      const pk = pairKey(A.id, B.id);
      if (skipped.has(pk)) continue;

      const { confidencePct, band, rules } = scoreDuplicatePair(A, B);
      if (confidencePct < minConfidence || band === 'LOW') continue;
      if (seen.has(pk)) continue;
      seen.add(pk);

      groups.push({
        groupKey: pk,
        confidencePct,
        band,
        rulesMatched: rules,
        recordA: A,
        recordB: B,
      });
    }
  }

  groups.sort((a, b) => b.confidencePct - a.confidencePct);
  return groups;
}

export function searchParties(entityType, q) {
  const s = (q || '').trim().toLowerCase();
  const parties = listParties(entityType);
  if (!s) return parties;
  return parties.filter(
    (p) =>
      p.name.toLowerCase().includes(s) ||
      (p.email && p.email.toLowerCase().includes(s)) ||
      (p.phone && p.phone.includes(s)),
  );
}

export function listQboItems(q) {
  const c = readCatalog();
  const items = Array.isArray(c.qboItems) ? c.qboItems : [];
  const s = (q || '').trim().toLowerCase();
  if (!s) return items;
  return items.filter(
    (it) =>
      String(it.name || '')
        .toLowerCase()
        .includes(s) ||
      String(it.sku || '')
        .toLowerCase()
        .includes(s) ||
      String(it.category || '')
        .toLowerCase()
        .includes(s),
  );
}

/**
 * @param {'vendor'|'customer'} entityType
 * @param {string} keepId
 * @param {string} mergeId
 */
export function applyMergeInCatalog(entityType, keepId, mergeId) {
  const c = readCatalog();
  const key = entityType === 'customer' ? 'customers' : 'vendors';
  const list = c[key];
  const keep = list.find((p) => p.id === keepId);
  const merge = list.find((p) => p.id === mergeId);
  if (!keep || !merge) throw new Error('Party not found');
  if (keep.id === merge.id) throw new Error('Cannot merge party with itself');

  keep.billsCount = (keep.billsCount || 0) + (merge.billsCount || 0);
  keep.expensesCount = (keep.expensesCount || 0) + (merge.expensesCount || 0);
  keep.posCount = (keep.posCount || 0) + (merge.posCount || 0);

  merge.active = false;
  merge.qboActive = false;
  merge.mergedIntoId = keep.id;
  if (!String(merge.name).includes('[MERGED]')) {
    merge.name = `${merge.name} [MERGED]`;
  }

  writeCatalog(c);
  return { keep, merge };
}
