import { Router } from 'express';
import { dbQuery, getPool } from '../lib/db.mjs';

const router = Router();

function uuidOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
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
      'SELECT id, name, email, phone, qbo_vendor_id, created_at FROM drivers ORDER BY name'
    );
    res.json({ ok: true, data: rows });
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
       RETURNING id, name, email, phone, qbo_vendor_id, created_at`,
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
    c.name AS customer_name,
    d.name AS driver_name,
    t.unit_code AS truck_code,
    tr.unit_code AS trailer_code,
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

router.get('/loads', async (req, res) => {
  try {
    const tab = String(req.query.tab || 'open').toLowerCase();
    let where = '1=1';
    const params = [];
    if (tab === 'open') {
      where = `l.status NOT IN ('delivered')`;
    } else if (tab === 'delivered') {
      where = `l.status = 'delivered'`;
    } else if (tab === 'unsettled') {
      where = `l.status = 'delivered'`;
    }
    const { rows } = await dbQuery(
      `${loadSelect} WHERE ${where} ORDER BY l.created_at DESC`,
      params
    );
    res.json({ ok: true, data: rows, tab });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/loads/:id', async (req, res) => {
  try {
    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Load not found' });
    const load = rows[0];
    const stops = await dbQuery(
      `SELECT id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text
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
  const stops = Array.isArray(body.stops) ? body.stops : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO loads (
        load_number, status, customer_id, driver_id, truck_id, trailer_id,
        dispatcher_name, start_date, end_date, practical_loaded_miles, practical_empty_miles, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        notes
      ]
    );
    const loadId = ins.rows[0].id;

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i] || {};
      await client.query(
        `INSERT INTO load_stops (load_id, sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)`,
        [
          loadId,
          i,
          String(s.stop_type || 'pickup').trim(),
          String(s.location_name || '').trim() || null,
          String(s.address || '').trim() || null,
          s.practical_miles != null ? Number(s.practical_miles) : 0,
          s.shortest_miles != null ? Number(s.shortest_miles) : 0,
          s.stop_at || null,
          String(s.window_text || '').trim() || null
        ]
      );
    }

    await client.query('COMMIT');

    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [loadId]);
    const stopRows = await dbQuery(
      `SELECT * FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [loadId]
    );
    res.json({ ok: true, data: { ...rows[0], stops: stopRows.rows } });
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
  try {
    const id = req.params.id;
    const b = req.body || {};
    const fields = [];
    const vals = [];
    let n = 1;
    const map = [
      ['status', 'status'],
      ['customer_id', 'customer_id'],
      ['driver_id', 'driver_id'],
      ['truck_id', 'truck_id'],
      ['trailer_id', 'trailer_id'],
      ['dispatcher_name', 'dispatcher_name'],
      ['start_date', 'start_date'],
      ['end_date', 'end_date'],
      ['practical_loaded_miles', 'practical_loaded_miles'],
      ['practical_empty_miles', 'practical_empty_miles'],
      ['notes', 'notes']
    ];
    for (const [key, col] of map) {
      if (b[key] !== undefined) {
        fields.push(`${col} = $${n++}`);
        vals.push(b[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });
    fields.push(`updated_at = now()`);
    vals.push(id);
    await dbQuery(`UPDATE loads SET ${fields.join(', ')} WHERE id = $${n}::uuid`, vals);
    const { rows } = await dbQuery(`${loadSelect} WHERE l.id = $1::uuid`, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Load not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    if (dbUnavailable(res, e)) return;
    res.status(500).json({ ok: false, error: e.message });
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

export default router;
