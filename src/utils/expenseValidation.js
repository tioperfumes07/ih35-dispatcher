/**
 * IH35 ERP — maintenance AP / work-order expense composer validation (pure state).
 * Depends on the same page loading `workOrderValidation.js` for `applyErpValidationUi` / field chrome.
 * Browser IIFE: window.validateExpenseState
 */
(function (global) {
  'use strict';

  const MS_PER_DAY = 86400000;

  /**
   * @typedef {Object} ExpenseValidationState
   * @property {string} vendorQboId
   * @property {string} unit
   * @property {string} txnDate
   * @property {string} [maintRecordType]
   * @property {string} [dedicatedApPreset]
   * @property {string} [repairLocationType]
   * @property {string} [repairLocationLabel]
   * @property {string} [driverHeaderName]
   * @property {string} [driverErpId]
   * @property {Array<{amount?: number, detailMode?: string, qboAccountId?: string, qboItemId?: string, partPosition?: string}>} lines
   * @property {number} docTotal
   * @property {number} lineSum
   * @property {boolean} hasLineMoney
   */

  /**
   * @param {ExpenseValidationState} s
   * @param {{ postToQbo?: boolean }} opts
   * @returns {{ errors: Array<{code:string,message:string,fieldId?:string}>, warnings: Array<{code:string,message:string,fieldId?:string}> }}
   */
  function validateExpenseState(s, opts) {
    const errors = [];
    const warnings = [];
    const post = !!(opts && opts.postToQbo);

    function pushErr(fieldId, code, message) {
      errors.push({ fieldId, code, message });
    }
    function pushWarn(fieldId, code, message) {
      warnings.push({ fieldId, code, message });
    }

    if (!String(s.vendorQboId || '').trim()) {
      pushErr('apVendorSearch', 'ap_vendor', 'Choose a QuickBooks vendor (type to match the list).');
    }
    if (!String(s.unit || '').trim()) {
      pushErr('apAssetUnit', 'ap_unit', 'Unit / asset is required.');
    }

    const preset = String(s.dedicatedApPreset || '').trim();
    if (preset === 'driver-bill' && !String(s.driverHeaderName || '').trim()) {
      pushErr('apHeaderDriverSearch', 'ap_driver_bill', 'Driver bill — choose the driver on the Driver (QBO customer) row.');
    }
    if (preset === 'repair-bill') {
      if (!String(s.repairLocationType || '').trim()) {
        pushErr('apRepairLocationSelect', 'ap_repair_loc_type', 'Repair bill — choose a service location type.');
      }
      if (!String(s.repairLocationLabel || '').trim()) {
        pushErr('apRepairLocationSearch', 'ap_repair_loc_name', 'Repair bill — enter the service location (shop or site name).');
      }
    }
    if (preset === 'maintenance-bill') {
      if (!String(s.repairLocationType || '').trim()) {
        pushErr('apRepairLocationSelect', 'ap_maint_loc_type', 'Maintenance bill — choose a service location type.');
      }
    }

    const lines = Array.isArray(s.lines) ? s.lines : [];
    if (!lines.length) {
      pushErr('woLines', 'ap_lines', 'Add at least one line with an amount greater than zero.');
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dm = String(l.detailMode || 'category').trim() === 'item' ? 'item' : 'category';
      if (dm === 'category' && !String(l.qboAccountId || '').trim()) {
        pushErr('woLines', 'ap_line_acct', 'Each category line needs a resolved QuickBooks account.');
        break;
      }
      if (dm === 'item' && !String(l.qboItemId || '').trim()) {
        pushErr('woLines', 'ap_line_item', 'Each item line needs a resolved QuickBooks item.');
        break;
      }
    }

    if (post && (!Number.isFinite(s.docTotal) || s.docTotal <= 0)) {
      pushErr('apDocTotalDisplay', 'ap_post_total', 'Document total must be greater than zero to post.');
    }

    const mrt = String(s.maintRecordType || '').trim();
    if (mrt === 'accident' && !String(s.driverErpId || '').trim()) {
      pushErr('apErpDriverSearch', 'ap_acc_driver', 'Driver is required for accident maintenance bills/expenses.');
    }
    if (mrt === 'tire') {
      const hasPos = lines.some(l => String(l.partPosition || '').trim());
      if (!hasPos) {
        pushErr('woLines', 'ap_tire_pos', 'Set wheel / part position on at least one line for a tire expense.');
      }
    }

    const td = String(s.txnDate || '').trim();
    if (td) {
      const d = new Date(td + 'T12:00:00');
      if (!Number.isNaN(d.getTime())) {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const ageDays = (today - d) / MS_PER_DAY;
        if (ageDays > 730) {
          pushWarn('apTxnDate', 'ap_date_old', 'Transaction date is more than two years in the past — confirm it is correct.');
        }
        if (ageDays < -7) {
          pushWarn('apTxnDate', 'ap_date_future', 'Transaction date is more than a week in the future — confirm it is correct.');
        }
      }
    }

    if (s.hasLineMoney && Number.isFinite(s.docTotal) && Number.isFinite(s.lineSum) && Math.abs(s.docTotal - s.lineSum) > 0.02) {
      pushWarn('apDocTotalDisplay', 'ap_inv_mismatch', `Displayed total ($${s.docTotal.toFixed(2)}) does not match line sum ($${s.lineSum.toFixed(2)}).`);
    }
    if (Number.isFinite(s.docTotal) && s.docTotal === 0 && s.hasLineMoney) {
      pushWarn('apDocTotalDisplay', 'ap_inv_zero', 'Total is $0 while lines have amounts — confirm before saving.');
    }

    return { errors, warnings };
  }

  global.validateExpenseState = validateExpenseState;
})(typeof window !== 'undefined' ? window : globalThis);
