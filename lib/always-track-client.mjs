/**
 * All-Ways Track / similar TMS — no public API documented in-repo.
 * Supports optional REST base URL + API key for custom integrations or future vendor endpoints.
 */

export function alwaysTrackConfigured() {
  const u = String(process.env.ALWAYS_TRACK_API_BASE_URL || '').trim();
  const k = String(process.env.ALWAYS_TRACK_API_KEY || '').trim();
  return !!(u && k);
}

/** Generic GET — caller supplies path (e.g. /loads or /api/loads). */
export async function alwaysTrackGet(path) {
  const base = String(process.env.ALWAYS_TRACK_API_BASE_URL || '').replace(/\/$/, '');
  const key = String(process.env.ALWAYS_TRACK_API_KEY || '').trim();
  if (!base || !key) throw new Error('Always Track integration not configured (ALWAYS_TRACK_API_BASE_URL + ALWAYS_TRACK_API_KEY)');

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`
  };
  const res = await fetch(url, { headers });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw: raw.slice(0, 400) };
  }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}
