/**
 * Multiple bills — pure helpers (no DOM).
 * Exposes window.ErpMultiBillsUtil for maintenance.html.
 */
(function (global) {
  const MONTH_ABBRS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function parseIsoLocal(iso) {
    const s = String(iso || '').trim().slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  function fmtIsoLocal(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  function addDaysIso(iso, nDays) {
    const d = parseIsoLocal(iso);
    if (!d) return '';
    d.setDate(d.getDate() + (Number(nDays) || 0));
    return fmtIsoLocal(d);
  }

  /** Add calendar months; clamp day to last day of target month (Jan 31 → Feb 28). */
  function addMonthsClampedIso(iso, deltaMonths) {
    const d0 = parseIsoLocal(iso);
    if (!d0) return '';
    const y = d0.getFullYear();
    const m = d0.getMonth();
    const day = d0.getDate();
    const target = new Date(y, m + (Number(deltaMonths) || 0), 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return fmtIsoLocal(target);
  }

  function generateBillDates(firstIso, count, frequency, customDays) {
    const n = Math.max(1, Math.floor(Number(count) || 0));
    const freq = String(frequency || 'monthly').toLowerCase();
    const out = [];
    if (!parseIsoLocal(firstIso)) return out;
    for (let i = 0; i < n; i++) {
      if (freq === 'weekly') out.push(addDaysIso(firstIso, i * 7));
      else if (freq === 'monthly') out.push(addMonthsClampedIso(firstIso, i));
      else if (freq === 'quarterly') out.push(addMonthsClampedIso(firstIso, i * 3));
      else if (freq === 'custom') {
        const step = Math.min(365, Math.max(1, Math.floor(Number(customDays) || 1)));
        out.push(addDaysIso(firstIso, i * step));
      } else out.push(addDaysIso(firstIso, i * 7));
    }
    return out;
  }

  const TERMS_DAYS = {
    receipt: 0,
    net3: 3,
    net7: 7,
    net15: 15,
    net30: 30,
    net45: 45,
    net60: 60,
    custom: null
  };

  function termsDays(mode, customDays) {
    const m = String(mode || 'net30').toLowerCase();
    if (m === 'custom') return Math.min(365, Math.max(0, Math.floor(Number(customDays) || 0)));
    return TERMS_DAYS[m] != null ? TERMS_DAYS[m] : 30;
  }

  function splitTotalEvenly(total, count) {
    const c = Math.max(1, Math.floor(Number(count) || 0));
    const t = Math.round((Number(total) || 0) * 100) / 100;
    const per = Math.floor((t * 100) / c) / 100;
    const remainder = Math.round((t - per * c) * 100) / 100;
    const amounts = Array(c).fill(per);
    if (c >= 1 && remainder) amounts[c - 1] = Math.round((amounts[c - 1] + remainder) * 100) / 100;
    return { amounts, perBill: per, remainderOnLast: remainder };
  }

  function scaleLinesToTotal(templateLines, targetTotal) {
    const lines = (templateLines || []).map(l => ({ ...l }));
    const tgt = Math.round((Number(targetTotal) || 0) * 100) / 100;
    const t0 = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    if (!lines.length || tgt <= 0) return lines;
    if (t0 <= 0) {
      if (lines.length === 1) {
        lines[0].amount = tgt;
        return lines;
      }
      const each = Math.floor((tgt * 100) / lines.length) / 100;
      let rem = Math.round((tgt - each * lines.length) * 100) / 100;
      lines.forEach((l, i) => {
        l.amount = each + (i === lines.length - 1 ? rem : 0);
      });
      return lines;
    }
    const factor = tgt / t0;
    let sum = 0;
    lines.forEach((l, i) => {
      if (i < lines.length - 1) {
        const v = Math.round((Number(l.amount) || 0) * factor * 100) / 100;
        l.amount = v;
        sum += v;
      } else {
        l.amount = Math.round((tgt - sum) * 100) / 100;
      }
    });
    return lines;
  }

  function describeBillNumberPattern(firstNumber, frequency) {
    const r = generateBillNumbersMeta(firstNumber, 3, frequency);
    return { label: r.label, preview: r.preview, warn: r.warn };
  }

  function generateBillNumbers(firstNumber, count, frequency) {
    return generateBillNumbersMeta(firstNumber, count, frequency).numbers;
  }

  function generateBillNumbersMeta(firstNumber, count, frequency) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const freq = String(frequency || 'monthly').toLowerCase();
    const raw = String(firstNumber || '').trim();
    const warn = [];
    if (!raw) return { numbers: [], label: '', preview: '', warn: [] };

    if (/\{N\}/i.test(raw)) {
      const numbers = [];
      for (let i = 0; i < n; i++) numbers.push(raw.replace(/\{N\}/gi, String(i + 1)));
      return {
        numbers,
        label: 'Custom pattern ({N})',
        preview: numbers.slice(0, 3).join(' → '),
        warn
      };
    }

    const wk = raw.match(/^(.*)W(\d+)$/i);
    if (wk) {
      const prefix = wk[1] || '';
      let start = parseInt(wk[2], 10);
      if (!Number.isFinite(start)) start = 1;
      const numbers = [];
      for (let i = 0; i < n; i++) numbers.push(`${prefix}W${start + i}`);
      return {
        numbers,
        label: `Weekly numbering starting at week ${start}`,
        preview: numbers.slice(0, 3).join(' → '),
        warn
      };
    }

    const monRe = /^(.+[-_/])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i;
    const ma = raw.match(monRe);
    if (ma) {
      const prefix = ma[1];
      const idx = MONTH_ABBRS.indexOf(ma[2].toUpperCase());
      const startMonth = idx >= 0 ? idx : 0;
      const numbers = [];
      for (let i = 0; i < n; i++) {
        numbers.push(prefix + MONTH_ABBRS[(startMonth + i) % 12]);
      }
      return {
        numbers,
        label: `Monthly numbering with prefix ${prefix.replace(/[-_/]$/, '')}`,
        preview: numbers.slice(0, 3).join(' → '),
        warn
      };
    }

    if (freq === 'quarterly') {
      const qm = raw.match(/^(.+[-_/]?)Q([1-4])$/i);
      if (qm) {
        const prefix = qm[1] || '';
        let q0 = parseInt(qm[2], 10);
        if (!Number.isFinite(q0) || q0 < 1 || q0 > 4) q0 = 1;
        const numbers = [];
        for (let i = 0; i < n; i++) {
          const q = ((q0 - 1 + i) % 4) + 1;
          numbers.push(`${prefix}Q${q}`);
        }
        return {
          numbers,
          label: 'Quarterly numbering (Q1–Q4)',
          preview: numbers.slice(0, 3).join(' → '),
          warn
        };
      }
    }

    const numMonth = raw.match(/^(.+[-_/])(0?[1-9]|1[0-2])$/);
    if (numMonth) {
      const prefix = numMonth[1];
      let m0 = parseInt(numMonth[2], 10);
      if (!Number.isFinite(m0) || m0 < 1 || m0 > 12) m0 = 1;
      const pad2 = String(numMonth[2]).length >= 2 || Number(numMonth[2]) >= 10;
      const numbers = [];
      for (let i = 0; i < n; i++) {
        const m = ((m0 - 1 + i) % 12) + 1;
        numbers.push(prefix + (pad2 ? String(m).padStart(2, '0') : String(m)));
      }
      return {
        numbers,
        label: `Monthly numeric with prefix ${prefix.replace(/[-_/]$/, '')}`,
        preview: numbers.slice(0, 3).join(' → '),
        warn
      };
    }

    const seq = raw.match(/^(.*?)(\d+)$/);
    if (seq) {
      const prefix = seq[1];
      const digitStr = seq[2];
      const width = digitStr.length;
      let start = parseInt(digitStr, 10);
      if (!Number.isFinite(start)) start = 0;
      const numbers = [];
      for (let i = 0; i < n; i++) {
        numbers.push(prefix + String(start + i).padStart(width, '0'));
      }
      return {
        numbers,
        label: 'Sequential numbering',
        preview: numbers.slice(0, 3).join(' → '),
        warn
      };
    }

    warn.push('Could not detect a number pattern. Bills will use a numeric suffix.');
    const numbers = [raw];
    for (let i = 1; i < n; i++) numbers.push(`${raw}-${i + 1}`);
    return {
      numbers,
      label: 'Suffix numbering',
      preview: numbers.slice(0, 3).join(' → '),
      warn
    };
  }

  global.ErpMultiBillsUtil = {
    MONTH_ABBRS,
    parseIsoLocal,
    fmtIsoLocal,
    addDaysIso,
    addMonthsClampedIso,
    generateBillDates,
    termsDays,
    TERMS_DAYS,
    splitTotalEvenly,
    scaleLinesToTotal,
    generateBillNumbers,
    describeBillNumberPattern,
    generateBillNumbersMeta
  };
})(typeof window !== 'undefined' ? window : globalThis);
