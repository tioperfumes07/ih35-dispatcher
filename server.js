import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3400;
const TOKEN = process.env.SAMSARA_API_TOKEN || '';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function authHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json'
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${raw.slice(0, 200)}`);
  }

  if (!response.ok) {
    const msg = data?.message || data?.error || response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: !!TOKEN,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/samsara/vehicles', async (_req, res) => {
  try {
    const data = await fetchJson('https://api.samsara.com/fleet/vehicles', {
      headers: authHeaders()
    });
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/api/samsara/live', async (_req, res) => {
  try {
    const data = await fetchJson('https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates', {
      headers: authHeaders()
    });
    res.json(data);
  } catch {
    try {
      const data = await fetchJson('https://api.samsara.com/fleet/vehicles', {
        headers: authHeaders()
      });
      res.json(data);
    } catch (error) {
      res.status(error.status || 500).json({
        error: error.message,
        details: error.details || null
      });
    }
  }
});

app.get('/api/samsara/hos', async (_req, res) => {
  const tries = [
    'https://api.samsara.com/fleet/hos/clocks',
    'https://api.samsara.com/fleet/hos/logs',
    'https://api.samsara.com/fleet/drivers/hos/clocks'
  ];

  for (const url of tries) {
    try {
      const data = await fetchJson(url, { headers: authHeaders() });
      return res.json(data);
    } catch {}
  }

  res.json({ data: [] });
});

app.get('/api/samsara/assignments', async (_req, res) => {
  try {
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const url = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    url.searchParams.set('filterBy', 'vehicles');
    url.searchParams.set('startTime', startTime);
    url.searchParams.set('endTime', endTime);

    const data = await fetchJson(url.toString(), {
      headers: authHeaders()
    });
    res.json(data);
  } catch {
    res.json({ data: [] });
  }
});

app.get('/api/board', async (_req, res) => {
  try {
    const [vehicles, live, hos, assignments] = await Promise.all([
      fetchJson('https://api.samsara.com/fleet/vehicles', { headers: authHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates', { headers: authHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/hos/clocks', { headers: authHeaders() }).catch(() => ({ data: [] })),
      (async () => {
        const now = new Date();
        const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
        const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
        const url = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
        url.searchParams.set('filterBy', 'vehicles');
        url.searchParams.set('startTime', startTime);
        url.searchParams.set('endTime', endTime);
        return fetchJson(url.toString(), { headers: authHeaders() }).catch(() => ({ data: [] }));
      })()
    ]);

    res.json({
      vehicles: vehicles.data || [],
      live: live.data || [],
      hos: hos.data || [],
      assignments: assignments.data || [],
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);

    const key = q.toLowerCase().trim();

    const known = {
      'laredo, tx': [{ lat: 27.5306, lon: -99.4803, name: 'Laredo, TX' }],
      'laredo tx': [{ lat: 27.5306, lon: -99.4803, name: 'Laredo, TX' }],
      'san antonio, tx': [{ lat: 29.4241, lon: -98.4936, name: 'San Antonio, TX' }],
      'san antonio tx': [{ lat: 29.4241, lon: -98.4936, name: 'San Antonio, TX' }],
      'dallas, tx': [{ lat: 32.7767, lon: -96.7970, name: 'Dallas, TX' }],
      'dallas tx': [{ lat: 32.7767, lon: -96.7970, name: 'Dallas, TX' }],
      'houston, tx': [{ lat: 29.7604, lon: -95.3698, name: 'Houston, TX' }],
      'houston tx': [{ lat: 29.7604, lon: -95.3698, name: 'Houston, TX' }],
      'chicago, il': [{ lat: 41.8781, lon: -87.6298, name: 'Chicago, IL' }],
      'chicago il': [{ lat: 41.8781, lon: -87.6298, name: 'Chicago, IL' }]
    };

    if (known[key]) return res.json(known[key]);

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=us&limit=5`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'IH35-Dispatcher-App',
        Accept: 'application/json'
      }
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: 'Geocoder returned non-JSON response',
        details: raw.slice(0, 200)
      });
    }

    const result = (Array.isArray(data) ? data : []).map(x => ({
      lat: Number(x.lat),
      lon: Number(x.lon),
      name: x.display_name || q
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/route', async (req, res) => {
  try {
    const coords = String(req.query.coords || '').trim();
    if (!coords) {
      return res.status(400).json({ error: 'Missing coords' });
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const data = await fetchJson(url, {
      headers: { Accept: 'application/json' }
    });

    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
