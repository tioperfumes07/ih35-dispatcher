/**
 * Vendor-focused Pay Bills workspace (Accounting → Pay bills).
 * Depends on maintenance.html globals: j, erpNotify, erpWriteHeaders, authFetchHeaders, escapeHtml,
 * cacheVendors, cacheBankAccounts, erp, loadAccountingBillPaymentLog, erpEnsureDriverPayeeVendorIds.
 */
(function () {
  const VBP = {
    mounted: false,
    vendorId: '',
    vendorName: '',
    bills: [],
    vendorCredits: [],
    vendorSummary: null,
    history: [],
    filterChip: 'all',
    historySort: { col: 'paymentDate', dir: 'desc' },
    selected: {},
    lastBatchId: '',
    successMode: false,
    panelRec: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '$0.00';
    return '$' + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function isoToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysBetweenIso(a, b) {
    if (!a || !b) return null;
    const d1 = new Date(a + 'T12:00:00');
    const d2 = new Date(b + 'T12:00:00');
    const ms = d2 - d1;
    return Math.floor(ms / 86400000);
  }

  function dueTone(dueIso, todayIso) {
    const t = todayIso || isoToday();
    if (!dueIso) return { cls: '', dot: '' };
    if (dueIso < t) return { cls: 'vbp-due--overdue', dot: '● ' };
    if (dueIso === t) return { cls: 'vbp-due--soon', dot: '' };
    const days = daysBetweenIso(t, dueIso);
    if (days != null && days >= 0 && days <= 7) return { cls: 'vbp-due--soon', dot: '' };
    return { cls: '', dot: '' };
  }

  function oldestBillAgeClass(oldestIso) {
    const t = isoToday();
    const d = daysBetweenIso(oldestIso, t);
    if (d == null || !oldestIso) return '';
    if (d > 90) return 'vbp-stat--bad';
    if (d > 30) return 'vbp-stat--warn';
    return '';
  }

  function vbpMount() {
    if (VBP.mounted) return;
    const root = el('vbpRoot');
    if (!root) return;
    root.innerHTML = `
<div class="vbp-layout">
  <div class="vbp-sec1">
    <label class="vbp-vendor-label" for="vbpVendorSearchInput">Select vendor to pay</label>
    <div class="vbp-vendor-wrap">
      <input id="vbpVendorSearchInput" class="vbp-vendor-search" type="text" autocomplete="off" placeholder="Search vendors…" />
      <div id="vbpVendorDropdown" class="vbp-vendor-dd hidden" role="listbox"></div>
    </div>
    <input type="hidden" id="vbpVendorQboId" />
    <div id="vbpVendorInfoBar" class="vbp-vendor-info hidden"></div>
    <div class="vbp-pay-card">
      <div class="vbp-pay-row">
        <div class="vbp-field vbp-field--grow">
          <span class="qb-l">Pay from account</span>
          <select id="vbpPayAccount" class="qb-in"></select>
          <div id="vbpPayAccountBal" class="vbp-acct-bal"></div>
        </div>
        <div class="vbp-field vbp-field--fixed">
          <span class="qb-l">Payment date</span>
          <input id="vbpPayDate" class="qb-in" type="date" />
        </div>
        <div class="vbp-field vbp-field--fixed">
          <span class="qb-l">Payment method</span>
          <select id="vbpPayMethod" class="qb-in">
            <option>Check</option>
            <option>ACH</option>
            <option>Wire</option>
            <option>Credit card</option>
            <option>Cash</option>
            <option>Other</option>
          </select>
        </div>
        <div id="vbpCheckWrap" class="vbp-field vbp-field--fixed">
          <span class="qb-l">Check # (if check)</span>
          <input id="vbpCheckNum" class="qb-in" placeholder="Optional" />
        </div>
        <div class="vbp-field vbp-field--grow">
          <span class="qb-l">Memo</span>
          <input id="vbpMemo" class="qb-in" placeholder="Applied to all payments in this batch" />
        </div>
      </div>
    </div>
  </div>

  <div id="vbpOpenBillsSection" class="vbp-sec2 hidden">
    <div class="vbp-sec-head">
      <div class="vbp-sec-head__left">
        <span class="vbp-sec-title">Open bills</span>
        <span id="vbpOpenCountBadge" class="vbp-pill vbp-pill--blue">0 bills</span>
      </div>
      <div class="vbp-chip-row" id="vbpBillFilterChips">
        <button type="button" class="mr-filter-chip" data-chip="all">All open</button>
        <button type="button" class="mr-filter-chip" data-chip="overdue">Overdue</button>
        <button type="button" class="mr-filter-chip" data-chip="week">Due this week</button>
        <button type="button" class="mr-filter-chip" data-chip="month">Due this month</button>
        <button type="button" class="mr-filter-chip" data-chip="allraw">All</button>
      </div>
    </div>
    <div id="vbpSuccessBanner" class="vbp-success hidden"></div>
    <div class="vbp-table-card erp-table-scroll">
      <table class="vbp-table vbp-open-table">
        <thead>
          <tr>
            <th class="vbp-th-check"><input type="checkbox" id="vbpSelectAll" title="Select all" /></th>
            <th class="vbp-th-doc">Bill #</th>
            <th>Bill date</th>
            <th>Due date</th>
            <th class="vbp-th-desc">Description</th>
            <th class="num">Original</th>
            <th class="num">Paid</th>
            <th class="num">Open</th>
            <th class="num">Credits</th>
            <th class="num">Payment amt</th>
          </tr>
        </thead>
        <tbody id="vbpOpenBody"></tbody>
      </table>
    </div>
    <div class="vbp-table-footer">
      <span id="vbpFooterSelected">No bills selected</span>
      <div class="vbp-footer-right">
        <span id="vbpFooterCredits" class="vbp-credits-applied hidden"></span>
        <span class="vbp-total-label">Total payment:</span>
        <span id="vbpFooterTotal" class="vbp-total-amt">$0.00</span>
      </div>
    </div>
    <button type="button" id="vbpSaveBtn" class="vbp-save-btn" disabled>Save payment — $0.00</button>
    <div id="vbpInlineErr" class="vbp-inline-err" role="alert"></div>
    <div id="vbpSaveProgress" class="mini-note hidden"></div>
  </div>

  <div id="vbpHistSection" class="vbp-sec3 hidden">
    <div class="vbp-sec-head vbp-sec-head--hist">
      <span id="vbpHistTitle" class="vbp-sec-title">Payment history</span>
      <div class="vbp-hist-controls">
        <label class="mini-note">From <input id="vbpHistFrom" class="qb-in" type="date" /></label>
        <label class="mini-note">To <input id="vbpHistTo" class="qb-in" type="date" /></label>
        <button type="button" class="qb-btn-add" id="vbpHistReload">Apply range</button>
        <div class="vbp-export-wrap">
          <button type="button" class="btn" id="vbpExportBtn">Export ▾</button>
          <div id="vbpExportMenu" class="vbp-export-menu hidden">
            <button type="button" data-fmt="csv">Excel / CSV</button>
            <button type="button" data-fmt="pdf">PDF (print)</button>
          </div>
        </div>
      </div>
    </div>
    <div class="vbp-table-card erp-table-scroll">
      <table class="vbp-table vbp-hist-table">
        <thead>
          <tr>
            <th class="vbp-sort" data-sort="paymentNumber">Payment #</th>
            <th class="vbp-sort" data-sort="paymentDate">Date</th>
            <th class="vbp-sort" data-sort="billDocNumber">Bill #</th>
            <th>Bill date</th>
            <th class="num">Bill amt</th>
            <th class="num">Paid</th>
            <th class="num">Remaining</th>
            <th>Method</th>
            <th>Account</th>
            <th>Check #</th>
            <th>Memo</th>
            <th>QBO</th>
          </tr>
        </thead>
        <tbody id="vbpHistBody"></tbody>
        <tfoot><tr id="vbpHistFoot"></tr></tfoot>
      </table>
    </div>
  </div>
</div>

<div id="vbpModalHost"></div>

<div id="vbpSidePanel" class="vbp-sidepanel hidden" aria-hidden="true">
  <div class="vbp-sidepanel__inner">
    <div class="vbp-sidepanel__head">
      <span>Payment detail</span>
      <button type="button" class="vbp-sidepanel__x" id="vbpPanelClose" aria-label="Close">×</button>
    </div>
    <div id="vbpPanelBody" class="vbp-sidepanel__body"></div>
  </div>
</div>`;
    VBP.mounted = true;
    vbpWire();
    vbpFillAccounts();
    const pd = el('vbpPayDate');
    if (pd && !pd.value) pd.value = isoToday();
    vbpSetDefaultHistRange();
    vbpToggleCheckWrap();
  }

  function vbpSetDefaultHistRange() {
    const to = el('vbpHistTo');
    const from = el('vbpHistFrom');
    if (!to || !from) return;
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 12);
    to.value = end.toISOString().slice(0, 10);
    from.value = start.toISOString().slice(0, 10);
  }

  function vbpFillAccounts() {
    const sel = el('vbpPayAccount');
    if (!sel) return;
    const banks = typeof cacheBankAccounts === 'function' ? cacheBankAccounts() : [];
    sel.innerHTML =
      banks
        .map(b => `<option value="${escapeHtml(String(b.qboId))}">${escapeHtml(b.name || b.qboId)}</option>`)
        .join('') || '<option value="">No bank accounts in cache — refresh QBO Master</option>';
    sel.addEventListener('change', vbpUpdateAcctBalNote);
    vbpUpdateAcctBalNote();
  }

  function vbpUpdateAcctBalNote() {
    const note = el('vbpPayAccountBal');
    if (note) note.textContent = 'Balance: refresh QBO Master in Lists for current balances.';
  }

  function vbpToggleCheckWrap() {
    const m = (el('vbpPayMethod') && el('vbpPayMethod').value) || '';
    const wrap = el('vbpCheckWrap');
    if (!wrap) return;
    wrap.style.display = m === 'Check' ? '' : 'none';
  }

  function vbpWire() {
    el('vbpVendorSearchInput')?.addEventListener('input', vbpOnVendorType);
    el('vbpVendorSearchInput')?.addEventListener('focus', vbpOnVendorType);
    document.addEventListener('click', e => {
      if (!e.target.closest('.vbp-vendor-wrap')) el('vbpVendorDropdown')?.classList.add('hidden');
      if (!e.target.closest('.vbp-export-wrap')) el('vbpExportMenu')?.classList.add('hidden');
    });
    el('vbpBillFilterChips')?.addEventListener('click', e => {
      const b = e.target.closest('[data-chip]');
      if (!b) return;
      VBP.filterChip = b.getAttribute('data-chip') || 'all';
      el('vbpBillFilterChips')?.querySelectorAll('.mr-filter-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      vbpRenderOpenBills();
    });
    el('vbpSelectAll')?.addEventListener('change', vbpSelectAll);
    el('vbpOpenBody')?.addEventListener('change', vbpOnOpenGridChange);
    el('vbpOpenBody')?.addEventListener('input', vbpOnOpenGridInput);
    el('vbpOpenBody')?.addEventListener('blur', vbpOnOpenGridBlur, true);
    el('vbpOpenBody')?.addEventListener('click', vbpOnOpenGridClick);
    el('vbpSaveBtn')?.addEventListener('click', vbpSaveClick);
    el('vbpPayMethod')?.addEventListener('change', vbpToggleCheckWrap);
    el('vbpHistReload')?.addEventListener('click', vbpLoadHistory);
    el('vbpHistBody')?.addEventListener('click', vbpHistClick);
    el('vbpHistBody')
      ?.closest('table')
      ?.querySelector('thead')
      ?.addEventListener('click', e => {
        const th = e.target.closest('.vbp-sort');
        if (!th) return;
        const col = th.getAttribute('data-sort');
        if (!col) return;
        if (VBP.historySort.col === col) VBP.historySort.dir = VBP.historySort.dir === 'asc' ? 'desc' : 'asc';
        else {
          VBP.historySort.col = col;
          VBP.historySort.dir = 'desc';
        }
        vbpRenderHistory();
      });
    el('vbpExportBtn')?.addEventListener('click', () => el('vbpExportMenu')?.classList.toggle('hidden'));
    el('vbpExportMenu')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-fmt]');
      if (!btn) return;
      el('vbpExportMenu').classList.add('hidden');
      vbpExport(btn.getAttribute('data-fmt'));
    });
    el('vbpPanelClose')?.addEventListener('click', vbpClosePanel);
    el('vbpSidePanel')?.addEventListener('click', e => {
      if (e.target.id === 'vbpSidePanel') vbpClosePanel();
    });
  }

  function vbpVendorListFiltered(q) {
    const vendors = typeof cacheVendors === 'function' ? cacheVendors() : [];
    const qq = String(q || '').trim().toLowerCase();
    return vendors.filter(v => !qq || String(v.name || '').toLowerCase().includes(qq));
  }

  async function vbpOnVendorType() {
    const dd = el('vbpVendorDropdown');
    const inp = el('vbpVendorSearchInput');
    if (!dd || !inp) return;
    let list = vbpVendorListFiltered(inp.value).slice(0, 80);
    if (window.__accountingDriverBillPayMode && typeof erpEnsureDriverPayeeVendorIds === 'function') {
      const idSet = await erpEnsureDriverPayeeVendorIds();
      list = list.filter(v => idSet.has(String(v.qboId || '').trim()));
    }
    if (!list.length) {
      dd.innerHTML = '<div class="vbp-dd-item mini-note">No vendors</div>';
      dd.classList.remove('hidden');
      return;
    }
    dd.innerHTML = list
      .map(
        v => `<button type="button" class="vbp-dd-item" data-id="${escapeHtml(String(v.qboId))}" data-name="${escapeHtml(
          v.name || ''
        )}">${escapeHtml(v.name || '')}</button>`
      )
      .join('');
    dd.classList.remove('hidden');
    dd.onclick = ev => {
      const btn = ev.target.closest('.vbp-dd-item[data-id]');
      if (!btn) return;
      VBP.vendorId = btn.getAttribute('data-id') || '';
      VBP.vendorName = btn.getAttribute('data-name') || '';
      inp.value = VBP.vendorName;
      el('vbpVendorQboId').value = VBP.vendorId;
      dd.classList.add('hidden');
      vbpLoadVendorData();
    };
  }

  async function vbpLoadVendorData() {
    vbpClearSuccess();
    if (!VBP.vendorId) return;
    try {
      const data = await j('/api/bills/open?vendor_id=' + encodeURIComponent(VBP.vendorId));
      VBP.bills = data.bills || [];
      VBP.vendorCredits = data.vendorCredits || [];
      VBP.vendorSummary = data.vendorSummary || null;
      vbpRenderVendorBar();
      el('vbpOpenBillsSection')?.classList.remove('hidden');
      el('vbpHistSection')?.classList.remove('hidden');
      VBP.selected = {};
      el('vbpSelectAll').checked = false;
      const chip = el('vbpBillFilterChips')?.querySelector('[data-chip="all"]');
      el('vbpBillFilterChips')?.querySelectorAll('.mr-filter-chip').forEach(x => x.classList.remove('active'));
      chip?.classList.add('active');
      VBP.filterChip = 'all';
      vbpRenderOpenBills();
      vbpUpdateFooter();
      vbpLoadHistory();
      el('vbpHistTitle').textContent = 'Payment history — ' + (VBP.vendorName || 'Vendor');
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpRenderVendorBar() {
    const bar = el('vbpVendorInfoBar');
    if (!bar) return;
    const s = VBP.vendorSummary || {};
    const bal = Number(s.openBalanceSum) || 0;
    const balCls = bal > 0 ? 'vbp-stat--bad' : 'vbp-stat--ok';
    const oldest = s.oldestOpenBillDate || '—';
    const ageCls = oldestBillAgeClass(oldest);
    const od = Number(s.overdueCount) || 0;
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <span class="vbp-vendor-name">${escapeHtml(VBP.vendorName)}</span>
      <span class="${balCls}">Open balance: ${money(bal)}</span>
      <span class="${ageCls}">Oldest bill: ${escapeHtml(oldest)}</span>
      <span>${Number(s.openBillCount) || 0} open bills</span>
      <span class="${od > 0 ? 'vbp-stat--bad' : ''}">${od} overdue</span>`;
  }

  function vbpFilteredBills() {
    const t = isoToday();
    return (VBP.bills || []).filter(b => {
      const due = (b.dueDate || '').slice(0, 10) || (b.txnDate || '').slice(0, 10);
      const days = daysBetweenIso(due, t);
      switch (VBP.filterChip) {
        case 'overdue':
          return due && due < t;
        case 'week':
          return days != null && days >= 0 && days <= 7;
        case 'month':
          return days != null && days >= 0 && days <= 31;
        case 'allraw':
          return true;
        default:
          return true;
      }
    });
  }

  function vbpRenderOpenBills() {
    const tb = el('vbpOpenBody');
    const badge = el('vbpOpenCountBadge');
    if (!tb) return;
    const rows = vbpFilteredBills();
    if (badge) badge.textContent = `${rows.length} bills`;
    const credits = VBP.vendorCredits || [];
    let html = '';
    for (const c of credits) {
      html += `<tr class="vbp-credit-row" data-credit-id="${escapeHtml(String(c.id))}">
        <td><input type="checkbox" class="vbp-credit-chk" /></td>
        <td colspan="2"><span class="vbp-credit-tag">Credit</span> ${escapeHtml(String(c.docNumber || c.id))}</td>
        <td>${escapeHtml(String(c.txnDate || '').slice(0, 10))}</td>
        <td class="mini-note">Vendor credit (informational — apply in QuickBooks)</td>
        <td class="num">—</td><td class="num">—</td><td class="num">—</td>
        <td class="num vbp-credit-amt">${money(c.openBalance)}</td>
        <td class="num">—</td>
      </tr>`;
    }
    const today = isoToday();
    for (const b of rows) {
      const id = String(b.id || '');
      const open = Number(b.balance) || 0;
      const orig = Number(b.totalAmt) || 0;
      const paid = Number(b.amountPaid) || 0;
      const due = (b.dueDate || '').slice(0, 10);
      const tone = dueTone(due, today);
      const overdueRow = due && due < today ? ' vbp-row--overdue' : '';
      const partial = paid > 0.01 && paid < orig - 0.01;
      const desc = String(b.description || b.privateNote || '').trim();
      const credAvail = '—';
      html += `<tr class="vbp-bill-row${overdueRow}" data-bill-id="${escapeHtml(id)}" data-open="${open}" data-doc="${escapeHtml(
        String(b.docNumber || '')
      )}">
        <td><input type="checkbox" class="vbp-row-chk" /></td>
        <td><button type="button" class="vbp-linkbtn vbp-bill-open" data-bill="${escapeHtml(id)}">${escapeHtml(
        String(b.docNumber || '—')
      )}</button>${b.recurringSeries ? '<div><span class="vbp-series-tag">Series</span></div>' : ''}${
        partial ? '<div><span class="vbp-partial-pill">Partial</span></div>' : ''
      }</td>
        <td>${escapeHtml(String(b.txnDate || '').slice(0, 10))}</td>
        <td class="${tone.cls}">${tone.dot}${escapeHtml(due)}</td>
        <td><span class="vbp-desc-ellip" title="${escapeHtml(desc)}">${escapeHtml(desc) || '—'}</span></td>
        <td class="num">${money(orig)}</td>
        <td class="num ${paid > 0.01 ? 'vbp-paid' : ''}">${paid > 0.01 ? money(paid) : '—'}</td>
        <td class="num"><strong>${money(open)}</strong></td>
        <td class="num vbp-credit-col">${credAvail}</td>
        <td class="num"><input type="number" class="vbp-pay-inp qb-in" step="0.01" min="0" disabled data-max="${open}" /></td>
      </tr>`;
    }
    tb.innerHTML = html || '<tr><td colspan="10" class="mini-note">No open bills.</td></tr>';
  }

  function vbpOnOpenGridChange(ev) {
    const t = ev.target;
    if (t.classList.contains('vbp-row-chk')) {
      const tr = t.closest('tr');
      const id = tr && tr.getAttribute('data-bill-id');
      const inp = tr && tr.querySelector('.vbp-pay-inp');
      const open = Number(tr && tr.dataset.open) || 0;
      if (t.checked && id) {
        VBP.selected[id] = { pay: open };
        tr.classList.add('vbp-row--sel');
        if (inp) {
          inp.disabled = false;
          inp.value = open.toFixed(2);
        }
      } else if (id) {
        delete VBP.selected[id];
        tr.classList.remove('vbp-row--sel');
        if (inp) {
          inp.disabled = true;
          inp.value = '';
          inp.classList.remove('vbp-pay-inp--err');
        }
      }
      vbpUpdateFooter();
    }
  }

  function vbpSelectAll() {
    const on = el('vbpSelectAll')?.checked;
    el('vbpOpenBody')?.querySelectorAll('tr.vbp-bill-row').forEach(tr => {
      const chk = tr.querySelector('.vbp-row-chk');
      const id = tr.getAttribute('data-bill-id');
      const open = Number(tr.dataset.open) || 0;
      if (chk) chk.checked = !!on;
      const inp = tr.querySelector('.vbp-pay-inp');
      if (on && id) {
        VBP.selected[id] = { pay: open };
        tr.classList.add('vbp-row--sel');
        if (inp) {
          inp.disabled = false;
          inp.value = open.toFixed(2);
        }
      } else if (id) {
        delete VBP.selected[id];
        tr.classList.remove('vbp-row--sel');
        if (inp) {
          inp.disabled = true;
          inp.value = '';
        }
      }
    });
    vbpUpdateFooter();
  }

  function vbpOnOpenGridInput(ev) {
    const inp = ev.target.closest('.vbp-pay-inp');
    if (!inp) return;
    const tr = inp.closest('tr');
    const id = tr && tr.getAttribute('data-bill-id');
    const max = Number(inp.dataset.max) || 0;
    let v = Number(inp.value);
    if (!Number.isFinite(v)) v = 0;
    if (v > max + 0.0001) {
      inp.classList.add('vbp-pay-inp--err');
      inp.title = `Cannot exceed open balance of ${money(max)}`;
    } else {
      inp.classList.remove('vbp-pay-inp--err');
      inp.title = '';
    }
    if (id && VBP.selected[id]) VBP.selected[id].pay = v;
    vbpUpdateFooter();
  }

  function vbpOnOpenGridBlur(ev) {
    const inp = ev.target.closest('.vbp-pay-inp');
    if (!inp || inp.disabled) return;
    const max = Number(inp.dataset.max) || 0;
    let v = Number(inp.value);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, Math.min(max, Math.round(v * 100) / 100));
    inp.value = v > 0 ? v.toFixed(2) : '';
    const tr = inp.closest('tr');
    const id = tr && tr.getAttribute('data-bill-id');
    if (id && VBP.selected[id]) VBP.selected[id].pay = v;
    vbpUpdateFooter();
  }

  function vbpOnOpenGridClick(ev) {
    const btn = ev.target.closest('.vbp-bill-open');
    if (!btn) return;
    const id = btn.getAttribute('data-bill');
    if (id) vbpOpenBillModal(id);
  }

  function vbpSumSelected() {
    let t = 0;
    for (const id of Object.keys(VBP.selected)) {
      const row = el('vbpOpenBody')?.querySelector(`tr[data-bill-id="${id}"]`);
      const inp = row && row.querySelector('.vbp-pay-inp');
      let v = inp ? Number(inp.value) : Number(VBP.selected[id].pay);
      if (!Number.isFinite(v)) v = 0;
      const mx = row ? Number(row.dataset.open) || 0 : v;
      v = Math.min(mx, Math.max(0, v));
      t += v;
    }
    return Math.round(t * 100) / 100;
  }

  function vbpUpdateFooter() {
    const n = Object.keys(VBP.selected).length;
    const fs = el('vbpFooterSelected');
    if (fs) fs.textContent = n ? `${n} bills selected` : 'No bills selected';
    const tot = vbpSumSelected();
    const ft = el('vbpFooterTotal');
    if (ft) ft.textContent = money(tot);
    const sb = el('vbpSaveBtn');
    if (sb) {
      sb.textContent = 'Save payment — ' + money(tot);
      sb.disabled = !n || !(tot > 0);
    }
    const leg = el('bpSelectionTotal');
    if (leg) leg.textContent = `Draft payment total: ${money(tot)}`;
    if (typeof syncErpDedicatedModalChrome === 'function') syncErpDedicatedModalChrome();
  }

  function vbpValidate() {
    const err = el('vbpInlineErr');
    if (err) err.textContent = '';
    if (!VBP.vendorId) return 'Select a vendor.';
    if (!el('vbpPayAccount')?.value) return 'Choose pay from account.';
    if (!el('vbpPayDate')?.value) return 'Choose payment date.';
    if (!el('vbpPayMethod')?.value) return 'Choose payment method.';
    const ids = Object.keys(VBP.selected);
    if (!ids.length) return 'Select at least one bill.';
    for (const id of ids) {
      const row = el('vbpOpenBody')?.querySelector(`tr[data-bill-id="${id}"]`);
      const inp = row && row.querySelector('.vbp-pay-inp');
      const max = row ? Number(row.dataset.open) || 0 : 0;
      let v = inp ? Number(inp.value) : 0;
      if (!Number.isFinite(v)) v = 0;
      if (!(v >= 0.01)) return 'Each selected bill needs payment amount > 0.';
      if (v - max > 0.01) return 'A payment amount exceeds open balance.';
    }
    return '';
  }

  function vbpSaveClick() {
    const msg = vbpValidate();
    if (msg) {
      const err = el('vbpInlineErr');
      if (err) err.textContent = msg;
      erpNotify(msg, 'warning');
      return;
    }
    vbpConfirmModal();
  }

  function vbpConfirmModal() {
    const host = el('vbpModalHost');
    if (!host) return;
    const rows = Object.keys(VBP.selected)
      .map(id => {
        const r = el('vbpOpenBody')?.querySelector(`tr[data-bill-id="${id}"]`);
        const doc = r?.dataset.doc || id;
        const billMeta = (VBP.bills || []).find(b => String(b.id) === String(id));
        const bdate = (billMeta && billMeta.txnDate) || '';
        const inp = r?.querySelector('.vbp-pay-inp');
        const pay = inp ? Number(inp.value) : 0;
        const open = r ? Number(r.dataset.open) : 0;
        const rem = Math.max(0, Math.round((open - pay) * 100) / 100);
        const pnum = '(assigned at save)';
        return `<tr><td>${escapeHtml(doc)}</td><td>${escapeHtml(String(bdate).slice(0, 10))}</td><td class="num">${money(
          pay
        )}</td><td class="mini-note">${pnum}</td><td class="num">${money(rem)}</td></tr>`;
      })
      .join('');
    host.innerHTML = `
<div class="vbp-modal-backdrop">
  <div class="vbp-modal">
    <div class="vbp-modal__title">Confirm payment</div>
    <div class="mini-note">Pay to: <strong>${escapeHtml(VBP.vendorName)}</strong></div>
    <div class="mini-note">Payment date: ${escapeHtml(el('vbpPayDate').value)} · Method: ${escapeHtml(
      el('vbpPayMethod').value
    )} · Account: ${escapeHtml(el('vbpPayAccount').selectedOptions[0]?.text || '')}</div>
    <table class="vbp-modal-table"><thead><tr><th>Bill #</th><th>Bill date</th><th>Payment amt</th><th>Payment #</th><th>Remaining after</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="vbp-modal__actions">
      <button type="button" class="btn" id="vbpModalCancel">Cancel</button>
      <button type="button" class="qb-btn-primary" id="vbpModalOk">Save payment</button>
    </div>
  </div>
</div>`;
    el('vbpModalCancel').onclick = () => {
      host.innerHTML = '';
    };
    el('vbpModalOk').onclick = () => {
      host.innerHTML = '';
      vbpExecuteSave();
    };
  }

  async function vbpExecuteSave() {
    const prog = el('vbpSaveProgress');
    const payments = [];
    let i = 0;
    for (const id of Object.keys(VBP.selected)) {
      i++;
      if (prog) {
        prog.classList.remove('hidden');
        prog.textContent = `Saving payment ${i} of ${Object.keys(VBP.selected).length}…`;
      }
      const row = el('vbpOpenBody')?.querySelector(`tr[data-bill-id="${id}"]`);
      const inp = row && row.querySelector('.vbp-pay-inp');
      const open = row ? Number(row.dataset.open) : 0;
      const amt = inp ? Number(inp.value) : 0;
      payments.push({ bill_qbo_id: id, payment_amount: amt, open_balance: open });
    }
    try {
      const body = {
        vendor_id: VBP.vendorId,
        payment_date: el('vbpPayDate').value,
        payment_method: el('vbpPayMethod').value,
        payment_account: el('vbpPayAccount').value,
        check_number: el('vbpPayMethod').value === 'Check' ? el('vbpCheckNum').value : '',
        memo: el('vbpMemo').value,
        payments
      };
      const data = await j('/api/bills/payments/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {}) },
        body: JSON.stringify(body)
      });
      VBP.lastBatchId = data.batch_id || '';
      if (prog) prog.classList.add('hidden');
      vbpAfterSavePrompt(data);
    } catch (e) {
      if (prog) prog.classList.add('hidden');
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpAfterSavePrompt(data) {
    const payList = (data.payments || []).map(p => p.payment_number).join(', ');
    const ok =
      typeof confirm === 'function' &&
      confirm('Payment saved. Post to QuickBooks?\n\nOK = Post now\nCancel = Post later');
    if (ok) {
      j('/api/bills/payments/post-to-qbo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {}) },
        body: JSON.stringify({ batch_id: VBP.lastBatchId })
      })
        .then(() => {
          erpNotify('Posted to QuickBooks.', 'success');
          vbpShowSuccess(data);
          vbpLoadVendorData();
          if (typeof loadAccountingBillPaymentLog === 'function') loadAccountingBillPaymentLog();
        })
        .catch(e => {
          erpNotify(e.message || String(e), 'error');
          vbpShowSuccess(data);
          vbpLoadVendorData();
        });
    } else {
      vbpShowSuccess(data);
      vbpLoadVendorData();
    }
    if (typeof loadAccountingBillPaymentLog === 'function') loadAccountingBillPaymentLog();
  }

  function vbpShowSuccess(data) {
    VBP.successMode = true;
    const box = el('vbpSuccessBanner');
    const payList = (data.payments || []).map(p => p.payment_number).join(', ');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `<div class="vbp-success__icon">✓</div>
        <div><strong>Payment saved successfully</strong></div>
        <div class="mini-note">Paid ${(data.payments || []).length} bill(s). Payment numbers: ${escapeHtml(payList)}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="qb-btn-add" id="vbpSuccMore">Pay more bills</button>
          <button type="button" class="qb-btn-add" id="vbpSuccHist">View payment history</button>
          <button type="button" class="btn" id="vbpSuccNew">New vendor</button>
        </div>`;
      el('vbpSuccMore').onclick = () => vbpClearSuccess();
      el('vbpSuccHist').onclick = () => el('vbpHistSection')?.scrollIntoView({ behavior: 'smooth' });
      el('vbpSuccNew').onclick = () => {
        VBP.vendorId = '';
        VBP.vendorName = '';
        el('vbpVendorSearchInput').value = '';
        el('vbpVendorQboId').value = '';
        el('vbpVendorInfoBar').classList.add('hidden');
        el('vbpOpenBillsSection').classList.add('hidden');
        el('vbpHistSection').classList.add('hidden');
        vbpClearSuccess();
      };
    }
    el('vbpOpenBillsSection')?.querySelector('.vbp-table-card')?.classList.add('hidden');
    el('vbpSaveBtn')?.classList.add('hidden');
    el('vbpOpenBillsSection')?.querySelector('.vbp-table-footer')?.classList.add('hidden');
  }

  function vbpClearSuccess() {
    VBP.successMode = false;
    el('vbpSuccessBanner')?.classList.add('hidden');
    el('vbpOpenBillsSection')?.querySelector('.vbp-table-card')?.classList.remove('hidden');
    el('vbpSaveBtn')?.classList.remove('hidden');
    el('vbpOpenBillsSection')?.querySelector('.vbp-table-footer')?.classList.remove('hidden');
  }

  async function vbpLoadHistory() {
    if (!VBP.vendorId) return;
    const qs = new URLSearchParams({
      vendor_id: VBP.vendorId,
      startDate: el('vbpHistFrom')?.value || '',
      endDate: el('vbpHistTo')?.value || ''
    });
    try {
      const data = await j('/api/bills/payments/history?' + qs.toString());
      VBP.history = data.payments || [];
      vbpRenderHistory();
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpHistSort(arr) {
    const { col, dir } = VBP.historySort;
    const m = dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      const va = String(a[col] ?? '');
      const vb = String(b[col] ?? '');
      if (col === 'paymentAmount' || col === 'originalAmount') {
        return (Number(a[col]) - Number(b[col])) * m;
      }
      return va.localeCompare(vb) * m;
    });
  }

  function vbpRenderHistory() {
    const tb = el('vbpHistBody');
    const foot = el('vbpHistFoot');
    if (!tb) return;
    const rows = vbpHistSort(VBP.history);
    let prevBill = '';
    let html = '';
    for (const r of rows) {
      const bill = String(r.billDocNumber || '');
      const grp = Boolean(prevBill) && bill === prevBill;
      prevBill = bill;
      const st = String(r.qboStatus || 'pending');
      const pill =
        st === 'posted'
          ? '<span class="vbp-pill vbp-pill--ok">Posted</span>'
          : st === 'error'
            ? '<span class="vbp-pill vbp-pill--err">Error</span>'
            : '<span class="vbp-pill vbp-pill--pend">Pending</span>';
      const rem = Number(r.remainingBalanceAfter);
      const remCls = rem <= 0.01 ? 'vbp-stat--ok' : 'vbp-stat--bad';
      const indent = grp ? ' vbp-hist-indent' : '';
      const border = !grp && bill ? ' vbp-hist-group' : '';
      html += `<tr class="${border}${indent}" data-paynum="${escapeHtml(String(r.paymentNumber))}" data-id="${escapeHtml(
        String(r.id)
      )}">
        <td><button type="button" class="vbp-linkbtn vbp-mono vbp-paynum">${escapeHtml(String(r.paymentNumber))}</button></td>
        <td>${escapeHtml(String(r.paymentDate || '').slice(0, 10))}</td>
        <td><button type="button" class="vbp-linkbtn vbp-bill-open-hist" data-bill="${escapeHtml(
          String(r.billQboId || '')
        )}">${escapeHtml(bill)}</button></td>
        <td>${escapeHtml(String(r.billDate || '').slice(0, 10))}</td>
        <td class="num">${money(r.originalAmount)}</td>
        <td class="num">${money(r.paymentAmount)}</td>
        <td class="num ${remCls}">${money(rem)}</td>
        <td>${escapeHtml(String(r.paymentMethod || ''))}</td>
        <td>${escapeHtml(String(r.paymentAccountName || ''))}</td>
        <td>${escapeHtml(String(r.checkNum || '—'))}</td>
        <td class="mini-note">${escapeHtml(String(r.memo || ''))}</td>
        <td>${pill}</td>
      </tr>`;
    }
    tb.innerHTML = html || '<tr><td colspan="12" class="mini-note">No payments in range.</td></tr>';
    const sum = rows.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0);
    if (foot) {
      foot.innerHTML = `<td colspan="5" class="num"><strong>Total paid to ${escapeHtml(VBP.vendorName)}:</strong></td>
        <td class="num"><strong>${money(sum)}</strong></td><td colspan="6"></td>`;
    }
  }

  function vbpHistClick(ev) {
    const pn = ev.target.closest('.vbp-paynum');
    if (pn) {
      const tr = pn.closest('tr');
      const num = tr && tr.getAttribute('data-paynum');
      if (num) vbpOpenPaymentPanel(num);
      return;
    }
    const b = ev.target.closest('.vbp-bill-open-hist');
    if (b) {
      const id = b.getAttribute('data-bill');
      if (id) vbpOpenBillModal(id);
    }
  }

  async function vbpOpenPaymentPanel(paymentNumber) {
    const url =
      '/api/bills/payment/' +
      encodeURIComponent(paymentNumber) +
      '?vendor_id=' +
      encodeURIComponent(VBP.vendorId || '');
    try {
      const data = await j(url);
      VBP.panelRec = data.payment;
      const p = data.payment;
      const series = data.seriesForBill || [];
      const curId = p.id;
      let serHtml =
        '<div class="vbp-panel-subtitle">All payments for this bill</div><table class="vbp-mini-table"><thead><tr><th>#</th><th>Date</th><th>Amt</th><th>Balance after</th></tr></thead><tbody>';
      for (const s of series) {
        const hi = s.id === curId ? ' class="vbp-mini-hi"' : '';
        serHtml += `<tr${hi}><td>${escapeHtml(String(s.paymentNumber))}</td><td>${escapeHtml(
          String(s.paymentDate || '').slice(0, 10)
        )}</td><td>${money(s.paymentAmount)}</td><td>${money(s.remainingBalanceAfter)}</td></tr>`;
      }
      serHtml += '</tbody></table>';
      const batchFull = escapeHtml(String(p.batchId || ''));
      el('vbpPanelBody').innerHTML = `
        <div class="vbp-panel-pnum">${escapeHtml(String(p.paymentNumber))}</div>
        ${vbpPanelRow('Vendor', String(p.vendorName || ''))}
        ${vbpPanelRow('Payment date', String(p.paymentDate || ''))}
        ${vbpPanelRow('Method', String(p.paymentMethod || ''))}
        ${vbpPanelRow('Account', String(p.paymentAccountName || ''))}
        ${vbpPanelRow('Check #', p.checkNum || '—')}
        ${vbpPanelRow('Memo', p.memo || '—')}
        ${vbpPanelRow('QBO status', String(p.qboStatus || ''))}
        <div class="vbp-panel-row"><span>Batch ID</span><span><code class="vbp-mono">${batchFull}</code> <button type="button" class="qb-btn-add" id="vbpCopyBatch">Copy</button></span></div>
        <div class="vbp-panel-row"><span>Bill # paid</span><span><button type="button" class="vbp-linkbtn" id="vbpPanelBill">${escapeHtml(
          String(p.billDocNumber || '')
        )}</button></span></div>
        ${vbpPanelRow('Bill amount', money(p.originalAmount))}
        ${vbpPanelRow('Payment amount', money(p.paymentAmount))}
        ${vbpPanelRow('Remaining', money(p.remainingBalanceAfter))}
        ${series.length > 1 ? serHtml : ''}
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
          ${
            p.qboStatus === 'pending'
              ? '<button type="button" class="qb-btn-primary" id="vbpPanelPost">Post to QuickBooks</button>'
              : ''
          }
          ${
            p.qboStatus === 'pending'
              ? '<button type="button" class="btn" style="border-color:#c5221f;color:#c5221f" id="vbpPanelVoid">Void this payment</button>'
              : '<p class="mini-note">To void posted payments, use QuickBooks.</p>'
          }
          <button type="button" class="btn" id="vbpPanelPrint">Print receipt</button>
        </div>`;
      el('vbpCopyBatch')?.addEventListener('click', () => {
        const t = String(p.batchId || '');
        if (navigator.clipboard && t) void navigator.clipboard.writeText(t);
      });
      el('vbpPanelBill')?.addEventListener('click', () => vbpOpenBillModal(p.billQboId));
      el('vbpPanelPost')?.addEventListener('click', () => vbpPanelPost(p.paymentNumber));
      el('vbpPanelVoid')?.addEventListener('click', () => vbpPanelVoid(p.id));
      el('vbpPanelPrint')?.addEventListener('click', () => vbpPrintReceipt(p));
      el('vbpSidePanel')?.classList.remove('hidden');
      requestAnimationFrame(() => el('vbpSidePanel')?.classList.add('vbp-sidepanel--open'));
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpPanelRow(label, val) {
    const v = typeof val === 'string' ? escapeHtml(val) : val;
    return `<div class="vbp-panel-row"><span>${escapeHtml(label)}</span><span>${v}</span></div>`;
  }

  function vbpClosePanel() {
    el('vbpSidePanel')?.classList.remove('vbp-sidepanel--open');
    el('vbpSidePanel')?.classList.add('hidden');
  }

  async function vbpPanelPost(paymentNumber) {
    try {
      await j('/api/bills/payments/post-to-qbo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {}) },
        body: JSON.stringify({ payment_numbers: [paymentNumber] })
      });
      erpNotify('Posted.', 'success');
      vbpClosePanel();
      vbpLoadHistory();
      if (typeof loadAccountingBillPaymentLog === 'function') loadAccountingBillPaymentLog();
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  async function vbpPanelVoid(id) {
    if (!confirm('Void this pending payment in the app?')) return;
    try {
      await j('/api/bills/payments/void-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {}) },
        body: JSON.stringify({ id })
      });
      vbpClosePanel();
      vbpLoadHistory();
      vbpLoadVendorData();
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpPrintReceipt(p) {
    const w = window.open('', '_blank');
    if (!w) return;
    const co = 'IH 35 Transportation LLC';
    const addr = 'Laredo, TX';
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
      <style>body{font-family:system-ui;padding:24px} .box{border:1px solid #333;padding:12px;margin:12px 0} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:6px;font-size:12px} .t{text-align:right} h1{font-size:18px}</style></head><body>
      <div><strong>${co}</strong><br>${addr}</div>
      <h1 style="text-align:right;border:2px solid #333;padding:8px;display:inline-block;float:right">PAYMENT RECEIPT</h1>
      <div style="clear:both"></div>
      <div class="box"><strong>Payment #:</strong> ${escapeHtml(String(p.paymentNumber))}<br>
      <strong>Date:</strong> ${escapeHtml(String(p.paymentDate))}<br>
      <strong>Vendor:</strong> ${escapeHtml(String(p.vendorName))}<br>
      <strong>Method:</strong> ${escapeHtml(String(p.paymentMethod))}<br>
      <strong>Account:</strong> ${escapeHtml(String(p.paymentAccountName))}</div>
      <table><thead><tr><th>Bill #</th><th>Bill date</th><th>Description</th><th class="t">Original</th><th class="t">Applied</th><th class="t">Remaining</th></tr></thead>
      <tbody><tr><td>${escapeHtml(String(p.billDocNumber))}</td><td>${escapeHtml(
      String(p.billDate || '').slice(0, 10)
    )}</td><td>${escapeHtml(String(p.description || ''))}</td><td class="t">${money(p.originalAmount)}</td><td class="t">${money(
      p.paymentAmount
    )}</td><td class="t">${money(p.remainingBalanceAfter)}</td></tr></tbody></table>
      <p style="text-align:right;font-size:16px;font-weight:bold">TOTAL PAID: ${money(p.paymentAmount)}</p>
      ${p.memo ? `<p>Memo: ${escapeHtml(String(p.memo))}</p>` : ''}
      <p>Posted to QuickBooks: ${p.qboStatus === 'posted' ? 'Yes' : p.qboStatus === 'pending' ? 'Pending' : '—'}</p>
      <p>Authorized by: __________________ &nbsp; Date: __________</p>
      <footer class="mini-note">${co} — Payment Receipt · Page 1 of 1</footer>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  async function vbpOpenBillModal(billId) {
    try {
      const data = await j('/api/bills/bill-detail?bill_qbo_id=' + encodeURIComponent(billId));
      const b = data.bill;
      erpNotify(
        `Bill ${escapeHtml(String(b.docNumber))} · Balance ${money(b.balance)} · ${escapeHtml(b.lineSummary || '')}`,
        'info'
      );
    } catch (e) {
      erpNotify(e.message || String(e), 'error');
    }
  }

  function vbpExport(fmt) {
    if (!VBP.vendorId) return;
    if (fmt === 'csv') {
      const qs = new URLSearchParams({
        vendor_id: VBP.vendorId,
        startDate: el('vbpHistFrom')?.value || '',
        endDate: el('vbpHistTo')?.value || '',
        format: 'csv'
      });
      window.open('/api/bills/payments/history?' + qs.toString(), '_blank');
      return;
    }
    if (fmt === 'pdf') {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write('<html><head><title>History</title></head><body>');
      w.document.write(el('vbpHistSection')?.querySelector('.vbp-table-card')?.innerHTML || '');
      w.document.write('</body></html>');
      w.document.close();
      w.print();
    }
  }

  window.vbpOnAccountingBillPayTabShown = function () {
    vbpMount();
    const chip = el('vbpBillFilterChips')?.querySelector('[data-chip="all"]');
    if (chip && !chip.classList.contains('active')) {
      el('vbpBillFilterChips')?.querySelectorAll('.mr-filter-chip').forEach(x => x.classList.remove('active'));
      chip.classList.add('active');
    }
  };

  window.vbpHasDraftSelection = function () {
    return Object.keys(VBP.selected || {}).length > 0;
  };
})();
