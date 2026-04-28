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

export default router;
