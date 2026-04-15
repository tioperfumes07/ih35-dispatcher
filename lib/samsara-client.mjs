/**
 * Shared Samsara Fleet API helpers (vehicles list for TMS / dispatch).
 */
const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN || '';

function headers() {
  return {
    Authorization: `Bearer ${SAMSARA_API_TOKEN}`,
    Accept: 'application/json'
  };
}

/** @returns {Promise<Array<{ id: string, name: string, vin?: string, licensePlate?: string }>>} */
export async function fetchSamsaraVehiclesNormalized() {
  if (!SAMSARA_API_TOKEN) return [];
  const url = 'https://api.samsara.com/fleet/vehicles';
  const res = await fetch(url, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || res.statusText || 'Samsara vehicles request failed');
  }
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map(v => {
    const id = String(v?.id ?? v?.vehicleId ?? v?.ids?.samsaraId ?? '');
    const name = String(v?.name || v?.make || '').trim() || id;
    return {
      id,
      name,
      vin: v?.vin ? String(v.vin) : '',
      licensePlate: v?.licensePlate ? String(v.licensePlate) : ''
    };
  });
}

/** @param {Record<string, unknown>} d */
export function normalizeSamsaraDriver(d) {
  if (!d || typeof d !== 'object') return null;
  const id = String(d.id ?? '').trim();
  if (!id) return null;
  const name = String(d.name || '').trim() || String(d.username || '').trim() || id;
  return {
    id,
    name,
    username: String(d.username || '').trim(),
    phone: String(d.phone || '').trim(),
    licenseNumber: String(d.licenseNumber || '').trim(),
    licenseState: String(d.licenseState || '').trim(),
    timezone: String(d.timezone || '').trim(),
    notes: String(d.notes || '').trim()
  };
}

/**
 * Paginated driver list (read token). Optional `q` filters id / name / username (case-insensitive).
 * @param {{ q?: string, limit?: number }} [opts]
 */
export async function fetchSamsaraDriversNormalized(opts = {}) {
  if (!SAMSARA_API_TOKEN) return [];
  const qNeedle = String(opts.q || '').trim().toLowerCase();
  const maxTotal = Math.min(500, Math.max(20, Number(opts.limit) || 300));
  const url = new URL('https://api.samsara.com/fleet/drivers');
  url.searchParams.set('limit', String(Math.min(512, maxTotal + 50)));
  const res = await fetch(url.toString(), { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || res.statusText || 'Samsara drivers request failed');
  }
  const rows = Array.isArray(data?.data) ? data.data : [];
  const out = [];
  for (const raw of rows) {
    const n = normalizeSamsaraDriver(raw);
    if (!n) continue;
    if (
      !qNeedle ||
      n.id.toLowerCase().includes(qNeedle) ||
      n.name.toLowerCase().includes(qNeedle) ||
      (n.username && n.username.toLowerCase().includes(qNeedle))
    ) {
      out.push(n);
    }
  }
  return out.slice(0, maxTotal);
}

/** @param {string} driverId */
export async function fetchSamsaraDriverById(driverId) {
  if (!SAMSARA_API_TOKEN) throw new Error('SAMSARA_API_TOKEN is not set');
  const id = String(driverId || '').trim();
  if (!id) throw new Error('driver id is required');
  const url = `https://api.samsara.com/fleet/drivers/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const listed = await fetchSamsaraDriversNormalized({ q: id, limit: 80 });
    const hit = listed.find(d => d.id === id);
    if (hit) return hit;
    throw new Error(data?.message || data?.error || res.statusText || 'Samsara driver not found');
  }
  const raw = data?.data ?? data;
  const n = normalizeSamsaraDriver(raw);
  if (!n) throw new Error('Samsara driver payload was empty');
  return n;
}
