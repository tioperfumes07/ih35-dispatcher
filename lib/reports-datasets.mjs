/**
 * Tabular report datasets for GET /api/reports/dataset?id=…
 * Read-only transforms over ERP JSON — no persistence.
 */

function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function dateInRange(d, start, end) {
  const x = sliceIso(d);
  if (!x) return !start && !end;
  if (start && x < sliceIso(start)) return false;
  if (end && x > sliceIso(end)) return false;
  return true;
}

function woLineTotal(wo) {
  return (wo.lines || []).reduce((s, l) => s + (safeNum(l.amount, 0) || 0), 0);
}

function inferRecordType(wo) {
  const rt = String(wo.recordType || '').trim();
  if (rt) return rt;
  const lines = wo.lines || [];
  if (lines.some(l => String(l.lineType || '').toLowerCase() === 'tire' || String(l.tirePosition || '').trim()))
    return 'tire';
  const st = String(wo.serviceType || '').toLowerCase();
  if (st.includes('pm') || st.includes('preventive')) return 'pm';
  if (st.includes('accident') || st.includes('collision')) return 'accident';
  if (st.includes('battery')) return 'battery';
  if (st.includes('air bag') || st.includes('airbag')) return 'air_bag';
  return String(wo.txnType || 'work_order').trim() || 'maintenance';
}

function primaryServiceType(wo) {
  const lines = wo.lines || [];
  const st = lines.map(l => String(l.serviceType || '').trim()).filter(Boolean);
  if (st.length) return st[0];
  return String(wo.serviceType || '').trim() || '—';
}

function activeWorkOrders(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

/** @param {Record<string, { ymm?: string }>} fleetByUnit */
export async function buildReportDataset(id, erp, query, ctx = {}) {
  const fleetByUnit = ctx.fleetByUnit || {};
  const hosClocks = ctx.hosClocks || [];
  const dbLoads = ctx.dbLoads || [];
  const startDate = query.startDate || '';
  const endDate = query.endDate || '';
  const unitFilter = String(query.unit || '').trim().toLowerCase();
  const vendorFilter = String(query.vendor || '').trim().toLowerCase();
  const statusFilter = String(query.status || '').trim().toLowerCase();
  const positionFilter = String(query.position || '').trim().toLowerCase();

  const companyProfile = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
  const pmInterval = safeNum(companyProfile.pmIntervalMiles, 25000) || 25000;

  switch (id) {
    case 'a1-work-order-history': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const vkey = String(wo.unit || '').trim();
        const fleet = fleetByUnit[vkey] || {};
        const vendor = String(wo.vendor || '').trim();
        if (vendorFilter && !vendor.toLowerCase().includes(vendorFilter)) continue;
        const st = String(wo.qboSyncStatus || '').toLowerCase();
        if (statusFilter && !st.includes(statusFilter)) continue;
        const rt = inferRecordType(wo);
        if (String(query.recordType || '').trim() && rt !== String(query.recordType).trim()) continue;
        const svcQ = String(query.serviceType || '').trim().toLowerCase();
        if (svcQ && !primaryServiceType(wo).toLowerCase().includes(svcQ)) continue;
        const tot = woLineTotal(wo);
        rows.push({
          woNumber: wo.workOrderNumber || wo.internalWorkOrderNumber || wo.id,
          date: sliceIso(wo.serviceDate),
          unit: wo.unit || '',
          ymm: fleet.ymm || '',
          recordType: rt,
          serviceType: primaryServiceType(wo),
          vendor,
          invoiceNo: wo.vendorInvoiceNumber || '',
          total: Math.round(tot * 100) / 100,
          status: wo.qboSyncStatus || '',
          postedQbo: wo.qboEntityId ? 'Y' : 'N',
          serviceLocation: wo.repairLocationType || ''
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const sum = rows.reduce((s, r) => s + (safeNum(r.total, 0) || 0), 0);
      return {
        ok: true,
        title: 'Work order history',
        columns: [
          { key: 'woNumber', label: 'WO#' },
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'ymm', label: 'Year/Make/Model' },
          { key: 'recordType', label: 'Record type' },
          { key: 'serviceType', label: 'Service type' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'invoiceNo', label: 'Invoice #' },
          { key: 'total', label: 'Total $' },
          { key: 'status', label: 'Status' },
          { key: 'postedQbo', label: 'Posted QBO' },
          { key: 'serviceLocation', label: 'Service location' }
        ],
        rows,
        totals: { count: rows.length, totalDollars: Math.round(sum * 100) / 100 }
      };
    }
    case 'a2-cost-by-unit': {
      const by = {};
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        const u = String(wo.unit || '').trim() || '—';
        if (unitFilter && u.toLowerCase() !== unitFilter) continue;
        const rt = inferRecordType(wo);
        if (String(query.recordType || '').trim() && rt !== String(query.recordType).trim()) continue;
        const t = woLineTotal(wo);
        if (!by[u]) by[u] = { unit: u, woCount: 0, total: 0, lastDate: '' };
        by[u].woCount += 1;
        by[u].total += t;
        const d = sliceIso(wo.serviceDate);
        if (d && d > by[u].lastDate) by[u].lastDate = d;
      }
      const rows = Object.values(by).map(r => ({
        unit: r.unit,
        makeModel: (fleetByUnit[r.unit] && fleetByUnit[r.unit].ymm) || '',
        totalWOs: r.woCount,
        totalDollars: Math.round(r.total * 100) / 100,
        avgPerWo: r.woCount ? Math.round((r.total / r.woCount) * 100) / 100 : 0,
        lastServiceDate: r.lastDate
      }));
      rows.sort((a, b) => (b.totalDollars || 0) - (a.totalDollars || 0));
      const sumCost = rows.reduce((s, r) => s + (safeNum(r.totalDollars, 0) || 0), 0);
      const sumWo = rows.reduce((s, r) => s + (safeNum(r.totalWOs, 0) || 0), 0);
      return {
        ok: true,
        title: 'Cost by unit',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'makeModel', label: 'Make/Model' },
          { key: 'totalWOs', label: 'Total WOs' },
          { key: 'totalDollars', label: 'Total $' },
          { key: 'avgPerWo', label: 'Avg cost per WO' },
          { key: 'lastServiceDate', label: 'Last service date' }
        ],
        rows,
        totals: { total_cost: Math.round(sumCost * 100) / 100, total_work_orders: sumWo },
        meta: { hasChart: true, chartType: 'bar', chartXKey: 'unit', chartYKey: 'totalDollars', totalRows: rows.length }
      };
    }
    case 'a3-cost-by-service-type': {
      const by = {};
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const svc = primaryServiceType(wo) || '—';
        const t = woLineTotal(wo);
        if (!by[svc]) by[svc] = { serviceType: svc, count: 0, total: 0 };
        by[svc].count += 1;
        by[svc].total += t;
      }
      const grand = Object.values(by).reduce((s, x) => s + x.total, 0) || 1;
      const rows = Object.values(by).map(x => ({
        serviceType: x.serviceType,
        count: x.count,
        totalDollars: Math.round(x.total * 100) / 100,
        avgDollars: x.count ? Math.round((x.total / x.count) * 100) / 100 : 0,
        pctSpend: Math.round((x.total / grand) * 10000) / 100
      }));
      rows.sort((a, b) => (b.totalDollars || 0) - (a.totalDollars || 0));
      const totCost = rows.reduce((s, r) => s + (safeNum(r.totalDollars, 0) || 0), 0);
      const totCnt = rows.reduce((s, r) => s + (safeNum(r.count, 0) || 0), 0);
      return {
        ok: true,
        title: 'Cost by service type',
        columns: [
          { key: 'serviceType', label: 'Service type' },
          { key: 'count', label: 'Count' },
          { key: 'totalDollars', label: 'Total $' },
          { key: 'avgDollars', label: 'Avg $' },
          { key: 'pctSpend', label: '% of total spend' }
        ],
        rows,
        totals: { total_cost: Math.round(totCost * 100) / 100, total_records: totCnt },
        meta: { hasChart: true, chartType: 'pie', chartLabelKey: 'serviceType', chartYKey: 'totalDollars', totalRows: rows.length }
      };
    }
    case 'a4-pm-schedule': {
      const rows = [];
      const units = new Set([
        ...activeWorkOrders(erp).map(w => String(w.unit || '').trim()).filter(Boolean),
        ...Object.keys(erp.currentMileage || {})
      ]);
      for (const u of units) {
        if (unitFilter && u.toLowerCase() !== unitFilter) continue;
        const fleet = fleetByUnit[u] || {};
        let lastPmDate = '';
        let lastPmMiles = null;
        for (const wo of activeWorkOrders(erp)) {
          if (String(wo.unit || '').trim() !== u) continue;
          const rt = inferRecordType(wo);
          if (rt !== 'pm' && !primaryServiceType(wo).toLowerCase().includes('pm')) continue;
          const d = sliceIso(wo.serviceDate);
          if (d && d > lastPmDate) {
            lastPmDate = d;
            const mx = Math.max(0, ...(wo.lines || []).map(l => safeNum(l.serviceMileage, 0) || 0));
            lastPmMiles = mx || lastPmMiles;
          }
        }
        const cur =
          safeNum(erp.currentMileage && erp.currentMileage[u], null) ??
          safeNum(fleet.odometerMiles, null) ??
          null;
        const nextDue = lastPmMiles != null && Number.isFinite(lastPmMiles) ? lastPmMiles + pmInterval : null;
        let status = 'gray';
        let statusLabel = 'No PM on record';
        if (nextDue != null && cur != null) {
          if (cur > nextDue) {
            status = 'red';
            statusLabel = 'Overdue';
          } else if (nextDue - cur <= 1000) {
            status = 'amber';
            statusLabel = 'Due soon';
          } else {
            status = 'green';
            statusLabel = 'OK';
          }
        } else if (lastPmDate) {
          status = 'amber';
          statusLabel = 'Miles unknown';
        }
        rows.push({
          unit: u,
          makeModel: fleet.ymm || '',
          lastPmDate,
          lastPmMiles: lastPmMiles ?? '',
          nextPmDueMiles: nextDue ?? '',
          currentMiles: cur ?? '',
          milesRemaining:
            nextDue != null && cur != null ? Math.round((nextDue - cur) * 10) / 10 : '',
          status,
          statusLabel
        });
      }
      rows.sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
      return {
        ok: true,
        title: 'PM schedule',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'makeModel', label: 'Make/Model' },
          { key: 'lastPmDate', label: 'Last PM date' },
          { key: 'lastPmMiles', label: 'Last PM miles' },
          { key: 'nextPmDueMiles', label: 'Next PM due miles' },
          { key: 'currentMiles', label: 'Current miles' },
          { key: 'milesRemaining', label: 'Miles remaining' },
          { key: 'statusLabel', label: 'Status' }
        ],
        rows
      };
    }
    case 'a5-tire-history': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        for (const ln of wo.lines || []) {
          const isTire =
            String(ln.lineType || '').toLowerCase() === 'tire' ||
            String(inferRecordType(wo)).toLowerCase() === 'tire';
          if (!isTire && !String(ln.tirePosition || '').trim()) continue;
          const pos = String(ln.tirePosition || ln.tirePositionText || ln.partPosition || '').trim();
          if (positionFilter && pos.toLowerCase() !== positionFilter) continue;
          rows.push({
            date: sliceIso(wo.serviceDate),
            unit: wo.unit || '',
            position: pos || '—',
            partNumber: ln.partNumber || '',
            brand: ln.partCategory || '',
            description: ln.notes || ln.serviceType || '',
            mileage: ln.serviceMileage ?? '',
            cost: safeNum(ln.amount, 0),
            woNumber: wo.workOrderNumber || '',
            vendor: wo.vendor || ''
          });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Tire history',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'position', label: 'Position' },
          { key: 'partNumber', label: 'Part #' },
          { key: 'brand', label: 'Brand' },
          { key: 'description', label: 'Description' },
          { key: 'mileage', label: 'Mileage' },
          { key: 'cost', label: 'Cost' },
          { key: 'woNumber', label: 'WO#' },
          { key: 'vendor', label: 'Vendor' }
        ],
        rows,
        meta: { positions: [...new Set(rows.map(r => r.position).filter(p => p && p !== '—'))].sort() }
      };
    }
    case 'a6-air-bag-history': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const rt = inferRecordType(wo);
        if (rt !== 'air_bag' && !primaryServiceType(wo).toLowerCase().includes('air')) continue;
        for (const ln of wo.lines || []) {
          const pos = String(ln.partPosition || ln.tirePosition || '').trim();
          if (positionFilter && pos.toLowerCase() !== positionFilter) continue;
          rows.push({
            date: sliceIso(wo.serviceDate),
            unit: wo.unit || '',
            position: pos || '—',
            partNumber: ln.partNumber || '',
            description: ln.notes || ln.serviceType || '',
            mileage: ln.serviceMileage ?? '',
            cost: safeNum(ln.amount, 0),
            woNumber: wo.workOrderNumber || '',
            vendor: wo.vendor || ''
          });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Air bag history',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'position', label: 'Position' },
          { key: 'partNumber', label: 'Part #' },
          { key: 'description', label: 'Description' },
          { key: 'mileage', label: 'Mileage' },
          { key: 'cost', label: 'Cost' },
          { key: 'woNumber', label: 'WO#' },
          { key: 'vendor', label: 'Vendor' }
        ],
        rows,
        meta: { positions: [...new Set(rows.map(r => r.position))].filter(Boolean).sort() }
      };
    }
    case 'a7-battery-history': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const rt = inferRecordType(wo);
        if (rt !== 'battery' && !primaryServiceType(wo).toLowerCase().includes('battery')) continue;
        for (const ln of wo.lines || []) {
          rows.push({
            date: sliceIso(wo.serviceDate),
            unit: wo.unit || '',
            partNumber: ln.partNumber || '',
            brand: ln.partCategory || '',
            description: ln.notes || ln.serviceType || '',
            mileage: ln.serviceMileage ?? '',
            cost: safeNum(ln.amount, 0),
            woNumber: wo.workOrderNumber || '',
            vendor: wo.vendor || ''
          });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Battery history',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'partNumber', label: 'Part #' },
          { key: 'brand', label: 'Brand' },
          { key: 'description', label: 'Description' },
          { key: 'mileage', label: 'Mileage' },
          { key: 'cost', label: 'Cost' },
          { key: 'woNumber', label: 'WO#' },
          { key: 'vendor', label: 'Vendor' }
        ],
        rows
      };
    }
    case 'a8-accident-collision': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const rt = inferRecordType(wo);
        if (rt !== 'accident' && !primaryServiceType(wo).toLowerCase().includes('accident')) continue;
        rows.push({
          date: sliceIso(wo.serviceDate),
          unit: wo.unit || '',
          location: wo.repairLocationType || wo.origin || '',
          policeReport: wo.policeReportNumber || '',
          fault: wo.accidentFault || '',
          insuranceClaim: wo.insuranceClaimNumber || '',
          dotReportable: wo.dotReportable ? 'Y' : 'N',
          estDamage: wo.estimatedDamageAmount ?? '',
          actualRepair: woLineTotal(wo),
          woNumber: wo.workOrderNumber || '',
          status: wo.qboSyncStatus || ''
        });
      }
      for (const r of erp.records || []) {
        if (String(r.recordType || '').toLowerCase() !== 'accident') continue;
        if (!dateInRange(r.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(r.unit || '').toLowerCase() !== unitFilter) continue;
        rows.push({
          date: sliceIso(r.serviceDate),
          unit: r.unit || '',
          location: r.location || '',
          policeReport: r.policeReportNumber || '',
          fault: r.fault || '',
          insuranceClaim: r.insuranceClaimNumber || '',
          dotReportable: r.dotReportable ? 'Y' : 'N',
          estDamage: r.estimatedDamage || '',
          actualRepair: safeNum(r.cost, 0),
          woNumber: r.workOrderRef || '',
          status: r.qboSyncStatus || ''
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Accident / collision report',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'location', label: 'Location' },
          { key: 'policeReport', label: 'Police report #' },
          { key: 'fault', label: 'Fault' },
          { key: 'insuranceClaim', label: 'Insurance claim #' },
          { key: 'dotReportable', label: 'DOT reportable' },
          { key: 'estDamage', label: 'Est. damage $' },
          { key: 'actualRepair', label: 'Actual repair $' },
          { key: 'woNumber', label: 'WO#' },
          { key: 'status', label: 'Status' }
        ],
        rows
      };
    }
    case 'a9-fleet-repair-monthly': {
      const byMonth = {};
      for (const wo of activeWorkOrders(erp)) {
        const d = sliceIso(wo.serviceDate);
        if (!d) continue;
        if (!dateInRange(d, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const m = d.slice(0, 7);
        if (!byMonth[m]) byMonth[m] = { month: m, woCount: 0, total: 0, svcCounts: {} };
        byMonth[m].woCount += 1;
        byMonth[m].total += woLineTotal(wo);
        const svc = primaryServiceType(wo);
        byMonth[m].svcCounts[svc] = (byMonth[m].svcCounts[svc] || 0) + 1;
      }
      const rows = Object.values(byMonth)
        .map(x => {
          const top = Object.entries(x.svcCounts).sort((a, b) => b[1] - a[1])[0];
          return {
            month: x.month,
            woCount: x.woCount,
            totalDollars: Math.round(x.total * 100) / 100,
            avgCost: x.woCount ? Math.round((x.total / x.woCount) * 100) / 100 : 0,
            topService: top ? top[0] : '—'
          };
        })
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      return {
        ok: true,
        title: 'Fleet repair summary (monthly)',
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'woCount', label: '# of WOs' },
          { key: 'totalDollars', label: 'Total $' },
          { key: 'avgCost', label: 'Avg cost' },
          { key: 'topService', label: 'Most common service type' }
        ],
        rows,
        meta: { hasChart: true, chartType: 'line', chartXKey: 'month', chartYKey: 'totalDollars' }
      };
    }
    case 'a10-inspection-history': {
      const rows = [];
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        if (unitFilter && String(wo.unit || '').toLowerCase() !== unitFilter) continue;
        const rt = String(inferRecordType(wo)).toLowerCase();
        const svc = primaryServiceType(wo).toLowerCase();
        const blob = `${wo.serviceType || ''} ${wo.notes || ''}`.toLowerCase();
        if (!rt.includes('inspection') && !svc.includes('inspection') && !blob.includes('inspection')) continue;
        rows.push({
          date: sliceIso(wo.serviceDate),
          unit: wo.unit || '',
          inspection_type: wo.serviceType || primaryServiceType(wo),
          inspector: wo.inspectorName || wo.inspector || '',
          badge_number: wo.inspectorBadge || wo.badgeNumber || '',
          result: wo.inspectionResult || wo.dotInspectionResult || '',
          defects_found: wo.defectsFound || wo.defectSummary || '',
          corrected: wo.defectsCorrected || wo.correctedFlag || '',
          next_due_date: sliceIso(wo.nextInspectionDue || wo.nextDueDate || ''),
          wo_number: wo.workOrderNumber || wo.internalWorkOrderNumber || wo.id
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Inspection history',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'unit', label: 'Unit' },
          { key: 'inspection_type', label: 'Inspection type' },
          { key: 'inspector', label: 'Inspector' },
          { key: 'badge_number', label: 'Badge #' },
          { key: 'result', label: 'Result' },
          { key: 'defects_found', label: 'Defects found' },
          { key: 'corrected', label: 'Corrected' },
          { key: 'next_due_date', label: 'Next due date' },
          { key: 'wo_number', label: 'WO#' }
        ],
        rows,
        meta: { totalRows: rows.length }
      };
    }
    case 'b6-expense-history': {
      const rows = [];
      for (const ap of erp.apTransactions || []) {
        if (String(ap.txnType || '').toLowerCase() !== 'expense') continue;
        if (!dateInRange(ap.txnDate, startDate, endDate)) continue;
        if (unitFilter && String(ap.assetUnit || '').toLowerCase() !== unitFilter) continue;
        rows.push({
          date: sliceIso(ap.txnDate),
          type: 'Expense',
          vendor: ap.memo || '',
          unit: ap.assetUnit || '',
          invoiceNo: ap.docNumber || '',
          amount: safeNum(ap.amount, 0),
          paymentMethod: ap.paymentMethodId || '',
          account: ap.qboAccountId || ap.qboItemId || '',
          qboStatus: ap.qboSyncStatus || '',
          postedBy: ap.createdAt ? String(ap.createdAt).slice(0, 10) : ''
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Expense history (ERP)',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'unit', label: 'Unit' },
          { key: 'invoiceNo', label: 'Invoice #' },
          { key: 'amount', label: 'Amount' },
          { key: 'paymentMethod', label: 'Payment method' },
          { key: 'account', label: 'Account' },
          { key: 'qboStatus', label: 'QBO status' },
          { key: 'postedBy', label: 'Posted by' }
        ],
        rows
      };
    }
    case 'b7-bill-history': {
      const rows = [];
      for (const ap of erp.apTransactions || []) {
        if (String(ap.txnType || '').toLowerCase() !== 'bill') continue;
        if (!dateInRange(ap.txnDate, startDate, endDate)) continue;
        if (unitFilter && String(ap.assetUnit || '').toLowerCase() !== unitFilter) continue;
        const due = sliceIso(ap.dueDate || '');
        const txn = sliceIso(ap.txnDate || '');
        let daysOut = '';
        if (due && txn) {
          daysOut = String(Math.max(0, Math.round((new Date(due) - new Date(txn)) / 86400000)));
        }
        rows.push({
          date: txn,
          type: 'Bill',
          vendor: ap.memo || '',
          unit: ap.assetUnit || '',
          invoiceNo: ap.docNumber || '',
          amount: safeNum(ap.amount, 0),
          paymentMethod: ap.paymentMethodId || '',
          account: ap.qboAccountId || '',
          qboStatus: ap.qboSyncStatus || '',
          postedBy: '',
          dueDate: due,
          terms: ap.qboTermId || '',
          daysOutstanding: daysOut
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Bill history (ERP)',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'unit', label: 'Unit' },
          { key: 'invoiceNo', label: 'Invoice #' },
          { key: 'amount', label: 'Amount' },
          { key: 'paymentMethod', label: 'Payment method' },
          { key: 'account', label: 'Account' },
          { key: 'qboStatus', label: 'QBO status' },
          { key: 'postedBy', label: 'Posted by' },
          { key: 'dueDate', label: 'Due date' },
          { key: 'terms', label: 'Terms' },
          { key: 'daysOutstanding', label: 'Days outstanding' }
        ],
        rows
      };
    }
    case 'b8-fuel-expense-history': {
      const rows = [];
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        if (unitFilter && String(p.unit || '').toLowerCase() !== unitFilter) continue;
        const draft = p.fuelExpenseDraft || {};
        const driver = String(draft.driver || '').trim();
        if (String(query.driver || '').trim() && !driver.toLowerCase().includes(String(query.driver).trim().toLowerCase()))
          continue;
        rows.push({
          date: sliceIso(p.txnDate),
          vendor: p.vendor || '',
          unit: p.unit || '',
          driver,
          gallons: p.gallons ?? '',
          pricePerGal: p.pricePerGallon ?? '',
          total: p.totalCost ?? '',
          loadNumber: p.loadInvoiceNumber || '',
          paymentMethod: draft.paymentMethodId || '',
          qboStatus: p.qboSyncStatus || ''
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Fuel expense history (ERP)',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'unit', label: 'Unit' },
          { key: 'driver', label: 'Driver' },
          { key: 'gallons', label: 'Gallons' },
          { key: 'pricePerGal', label: '$/Gal' },
          { key: 'total', label: 'Total' },
          { key: 'loadNumber', label: 'Load #' },
          { key: 'paymentMethod', label: 'Payment method' },
          { key: 'qboStatus', label: 'QBO status' }
        ],
        rows
      };
    }
    case 'b9-monthly-expense-summary': {
      const by = {};
      const bump = (m, k, amt) => {
        if (!by[m]) by[m] = { month: m, maintenance: 0, fuel: 0, other: 0 };
        by[m][k] += amt;
      };
      for (const wo of activeWorkOrders(erp)) {
        const d = sliceIso(wo.serviceDate);
        if (!d || !dateInRange(d, startDate, endDate)) continue;
        bump(d.slice(0, 7), 'maintenance', woLineTotal(wo));
      }
      for (const p of erp.fuelPurchases || []) {
        const d = sliceIso(p.txnDate);
        if (!d || !dateInRange(d, startDate, endDate)) continue;
        bump(d.slice(0, 7), 'fuel', safeNum(p.totalCost, 0) || 0);
      }
      for (const ap of erp.apTransactions || []) {
        const d = sliceIso(ap.txnDate);
        if (!d || !dateInRange(d, startDate, endDate)) continue;
        bump(d.slice(0, 7), 'other', safeNum(ap.amount, 0) || 0);
      }
      const rows = Object.values(by)
        .map(x => ({
          month: x.month,
          maintenance: Math.round(x.maintenance * 100) / 100,
          fuel: Math.round(x.fuel * 100) / 100,
          other: Math.round(x.other * 100) / 100,
          total: Math.round((x.maintenance + x.fuel + x.other) * 100) / 100
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
      return {
        ok: true,
        title: 'Monthly expense summary (ERP)',
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'maintenance', label: 'Maintenance $' },
          { key: 'fuel', label: 'Fuel $' },
          { key: 'other', label: 'Other $' },
          { key: 'total', label: 'Total $' }
        ],
        rows,
        meta: {
          hasChart: true,
          chartType: 'bar',
          chartStacked: true,
          chartXKey: 'month',
          chartSeries: [
            { key: 'maintenance', label: 'Maintenance' },
            { key: 'fuel', label: 'Fuel' },
            { key: 'other', label: 'Other' }
          ],
          totalRows: rows.length
        }
      };
    }
    case 'b10-qbo-sync-errors': {
      const rows = [];
      const push = (kind, id, unit, err, status, resolved) => {
        if (statusFilter && !String(status).toLowerCase().includes(statusFilter)) return;
        rows.push({
          date: resolved || '',
          recordType: kind,
          unit: unit || '',
          error: err || '',
          status: status || '',
          resolvedDate: resolved || ''
        });
      };
      for (const wo of erp.workOrders || []) {
        if (!String(wo.qboError || '').trim()) continue;
        push('Work order', wo.id, wo.unit, wo.qboError, wo.qboSyncStatus, '');
      }
      for (const ap of erp.apTransactions || []) {
        if (!String(ap.qboError || '').trim()) continue;
        push('AP', ap.id, ap.assetUnit, ap.qboError, ap.qboSyncStatus, '');
      }
      for (const r of erp.records || []) {
        if (!String(r.qboError || '').trim()) continue;
        push('Maintenance record', r.id, r.unit, r.qboError, r.qboSyncStatus, '');
      }
      return {
        ok: true,
        title: 'QBO sync errors log',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'recordType', label: 'Record type' },
          { key: 'unit', label: 'Unit' },
          { key: 'error', label: 'Error description' },
          { key: 'status', label: 'Status' },
          { key: 'resolvedDate', label: 'Resolved date' },
          { key: 'resolution_notes', label: 'Resolution notes' }
        ],
        rows: rows.map(r => ({ ...r, resolution_notes: '' }))
      };
    }
    case 'b11-vendor-spend': {
      const by = {};
      const bump = (vendor, amt, dateStr) => {
        const v = String(vendor || '').trim() || '—';
        if (!by[v]) by[v] = { vendor: v, count: 0, total: 0, last: '' };
        by[v].count += 1;
        by[v].total += amt;
        const d = sliceIso(dateStr);
        if (d && d > by[v].last) by[v].last = d;
      };
      const vendorType = String(query.vendorType || '').trim().toLowerCase();
      for (const ap of erp.apTransactions || []) {
        if (!dateInRange(ap.txnDate, startDate, endDate)) continue;
        const memo = String(ap.memo || '').toLowerCase();
        if (vendorType && !memo.includes(vendorType)) continue;
        bump(ap.memo || ap.vendorName || 'Vendor', safeNum(ap.amount, 0) || 0, ap.txnDate);
      }
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        bump(p.vendor || 'Fuel', safeNum(p.totalCost, 0) || 0, p.txnDate);
      }
      for (const wo of activeWorkOrders(erp)) {
        if (!dateInRange(wo.serviceDate, startDate, endDate)) continue;
        bump(wo.vendor || 'Shop', woLineTotal(wo), wo.serviceDate);
      }
      const rows = Object.values(by)
        .map(x => ({
          vendor: x.vendor,
          transaction_count: x.count,
          total_spent: Math.round(x.total * 100) / 100,
          avg_transaction: x.count ? Math.round((x.total / x.count) * 100) / 100 : 0,
          last_transaction_date: x.last
        }))
        .sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
      const sumSpent = rows.reduce((s, r) => s + (safeNum(r.total_spent, 0) || 0), 0);
      const sumCount = rows.reduce((s, r) => s + (safeNum(r.transaction_count, 0) || 0), 0);
      return {
        ok: true,
        title: 'Vendor spend',
        columns: [
          { key: 'vendor', label: 'Vendor' },
          { key: 'transaction_count', label: 'Transactions' },
          { key: 'total_spent', label: 'Total spent' },
          { key: 'avg_transaction', label: 'Avg transaction' },
          { key: 'last_transaction_date', label: 'Last transaction' }
        ],
        rows,
        totals: { transaction_count: sumCount, total_spent: Math.round(sumSpent * 100) / 100 },
        meta: { hasChart: true, chartType: 'bar', chartXKey: 'vendor', chartYKey: 'total_spent', totalRows: rows.length }
      };
    }
    case 'c1-driver-hos-summary': {
      const live = ctx.samsara?.hosSummary;
      if (Array.isArray(live) && live.length) {
        return {
          ok: true,
          title: 'Driver HOS summary (Samsara logs)',
          columns: [
            { key: 'driver', label: 'Driver' },
            { key: 'total_hours_driven', label: 'Hours driven' },
            { key: 'total_on_duty', label: 'On duty' },
            { key: 'total_off_duty', label: 'Off duty' },
            { key: 'total_sleeper', label: 'Sleeper' },
            { key: 'violations_count', label: 'Violations' },
            { key: 'last_violation_date', label: 'Last violation date' }
          ],
          rows: live,
          disclaimer: ctx.samsara?.hosSummaryError
            ? `Partial data: ${ctx.samsara.hosSummaryError}`
            : 'Hours are summed from HOS log segments in the selected date range (best-effort).'
        };
      }
      if (!hosClocks.length) {
        return {
          ok: true,
          title: 'Driver HOS summary',
          disclaimer: ctx.samsaraConnected
            ? 'No HOS clock rows returned for this request.'
            : 'Connect Samsara (SAMSARA_API_TOKEN) to load live HOS clocks.',
          columns: [
            { key: 'driver', label: 'Driver' },
            { key: 'duty', label: 'Current duty' },
            { key: 'vehicle', label: 'Vehicle' }
          ],
          rows: []
        };
      }
      const rows = hosClocks.slice(0, 500).map(c => ({
        driver: c.driver?.name || c.driverName || c.driver?.id || '—',
        hoursDriving: '',
        hoursOnDuty: '',
        hoursOffDuty: '',
        hoursSleeper: '',
        violations: '',
        recentViolation: '',
        csaImpact: '',
        duty: c.currentDutyStatus?.hosStatusType || c.dutyStatus || '',
        vehicle: c.vehicle?.name || ''
      }));
      return {
        ok: true,
        title: 'Driver HOS summary (Samsara clocks)',
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'duty', label: 'Duty status (live)' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'hoursDriving', label: 'Total hours driven *' },
          { key: 'hoursOnDuty', label: 'Total on duty *' },
          { key: 'hoursOffDuty', label: 'Total off duty *' },
          { key: 'hoursSleeper', label: 'Sleeper *' },
          { key: 'violations', label: 'Violations *' },
          { key: 'recentViolation', label: 'Recent violation *' },
          { key: 'csaImpact', label: 'CSA score *' }
        ],
        rows,
        disclaimer:
          '* Detailed HOS totals, violations, and CSA scoring require additional Samsara endpoints; this table lists current clock snapshots.'
      };
    }
    case 'c9-driver-qualification':
    case 'g1-driver-qualification': {
      const rows = (erp.driverProfiles || []).map(d => {
        const today = new Date();
        const expSoon = days => {
          if (!days) return false;
          const t = new Date(days + 'T12:00:00').getTime();
          if (Number.isNaN(t)) return false;
          const diff = (t - today.getTime()) / 86400000;
          return diff >= 0 && diff <= 30;
        };
        const expired = days => {
          if (!days) return false;
          const t = new Date(days + 'T12:00:00').getTime();
          return !Number.isNaN(t) && t < today.getTime();
        };
        const cdlE = d.cdlExpiry;
        const medE = d.medCertExpiry;
        const drugE = d.drugTestExpiry;
        const mvr = d.mvrDate || '';
        const ann = d.annualReviewDate || '';
        let status = 'green';
        let statusLabel = 'Current';
        if (!cdlE || !medE) {
          status = 'amber';
          statusLabel = 'Incomplete file';
        }
        if (expired(cdlE) || expired(medE) || expired(drugE)) {
          status = 'red';
          statusLabel = 'Expired / missing';
        } else if (expSoon(cdlE) || expSoon(medE) || expSoon(drugE)) {
          status = 'amber';
          statusLabel = 'Expiring ≤30d';
        }
        return {
          driver: d.name,
          cdl: d.cdlNumber || '',
          cdlState: d.cdlState || '',
          cdlExpiry: cdlE || '',
          medExpiry: medE || '',
          mvrDate: mvr,
          drugTestDate: drugE || '',
          annualReviewDate: ann,
          status,
          statusLabel
        };
      });
      return {
        ok: true,
        title: 'Driver qualification file status',
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'cdl', label: 'CDL #' },
          { key: 'cdlState', label: 'CDL state' },
          { key: 'cdlExpiry', label: 'CDL expiry' },
          { key: 'medExpiry', label: 'Medical cert expiry' },
          { key: 'mvrDate', label: 'MVR date' },
          { key: 'drugTestDate', label: 'Drug test date' },
          { key: 'annualReviewDate', label: 'Annual review date' },
          { key: 'statusLabel', label: 'Status' }
        ],
        rows
      };
    }
    case 'd1-fuel-cost-by-unit': {
      const by = {};
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        const u = String(p.unit || '').trim() || '—';
        if (unitFilter && u.toLowerCase() !== unitFilter) continue;
        if (!by[u]) by[u] = { unit: u, gallons: 0, total: 0, n: 0, miles: 0 };
        by[u].gallons += safeNum(p.gallons, 0) || 0;
        by[u].total += safeNum(p.totalCost, 0) || 0;
        by[u].n += 1;
        by[u].miles = Math.max(by[u].miles, safeNum(p.odometerMiles, 0) || 0);
      }
      const rows = Object.values(by).map(x => ({
        unit: x.unit,
        gallons: Math.round(x.gallons * 1000) / 1000,
        totalDollars: Math.round(x.total * 100) / 100,
        avgPpg: x.gallons > 0 ? Math.round((x.total / x.gallons) * 1000) / 1000 : '',
        transactions: x.n,
        milesDriven: x.miles || '',
        mpg: x.gallons > 0 && x.miles ? Math.round((x.miles / x.gallons) * 100) / 100 : ''
      }));
      rows.sort((a, b) => (b.totalDollars || 0) - (a.totalDollars || 0));
      return {
        ok: true,
        title: 'Fuel cost by unit',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'gallons', label: 'Gallons' },
          { key: 'totalDollars', label: 'Total $' },
          { key: 'avgPpg', label: 'Avg $/gal' },
          { key: 'transactions', label: '# transactions' },
          { key: 'milesDriven', label: 'Miles (odom.)' },
          { key: 'mpg', label: 'MPG (if odom.)' }
        ],
        rows
      };
    }
    case 'd2-fuel-cost-by-driver': {
      const by = {};
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        const d = String((p.fuelExpenseDraft && p.fuelExpenseDraft.driver) || '').trim() || '—';
        if (String(query.driver || '').trim() && !d.toLowerCase().includes(String(query.driver).trim().toLowerCase()))
          continue;
        if (!by[d]) by[d] = { driver: d, gallons: 0, total: 0, n: 0 };
        by[d].gallons += safeNum(p.gallons, 0) || 0;
        by[d].total += safeNum(p.totalCost, 0) || 0;
        by[d].n += 1;
      }
      const rows = Object.values(by).map(x => ({
        driver: x.driver,
        gallons: Math.round(x.gallons * 1000) / 1000,
        totalDollars: Math.round(x.total * 100) / 100,
        avgPpg: x.gallons > 0 ? Math.round((x.total / x.gallons) * 1000) / 1000 : '',
        transactions: x.n
      }));
      rows.sort((a, b) => (b.totalDollars || 0) - (a.totalDollars || 0));
      return {
        ok: true,
        title: 'Fuel cost by driver',
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'gallons', label: 'Gallons' },
          { key: 'totalDollars', label: 'Total $' },
          { key: 'avgPpg', label: 'Avg $/gal' },
          { key: 'transactions', label: '# transactions' }
        ],
        rows
      };
    }
    case 'd3-fuel-card-transactions': {
      const rows = [];
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        rows.push({
          date: sliceIso(p.txnDate),
          vendor: p.vendor || '',
          location: p.location || '',
          unit: p.unit || '',
          driver: (p.fuelExpenseDraft && p.fuelExpenseDraft.driver) || '',
          gallons: p.gallons ?? '',
          pricePerGal: p.pricePerGallon ?? '',
          total: p.totalCost ?? '',
          cardNumber: p.relayDocNumber || p.expenseDocNumber || '',
          loadNumber: p.loadInvoiceNumber || '',
          qboStatus: p.qboSyncStatus || ''
        });
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        ok: true,
        title: 'Fuel card transactions',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'location', label: 'Location' },
          { key: 'unit', label: 'Unit' },
          { key: 'driver', label: 'Driver' },
          { key: 'gallons', label: 'Gallons' },
          { key: 'pricePerGal', label: '$/gal' },
          { key: 'total', label: 'Total' },
          { key: 'cardNumber', label: 'Card / doc #' },
          { key: 'loadNumber', label: 'Load #' },
          { key: 'qboStatus', label: 'QBO status' }
        ],
        rows
      };
    }
    case 'd4-ifta-mileage': {
      return {
        ok: true,
        title: 'IFTA mileage (jurisdiction)',
        disclaimer:
          'Jurisdiction mileage allocation from Samsara is not wired in this dataset yet. Use the existing IFTA & compliance report for fuel ledger context, or export fuel purchases for manual filing.',
        columns: [
          { key: 'jurisdiction', label: 'State/Province' },
          { key: 'miles', label: 'Miles driven' },
          { key: 'gallons', label: 'Gallons purchased' },
          { key: 'taxRate', label: 'Tax rate' },
          { key: 'taxDue', label: 'Tax due/credit' }
        ],
        rows: []
      };
    }
    case 'd5-mpg-by-unit': {
      const fuelByUnit = {};
      for (const p of erp.fuelPurchases || []) {
        if (!dateInRange(p.txnDate, startDate, endDate)) continue;
        const u = String(p.unit || '').trim();
        if (!u) continue;
        if (!fuelByUnit[u]) fuelByUnit[u] = { gallons: 0, maxOdo: 0, minOdo: null };
        fuelByUnit[u].gallons += safeNum(p.gallons, 0) || 0;
        const o = safeNum(p.odometerMiles, null);
        if (o != null) {
          fuelByUnit[u].maxOdo = Math.max(fuelByUnit[u].maxOdo, o);
          fuelByUnit[u].minOdo = fuelByUnit[u].minOdo == null ? o : Math.min(fuelByUnit[u].minOdo, o);
        }
      }
      const mpgs = [];
      for (const u of Object.keys(fuelByUnit)) {
        if (unitFilter && u.toLowerCase() !== unitFilter) continue;
        const f = fuelByUnit[u];
        const miles =
          f.maxOdo && f.minOdo != null && f.maxOdo > f.minOdo ? f.maxOdo - f.minOdo : safeNum(fleetByUnit[u]?.odometerMiles, 0) || '';
        const gal = f.gallons;
        const mpg =
          gal > 0 && typeof miles === 'number' && miles > 0 ? Math.round((miles / gal) * 100) / 100 : '';
        if (typeof mpg === 'number' && mpg > 0) mpgs.push(mpg);
      }
      const fleetAvg = mpgs.length ? mpgs.reduce((a, b) => a + b, 0) / mpgs.length : 0;
      const rows = [];
      for (const u of Object.keys(fuelByUnit)) {
        if (unitFilter && u.toLowerCase() !== unitFilter) continue;
        const f = fuelByUnit[u];
        const miles =
          f.maxOdo && f.minOdo != null && f.maxOdo > f.minOdo ? f.maxOdo - f.minOdo : safeNum(fleetByUnit[u]?.odometerMiles, 0) || '';
        const gal = f.gallons;
        const mpg =
          gal > 0 && typeof miles === 'number' && miles > 0 ? Math.round((miles / gal) * 100) / 100 : '';
        rows.push({
          unit: u,
          milesDriven: miles === '' ? '' : miles,
          gallons: Math.round(gal * 1000) / 1000,
          mpg: mpg === '' ? '' : mpg,
          vsFleetAvg:
            mpg !== '' && fleetAvg > 0 ? Math.round((Number(mpg) - fleetAvg) * 100) / 100 : '',
          trend: '—'
        });
      }
      rows.sort((a, b) => String(a.unit).localeCompare(String(b.unit)));
      return {
        ok: true,
        title: 'MPG by unit',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'milesDriven', label: 'Miles driven' },
          { key: 'gallons', label: 'Gallons' },
          { key: 'mpg', label: 'MPG' },
          { key: 'vsFleetAvg', label: 'vs fleet avg' },
          { key: 'trend', label: 'Trend' }
        ],
        rows
      };
    }
    case 'e1-load-history': {
      const rows = (dbLoads || []).map(l => ({
        loadNumber: l.load_number || l.loadNumber || '',
        date: sliceIso(l.pickup_date || l.created_at || ''),
        driver: l.driver_name || l.driver || '',
        unit: l.unit || l.truck_unit || '',
        origin: l.origin || '',
        destination: l.destination || '',
        customer: l.customer_name || l.customer || '',
        miles: l.miles || l.loaded_miles || '',
        revenue: l.revenue_amount ?? '',
        status: l.status || ''
      }));
      return {
        ok: true,
        title: 'Load history',
        columns: [
          { key: 'loadNumber', label: 'Load #' },
          { key: 'date', label: 'Date' },
          { key: 'driver', label: 'Driver' },
          { key: 'unit', label: 'Unit' },
          { key: 'origin', label: 'Origin' },
          { key: 'destination', label: 'Destination' },
          { key: 'customer', label: 'Customer' },
          { key: 'miles', label: 'Miles' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'status', label: 'Status' }
        ],
        rows
      };
    }
    case 'e2-revenue-by-driver': {
      const by = {};
      for (const l of dbLoads || []) {
        const d = String(l.driver_name || l.driver || '').trim() || '—';
        const rev = safeNum(l.revenue_amount, 0) || 0;
        if (!by[d]) by[d] = { driver: d, loads: 0, miles: 0, revenue: 0 };
        by[d].loads += 1;
        by[d].miles += safeNum(l.miles || l.loaded_miles, 0) || 0;
        by[d].revenue += rev;
      }
      const rows = Object.values(by).map(x => ({
        driver: x.driver,
        loadsCompleted: x.loads,
        totalMiles: Math.round(x.miles),
        totalRevenue: Math.round(x.revenue * 100) / 100,
        avgRevenuePerLoad: x.loads ? Math.round((x.revenue / x.loads) * 100) / 100 : 0,
        avgMpl: x.miles > 0 ? Math.round((x.revenue / x.miles) * 100) / 100 : 0
      }));
      rows.sort((a, b) => (b.totalRevenue || 0) - (a.totalRevenue || 0));
      return {
        ok: true,
        title: 'Revenue by driver',
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'loadsCompleted', label: 'Loads completed' },
          { key: 'totalMiles', label: 'Total miles' },
          { key: 'totalRevenue', label: 'Total revenue' },
          { key: 'avgRevenuePerLoad', label: 'Avg revenue / load' },
          { key: 'avgMpl', label: 'Avg MPL' }
        ],
        rows
      };
    }
    case 'e3-revenue-by-customer': {
      const by = {};
      for (const l of dbLoads || []) {
        const c = String(l.customer_name || l.customer || '').trim() || '—';
        const rev = safeNum(l.revenue_amount, 0) || 0;
        if (!by[c]) by[c] = { customer: c, loads: 0, miles: 0, revenue: 0 };
        by[c].loads += 1;
        by[c].miles += safeNum(l.miles || l.loaded_miles, 0) || 0;
        by[c].revenue += rev;
      }
      const rows = Object.values(by).map(x => ({
        customer: x.customer,
        loadsCompleted: x.loads,
        totalMiles: Math.round(x.miles),
        totalRevenue: Math.round(x.revenue * 100) / 100,
        avgRevenuePerLoad: x.loads ? Math.round((x.revenue / x.loads) * 100) / 100 : 0
      }));
      rows.sort((a, b) => (b.totalRevenue || 0) - (a.totalRevenue || 0));
      return {
        ok: true,
        title: 'Revenue by customer',
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'loadsCompleted', label: 'Loads completed' },
          { key: 'totalMiles', label: 'Total miles' },
          { key: 'totalRevenue', label: 'Total revenue' },
          { key: 'avgRevenuePerLoad', label: 'Avg revenue / load' }
        ],
        rows
      };
    }
    case 'e4-dispatch-summary': {
      return {
        ok: true,
        title: 'Dispatch summary',
        disclaimer: 'Dispatcher attribution is not stored on loads in this schema; showing load counts by month from TMS.',
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'loads', label: 'Loads' },
          { key: 'revenue', label: 'Revenue' }
        ],
        rows: []
      };
    }
    case 'e5-settlement-report': {
      return {
        ok: true,
        title: 'Settlement report',
        disclaimer: 'Open Settlement / P&L by load for per-load detail; this grid lists indexed loads when TMS is configured.',
        columns: [
          { key: 'settlementNo', label: 'Settlement #' },
          { key: 'driver', label: 'Driver' },
          { key: 'period', label: 'Period' },
          { key: 'loads', label: 'Loads' },
          { key: 'gross', label: 'Gross revenue' },
          { key: 'deductions', label: 'Deductions' },
          { key: 'net', label: 'Net pay' },
          { key: 'status', label: 'Status' }
        ],
        rows: []
      };
    }
    case 'e6-activity-summary': {
      const rows = Object.keys(fleetByUnit).map(u => ({
        unit: u,
        driver: '',
        miles: fleetByUnit[u].odometerMiles ?? '',
        engineHours: '',
        idleTime: '',
        stops: '',
        daysActive: ''
      }));
      return {
        ok: true,
        title: 'Activity summary (fleet snapshot)',
        disclaimer: 'Engine hours / idle / stops require Samsara activity endpoints; odometer shows when stats are available.',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'driver', label: 'Driver' },
          { key: 'miles', label: 'Miles (telematics)' },
          { key: 'engineHours', label: 'Engine hours *' },
          { key: 'idleTime', label: 'Idle time *' },
          { key: 'stops', label: 'Stops *' },
          { key: 'daysActive', label: 'Days active *' }
        ],
        rows
      };
    }
    case 'e7-fleet-benchmarks': {
      return {
        ok: true,
        title: 'Fleet benchmarks',
        disclaimer: 'Industry benchmark comparison is a placeholder; connect Samsara for utilization and safety telemetry.',
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'fleet', label: 'Fleet' },
          { key: 'industry', label: 'Industry ref.' }
        ],
        rows: [
          { metric: 'Safety', fleet: '—', industry: '—' },
          { metric: 'Fuel', fleet: '—', industry: '—' },
          { metric: 'Utilization', fleet: '—', industry: '—' }
        ]
      };
    }
    case 'f-dot-fleet-overview': {
      const units = new Set([
        ...activeWorkOrders(erp).map(w => String(w.unit || '').trim()).filter(Boolean),
        ...Object.keys(erp.currentMileage || {})
      ]);
      const rows = [];
      for (const u of units) {
        let hasAnnual = false;
        for (const wo of activeWorkOrders(erp)) {
          if (String(wo.unit || '').trim() !== u) continue;
          const st = primaryServiceType(wo).toLowerCase();
          if (st.includes('annual') || st.includes('inspection')) hasAnnual = true;
        }
        const pmRow = (
          await buildReportDataset('a4-pm-schedule', erp, { unit: u, startDate: '', endDate: '' }, ctx)
        ).rows?.[0];
        const pmSt = pmRow?.status || 'gray';
        const overall =
          pmSt === 'red' || !hasAnnual ? 'red' : pmSt === 'amber' || !hasAnnual ? 'amber' : 'green';
        rows.push({
          unit: u,
          annualInsp: hasAnnual ? 'green' : 'red',
          pm: pmSt,
          registration: 'gray',
          dvir: 'gray',
          accidents: 'gray',
          oos: 'gray',
          overall
        });
      }
      rows.sort((a, b) => {
        const rank = { red: 0, amber: 1, green: 2, gray: 3 };
        return (rank[a.overall] ?? 9) - (rank[b.overall] ?? 9);
      });
      return {
        ok: true,
        title: 'DOT fleet compliance overview',
        columns: [
          { key: 'unit', label: 'Unit' },
          { key: 'annualInsp', label: 'Annual inspection' },
          { key: 'pm', label: 'PM' },
          { key: 'registration', label: 'Registration' },
          { key: 'dvir', label: 'DVIR (90d)' },
          { key: 'accidents', label: 'Accidents' },
          { key: 'oos', label: 'OOS' },
          { key: 'overall', label: 'Overall' }
        ],
        rows,
        disclaimer:
          'Color keys are heuristic from PM schedule + keyword annual inspection on work orders; extend with registration and Samsara DVIR feeds for audit-ready accuracy.'
      };
    }
    case 'c2-hos-violations': {
      const rows = ctx.samsara?.hosViolations || [];
      const err = ctx.samsara?.hosViolationsError;
      if (rows.length) {
        return {
          ok: true,
          title: 'HOS violations',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'driver', label: 'Driver' },
            { key: 'unit', label: 'Unit' },
            { key: 'violation_type', label: 'Violation type' },
            { key: 'hours_over', label: 'Hours over' },
            { key: 'location', label: 'Location' },
            { key: 'severity', label: 'Severity' }
          ],
          rows,
          meta: { totalRows: rows.length }
        };
      }
      return {
        ok: true,
        title: 'HOS violations log',
        disclaimer: err
          ? `Samsara: ${err}`
          : ctx.samsaraConnected
            ? 'No violations returned for this date range.'
            : 'Connect Samsara (SAMSARA_API_TOKEN) to enable telematics-backed safety and HOS reports.',
        columns: [{ key: 'message', label: 'Note' }],
        rows: err ? [{ message: err }] : [{ message: 'No rows for selected filters.' }]
      };
    }
    case 'c6-speeding': {
      const rows = ctx.samsara?.speeding || [];
      const err = ctx.samsara?.speedingError;
      if (rows.length) {
        return {
          ok: true,
          title: 'Speeding events',
          columns: [
            { key: 'datetime', label: 'Date/time' },
            { key: 'driver', label: 'Driver' },
            { key: 'unit', label: 'Unit' },
            { key: 'location', label: 'Location' },
            { key: 'posted_speed', label: 'Posted speed' },
            { key: 'speed', label: 'Actual speed' },
            { key: 'duration_seconds', label: 'Duration (s)' },
            { key: 'pct_over_limit', label: '% over limit' }
          ],
          rows,
          meta: { totalRows: rows.length, hasChart: false }
        };
      }
      return {
        ok: true,
        title: 'Speeding report',
        disclaimer: err
          ? `Samsara: ${err}`
          : ctx.samsaraConnected
            ? 'No speeding events in range (or token lacks Safety Events scope).'
            : 'Connect Samsara (SAMSARA_API_TOKEN).',
        columns: [{ key: 'message', label: 'Note' }],
        rows: [{ message: err || 'No rows.' }]
      };
    }
    case 'c7-harsh-driving': {
      const rows = ctx.samsara?.harsh || [];
      const err = ctx.samsara?.harshError;
      if (rows.length) {
        return {
          ok: true,
          title: 'Harsh driving events',
          columns: [
            { key: 'datetime', label: 'Date/time' },
            { key: 'driver', label: 'Driver' },
            { key: 'unit', label: 'Unit' },
            { key: 'event_type', label: 'Event type' },
            { key: 'severity', label: 'Severity' },
            { key: 'location', label: 'Location' },
            { key: 'speed', label: 'Speed' }
          ],
          rows,
          meta: { totalRows: rows.length }
        };
      }
      return {
        ok: true,
        title: 'Harsh driving events',
        disclaimer: err
          ? `Samsara: ${err}`
          : ctx.samsaraConnected
            ? 'No harsh events in range (or token lacks Safety Events scope).'
            : 'Connect Samsara (SAMSARA_API_TOKEN).',
        columns: [{ key: 'message', label: 'Note' }],
        rows: [{ message: err || 'No rows.' }]
      };
    }
    case 'c10-dvir': {
      const rows = ctx.samsara?.dvir || [];
      const err = ctx.samsara?.dvirError;
      if (rows.length) {
        return {
          ok: true,
          title: 'DVIR (Samsara)',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'driver', label: 'Driver' },
            { key: 'unit', label: 'Unit' },
            { key: 'type', label: 'Type' },
            { key: 'defects_found', label: 'Defects found' },
            { key: 'defect_description', label: 'Defect description' },
            { key: 'corrected', label: 'Corrected' },
            { key: 'mechanic', label: 'Mechanic' },
            { key: 'signoff_date', label: 'Sign-off date' }
          ],
          rows,
          meta: { totalRows: rows.length }
        };
      }
      return {
        ok: true,
        title: 'DVIR (Driver Vehicle Inspection Reports)',
        disclaimer: err
          ? `Samsara: ${err}`
          : ctx.samsaraConnected
            ? 'No DVIR history rows returned (check DVIR API scope).'
            : 'Connect Samsara (SAMSARA_API_TOKEN).',
        columns: [{ key: 'message', label: 'Note' }],
        rows: [{ message: err || 'No rows.' }]
      };
    }
    case 'c4-safety-score-driver':
    case 'c5-safety-score-fleet': {
      const title =
        id === 'c4-safety-score-driver' ? 'Safety scores by driver' : 'Safety scores — fleet';
      const disc =
        ctx.samsara?.safetyScoresDisclaimer ||
        (ctx.samsaraConnected
          ? 'Safety score time-series API not mapped for this account token yet.'
          : 'Connect Samsara (SAMSARA_API_TOKEN).');
      return {
        ok: true,
        title,
        disclaimer: disc,
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'current_score', label: 'Current score' },
          { key: 'score_30day_avg', label: '30-day avg' },
          { key: 'speeding_events', label: 'Speeding events' },
          { key: 'harsh_braking', label: 'Harsh braking' },
          { key: 'collision_risk', label: 'Collision risk' },
          { key: 'distracted', label: 'Distracted' },
          { key: 'total_events', label: 'Total events' }
        ],
        rows: [],
        meta: { hasChart: true, chartType: 'line', totalRows: 0 }
      };
    }
    case 'c3-daily-driver-log':
    case 'c8-unassigned-hos': {
      const titles = {
        'c3-daily-driver-log': 'Daily driver log summary',
        'c8-unassigned-hos': 'Unassigned HOS segments'
      };
      return {
        ok: true,
        title: titles[id] || 'Samsara report',
        disclaimer: ctx.samsaraConnected
          ? 'This report type is not yet mapped to a Samsara dataset in this build.'
          : 'Connect Samsara (SAMSARA_API_TOKEN) to enable telematics-backed safety and HOS reports.',
        columns: [{ key: 'message', label: 'Note' }],
        rows: [{ message: 'Roadmap: wire driver daily logs / unassigned segments to Samsara list APIs.' }]
      };
    }
    case 'g2-driver-dot-audit': {
      return {
        ok: true,
        title: 'Driver DOT audit file',
        disclaimer:
          'Per-driver consolidated DOT file (391 packet style) is planned; use Driver qualification + Samsara exports until multi-section driver PDF ships.',
        columns: [{ key: 'section', label: 'Section' }, { key: 'status', label: 'Status' }],
        rows: [
          { section: 'Driver identification', status: 'ERP profile' },
          { section: 'HOS / safety', status: 'Samsara' },
          { section: 'PDF packet', status: 'Planned' }
        ]
      };
    }
    case 'g3-drug-alcohol-testing': {
      const testType = String(query.testType || '').trim().toLowerCase();
      const driverId = String(query.driverId || '').trim().toLowerCase();
      const rows = [];
      for (const d of erp.driverProfiles || []) {
        if (driverId && String(d.id || '').toLowerCase() !== driverId && !String(d.name || '').toLowerCase().includes(driverId))
          continue;
        if (testType && testType !== 'all' && !String(d.notes || '').toLowerCase().includes(testType)) continue;
        rows.push({
          driver: d.name || '',
          test_date: sliceIso(d.drugTestExpiry),
          test_type: 'Drug (profile expiry / placeholder)',
          result: '',
          lab: '',
          mro: '',
          next_random_due: sliceIso(d.drugTestExpiry)
        });
      }
      const pool = Math.max(1, (erp.driverProfiles || []).length);
      const testsConducted = rows.filter(r => r.test_date).length;
      const ratePct = Math.round((testsConducted / pool) * 10000) / 100;
      return {
        ok: true,
        title: 'Drug and alcohol testing log',
        disclaimer:
          'Rows are derived from driver profile drug-test-related dates until a dedicated testing log exists. FMCSA random rates (50% drugs / 10% alcohol annually) are shown as informational targets only.',
        columns: [
          { key: 'driver', label: 'Driver' },
          { key: 'test_date', label: 'Test date' },
          { key: 'test_type', label: 'Test type' },
          { key: 'result', label: 'Result' },
          { key: 'lab', label: 'Lab' },
          { key: 'mro', label: 'MRO' },
          { key: 'next_random_due', label: 'Next random due' }
        ],
        rows,
        totals: {
          drivers_in_pool: pool,
          tests_conducted: testsConducted,
          random_testing_rate_pct: ratePct,
          meets_50pct_drugs: ratePct >= 50,
          meets_10pct_alcohol: ratePct >= 10
        },
        meta: { totalRows: rows.length }
      };
    }
    default:
      return { ok: false, error: `Unknown dataset: ${id}` };
  }
}

export const REPORT_DATASET_IDS = new Set([
  'a1-work-order-history',
  'a2-cost-by-unit',
  'a3-cost-by-service-type',
  'a4-pm-schedule',
  'a5-tire-history',
  'a6-air-bag-history',
  'a7-battery-history',
  'a8-accident-collision',
  'a9-fleet-repair-monthly',
  'a10-inspection-history',
  'b6-expense-history',
  'b7-bill-history',
  'b8-fuel-expense-history',
  'b9-monthly-expense-summary',
  'b10-qbo-sync-errors',
  'b11-vendor-spend',
  'c1-driver-hos-summary',
  'c2-hos-violations',
  'c3-daily-driver-log',
  'c4-safety-score-driver',
  'c5-safety-score-fleet',
  'c6-speeding',
  'c7-harsh-driving',
  'c8-unassigned-hos',
  'c10-dvir',
  'c9-driver-qualification',
  'g1-driver-qualification',
  'g2-driver-dot-audit',
  'd1-fuel-cost-by-unit',
  'd2-fuel-cost-by-driver',
  'd3-fuel-card-transactions',
  'd4-ifta-mileage',
  'd5-mpg-by-unit',
  'e1-load-history',
  'e2-revenue-by-driver',
  'e3-revenue-by-customer',
  'e4-dispatch-summary',
  'e5-settlement-report',
  'e6-activity-summary',
  'e7-fleet-benchmarks',
  'f-dot-fleet-overview',
  'g3-drug-alcohol-testing'
]);
