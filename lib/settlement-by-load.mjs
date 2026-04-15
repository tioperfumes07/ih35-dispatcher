function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normLoadKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function collectWoLoadKeys(wo) {
  const keys = new Set();
  const add = v => {
    const k = normLoadKey(v);
    if (k) keys.add(k);
  };
  add(wo.loadNumber);
  add(wo.internalWorkOrderNumber);
  add(wo.vendorInvoiceNumber);
  add(wo.vendorWorkOrderNumber);
  for (const line of wo.lines || []) {
    add(line.vendorInvoiceNumber);
    add(line.vendorWorkOrderNumber);
  }
  return keys;
}

function collectApLoadKeys(ap) {
  const keys = new Set();
  const k = normLoadKey(ap.docNumber);
  if (k) keys.add(k);
  return keys;
}

function collectRecordLoadKeys(rec) {
  const keys = new Set();
  const add = v => {
    const k = normLoadKey(v);
    if (k) keys.add(k);
  };
  add(rec.loadNumber);
  add(rec.load_number);
  add(rec.docNumber);
  return keys;
}

export function primaryRecordLoadLabel(rec) {
  return String(rec.loadNumber || rec.load_number || rec.docNumber || '').trim();
}

export function primaryWoLoadLabel(wo) {
  const raw = wo.loadNumber || wo.internalWorkOrderNumber || wo.vendorInvoiceNumber || '';
  return String(raw).trim();
}

export function buildSettlementByLoad(erp, loadKeyRaw) {
  const target = normLoadKey(loadKeyRaw);
  const workOrders = [];
  const apTransactions = [];
  const maintenanceRecords = [];
  const lineItems = [];
  let woTotal = 0;
  let apTotal = 0;
  let recordTotal = 0;

  for (const wo of erp.workOrders || []) {
    if (!collectWoLoadKeys(wo).has(target)) continue;
    workOrders.push(wo);
    for (const line of wo.lines || []) {
      const amt = safeNum(line.amount, 0) || 0;
      if (!(amt > 0)) continue;
      woTotal += amt;
      lineItems.push({
        kind: 'work_order_line',
        parentId: wo.id,
        txnType: wo.txnType || 'expense',
        serviceType: line.serviceType || line.lineType || '',
        amount: amt,
        unit: wo.unit || '',
        detailMode: line.detailMode || '',
        tireRef: line.tirePositionText || line.tirePosition || '',
        qboSyncStatus: wo.qboSyncStatus || '',
        qboEntityType: wo.qboEntityType || '',
        vendor: wo.vendor || ''
      });
    }
  }

  for (const ap of erp.apTransactions || []) {
    if (!collectApLoadKeys(ap).has(target)) continue;
    apTransactions.push(ap);
    const amt = safeNum(ap.amount, 0) || 0;
    if (amt > 0) apTotal += amt;
    lineItems.push({
      kind: 'ap_transaction',
      id: ap.id,
      txnType: ap.txnType || '',
      description: ap.description || ap.memo || '',
      amount: amt,
      unit: ap.assetUnit || '',
      qboSyncStatus: ap.qboSyncStatus || ''
    });
  }

  for (const rec of erp.records || []) {
    if (!collectRecordLoadKeys(rec).has(target)) continue;
    maintenanceRecords.push(rec);
    const amt = safeNum(rec.cost, 0) || 0;
    if (amt > 0) recordTotal += amt;
    lineItems.push({
      kind: 'maintenance_record',
      id: rec.id,
      serviceType: rec.serviceType || rec.recordType || 'Record',
      description: rec.notes || '',
      amount: amt,
      unit: rec.unit || '',
      qboSyncStatus: rec.qboSyncStatus || '',
      vendor: rec.vendor || ''
    });
  }

  /** Grand total = sum of positive WO line amounts + AP amounts + maintenance record costs for this load key. */
  const grand = woTotal + apTotal + recordTotal;
  return {
    loadNumber: String(loadKeyRaw ?? '').trim(),
    workOrders,
    apTransactions,
    maintenanceRecords,
    lineItems,
    totalWorkOrderLines: Math.round(woTotal * 100) / 100,
    totalAp: Math.round(apTotal * 100) / 100,
    totalMaintenanceRecords: Math.round(recordTotal * 100) / 100,
    grandTotal: Math.round(grand * 100) / 100,
    counts: {
      workOrders: workOrders.length,
      apTransactions: apTransactions.length,
      maintenanceRecords: maintenanceRecords.length,
      lineItems: lineItems.length
    }
  };
}

export function buildSettlementIndex(erp) {
  const map = new Map();

  for (const wo of erp.workOrders || []) {
    const k = normLoadKey(primaryWoLoadLabel(wo));
    if (!k) continue;
    let sum = 0;
    for (const line of wo.lines || []) sum += safeNum(line.amount, 0) || 0;
    if (!map.has(k)) {
      map.set(k, {
        loadKey: k,
        label: primaryWoLoadLabel(wo) || k,
        total: 0,
        workOrderCount: 0,
        apCount: 0,
        recordCount: 0
      });
    }
    const e = map.get(k);
    e.total += sum;
    e.workOrderCount += 1;
  }

  for (const ap of erp.apTransactions || []) {
    const k = normLoadKey(ap.docNumber);
    if (!k) continue;
    const amt = safeNum(ap.amount, 0) || 0;
    if (!map.has(k)) {
      map.set(k, {
        loadKey: k,
        label: String(ap.docNumber).trim() || k,
        total: 0,
        workOrderCount: 0,
        apCount: 0,
        recordCount: 0
      });
    }
    const e = map.get(k);
    e.total += amt;
    e.apCount += 1;
  }

  for (const rec of erp.records || []) {
    const k = normLoadKey(primaryRecordLoadLabel(rec));
    if (!k) continue;
    const amt = safeNum(rec.cost, 0) || 0;
    if (!map.has(k)) {
      map.set(k, {
        loadKey: k,
        label: primaryRecordLoadLabel(rec) || k,
        total: 0,
        workOrderCount: 0,
        apCount: 0,
        recordCount: 0
      });
    }
    const e = map.get(k);
    if (e.recordCount == null) e.recordCount = 0;
    e.total += amt;
    e.recordCount += 1;
  }

  for (const e of map.values()) {
    if (e.recordCount == null) e.recordCount = 0;
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
