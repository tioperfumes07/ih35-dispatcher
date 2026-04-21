import { getPool, dbQuery } from './db.mjs';

/**
 * Optional Postgres mirror for integrity alerts (ERP JSON remains source of truth for the app).
 * @param {Array<Record<string, unknown>>} rows
 */
export async function syncIntegrityAlertsToDatabase(rows) {
  const pool = getPool();
  if (!pool || !Array.isArray(rows) || !rows.length) return;
  for (const a of rows) {
    const erpId = String(a.id || '').trim();
    if (!erpId) continue;
    const alertType = String(a.alertType || a.type || '').trim() || 'UNKNOWN';
    const severity = String(a.severity || 'AMBER').trim() || 'AMBER';
    const message = String(a.message || '').trim() || '';
    const unitId = a.unitId != null ? String(a.unitId).trim() : null;
    const driverId = a.driverId != null ? String(a.driverId).trim() : null;
    const recordId = a.recordId != null ? String(a.recordId).trim() : null;
    const recordType = a.recordType != null ? String(a.recordType).trim() : null;
    const status = String(a.status || 'active').trim() || 'active';
    const dedupeKey = a.dedupeKey != null ? String(a.dedupeKey).trim() : null;
    const category = a.category != null ? String(a.category).trim() : null;
    const detailsJson = JSON.stringify(a.details != null ? a.details : {});
    const triggered = String(a.triggeredDate || a.createdAt || '').slice(0, 10);
    const trigSql = triggered && /^\d{4}-\d{2}-\d{2}$/.test(triggered) ? `${triggered}T12:00:00Z` : new Date().toISOString();
    await dbQuery(
      `INSERT INTO public.integrity_alerts (
        erp_alert_id, alert_type, severity, message, details_json, triggered_date,
        unit_id, driver_id, record_id, record_type, status, dedupe_key, category,
        reviewed_by, reviewed_at, notes
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16)
      ON CONFLICT (erp_alert_id) DO UPDATE SET
        alert_type = EXCLUDED.alert_type,
        severity = EXCLUDED.severity,
        message = EXCLUDED.message,
        details_json = EXCLUDED.details_json,
        triggered_date = EXCLUDED.triggered_date,
        unit_id = EXCLUDED.unit_id,
        driver_id = EXCLUDED.driver_id,
        record_id = EXCLUDED.record_id,
        record_type = EXCLUDED.record_type,
        status = EXCLUDED.status,
        dedupe_key = EXCLUDED.dedupe_key,
        category = EXCLUDED.category,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = EXCLUDED.reviewed_at,
        notes = EXCLUDED.notes`,
      [
        erpId,
        alertType,
        severity,
        message,
        detailsJson,
        trigSql,
        unitId,
        driverId,
        recordId,
        recordType,
        status,
        dedupeKey,
        category,
        a.reviewedBy != null ? String(a.reviewedBy) : null,
        a.reviewedAt ? String(a.reviewedAt) : null,
        a.notes != null ? String(a.notes) : null
      ]
    );
  }
}
