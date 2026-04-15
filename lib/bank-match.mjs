/**
 * Heuristic bank ↔ accounting matching (QBO expenses + local ERP rows).
 * Not a substitute for QuickBooks bank reconciliation UI; assists triage.
 */

function safeNum(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sliceIso(s) {
  const t = String(s || '').trim();
  if (t.length >= 10) return t.slice(0, 10);
  return t;
}

function daysApart(a, b) {
  const da = new Date(sliceIso(a) + 'T12:00:00');
  const db = new Date(sliceIso(b) + 'T12:00:00');
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 999;
  return Math.abs(Math.round((da - db) / 86400000));
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a, b) {
  const ta = new Set(normText(a).split(' ').filter(x => x.length > 2));
  const tb = new Set(normText(b).split(' ').filter(x => x.length > 2));
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const x of ta) if (tb.has(x)) n++;
  return n / Math.max(ta.size, tb.size);
}

function amountClose(a, b, tol = 0.02) {
  return Math.abs(Math.abs(safeNum(a, 0)) - Math.abs(safeNum(b, 0))) <= tol;
}

/**
 * @param {object} row — { date, amount, memo }
 * @param {object} cand — { kind, label, amount, date, vendorText, extraText }
 */
export function scoreCandidate(row, cand) {
  if (!amountClose(row.amount, cand.amount, 0.03)) return 0;
  const dd = daysApart(row.date, cand.date);
  if (dd > 14) return 0;
  let score = 70 - dd * 3;
  const blob = `${cand.vendorText || ''} ${cand.extraText || ''} ${cand.label || ''}`;
  const ov = tokenOverlap(row.memo, blob);
  score += Math.min(25, ov * 50);
  if (amountClose(row.amount, cand.amount, 0.005)) score += 5;
  return Math.max(0, Math.round(score));
}

export function suggestForBankRow(row, qboPurchases, qboBills, qboBillPayments, erpCandidates, limit = 8) {
  const out = [];
  const push = (kind, ref, label, amount, date, vendorText, extraText) => {
    const c = { kind, ref, label, amount, date, vendorText, extraText };
    const sc = scoreCandidate(row, c);
    if (sc > 0) out.push({ kind, ref, label, amount, date, vendorText, score: sc });
  };

  for (const p of qboPurchases || []) {
    push(
      'qbo_purchase',
      p.id,
      `QBO Purchase #${p.docNumber || p.id}`,
      p.totalAmt,
      p.txnDate,
      p.vendorName || '',
      p.paymentType || ''
    );
  }
  for (const b of qboBills || []) {
    push('qbo_bill', b.id, `QBO Bill #${b.docNumber || b.id}`, b.totalAmt, b.txnDate, b.vendorName || '', '');
  }
  for (const bp of qboBillPayments || []) {
    push(
      'qbo_bill_payment',
      bp.id,
      `QBO Bill Payment #${bp.docNumber || bp.id}`,
      bp.totalAmt,
      bp.txnDate,
      bp.vendorName || '',
      ''
    );
  }
  for (const e of erpCandidates || []) {
    push(e.kind, e.ref, e.label, e.amount, e.date, e.vendorText || '', e.memo || '');
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function parseBankCsvText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };

  const split = line => {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    const m = line.match(/("([^"]|"")*"|[^,]+)(?=,|$)/g);
    if (m) return m.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    return line.split(',').map(c => c.trim());
  };

  const headerLine = split(lines[0]).map(h => h.toLowerCase());
  const dateKeys = ['date', 'posted', 'post date', 'trans date', 'transaction date'];
  const amtKeys = ['amount', 'amt', 'debit', 'withdrawal', 'payment'];
  const memoKeys = ['description', 'memo', 'details', 'name', 'payee', 'merchant'];

  let di = headerLine.findIndex(h => dateKeys.some(k => h.includes(k)));
  let ai = headerLine.findIndex(h => amtKeys.some(k => h === k || h.includes(k)));
  let mi = headerLine.findIndex(h => memoKeys.some(k => h.includes(k)));

  if (di < 0) di = 0;
  if (ai < 0) ai = 1;
  if (mi < 0) mi = Math.max(headerLine.length - 1, 2);

  const dataLines = lines.slice(1);
  const rows = [];
  for (const line of dataLines) {
    const cells = split(line);
    if (!cells.length) continue;
    const rawDate = cells[di] ?? '';
    let rawAmt = cells[ai] ?? '';
    const memo = (cells[mi] ?? cells.slice(2).join(' ')).trim();
    let amount = safeNum(String(rawAmt).replace(/[$,]/g, ''), null);
    if (amount == null) continue;
    rows.push({ date: sliceIso(rawDate), amount, memo });
  }
  return { headers: headerLine, rows };
}
