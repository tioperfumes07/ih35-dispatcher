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

export default router;
