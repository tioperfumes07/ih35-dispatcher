/**
 * Saved Form 425C report JSON per company + month.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'data', 'form-425c-reports');

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function filePath(companyId, month) {
  const safeC = String(companyId || '').replace(/[^a-z0-9_-]/gi, '_');
  const safeM = String(month || '').replace(/[^0-9-]/g, '');
  return path.join(DIR, `${safeC}_${safeM}.json`);
}

function prevMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function listForm425cReports() {
  ensureDir();
  const out = [];
  const re = /^(.+)_(\d{4}-\d{2})\.json$/;
  try {
    for (const f of fs.readdirSync(DIR)) {
      const m = re.exec(f);
      if (!m) continue;
      const companyId = m[1];
      const month = m[2];
      const fp = path.join(DIR, f);
      let updatedAt = '';
      let savedBy = '';
      let lastModifiedBy = '';
      let exportHistoryCount = 0;
      let lastExportAt = '';
      try {
        const st = fs.statSync(fp);
        updatedAt = st.mtime.toISOString();
      } catch {
        /* ignore */
      }
      try {
        const report = JSON.parse(fs.readFileSync(fp, 'utf8'));
        savedBy = String(report?.savedBy || '').trim();
        lastModifiedBy = String(report?.lastModifiedBy || '').trim();
        const exports = Array.isArray(report?.exportHistory) ? report.exportHistory : [];
        exportHistoryCount = exports.length;
        lastExportAt = exports.length ? String(exports[exports.length - 1]?.at || '') : '';
      } catch {
        /* ignore */
      }
      out.push({ companyId, month, updatedAt, file: f });
      out[out.length - 1].savedBy = savedBy;
      out[out.length - 1].lastModifiedBy = lastModifiedBy;
      out[out.length - 1].exportHistoryCount = exportHistoryCount;
      out[out.length - 1].lastExportAt = lastExportAt;
    }
  } catch {
    /* ignore */
  }
  out.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.companyId.localeCompare(b.companyId)));
  return out;
}

export function readForm425cReport(companyId, month) {
  ensureDir();
  const fp = filePath(companyId, month);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

export function writeForm425cReport(companyId, month, payload) {
  ensureDir();
  const fp = filePath(companyId, month);
  const existing = readForm425cReport(companyId, month) || {};
  const incomingHistory = Array.isArray(payload?.exportHistory) ? payload.exportHistory : null;
  const exportHistory = incomingHistory || (Array.isArray(existing?.exportHistory) ? existing.exportHistory : []);
  const savedAt = String(payload?.savedAt || existing?.savedAt || new Date().toISOString());
  const savedBy = String(payload?.savedBy || existing?.savedBy || '').trim();
  const lastModifiedAt = String(payload?.lastModifiedAt || new Date().toISOString());
  const lastModifiedBy = String(payload?.lastModifiedBy || savedBy || existing?.lastModifiedBy || '').trim();
  const body = {
    companyId: String(companyId || '').trim(),
    month: String(month || '').trim(),
    updatedAt: new Date().toISOString(),
    savedAt,
    savedBy,
    lastModifiedAt,
    lastModifiedBy,
    exportHistory,
    ...payload
  };
  fs.writeFileSync(fp, JSON.stringify(body, null, 2), 'utf8');
  return body;
}

export function deleteForm425cReport(companyId, month) {
  ensureDir();
  const fp = filePath(companyId, month);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return true;
  } catch {
    return false;
  }
}

export function appendForm425cReportExportEvent(companyId, month, eventPayload = {}) {
  const current = readForm425cReport(companyId, month);
  if (!current) return null;
  const next = { ...current };
  const history = Array.isArray(next.exportHistory) ? [...next.exportHistory] : [];
  history.push({
    type: String(eventPayload.type || 'export').trim() || 'export',
    at: String(eventPayload.at || new Date().toISOString()),
    by: String(eventPayload.by || '').trim(),
    note: String(eventPayload.note || '').trim() || null
  });
  next.exportHistory = history.slice(-100);
  next.lastModifiedAt = String(eventPayload.at || new Date().toISOString());
  if (eventPayload.by) next.lastModifiedBy = String(eventPayload.by || '').trim();
  return writeForm425cReport(companyId, month, next);
}

/** Line 23 ending cash from prior month's saved report → use as line 19 opening. */
export function getPriorMonthEndingCash(companyId, month) {
  const pm = prevMonth(month);
  if (!pm) return { priorMonth: null, line23: null };
  const prev = readForm425cReport(companyId, pm);
  const line23 = prev?.cash?.line23 ?? prev?.line23 ?? null;
  return { priorMonth: pm, line23 };
}
