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
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || '';

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
    hasGeoapifyKey: !!GEOAPIFY_API_KEY,
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
    const data = await fetchJson(
      'https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates',
      { headers: authHeaders() }
    );
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
    const now = new Date();
    const startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

    const assignmentsUrl = new URL('https://api.samsara.com/fleet/driver-vehicle-assignments');
    assignmentsUrl.searchParams.set('filterBy', 'vehicles');
    assignmentsUrl.searchParams.set('startTime', startTime);
    assignmentsUrl.searchParams.set('endTime', endTime);

    const [vehicles, live, hos, assignments] = await Promise.all([
      fetchJson('https://api.samsara.com/fleet/vehicles', { headers: authHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/vehicles/stats?types=fuelPercents,gps,engineStates', { headers: authHeaders() }).catch(() => ({ data: [] })),
      fetchJson('https://api.samsara.com/fleet/hos/clocks', { headers: authHeaders() }).catch(() => ({ data: [] })),
      fetchJson(assignmentsUrl.toString(), { headers: authHeaders() }).catch(() => ({ data: [] }))
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

    if (GEOAPIFY_API_KEY) {
      const url = new URL('https://api.geoapify.com/v1/geocode/search');
      url.searchParams.set('text', q);
      url.searchParams.set('filter', 'countrycode:us');
      url.searchParams.set('limit', '8');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const data = await fetchJson(url.toString(), { headers: { Accept: 'application/json' } });
      const results = (data.results || []).map(x => ({
        lat: Number(x.lat),
        lon: Number(x.lon),
        name: x.formatted || q
      }));
      return res.json(results);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'IH35-Dispatcher-App',
        Accept: 'application/json'
      }
    });

    const raw = await response.text();
    let data = [];
    try {
      data = JSON.parse(raw);
    } catch {
      return res.json([]);
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

app.get('/api/autocomplete', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q || q.length < 2) return res.json([]);

    if (GEOAPIFY_API_KEY) {
      const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      url.searchParams.set('text', q);
      url.searchParams.set('filter', 'countrycode:us');
      url.searchParams.set('limit', '10');
      url.searchParams.set('format', 'json');
      url.searchParams.set('apiKey', GEOAPIFY_API_KEY);

      const data = await fetchJson(url.toString(), { headers: { Accept: 'application/json' } });
      const results = (data.results || []).map(x => ({
        name: x.formatted || x.address_line1 || x.city || q
      }));
      return res.json(results);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&q=${encodeURIComponent(q)}&countrycodes=us&limit=12`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'IH35-Dispatcher-App',
        Accept: 'application/json'
      }
    });

    const raw = await response.text();
    let data = [];
    try {
      data = JSON.parse(raw);
    } catch {
      return res.json([]);
    }

    const results = (Array.isArray(data) ? data : []).map(x => ({
      name: x.display_name
    }));

    res.json(results);
  } catch {
    res.json([]);
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
