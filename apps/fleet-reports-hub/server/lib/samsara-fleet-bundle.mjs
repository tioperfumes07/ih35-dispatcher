/**
 * Fleet-wide Samsara fetch: per vehicle bundle (90d odometer, engine hours,
 * faults, safety, trips, idle). Uses existing samsara-integrity-fetch helpers.
 */
import { fetchSamsaraVehiclesNormalized } from './samsara-client.mjs';
import {
  fetchVehicleStatsHistory,
  fetchVehicleTripsWindow,
  fetchSafetyEventsWindow,
  fetchVehicleStatsSupplement,
  parseStatsHistorySeries,
  sumTripMiles,
  sumUnassignedTripMiles,
  summarizeSafetyEvents,
  metersToMiles,
  hasSamsaraReadToken,
} from './samsara-integrity-fetch.mjs';

function tripMilesByDay(trips) {
  const by = {};
  for (const t of trips || []) {
    const st = String(t.startTime || t.startMs || '').slice(0, 10);
    if (!st) continue;
    const dm = Number(t.distanceMeters || 0);
    if (!Number.isFinite(dm)) continue;
    by[st] = (by[st] || 0) + (metersToMiles(dm) || 0);
  }
  return by;
}

function rolling7dMilesWithoutFuel(erp, tripByDay, unit) {
  const u = String(unit || '').trim();
  const days = Object.keys(tripByDay || {})
    .sort()
    .slice(-14);
  let maxGap = 0;
  for (let i = 0; i <= days.length - 7; i++) {
    const window = days.slice(i, i + 7);
    let miles = 0;
    for (const d of window) miles += Number(tripByDay[d] || 0);
    const start = window[0];
    const end = window[6];
    let gal = 0;
    for (const p of erp.fuelPurchases || []) {
      if (String(p.unit || '').trim() !== u) continue;
      const d = String(p.txnDate || '').slice(0, 10);
      if (!d || d < start || d > end) continue;
      gal += Number(p.gallons) || 0;
    }
    if (miles > 500 && gal < 1) maxGap = Math.max(maxGap, miles);
  }
  return maxGap;
}

/**
 * Deep per-vehicle stats (90 day window for telematics series & trips/safety).
 */
export async function buildFleetUnitBundle(erp, unitName, vehicleId) {
  const now = Date.now();
  const endIso = new Date().toISOString();
  const start90 = new Date(now - 90 * 86400000).toISOString();
  const start30 = new Date(now - 30 * 86400000).toISOString();
  const start7 = new Date(now - 7 * 86400000).toISOString();

  let odoHist = { dates: [], values: [] };
  let engHist = { dates: [], values: [] };
  let idleHist = { dates: [], values: [] };
  try {
    const pOdo = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'obdOdometerMeters');
    odoHist = parseStatsHistorySeries(pOdo, ['obdOdometerMeters', 'gpsOdometerMeters']);
  } catch {
    /* optional */
  }
  try {
    const pE = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'engineSeconds');
    engHist = parseStatsHistorySeries(pE, ['engineSeconds']);
  } catch {
    /* optional */
  }
  try {
    const pI = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'idleEngineSeconds');
    idleHist = parseStatsHistorySeries(pI, ['idleEngineSeconds']);
  } catch {
    try {
      const pI2 = await fetchVehicleStatsHistory(vehicleId, start90, endIso, 'idlingDurationMilliseconds');
      idleHist = parseStatsHistorySeries(pI2, ['idlingDurationMilliseconds']);
    } catch {
      /* optional */
    }
  }

  let trips90 = [];
  let trips30 = [];
  let trips7 = [];
  try {
    trips90 = await fetchVehicleTripsWindow(vehicleId, start90, endIso);
    trips30 = await fetchVehicleTripsWindow(vehicleId, start30, endIso);
    trips7 = await fetchVehicleTripsWindow(vehicleId, start7, endIso);
  } catch {
    trips90 = [];
    trips30 = [];
    trips7 = [];
  }

  const tripByDay = tripMilesByDay(trips90);
  const tripMiles90d = sumTripMiles(trips90);
  const tripMiles30d = sumTripMiles(trips30);
  const tripMiles7d = sumTripMiles(trips7);
  const unassignedTripMiles90d = sumUnassignedTripMiles(trips90);

  const engFirst = engHist.values.length ? Number(engHist.values[0]) : null;
  const engLast = engHist.values.length ? Number(engHist.values[engHist.values.length - 1]) : null;
  const engineHoursDelta90d =
    engFirst != null && engLast != null ? Math.max(0, (engLast - engFirst) / 3600) : 0;

  let idleHours90d = 0;
  if (idleHist.values.length) {
    const first = Number(idleHist.values[0]) || 0;
    const last = Number(idleHist.values[idleHist.values.length - 1]) || 0;
    const raw = last - first;
    idleHours90d = raw > 1e6 ? raw / 3600000 : raw / 3600;
    if (!Number.isFinite(idleHours90d) || idleHours90d < 0) idleHours90d = 0;
  }

  const idlePercent90d =
    engineHoursDelta90d > 0.1 ? Math.min(100, (idleHours90d / engineHoursDelta90d) * 100) : 0;

  const sup = await fetchVehicleStatsSupplement(vehicleId);

  const safetyEvents = await fetchSafetyEventsWindow({
    startDate: start90.slice(0, 10),
    endDate: endIso.slice(0, 10),
    vehicleId,
  });
  const locSafety = summarizeSafetyEvents(safetyEvents, unitName);
  let topDriver = '';
  let maxEv = 0;
  for (const [dn, o] of Object.entries(locSafety.byDriver || {})) {
    const t = o.harshBrake + o.harshAccel + o.speeding + o.distracted + o.collisionRisk;
    if (t > maxEv) {
      maxEv = t;
      topDriver = dn;
    }
  }
  locSafety.topDriver = topDriver;

  const maxRolling7dMilesWithoutFuel = rolling7dMilesWithoutFuel(erp, tripByDay, unitName);

  const odoMilesLast =
    odoHist.values.length > 0 ? metersToMiles(Number(odoHist.values[odoHist.values.length - 1])) : null;

  return {
    samsaraVehicleId: String(vehicleId),
    unitName: String(unitName),
    tripMiles90d,
    tripMiles7d,
    tripMiles30d,
    unassignedTripMiles90d,
    engineHoursDelta90d,
    idleHours90d,
    idlePercent90d,
    engineHoursTotal: sup.engineSeconds != null ? sup.engineSeconds / 3600 : null,
    faultCodes: sup.faultCodes || [],
    odometerHistory90d: odoHist.dates.map((d, i) => ({ date: d, meters: odoHist.values[i] })),
    engineHistory90d: engHist.dates.map((d, i) => ({ date: d, engineSeconds: engHist.values[i] })),
    idleByDay90d: idleHist.dates.map((d, i) => ({ date: d, value: idleHist.values[i] })),
    tripMilesByDay: tripByDay,
    safetyEventsCount: (safetyEvents || []).length,
    safetyLocal: locSafety,
    maxRolling7dMilesWithoutFuel,
    odometerMilesSamsara: odoMilesLast,
    safetyEventsSample: (safetyEvents || []).slice(0, 8),
  };
}

const TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

export function fleetCacheTtlMs() {
  return TTL_MS;
}

export async function getOrRefreshFleetBundle(erp, force = false) {
  if (!force && cache.data && Date.now() - cache.at < TTL_MS) {
    return { ...cache.data, fromCache: true, cacheAgeMs: Date.now() - cache.at };
  }
  if (!hasSamsaraReadToken()) {
    cache = { at: Date.now(), data: { refreshedAt: new Date().toISOString(), vehicles: [], units: {}, noToken: true } };
    return { ...cache.data, fromCache: false };
  }
  const vehicles = await fetchSamsaraVehiclesNormalized();
  const units = {};
  for (const v of vehicles) {
    const name = String(v.name || '').trim();
    const vid = String(v.id || '').trim();
    if (!name || !vid) continue;
    try {
      units[name] = await buildFleetUnitBundle(erp, name, vid);
    } catch {
      units[name] = { unitName: name, samsaraVehicleId: vid, error: 'fetch_failed' };
    }
  }
  const data = { refreshedAt: new Date().toISOString(), vehicles, units };
  cache = { at: Date.now(), data };
  return { ...data, fromCache: false, cacheAgeMs: 0 };
}

export function invalidateFleetCache() {
  cache = { at: 0, data: null };
}
