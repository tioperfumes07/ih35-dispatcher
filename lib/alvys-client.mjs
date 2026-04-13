/**
 * Alvys Public API — Bearer JWT. Docs: https://docs.alvys.com
 * Default host: https://integrations.alvys.com
 */

const DEFAULT_BASE = 'https://integrations.alvys.com';

export function alvysConfigured() {
  return !!(String(process.env.ALVYS_API_TOKEN || '').trim());
}

function baseUrl() {
  return String(process.env.ALVYS_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function apiVersion() {
  return String(process.env.ALVYS_API_VERSION || '1').replace(/^v/i, '');
}

export async function alvysFetchJson(path, { method = 'GET', body } = {}) {
  const token = String(process.env.ALVYS_API_TOKEN || '').trim();
  if (!token) throw new Error('ALVYS_API_TOKEN is not set');

  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw: raw.slice(0, 500) };
  }
  if (!res.ok) {
    const msg = data?.title || data?.detail || data?.message || res.statusText || 'Alvys request failed';
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/** Search drivers (active). Uses POST /api/p/v{version}/drivers/search */
export async function alvysSearchDrivers(opts = {}) {
  const v = apiVersion();
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 25));
  const body = {
    page: Number(opts.page) || 0,
    pageSize,
    isActive: opts.isActive !== false,
    status:
      Array.isArray(opts.status) && opts.status.length
        ? opts.status
        : ['DRIVING', 'ON DUTY', 'OFF DUTY', 'SLEEPING', 'ONLINE', 'OFFLINE'],
    name: opts.name || null,
    employeeId: opts.employeeId || null,
    fleetName: opts.fleetName || null
  };
  return alvysFetchJson(`/api/p/v${v}/drivers/search`, { method: 'POST', body });
}
