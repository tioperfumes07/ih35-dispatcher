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

/**
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   vin?: string,
 *   licensePlate?: string,
 *   vehicleType?: string,
 *   make?: string,
 *   model?: string,
 *   year?: number | null,
 *   odometerMiles?: number | null
 * }>>}
 */
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
    const vehicleType = String(
      v?.vehicleType || v?.type || v?.attributes?.vehicleType || v?.staticAssignedVehicle?.vehicleType || '',
    ).trim();
    const make = v?.make != null ? String(v.make).trim() : '';
    const model = v?.model != null ? String(v.model).trim() : '';
    let year = null;
    if (typeof v?.year === 'number' && Number.isFinite(v.year)) year = Math.trunc(v.year);
    else if (v?.year != null && String(v.year).trim() !== '') {
      const y = Number(v.year);
      if (Number.isFinite(y)) year = Math.trunc(y);
    }
    let odometerMiles = null;
    const m =
      typeof v?.odometerMeters === 'number'
        ? v.odometerMeters
        : typeof v?.gateway?.odata?.odometerMeters === 'number'
          ? v.gateway.odata.odometerMeters
          : null;
    if (typeof m === 'number' && Number.isFinite(m)) {
      odometerMiles = Math.max(0, Math.round(m / 1609.344));
    }
    return {
      id,
      name,
      vin: v?.vin ? String(v.vin) : '',
      licensePlate: v?.licensePlate ? String(v.licensePlate) : '',
      vehicleType,
      make,
      model,
      year,
      odometerMiles,
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
/**
 * PATCH driver display name (partial update).
 * @param {string} driverId
 * @param {string} name
 * @returns {Promise<{ ok: boolean, mock?: boolean, status: number, detail: string }>}
 */
export async function patchSamsaraDriverName(driverId, name) {
  const id = String(driverId || '').trim();
  const next = String(name || '').trim();
  if (!id || !next) {
    return { ok: false, status: 400, detail: 'driver id and name are required' };
  }
  if (!SAMSARA_API_TOKEN) {
    return {
      ok: true,
      mock: true,
      status: 200,
      detail: 'SAMSARA_API_TOKEN not set — simulated PATCH /fleet/drivers/{id}',
    };
  }
  const url = `https://api.samsara.com/fleet/drivers/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: next }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      detail: String(data?.message || data?.error || res.statusText || 'PATCH failed'),
    };
  }
  return { ok: true, status: res.status, detail: 'Samsara driver name updated' };
}

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
