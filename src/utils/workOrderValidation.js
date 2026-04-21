/**
 * IH35 ERP — maintenance work order validation (pure state + shared field/banner UI).
 * Browser IIFE: window.validateWorkOrderState, window.applyErpValidationUi, window.clearErpValidationUi,
 * window.setupErpValidationAutoClear
 */
(function (global) {
  'use strict';

  const MS_PER_DAY = 86400000;

  /**
   * @typedef {Object} WorkOrderValidationState
   * @property {string} recordType
   * @property {string} repairLocationType
   * @property {string} repairLocationDetail
   * @property {string} vendor
   * @property {string} vendorQboId
   * @property {number} serviceMileage
   * @property {number} invoiceTotal
   * @property {number} lineSum
   * @property {boolean} hasLineMoney
   * @property {Array<{partPosition?: string, amount?: number}>} costLines
   * @property {string} serviceType
   * @property {string} serviceDate
   * @property {string} accidentDate
   * @property {string} accidentLocation
   * @property {string} accidentFault
   * @property {boolean} accidentDotTouched
   * @property {string} driverId
   * @property {string} inspectionType
   * @property {string} inspectorName
   * @property {string} inspectionResult
   * @property {string} inspectionNextDue
   * @property {string} inspectionOosItems
   * @property {string} [vendorInvNo]
   * @property {string} [woNo]
   */

  /**
   * @param {WorkOrderValidationState} s
   * @param {{ postToQbo?: boolean }} opts
   * @returns {{ errors: Array<{code:string,message:string,fieldId?:string}>, warnings: Array<{code:string,message:string,fieldId?:string}> }}
   */
  function validateWorkOrderState(s, opts) {
    const errors = [];
    const warnings = [];
    const post = !!(opts && opts.postToQbo);
    const rt = String(s.recordType || '').trim();

    function pushErr(fieldId, code, message) {
      errors.push({ fieldId, code, message });
    }
    function pushWarn(fieldId, code, message) {
      warnings.push({ fieldId, code, message });
    }

    if (!String(s.repairLocationType || '').trim()) {
      pushErr('repairLocationSelect', 'repair_loc_type', 'Choose a service location type.');
    }
    if (!String(s.repairLocationDetail || '').trim()) {
      pushErr('repairLocationSearch', 'repair_loc_detail', 'Enter service location detail.');
    }

    const extNeedInvOrWo =
      String(s.repairLocationType || '').trim() === 'external' ||
      String(s.repairLocationType || '').trim() === 'road-service' ||
      String(s.repairLocationType || '').trim() === 'parts-purchase';
    if (extNeedInvOrWo) {
      const vi = String(s.vendorInvNo || '').trim();
      const wn = String(s.woNo || '').trim();
      if (!vi && !wn) {
        pushErr('recordVendorInvoiceInput', 'ext_vendor_inv', 'Vendor invoice # or ref / WO # is required for this location type.');
      }
    }

    if (!String(s.serviceType || '').trim()) {
      pushErr('serviceSearchInput', 'service_type', 'Choose or enter the service performed.');
    }

    if (rt === 'repair') {
      if (!String(s.vendor || '').trim()) {
        pushErr('vendorInput', 'repair_vendor', 'Vendor is required for repair.');
      }
      if (!Number.isFinite(s.serviceMileage) || s.serviceMileage <= 0) {
        pushErr('serviceMileageInput', 'repair_odo', 'Odometer is required for repair (positive miles).');
      }
      if (!Number.isFinite(s.invoiceTotal) || s.invoiceTotal <= 0) {
        pushErr('costInput', 'repair_cost', 'Invoice total is required for repair.');
      }
    }

    if (rt === 'accident') {
      if (!String(s.accidentDate || '').trim()) {
        pushErr('accidentDateInput', 'acc_date', 'Accident date is required.');
      }
      if (!String(s.accidentLocation || '').trim()) {
        pushErr('accidentLocationInput', 'acc_loc', 'Accident location is required.');
      }
      if (!String(s.accidentFault || '').trim()) {
        pushErr('accidentAtFaultSearch', 'acc_fault', 'Fault (at fault / not at fault) is required.');
      }
      if (!s.accidentDotTouched) {
        pushErr('accidentDotReportableInput', 'acc_dot_ack', 'Confirm DOT reportable status (toggle the checkbox).');
      }
      const driverNamed = String(s.driverName || '').trim();
      if (!String(s.driverId || '').trim() && !driverNamed) {
        pushErr('maintRecordDriverSearch', 'acc_driver', 'Driver is required for accident (select a catalog driver or type a name).');
      }
    }

    if (rt === 'inspection') {
      if (!String(s.inspectionType || '').trim()) {
        pushErr('maintInspectionScopeInput', 'insp_type', 'Inspection type is required.');
      }
      if (!String(s.inspectorName || '').trim()) {
        pushErr('maintInspectorNameInput', 'insp_insp', 'Inspector is required.');
      }
      if (!String(s.inspectionResult || '').trim()) {
        pushErr('maintInspectionResultSelect', 'insp_res', 'Inspection result is required.');
      }
      if (!String(s.inspectionNextDue || '').trim()) {
        pushErr('maintInspectionNextDueInput', 'insp_next', 'Next due date is required.');
      }
      const res = String(s.inspectionResult || '').trim();
      if ((res === 'fail' || res === 'out_of_service') && !String(s.inspectionOosItems || '').trim()) {
        pushErr('maintInspectionOosInput', 'insp_oos', 'Out-of-service items are required when the result is Fail or Out of service.');
      }
    }

    if (rt === 'tire') {
      const lines = Array.isArray(s.costLines) ? s.costLines : [];
      const hasPos = lines.some(l => String(l.partPosition || '').trim());
      if (!hasPos) {
        pushErr('maintCostLinesPanel', 'tire_pos', 'Set wheel / part position on at least one cost line.');
      }
    }

    if (post) {
      if (!String(s.vendorQboId || '').trim()) {
        pushErr('vendorInput', 'post_vendor_qbo', 'Match the vendor to a QuickBooks vendor before posting.');
      }
      if (!Number.isFinite(s.invoiceTotal) || s.invoiceTotal <= 0) {
        pushErr('costInput', 'post_inv', 'Invoice total must be greater than zero to post to QuickBooks.');
      }
      if (!s.hasLineMoney) {
        pushErr('maintCostLinesPanel', 'post_lines', 'Add at least one cost line with an amount before posting.');
      }
      const badQbo = (Array.isArray(s.costLines) ? s.costLines : []).some(l => {
        const amt = Number(l.amount) || 0;
        if (amt <= 0) return false;
        const dm = String(l.detailMode || 'category').trim() === 'item' ? 'item' : 'category';
        if (dm === 'item') return !String(l.qboItemId || '').trim();
        return !String(l.qboAccountId || '').trim();
      });
      if (badQbo) {
        pushErr('maintCostLinesPanel', 'post_qbo_line', 'Each line with an amount needs a QuickBooks account or item.');
      }
    }

    const sd = String(s.serviceDate || '').trim();
    if (sd) {
      const d = new Date(sd + 'T12:00:00');
      if (!Number.isNaN(d.getTime())) {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const ageDays = (today - d) / MS_PER_DAY;
        if (ageDays > 730) {
          pushWarn('serviceDateInput', 'svc_date_old', 'Service date is more than two years in the past — confirm it is correct.');
        }
        if (ageDays < -7) {
          pushWarn('serviceDateInput', 'svc_date_future', 'Service date is more than a week in the future — confirm it is correct.');
        }
      }
    }

    if (s.hasLineMoney && Number.isFinite(s.invoiceTotal) && Number.isFinite(s.lineSum) && Math.abs(s.invoiceTotal - s.lineSum) > 0.02) {
      pushWarn('costInput', 'inv_mismatch', `Invoice total ($${s.invoiceTotal.toFixed(2)}) does not match line sum ($${s.lineSum.toFixed(2)}).`);
    }
    if (Number.isFinite(s.invoiceTotal) && s.invoiceTotal === 0 && s.hasLineMoney) {
      pushWarn('costInput', 'inv_zero', 'Invoice total is $0 while lines have amounts — confirm before saving.');
    }

    return { errors, warnings };
  }

  function clearFieldErrorById(root, fieldId) {
    if (!root || !fieldId) return;
    if (fieldId === 'apDocTotalDisplay') {
      document.getElementById('apDocTotalLabel')?.classList.remove('erp-label--error');
    }
    const el = document.getElementById(fieldId);
    if (el) {
      el.classList.remove('erp-input--error', 'erp-select--error');
      const cell = el.closest('.maint-field-cell, .ap-exp-field, .maint-field-cell--odo-150, label');
      if (cell && cell.classList && cell.querySelector) {
        cell.querySelectorAll('.qb-l').forEach(l => l.classList.remove('erp-label--error'));
      }
    }
    root.querySelectorAll('[data-erp-field-error="1"]').forEach(n => {
      if (n.dataset.for === fieldId) n.remove();
    });
  }

  function clearErpValidationUi(formRootSelector) {
    const root = document.querySelector(formRootSelector);
    if (!root) return;
    root.querySelectorAll('.erp-input--error, .erp-select--error').forEach(el => {
      el.classList.remove('erp-input--error', 'erp-select--error');
    });
    root.querySelectorAll('.erp-label--error').forEach(l => l.classList.remove('erp-label--error'));
    root.querySelectorAll('[data-erp-field-error="1"]').forEach(n => n.remove());
  }

  function applyFieldError(root, fieldId, message) {
    if (!root || !fieldId) return;
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.classList.add('erp-input--error');
    if (el.tagName === 'SELECT') el.classList.add('erp-select--error');

    if (fieldId === 'apDocTotalDisplay') {
      document.getElementById('apDocTotalLabel')?.classList.add('erp-label--error');
    }

    const cell = el.closest('.maint-field-cell, .ap-exp-field, .maint-field-cell--odo-150');
    if (cell) {
      const lab = cell.querySelector('.qb-l');
      if (lab) lab.classList.add('erp-label--error');
    } else if (el.closest('label')) {
      const lb = el.closest('label').parentElement;
      const prev = lb && lb.querySelector('.qb-l');
      if (prev) prev.classList.add('erp-label--error');
    }

    let dup = false;
    root.querySelectorAll('[data-erp-field-error="1"]').forEach(n => {
      if (n.dataset.for === fieldId) dup = true;
    });
    if (dup) return;

    const err = document.createElement('div');
    err.className = 'erp-field-error';
    err.dataset.erpFieldError = '1';
    err.dataset.for = fieldId;
    err.setAttribute('role', 'alert');
    const ic = document.createElement('span');
    ic.className = 'erp-field-error__ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = '!';
    const tx = document.createElement('span');
    tx.className = 'erp-field-error__txt';
    tx.textContent = message;
    err.appendChild(ic);
    err.appendChild(tx);

    if (fieldId === 'maintCostLinesPanel') {
      const host = el.querySelector('.maint-subcard__head') || el;
      host.insertAdjacentElement('afterend', err);
    } else if (fieldId === 'woLines') {
      el.insertAdjacentElement('afterend', err);
    } else if (el.parentNode) {
      el.insertAdjacentElement('afterend', err);
    }
  }

  function renderBanner(banner, errors, warnings, firstFieldId) {
    const errList = (errors || [])
      .map(e => `<li data-err-field="${String(e.fieldId || '').replace(/"/g, '&quot;')}">${escapeHtml(e.message)}</li>`)
      .join('');
    const warnList = (warnings || [])
      .map(w => `<li>${escapeHtml(w.message)}</li>`)
      .join('');
    const scrollBtn =
      errors && errors.length && firstFieldId
        ? `<button type="button" class="erp-validation-banner__link" data-erp-scroll-first="1">Scroll to first error</button>`
        : '';
    let html = '';
    if (errors && errors.length) {
      html += `<div class="erp-validation-banner__block erp-validation-banner__block--error"><strong>Fix before saving</strong><ul class="erp-validation-banner__list">${errList}</ul>${scrollBtn}</div>`;
    }
    if (warnings && warnings.length) {
      html += `<div class="erp-validation-banner__block erp-validation-banner__block--warn"><strong>Warnings</strong><ul class="erp-validation-banner__list">${warnList}</ul></div>`;
    }
    banner.innerHTML = html;
    const btn = banner.querySelector('[data-erp-scroll-first="1"]');
    if (btn && firstFieldId) {
      btn.addEventListener('click', () => {
        const t = document.getElementById(firstFieldId);
        if (t) {
          try {
            t.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } catch (_) {}
          try {
            t.focus({ preventScroll: true });
          } catch (_) {
            t.focus();
          }
        }
      });
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {string} bannerId
   * @param {string} formRootSelector
   * @param {{ errors: any[], warnings: any[] }} result
   */
  function applyErpValidationUi(bannerId, formRootSelector, result) {
    const banner = document.getElementById(bannerId);
    const root = document.querySelector(formRootSelector);
    if (!banner || !root) return;

    clearErpValidationUi(formRootSelector);

    const errors = result.errors || [];
    const warnings = result.warnings || [];
    global.__erpLastValidationWarnings = warnings.slice();

    if (!errors.length && !warnings.length) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      banner.classList.remove('erp-validation-banner--shake');
      return;
    }

    banner.classList.remove('hidden');
    banner.classList.remove('erp-validation-banner--shake');
    void banner.offsetWidth;
    banner.classList.add('erp-validation-banner--shake');

    const firstFieldId = errors.length && errors[0].fieldId ? errors[0].fieldId : '';
    renderBanner(banner, errors, warnings, firstFieldId);

    errors.forEach(e => {
      if (e.fieldId) applyFieldError(root, e.fieldId, e.message);
    });

    try {
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}
  }

  function refreshBannerAfterPartialClear(bannerId, formRootSelector) {
    const banner = document.getElementById(bannerId);
    const root = document.querySelector(formRootSelector);
    if (!banner || !root) return;
    const remaining = root.querySelectorAll('[data-erp-field-error="1"]').length;
    const warns = global.__erpLastValidationWarnings || [];
    if (remaining === 0 && !warns.length) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      banner.classList.remove('erp-validation-banner--shake');
      return;
    }
    if (remaining === 0 && warns.length) {
      renderBanner(banner, [], warns, '');
      banner.classList.remove('hidden');
    }
  }

  function setupErpValidationAutoClear(formRootSelector, bannerId) {
    const root = document.querySelector(formRootSelector);
    if (!root || root.dataset.erpValClearBound === '1') return;
    root.dataset.erpValClearBound = '1';
    const handler = ev => {
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const id = t.id;
      if (id) clearFieldErrorById(root, id);
      const row = t.closest && t.closest('.maint-cost-cat-line, .maint-cost-item-line, .wo-line');
      if (row && root.contains(row)) {
        clearFieldErrorById(root, 'maintCostLinesPanel');
        clearFieldErrorById(root, 'woLines');
      }
      if (!id && !row) return;
      refreshBannerAfterPartialClear(bannerId, formRootSelector);
    };
    root.addEventListener('input', handler, true);
    root.addEventListener('change', handler, true);
  }

  global.validateWorkOrderState = validateWorkOrderState;
  global.applyErpValidationUi = applyErpValidationUi;
  global.clearErpValidationUi = clearErpValidationUi;
  global.setupErpValidationAutoClear = setupErpValidationAutoClear;
})(typeof window !== 'undefined' ? window : globalThis);
