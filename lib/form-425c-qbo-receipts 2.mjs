/**
 * QuickBooks Online — classify bank deposits for Form 425C Exhibit C (cash receipts).
 * Excludes Transfer transactions; deposit lines linked to Transfer / internal JE optional.
 */

const SALES_RELATED_TXN_TYPES = new Set(['Payment', 'SalesReceipt']);

async function qboQueryPaged(qboQuery, sqlBase) {
  let start = 1;
  const out = [];
  while (true) {
    const sql = `${sqlBase} STARTPOSITION ${start} MAXRESULTS 500`;
    const data = await qboQuery(sql);
    const qr = data?.QueryResponse || {};
    const keys = Object.keys(qr).filter((k) => k !== 'maxResults' && k !== 'startPosition');
    const entityKey = keys.find((k) => Array.isArray(qr[k]) || (qr[k] && typeof qr[k] === 'object'));
    let rows = entityKey ? qr[entityKey] : [];
    const arr = Array.isArray(rows) ? rows : rows ? [rows] : [];
    if (!arr.length) break;
    out.push(...arr);
    if (arr.length < 500) break;
    start += 500;
  }
  return out;
}

function ymToRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) throw new Error('month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error('invalid month');
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const last = new Date(y, mo, 0);
  const end = `${y}-${String(mo).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { start, end };
}

function depositBankId(deposit) {
  const ref = deposit.DepositToAccountRef || deposit.AccountRef;
  return ref?.value != null ? String(ref.value) : '';
}

function linesFromDeposit(deposit) {
  const lines = deposit.Line;
  if (!lines) return [];
  return Array.isArray(lines) ? lines : [lines];
}

function linkedTxnsFromLine(line) {
  const dld = line?.DepositLineDetail;
  const atLine = line?.LinkedTxn;
  const inDetail = dld?.LinkedTxn;
  const raw = atLine || inDetail;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function lineLinkedTxnTypes(line) {
  return linkedTxnsFromLine(line)
    .map((t) => String(t?.TxnType || '').trim())
    .filter(Boolean);
}

/**
 * @param {object} opts
 * @param {(sql: string) => Promise<any>} opts.qboQuery
 * @param {string[]} opts.bankAccountQboIds
 * @param {string} opts.month YYYY-MM
 * @param {{ includeUnclassifiedDepositLines?: boolean, includeJournalEntryDepositLines?: boolean }} opts.flags
 */
export async function fetch425cSalesDepositReceipts(opts) {
  const { qboQuery, bankAccountQboIds, month, flags = {} } = opts;
  const ids = new Set((bankAccountQboIds || []).map((x) => String(x).trim()).filter(Boolean));
  if (!ids.size) {
    return {
      ok: true,
      range: ymToRange(month),
      exhibitCLines: [],
      line20Total: 0,
      depositsConsidered: 0,
      linesExcluded: [],
      transfersInPeriod: []
    };
  }

  const { start, end } = ymToRange(month);
  const sqlDeposits = `select * from Deposit where TxnDate >= '${start}' and TxnDate <= '${end}'`;
  const deposits = await qboQueryPaged(qboQuery, sqlDeposits);

  const sqlTransfers = `select * from Transfer where TxnDate >= '${start}' and TxnDate <= '${end}'`;
  const transfers = await qboQueryPaged(qboQuery, sqlTransfers);

  const transfersInPeriod = transfers.map((t) => ({
    id: t.Id,
    txnDate: t.TxnDate,
    amount: t.Amount,
    from: t.FromAccountRef?.name || t.FromAccountRef?.value,
    to: t.ToAccountRef?.name || t.ToAccountRef?.value,
    privateNote: t.PrivateNote || ''
  }));

  const exhibitCLines = [];
  const linesExcluded = [];
  let line20Total = 0;
  let depositsConsidered = 0;

  const includeUnclassified = !!flags.includeUnclassifiedDepositLines;
  const includeJE = !!flags.includeJournalEntryDepositLines;

  for (const dep of deposits) {
    const bankId = depositBankId(dep);
    if (!bankId || !ids.has(bankId)) continue;
    depositsConsidered++;

    for (const line of linesFromDeposit(dep)) {
      const amt = Number(line.Amount || 0);
      if (!Number.isFinite(amt) || amt === 0) continue;

      const linkedTypes = lineLinkedTxnTypes(line);
      const hasLinked = linkedTypes.length > 0;
      let include = false;
      let reason = '';

      if (linkedTypes.some((t) => t === 'Transfer')) {
        reason = 'transfer-linked';
      } else if (linkedTypes.some((t) => t === 'JournalEntry') && !includeJE) {
        reason = 'journal-entry';
      } else if (hasLinked && linkedTypes.some((t) => SALES_RELATED_TXN_TYPES.has(t))) {
        include = true;
      } else if (!hasLinked && includeUnclassified) {
        include = true;
        reason = 'unclassified-included';
      } else if (!hasLinked) {
        reason = 'no-linked-txn';
      } else {
        reason = 'non-sales-type:' + linkedTypes.join(',');
      }

      const row = {
        depositId: dep.Id,
        depositTxnDate: dep.TxnDate,
        bankAccountId: bankId,
        bankAccountName: dep.DepositToAccountRef?.name || '',
        lineAmount: amt,
        linkedTxnTypes: linkedTypes,
        linkedTxnIds: linkedTxnsFromLine(line).map((t) => t.TxnId),
        memo: dep.PrivateNote || line.Description || ''
      };

      if (include) {
        exhibitCLines.push(row);
        line20Total += amt;
      } else {
        linesExcluded.push({ ...row, excludeReason: reason });
      }
    }
  }

  return {
    ok: true,
    range: { start, end },
    exhibitCLines,
    line20Total: Math.round(line20Total * 100) / 100,
    depositsConsidered,
    linesExcluded,
    transfersInPeriod,
    meta: {
      note:
        'Exhibit C total sums deposit line amounts linked to Payment or SalesReceipt. Transfer-type inter-account moves use QBO Transfer and are listed separately for review — they are not added to line 20.'
    }
  };
}

/**
 * @param {(sql: string) => Promise<any>} qboQuery
 */
export async function fetchQboBankAccounts(qboQuery) {
  const sql = "select Id, Name, FullyQualifiedName, AccountType, Active, CurrentBalance from Account where AccountType = 'Bank' and Active = true order by Name maxresults 500";
  const rows = await qboQueryPaged(qboQuery, sql);
  return rows.map((a) => ({
    id: String(a.Id),
    name: a.Name || a.FullyQualifiedName || '',
    fullyQualifiedName: a.FullyQualifiedName || a.Name || '',
    accountType: a.AccountType,
    active: a.Active !== false,
    currentBalance: a.CurrentBalance != null ? Number(a.CurrentBalance) : null
  }));
}
