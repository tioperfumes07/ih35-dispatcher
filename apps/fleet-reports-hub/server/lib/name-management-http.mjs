import crypto from 'crypto';
import { getAccountingDb } from './accounting-db.mjs';
import { patchSamsaraDriverName } from './samsara-client.mjs';
import {
  readRegistry,
  writeRegistry,
  getEntityById,
  listEntities,
  getDriverLinkForErp,
  recomputeDriverLinks,
  upsertManualDriverLink,
  fuzzyDriverNamesOk,
  namesAllMatch,
} from './name-registry-store.mjs';

function insertRenameLog({
  entityId,
  entityKind,
  canonicalAfter,
  oldSnap,
  newSnap,
  systemsRequested,
  systemsResult,
  status,
}) {
  const db = getAccountingDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO rename_log (
      id, entity_id, entity_kind, canonical_after, old_snapshot, new_snapshot,
      systems_requested, systems_result, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entityId,
    entityKind,
    canonicalAfter,
    JSON.stringify(oldSnap),
    JSON.stringify(newSnap),
    JSON.stringify(systemsRequested),
    JSON.stringify(systemsResult),
    status,
    createdAt,
  );
  return id;
}

function aggregateStatus(results) {
  const parts = [results.qbo, results.samsara, results.erp];
  const requested = parts.some((p) => p && p.status !== 'skipped');
  const anyFail = parts.some((p) => p?.status === 'fail');
  const anyOk = parts.some((p) => p?.status === 'success');
  if (!requested) return 'fail';
  if (anyFail && anyOk) return 'partial';
  if (anyFail) return 'fail';
  if (anyOk) return 'success';
  return 'partial';
}

async function executeRenameOnEntity(body) {
  const {
    entityId,
    canonical,
    updateQbo = false,
    updateSamsara = false,
    updateErp = false,
  } = body;
  const next = String(canonical || '').trim();
  if (!next) throw new Error('canonical name is required');

  const reg = readRegistry();
  const e = reg.entities.find((x) => x.id === entityId);
  if (!e) throw new Error('Unknown entity');

  const oldSnap = JSON.parse(JSON.stringify(e));
  const systemsRequested = { updateQbo, updateSamsara, updateErp };
  const results = {
    qbo: { status: 'skipped', detail: '' },
    samsara: { status: 'skipped', detail: '' },
    erp: { status: 'skipped', detail: '' },
  };

  if (updateQbo && e.qbo) {
    const st = String(parseInt(String(e.qbo.syncToken || '0'), 10) + 1);
    e.qbo.displayName = next;
    e.qbo.syncToken = st;
    results.qbo = {
      status: 'success',
      detail: `QBO ${e.kind} DisplayName + SyncToken (${st}) — demo POST vendor/customer/employee`,
    };
  } else if (updateQbo) {
    results.qbo = { status: 'skipped', detail: 'No QBO record for this entity' };
  }

  if (updateSamsara && e.samsara) {
    const r = await patchSamsaraDriverName(e.samsara.id, next);
    if (r.ok) {
      e.samsara.name = next;
      results.samsara = {
        status: 'success',
        detail: r.mock ? `${r.detail} (name applied locally)` : r.detail,
      };
    } else {
      results.samsara = { status: 'fail', detail: r.detail };
    }
  } else if (updateSamsara) {
    results.samsara = { status: 'skipped', detail: 'No Samsara driver on entity' };
  }

  if (updateErp && e.erp) {
    e.erp.name = next;
    results.erp = {
      status: 'success',
      detail: `ERP updated: all referencing tables for this ${e.kind} (${e.erp.refCount ?? 0} demo rows)`,
    };
  } else if (updateErp) {
    results.erp = { status: 'skipped', detail: 'No ERP slice' };
  }

  e.lastRenamedAt = new Date().toISOString();
  writeRegistry(reg);

  const fresh = getEntityById(entityId);
  const status = aggregateStatus(results);
  const logId = insertRenameLog({
    entityId,
    entityKind: e.kind,
    canonicalAfter: next,
    oldSnap,
    newSnap: fresh,
    systemsRequested,
    systemsResult: results,
    status,
  });

  return { status, results, logId, entity: fresh };
}

export function registerNameManagementRoutes(app) {
  app.get('/api/name-management/samsara-options', (_req, res) => {
    try {
      const reg = readRegistry();
      const seen = new Set();
      const drivers = [];
      for (const e of reg.entities) {
        if (!e.samsara?.id) continue;
        if (seen.has(e.samsara.id)) continue;
        seen.add(e.samsara.id);
        drivers.push({ id: e.samsara.id, name: e.samsara.name || e.samsara.id });
      }
      res.json({ drivers });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/name-management/entities', (req, res) => {
    try {
      getAccountingDb();
      recomputeDriverLinks();
      const q = String(req.query.q || '');
      const filter = String(req.query.filter || 'all');
      const rows = listEntities({ q, filter });
      res.json({ entities: rows });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/name-management/entities/:id', (req, res) => {
    try {
      const e = getEntityById(req.params.id);
      if (!e) return res.status(404).json({ error: 'Not found' });
      recomputeDriverLinks();
      const link = e.kind === 'driver' && e.erp ? getDriverLinkForErp(e.erp.driverId) : null;
      const needsManualDriverLink =
        e.kind === 'driver' &&
        e.erp &&
        e.samsara &&
        !link &&
        !fuzzyDriverNamesOk(e.erp.name, e.samsara.name);

      const qboName = e.qbo?.displayName ?? null;
      const samName = e.samsara?.name ?? null;
      const erpName = e.erp?.name ?? null;
      const norm = (v) => String(v || '').trim().toLowerCase();
      const cell = (label, val) => {
        if (val == null || val === '') return { system: label, name: null, aligned: null };
        const me = norm(val);
        const peers = [qboName, samName, erpName].filter((x) => x != null && x !== '');
        const aligned =
          peers.length < 2 ? true : peers.every((p) => norm(p) === me);
        return { system: label, name: val, aligned };
      };

      const canonicalHint =
        qboName || samName || erpName || '';

      res.json({
        entity: e,
        systems: [cell('QBO', qboName), cell('Samsara', samName), cell('ERP', erpName)],
        consensusHint: canonicalHint,
        erpRefCount: e.erp?.refCount ?? 0,
        driverLink: link,
        needsManualDriverLink,
        allNamesMatch: namesAllMatch(e),
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/name-management/rename-history', (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
      const db = getAccountingDb();
      const rows = db
        .prepare(
          `SELECT id, entity_id, entity_kind, canonical_after, status, systems_result, created_at
           FROM rename_log ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit);
      res.json({
        rows: rows.map((r) => ({
          ...r,
          systemsResult: safeJson(r.systems_result, {}),
        })),
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/name-management/apply-rename', async (req, res) => {
    try {
      const out = await executeRenameOnEntity(req.body || {});
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/name-management/bulk-rename', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (items.length === 0) return res.status(400).json({ error: 'items[] required' });
      if (items.length > 40) return res.status(400).json({ error: 'Max 40 items per bulk run' });
      const out = [];
      for (const it of items) {
        try {
          const e0 = getEntityById(String(it.entityId || ''));
          const canonical =
            String(it.canonical || '').trim() ||
            String(e0?.qbo?.displayName || e0?.samsara?.name || e0?.erp?.name || '').trim();
          const r = await executeRenameOnEntity({
            entityId: it.entityId,
            canonical,
            updateQbo: Boolean(it.updateQbo),
            updateSamsara: Boolean(it.updateSamsara),
            updateErp: Boolean(it.updateErp),
          });
          out.push({ entityId: it.entityId, ok: true, ...r });
        } catch (err) {
          out.push({ entityId: it.entityId, ok: false, error: String(err?.message || err) });
        }
      }
      const okN = out.filter((x) => x.ok).length;
      const summary =
        okN === out.length ? 'success' : okN === 0 ? 'fail' : 'partial';
      res.json({ summary, results: out });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/name-management/driver-link', (req, res) => {
    try {
      const erpDriverId = String(req.body?.erpDriverId || '').trim();
      const samsaraDriverId = String(req.body?.samsaraDriverId || '').trim();
      if (!erpDriverId || !samsaraDriverId) {
        return res.status(400).json({ error: 'erpDriverId and samsaraDriverId required' });
      }
      const reg = readRegistry();
      for (const e of reg.entities) {
        if (e.kind !== 'driver' || e.erp?.driverId !== erpDriverId) continue;
        e.samsara = e.samsara || { name: '' };
        e.samsara.id = samsaraDriverId;
        if (!e.samsara.name) e.samsara.name = String(req.body?.samsaraName || '').trim() || samsaraDriverId;
      }
      writeRegistry(reg);
      const row = upsertManualDriverLink(erpDriverId, samsaraDriverId);
      res.json({ ok: true, link: row });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/name-management/recompute-driver-links', (_req, res) => {
    try {
      const n = recomputeDriverLinks();
      res.json({ ok: true, linksInserted: n });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}

function safeJson(s, fb) {
  try {
    return JSON.parse(s);
  } catch {
    return fb;
  }
}
