import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getVehicleStats, getHosClocks, getVehicles } from './services/samsara.js';
import { normalizeTruckProfile, chooseFuelStop } from './lib/recommendation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3300;
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = (process.env.SAMSARA_API_TOKEN || '').trim();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const truckCsvPath = path.join(__dirname, 'data', 'truck_profiles.sample.csv');

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? '';
    });
    return obj;
  });
}

function getTruckProfiles() {
  const raw = fs.readFileSync(truckCsvPath, 'utf8');
  const rows = parseCsv(raw);
  return rows.map((row) =>
    normalizeTruckProfile(row, {
      tank_capacity_gallons: 120,
      reserve_gallons: Number(process.env.DEFAULT_RESERVE_GALLONS || 35),
      target_shift_miles: Number(process.env.DEFAULT_TARGET_SHIFT_MILES || 750),
      max_personal_conveyance_miles: Number(process.env.DEFAULT_PERSONAL_CONVEYANCE_MILES || 45),
      max_detour_miles: Number(process.env.DEFAULT_MAX_DETOUR_MILES || 10),
    })
  );
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: !!TOKEN,
    serverTime: new Date().toISOString(),
  });
});

app.get('/api/config/truck-profiles', (_req, res) => {
  res.json({ data: getTruckProfiles() });
});

app.get('/api/samsara/vehicles', async (_req, res) => {
  try {
    const data = await getVehicles(TOKEN);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null,
    });
  }
});

app.get('/api/samsara/live', async (_req, res) => {
  try {
    const data = await getVehicleStats(TOKEN, '');
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null,
    });
  }
});

app.get('/api/samsara/hos', async (_req, res) => {
  try {
    const data = await getHosClocks(TOKEN);
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null,
    });
  }
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

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json'
      }
    });

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();

    if (!q) {
      return res.json([]);
    }

    const query = q.toUpperCase();

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'IH35-Dispatcher-App'
      }
    });

    const data = await response.json();

    const result = data.map(x => ({
      lat: Number(x.lat),
      lon: Number(x.lon),
      name: x.display_name
    }));

    res.json(result);
  } catch (err) {
    console.error('Geocode error:', err.message);
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
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recommendation/preview', (req, res) => {
  try {
    const truckProfiles = getTruckProfiles();
    const body = req.body || {};
    const unit = String(body.unit_number || '').trim();

    const truck =
      truckProfiles.find((t) => t.unit_number === unit) ||
      normalizeTruckProfile({ unit_number: unit });

    const result = chooseFuelStop({
      truck,
      fuelPercent: body.fuel_percent,
      hos: {
        drive_time_remaining_minutes: body.drive_time_remaining_minutes,
        shift_time_remaining_minutes: body.shift_time_remaining_minutes,
      },
      stops: body.stops || [],
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`IH35 Dispatch V3 starter running on http://${HOST}:${PORT}`);
});
