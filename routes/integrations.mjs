import { Router } from 'express';
import { alvysConfigured, alvysSearchDrivers } from '../lib/alvys-client.mjs';
import { alwaysTrackConfigured, alwaysTrackGet } from '../lib/always-track-client.mjs';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    alvys: {
      configured: alvysConfigured(),
      docsUrl: 'https://docs.alvys.com'
    },
    alwaysTrack: {
      configured: alwaysTrackConfigured(),
      note:
        'All-Ways Track does not publish a standard public API here. Use ALWAYS_TRACK_* when your account provides a REST base URL + token, or import CSV/Excel from the vendor.'
    }
  });
});

router.get('/alvys/drivers', async (req, res) => {
  try {
    if (!alvysConfigured()) {
      return res.status(400).json({
        ok: false,
        error: 'Set ALVYS_API_TOKEN (Bearer JWT from Alvys). Optional: ALVYS_API_BASE_URL (default https://integrations.alvys.com)'
      });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const data = await alvysSearchDrivers({ pageSize: limit, page: Number(req.query.page) || 0 });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({
      ok: false,
      error: e.message || String(e),
      details: e.body || undefined
    });
  }
});

router.get('/always-track/health', async (_req, res) => {
  if (!alwaysTrackConfigured()) {
    return res.json({
      ok: false,
      configured: false,
      message:
        'Configure ALWAYS_TRACK_API_BASE_URL and ALWAYS_TRACK_API_KEY when your vendor exposes a REST API. Optional: ALWAYS_TRACK_HEALTH_PATH (default /health).'
    });
  }
  try {
    const path = String(process.env.ALWAYS_TRACK_HEALTH_PATH || '/health');
    const data = await alwaysTrackGet(path);
    res.json({ ok: true, configured: true, path, data });
  } catch (e) {
    res.status(500).json({ ok: false, configured: true, error: e.message });
  }
});


// Relay fuel card integration
router.get('/relay/settings', async (_req, res) => {
  try {
    const { dbQuery, getPool } = await import('../lib/db.mjs');
    if (!getPool()) return res.json({ ok: true, settings: { enabled: false, auto_post_qbo: false } });
    const { rows } = await dbQuery("SELECT value FROM integration_settings WHERE key = 'relay_settings' LIMIT 1");
    const settings = rows?.[0]?.value ? JSON.parse(rows[0].value) : { enabled: false, auto_post_qbo: false };
    return res.json({ ok: true, settings });
  } catch (e) {
    return res.json({ ok: true, settings: { enabled: false, auto_post_qbo: false } });
  }
});

router.post('/relay/settings', async (req, res) => {
  try {
    const { dbQuery, getPool } = await import('../lib/db.mjs');
    if (!getPool()) return res.json({ ok: false, error: 'No DB' });
    const settings = req.body || {};
    await dbQuery(
      "INSERT INTO integration_settings (key, value) VALUES ('relay_settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [JSON.stringify(settings)]
    );
    return res.json({ ok: true, settings });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/relay/card-assignments', async (_req, res) => {
  try {
    const { dbQuery, getPool } = await import('../lib/db.mjs');
    if (!getPool()) return res.json({ ok: true, data: [], count: 0 });
    const { rows } = await dbQuery("SELECT * FROM relay_card_assignments WHERE active = true ORDER BY created_at DESC");
    return res.json({ ok: true, data: rows || [], count: (rows || []).length });
  } catch (e) {
    return res.json({ ok: true, data: [], count: 0 });
  }
});

router.post('/relay/card-assignments', async (req, res) => {
  try {
    const { dbQuery, getPool } = await import('../lib/db.mjs');
    if (!getPool()) return res.status(500).json({ ok: false, error: 'No DB' });
    const { card_last4, unit_number, driver_name, vendor_name, assigned_by, notes } = req.body || {};
    if (!card_last4) return res.status(400).json({ ok: false, error: 'card_last4 required' });
    const { rows } = await dbQuery(
      "INSERT INTO relay_card_assignments (card_last4, unit_number, driver_name, vendor_name, assigned_by, notes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (card_last4) WHERE active = true DO UPDATE SET unit_number=$2, driver_name=$3, vendor_name=$4, assigned_by=$5, notes=$6, updated_at=NOW() RETURNING *",
      [card_last4, unit_number, driver_name, vendor_name, assigned_by, notes]
    );
    return res.json({ ok: true, data: rows?.[0] || {} });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});


// Relay TMS Fuel API client
async function relayFetch(path, method = 'GET', body = null) {
  const user = process.env.RELAY_API_USER || '';
  const pass = process.env.RELAY_API_PASS || '';
  const base = process.env.RELAY_API_BASE || 'https://api.relaypayments.com';
  if (!user || !pass) throw new Error('RELAY_API_USER and RELAY_API_PASS not set');
  const auth = Buffer.from(user + ':' + pass).toString('base64');
  const opts = {
    method,
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(base + path, opts);
  if (!res.ok) throw new Error('Relay API error: ' + res.status + ' ' + await res.text());
  return res.json();
}

// GET /api/integrations/relay/transactions
// Fetches fuel transactions from Relay and syncs to our DB
router.get('/relay/transactions', async (req, res) => {
  try {
    const { from, to, limit = 100 } = req.query;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', String(limit));
    const data = await relayFetch('/v1/transactions?' + params.toString());
    return res.json({ ok: true, data: data.transactions || data.data || data || [], count: (data.transactions || data.data || data || []).length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/integrations/relay/sync
// Pulls Relay transactions and saves as fuel_expenses
router.post('/relay/sync', async (req, res) => {
  try {
    const { dbQuery, getPool } = await import('../lib/db.mjs');
    const { from, to } = req.body || {};
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', '500');
    const data = await relayFetch('/v1/transactions?' + params.toString());
    const transactions = data.transactions || data.data || data || [];
    let imported = 0;
    let skipped = 0;
    if (getPool()) {
      for (const tx of transactions) {
        try {
          // Map Relay Driver ID (integration_id) to our driver/unit
          const driverId = String(tx.integration_id || tx.driver_id || tx.driverId || '');
          const cardLast4 = String(tx.card_last4 || tx.cardLast4 || '').slice(-4);
          // Look up driver by relay integration_id
          let unitNumber = '';
          let driverName = '';
          if (driverId) {
            const { rows: driverRows } = await dbQuery(
              'SELECT driver_name, unit_number FROM driver_profiles WHERE samsara_driver_id = $1 OR relay_driver_id = $1 LIMIT 1',
              [driverId]
            ).catch(() => ({ rows: [] }));
            if (driverRows?.[0]) {
              driverName = driverRows[0].driver_name || '';
              unitNumber = driverRows[0].unit_number || '';
            }
          }
          if (!unitNumber && cardLast4) {
            const { rows: cardRows } = await dbQuery(
              'SELECT unit_number, driver_name FROM relay_card_assignments WHERE card_last4 = $1 AND active = true LIMIT 1',
              [cardLast4]
            ).catch(() => ({ rows: [] }));
            if (cardRows?.[0]) {
              unitNumber = cardRows[0].unit_number || '';
              driverName = driverName || cardRows[0].driver_name || '';
            }
          }
          const amount = parseFloat(tx.amount || tx.total_amount || 0);
          const gallons = parseFloat(tx.gallons || tx.quantity || 0);
          const pricePerGallon = gallons > 0 ? amount / gallons : 0;
          const fuelType = String(tx.fuel_type || tx.product_type || 'diesel').toLowerCase().includes('def') ? 'def' :
                           String(tx.fuel_type || tx.product_type || '').toLowerCase().includes('reefer') ? 'reefer_diesel' : 'diesel';
          const txId = String(tx.id || tx.transaction_id || tx.txId || '');
          // Check if already imported
          const { rows: existing } = await dbQuery(
            "SELECT id FROM fuel_expenses WHERE relay_transaction_id = $1 LIMIT 1",
            [txId]
          ).catch(() => ({ rows: [] }));
          if (existing?.length) { skipped++; continue; }
          await dbQuery(
            `INSERT INTO fuel_expenses 
              (unit_number, driver_name, fuel_type, gallons, price_per_gallon, 
               total_amount, station_name, state, transaction_date, 
               relay_transaction_id, relay_driver_id, source, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'relay','pending')`,
            [
              unitNumber || 'UNKNOWN',
              driverName || tx.driver_name || '',
              fuelType,
              gallons,
              pricePerGallon,
              amount,
              String(tx.merchant_name || tx.station || tx.location || ''),
              String(tx.state || tx.merchant_state || ''),
              String(tx.created_at || tx.transaction_date || tx.date || new Date().toISOString()),
              txId,
              driverId
            ]
          );
          imported++;
        } catch (rowErr) {
          console.error('Relay sync row error:', rowErr.message);
        }
      }
    }
    return res.json({ ok: true, total: transactions.length, imported, skipped });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/integrations/relay/drivers
// List drivers from Relay
router.get('/relay/drivers', async (_req, res) => {
  try {
    const data = await relayFetch('/v1/drivers');
    return res.json({ ok: true, data: data.drivers || data.data || data || [] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
