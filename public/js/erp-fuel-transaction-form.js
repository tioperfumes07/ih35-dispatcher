/**
 * Shared fuel transaction chrome: type labels, modal bar sync, vendor address hydrate.
 * Colors: inherit from theme only (no new palette).
 */
(function (global) {
  'use strict';

  /** @typedef {'fuel-bill'|'fuel-expense'|'def-bill'|'fuel-def-combined'} FuelTransactionType */

  var TYPE_ORDER = ['def-bill', 'fuel-bill', 'fuel-expense', 'fuel-def-combined'];

  var TITLES = {
    'fuel-bill': 'Fuel bill',
    'fuel-expense': 'Fuel expense',
    'def-bill': 'DEF bill',
    'fuel-def-combined': 'Fuel/DEF combined'
  };

  function esc(t) {
    return String(t ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentType() {
    var v =
      (global.__erpFuelTransactionType && String(global.__erpFuelTransactionType)) ||
      (document.getElementById('erpDedFuelTxnType') && document.getElementById('erpDedFuelTxnType').value) ||
      'fuel-expense';
    if (TITLES[v]) return v;
    return 'fuel-expense';
  }

  function docNumberLabelFor(type) {
    if (type === 'fuel-expense') return 'Expense No.';
    return 'Bill No.';
  }

  /** Update modal title, balance label, inline doc number label, and H2. */
  function erpApplyFuelTransactionType(type, opts) {
    opts = opts || {};
    var t = TITLES[type] ? type : 'fuel-expense';
    global.__erpFuelTransactionType = t;
    var sel = document.getElementById('erpDedFuelTxnType');
    if (sel) sel.value = t;

    var titleEl = document.getElementById('erpDedModalTitle');
    if (titleEl) titleEl.textContent = TITLES[t] || 'Fuel';

    var h2 = document.getElementById('fuelManualDocTitleH2');
    if (h2) h2.textContent = TITLES[t] || 'Fuel';

    var docLab = document.getElementById('fuelManualDocNumberLabel');
    if (docLab) docLab.textContent = docNumberLabelFor(t);

    var selInline = document.getElementById('fuelManualTxnTypeSel');
    if (selInline && TITLES[t]) selInline.value = t;

    var lab = document.getElementById('erpDedModalTotalLabel');
    if (lab && global.__erpDedicatedModalKind === 'fuel') lab.textContent = 'Balance due';

    if (typeof global.syncErpDedicatedModalChrome === 'function') global.syncErpDedicatedModalChrome();
  }

  function erpShowFuelDedModalTypeRow(show) {
    var w = document.getElementById('erpDedFuelTxnTypeWrap');
    if (!w) return;
    if (show) {
      w.classList.remove('hidden');
      w.style.display = 'flex';
    } else {
      w.classList.add('hidden');
      w.style.display = 'none';
    }
  }

  function erpWireFuelDedModalTypeSelectOnce() {
    var sel = document.getElementById('erpDedFuelTxnType');
    if (!sel || sel.dataset.erpFuelTypeWired) return;
    sel.dataset.erpFuelTypeWired = '1';
    sel.addEventListener('change', function () {
      erpApplyFuelTransactionType(sel.value);
      void erpHydrateFuelVendorAddressFromApi();
    });
  }

  /** Inline fuel composer on Accounting → Fuel & DEF (same types as dedicated modal). */
  function erpWireFuelManualTypeSelectOnce() {
    var sel = document.getElementById('fuelManualTxnTypeSel');
    if (!sel || sel.dataset.erpFuelManualTypeWired) return;
    sel.dataset.erpFuelManualTypeWired = '1';
    sel.addEventListener('change', function () {
      erpApplyFuelTransactionType(sel.value);
      void erpHydrateFuelVendorAddressFromApi();
    });
  }

  async function erpHydrateFuelVendorAddressFromApi() {
    var box = document.getElementById('fuelManualVendorAddressBox');
    var hint = document.getElementById('fuelManualVendorAddressHint');
    var nameEl = document.getElementById('fuelManualVendorAddressName');
    var line1 = document.getElementById('fuelManualVendorAddressLine1');
    var line2 = document.getElementById('fuelManualVendorAddressLine2');
    var line3 = document.getElementById('fuelManualVendorAddressLine3');
    var qid = (document.getElementById('fuelManualVendorQboId') && document.getElementById('fuelManualVendorQboId').value) || '';
    var vsearch = (document.getElementById('fuelManualVendorSearch') && document.getElementById('fuelManualVendorSearch').value) || '';
    if (!box) return;
    if (!qid) {
      if (nameEl) nameEl.textContent = '';
      if (line1) line1.textContent = 'Select a vendor above — address auto-fills';
      if (line2) line2.textContent = '';
      if (line3) line3.textContent = '';
      if (hint) hint.textContent = 'Address stored in vendor database · editable per transaction';
      return;
    }
    try {
      if (typeof global.j !== 'function') return;
      var data = await global.j('/api/name-management/vendor-address/' + encodeURIComponent(qid));
      var r = data && data.record ? data.record : null;
      var dn = (r && r.display_name) || vsearch || 'Vendor';
      if (nameEl) nameEl.textContent = dn;
      var str = (r && r.street_address) || '';
      var city = (r && r.city) || '';
      var st = (r && r.state) || '';
      var zip = (r && r.zip) || '';
      var country = (r && r.country) || '';
      if (line1) line1.textContent = str || 'No address on file — add in vendor settings';
      if (line2) line2.textContent = city || st || zip ? [city, st, zip].filter(Boolean).join(', ') : '';
      if (line3) line3.textContent = country || '';
      if (hint) hint.textContent = 'Address stored in vendor database · editable per transaction';
    } catch {
      if (nameEl) nameEl.textContent = vsearch || 'Vendor';
      if (line1) line1.textContent = 'Could not load address.';
      if (line2) line2.textContent = '';
      if (line3) line3.textContent = '';
    }
  }

  function erpFuelVendorAddressEditClick(ev) {
    ev.preventDefault();
    var qid = (document.getElementById('fuelManualVendorQboId') && document.getElementById('fuelManualVendorQboId').value) || '';
    if (!qid) {
      if (typeof global.erpNotify === 'function') global.erpNotify('Select a vendor first.', 'info');
      return;
    }
    if (typeof global.openNameMgmtTool === 'function') {
      global.openNameMgmtTool();
      return;
    }
    if (typeof global.openSectionByName === 'function') global.openSectionByName('name-mgmt');
  }

  global.erpFuelTransactionTypeOrder = TYPE_ORDER;
  global.erpApplyFuelTransactionType = erpApplyFuelTransactionType;
  global.erpShowFuelDedModalTypeRow = erpShowFuelDedModalTypeRow;
  global.erpWireFuelDedModalTypeSelectOnce = erpWireFuelDedModalTypeSelectOnce;
  global.erpHydrateFuelVendorAddressFromApi = erpHydrateFuelVendorAddressFromApi;
  global.erpFuelVendorAddressEditClick = erpFuelVendorAddressEditClick;
  global.erpFuelTxnTitles = TITLES;
  global.erpWireFuelManualTypeSelectOnce = erpWireFuelManualTypeSelectOnce;
})(typeof window !== 'undefined' ? window : globalThis);
