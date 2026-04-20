/**
 * Samsara IFTA — GET /fleet/reports/ifta/vehicle (requires "Read IFTA (US)" on the API token).
 * https://developers.samsara.com/reference/getiftavehiclereports
 */

const SAMSARA_IFTA_BASE = 'https://api.samsara.com/fleet/reports/ifta/vehicle';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function parseYmd(s) {
  const t = String(s || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Default window: previous full calendar month when dates missing. */
export function defaultIftaDateRange() {
  const end = new Date();
  end.setUTCDate(1);
  end.setUTCHours(12, 0, 0, 0);
  end.setUTCMonth(end.getUTCMonth() - 1);
  const last = new Date(end.getFullYear(), end.getUTCMonth() + 1, 0);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: last.toISOString().slice(0, 10)
  };
}

/**
 * List { year, month } for each calendar month intersecting [startDate, endDate] (inclusive, UTC noon math).
 * @param {string} startDateStr
 * @param {string} endDateStr
 */
export function listIftaMonthsBetween(startDateStr, endDateStr) {
  const def = defaultIftaDateRange();
  const start = parseYmd(startDateStr) || parseYmd(def.startDate);
  const end = parseYmd(endDateStr) || parseYmd(def.endDate);
  if (!start || !end || end < start) return [];

  const out = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12, 0, 0, 0));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 12, 0, 0, 0));
  while (cur <= endMonth) {
    out.push({
      year: cur.getUTCFullYear(),
      month: MONTH_NAMES[cur.getUTCMonth()]
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message || body?.error || `Samsara IFTA HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = body;
    throw err;
  }
  return body;
}

/**
 * Fetch one calendar month, all pages, aggregate jurisdictions across vehicles.
 * @param {{ year: number, month: string, vehicleIdsCsv?: string }} opts
 */
export async function fetchSamsaraIftaVehicleMonth(opts) {
  const token = String(process.env.SAMSARA_API_TOKEN || '').trim();
  if (!token) {
    return { ok: false, error: 'SAMSARA_API_TOKEN is not set', byJurisdiction: {}, troubleshooting: null };
  }

  const { year, month, vehicleIdsCsv } = opts;
  const byJurisdiction = new Map();
  let troubleshooting = null;
  let after = '';

  try {
    do {
      const u = new URL(SAMSARA_IFTA_BASE);
      u.searchParams.set('year', String(year));
      u.searchParams.set('month', month);
      if (vehicleIdsCsv) u.searchParams.set('vehicleIds', vehicleIdsCsv);
      if (after) u.searchParams.set('after', after);

      const body = await fetchJson(u.toString(), {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      });

      const data = body.data || {};
      troubleshooting = data.troubleshooting || troubleshooting;

      for (const vr of data.vehicleReports || []) {
        for (const j of vr.jurisdictions || []) {
          const code = String(j.jurisdiction || '').trim();
          if (!code) continue;
          const cur = byJurisdiction.get(code) || { taxableMeters: 0, totalMeters: 0, taxPaidLiters: 0 };
          cur.taxableMeters += Number(j.taxableMeters) || 0;
          cur.totalMeters += Number(j.totalMeters) || 0;
          cur.taxPaidLiters += Number(j.taxPaidLiters) || 0;
          byJurisdiction.set(code, cur);
        }
      }

      const pag = body.pagination || {};
      after = pag.hasNextPage && pag.endCursor ? String(pag.endCursor) : '';
    } while (after);

    return {
      ok: true,
      year,
      month,
      byJurisdiction: Object.fromEntries(byJurisdiction),
      troubleshooting
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      year,
      month,
      byJurisdiction: {},
      troubleshooting
    };
  }
}

/**
 * Aggregate IFTA across each month in range (max 6 months per request to protect rate limits).
 */
export async function fetchSamsaraIftaAggregatedForRange({ startDate, endDate, vehicleIdsCsv }) {
  const months = listIftaMonthsBetween(startDate, endDate);
  if (!months.length) {
    return {
      ok: false,
      error: 'Invalid or empty date range for IFTA',
      byJurisdiction: {},
      monthsFetched: [],
      errors: []
    };
  }

  const capped = months.slice(0, 6);
  const merged = new Map();
  const errors = [];
  const monthsFetched = [];

  for (const m of capped) {
    const r = await fetchSamsaraIftaVehicleMonth({ year: m.year, month: m.month, vehicleIdsCsv });
    monthsFetched.push(`${m.year}-${m.month}`);
    if (!r.ok) {
      errors.push(`${m.year} ${m.month}: ${r.error || 'unknown error'}`);
      continue;
    }
    for (const [code, v] of Object.entries(r.byJurisdiction || {})) {
      const cur = merged.get(code) || { taxableMeters: 0, totalMeters: 0, taxPaidLiters: 0 };
      cur.taxableMeters += Number(v.taxableMeters) || 0;
      cur.totalMeters += Number(v.totalMeters) || 0;
      cur.taxPaidLiters += Number(v.taxPaidLiters) || 0;
      merged.set(code, cur);
    }
  }

  return {
    ok: errors.length === 0 || merged.size > 0,
    byJurisdiction: Object.fromEntries(merged),
    monthsFetched,
    errors,
    troubleshooting: null,
    truncated: months.length > capped.length
  };
}
