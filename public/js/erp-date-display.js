/**
 * Human-readable short dates for maintenance UI (delegates to print stack when loaded).
 */
(function (w) {
  function formatFallback(iso) {
    const raw = String(iso == null ? '' : iso).trim();
    if (!raw) return '\u2014';
    const s = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return raw;
    try {
      const d = new Date(s + 'T12:00:00');
      if (!Number.isFinite(d.getTime())) return s;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return s;
    }
  }

  w.erpIsoToDisplayShort = function (v) {
    if (v == null || String(v).trim() === '') return '\u2014';
    if (typeof w.formatIsoDateShortPlain === 'function') {
      const x = w.formatIsoDateShortPlain(v);
      return x === '' ? '\u2014' : String(x);
    }
    const raw = String(v).trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return formatFallback(m[1]);
    return formatFallback(raw);
  };
})(typeof window !== 'undefined' ? window : globalThis);
