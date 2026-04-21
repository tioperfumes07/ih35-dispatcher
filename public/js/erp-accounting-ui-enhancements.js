/**
 * Accounting UI: board date filter bars, workflow modals (layout / preview only).
 * Loaded from maintenance.html — does not change save or sync APIs.
 */
(function (global) {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isoFromDate(d) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** @param {number} kind chip index 0..5 */
  function erpDfRangeForChip(kind) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const addDays = (base, n) => new Date(base.getTime() + n * 86400000);
    const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0);
    let from = today;
    let to = today;
    switch (kind) {
      case 0:
        from = to = today;
        break;
      case 1: {
        const dow = today.getDay();
        from = addDays(today, -dow);
        to = today;
        break;
      }
      case 2:
        from = startOfMonth(today);
        to = endOfMonth(today);
        break;
      case 3: {
        const firstThis = startOfMonth(today);
        const lastPrev = addDays(firstThis, -1);
        from = startOfMonth(lastPrev);
        to = endOfMonth(lastPrev);
        break;
      }
      case 4:
        from = addDays(today, -90);
        to = today;
        break;
      case 5:
        from = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        to = today;
        break;
      default:
        from = to = today;
    }
    return { from: isoFromDate(from), to: isoFromDate(to) };
  }

  function wireChips(bar, onApply) {
    if (!bar) return;
    const from = bar.querySelector('.erp-df-from');
    const to = bar.querySelector('.erp-df-to');
    bar.querySelectorAll('.erp-df-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = Number(btn.getAttribute('data-erp-df-chip')) || 0;
        const r = erpDfRangeForChip(kind);
        if (from) from.value = r.from;
        if (to) to.value = r.to;
        bar.querySelectorAll('.erp-df-chip').forEach(b => b.classList.remove('erp-df-chip--active'));
        btn.classList.add('erp-df-chip--active');
        if (onApply) onApply();
      });
    });
    const apply = bar.querySelector('.erp-df-apply');
    if (apply)
      apply.addEventListener('click', () => {
        if (onApply) onApply();
      });
  }

  function renderDateBarHtml(prefix, rightHtml) {
    const today = isoFromDate(new Date());
    const chips = ['Today', 'This week', 'This month', 'Last month', 'Last 3 mo', 'Last year']
      .map(
        (label, i) =>
          '<button type="button" class="erp-df-chip" data-erp-df-chip="' +
          i +
          '">' +
          String(label).replace(/</g, '&lt;') +
          '</button>'
      )
      .join('');
    return (
      '<div class="erp-date-filter-bar" data-erp-df-prefix="' +
      prefix +
      '">' +
      '<div class="erp-date-filter-bar__left date-range">' +
      '<span class="erp-df-lbl">FROM</span>' +
      '<input type="date" class="qb-in erp-df-from" id="' +
      prefix +
      '_from" value="' +
      today +
      '" />' +
      '<span class="erp-df-sep">—</span>' +
      '<span class="erp-df-lbl">TO</span>' +
      '<input type="date" class="qb-in erp-df-to" id="' +
      prefix +
      '_to" value="' +
      today +
      '" />' +
      '<div class="erp-df-chips">' +
      chips +
      '</div>' +
      '</div>' +
      '<div class="erp-date-filter-bar__right">' +
      (rightHtml || '') +
      '<button type="button" class="erp-df-apply">Apply</button>' +
      '<span class="erp-df-count" id="' +
      prefix +
      '_rcount">—</span>' +
      '</div>' +
      '</div>'
    );
  }

  function esc(t) {
    return String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function workflowShellTop(titleNote) {
    return (
      '<div class="erp-acct-workflow-shell" data-erp-acct-workflow="1">' +
      (titleNote
        ? '<p class="mini-note" style="margin:0 0 12px;line-height:1.45">' +
          esc(titleNote) +
          '</p>'
        : '')
    );
  }

  function fuelFastEntryHtml() {
    const today = isoFromDate(new Date());
    return (
      workflowShellTop(
        'Layout preview for Fuel & DEF fast entry. Clear resets the composer; Save / QBO actions stay disabled until the ledger API hooks this surface.'
      ) +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-workflow-h">Header</div>' +
      '<div class="erp-acct-field-grid erp-fe-head">' +
      '<div class="erp-acct-field"><span class="qb-l">Type</span><select class="qb-in" id="feType"><option>Diesel</option><option>DEF</option><option>Reefer</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Txn date</span><input type="date" class="qb-in" id="feDate" value="' +
      today +
      '" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Vendor</span><input class="qb-in" list="qboVendorOptions" id="feVendor" placeholder="QuickBooks vendor" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Unit</span><input class="qb-in" list="unitOptions" id="feUnit" placeholder="Unit / asset" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Payment method</span><input class="qb-in" list="paymentMethodOptions" id="fePayMethod" placeholder="Card, ACH…" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Load / inv #</span><input class="qb-in" id="feLoadInv" placeholder="Load or invoice" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Vendor inv #</span><input class="qb-in" id="feVendorInv" placeholder="Supplier #" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Shop / WO #</span><input class="qb-in" id="feShopWo" placeholder="Internal WO" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Expense #</span><input class="qb-in" id="feExpenseNo" placeholder="Doc number" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Pay from bank</span><input class="qb-in" list="qboBankAccountOptions" id="feBank" placeholder="Bank account" /></div>' +
      '</div></div>' +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-workflow-h">Cost lines</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table" id="feCostTable">' +
      '<thead><tr><th class="num">Qty (gal)</th><th class="num">$/gal</th><th class="num">Line $</th><th></th></tr></thead><tbody>' +
      '<tr><td><input class="qb-in fe-qty num" inputmode="decimal" placeholder="0" /></td><td><input class="qb-in fe-rate num" inputmode="decimal" placeholder="0.0000" /></td><td><input class="qb-in fe-line num" readonly placeholder="—" /></td><td><button type="button" class="erp-acct-btn erp-acct-btn--muted fe-rm" disabled>Remove</button></td></tr>' +
      '</tbody></table></div>' +
      '<div style="margin-top:8px"><button type="button" class="erp-acct-btn erp-acct-btn--muted" id="feAddLine">Add line</button></div></div>' +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-field" style="max-width:100%"><span class="qb-l">Memo</span><textarea class="qb-memo" id="feMemo" rows="2" style="width:100%;min-width:0;resize:vertical;box-sizing:border-box" placeholder="Notes for auditors…"></textarea></div></div>' +
      renderDateBarHtml('fe_hist', '') +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">History</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Date</th><th>Vendor</th><th>Unit</th><th class="num">Gallons</th><th class="num">Total</th><th>QBO</th></tr></thead><tbody><tr><td colspan="6" class="mini-note">Apply the date bar to scope preview rows when the fuel API is connected.</td></tr></tbody></table></div></div>' +
      '<div class="erp-acct-workflow-foot">' +
      '<button type="button" class="erp-acct-btn" data-erp-ded-close="1">Cancel</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--muted" id="feClear">Clear</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--green" disabled title="Coming soon">Save to ledger</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--blue" disabled title="Coming soon">Confirm to QBO</button>' +
      '</div></div>'
    );
  }

  function journalHtml() {
    const today = isoFromDate(new Date());
    return (
      workflowShellTop(
        'Composer preview — debits and credits stay in balance before "Record to QuickBooks" is enabled. No QBO writes from this dialog until backend wiring is complete.'
      ) +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-workflow-h">Header</div>' +
      '<div class="erp-acct-field-grid">' +
      '<div class="erp-acct-field"><span class="qb-l">Journal date</span><input type="date" class="qb-in" id="jeDate" value="' +
      today +
      '" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Journal #</span><input class="qb-in" id="jeNum" readonly value="AUTO" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Currency</span><input class="qb-in" readonly value="USD" /></div>' +
      '<div class="erp-acct-field" style="flex:2 1 260px"><span class="qb-l">Memo</span><input class="qb-in" id="jeMemo" placeholder="Optional" /></div>' +
      '</div></div>' +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-workflow-h">Lines</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table" id="jeTable">' +
      '<thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th>Name</th><th>Class</th></tr></thead><tbody>' +
      '<tr><td><input class="qb-in" placeholder="Expense" disabled /></td><td><input class="qb-in je-desc" value="" placeholder="Description" /></td><td><input class="qb-in je-d num" inputmode="decimal" value="" placeholder="0.00" /></td><td><input class="qb-in je-c num" inputmode="decimal" value="" placeholder="0.00" /></td><td><input class="qb-in" disabled placeholder="—" /></td><td><input class="qb-in" disabled placeholder="—" /></td></tr>' +
      '<tr><td><input class="qb-in" placeholder="Bank" disabled /></td><td><input class="qb-in je-desc" value="" placeholder="Description" /></td><td><input class="qb-in je-d num" inputmode="decimal" value="" placeholder="0.00" /></td><td><input class="qb-in je-c num" inputmode="decimal" value="" placeholder="0.00" /></td><td><input class="qb-in" disabled placeholder="—" /></td><td><input class="qb-in" disabled placeholder="—" /></td></tr>' +
      '</tbody></table></div>' +
      '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--muted" id="jeAddLine">Add line</button>' +
      '<span class="mini-note" id="jeTotals">Total debits: $0.00 · Total credits: $0.00</span></div>' +
      '<div class="erp-acct-warn" id="jeWarn" hidden>Debits and credits must be equal.</div>' +
      '</div>' +
      renderDateBarHtml('je_hist', '') +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Journal history (preview)</div>' +
      '<div class="mini-note" style="margin:0 0 8px">Filter applies to the list when the ledger API is connected.</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Date</th><th>Journal #</th><th>Memo</th><th>Total</th><th>QBO status</th></tr></thead><tbody><tr><td colspan="5" class="mini-note">No rows yet.</td></tr></tbody></table></div></div>' +
      '<div class="erp-acct-workflow-foot">' +
      '<button type="button" class="erp-acct-btn" data-erp-ded-close="1">Cancel</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--muted" disabled title="Coming soon">Save draft</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--blue" id="jePost" disabled title="Balance lines first">Record to QuickBooks</button>' +
      '</div></div>'
    );
  }

  function transferHtml() {
    const today = isoFromDate(new Date());
    return (
      workflowShellTop(
        'Preview balances use sample book values for layout only. Live QBO balances stay in QuickBooks until this transfer posts.'
      ) +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-field-grid">' +
      '<div class="erp-acct-field"><span class="qb-l">From account</span><select class="qb-in" id="trFrom"><option value="a1">Operating · …1020</option><option value="a2">Payroll · …1030</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">To account</span><select class="qb-in" id="trTo"><option value="a2">Payroll · …1030</option><option value="a1">Operating · …1020</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Amount</span><input class="qb-in" id="trAmt" inputmode="decimal" placeholder="0.00" /></div>' +
      '<div class="erp-acct-field" style="flex:2 1 220px"><span class="qb-l">Memo</span><input class="qb-in" id="trMemo" placeholder="Optional" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Reference #</span><input class="qb-in" id="trRef" placeholder="Optional" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Transfer date</span><input type="date" class="qb-in" id="trDate" value="' +
      today +
      '" /></div>' +
      '</div>' +
      '<p class="erp-acct-warn" id="trSame" hidden>Cannot transfer to the same account.</p>' +
      '<div class="mini-note" id="trBal" style="margin-top:10px;line-height:1.5">From: — balance after: —<br/>To: — balance after: —</div>' +
      '</div>' +
      renderDateBarHtml('tr_hist', '') +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Transfer history (preview)</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Date</th><th>From</th><th>To</th><th>Amount</th><th>Ref #</th><th>QBO status</th></tr></thead><tbody><tr><td colspan="6" class="mini-note">No rows yet.</td></tr></tbody></table></div></div>' +
      '<div class="erp-acct-workflow-foot">' +
      '<button type="button" class="erp-acct-btn" data-erp-ded-close="1">Cancel</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--green" disabled title="Coming soon">Record transfer</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--blue" disabled title="Coming soon">Post to QuickBooks</button>' +
      '</div></div>'
    );
  }

  function driverSettlementHtml() {
    const today = isoFromDate(new Date());
    return (
      workflowShellTop(
        'Loads and deductions preview from TMS + ERP when APIs are wired. Buttons that post to QuickBooks stay disabled until the settlement pipeline is connected.'
      ) +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Settlement header</div>' +
      '<div class="erp-acct-field-grid">' +
      '<div class="erp-acct-field"><span class="qb-l">Driver</span><input class="qb-in" list="maintDriverOptions" placeholder="Search driver" disabled /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Settlement #</span><input class="qb-in" readonly value="AUTO" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Period from</span><input type="date" class="qb-in" value="' +
      today +
      '" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Period to</span><input type="date" class="qb-in" value="' +
      today +
      '" /></div>' +
      '</div>' +
      '<div class="erp-acct-field-grid" style="margin-top:10px">' +
      '<div class="erp-acct-field"><span class="qb-l">Pay from account</span><select class="qb-in" disabled><option>Choose bank…</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Payment method</span><select class="qb-in" disabled><option>ACH</option><option>Check</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Payment date</span><input type="date" class="qb-in" value="' +
      today +
      '" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Check #</span><input class="qb-in" disabled placeholder="If check" /></div>' +
      '</div></div>' +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Revenue / loads</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Load #</th><th>Date</th><th>Origin</th><th>Dest</th><th class="num">Miles</th><th class="num">Rate</th><th class="num">Gross</th><th>Status</th></tr></thead><tbody><tr><td colspan="8" class="mini-note">No loads in range yet.</td></tr></tbody></table></div>' +
      '<div style="margin-top:8px"><button type="button" class="erp-acct-btn erp-acct-btn--muted" disabled>Add load manually</button> <span class="mini-note">Subtotal gross: $0.00</span></div></div>' +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Deductions</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Description</th><th class="num">Amount</th><th>Type</th></tr></thead><tbody><tr><td colspan="3" class="mini-note">No deductions.</td></tr></tbody></table></div>' +
      '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">' +
      ['Fuel advance', 'Insurance', 'ELD/Equipment', 'Escrow', 'Loan payment', 'Custom']
        .map(
          x =>
            '<button type="button" class="erp-acct-btn erp-acct-btn--muted erp-ds-ded" data-erp-ds-ded="' +
            esc(x) +
            '">' +
            esc(x) +
            '</button>'
        )
        .join('') +
      '</div><p class="mini-note" style="margin:8px 0 0">Subtotal deductions: $0.00</p></div>' +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Summary</div>' +
      '<p class="mini-note" style="margin:0">Gross revenue: $0.00</p>' +
      '<p class="mini-note" style="margin:4px 0">Total deductions: −$0.00</p>' +
      '<p style="margin:8px 0 0"><span class="mini-note">NET PAY</span><br/><span class="erp-acct-netpay">$0.00</span></p></div>' +
      renderDateBarHtml('ds_hist', '<span class="qb-l">Driver</span><input class="qb-in" style="max-width:200px" disabled placeholder="Filter" />') +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Past settlements</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Date</th><th>Driver</th><th>#</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Net</th><th>Status</th></tr></thead><tbody><tr><td colspan="7" class="mini-note">No history.</td></tr></tbody></table></div></div>' +
      '<div class="erp-acct-workflow-foot">' +
      '<button type="button" class="erp-acct-btn" data-erp-ded-close="1">Cancel</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--green" disabled>Save settlement</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--blue" disabled>Post to QuickBooks</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--muted" disabled>Print settlement sheet</button>' +
      '</div></div>'
    );
  }

  function loadTmsHtml() {
    const today = isoFromDate(new Date());
    return (
      workflowShellTop(
        'TMS load capture mirrors dispatch data when the feed is enabled. Posting an invoice to QBO stays behind the existing AP / billing flows.'
      ) +
      '<div class="erp-acct-workflow-section">' +
      '<div class="erp-acct-field-grid">' +
      '<div class="erp-acct-field"><span class="qb-l">Load #</span><input class="qb-in" placeholder="Required" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Status</span><select class="qb-in"><option>Active</option><option>Delivered</option><option>Cancelled</option><option>In transit</option><option>Planning</option></select></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Pick up date</span><input type="date" class="qb-in" value="' +
      today +
      '" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Delivery date</span><input type="date" class="qb-in" /></div>' +
      '</div>' +
      '<div class="erp-acct-field-grid" style="margin-top:10px">' +
      '<div class="erp-acct-field"><span class="qb-l">Driver</span><input class="qb-in" list="maintDriverOptions" placeholder="Search" disabled /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Unit / truck</span><input class="qb-in" list="unitOptions" placeholder="Unit" disabled /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Customer</span><input class="qb-in" list="qboCustomerOptions" placeholder="QBO customer" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Revenue ($)</span><input class="qb-in" inputmode="decimal" placeholder="0.00" /></div>' +
      '</div>' +
      '<div class="erp-acct-field-grid" style="margin-top:10px">' +
      '<div class="erp-acct-field" style="flex:2 1 200px"><span class="qb-l">Origin</span><input class="qb-in" placeholder="City / location" /></div>' +
      '<div class="erp-acct-field" style="flex:2 1 200px"><span class="qb-l">Destination</span><input class="qb-in" placeholder="City / location" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Miles</span><input class="qb-in" inputmode="decimal" placeholder="Loaded + empty" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Invoice #</span><input class="qb-in" placeholder="Customer invoice" /></div>' +
      '</div>' +
      '<div class="erp-acct-field-grid" style="margin-top:10px">' +
      '<div class="erp-acct-field"><span class="qb-l">Settlement #</span><input class="qb-in" disabled placeholder="If settled" /></div>' +
      '<div class="erp-acct-field"><span class="qb-l">Reference #</span><input class="qb-in" placeholder="BOL, etc." /></div>' +
      '<div class="erp-acct-field" style="flex:2 1 220px"><span class="qb-l">Notes</span><input class="qb-in" placeholder="Notes" /></div>' +
      '</div></div>' +
      renderDateBarHtml('lt_hist', '<span class="qb-l">Status</span><select class="qb-in" style="max-width:140px"><option>All</option></select>') +
      '<div class="erp-acct-workflow-section"><div class="erp-acct-workflow-h">Load history</div>' +
      '<div class="erp-acct-workflow-table-wrap"><table class="erp-acct-workflow-table"><thead><tr><th>Load #</th><th>Date</th><th>Driver</th><th>Customer</th><th>Status</th><th class="num">Revenue</th></tr></thead><tbody><tr><td colspan="6" class="mini-note">Open Dispatch for live boards or connect TMS.</td></tr></tbody></table></div></div>' +
      '<div class="erp-acct-workflow-foot">' +
      '<button type="button" class="erp-acct-btn" data-erp-ded-close="1">Cancel</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--green" disabled>Save load</button>' +
      '<button type="button" class="erp-acct-btn erp-acct-btn--blue" disabled>Post invoice to QuickBooks</button>' +
      '</div></div>'
    );
  }

  function parseMoney(s) {
    const n = Number(String(s || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function wireJournal(modalBody) {
    const table = modalBody.querySelector('#jeTable');
    const warn = modalBody.querySelector('#jeWarn');
    const post = modalBody.querySelector('#jePost');
    const totals = modalBody.querySelector('#jeTotals');
    const add = modalBody.querySelector('#jeAddLine');

    function rowHtml() {
      return (
        '<tr><td><input class="qb-in" placeholder="Account" disabled /></td>' +
        '<td><input class="qb-in je-desc" value="" /></td>' +
        '<td><input class="qb-in je-d num" inputmode="decimal" /></td>' +
        '<td><input class="qb-in je-c num" inputmode="decimal" /></td>' +
        '<td><input class="qb-in" disabled placeholder="—" /></td>' +
        '<td><input class="qb-in" disabled placeholder="—" /></td></tr>'
      );
    }

    function recalc() {
      let d = 0;
      let c = 0;
      modalBody.querySelectorAll('.je-d').forEach(inp => {
        d += parseMoney(inp.value);
      });
      modalBody.querySelectorAll('.je-c').forEach(inp => {
        c += parseMoney(inp.value);
      });
      const ok = Math.abs(d - c) < 0.005 && d > 0;
      if (totals)
        totals.textContent =
          'Total debits: $' + d.toFixed(2) + ' · Total credits: $' + c.toFixed(2);
      if (warn) warn.hidden = ok || (d === 0 && c === 0);
      if (post) post.disabled = !ok;
    }

    modalBody.addEventListener('input', ev => {
      if (ev.target && (ev.target.classList.contains('je-d') || ev.target.classList.contains('je-c'))) recalc();
    });
    if (add)
      add.addEventListener('click', () => {
        if (!table) return;
        const tb = table.querySelector('tbody');
        if (tb) tb.insertAdjacentHTML('beforeend', rowHtml());
        recalc();
      });
    recalc();
  }

  function wireFuelFast(modalBody) {
    const table = modalBody.querySelector('#feCostTable');
    const add = modalBody.querySelector('#feAddLine');
    const clear = modalBody.querySelector('#feClear');

    function rowHtml() {
      return (
        '<tr><td><input class="qb-in fe-qty num" inputmode="decimal" placeholder="0" /></td>' +
        '<td><input class="qb-in fe-rate num" inputmode="decimal" placeholder="0.0000" /></td>' +
        '<td><input class="qb-in fe-line num" readonly placeholder="—" /></td><td><button type="button" class="erp-acct-btn erp-acct-btn--muted fe-rm">Remove</button></td></tr>'
      );
    }

    function recalcRow(tr) {
      if (!tr) return;
      const q = tr.querySelector('.fe-qty');
      const r = tr.querySelector('.fe-rate');
      const ln = tr.querySelector('.fe-line');
      const gal = parseMoney(q && q.value);
      const rate = parseMoney(r && r.value);
      const tot = gal * rate;
      if (ln) ln.value = tot > 0 ? tot.toFixed(2) : '';
    }

    function bindRow(tr) {
      tr.querySelectorAll('.fe-qty, .fe-rate').forEach(inp => {
        inp.addEventListener('input', () => recalcRow(tr));
      });
      const rm = tr.querySelector('.fe-rm');
      if (rm)
        rm.addEventListener('click', () => {
          const tb = table && table.querySelector('tbody');
          if (!tb) return;
          if (tb.querySelectorAll('tr').length <= 1) {
            tr.querySelectorAll('.fe-qty, .fe-rate, .fe-line').forEach(el => {
              el.value = '';
            });
            recalcRow(tr);
            return;
          }
          tr.remove();
        });
      recalcRow(tr);
    }

    if (table) {
      const first = table.querySelector('tbody tr');
      if (first) bindRow(first);
    }
    if (add && table) {
      add.addEventListener('click', () => {
        const tb = table.querySelector('tbody');
        if (!tb) return;
        tb.insertAdjacentHTML('beforeend', rowHtml());
        const last = tb.querySelector('tr:last-child');
        bindRow(last);
      });
    }
    if (clear && modalBody) {
      clear.addEventListener('click', () => {
        modalBody.querySelectorAll('#feType, #feDate, #feVendor, #feUnit, #fePayMethod, #feLoadInv, #feVendorInv, #feShopWo, #feExpenseNo, #feBank, #feMemo').forEach(el => {
          if (!el) return;
          if (el.tagName === 'SELECT') el.selectedIndex = 0;
          else el.value = '';
        });
        const tb = table && table.querySelector('tbody');
        if (tb) {
          tb.innerHTML = rowHtml().replace(/^<tr/, '<tr').replace(/<\/tr>$/, '</tr>');
          const tr = tb.querySelector('tr');
          bindRow(tr);
        }
      });
    }
    modalBody.addEventListener('input', ev => {
      const t = ev.target;
      if (t && t.classList && t.classList.contains('fe-qty')) recalcRow(t.closest('tr'));
      if (t && t.classList && t.classList.contains('fe-rate')) recalcRow(t.closest('tr'));
    });
  }

  function wireDriverSettlementDedupe(modalBody) {
    modalBody.querySelectorAll('.erp-ds-ded').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.getAttribute('data-erp-ds-ded') || btn.textContent || '';
        if (typeof global.erpNotify === 'function') {
          global.erpNotify('Deduction row for "' + label + '" will append here when settlements API is wired.', 'info');
        }
      });
    });
  }

  function wireTransfer(modalBody) {
    const fromSel = modalBody.querySelector('#trFrom');
    const toSel = modalBody.querySelector('#trTo');
    const amt = modalBody.querySelector('#trAmt');
    const bal = modalBody.querySelector('#trBal');
    const same = modalBody.querySelector('#trSame');
    const baseFrom = 12500;
    const baseTo = 8200;

    function paint() {
      const a = parseMoney(amt && amt.value);
      const fv = fromSel ? String(fromSel.value) : '';
      const tv = toSel ? String(toSel.value) : '';
      if (same) same.hidden = fv !== tv || !fv;
      if (bal) {
        if (fv === tv && fv) {
          bal.innerHTML = 'Fix account selection to preview balances.';
          return;
        }
        const afterFrom = baseFrom - a;
        const afterTo = baseTo + a;
        bal.innerHTML =
          'From: Operating · …1020 balance after: <strong>$' +
          afterFrom.toFixed(2) +
          '</strong><br/>To: Payroll · …1030 balance after: <strong>$' +
          afterTo.toFixed(2) +
          '</strong> <span class="mini-note">(sample numbers)</span>';
      }
    }

    modalBody.addEventListener('input', ev => {
      if (ev.target === amt) paint();
    });
    modalBody.addEventListener('change', ev => {
      if (ev.target === fromSel || ev.target === toSel) paint();
    });
    paint();
  }

  /** @param {'journal'|'journal-entry'|'transfer'|'driver-settlement'|'load-tms'|'fuel-fast-entry'} which */
  function erpOpenAcctWorkflowModal(which) {
    const w = String(which || '').trim();
    const norm = w === 'journal' || w === 'journal-entry' ? 'journal-entry' : w;
    const map = {
      'journal-entry': { layout: 'journal', html: journalHtml },
      transfer: { layout: 'transfer', html: transferHtml },
      'driver-settlement': { layout: 'driver-settlement', html: driverSettlementHtml },
      'load-tms': { layout: 'load-tms', html: loadTmsHtml },
      'fuel-fast-entry': { layout: 'fuel', html: fuelFastEntryHtml }
    };
    const spec = map[norm];
    if (!spec) return;

    if (typeof global.erpCloseNewMenu === 'function') global.erpCloseNewMenu();
    if (typeof global.erpCloseDedicatedFormModal === 'function')
      global.erpCloseDedicatedFormModal({ force: true });

    const acctBtn = document.querySelector('#erpIconNav .nav-btn[data-section="accounting"]');
    if (typeof global.openSection === 'function') global.openSection('accounting', acctBtn);

    const mount = document.getElementById('erpDedicatedFormModalBody');
    const modal = document.getElementById('erpDedicatedFormModal');
    if (!mount || !modal) return;
    if (typeof global.erpResetDedicatedModalLayout === 'function') global.erpResetDedicatedModalLayout();

    global.__erpDedicatedModalKind = 'ledger-stub';
    global.__erpLedgerStubWhich = spec.layout;

    mount.innerHTML = spec.html();
    modal.setAttribute('data-erp-acct-layout', spec.layout);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('erp-dedicated-modal-open');
    if (typeof global.erpDedicatedModalBindEscape === 'function') global.erpDedicatedModalBindEscape(true);

    const bar = global.syncErpDedicatedModalChrome;
    if (typeof bar === 'function') bar();
    const geomKind = spec.layout === 'fuel' ? 'fuel' : 'ledger';
    if (typeof global.erpRestoreDedicatedModalGeometry === 'function')
      global.erpRestoreDedicatedModalGeometry(geomKind);

    wireChips(mount.querySelector('[data-erp-df-prefix="je_hist"]'), () => {});
    wireChips(mount.querySelector('[data-erp-df-prefix="tr_hist"]'), () => {});
    wireChips(mount.querySelector('[data-erp-df-prefix="ds_hist"]'), () => {});
    wireChips(mount.querySelector('[data-erp-df-prefix="lt_hist"]'), () => {});
    wireChips(mount.querySelector('[data-erp-df-prefix="fe_hist"]'), () => {});

    if (spec.layout === 'journal') wireJournal(mount);
    if (spec.layout === 'transfer') wireTransfer(mount);
    if (spec.layout === 'fuel') wireFuelFast(mount);
    if (spec.layout === 'driver-settlement') wireDriverSettlementDedupe(mount);
  }

  global.erpDfRangeForChip = erpDfRangeForChip;
  global.erpOpenAcctWorkflowModal = erpOpenAcctWorkflowModal;

  function readBar(prefix) {
    const from = document.getElementById(prefix + '_from');
    const to = document.getElementById(prefix + '_to');
    return {
      from: from && from.value ? String(from.value) : '',
      to: to && to.value ? String(to.value) : ''
    };
  }

  function inRange(iso, from, to) {
    if (!from && !to) return true;
    const d = String(iso || '').slice(0, 10);
    if (!d) return true;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  global.erpInitAcctBoardDateFilters = function erpInitAcctBoardDateFilters() {
    if (global.__erpAcctBoardDfMounted) return;
    global.__erpAcctBoardDfMounted = true;
    global.__acctBoardDateFilters = global.__acctBoardDateFilters || {
      expenses: { from: '', to: '' },
      bills: { from: '', to: '' },
      payments: { from: '', to: '' },
      qboerr: { from: '', to: '' }
    };

    const hosts = [
      { id: 'acctBoardExpDateFilterHost', prefix: 'ab_exp', key: 'expenses' },
      { id: 'acctBoardBillsDateFilterHost', prefix: 'ab_bill', key: 'bills' },
      { id: 'acctBoardPayDateFilterHost', prefix: 'ab_pay', key: 'payments' },
      { id: 'acctBoardQboErrDateFilterHost', prefix: 'ab_qbo', key: 'qboerr' }
    ];

    hosts.forEach(({ id, prefix, key }) => {
      const el = document.getElementById(id);
      if (!el || el.getAttribute('data-erp-df-mounted')) return;
      el.setAttribute('data-erp-df-mounted', '1');
      el.innerHTML = renderDateBarHtml(prefix, '');
      const bar = el.firstElementChild;
      wireChips(bar, () => {
        const r = readBar(prefix);
        global.__acctBoardDateFilters[key] = r;
        if (typeof global.renderAcctBoardMiniTables === 'function') global.renderAcctBoardMiniTables();
        if (key === 'qboerr' && typeof global.paintAcctDashQboErrors === 'function') global.paintAcctDashQboErrors();
        const cnt = document.getElementById(prefix + '_rcount');
        if (cnt) cnt.textContent = 'Applied';
      });
    });
  };

  function updateExphBarCount() {
    const sumEl = document.getElementById('expHistSummary');
    const cnt = document.getElementById('exph_df_rcount');
    if (!cnt) return;
    const t = sumEl ? String(sumEl.textContent || '').trim() : '';
    if (!t) {
      cnt.textContent = '—';
      return;
    }
    const m = t.match(/^(\d+)\s+filtered/);
    cnt.textContent = m ? m[1] + ' records' : t.slice(0, 56);
  }

  function syncExphBarFromInputs() {
    const from = document.getElementById('expHistDateFrom');
    const to = document.getElementById('expHistDateTo');
    const bf = document.getElementById('exph_df_from');
    const bt = document.getElementById('exph_df_to');
    if (bf && from) bf.value = from.value || '';
    if (bt && to) bt.value = to.value || '';
  }

  global.erpSyncExpenseHistoryDateBarFromInputs = function erpSyncExpenseHistoryDateBarFromInputs() {
    syncExphBarFromInputs();
    updateExphBarCount();
  };

  global.erpInitExpenseHistoryDateBar = function erpInitExpenseHistoryDateBar() {
    const host = document.getElementById('acctExpHistDateBarHost');
    if (!host || host.getAttribute('data-erp-df-mounted')) return;
    host.setAttribute('data-erp-df-mounted', '1');
    host.innerHTML = renderDateBarHtml('exph_df', '');
    const bar = host.firstElementChild;
    syncExphBarFromInputs();
    const apply = () => {
      const r = readBar('exph_df');
      const from = document.getElementById('expHistDateFrom');
      const to = document.getElementById('expHistDateTo');
      if (from) from.value = r.from;
      if (to) to.value = r.to;
      if (typeof global.renderExpenseHistory === 'function') global.renderExpenseHistory();
      updateExphBarCount();
    };
    wireChips(bar, apply);
    const fromIn = document.getElementById('expHistDateFrom');
    const toIn = document.getElementById('expHistDateTo');
    const syncBack = () => {
      syncExphBarFromInputs();
      updateExphBarCount();
    };
    if (fromIn) fromIn.addEventListener('change', syncBack);
    if (toIn) toIn.addEventListener('change', syncBack);
    updateExphBarCount();
  };

  function syncBpLogBarFromInputs() {
    const from = document.getElementById('bpLogFrom');
    const to = document.getElementById('bpLogTo');
    const bf = document.getElementById('bplog_df_from');
    const bt = document.getElementById('bplog_df_to');
    if (bf && from) bf.value = from.value || '';
    if (bt && to) bt.value = to.value || '';
  }

  function updateBpLogBarCount() {
    const st = document.getElementById('bpLogStatus');
    const cnt = document.getElementById('bplog_df_rcount');
    if (!cnt) return;
    const t = st ? String(st.textContent || '').trim() : '';
    if (!t) {
      cnt.textContent = '—';
      return;
    }
    const m = t.match(/(\d+)\s+payment/);
    cnt.textContent = m ? m[1] + ' records' : t.slice(0, 48);
  }

  global.erpSyncBpPaymentLogDateBarFromInputs = function erpSyncBpPaymentLogDateBarFromInputs() {
    syncBpLogBarFromInputs();
    updateBpLogBarCount();
  };

  global.erpInitBpPaymentLogDateBar = function erpInitBpPaymentLogDateBar() {
    const host = document.getElementById('acctBpLogDateBarHost');
    if (!host || host.getAttribute('data-erp-df-mounted')) return;
    host.setAttribute('data-erp-df-mounted', '1');
    host.innerHTML = renderDateBarHtml('bplog_df', '');
    const bar = host.firstElementChild;
    syncBpLogBarFromInputs();
    const apply = () => {
      const r = readBar('bplog_df');
      const from = document.getElementById('bpLogFrom');
      const to = document.getElementById('bpLogTo');
      if (from) from.value = r.from;
      if (to) to.value = r.to;
      const run = global.loadAccountingBillPaymentLog;
      if (typeof run === 'function') {
        Promise.resolve(run()).then(() => updateBpLogBarCount());
      } else updateBpLogBarCount();
    };
    wireChips(bar, apply);
    const fromIn = document.getElementById('bpLogFrom');
    const toIn = document.getElementById('bpLogTo');
    const syncBack = () => {
      syncBpLogBarFromInputs();
      updateBpLogBarCount();
    };
    if (fromIn) fromIn.addEventListener('change', syncBack);
    if (toIn) toIn.addEventListener('change', syncBack);
    updateBpLogBarCount();
  };

  global.erpUpdateFuelLedgerDateBarCount = function erpUpdateFuelLedgerDateBarCount(n) {
    const cnt = document.getElementById('fuel_df_rcount');
    if (!cnt) return;
    const num = Number(n);
    cnt.textContent = Number.isFinite(num) && num >= 0 ? num + ' records' : '—';
  };

  function syncFuelLedgerBarFromInputs() {
    const from = document.getElementById('fuelExpFrom');
    const to = document.getElementById('fuelExpTo');
    const bf = document.getElementById('fuel_df_from');
    const bt = document.getElementById('fuel_df_to');
    if (bf && from) bf.value = from.value || '';
    if (bt && to) bt.value = to.value || '';
  }

  global.erpSyncFuelLedgerDateBarFromInputs = function erpSyncFuelLedgerDateBarFromInputs() {
    syncFuelLedgerBarFromInputs();
  };

  global.erpInitFuelLedgerDateBar = function erpInitFuelLedgerDateBar() {
    const host = document.getElementById('acctFuelLedgerDateBarHost');
    if (!host || host.getAttribute('data-erp-df-mounted')) {
      syncFuelLedgerBarFromInputs();
      if (typeof global.renderFuelExpenseRows === 'function') global.renderFuelExpenseRows();
      return;
    }
    host.setAttribute('data-erp-df-mounted', '1');
    host.innerHTML = renderDateBarHtml('fuel_df', '');
    syncFuelLedgerBarFromInputs();
    const bar = host.firstElementChild;
    const apply = () => {
      const r = readBar('fuel_df');
      const from = document.getElementById('fuelExpFrom');
      const to = document.getElementById('fuelExpTo');
      if (from) from.value = r.from;
      if (to) to.value = r.to;
      if (typeof global.renderFuelExpenseRows === 'function') global.renderFuelExpenseRows();
    };
    wireChips(bar, apply);
    const fromIn = document.getElementById('fuelExpFrom');
    const toIn = document.getElementById('fuelExpTo');
    const syncBack = () => {
      syncFuelLedgerBarFromInputs();
    };
    if (fromIn) fromIn.addEventListener('change', syncBack);
    if (toIn) toIn.addEventListener('change', syncBack);
    if (typeof global.renderFuelExpenseRows === 'function') global.renderFuelExpenseRows();
  };

  function updateRollbackImportBarCount(erpN, fuelN) {
    const cnt = document.getElementById('rb_imp_rcount');
    if (!cnt) return;
    const err = String(global.__erpRollbackBatchLoadErr || '').trim();
    if (err) {
      cnt.textContent = '—';
      return;
    }
    cnt.textContent = String(erpN) + ' ERP · ' + String(fuelN) + ' fuel';
  }

  global.erpUpdateRollbackImportDateBarCount = updateRollbackImportBarCount;

  function applyRollbackImportDateFilter() {
    const err = String(global.__erpRollbackBatchLoadErr || '').trim();
    const erpAll = global.__erpRollbackErpBatchesCache || [];
    const fuelAll = global.__erpRollbackFuelBatchesCache || [];
    const r = readBar('rb_imp');
    const fn = global.rollbackImportBatchInDateRange;
    const useFilter =
      !err && (r.from || r.to) && typeof fn === 'function' && (erpAll.length > 0 || fuelAll.length > 0);
    const erpShow = useFilter ? erpAll.filter(b => fn(b, r.from, r.to)) : erpAll;
    const fuelShow = useFilter ? fuelAll.filter(b => fn(b, r.from, r.to)) : fuelAll;
    if (typeof global.renderErpImportBatchTableBodies === 'function') {
      global.renderErpImportBatchTableBodies(erpShow, fuelShow, err || undefined);
    }
    updateRollbackImportBarCount(erpShow.length, fuelShow.length);
  }

  global.erpSyncRollbackImportDateBarFromInputs = function erpSyncRollbackImportDateBarFromInputs() {
    applyRollbackImportDateFilter();
  };

  global.erpInitRollbackImportDateBar = function erpInitRollbackImportDateBar() {
    const host = document.getElementById('acctRollbackImportDateBarHost');
    if (!host || host.getAttribute('data-erp-df-mounted')) {
      applyRollbackImportDateFilter();
      return;
    }
    host.setAttribute('data-erp-df-mounted', '1');
    host.innerHTML = renderDateBarHtml('rb_imp', '');
    const bf = document.getElementById('rb_imp_from');
    const bt = document.getElementById('rb_imp_to');
    if (bf) bf.value = '';
    if (bt) bt.value = '';
    const bar = host.firstElementChild;
    wireChips(bar, applyRollbackImportDateFilter);
    applyRollbackImportDateFilter();
  };

  global.erpUpdateApSavedListDateBarCount = function erpUpdateApSavedListDateBarCount(n) {
    const cnt = document.getElementById('ap_saved_df_rcount');
    if (!cnt) return;
    const num = Number(n);
    cnt.textContent = Number.isFinite(num) && num >= 0 ? num + ' cards' : '—';
  };

  function syncApSavedBarFromHidden() {
    const from = document.getElementById('apListDateFrom');
    const to = document.getElementById('apListDateTo');
    const bf = document.getElementById('ap_saved_df_from');
    const bt = document.getElementById('ap_saved_df_to');
    if (bf && from) bf.value = from.value || '';
    if (bt && to) bt.value = to.value || '';
  }

  global.erpInitApSavedListDateBar = function erpInitApSavedListDateBar() {
    const host = document.getElementById('acctApSavedDateBarHost');
    if (!host || host.getAttribute('data-erp-df-mounted')) {
      syncApSavedBarFromHidden();
      if (typeof global.renderApTransactions === 'function') global.renderApTransactions();
      return;
    }
    host.setAttribute('data-erp-df-mounted', '1');
    host.innerHTML = renderDateBarHtml('ap_saved_df', '');
    const bf = document.getElementById('ap_saved_df_from');
    const bt = document.getElementById('ap_saved_df_to');
    if (bf) bf.value = '';
    if (bt) bt.value = '';
    const fromH = document.getElementById('apListDateFrom');
    const toH = document.getElementById('apListDateTo');
    if (fromH) fromH.value = '';
    if (toH) toH.value = '';
    const bar = host.firstElementChild;
    const apply = () => {
      const r = readBar('ap_saved_df');
      if (fromH) fromH.value = r.from;
      if (toH) toH.value = r.to;
      if (typeof global.renderApTransactions === 'function') global.renderApTransactions();
    };
    wireChips(bar, apply);
    if (typeof global.renderApTransactions === 'function') global.renderApTransactions();
  };
})(typeof window !== 'undefined' ? window : this);
