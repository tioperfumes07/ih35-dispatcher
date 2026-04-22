/**
 * Read-only Samsara calls for integrity / telematics cross-reference.
 * Uses `samsaraGetJson` / `samsaraPaginate` from `samsara-report-fetch.mjs` (same token as reports).
 */

import { hasSamsaraReadToken, samsaraGetJson, samsaraPaginate } from './samsara-report-fetch.mjs';

export { hasSamsaraReadToken };

function isoStart(d) {
  const s = String(d || '').trim();
  if (!s) return new Date(Date.now() - 30 * 86400000).toISOString();
  return `${s.slice(0, 10)}T00:00:00.000Z`;
}

function isoEnd(d) {
  const s = String(d || '').trim();
  if (!s) return new Date().toISOString();
  return `${s.slice(0, 10)}T23:59:59.999Z`;
}

/** Best-effort meters → miles */
export function metersToMiles(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 0.000621371 * 10) / 10;
}

/** Sum trip distance in miles for trips array */
export function sumTripMiles(trips) {
  let m = 0;
  for (const t of trips || []) {
    const dm = Number(t?.distanceMeters ?? t?.distance?.meters ?? 0);
    if (Number.isFinite(dm)) m += dm;
  }
  return metersToMiles(m) ?? 0;
}

/** Unassigned trip miles (no driver id on trip) */
export function sumUnassignedTripMiles(trips) {
  let m = 0;
  for (const t of trips || []) {
    const did = t?.driver?.id ?? t?.driverId ?? t?.driver?.driverId;
    if (did) continue;
    const dm = Number(t?.distanceMeters ?? t?.distance?.meters ?? 0);
    if (Number.isFinite(dm)) m += dm;
  }
  return metersToMiles(m) ?? 0;
}

/**
 * Parse /fleet/vehicles/stats/history payload into { dates: string[], values: number[] }.
 * Tolerates multiple Samsara response shapes.
 */
export function parseStatsHistorySeries(payload, valueKeys = ['value']) {
  const dates = [];
  const values = [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const t = String(row?.time || row?.startTime || row?.endTime || '').slice(0, 10);
    let v = null;
    for (const k of valueKeys) {
      const block = row?.[k];
      const inner = block && typeof block === 'object' ? block.value ?? block.meters ?? block.seconds : block;
      const n = Number(inner);
      if (Number.isFinite(n)) {
        v = n;
        break;
      }
    }
    if (t && v != null) {
      dates.push(t);
      values.push(v);
    }
  }
  return { dates, values };
}

export async function fetchVehicleStatsHistory(vehicleId, startIso, endIso, typesCsv) {
  if (!hasSamsaraReadToken()) throw Object.assign(new Error('NO_SAMSARA_TOKEN'), { code: 'NO_SAMSARA_TOKEN' });
  return samsaraGetJson('/fleet/vehicles/stats/history', {
    vehicleIds: String(vehicleId),
    startTime: startIso,
    endTime: endIso,
    types: typesCsv
  });
}

export async function fetchVehicleTripsWindow(vehicleId, startIso, endIso) {
  if (!hasSamsaraReadToken()) return [];
  try {
    return await samsaraPaginate(
      '/fleet/trips',
      { vehicleIds: String(vehicleId), startTime: startIso, endTime: endIso },
      { maxPages: 10, limit: 200 }
    );
  } catch {
    return [];
  }
}

export async function fetchSafetyEventsWindow({ startDate, endDate, vehicleId }) {
  if (!hasSamsaraReadToken()) return [];
  const startTime = isoStart(startDate);
  const endTime = isoEnd(endDate);
  try {
    const base = { startTime, endTime };
    if (vehicleId) base.vehicleIds = String(vehicleId);
    return await samsaraPaginate('/fleet/safety/events', base, { maxPages: 8, limit: 200 });
  } catch {
    return [];
  }
}

export function categorizeSafetyBehavior(ev) {
  const beh = String(ev?.behaviorLabel || ev?.behaviorType || ev?.type || '').toLowerCase();
  return {
    harshBrake: beh.includes('brake') || beh.includes('braking'),
    harshAccel: beh.includes('accel'),
    speeding: beh.includes('speed'),
    distracted: beh.includes('distract') || beh.includes('phone') || beh.includes('mobile'),
    collisionRisk: beh.includes('collision') || beh.includes('tailg') || beh.includes('following') || beh.includes('risk')
  };
}

export function summarizeSafetyEvents(events, unitNameNorm) {
  const uwant = String(unitNameNorm || '').trim().toLowerCase();
  const out = {
    harshBrake: 0,
    harshAccel: 0,
    speeding: 0,
    distracted: 0,
    collisionRisk: 0,
    byDriver: {}
  };
  for (const ev of events || []) {
    const veh = String(ev?.vehicle?.name || '').trim().toLowerCase();
    if (uwant && veh !== uwant) continue;
    const c = categorizeSafetyBehavior(ev);
    if (c.harshBrake) out.harshBrake++;
    if (c.harshAccel) out.harshAccel++;
    if (c.speeding) out.speeding++;
    if (c.distracted) out.distracted++;
    if (c.collisionRisk) out.collisionRisk++;
    const dn = String(ev?.driver?.name || ev?.driverName || '').trim() || 'Unknown';
    if (!out.byDriver[dn]) {
      out.byDriver[dn] = { harshBrake: 0, harshAccel: 0, speeding: 0, distracted: 0, collisionRisk: 0 };
    }
    if (c.harshBrake) out.byDriver[dn].harshBrake++;
    if (c.harshAccel) out.byDriver[dn].harshAccel++;
    if (c.speeding) out.byDriver[dn].speeding++;
    if (c.distracted) out.byDriver[dn].distracted++;
    if (c.collisionRisk) out.byDriver[dn].collisionRisk++;
  }
  return out;
}

/** Extract fault-like codes from a vehicles/stats row */
export function extractFaultCodesFromStatsRow(row) {
  const out = [];
  const candidates = [
    row?.faultCodes,
    row?.diagnosticTroubleCodes,
    row?.dtcs,
    row?.obdDiagnosticTroubleCodes
  ];
  for (const block of candidates) {
    const arr = Array.isArray(block) ? block : Array.isArray(block?.dtcs) ? block.dtcs : null;
    if (!arr) continue;
    for (const x of arr) {
      const code = String(x?.code || x?.dtc || x?.id || '').trim();
      const desc = String(x?.description || x?.label || '').trim();
      if (code) out.push({ code, description: desc, severity: String(x?.severity || x?.priority || '').trim() });
    }
  }
  return out;
}

/**
 * Snapshot stats for one vehicle (engine seconds + faults) — max 4 types per Samsara request; split if needed.
 */
export async function fetchVehicleStatsSupplement(vehicleId) {
  if (!hasSamsaraReadToken()) return { engineSeconds: null, faultCodes: [] };
  const vid = String(vehicleId || '').trim();
  if (!vid) return { engineSeconds: null, faultCodes: [] };
  let engineSeconds = null;
  let faultCodes = [];
  try {
    const p1 = await samsaraGetJson('/fleet/vehicles/stats', {
      types: 'engineSeconds,faultCodes',
      vehicleIds: vid
    });
    const rows = Array.isArray(p1?.data) ? p1.data : [];
    const row = rows[0] || {};
    const es = row?.engineSeconds?.value ?? row?.engineSeconds;
    const n = Number(es);
    if (Number.isFinite(n)) engineSeconds = n;
    faultCodes = extractFaultCodesFromStatsRow(row);
  } catch {
    /* fault type may be unavailable for token/org */
  }
  return { engineSeconds, faultCodes };
}

export function dailyLastPointsFromHistory(dates, values, transformValue) {
  const byDay = new Map();
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    let v = values[i];
    if (typeof transformValue === 'function') v = transformValue(v, i);
    if (!d || v == null || !Number.isFinite(Number(v))) continue;
    byDay.set(d, Number(v));
  }
  return byDay;
}
