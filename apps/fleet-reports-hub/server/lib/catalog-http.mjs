import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_TYPES_PATH = path.join(__dirname, '..', 'data', 'service-types.json');
const PARTS_PATH = path.join(__dirname, '..', 'data', 'parts-reference.json');
const FLEET_AVG_MI_MO = 12000;

function monthsFromMiles(mi) {
  if (mi == null || Number(mi) <= 0) return null;
  return Math.floor(Number(mi) / FLEET_AVG_MI_MO);
}

function readServices() {
  const raw = fs.readFileSync(SERVICE_TYPES_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeServices(rows) {
  fs.writeFileSync(SERVICE_TYPES_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

function readParts() {
  const raw = fs.readFileSync(PARTS_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeParts(rows) {
  fs.writeFileSync(PARTS_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

function normalizeService(s) {
  const mi = s.interval_miles == null ? null : Number(s.interval_miles);
  const mo = monthsFromMiles(mi);
  return {
    ...s,
    interval_miles: mi,
    interval_months: s.interval_months != null ? Number(s.interval_months) : mo,
    uses_position_map: Boolean(s.uses_position_map),
    is_manufacturer_required: Boolean(s.is_manufacturer_required),
    display_order: Number(s.display_order) || 0,
    avg_cost_low: s.avg_cost_low != null ? Number(s.avg_cost_low) : null,
    avg_cost_high: s.avg_cost_high != null ? Number(s.avg_cost_high) : null,
    applies_to_makes: Array.isArray(s.applies_to_makes) ? s.applies_to_makes : ['all'],
  };
}

export function registerCatalogRoutes(app) {
  app.get('/api/catalog/service-types', (req, res) => {
    try {
      let rows = readServices().map(normalizeService);
      const rt = String(req.query.recordType || '').trim();
      if (rt === 'maintenance' || rt === 'repair') {
        rows = rows.filter((r) => r.record_type === rt);
      }
      /* omit or 'all' → no filter */
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) {
        rows = rows.filter(
          (r) =>
            r.service_name.toLowerCase().includes(q) ||
            r.service_key.toLowerCase().includes(q) ||
            r.service_category.toLowerCase().includes(q),
        );
      }
      const cat = String(req.query.category || '').trim().toLowerCase();
      if (cat) {
        rows = rows.filter((r) => r.service_category.toLowerCase() === cat);
      }
      rows.sort((a, b) => a.display_order - b.display_order || a.service_name.localeCompare(b.service_name));
      res.json({ services: rows });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/catalog/service-types/save', (req, res) => {
    try {
      const body = req.body?.service || req.body;
      if (!body?.service_key || !body?.service_name) {
        return res.status(400).json({ error: 'service_key and service_name required' });
      }
      const rows = readServices();
      const mi = body.interval_miles == null || body.interval_miles === '' ? null : Number(body.interval_miles);
      const normalized = normalizeService({
        id: body.id || `st-${body.service_key}`,
        service_key: String(body.service_key).trim(),
        service_name: String(body.service_name).trim(),
        interval_miles: mi,
        interval_months: body.interval_months == null || body.interval_months === '' ? monthsFromMiles(mi) : Number(body.interval_months),
        uses_position_map: Boolean(body.uses_position_map),
        position_map_type: body.position_map_type || null,
        service_category: String(body.service_category || 'General').trim(),
        record_type: body.record_type === 'repair' ? 'repair' : 'maintenance',
        avg_cost_low: body.avg_cost_low === '' || body.avg_cost_low == null ? null : Number(body.avg_cost_low),
        avg_cost_high: body.avg_cost_high === '' || body.avg_cost_high == null ? null : Number(body.avg_cost_high),
        applies_to_makes: Array.isArray(body.applies_to_makes) ? body.applies_to_makes : ['all'],
        notes: body.notes != null ? String(body.notes) : '',
        is_manufacturer_required: Boolean(body.is_manufacturer_required),
        display_order: Number(body.display_order) || 0,
      });
      const idx = rows.findIndex((r) => r.service_key === normalized.service_key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...normalized, id: rows[idx].id || normalized.id };
      else rows.push({ ...normalized, id: normalized.id || crypto.randomUUID() });
      writeServices(rows);
      res.json({ ok: true, service: rows.find((r) => r.service_key === normalized.service_key) });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/catalog/parts', (req, res) => {
    try {
      let rows = readParts();
      const q = String(req.query.q || '').trim().toLowerCase();
      if (q) {
        rows = rows.filter(
          (p) =>
            String(p.part_name).toLowerCase().includes(q) ||
            String(p.category).toLowerCase().includes(q),
        );
      }
      const cat = String(req.query.category || '').trim().toLowerCase();
      if (cat) {
        rows = rows.filter((p) => String(p.category).toLowerCase() === cat);
      }
      res.json({ parts: rows });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/catalog/parts/save', (req, res) => {
    try {
      const p = req.body?.part || req.body;
      if (!p?.category || !p?.part_name) {
        return res.status(400).json({ error: 'category and part_name required' });
      }
      const rows = readParts();
      const part = {
        category: String(p.category).trim(),
        part_name: String(p.part_name).trim(),
        cost_low: Number(p.cost_low) || 0,
        cost_mid: Number(p.cost_mid) || 0,
        cost_high: Number(p.cost_high) || 0,
        notes: p.notes != null ? String(p.notes) : undefined,
      };
      const idx = rows.findIndex(
        (r) =>
          String(r.category).toLowerCase() === part.category.toLowerCase() &&
          String(r.part_name).toLowerCase() === part.part_name.toLowerCase(),
      );
      if (idx >= 0) rows[idx] = { ...rows[idx], ...part };
      else rows.push(part);
      writeParts(rows);
      res.json({ ok: true, part });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
