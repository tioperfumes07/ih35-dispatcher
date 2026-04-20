import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { dbQuery, getPool } from '../lib/db.mjs';
import { readQboCustomerLookup, readQboVendorLookup, ERP_DATA_DIR } from '../lib/erp-data.mjs';
import { pcmilerPracticalMilesBetween } from '../lib/pcmiler.mjs';
import { fetchSamsaraVehiclesNormalized } from '../lib/samsara-client.mjs';
import { syncSingleLoadDocumentToQbo } from '../lib/qbo-attachments.mjs';

const router = Router();
router.get("/", (_req, res) => {
  res.json({
    ok: true,
    name: "IH35 TMS API",
    endpoints: [
      "/api/tms/meta",
      "/api/tms/fleet/samsara-vehicles",
      "/api/tms/meta/next-load-number",
      "/api/tms/customers",
      "/api/tms/drivers",
      "/api/tms/trucks",
      "/api/tms/trailers",
      "/api/tms/loads"
    ]
  });
});

const LOAD_DOCS_REL = 'load_documents';
const LOAD_DOC_TYPES = new Set(['rate_confirmation', 'delivery', 'other']);

function loadDocumentsDiskRoot() {
  return path.join(ERP_DATA_DIR, LOAD_DOCS_REL);
}

const loadDocUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(loadDocumentsDiskRoot(), req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const base = path.basename(file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}_${base || 'upload'}`);
    }
  }),
  limits: { fileSize: 45 * 1024 * 1024 }
});

function uuidOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
}

function qboIdOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function revenueOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeInvoiceExtraLines(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map(x => ({
      qbo_item_id: qboIdOrNull(x?.qbo_item_id),
      amount: x?.amount != null ? Number(x.amount) : 0,
      description: String(x?.description || '').trim() || null
    }))
    .filter(x => x.qbo_item_id && Number.isFinite(x.amount) && x.amount > 0);
}

function dateOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

const LOAD_STATUSES = [
  'open',
  'covered',
  'dispatched',
  'on_route',
  'loading',
  'unloading',
  'delivered',
  'in_yard',
  'unsettled'
];

function dbUnavailable(res, err) {
  const msg = err?.message || String(err);
  if (msg.includes('DATABASE_URL')) {
    res.status(503).json({ ok: false, error: 'Database not configured (DATABASE_URL)' });
    return true;
  }
  return false;
}

router.get('/meta', (_req, res) => {
  res.json({ ok: true, loadStatuses: LOAD_STATUSES });
});

/** Vehicles registered in Samsara (for TMS truck assignment / fleet tab). */
router.get('/fleet/samsara-vehicles', async (_req, res) => {
  try {
    const data = await fetchSamsaraVehiclesNormalized();
    res.json({ ok: true, data, source: 'samsara' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

router.get('/meta/next-load-number', async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ ok: false, error: 'Database not configured' });
  const start = Math.max(1, Number(process.env.DEFAULT_NEXT_LOAD_NUMBER || 13501) || 13501);
  try {
    const { rows } = await dbQuery(
      `SELECT load_number FROM loads WHERE load_number ~ '^[0-9]+$'`
    );
    let maxNum = 0;
    for (const r of rows) {
      const n = parseInt(String(r.load_number), 10);
      if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
    }
    const nextNum = Math.max(start, maxNum + 1);
    res.json({ ok: true, next: String(nextNum), nextNumeric: nextNum, baseline: start });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/customers', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      'SELECT id, name, mc_number, notes, created_at FROM customers ORDER BY name'
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/customers', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    const mc = String(req.body?.mc_number || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const { rows } = await dbQuery(
      `INSERT INTO customers (name, mc_number, notes) VALUES ($1, $2, $3)
       RETURNING id, name, mc_number, notes, created_at`,
      [name, mc, notes]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/drivers', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      'SELECT id, name, email, phone, qbo_vendor_id, samsara_driver_id, created_at FROM drivers ORDER BY name'
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.patch('/drivers/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let i = 1;
    const add = (col, val) => {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    };
    if (typeof b.name === 'string') {
      const n = b.name.trim();
      if (!n) return res.status(400).json({ ok: false, error: 'name cannot be empty' });
      add('name', n);
    }
    if (typeof b.email === 'string') add('email', b.email.trim() || null);
    if (typeof b.phone === 'string') add('phone', b.phone.trim() || null);
    if (b.qbo_vendor_id !== undefined) {
      const v =
        b.qbo_vendor_id == null || String(b.qbo_vendor_id).trim() === ''
          ? null
          : String(b.qbo_vendor_id).trim();
      add('qbo_vendor_id', v);
    }
    if (b.samsara_driver_id !== undefined) {
      const v =
        b.samsara_driver_id == null || String(b.samsara_driver_id).trim() === ''
          ? null
          : String(b.samsara_driver_id).trim();
      add('samsara_driver_id', v);
    }
    if (!sets.length) return res.status(400).json({ ok: false, error: 'No updatable fields' });
    vals.push(id);
    const { rows } = await dbQuery(
      `UPDATE drivers SET ${sets.join(', ')} WHERE id = $${i}::uuid RETURNING id, name, email, phone, qbo_vendor_id, samsara_driver_id, created_at`,
      vals
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Driver not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/drivers', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
    const { rows } = await dbQuery(
      `INSERT INTO drivers (name, email, phone) VALUES ($1, $2, $3)
       RETURNING id, name, email, phone, qbo_vendor_id, samsara_driver_id, created_at`,
      [name, String(req.body?.email || '').trim() || null, String(req.body?.phone || '').trim() || null]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/trucks', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      'SELECT id, unit_code, description, created_at FROM trucks ORDER BY unit_code'
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/trucks', async (req, res) => {
  try {
    const unit_code = String(req.body?.unit_code || '').trim();
    if (!unit_code) return res.status(400).json({ ok: false, error: 'unit_code is required' });
    const { rows } = await dbQuery(
      `INSERT INTO trucks (unit_code, description) VALUES ($1, $2)
       RETURNING id, unit_code, description, created_at`,
      [unit_code, String(req.body?.description || '').trim() || null]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Truck unit already exists' });
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/trailers', async (_req, res) => {
  try {
    const { rows } = await dbQuery(
      'SELECT id, unit_code, description, created_at FROM trailers ORDER BY unit_code'
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/trailers', async (req, res) => {
  try {
    const unit_code = String(req.body?.unit_code || '').trim();
    if (!unit_code) return res.status(400).json({ ok: false, error: 'unit_code is required' });
    const { rows } = await dbQuery(
      `INSERT INTO trailers (unit_code, description) VALUES ($1, $2)
       RETURNING id, unit_code, description, created_at`,
      [unit_code, String(req.body?.description || '').trim() || null]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Trailer unit already exists' });
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

const loadSelect = `
  SELECT l.*,
    c.name AS customer_join_name,
    d.name AS driver_join_name,
    t.unit_code AS truck_code,
    tr.unit_code AS trailer_code,
    (SELECT COUNT(*)::int FROM load_documents ld WHERE ld.load_id = l.id) AS document_count,
    (SELECT s.location_name FROM load_stops s WHERE s.load_id = l.id ORDER BY s.sequence_order ASC LIMIT 1) AS origin_name,
    (SELECT s.address FROM load_stops s WHERE s.load_id = l.id ORDER BY s.sequence_order ASC LIMIT 1) AS origin_address,
    (SELECT s.location_name FROM load_stops s WHERE s.load_id = l.id ORDER BY s.sequence_order DESC LIMIT 1) AS dest_name,
    (SELECT s.address FROM load_stops s WHERE s.load_id = l.id ORDER BY s.sequence_order DESC LIMIT 1) AS dest_address
  FROM loads l
  LEFT JOIN customers c ON c.id = l.customer_id
  LEFT JOIN drivers d ON d.id = l.driver_id
  LEFT JOIN trucks t ON t.id = l.truck_id
  LEFT JOIN trailers tr ON tr.id = l.trailer_id
`;

function enrichLoadRow(row) {
  if (!row) return row;
  const qboMap = readQboCustomerLookup();
  const qboId = row.qbo_customer_id != null ? String(row.qbo_customer_id) : '';
  const fromQbo = qboId ? qboMap.get(qboId) : null;
  const qboName =
    fromQbo && (fromQbo.name || fromQbo.companyName)
      ? String(fromQbo.name || fromQbo.companyName).trim()
      : '';
  const stored =
    row.qbo_customer_name != null && String(row.qbo_customer_name).trim()
      ? String(row.qbo_customer_name).trim()
      : '';
  const customer_name = stored || qboName || row.customer_join_name || '';

  const vendorMap = readQboVendorLookup();
  const dvId = row.qbo_driver_vendor_id != null ? String(row.qbo_driver_vendor_id) : '';
  const dvStored =
    row.qbo_driver_vendor_name != null && String(row.qbo_driver_vendor_name).trim()
      ? String(row.qbo_driver_vendor_name).trim()
      : '';
  const fromVendor = dvId ? vendorMap.get(dvId) : null;
  const vendorLabel =
    dvStored ||
    (fromVendor && String(fromVendor.name || fromVendor.companyName || '').trim()) ||
    '';
  const driverJoin = row.driver_join_name != null ? String(row.driver_join_name).trim() : '';
  const driver_name = vendorLabel || driverJoin || '';

  const { customer_join_name, driver_join_name, ...rest } = row;
  return {
    ...rest,
    customer_name,
    driver_name,
    invoice_number: rest.load_number || null
  };
}

/** TMS load + stops for settlement / P&amp;L (by public load_number). */
export async function fetchLoadSettlementContextByNumber(loadNumberRaw) {
  if (!getPool()) return null;
  const ln = String(loadNumberRaw || '').trim();
  if (!ln) return null;
  try {
    const { rows } = await dbQuery(`${loadSelect} WHERE l.load_number = $1 LIMIT 1`, [ln]);
    if (!rows.length) return null;
    const load = enrichLoadRow(rows[0]);
    const stopsRes = await dbQuery(
      `SELECT id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text,
              qbo_item_id, qbo_account_id
       FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [load.id]
    );
    const docsRes = await dbQuery(
      `SELECT id, doc_type, original_name, mime_type, byte_size, created_at
       FROM load_documents WHERE load_id = $1::uuid ORDER BY created_at DESC`,
      [load.id]
    );
    let settlementMiles = null;
    try {
      settlementMiles = await computeSettlementLegMilesFromStops(stopsRes.rows);
    } catch {
      settlementMiles = { ok: false, reason: 'compute_error' };
    }
    return { load, stops: stopsRes.rows, documents: docsRes.rows, settlementMiles };
  } catch {
    return null;
  }
}

function loadSearchPattern(raw) {
  const t = String(raw || '').trim().slice(0, 80);
  if (!t) return null;
  return `%${t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

router.get('/loads', async (req, res) => {
  try {
    const tab = String(req.query.tab || 'open').toLowerCase();
    let where = '1=1';
    const params = [];
    if (tab === 'open') {
      where = `l.status NOT IN ('delivered', 'unsettled')`;
    } else if (tab === 'delivered' || tab === 'completed') {
      where = `l.status IN ('delivered', 'unsettled')`;
    } else if (tab === 'unbilled' || tab === 'billing' || tab === 'needs_invoice') {
      where = `l.status = 'delivered' AND (l.qbo_invoice_id IS NULL OR TRIM(COALESCE(l.qbo_invoice_id, '')) = '')`;
    } else if (tab === 'unsettled') {
      where = `l.status = 'unsettled'`;
    }
    const qPat = loadSearchPattern(req.query.q);
    if (qPat) {
      params.push(qPat);
      const i = params.length;
      where = `(${where}) AND (
        l.load_number ILIKE $${i} ESCAPE '\\'
        OR COALESCE(l.qbo_customer_name, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(c.name, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(l.qbo_driver_vendor_name, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(d.name, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(t.unit_code, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(tr.unit_code, '') ILIKE $${i} ESCAPE '\\'
        OR COALESCE(l.customer_wo_number, '') ILIKE $${i} ESCAPE '\\'
      )`;
    }
    const { rows } = await dbQuery(
      `${loadSelect} WHERE ${where} ORDER BY l.created_at DESC`,
      params
    );
    res.json({ ok: true, data: rows.map(enrichLoadRow), tab });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/loads/by-number/:loadNumber', async (req, res) => {
  try {
    const raw =
      req.params.loadNumber != null ? decodeURIComponent(String(req.params.loadNumber)) : '';
    if (!String(raw).trim()) {
      return res.status(400).json({ ok: false, error: 'loadNumber is required' });
    }
    const ctx = await fetchLoadSettlementContextByNumber(raw);
    if (!ctx) return res.status(404).json({ ok: false, error: 'Load not found' });
    res.json({ ok: true, data: { ...ctx.load, stops: ctx.stops, documents: ctx.documents || [] } });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/loads/:id/documents', async (req, res) => {
  try {
    const loadId = req.params.id;
    const check = await dbQuery('SELECT id FROM loads WHERE id = $1::uuid', [loadId]);
    if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Load not found' });
    const { rows } = await dbQuery(
      `SELECT id, doc_type, original_name, mime_type, byte_size, created_at
       FROM load_documents WHERE load_id = $1::uuid ORDER BY created_at DESC`,
      [loadId]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/loads/:id/documents/:docId/download', async (req, res) => {
  try {
    const { id: loadId, docId } = req.params;
    const { rows } = await dbQuery(
      'SELECT stored_path, original_name, mime_type FROM load_documents WHERE id = $1::uuid AND load_id = $2::uuid',
      [docId, loadId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Document not found' });
    const abs = path.join(ERP_DATA_DIR, rows[0].stored_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, error: 'File missing on server' });
    const downloadName = rows[0].original_name || 'document';
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    if (rows[0].mime_type) res.setHeader('Content-Type', rows[0].mime_type);
    res.sendFile(path.resolve(abs));
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/loads/:id/documents', loadDocUpload.single('file'), async (req, res) => {
  try {
    const loadId = req.params.id;
    if (!req.file) return res.status(400).json({ ok: false, error: 'file is required (multipart field name: file)' });
    const check = await dbQuery('SELECT id FROM loads WHERE id = $1::uuid', [loadId]);
    if (!check.rows.length) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
      return res.status(404).json({ ok: false, error: 'Load not found' });
    }
    const doc_type = String(req.body?.doc_type || 'other').trim() || 'other';
    if (!LOAD_DOC_TYPES.has(doc_type)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
      return res.status(400).json({ ok: false, error: 'doc_type must be rate_confirmation, delivery, or other' });
    }
    const relPath = path.join(LOAD_DOCS_REL, loadId, path.basename(req.file.path));
    const original_name = String(req.file.originalname || path.basename(req.file.path));
    const mime_type = req.file.mimetype || null;
    const byte_size = typeof req.file.size === 'number' ? req.file.size : null;
    const ins = await dbQuery(
      `INSERT INTO load_documents (load_id, doc_type, original_name, stored_path, mime_type, byte_size)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       RETURNING id, doc_type, original_name, mime_type, byte_size, created_at`,
      [loadId, doc_type, original_name, relPath, mime_type, byte_size]
    );
    const docRow = ins.rows[0];
    setImmediate(() => {
      syncSingleLoadDocumentToQbo(loadId, docRow.id).catch(err => {
        console.error('[load-doc qbo attach]', err?.message || err);
      });
    });
    res.json({ ok: true, data: docRow });
  } catch (e) {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/loads/:id', async (req, res) => {
  try {
    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Load not found' });
    const load = enrichLoadRow(rows[0]);
    const stops = await dbQuery(
      `SELECT id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text,
              qbo_item_id, qbo_account_id
       FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [req.params.id]
    );
    res.json({ ok: true, data: { ...load, stops: stops.rows } });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/loads', async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ ok: false, error: 'Database not configured' });

  const body = req.body || {};
  const load_number = String(body.load_number || '').trim();
  if (!load_number) return res.status(400).json({ ok: false, error: 'load_number is required' });

  const status = String(body.status || 'open').trim() || 'open';
  const customer_id = uuidOrNull(body.customer_id);
  const driver_id = uuidOrNull(body.driver_id);
  const truck_id = uuidOrNull(body.truck_id);
  const trailer_id = uuidOrNull(body.trailer_id);
  const dispatcher_name = String(body.dispatcher_name || '').trim() || null;
  const start_date = dateOrNull(body.start_date);
  const end_date = dateOrNull(body.end_date);
  const plm = body.practical_loaded_miles != null ? Number(body.practical_loaded_miles) : 0;
  const pem = body.practical_empty_miles != null ? Number(body.practical_empty_miles) : 0;
  const notes = String(body.notes || '').trim() || null;
  const qbo_customer_id = qboIdOrNull(body.qbo_customer_id);
  const qbo_driver_vendor_id = qboIdOrNull(body.qbo_driver_vendor_id);
  const qbo_driver_vendor_name =
    body.qbo_driver_vendor_name != null && String(body.qbo_driver_vendor_name).trim()
      ? String(body.qbo_driver_vendor_name).trim()
      : null;
  const revenue_amount = revenueOrNull(body.revenue_amount);
  const qbo_linehaul_item_id = qboIdOrNull(body.qbo_linehaul_item_id);
  const invoice_extra_lines = sanitizeInvoiceExtraLines(body.invoice_extra_lines);
  const customer_wo_number =
    body.customer_wo_number != null && String(body.customer_wo_number).trim()
      ? String(body.customer_wo_number).trim().slice(0, 80)
      : null;
  const stops = Array.isArray(body.stops) ? body.stops : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO loads (
        load_number, status, customer_id, driver_id, truck_id, trailer_id,
        dispatcher_name, start_date, end_date, practical_loaded_miles, practical_empty_miles, notes,
        qbo_customer_id, revenue_amount, qbo_driver_vendor_id, qbo_driver_vendor_name,
        qbo_linehaul_item_id, invoice_extra_lines, customer_wo_number
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
      RETURNING id`,
      [
        load_number,
        status,
        customer_id,
        driver_id,
        truck_id,
        trailer_id,
        dispatcher_name,
        start_date,
        end_date,
        plm,
        pem,
        notes,
        qbo_customer_id,
        revenue_amount,
        qbo_driver_vendor_id,
        qbo_driver_vendor_name,
        qbo_linehaul_item_id,
        JSON.stringify(invoice_extra_lines),
        customer_wo_number
      ]
    );
    const loadId = ins.rows[0].id;

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i] || {};
      await client.query(
        `INSERT INTO load_stops (load_id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text, qbo_item_id, qbo_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11)`,
        [
          loadId,
          i,
          String(s.stop_type || 'pickup').trim(),
          String(s.location_name || '').trim() || null,
          String(s.address || '').trim() || null,
          s.practical_miles != null ? Number(s.practical_miles) : 0,
          s.shortest_miles != null ? Number(s.shortest_miles) : 0,
          s.stop_at || null,
          String(s.window_text || '').trim() || null,
          qboIdOrNull(s.qbo_item_id),
          qboIdOrNull(s.qbo_account_id)
        ]
      );
    }

    await client.query('COMMIT');

    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [loadId]);
    const stopRows = await dbQuery(
      `SELECT * FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [loadId]
    );
    res.json({ ok: true, data: { ...enrichLoadRow(rows[0]), stops: stopRows.rows } });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Load number already exists' });
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

router.patch('/loads/:id', async (req, res) => {
  const pool = getPool();
  if (!pool) return res.status(503).json({ ok: false, error: 'Database not configured' });

  const id = req.params.id;
  const b = req.body || {};
  const fields = [];
  const vals = [];
  let n = 1;
  const map = [
    ['status', 'status'],
    ['customer_id', 'customer_id'],
    ['qbo_customer_id', 'qbo_customer_id'],
    ['qbo_customer_name', 'qbo_customer_name'],
    ['qbo_driver_vendor_id', 'qbo_driver_vendor_id'],
    ['qbo_driver_vendor_name', 'qbo_driver_vendor_name'],
    ['driver_id', 'driver_id'],
    ['truck_id', 'truck_id'],
    ['trailer_id', 'trailer_id'],
    ['dispatcher_name', 'dispatcher_name'],
    ['start_date', 'start_date'],
    ['end_date', 'end_date'],
    ['practical_loaded_miles', 'practical_loaded_miles'],
    ['practical_empty_miles', 'practical_empty_miles'],
    ['notes', 'notes'],
    ['revenue_amount', 'revenue_amount'],
    ['qbo_linehaul_item_id', 'qbo_linehaul_item_id'],
    ['customer_wo_number', 'customer_wo_number']
  ];
  for (const [key, col] of map) {
    if (b[key] !== undefined) {
      fields.push(`${col} = $${n++}`);
      let v = b[key];
      if (key === 'revenue_amount') v = revenueOrNull(b[key]);
      else if (key === 'qbo_customer_id' || key === 'qbo_driver_vendor_id' || key === 'qbo_linehaul_item_id')
        v = qboIdOrNull(b[key]);
      else if (key === 'qbo_driver_vendor_name' || key === 'qbo_customer_name') {
        const s = b[key];
        v = s != null && String(s).trim() ? String(s).trim() : null;
      } else if (key === 'customer_wo_number') {
        const s = b[key];
        v = s != null && String(s).trim() ? String(s).trim().slice(0, 80) : null;
      }
      vals.push(v);
    }
  }
  const hasStops = Array.isArray(b.stops);
  const hasExtras = b.invoice_extra_lines !== undefined;
  if (!fields.length && !hasStops && !hasExtras) {
    return res.status(400).json({ ok: false, error: 'No fields or stops to update' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query('SELECT id FROM loads WHERE id = $1::uuid', [id]);
    if (!ex.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Load not found' });
    }
    if (hasExtras) {
      fields.push(`invoice_extra_lines = $${n++}::jsonb`);
      vals.push(JSON.stringify(sanitizeInvoiceExtraLines(b.invoice_extra_lines)));
    }
    if (fields.length) {
      fields.push(`updated_at = now()`);
      vals.push(id);
      await client.query(`UPDATE loads SET ${fields.join(', ')} WHERE id = $${n}::uuid`, vals);
    } else if (hasStops) {
      await client.query('UPDATE loads SET updated_at = now() WHERE id = $1::uuid', [id]);
    }
    if (hasStops) {
      await client.query('DELETE FROM load_stops WHERE load_id = $1::uuid', [id]);
      for (let i = 0; i < b.stops.length; i++) {
        const s = b.stops[i] || {};
        await client.query(
          `INSERT INTO load_stops (load_id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text, qbo_item_id, qbo_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11)`,
          [
            id,
            i,
            String(s.stop_type || 'pickup').trim(),
            String(s.location_name || '').trim() || null,
            String(s.address || '').trim() || null,
            s.practical_miles != null ? Number(s.practical_miles) : 0,
            s.shortest_miles != null ? Number(s.shortest_miles) : 0,
            s.stop_at || null,
            String(s.window_text || '').trim() || null,
            qboIdOrNull(s.qbo_item_id),
            qboIdOrNull(s.qbo_account_id)
          ]
        );
      }
    }
    await client.query('COMMIT');
    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [id]);
    const stopRows = await dbQuery(
      `SELECT * FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [id]
    );
    res.json({ ok: true, data: { ...enrichLoadRow(rows[0]), stops: stopRows.rows } });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

router.delete('/loads/:id', async (req, res) => {
  try {
    const r = await dbQuery('DELETE FROM loads WHERE id = $1::uuid RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Load not found' });
    res.json({ ok: true });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';

async function geocodeAddress(address) {
  const q = String(address || '').trim();
  if (!q) return null;
  if (GEOAPIFY_API_KEY) {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text', q);
    url.searchParams.set('limit', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', GEOAPIFY_API_KEY);
    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const data = await r.json();
    const x = data.results?.[0];
    if (!x) return null;
    return { lat: Number(x.lat), lon: Number(x.lon), label: x.formatted || q };
  }
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1`;
  const r = await fetch(nomUrl, { headers: { 'User-Agent': 'IH35-TMS/1.0 (dispatch)' } });
  const arr = await r.json();
  const x = Array.isArray(arr) ? arr[0] : null;
  if (!x) return null;
  return { lat: Number(x.lat), lon: Number(x.lon), label: x.display_name || q };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613;
  const toR = d => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function osrmDrivingMiles(lat1, lon1, lat2, lon2) {
  const path = `${lon1},${lat1};${lon2},${lat2}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=false`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await r.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('Driving route not found');
  return data.routes[0].distance * 0.000621371;
}

/** PC*Miler practical miles when licensed; else OSRM; else haversine factor. */
async function practicalMilesEngine(lat1, lon1, lat2, lon2) {
  const pc = await pcmilerPracticalMilesBetween(lat1, lon1, lat2, lon2);
  if (pc != null) return { miles: pc, engine: 'pcmiler' };
  try {
    const m = await osrmDrivingMiles(lat1, lon1, lat2, lon2);
    return { miles: m, engine: 'osrm' };
  } catch {
    const m = haversineMiles(lat1, lon1, lat2, lon2) * 1.25;
    return { miles: m, engine: 'haversine' };
  }
}

/**
 * First pickup → final delivery: practical (OSRM) miles as loaded linehaul, straight-line miles as empty-paperwork proxy.
 */
export async function computeSettlementLegMilesFromStops(stopsRows) {
  const ordered = [...(stopsRows || [])].sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
  if (ordered.length < 2) {
    return { ok: false, reason: 'need_at_least_2_stops' };
  }
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const addrA = String(first.address || '').trim() || String(first.location_name || '').trim();
  const addrB = String(last.address || '').trim() || String(last.location_name || '').trim();
  if (!addrA || !addrB) {
    return { ok: false, reason: 'missing_address' };
  }
  const ga = await geocodeAddress(addrA);
  const gb = await geocodeAddress(addrB);
  if (!ga || !gb) return { ok: false, reason: 'geocode_failed' };
  const pr = await practicalMilesEngine(ga.lat, ga.lon, gb.lat, gb.lon);
  const practical = pr.miles;
  const straight = haversineMiles(ga.lat, ga.lon, gb.lat, gb.lon);
  return {
    ok: true,
    pickupAddress: addrA,
    deliveryAddress: addrB,
    practicalLoadedMiles: Math.round(practical * 10) / 10,
    emptyMiles: Math.round(straight * 10) / 10,
    engine: `${GEOAPIFY_API_KEY ? 'geoapify' : 'nominatim'}+${pr.engine}`,
    note:
      pr.engine === 'pcmiler'
        ? 'Practical loaded miles: PC*Miler. Empty column is straight-line between same endpoints (optional to split loaded/empty in PC*Miler later).'
        : 'Settlement: practical loaded = routing from first stop to last; empty = straight-line miles for paperwork. Set PCMILER_API_KEY for PC*Miler practical.'
  };
}

/** Ordered stop addresses → practical (OSRM) vs shortest (great-circle) miles per leg. PC*Miler can replace this later. */
router.post('/compute-leg-miles', async (req, res) => {
  try {
    const addresses = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
    const cleaned = addresses.map(a => String(a || '').trim()).filter(Boolean);
    if (cleaned.length < 2) {
      return res.status(400).json({ ok: false, error: 'Provide at least 2 addresses in stop order' });
    }
    const points = [];
    for (let i = 0; i < cleaned.length; i++) {
      const addr = cleaned[i];
      if (i > 0 && !GEOAPIFY_API_KEY) {
        await new Promise(r => setTimeout(r, 1100));
      }
      const g = await geocodeAddress(addr);
      if (!g) {
        return res.status(422).json({
          ok: false,
          error: `Could not geocode: ${addr.slice(0, 100)}${
            GEOAPIFY_API_KEY
              ? ''
              : '. OpenStreetMap Nominatim allows ~1 request/sec; set GEOAPIFY_API_KEY for faster geocoding.'
          }`
        });
      }
      points.push({ ...g, address: addr });
    }
    const segments = [];
    let totalPractical = 0;
    let totalShortest = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const pr = await practicalMilesEngine(a.lat, a.lon, b.lat, b.lon);
      const practical = pr.miles;
      const shortest = haversineMiles(a.lat, a.lon, b.lat, b.lon);
      segments.push({
        fromAddress: a.address,
        toAddress: b.address,
        practicalMiles: Math.round(practical * 10) / 10,
        shortestMiles: Math.round(shortest * 10) / 10,
        fromLabel: a.label,
        toLabel: b.label,
        practicalEngine: pr.engine
      });
      totalPractical += practical;
      totalShortest += shortest;
    }
    const usedPc = segments.some(s => s.practicalEngine === 'pcmiler');
    res.json({
      ok: true,
      segments,
      totalPracticalMiles: Math.round(totalPractical * 10) / 10,
      totalShortestMiles: Math.round(totalShortest * 10) / 10,
      engine: `${GEOAPIFY_API_KEY ? 'geoapify' : 'nominatim'}+${usedPc ? 'pcmiler' : 'osrm/haversine'}`,
      note: usedPc
        ? 'Practical miles use PC*Miler where PCMILER_API_KEY is set; shortest column remains great-circle per leg.'
        : 'Practical uses OSRM (or haversine fallback). Set PCMILER_API_KEY for PC*Miler practical miles.'
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
