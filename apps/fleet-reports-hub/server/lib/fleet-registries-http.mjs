import { getAccountingDb } from './accounting-db.mjs';
import {
  fetchSamsaraDriversNormalized,
  fetchSamsaraVehiclesNormalized,
} from './samsara-client.mjs';
import { listParties } from './accounting-catalog.mjs';
import {
  pullVendorsFromQboIntoDb,
  syncAllActiveDriversToQbo,
  syncAllActiveTruckClasses,
  tryCreateQboClient,
  upsertDriverAsQboVendor,
} from './fleet-qbo-registry-sync.mjs';

function nowIso() {
  return new Date().toISOString();
}

/** @param {import('better-sqlite3').Database} db */
function rowDriver(r) {
  return {
    id: r.id,
    samsara_id: r.samsara_id,
    full_name: r.full_name,
    first_name: r.first_name,
    last_name: r.last_name,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    country: r.country,
    phone: r.phone,
    email: r.email,
    cdl_number: r.cdl_number,
    cdl_state: r.cdl_state,
    cdl_expiry: r.cdl_expiry,
    assigned_unit: r.assigned_unit,
    qbo_vendor_id: r.qbo_vendor_id,
    qbo_synced: Boolean(r.qbo_synced),
    qbo_synced_at: r.qbo_synced_at,
    status: r.status,
    samsara_synced_at: r.samsara_synced_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** @param {import('better-sqlite3').Database} db */
function rowVendor(r) {
  return {
    id: r.id,
    qbo_vendor_id: r.qbo_vendor_id,
    display_name: r.display_name,
    company_name: r.company_name,
    first_name: r.first_name,
    last_name: r.last_name,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    country: r.country,
    phone: r.phone,
    email: r.email,
    vendor_type: r.vendor_type,
    tax_id: r.tax_id,
    payment_terms: r.payment_terms,
    qbo_synced: Boolean(r.qbo_synced),
    qbo_synced_at: r.qbo_synced_at,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ synced: number; refreshedAt: string }>}
 */
async function syncVendorsFromQboIntoDb(db) {
  const client = tryCreateQboClient();
  if (client) {
    return pullVendorsFromQboIntoDb(db, client);
  }
  const vendors = listParties('vendor');
  const t = nowIso();
  const ins = db.prepare(`
        INSERT INTO vendors_local (
          qbo_vendor_id, display_name, company_name, phone, email, status,
          qbo_synced, qbo_synced_at, created_at, updated_at
        ) VALUES (
          @qbo_vendor_id, @display_name, @display_name, @phone, @email, 'active',
          1, @t, @t, @t
        )
        ON CONFLICT(qbo_vendor_id) DO UPDATE SET
          display_name = excluded.display_name,
          phone = excluded.phone,
          email = excluded.email,
          qbo_synced = 1,
          qbo_synced_at = excluded.qbo_synced_at,
          updated_at = excluded.updated_at
      `);
  let n = 0;
  for (const v of vendors) {
    const qid = String(v.qboId || v.id || '').trim();
    if (!qid) continue;
    ins.run({
      qbo_vendor_id: qid,
      display_name: String(v.name || qid),
      phone: v.phone ? String(v.phone) : null,
      email: v.email ? String(v.email) : null,
      t,
    });
    n++;
  }
  return { synced: n, refreshedAt: t };
}

/** @param {import('better-sqlite3').Database} db */
function rowAsset(r) {
  return {
    id: r.id,
    samsara_id: r.samsara_id,
    unit_number: r.unit_number,
    year: r.year,
    make: r.make,
    model: r.model,
    vin: r.vin,
    license_plate: r.license_plate,
    license_state: r.license_state,
    odometer_miles: r.odometer_miles,
    engine_hours: r.engine_hours,
    fuel_type: r.fuel_type,
    asset_type: r.asset_type,
    qbo_class_id: r.qbo_class_id,
    qbo_class_name: r.qbo_class_name,
    qbo_synced: Boolean(r.qbo_synced),
    status: r.status,
    samsara_synced_at: r.samsara_synced_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function registerFleetRegistryRoutes(app) {
  app.get('/api/drivers', (_req, res) => {
    try {
      const db = getAccountingDb();
      const rows = db.prepare(`SELECT * FROM drivers ORDER BY full_name COLLATE NOCASE`).all();
      res.json({ drivers: rows.map((r) => rowDriver(r)) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/drivers/sync-samsara', async (_req, res) => {
    try {
      const db = getAccountingDb();
      const drivers = await fetchSamsaraDriversNormalized({ limit: 400 });
      const t = nowIso();
      const upsert = db.prepare(`
        INSERT INTO drivers (
          samsara_id, full_name, first_name, last_name, phone, cdl_number, cdl_state,
          status, samsara_synced_at, created_at, updated_at
        ) VALUES (
          @samsara_id, @full_name, @first_name, @last_name, @phone, @cdl_number, @cdl_state,
          'active', @t, @t, @t
        )
        ON CONFLICT(samsara_id) DO UPDATE SET
          full_name = excluded.full_name,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          phone = excluded.phone,
          cdl_number = excluded.cdl_number,
          cdl_state = excluded.cdl_state,
          samsara_synced_at = excluded.samsara_synced_at,
          updated_at = excluded.updated_at
      `);
      let n = 0;
      for (const d of drivers) {
        const parts = String(d.name || '').trim().split(/\s+/);
        const first = parts.length > 1 ? parts[0] : '';
        const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || d.name;
        upsert.run({
          samsara_id: d.id,
          full_name: d.name,
          first_name: first || null,
          last_name: last || null,
          phone: d.phone || null,
          cdl_number: d.licenseNumber || null,
          cdl_state: d.licenseState || null,
          t,
        });
        n++;
      }
      res.json({ synced: n, errors: [], refreshedAt: t });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/drivers', async (req, res) => {
    try {
      const full_name = String(req.body?.full_name || '').trim();
      if (!full_name) return res.status(400).json({ error: 'full_name required' });
      const db = getAccountingDb();
      const t = nowIso();
      const info = db
        .prepare(
          `INSERT INTO drivers (full_name, status, created_at, updated_at) VALUES (?, 'active', ?, ?)`,
        )
        .run(full_name, t, t);
      const row = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(info.lastInsertRowid);
      let qboNote = null;
      const qbo = tryCreateQboClient();
      if (qbo) {
        try {
          await upsertDriverAsQboVendor(db, row.id, qbo);
        } catch (e) {
          qboNote = String(e?.message || e);
        }
      }
      const fresh = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(row.id);
      res.json({ driver: rowDriver(fresh), qboNote });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.patch('/api/drivers/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const allowed = new Set([
        'full_name',
        'first_name',
        'last_name',
        'address',
        'city',
        'state',
        'zip',
        'country',
        'phone',
        'email',
        'cdl_number',
        'cdl_state',
        'cdl_expiry',
        'assigned_unit',
        'status',
        'qbo_vendor_id',
      ]);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const keys = Object.keys(body).filter((k) => allowed.has(k));
      if (!keys.length) return res.status(400).json({ error: 'no updatable fields' });
      const t = nowIso();
      const db = getAccountingDb();
      const sets = keys.map((k) => `${k} = @${k}`).join(', ');
      const params = { id, updated_at: t };
      for (const k of keys) {
        const v = body[k];
        params[k] = v === undefined || v === '' ? null : v;
      }
      db.prepare(`UPDATE drivers SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(params);
      let row = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id);
      if (!row) return res.status(404).json({ error: 'not found' });
      let qboNote = null;
      const qbo = tryCreateQboClient();
      if (qbo) {
        try {
          await upsertDriverAsQboVendor(db, id, qbo);
          row = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id);
        } catch (e) {
          qboNote = String(e?.message || e);
        }
      }
      res.json({ driver: rowDriver(row), qboNote });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/drivers/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const db = getAccountingDb();
      const r = db.prepare(`DELETE FROM drivers WHERE id = ?`).run(id);
      res.json({ ok: true, deleted: r.changes });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/drivers/sync-qbo', async (_req, res) => {
    try {
      const db = getAccountingDb();
      const client = tryCreateQboClient();
      if (!client) {
        const rows = db.prepare(`SELECT id FROM drivers WHERE status = 'active'`).all();
        const t = nowIso();
        for (const r of rows) {
          db.prepare(
            `UPDATE drivers SET qbo_synced = 1, qbo_synced_at = ?, updated_at = ? WHERE id = ?`,
          ).run(t, t, r.id);
        }
        return res.json({
          synced: rows.length,
          errors: [],
          message:
            'QuickBooks not connected locally — flagged qbo_synced only. Connect QBO (qbo_tokens.json) for live vendor writes.',
        });
      }
      const { synced, errors } = await syncAllActiveDriversToQbo(db, client);
      res.json({ synced, errors });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/vendors-local', (_req, res) => {
    try {
      const db = getAccountingDb();
      const rows = db
        .prepare(`SELECT * FROM vendors_local ORDER BY display_name COLLATE NOCASE`)
        .all();
      res.json({ vendors: rows.map((r) => rowVendor(r)) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/vendors-local', (req, res) => {
    try {
      const display_name = String(req.body?.display_name || '').trim();
      if (!display_name) return res.status(400).json({ error: 'display_name required' });
      const qbo_vendor_id =
        String(req.body?.qbo_vendor_id || '').trim() ||
        `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const db = getAccountingDb();
      const t = nowIso();
      const info = db
        .prepare(
          `INSERT INTO vendors_local (qbo_vendor_id, display_name, company_name, status, qbo_synced, created_at, updated_at)
           VALUES (@qbo_vendor_id, @display_name, @display_name, 'active', 0, @t, @t)`,
        )
        .run({ qbo_vendor_id, display_name, t });
      const row = db.prepare(`SELECT * FROM vendors_local WHERE id = ?`).get(info.lastInsertRowid);
      res.json({ vendor: rowVendor(row) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.patch('/api/vendors-local/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const allowed = new Set([
        'display_name',
        'company_name',
        'address',
        'city',
        'state',
        'zip',
        'country',
        'phone',
        'email',
        'vendor_type',
        'tax_id',
        'payment_terms',
        'status',
      ]);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const keys = Object.keys(body).filter((k) => allowed.has(k));
      if (!keys.length) return res.status(400).json({ error: 'no updatable fields' });
      const t = nowIso();
      const db = getAccountingDb();
      const sets = keys.map((k) => `${k} = @${k}`).join(', ');
      const params = { id, updated_at: t };
      for (const k of keys) {
        const v = body[k];
        params[k] = v === undefined || v === '' ? null : v;
      }
      db.prepare(`UPDATE vendors_local SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(params);
      const row = db.prepare(`SELECT * FROM vendors_local WHERE id = ?`).get(id);
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ vendor: rowVendor(row) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/vendors-local/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const db = getAccountingDb();
      const r = db.prepare(`DELETE FROM vendors_local WHERE id = ?`).run(id);
      res.json({ ok: true, deleted: r.changes });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/vendors-local/sync-qbo', async (_req, res) => {
    try {
      const db = getAccountingDb();
      const out = await syncVendorsFromQboIntoDb(db);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  /** Spec alias — same behavior as `/api/vendors-local/sync-qbo`. */
  app.get('/api/vendors/sync-qbo', async (_req, res) => {
    try {
      const db = getAccountingDb();
      const out = await syncVendorsFromQboIntoDb(db);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/assets', (_req, res) => {
    try {
      const db = getAccountingDb();
      const rows = db
        .prepare(`SELECT * FROM assets ORDER BY unit_number COLLATE NOCASE`)
        .all();
      res.json({ assets: rows.map((r) => rowAsset(r)) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/assets', (req, res) => {
    try {
      const unit_number = String(req.body?.unit_number || '').trim();
      if (!unit_number) return res.status(400).json({ error: 'unit_number required' });
      const db = getAccountingDb();
      const t = nowIso();
      const info = db
        .prepare(
          `INSERT INTO assets (unit_number, asset_type, status, qbo_synced, created_at, updated_at)
           VALUES (?, 'truck', 'active', 0, ?, ?)`,
        )
        .run(unit_number, t, t);
      const row = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(info.lastInsertRowid);
      res.json({ asset: rowAsset(row) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.patch('/api/assets/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const allowed = new Set([
        'unit_number',
        'year',
        'make',
        'model',
        'vin',
        'license_plate',
        'license_state',
        'odometer_miles',
        'engine_hours',
        'fuel_type',
        'asset_type',
        'status',
        'qbo_class_name',
        'qbo_class_id',
        'samsara_id',
      ]);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const keys = Object.keys(body).filter((k) => allowed.has(k));
      if (!keys.length) return res.status(400).json({ error: 'no updatable fields' });
      const t = nowIso();
      const db = getAccountingDb();
      const sets = keys.map((k) => `${k} = @${k}`).join(', ');
      const params = { id, updated_at: t };
      for (const k of keys) {
        let v = body[k];
        if (v === undefined || v === '') {
          params[k] = null;
          continue;
        }
        if (k === 'year' || k === 'odometer_miles' || k === 'engine_hours') {
          const n = Number(v);
          params[k] = Number.isFinite(n) ? n : null;
        } else {
          params[k] = v;
        }
      }
      db.prepare(`UPDATE assets SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(params);
      const row = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id);
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json({ asset: rowAsset(row) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/assets/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const db = getAccountingDb();
      const r = db.prepare(`DELETE FROM assets WHERE id = ?`).run(id);
      res.json({ ok: true, deleted: r.changes });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/assets/sync-samsara', async (_req, res) => {
    try {
      const vehicles = await fetchSamsaraVehiclesNormalized();
      const db = getAccountingDb();
      const t = nowIso();

      const isTruckLike = (v) => {
        const ty = String(v.vehicleType || '').toLowerCase();
        if (!ty) return true;
        if (ty.includes('trailer')) return false;
        return true;
      };

      const existing = db
        .prepare(
          `SELECT id, samsara_id, unit_number FROM assets WHERE COALESCE(asset_type, 'truck') = 'truck'`,
        )
        .all();
      const bySamsara = new Map();
      const byUnit = new Map();
      for (const e of existing) {
        if (e.samsara_id) bySamsara.set(String(e.samsara_id), e.id);
        const u = String(e.unit_number || '').trim().toLowerCase();
        if (u) byUnit.set(u, e.id);
      }

      const resolveRowId = (v) => {
        const sid = String(v.id || '').trim();
        if (sid && bySamsara.has(sid)) return bySamsara.get(sid);
        const un = String(v.name || '').trim().toLowerCase();
        if (un && byUnit.has(un)) return byUnit.get(un);
        return null;
      };

      const ins = db.prepare(`
        INSERT INTO assets (
          samsara_id, unit_number, year, make, model, vin, license_plate,
          odometer_miles, asset_type, status, qbo_synced, samsara_synced_at, created_at, updated_at
        ) VALUES (
          @sid, @unit_number, @year, @make, @model, @vin, @plate,
          @odo, 'truck', 'active', 0, @t, @t, @t
        )
      `);

      const upd = db.prepare(`
        UPDATE assets SET
          samsara_id = COALESCE(NULLIF(TRIM(samsara_id), ''), @sid),
          vin = CASE WHEN @vin IS NOT NULL AND TRIM(@vin) <> '' THEN TRIM(@vin) ELSE vin END,
          license_plate = CASE WHEN @plate IS NOT NULL AND TRIM(@plate) <> '' THEN TRIM(@plate) ELSE license_plate END,
          make = CASE WHEN @make IS NOT NULL AND TRIM(@make) <> '' THEN TRIM(@make) ELSE make END,
          model = CASE WHEN @model IS NOT NULL AND TRIM(@model) <> '' THEN TRIM(@model) ELSE model END,
          year = CASE WHEN @year IS NOT NULL THEN @year ELSE year END,
          odometer_miles = CASE WHEN @odo IS NOT NULL THEN @odo ELSE odometer_miles END,
          samsara_synced_at = @t,
          updated_at = @t
        WHERE id = @rowId AND COALESCE(asset_type, 'truck') = 'truck'
      `);

      let n = 0;
      let inserted = 0;
      let skippedNoUnit = 0;
      for (const v of vehicles) {
        if (!isTruckLike(v)) continue;
        const rowId = resolveRowId(v);
        const unitNumber = String(v.name || '').trim();
        if (!rowId && !unitNumber) {
          skippedNoUnit++;
          continue;
        }
        const vin = String(v.vin || '').trim();
        const plate = String(v.licensePlate || '').trim();
        const make = String(v.make || '').trim();
        const model = String(v.model || '').trim();
        const year =
          typeof v.year === 'number' && Number.isFinite(v.year)
            ? Math.trunc(v.year)
            : Number.isFinite(Number(v.year))
              ? Math.trunc(Number(v.year))
              : null;
        const odo =
          typeof v.odometerMiles === 'number' && Number.isFinite(v.odometerMiles)
            ? Math.trunc(v.odometerMiles)
            : null;
        if (rowId) {
          upd.run({
            sid: String(v.id),
            vin: vin || null,
            plate: plate || null,
            make: make || null,
            model: model || null,
            year,
            odo,
            t,
            rowId,
          });
        } else {
          const info = ins.run({
            sid: String(v.id || '').trim() || null,
            unit_number: unitNumber,
            vin: vin || null,
            plate: plate || null,
            make: make || null,
            model: model || null,
            year,
            odo,
            t,
          });
          const newId = Number(info.lastInsertRowid);
          if (Number.isFinite(newId)) {
            if (v.id) bySamsara.set(String(v.id), newId);
            byUnit.set(unitNumber.toLowerCase(), newId);
          }
          inserted++;
        }
        n++;
      }
      res.json({
        synced: n,
        inserted,
        skippedNoUnit,
        totalVehicles: vehicles.length,
        errors: [],
        refreshedAt: t,
      });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/assets/sync-qbo-classes', async (_req, res) => {
    try {
      const db = getAccountingDb();
      const client = tryCreateQboClient();
      if (!client) {
        const rows = db.prepare(`SELECT id, unit_number FROM assets WHERE status = 'active'`).all();
        const t = nowIso();
        for (const r of rows) {
          db.prepare(
            `UPDATE assets SET qbo_class_name = ?, qbo_synced = 1, updated_at = ? WHERE id = ?`,
          ).run(r.unit_number, t, r.id);
        }
        return res.json({
          synced: rows.length,
          errors: [],
          message:
            'QuickBooks not connected — mirrored unit # as class name only. Connect QBO for live Class entities.',
        });
      }
      const { synced, errors } = await syncAllActiveTruckClasses(db, client);
      res.json({ synced, errors });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
