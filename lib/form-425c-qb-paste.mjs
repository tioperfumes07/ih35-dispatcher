/**
 * Parse pasted QuickBooks report / export text (tab or comma separated).
 * Heuristic: income-like deposits in, inter-account transfers out.
 */

function splitLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length);
}

function detectDelim(line) {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function parseRow(line, delim) {
  if (delim === '\t') return line.split('\t').map((c) => c.trim());
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (!q && ch === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findColIndex(headers, candidates) {
  const n = headers.map(normHeader);
  for (const cand of candidates) {
    const c = normHeader(cand);
    const i = n.findIndex((h) => h.includes(c) || c.includes(h));
    if (i >= 0) return i;
  }
  return -1;
}

function parseMoney(s) {
  if (s == null || s === '') return null;
  const t = String(s).replace(/[$,\s]/g, '').replace(/[()]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} text pasted export
 * @param {{ bankNameSubstrings?: string[] }} [opts] if set, keep rows whose bank/split/account column matches any substring (case-insensitive)
 */
export function parseQBDepositPaste(text, opts = {}) {
  const lines = splitLines(text);
  if (!lines.length) {
    return { ok: true, rows: [], total: 0, excluded: [], meta: { message: 'No lines' } };
  }

  const delim = detectDelim(lines[0]);
  const headerIdx = lines.findIndex((ln) => {
    const p = parseRow(ln, delim).map(normHeader);
    return p.some((h) => h.includes('date')) && (p.some((h) => h.includes('type')) || p.some((h) => h.includes('transaction')));
  });
  const headers = headerIdx >= 0 ? parseRow(lines[headerIdx], delim) : parseRow(lines[0], delim);
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;

  const iDate = findColIndex(headers, ['date', 'txn date', 'transaction date']);
  const iType = findColIndex(headers, ['transaction type', 'type', 'txn type']);
  const iAmount = findColIndex(headers, ['amount', 'amt']);
  const iSplit = findColIndex(headers, ['split', 'account', 'deposit account', 'bank']);
  const iName = findColIndex(headers, ['name', 'payee', 'customer', 'vendor']);
  const iMemo = findColIndex(headers, ['memo', 'description', 'notes']);
  const iNum = findColIndex(headers, ['num', 'no', 'number']);

  const subs = (opts.bankNameSubstrings || []).map((s) => String(s).toLowerCase()).filter(Boolean);

  const rows = [];
  const excluded = [];

  for (let li = dataStart; li < lines.length; li++) {
    const cells = parseRow(lines[li], delim);
    if (!cells.length || cells.every((c) => !c)) continue;

    const date = iDate >= 0 ? cells[iDate] : cells[0] || '';
    const typeRaw = iType >= 0 ? cells[iType] : '';
    const type = String(typeRaw).toLowerCase();
    const amount = iAmount >= 0 ? parseMoney(cells[iAmount]) : null;
    const split = iSplit >= 0 ? cells[iSplit] : '';
    const name = iName >= 0 ? cells[iName] : '';
    const memo = iMemo >= 0 ? cells[iMemo] : '';
    const num = iNum >= 0 ? cells[iNum] : '';

    const hay = `${typeRaw} ${split} ${name} ${memo}`.toLowerCase();
    if (/\btransfer\b/.test(hay) || type === 'transfer') {
      excluded.push({ date, reason: 'transfer', type: typeRaw, amount, split, name, memo });
      continue;
    }
    if (amount == null || amount <= 0) {
      excluded.push({ date, reason: 'non-positive-amount', type: typeRaw, amount, split, name, memo });
      continue;
    }
    const isDeposit = type.includes('deposit') || type.includes('sales receipt') || type.includes('payment');
    if (!isDeposit) {
      excluded.push({ date, reason: 'not-deposit-like', type: typeRaw, amount, split, name, memo });
      continue;
    }
    if (subs.length) {
      const splitL = String(split).toLowerCase();
      const match = subs.some((s) => splitL.includes(s));
      if (!match) {
        excluded.push({ date, reason: 'bank-filter', type: typeRaw, amount, split, name, memo });
        continue;
      }
    }
    rows.push({
      date,
      type: typeRaw,
      amount,
      split,
      name,
      memo,
      num
    });
  }

  const total = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  return {
    ok: true,
    rows,
    total,
    excluded,
    meta: {
      headers,
      delimiter: delim === '\t' ? 'tab' : 'comma',
      message: `Parsed ${rows.length} income deposit row(s); ${excluded.length} excluded.`
    }
  };
}
