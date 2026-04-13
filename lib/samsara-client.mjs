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
