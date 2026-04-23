/**
 * IH35 ERP — Accounting expense/bill validation (pure state; browser IIFE).
 * Exposes: window.validateExpenseState
 */
(function (global) {
  'use strict';

  const MS_PER_DAY = 86400000;

  /**
   * @typedef {Object} ExpenseValidationState
   * @property {string} vendorQboId
   * @property {string} unit
   * @property {string} txnDate
   * @property {string} maintRecordType
   * @property {string} driverErpId
   * @property {string} driverSearchText — free text in catalog driver field (sent as driverName when no ERP id)
   * @property {string} driverHeaderName — optional QBO customer / header driver
   * @property {string} dedicatedApPreset
   * @property {string} repairLocationType
   * @property {string} repairLocationLabel
   * @property {string} serviceType
   * @property {string} vendorInvNo
   * @property {string} internalWoNo
   * @property {boolean} accidentDotTouched
   * @property {Array<{detailMode?: string, amount?: number, qboAccountId?: string, qboItemId?: string}>} lines
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
      pushErr('apVendorSearch', 'ap_vendor', 'Match a QuickBooks vendor before saving.');
    }
    if (!String(s.unit || '').trim()) {
      pushErr('apAssetUnit', 'ap_unit', 'Unit / asset is required.');
    }
    const td = String(s.txnDate || '').trim();
    if (!td) {
      pushErr('apTxnDate', 'ap_date', 'Transaction date is required.');
    }

    if (!String(s.serviceType || '').trim()) {
      pushErr('apServiceSearchInput', 'ap_svc', 'Enter or choose a service type / description.');
    }

    const preset = String(s.dedicatedApPreset || '').trim();
    const maintDedicated = /^(maintenance|repair)-(expense|bill)$/.test(preset);
    if (maintDedicated) {
      if (!String(s.repairLocationType || '').trim()) {
        pushErr('apRepairLocationSelect', 'ap_repair_loc', 'Choose a service location type.');
      }
      if (!String(s.repairLocationLabel || '').trim()) {
        pushErr('apRepairLocationSearch', 'ap_repair_loc_lbl', 'Enter service location detail.');
      }
      const rlt = String(s.repairLocationType || '').trim();
      const extNeedInvOrWo = rlt === 'external' || rlt === 'road-service' || rlt === 'parts-purchase';
      if (extNeedInvOrWo) {
        const vi = String(s.vendorInvNo || '').trim();
        const wn = String(s.internalWoNo || '').trim();
        if (!vi && !wn) {
          pushErr('apVendorInvoiceNumber', 'ap_ext_inv', 'Vendor invoice # or internal WO # is required for this location type.');
        }
      }
      if (!String(s.repairLocationLabel || '').trim()) {
        pushErr('apRepairLocationSearch', 'ap_maint_loc_name', 'Maintenance bill — enter the service location (shop or site name).');
      }
    }

    if (!s.hasLineMoney && (!Number.isFinite(s.docTotal) || s.docTotal <= 0)) {
      pushErr('woLines', 'ap_lines', 'Add at least one line with an amount (or a positive document total).');
    }

    const mrt = String(s.maintRecordType || '').trim().toLowerCase();
    if (mrt === 'accident') {
      const id = String(s.driverErpId || '').trim();
      const qboHdr = String(s.driverHeaderName || '').trim();
      const free = String(s.driverSearchText || '').trim();
      if (!id && !qboHdr && !free) {
        pushErr(
          'apErpDriverSearch',
          'ap_acc_driver',
          'Driver is required for accident bills/expenses (catalog driver, typed name, or header driver / customer).'
        );
      }
      if (!s.accidentDotTouched) {
        pushErr(
          'apAccidentDotReportableCb',
          'ap_acc_dot_ack',
          'Confirm DOT reportable status (toggle the checkbox).'
        );
      }
    }

    if (post) {
      if (!String(s.vendorQboId || '').trim()) {
        pushErr('apVendorSearch', 'post_ap_vendor', 'Match the vendor to a QuickBooks vendor before posting.');
      }
      if (!Number.isFinite(s.docTotal) || s.docTotal <= 0) {
        pushErr('apDocTotalDisplay', 'post_ap_amt', 'Document total must be greater than zero to post to QuickBooks.');
      }
      if (!s.hasLineMoney) {
        pushErr('woLines', 'post_ap_lines', 'Add at least one cost line with an amount before posting.');
      }
      const badQbo = (Array.isArray(s.lines) ? s.lines : []).some(l => {
        const amt = Number(l.amount) || 0;
        if (amt <= 0) return false;
        const dm = String(l.detailMode || 'category').trim() === 'item' ? 'item' : 'category';
        if (dm === 'item') return !String(l.qboItemId || '').trim();
        return !String(l.qboAccountId || '').trim();
      });
      if (badQbo) {
        pushErr('woLines', 'post_ap_qbo_line', 'Each line with an amount needs a QuickBooks account or item.');
      }
    }

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
      pushWarn('apDocTotalDisplay', 'ap_inv_mismatch', `Document total ($${s.docTotal.toFixed(2)}) does not match line sum ($${s.lineSum.toFixed(2)}).`);
    }

    return { errors, warnings };
  }

  global.validateExpenseState = validateExpenseState;
})(typeof window !== 'undefined' ? window : globalThis);
