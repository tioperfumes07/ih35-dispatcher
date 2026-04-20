/**
 * Short locale calendar label for ISO calendar dates (matches browser `printDocuments.js`).
 * @param {unknown} iso
 * @returns {string}
 */
export function formatIsoDateShortPlain(iso) {
  const raw = String(iso == null ? '' : iso).trim();
  const s = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return raw || '—';
  try {
    const d = new Date(`${s}T12:00:00`);
    if (!Number.isFinite(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return s;
  }
}
