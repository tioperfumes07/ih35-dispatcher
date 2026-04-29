import { Router } from 'express';
import { alvysConfigured, alvysSearchDrivers } from '../lib/alvys-client.mjs';
import { alwaysTrackConfigured, alwaysTrackGet } from '../lib/always-track-client.mjs';
import { dbQuery, getPool } from '../lib/db.mjs';

const router = Router();

function relayConfig() {
  const user = String(process.env.RELAY_API_USER || '').trim();
  const pass = String(process.env.RELAY_API_PASS || '').trim();
  const base = String(process.env.RELAY_API_BASE || '').trim().replace(/\/+$/, '');
  return { user, pass, base };
}

function relayConfigured() {
  const cfg = relayConfig();
  return Boolean(cfg.user && cfg.pass && cfg.base);
}

function digitsLast4(v) {
  return String(v || '').replace(/\D+/g, '').slice(-4);
}

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapFuelType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('def')) return 'def';
  if (s.includes('reefer')) return 'reefer';
  return 'diesel';
}

function detectState(raw) {
  const txt = ` ${String(raw || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')} `;
  const exact = txt.match(/\s([A-Z]{2})\s/);
  return exact ? String(exact[1] || '').trim() : '';
}

async function relayFetch(pathname, query = {}) {
  const { user, pass, base } = relayConfig();
  if (!user || !pass || !base) {
    throw new Error('Relay API is not configured. Set RELAY_API_USER, RELAY_API_PASS, RELAY_API_BASE.');
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const qp = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v == null || String(v).trim() === '') return;
    qp.set(k, String(v));
  });
  const url = `${base}${pathname}${qp.toString() ? `?${qp.toString()}` : ''}`;
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20_000) : undefined;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
    signal,
  });
  const text = await resp.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Relay API returned non-JSON (${resp.status})`);
  }
  if (!resp.ok) {
    throw new Error(`Relay API error ${resp.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

function relayRows(payload) {
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function fetchRelayTransactions(query = {}) {
  try {
    const primary = await relayFetch('/v1/transactions', query);
    return relayRows(primary);
  } catch (e) {
    // Some tenants expose /transactions without /v1; try fallback once.
    if (!String(e?.message || '').includes('404')) throw e;
    const fallback = await relayFetch('/transactions', query);
    return relayRows(fallback);
  }
}

export async function syncRelayTransactions({ from = '', to = '', limit = 200, dryRun = false, source = 'manual' } = {}) {
  if (!relayConfigured()) {
    return { ok: false, error: 'Relay API env vars missing', total: 0, imported: 0, skipped: 0, failed: 0 };
  }
  if (!getPool()) {
    return { ok: false, error: 'DATABASE_URL is not set', total: 0, imported: 0, skipped: 0, failed: 0 };
  }

  const rows = await fetchRelayTransactions({ from, to, limit: Math.max(1, Math.min(1000, Number(limit) || 200)) });
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const tx of rows) {
    try {
      const relayTxnId = String(tx?.id || tx?.transaction_id || tx?.transactionId || tx?.txn_id || '').trim();
      if (!relayTxnId) {
        skipped += 1;
        continue;
      }

      const existing = await dbQuery('SELECT id FROM fuel_expenses WHERE relay_txn_id = $1 LIMIT 1', [relayTxnId]);
      if (existing?.rows?.[0]?.id) {
        skipped += 1;
        continue;
      }

      const integrationId = String(
        tx?.Integration_ID || tx?.integration_id || tx?.driver_id || tx?.driverId || tx?.card_number || ''
      ).trim();
      const cardLast4 = digitsLast4(tx?.card_last4 || tx?.cardLast4 || integrationId);

      let driver = null;
      if (integrationId) {
        const byIntegration = await dbQuery(
          `SELECT id, full_name, unit_number, samsara_driver_id
             FROM driver_profiles
            WHERE samsara_driver_id = $1 OR CAST(id AS TEXT) = $1
            LIMIT 1`,
          [integrationId]
        );
        driver = byIntegration?.rows?.[0] || null;
      }
      if (!driver && String(tx?.driver_name || '').trim()) {
        const byName = await dbQuery(
          `SELECT id, full_name, unit_number, samsara_driver_id
             FROM driver_profiles
            WHERE LOWER(full_name) = LOWER($1)
            LIMIT 1`,
          [String(tx.driver_name || '').trim()]
        );
        driver = byName?.rows?.[0] || null;
      }

      let assignment = null;
      if (cardLast4) {
        const byCard = await dbQuery(
          `SELECT card_last4, unit_number, driver_name, vendor_name
             FROM relay_card_assignments
            WHERE card_last4 = $1 AND active = true
            LIMIT 1`,
          [cardLast4]
        );
        assignment = byCard?.rows?.[0] || null;
      }

      const unitNumber =
        String(tx?.unit_number || tx?.unit || assignment?.unit_number || driver?.unit_number || '').trim() || null;
      const driverName =
        String(tx?.driver_name || driver?.full_name || assignment?.driver_name || '').trim() || null;
      const vendorName =
        String(tx?.vendor_name || tx?.merchant_name || tx?.merchant || assignment?.vendor_name || '').trim() || null;
      const fuelType = mapFuelType(tx?.fuel_type || tx?.product_type || tx?.product || tx?.kind);
      const gallons = asNumber(tx?.gallons ?? tx?.quantity ?? tx?.volume, NaN);
      const totalAmount = asNumber(tx?.total_amount ?? tx?.amount ?? tx?.total_price, NaN);
      const pricePerGallon = Number.isFinite(gallons) && gallons > 0 && Number.isFinite(totalAmount)
        ? Number((totalAmount / gallons).toFixed(4))
        : null;
      const station = String(tx?.station_name || tx?.station || tx?.merchant_name || '').trim() || null;
      const location = String(tx?.location || tx?.address || tx?.city_state || '').trim() || null;
      const state = String(tx?.state || '').trim().toUpperCase() || detectState(location || station || '');
      const submittedAt = String(tx?.transaction_date || tx?.date || tx?.created_at || '').trim();

      if (dryRun) {
        imported += 1;
        continue;
      }

      await dbQuery(
        `INSERT INTO fuel_expenses (
          unit_number, driver_name, fuel_type, gallons, price_per_gallon, total_amount,
          load_number, reefer_unit_number, settlement_load_id, station_name, location, receipt_photo,
          qbo_posted, state, miles_this_load, relay_event_id, relay_txn_id, relay_card_last4, relay_vendor, submitted_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          NULL,NULL,NULL,$7,$8,NULL,
          false,$9,NULL,$10,$11,$12,$13,COALESCE($14::timestamptz, now())
        )
        ON CONFLICT (relay_txn_id) WHERE relay_txn_id IS NOT NULL DO NOTHING`,
        [
          unitNumber,
          driverName,
          fuelType,
          Number.isFinite(gallons) ? gallons : null,
          Number.isFinite(pricePerGallon) ? pricePerGallon : null,
          Number.isFinite(totalAmount) ? totalAmount : null,
          station,
          location,
          state || null,
          `relay_sync_${source}`,
          relayTxnId,
          cardLast4 || null,
          vendorName,
          submittedAt || null,
        ]
      );
      imported += 1;
    } catch (_rowErr) {
      failed += 1;
    }
  }

  return { ok: true, total: rows.length, imported, skipped, failed };
}

let relayAutoSyncHandle = null;
export function startRelayAutoSync(log = console) {
  if (relayAutoSyncHandle) return relayAutoSyncHandle;
  const run = async () => {
    try {
      await syncRelayTransactions({ limit: 200, source: 'interval' });
    } catch (e) {
      if (log && typeof log.error === 'function') {
        log.error('[relay-auto-sync]', e?.message || String(e));
      }
    }
  };
  relayAutoSyncHandle = setInterval(run, 60 * 60 * 1000);
  return relayAutoSyncHandle;
}

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
    },
    relay: {
      configured: relayConfigured(),
      baseConfigured: Boolean(String(process.env.RELAY_API_BASE || '').trim())
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


router.get('/relay/settings', async (_req, res) => {
  try {
    if (!getPool()) return res.json({ ok: true, settings: { enabled: false, auto_post_qbo: false } });
    const { rows } = await dbQuery(
      `SELECT setting_key, setting_value
         FROM integration_settings
        WHERE setting_key IN ('relay_webhook_enabled','relay_auto_post_qbo')
        ORDER BY setting_key`
    );
    const map = Object.fromEntries((rows || []).map((r) => [String(r.setting_key), String(r.setting_value || '')]));
    return res.json({
      ok: true,
      settings: {
        enabled: map.relay_webhook_enabled === '1',
        auto_post_qbo: map.relay_auto_post_qbo === '1',
      },
    });
  } catch (_e) {
    return res.json({ ok: true, settings: { enabled: false, auto_post_qbo: false } });
  }
});

router.post('/relay/settings', async (req, res) => {
  try {
    if (!getPool()) return res.json({ ok: false, error: 'No DB' });
    const settings = req.body || {};
    await dbQuery(
      `INSERT INTO integration_settings (setting_key, setting_value, updated_at)
       VALUES ('relay_webhook_enabled', $1, now())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [settings.enabled ? '1' : '0']
    );
    await dbQuery(
      `INSERT INTO integration_settings (setting_key, setting_value, updated_at)
       VALUES ('relay_auto_post_qbo', $1, now())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [settings.auto_post_qbo ? '1' : '0']
    );
    return res.json({ ok: true, settings });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/relay/card-assignments', async (_req, res) => {
  try {
    if (!getPool()) return res.json({ ok: true, data: [], count: 0 });
    const { rows } = await dbQuery("SELECT * FROM relay_card_assignments WHERE active = true ORDER BY created_at DESC");
    return res.json({ ok: true, data: rows || [], count: (rows || []).length });
  } catch (e) {
    return res.json({ ok: true, data: [], count: 0 });
  }
});

router.post('/relay/card-assignments', async (req, res) => {
  try {
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


router.get('/relay/transactions', async (req, res) => {
  try {
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    const limit = Number(req.query?.limit);
    const dryRun = String(req.query?.dry_run || '').trim() === '1';
    const out = await syncRelayTransactions({ from, to, limit, dryRun, source: 'endpoint' });
    if (!out.ok) return res.status(503).json(out);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/relay/drivers', async (_req, res) => {
  try {
    const data = await relayFetch('/v1/drivers');
    return res.json({ ok: true, data: relayRows(data) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
