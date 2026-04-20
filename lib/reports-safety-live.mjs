/**
 * Live Samsara-backed rows for safety reports (read-only GET use).
 */

import { hasSamsaraReadToken, samsaraGetJson, samsaraPaginate } from './samsara-report-fetch.mjs';

function toIsoStart(s) {
  const d = String(s || '').trim();
  if (!d) return new Date(Date.now() - 7 * 86400000).toISOString();
  return `${d.slice(0, 10)}T00:00:00.000Z`;
}

function toIsoEnd(s) {
  const d = String(s || '').trim();
  if (!d) return new Date().toISOString();
  return `${d.slice(0, 10)}T23:59:59.999Z`;
}

export async function buildHosViolationsRows(query) {
  if (!hasSamsaraReadToken()) {
    return { rows: [], error: 'Samsara token not configured.' };
  }
  const startTime = toIsoStart(query.startDate);
  const endTime = toIsoEnd(query.endDate);
  const driverId = String(query.driverId || '').trim();
  const vType = String(query.violationType || '').trim().toLowerCase();
  try {
    const base = { startTime, endTime };
    if (driverId) base.driverIds = driverId;
    const data = await samsaraPaginate('/fleet/hos/violations', base, { maxPages: 6, limit: 200 });
    const rows = [];
    for (const v of data) {
      const type = String(v.violationType || v.type || '').trim();
      if (vType && !type.toLowerCase().includes(vType)) continue;
      rows.push({
        date: String(v.violationStartTime || v.startTime || '').slice(0, 19).replace('T', ' '),
        driver: v.driver?.name || v.driverName || v.driver?.id || '—',
        unit: v.vehicle?.name || v.vehicleName || '',
        violation_type: type || '—',
        hours_over: v.hoursOver != null ? String(v.hoursOver) : '',
        location: v.location?.formattedLocation || v.location || '',
        severity: String(v.severity || v.violationSeverity || '')
      });
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { rows };
  } catch (e) {
    return { rows: [], error: e.message || String(e) };
  }
}

export async function buildDvirRows(query) {
  if (!hasSamsaraReadToken()) {
    return { rows: [], error: 'Samsara token not configured.' };
  }
  const startTime = toIsoStart(query.startDate);
  const endTime = toIsoEnd(query.endDate);
  const unit = String(query.unit || '').trim().toLowerCase();
  const driverId = String(query.driverId || '').trim();
  const hasDef = String(query.hasDefects || '').trim().toLowerCase();
  try {
    const base = { startTime, endTime };
    if (driverId) base.driverIds = driverId;
    const data = await samsaraPaginate('/fleet/dvirs/history', base, { maxPages: 5, limit: 100 });
    const rows = [];
    for (const d of data) {
      const vehName = String(d.vehicle?.name || d.vehicleName || '').trim();
      if (unit && vehName.toLowerCase() !== unit) continue;
      const defects = Array.isArray(d.defects) ? d.defects : d.defectIds ? [] : [];
      const hasDefects = defects.length > 0 || Boolean(d.hasDefects);
      if (hasDef === 'true' && !hasDefects) continue;
      if (hasDef === 'false' && hasDefects) continue;
      const desc =
        defects
          .map(x => x?.defectType || x?.type || x?.description)
          .filter(Boolean)
          .join('; ') || '';
      rows.push({
        date: String(d.createdAtTime || d.time || d.inspectionStartedAt || '').slice(0, 19).replace('T', ' '),
        driver: d.driver?.name || d.driverName || '',
        unit: vehName,
        type: d.inspectionType || d.type || d.reportType || '',
        defects_found: hasDefects ? 'Y' : 'N',
        defect_description: desc,
        corrected: d.isResolved || d.resolvedAt ? 'Y' : 'N',
        mechanic: d.mechanic?.name || d.mechanicName || '',
        signoff_date: String(d.driverSignedAt || d.signedAt || '').slice(0, 10)
      });
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { rows };
  } catch (e) {
    return { rows: [], error: e.message || String(e) };
  }
}

export async function buildSafetyEventsRows(query, kinds /* 'speed' | 'harsh' | 'all' */) {
  if (!hasSamsaraReadToken()) {
    return { rows: [], error: 'Samsara token not configured.' };
  }
  const startTime = toIsoStart(query.startDate);
  const endTime = toIsoEnd(query.endDate);
  const driverId = String(query.driverId || '').trim();
  const unit = String(query.unit || '').trim().toLowerCase();
  const eventTypeQ = String(query.eventType || '').trim().toLowerCase();
  const threshold = Number(query.speedThreshold);
  try {
    const base = { startTime, endTime };
    if (driverId) base.driverIds = driverId;
    const data = await samsaraPaginate('/fleet/safety/events', base, { maxPages: 6, limit: 200 });
    const rows = [];
    for (const ev of data) {
      const beh = String(ev.behaviorLabel || ev.behaviorType || ev.type || '').toLowerCase();
      const isSpeed = beh.includes('speed');
      const isHarsh =
        beh.includes('brake') || beh.includes('accel') || beh.includes('turn') || beh.includes('harsh');
      if (kinds === 'speed' && !isSpeed) continue;
      if (kinds === 'harsh' && !isHarsh) continue;
      if (eventTypeQ && !beh.includes(eventTypeQ)) continue;
      const veh = String(ev.vehicle?.name || '').trim();
      if (unit && veh.toLowerCase() !== unit) continue;
      const posted = ev.speedLimitMph ?? ev.postedSpeedMph ?? '';
      const actual = ev.speedMph ?? ev.maxSpeedMph ?? '';
      let pct = '';
      if (Number.isFinite(Number(posted)) && Number(posted) > 0 && Number.isFinite(Number(actual))) {
        const n = Number(actual);
        const d = Number(posted);
        pct = `${(Math.round(((n - d) / d) * 1000) / 10).toFixed(1)}%`;
      }
      if (kinds === 'speed' && Number.isFinite(threshold) && threshold > 0) {
        const over = Number(actual) - Number(posted);
        if (!Number.isFinite(over) || over < threshold) continue;
      }
      rows.push({
        datetime: String(ev.time || ev.startTime || '').slice(0, 19).replace('T', ' '),
        driver: ev.driver?.name || '',
        unit: veh,
        event_type: beh || 'event',
        severity: String(ev.severity || ev.coachingState || ''),
        location: ev.location?.formattedLocation || '',
        speed: actual !== '' ? String(actual) : '',
        posted_speed: posted !== '' ? String(posted) : '',
        duration_seconds: ev.durationMs != null ? String(Math.round(ev.durationMs / 1000)) : '',
        pct_over_limit: pct
      });
    }
    rows.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
    return { rows };
  } catch (e) {
    return { rows: [], error: e.message || String(e) };
  }
}

/** Aggregate HOS logs into rough hour buckets per driver (best-effort; Samsara returns segments). */
export async function buildHosSummaryFromLogs(query) {
  if (!hasSamsaraReadToken()) {
    return { rows: [], error: 'Samsara token not configured.' };
  }
  const startTime = toIsoStart(query.startDate);
  const endTime = toIsoEnd(query.endDate);
  const driverId = String(query.driverId || '').trim();
  try {
    const base = { startTime, endTime };
    if (driverId) base.driverIds = driverId;
    const logs = await samsaraPaginate('/fleet/hos/logs', base, { maxPages: 8, limit: 200 });
    const byDriver = {};
    for (const log of logs) {
      const name = log.driver?.name || log.driverName || log.driver?.id || '—';
      if (!byDriver[name]) {
        byDriver[name] = { driver: name, drivingMs: 0, onDutyMs: 0, offDutyMs: 0, sleeperMs: 0, violations: 0, lastVio: '' };
      }
      const st = String(log.hosStatusType || log.statusType || '').toLowerCase();
      const start = new Date(log.logStartTime || log.startTime).getTime();
      const end = new Date(log.logEndTime || log.endTime || endTime).getTime();
      const dur = Math.max(0, end - start);
      if (st.includes('driv')) byDriver[name].drivingMs += dur;
      else if (st.includes('sleep')) byDriver[name].sleeperMs += dur;
      else if (st.includes('off')) byDriver[name].offDutyMs += dur;
      else byDriver[name].onDutyMs += dur;
    }
    const vioCount = {};
    const vioLastDate = {};
    try {
      const vios = await samsaraPaginate('/fleet/hos/violations', { startTime, endTime }, { maxPages: 3, limit: 200 });
      for (const v of vios) {
        const name = v.driver?.name || v.driverName || v.driver?.id || '—';
        vioCount[name] = (vioCount[name] || 0) + 1;
        const t = String(v.violationStartTime || '').slice(0, 10);
        if (t && t > (vioLastDate[name] || '')) vioLastDate[name] = t;
      }
    } catch (_) {
      /* violations optional */
    }
    const rows = Object.values(byDriver).map(x => ({
      driver: x.driver,
      total_hours_driven: (x.drivingMs / 3600000).toFixed(2),
      total_on_duty: (x.onDutyMs / 3600000).toFixed(2),
      total_off_duty: (x.offDutyMs / 3600000).toFixed(2),
      total_sleeper: (x.sleeperMs / 3600000).toFixed(2),
      violations_count: vioCount[x.driver] || 0,
      last_violation_date: vioLastDate[x.driver] || ''
    }));
    rows.sort((a, b) => String(a.driver).localeCompare(String(b.driver)));
    return { rows };
  } catch (e) {
    return { rows: [], error: e.message || String(e) };
  }
}

export async function buildSafetyScoresPlaceholder(query) {
  if (!hasSamsaraReadToken()) {
    return { rows: [], error: 'Samsara token not configured.' };
  }
  try {
    await samsaraGetJson('/fleet/drivers', { limit: '1' });
  } catch (e) {
    return { rows: [], error: e.message || String(e) };
  }
  return {
    rows: [],
    disclaimer:
      'Samsara safety score time-series requires the Safety Scores API (org/driver scope). Token is valid; extend mapping when your account exposes those endpoints.'
  };
}
