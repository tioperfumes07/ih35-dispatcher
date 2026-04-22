/**
 * Read-only Samsara REST helpers for reports (same base URL + bearer as server.js).
 */

const BASE = 'https://api.samsara.com';

export function hasSamsaraReadToken() {
  return Boolean(String(process.env.SAMSARA_API_TOKEN || '').trim());
}

export async function samsaraGetJson(pathRel, searchParams = {}) {
  const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
  if (!token) {
    const e = new Error('Samsara API token not configured (SAMSARA_API_TOKEN).');
    e.code = 'NO_SAMSARA_TOKEN';
    throw e;
  }
  const path = pathRel.startsWith('/') ? pathRel : `/${pathRel}`;
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(searchParams)) {
    if (v == null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg =
      data?.message || data?.error || data?.errors?.[0]?.message || res.statusText || 'Samsara request failed';
    const err = new Error(msg);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

/** Paginate Samsara list endpoints that return { data, pagination } */
export async function samsaraPaginate(pathRel, baseParams, { maxPages = 8, limit = 200 } = {}) {
  const out = [];
  let after = '';
  for (let p = 0; p < maxPages; p++) {
    const params = { ...baseParams, limit: String(limit) };
    if (after) params.after = after;
    const chunk = await samsaraGetJson(pathRel, params);
    const rows = Array.isArray(chunk?.data) ? chunk.data : [];
    out.push(...rows);
    const pag = chunk?.pagination || {};
    if (!pag.hasNextPage || !rows.length) break;
    after = pag.endCursor || '';
    if (!after) break;
  }
  return out;
}
