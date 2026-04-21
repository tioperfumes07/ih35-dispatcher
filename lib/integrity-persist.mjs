import { randomUUID } from 'crypto';
import {
  alertCategory,
  buildInvestigateRecords,
  compareIntegrityAlertsDesc,
  effectiveIntegrityAlertCategory
} from './integrity-engine.mjs';

function sliceD(s) {
  return String(s || '').slice(0, 10);
}

function daysAgoLabel(iso) {
  const d = sliceD(iso);
  if (!d) return '';
  const t = new Date(`${d}T12:00:00Z`).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.floor((Date.now() - t) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

function shortTitleForAlert(a) {
  const t = String(a.alertType || a.type || '').trim();
  if (t) return t;
  return 'Alert';
}

function dataContextLinesForAlert(a) {
  const det = a.details && typeof a.details === 'object' ? a.details : {};
  const lines = [];
  const u = a.unitId || det.unit;
  const dr = a.driverId || det.driverId;
  if (u) lines.push(`Unit: ${u}`);
  if (dr) lines.push(`Driver: ${det.driverName || dr}`);
  const rid = a.recordId || det.recordId;
  if (rid) lines.push(`Record: ${rid}`);
  return lines;
}

/** Normalize stored row for dashboard / investigate UI. */
export function enrichIntegrityAlertRow(a) {
  const alertType = String(a.alertType || a.type || '').trim();
  const trig = sliceD(a.triggeredDate || a.createdAt || '');
  const cat = effectiveIntegrityAlertCategory(a);
  return {
    ...a,
    alertType,
    type: alertType,
    category: cat,
    shortTitle: a.shortTitle || shortTitleForAlert(a),
    daysAgoLabel: a.daysAgoLabel || daysAgoLabel(trig || a.createdAt),
    dataContextLines: Array.isArray(a.dataContextLines) ? a.dataContextLines : dataContextLinesForAlert(a)
  };
}

function dedupeKeyOf(raw, ctx) {
  return String(raw.dedupeKey || `${raw.type}:${ctx.recordId || 'new'}:${sliceD(ctx.date || ctx.serviceDate)}`);
}

/**
 * Merge engine alerts into ERP.integrityAlerts (dedupe by dedupeKey).
 * If the same rule fires again on a previously reviewed alert, it is re-opened as active.
 */
export function mergeEngineAlertsIntoErp(erp, ctx, engineAlerts) {
  const incoming = Array.isArray(engineAlerts) ? engineAlerts : [];
  const list = Array.isArray(erp.integrityAlerts) ? [...erp.integrityAlerts] : [];
  const now = new Date().toISOString();
  const trig = sliceD(ctx.date || ctx.serviceDate || now);

  for (const raw of incoming) {
    const dk = dedupeKeyOf(raw, ctx);
    const idx = list.findIndex(
      x => String(x.dedupeKey || '') === dk || String(x.details?.dedupeKey || '') === dk
    );
    const cat = raw.category || alertCategory(raw.type);
    const row = {
      id: idx >= 0 && list[idx].id ? String(list[idx].id) : randomUUID(),
      alertType: raw.type,
      type: raw.type,
      shortTitle: raw.type,
      severity: raw.severity || 'AMBER',
      message: raw.message || '',
      details: { ...(raw.details || {}), dedupeKey: dk },
      dedupeKey: dk,
      triggeredDate: trig,
      createdAt: idx >= 0 ? list[idx].createdAt || now : now,
      status: 'active',
      unitId: String(ctx.unitId || ctx.unit || '').trim() || null,
      driverId: String(ctx.driverId || '').trim() || null,
      recordId: String(ctx.recordId || '').trim() || null,
      recordType: String(ctx.recordType || '').trim() || null,
      category: cat,
      notes: idx >= 0 ? list[idx].notes || '' : '',
      reviewedBy: null,
      reviewedAt: null
    };
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...row, notes: list[idx].notes || row.notes };
    } else {
      list.push(row);
    }
  }
  erp.integrityAlerts = list;
}

export function sortEnrichedAlertsDesc(rows) {
  return [...rows].sort(compareIntegrityAlertsDesc);
}

export function filterAlertsForQuery(alerts, q) {
  const start = String(q.startDate || '').trim();
  const end = String(q.endDate || '').trim();
  const cat = String(q.category || '').trim().toLowerCase();
  const sev = String(q.severity || '').trim().toUpperCase();
  const st = String(q.status || 'active').trim().toLowerCase();

  return (alerts || []).filter(a => {
    const enriched = enrichIntegrityAlertRow(a);
    const trig = sliceD(enriched.triggeredDate || enriched.createdAt);
    if (start && trig && trig < start) return false;
    if (end && trig && trig > end) return false;
    if (sev && String(enriched.severity || '').toUpperCase() !== sev) return false;
    const status = String(enriched.status || 'active').toLowerCase();
    const reviewed = status === 'reviewed' || status === 'resolved' || status === 'dismissed';
    if (st !== 'all') {
      if (st === 'active' && reviewed) return false;
      if (st === 'reviewed' && status !== 'reviewed' && status !== 'resolved') return false;
      if (st === 'dismissed' && status !== 'dismissed') return false;
    }
    if (cat && cat !== 'all') {
      const ac = String(enriched.category || '').toLowerCase();
      if (cat === 'predictive') {
        if (ac !== 'predictive' && ac !== 'samsara') return false;
      } else if (ac !== cat) {
        return false;
      }
    }
    return true;
  });
}

export function computeIntegrityKpis(allAlerts) {
  const arr = Array.isArray(allAlerts) ? allAlerts : [];
  const active = arr.filter(a => {
    const s = String(a.status || 'active').toLowerCase();
    return s !== 'reviewed' && s !== 'resolved' && s !== 'dismissed';
  });
  const red = active.filter(a => String(a.severity || '').toUpperCase() === 'RED').length;
  const amber = active.filter(a => String(a.severity || '').toUpperCase() === 'AMBER').length;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resolvedThisMonth = arr.filter(a => {
    const s = String(a.status || '').toLowerCase();
    if (s !== 'reviewed' && s !== 'resolved') return false;
    const ra = sliceD(a.reviewedAt || a.triggeredDate || '');
    return ra.startsWith(ym);
  }).length;
  return { active: active.length, red, amber, resolvedThisMonth };
}

export function findAlertById(erp, id) {
  const want = String(id || '').trim();
  const list = Array.isArray(erp.integrityAlerts) ? erp.integrityAlerts : [];
  return list.find(a => String(a.id) === want) || null;
}

function pickRecordById(erp, id) {
  const want = String(id || '').trim();
  if (!want) return null;
  for (const r of erp.records || []) {
    if (String(r.id) === want) return { kind: 'maintenance_record', ...r };
  }
  for (const w of erp.workOrders || []) {
    if (String(w.id) === want) return { kind: 'work_order', ...w };
  }
  for (const f of erp.fuelPurchases || []) {
    if (String(f.id) === want) return { kind: 'fuel_purchase', ...f };
  }
  return null;
}

export function buildInvestigatePayload(alert, erp) {
  const base = buildInvestigateRecords(alert, erp);
  const rows = [...(base.records || base.relatedRecords || [])];
  const det = alert.details && typeof alert.details === 'object' ? alert.details : {};
  const rid = String(alert.recordId || det.recordId || '').trim();
  if (rid && !rows.length) {
    const raw = pickRecordById(erp, rid);
    if (raw) {
      rows.push({
        kind: raw.kind || 'record',
        id: String(raw.id || ''),
        date: sliceD(raw.serviceDate || raw.txnDate || ''),
        unit: String(raw.unit || ''),
        amount: String(raw.cost != null ? raw.cost : raw.totalCost != null ? raw.totalCost : ''),
        summary: String(raw.serviceType || raw.memo || '').slice(0, 200)
      });
    }
  }
  return { alert, relatedRecords: rows, records: rows };
}
