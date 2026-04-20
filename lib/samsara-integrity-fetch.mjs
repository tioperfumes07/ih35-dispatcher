/**
 * Read-only Samsara fetches for integrity / telematics cross-reference.
 * Reuses bearer + base URL from `samsara-report-fetch.mjs` (same token as reports / server).
 */

import { hasSamsaraReadToken, samsaraGetJson, samsaraPaginate } from './samsara-report-fetch.mjs';

const SAFETY_PATHS = ['/fleet/safety/events', '/fleet/safety-events'];

/** @param {unknown} row */
function statValueAtTime(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    const last = obj[obj.length - 1];
    if (last && typeof last === 'object') {
      return {
        time: String(last.time || last.timestamp || ''),
        value: last.value != null ? Number(last.value) : last.meters != null ? Number(last.meters) : null
      };
    }
    return null;
  }
  const time = String(obj.time || obj.timestamp || '');
  const value =
    obj.value != null
      ? Number(obj.value)
      : obj.meters != null
        ? Number(obj.meters)
        : obj.seconds != null
          ? Number(obj.seconds)
          : null;
  if (!time && value == null) return null;
  return { time, value };
}

/**
 * Normalize /fleet/vehicles/stats/history payload into per-vehicle point arrays.
 * @param {unknown} payload
 * @param {string} statKey e.g. obdOdometerMeters, obdEngineSeconds
 */
export function parseStatsHistorySeries(payload, statKey) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const out = [];
  for (const row of rows) {
    const vid = String(row?.id ?? row?.vehicleId ?? '').trim();
    if (!vid) continue;
    const block = row?.[statKey];
    if (Array.isArray(block)) {
      for (const pt of block) {
        const t = String(pt?.time || pt?.timestamp || '').trim();
        const v =
          pt?.value != null
            ? Number(pt.value)
            : pt?.meters != null
              ? Number(pt.meters)
              : pt?.seconds != null
                ? Number(pt.seconds)
                : null;
        if (t) out.push({ vehicleId: vid, time: t, value: Number.isFinite(v) ? v : null });
      }
    } else {
      const cur = statValueAtTime(block);
      if (cur?.time) out.push({ vehicleId: vid, time: cur.time, value: cur.value });
    }
  }
  out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return out;
}

export async function fetchVehicleStatsHistory(vehicleId, startTime, endTime, types) {
  if (!hasSamsaraReadToken() || !vehicleId) return { raw: null, points: {} };
  const typesStr = String(types || 'obdOdometerMeters,obdEngineSeconds').trim();
  try {
    const raw = await samsaraGetJson('/fleet/vehicles/stats/history', {
      vehicleIds: String(vehicleId),
      types: typesStr,
      startTime: String(startTime),
      endTime: String(endTime)
    });
    const keys = typesStr.split(',').map(s => s.trim()).filter(Boolean);
    const points = {};
    for (const k of keys) {
      points[k] = parseStatsHistorySeries(raw, k);
    }
    return { raw, points };
  } catch {
    return { raw: null, points: {} };
  }
}

/** Current stats for one vehicle (fault codes + engine seconds + odometer) — second request if needed. */
export async function fetchVehicleStatsSnapshot(vehicleId, types) {
  if (!hasSamsaraReadToken() || !vehicleId) return null;
  const t = String(types || 'faultCodes,obdEngineSeconds,obdOdometerMeters').trim();
  try {
    return await samsaraGetJson('/fleet/vehicles/stats', {
      types: t,
      vehicleIds: String(vehicleId)
    });
  } catch {
    return null;
  }
}

export async function fetchSafetyEventsForVehicle(vehicleId, startTime, endTime) {
  if (!hasSamsaraReadToken() || !vehicleId) return [];
  for (const path of SAFETY_PATHS) {
    try {
      const rows = await samsaraPaginate(
        path,
        { startTime, endTime, vehicleIds: String(vehicleId) },
        { maxPages: 8, limit: 200 }
      );
      if (rows.length) return rows;
    } catch {
      /* try alternate path */
    }
  }
  return [];
}

export async function fetchTripsForVehicle(vehicleId, startTime, endTime) {
  if (!hasSamsaraReadToken() || !vehicleId) return [];
  try {
    return await samsaraPaginate(
      '/fleet/trips',
      { vehicleIds: String(vehicleId), startTime, endTime },
      { maxPages: 10, limit: 200 }
    );
  } catch {
    return [];
  }
}

/**
 * Aggregate safety events into coarse buckets for charts / checks.
 * @param {unknown[]} events
 */
export function summarizeSafetyEvents(events) {
  const out = {
    harshBrake: 0,
    harshAccel: 0,
    speeding: 0,
    distracted: 0,
    collisionRisk: 0,
    other: 0
  };
  for (const ev of events || []) {
    const labels = Array.isArray(ev?.behaviorLabels) ? ev.behaviorLabels : [];
    const primary =
      labels[0]?.label ||
      labels[0]?.name ||
      ev?.behaviorLabel ||
      ev?.behaviorType ||
      ev?.type ||
      '';
    const s = String(primary || '').toLowerCase();
    if (s.includes('speed')) out.speeding++;
    else if (s.includes('brake') || s === 'braking') out.harshBrake++;
    else if (s.includes('accel') || s === 'acceleration') out.harshAccel++;
    else if (s.includes('distract') || s.includes('mobile') || s.includes('camera')) out.distracted++;
    else if (s.includes('collision') || s.includes('tailgat') || s.includes('nearcoll')) out.collisionRisk++;
    else out.other++;
  }
  return out;
}

/** Miles from trip objects (best-effort). */
export function sumTripMeters(trips) {
  let m = 0;
  for (const tr of trips || []) {
    const d = tr?.distanceMeters ?? tr?.tripDistanceMeters ?? tr?.endOdometerMeters - tr?.startOdometerMeters;
    const n = Number(d);
    if (Number.isFinite(n) && n > 0 && n < 5e6) m += n;
  }
  return m;
}

/** Extract fault-like codes from stats snapshot row if present. */
export function extractFaultCodesFromStatsPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const faults = [];
  for (const row of rows) {
    const fc = row?.faultCodes ?? row?.faultCode ?? row?.dtcs;
    const arr = Array.isArray(fc) ? fc : fc && typeof fc === 'object' ? [fc] : [];
    for (const x of arr) {
      const code = String(x?.code || x?.dtc || x?.id || '').trim();
      const desc = String(x?.description || x?.message || '').trim();
      const sev = String(x?.severity || x?.priority || '').trim();
      if (code || desc) faults.push({ code: code || '—', description: desc, severity: sev });
    }
  }
  return faults;
}
