/**
 * Smart export / print filenames (client-side).
 * No spaces; hyphens; strip illegal chars; max 120 chars + extension.
 */
(function () {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toYyyyMmDd(v) {
    if (v == null || v === '') return '';
    const s = String(v).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
    return s.replace(/[^\d-]/g, '').slice(0, 10);
  }

  function sanitizeSegment(raw) {
    let s = String(raw == null ? '' : raw)
      .trim()
      .replace(/&/g, 'and')
      .replace(/#/g, 'No')
      .replace(/[/\\:*?"<>|(),'`]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return s;
  }

  function collapseJoin(parts) {
    const out = [];
    for (const p of parts) {
      const s = sanitizeSegment(p);
      if (s) out.push(s);
    }
    let name = out.join('-').replace(/-+/g, '-');
    if (name.length > 120) name = name.slice(0, 120).replace(/-+$/g, '');
    return name || 'export';
  }

  /**
   * @param {string} documentType
   * @param {Record<string, unknown>} data
   * @param {string} extension e.g. 'pdf' or '.xlsx'
   */
  function generateFilename(documentType, data, extension) {
    const d = data && typeof data === 'object' ? data : {};
    const ext = String(extension || 'pdf').replace(/^\./, '');
    const t = String(documentType || 'document').toLowerCase();
    let unitFromGlobal = '';
    try {
      if (typeof selectedUnit !== 'undefined' && selectedUnit) unitFromGlobal = String(selectedUnit);
    } catch (_) {}
    const unit = d.unitNumber || d.unit || unitFromGlobal;
    const date = toYyyyMmDd(d.serviceDate || d.paymentDate || d.billDate || d.date || new Date());
    const vendor = d.vendor || d.payee || '';
    const wo = d.workOrderNumber || d.woNumber || '';
    const svc = d.serviceType || d.service || '';
    const ref = d.refNo || d.expenseNumber || d.expenseDoc || '';
    const billNo = d.billNumber || d.vendorInvoice || d.vendorInvoiceNumber || '';

    if (t === 'workorder' || t === 'work-order') {
      const rt = String(d.recordType || '').toLowerCase();
      const typeSeg =
        rt === 'maintenance_order' || rt === 'maintenance'
          ? 'Maintenance'
          : rt === 'repair'
            ? 'Repair'
            : rt === 'pm'
              ? 'PM'
              : rt === 'accident'
                ? 'Accident'
                : rt === 'inspection'
                  ? 'Inspection'
                  : rt === 'tire'
                    ? 'Tire'
                    : rt === 'air_bag'
                      ? 'AirBag'
                      : rt === 'battery'
                        ? 'Battery'
                        : 'WO';
      const parts = [unit, wo || null, typeSeg, sanitizeSegment(svc) || null, vendor || null, date || null];
      return `${collapseJoin(parts)}.${ext}`;
    }
    if (t === 'workorder-draft' || t === 'fleet-maintenance-draft') {
      return `${collapseJoin([unit, wo || 'DRAFT', sanitizeSegment(svc) || 'Maint', date || toYyyyMmDd(new Date())])}.${ext}`;
    }
    if (t === 'expense' || t === 'maintenance-expense') {
      return `${collapseJoin([vendor, 'MaintExp', unit, date])}.${ext}`;
    }
    if (t === 'bill' || t === 'maintenance-bill' || t === 'vendor-driver-bill') {
      return `${collapseJoin([vendor, 'Bill', billNo || wo, date])}.${ext}`;
    }
    if (t === 'fuel-bill') {
      return `${collapseJoin([vendor, 'FuelBill', billNo, date])}.${ext}`;
    }
    if (t === 'fuel-expense' || t === 'fuel') {
      return `${collapseJoin([vendor, 'Fuel', unit, date])}.${ext}`;
    }
    if (t === 'payment-receipt' || t === 'bill-payment') {
      return `${collapseJoin([vendor, 'Payment', d.paymentNumber || ref, date])}.${ext}`;
    }
    if (t === 'report' || t === 'excel' || t === 'csv') {
      const rep = d.reportName || d.title || 'Report';
      const u = d.unitFilter || d.unit || 'All';
      const start = toYyyyMmDd(d.startDate || d.from);
      const end = toYyyyMmDd(d.endDate || d.to);
      const hh = `${pad2(new Date().getHours())}${pad2(new Date().getMinutes())}${pad2(new Date().getSeconds())}`;
      return `${collapseJoin([rep, u, start, end, hh])}.${ext}`;
    }
    if (t === 'dot-audit') {
      return `${collapseJoin(['DOT-Audit', unit, d.startDate, 'to', d.endDate])}.${ext}`;
    }
    return `${collapseJoin([t, unit || vendor || 'doc', date])}.${ext}`;
  }

  window.ErpFilenameUtil = { generateFilename, sanitizeSegment, toYyyyMmDd };
  window.generateFilename = generateFilename;
})();
