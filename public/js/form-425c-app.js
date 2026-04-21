/**
 * Form 425C workspace — profiles, QB paste, full report, ZIP package, history.
 */
(function () {
  const Q_LINES = [
    [1, 'Did the business operate during the entire reporting period?'],
    [2, 'Do you plan to continue to operate the business next month?'],
    [3, 'Have you paid all of your bills on time?'],
    [4, 'Did you pay your employees on time?'],
    [5, 'Have you deposited all receipts into DIP accounts?'],
    [6, 'Have you timely filed tax returns and paid taxes?'],
    [7, 'Have you timely filed all other required government filings?'],
    [8, 'Current on quarterly U.S. Trustee / Bankruptcy Administrator fees?'],
    [9, 'Timely paid all insurance premiums?'],
    [10, 'Any bank accounts open other than DIP accounts?'],
    [11, 'Sold any assets other than inventory?'],
    [12, 'Sold/transferred assets or services to anyone related to the DIP?'],
    [13, 'Any insurance company cancel your policy?'],
    [14, 'Unusual or significant unanticipated expenses?'],
    [15, 'Borrowed money or payments made on your behalf?'],
    [16, 'Anyone made an investment in your business?'],
    [17, 'Paid pre-petition bills?'],
    [18, 'Allowed pre-petition checks to clear?']
  ];

  const PROJ_ROWS = [
    ['32', 'Projected gross receipts / cash inflows'],
    ['33', 'Projected total cash disbursements'],
    ['34', 'Projected payroll & benefits'],
    ['35', 'Projected fleet / fuel / maintenance'],
    ['36', 'Projected insurance & professional fees'],
    ['37', 'Other material items (describe in notes)']
  ];

  const ATTACH_KEYS = [
    ['pl', 'Profit & loss (month)'],
    ['bs', 'Balance sheet'],
    ['bankStmt', 'Bank statements (all DIP accounts)'],
    ['bankRec', 'Bank reconciliation worksheets'],
    ['ar', 'Accounts receivable aging'],
    ['ap', 'Accounts payable / unpaid bills detail'],
    ['exC', 'Exhibit C — cash receipts'],
    ['exD', 'Exhibit D — disbursements'],
    ['other', 'Other exhibits (attach description in notes)']
  ];

  let profilesState = { version: 1, companies: [] };
  let bankAccountsCache = [];
  /** @type {{ rows: any[], total: number } | null} */
  let lastQBPasteResult = null;
  let lastQboReceiptsData = null;

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function tabInit() {
    document.querySelectorAll('.f425-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.f425-tabs button').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        const id = btn.getAttribute('data-tab');
        document.querySelectorAll('.f425-panel').forEach((p) => p.classList.remove('active'));
        const panel = document.getElementById('panel-' + id);
        if (panel) panel.classList.add('active');
      });
    });
  }

  function renderQuestions() {
    const host = document.getElementById('qBlock');
    if (!host) return;
    host.innerHTML = Q_LINES.map(([n, txt]) => {
      return (
        '<div class="f425-yn-row">' +
        '<span style="min-width:220px">' +
        n +
        '. ' +
        escapeHtml(txt) +
        '</span>' +
        '<label><input type="radio" name="q' +
        n +
        '" value="Yes" /> Yes</label>' +
        '<label><input type="radio" name="q' +
        n +
        '" value="No" /> No</label>' +
        '<label><input type="radio" name="q' +
        n +
        '" value="N/A" /> N/A</label>' +
        '</div>'
      );
    }).join('');
  }

  function renderDefaultQuestionnaireEditors(c) {
    const dq = c.defaultQuestionnaire || {};
    return (
      '<details style="margin-top:12px"><summary class="f425-note" style="cursor:pointer;font-weight:600">Default questionnaire (lines 1–18) — applied when you click “Apply profile defaults” on the Form tab</summary>' +
      '<div style="margin-top:10px;padding:10px;border:1px solid var(--color-border,#ddd);border-radius:8px;background:#fff">' +
      Q_LINES.map(([n]) => {
        const v = dq[String(n)] || 'Yes';
        const ys = v === 'Yes' ? ' checked' : '';
        const ns = v === 'No' ? ' checked' : '';
        const nas = v === 'N/A' ? ' checked' : '';
        return (
          '<div class="f425-yn-row" style="font-size:12px">' +
          '<span style="min-width:140px">Line ' +
          n +
          '</span>' +
          '<label><input type="radio" name="defq-' +
          escapeAttr(c.id) +
          '-' +
          n +
          '" value="Yes"' +
          ys +
          ' /> Yes</label>' +
          '<label><input type="radio" name="defq-' +
          escapeAttr(c.id) +
          '-' +
          n +
          '" value="No"' +
          ns +
          ' /> No</label>' +
          '<label><input type="radio" name="defq-' +
          escapeAttr(c.id) +
          '-' +
          n +
          '" value="N/A"' +
          nas +
          ' /> N/A</label>' +
          '</div>'
        );
      }).join('') +
      '</div></details>'
    );
  }

  function renderProfileEditors() {
    const host = document.getElementById('profileEditors');
    if (!host) return;
    host.innerHTML = (profilesState.companies || [])
      .map((c) => {
        const hints = (c.bankPasteHints || []).join(', ');
        return (
          '<div class="f425-company-card" data-cid="' +
          escapeAttr(c.id) +
          '">' +
          '<h3>' +
          escapeHtml(c.displayName || c.id) +
          ' <code style="font-weight:400">' +
          escapeHtml(c.id) +
          '</code></h3>' +
          '<div class="f425-grid">' +
          '<label>Display name <input data-f="displayName" value="' +
          escapeAttr(c.displayName) +
          '" /></label>' +
          '<label>Debtor name (425C header) <input data-f="debtorName" value="' +
          escapeAttr(c.debtorName) +
          '" /></label>' +
          '<label>Case number <input data-f="caseNumber" value="' +
          escapeAttr(c.caseNumber) +
          '" /></label>' +
          '<label>Court district <input data-f="courtDistrict" value="' +
          escapeAttr(c.courtDistrict) +
          '" /></label>' +
          '<label>Court division <input data-f="courtDivision" value="' +
          escapeAttr(c.courtDivision) +
          '" /></label>' +
          '<label>NAICS <input data-f="naicsCode" value="' +
          escapeAttr(c.naicsCode) +
          '" /></label>' +
          '<label>Line of business <input data-f="lineOfBusiness" value="' +
          escapeAttr(c.lineOfBusiness) +
          '" /></label>' +
          '<label>Responsible party <input data-f="responsiblePartyName" value="' +
          escapeAttr(c.responsiblePartyName) +
          '" /></label>' +
          '</div>' +
          '<label style="display:block;margin-top:10px;font-size:12px;color:#555">QB paste filter hints (comma-separated substrings, e.g. Wells Fargo, WF-1, 3500)' +
          '<textarea data-f="bankPasteHints" rows="2" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid var(--color-border-input,#bbb);font:inherit">' +
          escapeHtml(hints) +
          '</textarea></label>' +
          '<p class="f425-note">Select QuickBooks <strong>Bank</strong> accounts for this debtor (Transportation: three WF · Trucking: one WF, e.g. 3500).</p>' +
          '<div class="f425-bank-pick" data-bank-pick="' +
          escapeAttr(c.id) +
          '">' +
          renderBankChecks(c) +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px">' +
          '<input type="checkbox" data-f="includeUnclassified" ' +
          (c.includeUnclassifiedDepositLines ? 'checked' : '') +
          ' />' +
          'Include deposit lines with no linked txn (review manually)' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:13px">' +
          '<input type="checkbox" data-f="includeJE" ' +
          (c.includeJournalEntryDepositLines ? 'checked' : '') +
          ' />' +
          'Include lines linked to JournalEntry' +
          '</label>' +
          renderDefaultQuestionnaireEditors(c) +
          '</div>'
        );
      })
      .join('');
  }

  function renderBankChecks(c) {
    if (!bankAccountsCache.length) {
      return '<span class="f425-note">Click <strong>Refresh QuickBooks bank list</strong> to map accounts.</span>';
    }
    const set = new Set((c.bankAccountQboIds || []).map(String));
    return bankAccountsCache
      .map((a) => {
        return (
          '<label>' +
          '<input type="checkbox" value="' +
          escapeAttr(a.id) +
          '" ' +
          (set.has(String(a.id)) ? 'checked' : '') +
          ' />' +
          '<span>' +
          escapeHtml(a.name) +
          ' <code>' +
          escapeHtml(a.id) +
          '</code>' +
          (a.currentBalance != null ? ' · Bal ' + escapeHtml(String(a.currentBalance)) : '') +
          '</span>' +
          '</label>'
        );
      })
      .join('');
  }

  function collectDefaultQuestionnaireFromCard(card, cid) {
    const o = {};
    for (let n = 1; n <= 18; n++) {
      const sel = card.querySelector('input[name="defq-' + cid + '-' + n + '"]:checked');
      o[String(n)] = sel ? sel.value : 'Yes';
    }
    return o;
  }

  function collectProfilesFromDom() {
    const companies = [];
    document.querySelectorAll('.f425-company-card').forEach((card) => {
      const id = card.getAttribute('data-cid');
      const get = (sel) => card.querySelector(sel);
      const ids = [];
      const labels = [];
      card.querySelectorAll('.f425-bank-pick input[type=checkbox]:checked').forEach((cb) => {
        ids.push(cb.value);
        const lab = bankAccountsCache.find((x) => x.id === cb.value);
        labels.push(lab ? lab.name : cb.value);
      });
      const hintsRaw = get('[data-f=bankPasteHints]')?.value || '';
      const bankPasteHints = hintsRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      companies.push({
        id,
        displayName: get('[data-f=displayName]')?.value?.trim() || '',
        debtorName: get('[data-f=debtorName]')?.value?.trim() || '',
        caseNumber: get('[data-f=caseNumber]')?.value?.trim() || '',
        courtDistrict: get('[data-f=courtDistrict]')?.value?.trim() || '',
        courtDivision: get('[data-f=courtDivision]')?.value?.trim() || '',
        naicsCode: get('[data-f=naicsCode]')?.value?.trim() || '',
        lineOfBusiness: get('[data-f=lineOfBusiness]')?.value?.trim() || '',
        responsiblePartyName: get('[data-f=responsiblePartyName]')?.value?.trim() || '',
        bankAccountQboIds: ids,
        bankAccountLabels: labels,
        bankPasteHints,
        defaultQuestionnaire: collectDefaultQuestionnaireFromCard(card, id),
        includeUnclassifiedDepositLines: !!get('[data-f=includeUnclassified]')?.checked,
        includeJournalEntryDepositLines: !!get('[data-f=includeJE]')?.checked
      });
    });
    return { version: 1, companies };
  }

  function syncReportSelectors() {
    const sel = document.getElementById('repCompany');
    const selQb = document.getElementById('qbCompany');
    if (!sel) return;
    const cur = sel.value;
    const opts = (profilesState.companies || [])
      .map((c) => '<option value="' + escapeAttr(c.id) + '">' + escapeHtml(c.displayName || c.id) + '</option>')
      .join('');
    sel.innerHTML = opts;
    if (selQb) {
      const curQ = selQb.value;
      selQb.innerHTML = opts;
      if (curQ && [...selQb.options].some((o) => o.value === curQ)) selQb.value = curQ;
      else if (cur) selQb.value = cur;
    }
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
    applyProfileToPaper();
  }

  function getSelectedCompany() {
    const id = document.getElementById('repCompany')?.value;
    return (profilesState.companies || []).find((x) => x.id === id) || null;
  }

  function applyProfileToPaper() {
    const c = getSelectedCompany();
    if (!c) return;
    const el = (id) => document.getElementById(id);
    if (el('paperDebtor')) el('paperDebtor').value = c.debtorName || '';
    if (el('paperCase')) el('paperCase').value = c.caseNumber || '';
    if (el('paperCourt')) el('paperCourt').value = [c.courtDistrict, c.courtDivision].filter(Boolean).join(' · ');
    if (el('paperNaics')) el('paperNaics').value = c.naicsCode || '';
    if (el('paperLob')) el('paperLob').value = c.lineOfBusiness || '';
    if (el('paperRp')) el('paperRp').value = c.responsiblePartyName || '';
  }

  function applyDefaultQuestionnaireFromProfile() {
    const c = getSelectedCompany();
    if (!c || !c.defaultQuestionnaire) return;
    const dq = c.defaultQuestionnaire;
    for (let n = 1; n <= 18; n++) {
      const v = dq[String(n)];
      if (!v) continue;
      const inp = document.querySelector('input[name="q' + n + '"][value="' + v + '"]');
      if (inp) inp.checked = true;
    }
  }

  function parseMoneyInput(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return parseFloat(String(el.value || '').replace(/,/g, '')) || 0;
  }

  function recalcCash() {
    const o19 = parseMoneyInput('line19');
    const o20 = parseMoneyInput('line20');
    const o21 = parseMoneyInput('line21');
    const flow = Math.round((o20 - o21) * 100) / 100;
    const end = Math.round((o19 + flow) * 100) / 100;
    const l22 = document.getElementById('line22');
    const l23 = document.getElementById('line23');
    if (l22) l22.value = flow ? String(flow) : '';
    if (l23) l23.value = end ? String(end) : '';
  }

  function readQuestionnaire() {
    const o = {};
    for (let n = 1; n <= 18; n++) {
      const sel = document.querySelector('input[name="q' + n + '"]:checked');
      o[String(n)] = sel ? sel.value : '';
    }
    return o;
  }

  function setQuestionnaire(o) {
    if (!o) return;
    for (let n = 1; n <= 18; n++) {
      const v = o[String(n)];
      if (!v) continue;
      const inp = document.querySelector('input[name="q' + n + '"][value="' + v + '"]');
      if (inp) inp.checked = true;
    }
  }

  function readProjections() {
    const rows = [];
    PROJ_ROWS.forEach(([code]) => {
      rows.push({
        line: code,
        prior: document.getElementById('proj-' + code + '-prior')?.value ?? '',
        current: document.getElementById('proj-' + code + '-cur')?.value ?? '',
        next: document.getElementById('proj-' + code + '-next')?.value ?? ''
      });
    });
    return rows;
  }

  function setProjections(rows) {
    const byLine = {};
    (rows || []).forEach((r) => {
      byLine[r.line] = r;
    });
    PROJ_ROWS.forEach(([code]) => {
      const r = byLine[code] || {};
      const a = document.getElementById('proj-' + code + '-prior');
      const b = document.getElementById('proj-' + code + '-cur');
      const c = document.getElementById('proj-' + code + '-next');
      if (a) a.value = r.prior ?? '';
      if (b) b.value = r.current ?? '';
      if (c) c.value = r.next ?? '';
    });
  }

  function readAttachments() {
    const o = {};
    ATTACH_KEYS.forEach(([k]) => {
      o[k] = !!document.getElementById('att-' + k)?.checked;
    });
    return o;
  }

  function setAttachments(o) {
    ATTACH_KEYS.forEach(([k]) => {
      const el = document.getElementById('att-' + k);
      if (el) el.checked = !!o?.[k];
    });
  }

  function exhibitDRowsFromDom() {
    const tb = document.getElementById('exhibitDBody');
    if (!tb) return [];
    return [...tb.querySelectorAll('tr[data-drow]')].map((tr) => ({
      date: tr.querySelector('[data-d="date"]')?.value ?? '',
      payee: tr.querySelector('[data-d="payee"]')?.value ?? '',
      amount: tr.querySelector('[data-d="amount"]')?.value ?? '',
      memo: tr.querySelector('[data-d="memo"]')?.value ?? ''
    }));
  }

  function renderExhibitD(rows) {
    const tb = document.getElementById('exhibitDBody');
    if (!tb) return;
    const list = rows && rows.length ? rows : [{ date: '', payee: '', amount: '', memo: '' }];
    tb.innerHTML = list
      .map(
        (r, i) =>
          '<tr data-drow="' +
          i +
          '">' +
          '<td><input data-d="date" type="text" value="' +
          escapeAttr(r.date) +
          '" style="width:100%;box-sizing:border-box" /></td>' +
          '<td><input data-d="payee" type="text" value="' +
          escapeAttr(r.payee) +
          '" style="width:100%;box-sizing:border-box" /></td>' +
          '<td><input data-d="amount" class="f425-money" type="text" inputmode="decimal" value="' +
          escapeAttr(r.amount) +
          '" style="width:100%;box-sizing:border-box" /></td>' +
          '<td><input data-d="memo" type="text" value="' +
          escapeAttr(r.memo) +
          '" style="width:100%;box-sizing:border-box" /></td>' +
          '<td class="no-print"><button type="button" class="btn secondary btn-exd-del" data-i="' +
          i +
          '">Remove</button></td>' +
          '</tr>'
      )
      .join('');
    tb.querySelectorAll('.btn-exd-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        if (tr && tb.rows.length > 1) tr.remove();
      });
    });
    tb.querySelectorAll('[data-d="amount"]').forEach((inp) => inp.addEventListener('input', syncLine21FromExhibitD));
  }

  function syncLine21FromExhibitD() {
    let sum = 0;
    exhibitDRowsFromDom().forEach((r) => {
      sum += parseFloat(String(r.amount || '').replace(/,/g, '')) || 0;
    });
    sum = Math.round(sum * 100) / 100;
    const l21 = document.getElementById('line21');
    if (l21) l21.value = sum ? String(sum) : '';
    recalcCash();
  }

  function renderExhibitCFromLines(lines, sourceLabel) {
    const tb = document.getElementById('exhibitCBody');
    if (!tb) return;
    if (!(lines || []).length) {
      tb.innerHTML =
        '<tr><td colspan="5" class="f425-note">Load from QuickBooks or paste a Deposit Detail export on the <strong>QB import</strong> tab.</td></tr>';
      return;
    }
    const isPaste = sourceLabel === 'paste';
    tb.innerHTML = lines
      .map((row) => {
        if (isPaste) {
          return (
            '<tr>' +
            '<td>' +
            escapeHtml(row.date) +
            '</td>' +
            '<td>' +
            escapeHtml(row.split || '') +
            '</td>' +
            '<td class="f425-money">' +
            escapeHtml(String(row.amount)) +
            '</td>' +
            '<td>' +
            escapeHtml(row.type || '') +
            '</td>' +
            '<td>' +
            escapeHtml([row.name, row.memo].filter(Boolean).join(' · ')) +
            '</td>' +
            '</tr>'
          );
        }
        return (
          '<tr>' +
          '<td>' +
          escapeHtml(row.depositTxnDate) +
          '</td>' +
          '<td>' +
          escapeHtml(row.bankAccountName || row.bankAccountId) +
          '</td>' +
          '<td class="f425-money">' +
          escapeHtml(String(row.lineAmount)) +
          '</td>' +
          '<td>' +
          escapeHtml((row.linkedTxnTypes || []).join(', ')) +
          '</td>' +
          '<td>' +
          escapeHtml(String(row.depositId)) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function gatherReportPayload() {
    const el = (id) => document.getElementById(id)?.value ?? '';
    return {
      questionnaire: readQuestionnaire(),
      paper: {
        monthLabel: el('paperMonth'),
        filedDate: el('paperFiled'),
        lineOfBusiness: el('paperLob'),
        naicsCode: el('paperNaics'),
        responsibleParty: el('paperRp'),
        debtorName: el('paperDebtor'),
        caseNumber: el('paperCase'),
        court: el('paperCourt')
      },
      cash: {
        line19: el('line19'),
        line20: el('line20'),
        line21: el('line21'),
        line22: el('line22'),
        line23: el('line23')
      },
      parts34: {
        line24: el('line24'),
        line25: el('line25'),
        line26: el('line26'),
        line27: el('line27'),
        line28: el('line28'),
        line29: el('line29'),
        line30: el('line30'),
        line31: el('line31')
      },
      projections: readProjections(),
      attachments: readAttachments(),
      exhibitC: {
        source: lastQboReceiptsData ? 'qbo' : lastQBPasteResult ? 'paste' : null,
        qbo: lastQboReceiptsData,
        paste: lastQBPasteResult,
        displayLines: lastQboReceiptsData?.exhibitCLines || lastQBPasteResult?.rows || []
      },
      exhibitD: exhibitDRowsFromDom(),
      notes: el('paperNotes')
    };
  }

  function applyReportPayload(data) {
    if (!data) return;
    const p = data.paper || {};
    const cash = data.cash || {};
    const parts = data.parts34 || {};
    const setv = (id, v) => {
      const e = document.getElementById(id);
      if (e && v != null) e.value = String(v);
    };
    setv('paperMonth', p.monthLabel);
    setv('paperFiled', p.filedDate);
    setv('paperLob', p.lineOfBusiness);
    setv('paperNaics', p.naicsCode);
    setv('paperRp', p.responsibleParty);
    setv('paperDebtor', p.debtorName);
    setv('paperCase', p.caseNumber);
    setv('paperCourt', p.court);
    setv('line19', cash.line19);
    setv('line20', cash.line20);
    setv('line21', cash.line21);
    setv('line22', cash.line22);
    setv('line23', cash.line23);
    setv('line24', parts.line24);
    setv('line25', parts.line25);
    setv('line26', parts.line26);
    setv('line27', parts.line27);
    setv('line28', parts.line28);
    setv('line29', parts.line29);
    setv('line30', parts.line30);
    setv('line31', parts.line31);
    setv('paperNotes', data.notes);
    setQuestionnaire(data.questionnaire);
    setProjections(data.projections);
    setAttachments(data.attachments);
    lastQboReceiptsData = data.exhibitC?.qbo || null;
    lastQBPasteResult = data.exhibitC?.paste || null;
    const lines = data.exhibitC?.displayLines || lastQboReceiptsData?.exhibitCLines || lastQBPasteResult?.rows || [];
    const src = data.exhibitC?.source || (lastQboReceiptsData ? 'qbo' : lastQBPasteResult ? 'paste' : null);
    renderExhibitCFromLines(lines, src === 'paste' ? 'paste' : 'qbo');
    renderExhibitD(data.exhibitD);
    recalcCash();
    const tt = document.getElementById('transferBody');
    const transfers = lastQboReceiptsData?.transfersInPeriod;
    if (tt) {
      if (!(transfers || []).length) tt.innerHTML = '<tr><td colspan="4">—</td></tr>';
      else {
        tt.innerHTML = transfers
          .map(
            (t) =>
              '<tr><td>' +
              escapeHtml(t.txnDate) +
              '</td><td>' +
              escapeHtml(String(t.from || '')) +
              '</td><td>' +
              escapeHtml(String(t.to || '')) +
              '</td><td class="f425-money">' +
              escapeHtml(String(t.amount)) +
              '</td></tr>'
          )
          .join('');
      }
    }
  }

  async function loadProfiles() {
    const r = await fetch('/api/form-425c/profiles');
    profilesState = await r.json();
    renderProfileEditors();
    syncReportSelectors();
  }

  async function fetchPriorOpening() {
    const msg = document.getElementById('receiptMsg');
    const companyId = document.getElementById('repCompany').value;
    const month = document.getElementById('repMonth').value;
    try {
      const r = await fetch('/api/form-425c/prior-balance?' + new URLSearchParams({ companyId, month }));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Request failed');
      if (d.line23 != null && d.line23 !== '') {
        document.getElementById('line19').value = String(d.line23);
        recalcCash();
        if (msg) msg.textContent = 'Line 19 set from prior month ' + (d.priorMonth || '') + ' ending cash (line 23).';
      } else if (msg) {
        msg.textContent = 'No saved report for prior month — enter line 19 manually.';
      }
    } catch (e) {
      if (msg) msg.textContent = String(e.message || e);
    }
  }

  async function saveReportToServer() {
    const companyId = document.getElementById('repCompany').value;
    const month = document.getElementById('repMonth').value;
    const msg = document.getElementById('receiptMsg');
    if (!companyId || !month) {
      alert('Select company and month.');
      return;
    }
    const body = { companyId, month, ...gatherReportPayload() };
    try {
      const r = await fetch('/api/form-425c/saved-report', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || await r.text());
      if (msg) msg.textContent = 'Report saved for ' + month + '.';
      refreshHistoryTable();
    } catch (e) {
      alert(String(e.message || e));
    }
  }

  async function loadSavedReport(companyId, month) {
    const r = await fetch('/api/form-425c/saved-report?' + new URLSearchParams({ companyId, month }));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Not found');
    const rep = d.report;
    document.getElementById('repCompany').value = rep.companyId || companyId;
    document.getElementById('repMonth').value = rep.month || month;
    applyProfileToPaper();
    applyReportPayload(rep);
  }

  async function refreshHistoryTable() {
    const host = document.getElementById('historyTableHost');
    if (!host) return;
    try {
      const r = await fetch('/api/form-425c/saved-reports');
      const d = await r.json();
      const rows = d.reports || [];
      if (!rows.length) {
        host.innerHTML = '<p class="f425-note">No saved reports yet.</p>';
        return;
      }
      host.innerHTML =
        '<table class="f425-table"><thead><tr><th>Company</th><th>Month</th><th>Updated</th><th></th></tr></thead><tbody>' +
        rows
          .map((row) => {
            return (
              '<tr><td>' +
              escapeHtml(row.companyId) +
              '</td><td>' +
              escapeHtml(row.month) +
              '</td><td>' +
              escapeHtml(row.updatedAt || '') +
              '</td><td class="no-print"><button type="button" class="btn primary btn-hist-load" data-c="' +
              escapeAttr(row.companyId) +
              '" data-m="' +
              escapeAttr(row.month) +
              '">Load</button></td></tr>'
            );
          })
          .join('') +
        '</tbody></table>';
      host.querySelectorAll('.btn-hist-load').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await loadSavedReport(btn.getAttribute('data-c'), btn.getAttribute('data-m'));
            document.querySelector('.f425-tabs button[data-tab="report"]')?.click();
            const msg = document.getElementById('receiptMsg');
            if (msg) msg.textContent = 'Loaded saved report.';
          } catch (e) {
            alert(String(e.message || e));
          }
        });
      });
    } catch (e) {
      host.innerHTML = '<p class="f425-note">' + escapeHtml(String(e.message || e)) + '</p>';
    }
  }

  async function parseQBPaste() {
    const msg = document.getElementById('qbPasteMsg');
    const companyId = document.getElementById('qbCompany')?.value || document.getElementById('repCompany')?.value;
    const text = document.getElementById('qbPasteText')?.value || '';
    if (msg) msg.textContent = 'Parsing…';
    try {
      const r = await fetch('/api/form-425c/parse-qb-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, companyId })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Parse failed');
      lastQBPasteResult = d;
      const tb = document.getElementById('qbPasteTableBody');
      if (tb) {
        if (!(d.rows || []).length) {
          tb.innerHTML = '<tr><td colspan="6" class="f425-note">' + escapeHtml(d.meta?.message || 'No rows') + '</td></tr>';
        } else {
          tb.innerHTML = d.rows
            .map(
              (row) =>
                '<tr><td>' +
                escapeHtml(row.date) +
                '</td><td>' +
                escapeHtml(row.type) +
                '</td><td class="f425-money">' +
                escapeHtml(String(row.amount)) +
                '</td><td>' +
                escapeHtml(row.split) +
                '</td><td>' +
                escapeHtml(row.name) +
                '</td><td>' +
                escapeHtml(row.memo) +
                '</td></tr>'
            )
            .join('');
        }
      }
      if (msg) msg.textContent = (d.meta && d.meta.message) || 'Parsed.';
    } catch (e) {
      if (msg) msg.textContent = String(e.message || e);
    }
  }

  function applyPasteTotalToLine20() {
    if (!lastQBPasteResult || lastQBPasteResult.total == null) {
      alert('Parse a paste first.');
      return;
    }
    document.getElementById('line20').value = String(lastQBPasteResult.total);
    lastQboReceiptsData = null;
    renderExhibitCFromLines(lastQBPasteResult.rows, 'paste');
    const tt = document.getElementById('transferBody');
    if (tt) tt.innerHTML = '<tr><td colspan="4">Transfers not extracted from paste — use QBO load on Form tab if needed.</td></tr>';
    recalcCash();
    document.querySelector('.f425-tabs button[data-tab="report"]')?.click();
    const msg = document.getElementById('receiptMsg');
    if (msg) msg.textContent = 'Line 20 and Exhibit C updated from paste (total $' + lastQBPasteResult.total + ').';
  }

  async function downloadPackageZip() {
    const msg = document.getElementById('mergeMsg');
    const filesEl = document.getElementById('mergeFiles');
    if (!filesEl?.files?.length) {
      if (msg) msg.textContent = 'Choose at least one PDF (or other file) to include.';
      return;
    }
    const fd = new FormData();
    for (const f of filesEl.files) {
      fd.append('files', f, f.name);
    }
    const manifest = {
      companyId: document.getElementById('repCompany')?.value,
      month: document.getElementById('repMonth')?.value,
      attachmentsChecklist: readAttachments(),
      generatedWith: 'IH35 Form 425C workspace'
    };
    fd.append('manifestJson', JSON.stringify(manifest));
    if (msg) msg.textContent = 'Building ZIP…';
    try {
      const r = await fetch('/api/form-425c/package', { method: 'POST', body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'IH35-Form425C-package.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      if (msg) msg.textContent = 'Download started.';
    } catch (e) {
      if (msg) msg.textContent = String(e.message || e);
    }
  }

  function wire() {
    document.getElementById('btnLoadBanks')?.addEventListener('click', async () => {
      const msg = document.getElementById('bankLoadMsg');
      if (msg) msg.textContent = 'Loading…';
      try {
        const r = await fetch('/api/form-425c/qbo-bank-accounts');
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'QBO error');
        bankAccountsCache = d.accounts || [];
        if (msg) msg.textContent = 'Loaded ' + bankAccountsCache.length + ' bank account(s).';
        renderProfileEditors();
      } catch (e) {
        if (msg) msg.textContent = String(e.message || e);
      }
    });

    document.getElementById('btnSaveProfiles')?.addEventListener('click', async () => {
      const body = collectProfilesFromDom();
      const r = await fetch('/api/form-425c/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        alert(await r.text());
        return;
      }
      profilesState = await r.json();
      alert('Profiles saved.');
    });

    document.getElementById('btnLoadReceipts')?.addEventListener('click', async () => {
      const msg = document.getElementById('receiptMsg');
      const companyId = document.getElementById('repCompany').value;
      const month = document.getElementById('repMonth').value;
      if (msg) msg.textContent = 'Loading…';
      try {
        const r = await fetch('/api/form-425c/receipts?' + new URLSearchParams({ companyId, month }));
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        lastQboReceiptsData = d;
        lastQBPasteResult = null;
        document.getElementById('line20').value = d.line20Total != null ? String(d.line20Total) : '';
        recalcCash();
        renderExhibitCFromLines(d.exhibitCLines || [], 'qbo');
        const tt = document.getElementById('transferBody');
        if (!(d.transfersInPeriod || []).length) {
          if (tt) tt.innerHTML = '<tr><td colspan="4">No Transfer transactions in QBO for this month.</td></tr>';
        } else if (tt) {
          tt.innerHTML = d.transfersInPeriod
            .map(
              (t) =>
                '<tr><td>' +
                escapeHtml(t.txnDate) +
                '</td><td>' +
                escapeHtml(String(t.from || '')) +
                '</td><td>' +
                escapeHtml(String(t.to || '')) +
                '</td><td class="f425-money">' +
                escapeHtml(String(t.amount)) +
                '</td></tr>'
            )
            .join('');
        }
        if (msg) {
          msg.textContent =
            'Exhibit C: ' +
            (d.exhibitCLines || []).length +
            ' line(s) · Total $' +
            d.line20Total +
            ' · Deposits scanned: ' +
            d.depositsConsidered;
        }
      } catch (e) {
        if (msg) msg.textContent = String(e.message || e);
      }
    });

    document.getElementById('btnPriorBalance')?.addEventListener('click', () => void fetchPriorOpening());
    document.getElementById('btnSaveReport')?.addEventListener('click', () => void saveReportToServer());
    document.getElementById('btnApplyQDefaults')?.addEventListener('click', () => {
      applyDefaultQuestionnaireFromProfile();
      const msg = document.getElementById('receiptMsg');
      if (msg) msg.textContent = 'Questionnaire set from profile defaults.';
    });

    document.getElementById('btnParseQbPaste')?.addEventListener('click', () => void parseQBPaste());
    document.getElementById('btnApplyPasteTo20')?.addEventListener('click', applyPasteTotalToLine20);

    document.getElementById('btnMergeZip')?.addEventListener('click', () => void downloadPackageZip());
    document.getElementById('btnRefreshHistory')?.addEventListener('click', () => void refreshHistoryTable());

    document.getElementById('btnAddExhibitDRow')?.addEventListener('click', () => {
      const tb = document.getElementById('exhibitDBody');
      if (!tb) return;
      renderExhibitD([...exhibitDRowsFromDom(), { date: '', payee: '', amount: '', memo: '' }]);
    });
    document.getElementById('btnRecalcLine21')?.addEventListener('click', syncLine21FromExhibitD);

    document.getElementById('repCompany')?.addEventListener('change', applyProfileToPaper);
    ['line19', 'line20', 'line21'].forEach((id) =>
      document.getElementById(id)?.addEventListener('input', recalcCash)
    );
  }

  function renderProjectionTable() {
    const host = document.getElementById('projectionTableHost');
    if (!host) return;
    host.innerHTML =
      '<table class="f425-table f425-proj-table" style="table-layout:fixed;width:100%">' +
      '<colgroup><col style="width:28%" /><col style="width:24%" /><col style="width:24%" /><col style="width:24%" /></colgroup>' +
      '<thead><tr><th>Line / description</th><th style="text-align:center">Prior month</th><th style="text-align:center">This month</th><th style="text-align:center">Next month (proj.)</th></tr></thead><tbody>' +
      PROJ_ROWS.map(([code, label]) => {
        return (
          '<tr><td><strong>' +
          escapeHtml(code) +
          '</strong> · ' +
          escapeHtml(label) +
          '</td><td><input id="proj-' +
          code +
          '-prior" type="text" style="width:100%;box-sizing:border-box" /></td><td><input id="proj-' +
          code +
          '-cur" type="text" style="width:100%;box-sizing:border-box" /></td><td><input id="proj-' +
          code +
          '-next" type="text" style="width:100%;box-sizing:border-box" /></td></tr>'
        );
      }).join('') +
      '</tbody></table>';
  }

  function renderAttachmentChecklist() {
    const host = document.getElementById('attachmentChecklistHost');
    if (!host) return;
    host.innerHTML = ATTACH_KEYS.map(
      ([k, lab]) =>
        '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px">' +
        '<input type="checkbox" id="att-' +
        k +
        '" /> ' +
        escapeHtml(lab) +
        '</label>'
    ).join('');
  }

  function defaultMonth() {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const rm = document.getElementById('repMonth');
    if (rm) rm.value = y + '-' + m;
    const pm = document.getElementById('paperMonth');
    if (pm) pm.placeholder = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  window.initForm425cApp = function initForm425cApp() {
    tabInit();
    renderQuestions();
    renderProjectionTable();
    renderAttachmentChecklist();
    renderExhibitD([{ date: '', payee: '', amount: '', memo: '' }]);
    wire();
    defaultMonth();
    loadProfiles().catch((e) => console.error(e));
    refreshHistoryTable().catch((e) => console.error(e));
  };
})();
