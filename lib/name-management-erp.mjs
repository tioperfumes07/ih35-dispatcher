/**
 * Update human-readable vendor / driver / customer names in ERP JSON (maintenance.json).
 */

function sliceStr(s, max) {
  return String(s || '').trim().slice(0, max);
}

/**
 * @returns {{ workOrders: number, records: number, fuelPurchases: number, vendorBillPaymentRecords: number, qboCache: number, apTransactions: number, driverProfiles: number, integrityAlerts: number }}
 */
export function countVendorUsageByQboId(erp, qboVendorId) {
  const id = String(qboVendorId || '').trim();
  const c = {
    workOrders: 0,
    records: 0,
    fuelPurchases: 0,
    vendorBillPaymentRecords: 0,
    qboCache: 0,
    apTransactions: 0,
    driverProfiles: 0,
    integrityAlerts: 0
  };
  if (!id) return c;
  for (const wo of erp.workOrders || []) {
    if (String(wo.qboVendorId || '') === id) c.workOrders++;
  }
  for (const r of erp.records || []) {
    if (String(r.qboVendorId || '') === id) c.records++;
  }
  for (const f of erp.fuelPurchases || []) {
    if (String(f.qboVendorId || '') === id) c.fuelPurchases++;
  }
  for (const e of erp.vendorBillPaymentRecords || []) {
    if (String(e.vendorQboId || '') === id) c.vendorBillPaymentRecords++;
  }
  for (const ap of erp.apTransactions || []) {
    if (String(ap.qboVendorId || '') === id) c.apTransactions++;
  }
  for (const p of erp.driverProfiles || []) {
    if (String(p.qboVendorId || '') === id) c.driverProfiles++;
  }
  for (const a of erp.integrityAlerts || []) {
    /* integrity alerts don't carry qbo vendor id; skip */
  }
  for (const v of erp.qboCache?.vendors || []) {
    if (String(v.qboId || '') === id) c.qboCache++;
  }
  return c;
}

export function applyVendorNameToErp(erp, qboVendorId, newName) {
  const id = String(qboVendorId || '').trim();
  const nm = sliceStr(newName, 180);
  let n = 0;
  if (!id || !nm) return n;
  for (const wo of erp.workOrders || []) {
    if (String(wo.qboVendorId || '') !== id) continue;
    wo.vendor = nm;
    n++;
  }
  for (const r of erp.records || []) {
    if (String(r.qboVendorId || '') !== id) continue;
    r.vendor = nm;
    n++;
  }
  for (const f of erp.fuelPurchases || []) {
    if (String(f.qboVendorId || '') !== id) continue;
    f.vendor = sliceStr(nm, 120);
    n++;
  }
  for (const e of erp.vendorBillPaymentRecords || []) {
    if (String(e.vendorQboId || '') !== id) continue;
    e.vendorName = nm;
    n++;
  }
  for (const p of erp.driverProfiles || []) {
    if (String(p.qboVendorId || '') !== id) continue;
    if (p.displayName != null) p.displayName = nm;
    else p.name = nm;
    n++;
  }
  if (Array.isArray(erp.qboCache?.vendors)) {
    for (const v of erp.qboCache.vendors) {
      if (String(v.qboId || '') !== id) continue;
      v.name = nm;
      n++;
      break;
    }
  }
  return n;
}

export function countCustomerUsageByQboId(erp, qboCustomerId) {
  const id = String(qboCustomerId || '').trim();
  const c = { workOrderLines: 0, fuelDrafts: 0, other: 0 };
  if (!id) return c;
  for (const wo of erp.workOrders || []) {
    for (const ln of wo.lines || []) {
      if (String(ln.qboCustomerId || '') === id) c.workOrderLines++;
    }
  }
  for (const f of erp.fuelPurchases || []) {
    const d = f.fuelExpenseDraft || f.expenseDraft;
    if (d && String(d.custId || d.qboCustomerId || '') === id) c.fuelDrafts++;
  }
  return c;
}

export function applyCustomerNameToErp(erp, qboCustomerId, newName) {
  const id = String(qboCustomerId || '').trim();
  const nm = sliceStr(newName, 180);
  let n = 0;
  if (!id || !nm) return n;
  for (const wo of erp.workOrders || []) {
    for (const ln of wo.lines || []) {
      if (String(ln.qboCustomerId || '') !== id) continue;
      if (ln.customerName != null) ln.customerName = nm;
      n++;
    }
  }
  for (const f of erp.fuelPurchases || []) {
    const d = f.fuelExpenseDraft || f.expenseDraft;
    if (!d) continue;
    const cid = String(d.custId || d.qboCustomerId || '').trim();
    if (cid !== id) continue;
    if (d.custSearch != null) d.custSearch = nm;
    n++;
  }
  return n;
}

export function countDriverUsageInErp(erp, driverUuid, driverNameSample) {
  const uid = String(driverUuid || '').trim();
  const name = String(driverNameSample || '').trim();
  const c = { workOrders: 0, apTransactions: 0, fuelPurchases: 0, driverProfiles: 0, integrityAlerts: 0 };
  for (const wo of erp.workOrders || []) {
    if (uid && String(wo.driverId || '') === uid) c.workOrders++;
    else if (name && String(wo.driver || '').trim() === name) c.workOrders++;
  }
  for (const ap of erp.apTransactions || []) {
    if (uid && String(ap.driverId || '') === uid) c.apTransactions++;
    else if (name && String(ap.driver || ap.driverName || '').trim() === name) c.apTransactions++;
  }
  for (const f of erp.fuelPurchases || []) {
    if (uid && String(f.driverId || '') === uid) c.fuelPurchases++;
    else if (name && String(f.driverName || '').trim() === name) c.fuelPurchases++;
  }
  for (const p of erp.driverProfiles || []) {
    if (uid && String(p.id || '') === uid) c.driverProfiles++;
  }
  for (const a of erp.integrityAlerts || []) {
    if (uid && String(a.driverId || '') === uid) c.integrityAlerts++;
  }
  return c;
}

export function applyDriverNameToErp(erp, driverUuid, oldName, newName) {
  const uid = String(driverUuid || '').trim();
  const oldN = String(oldName || '').trim();
  const nm = sliceStr(newName, 160);
  let n = 0;
  if (!nm) return n;
  for (const wo of erp.workOrders || []) {
    if (uid && String(wo.driverId || '') === uid) {
      wo.driver = nm;
      if (wo.driverName != null) wo.driverName = nm;
      n++;
    } else if (!uid && oldN && String(wo.driver || '').trim() === oldN) {
      wo.driver = nm;
      n++;
    }
  }
  for (const ap of erp.apTransactions || []) {
    if (uid && String(ap.driverId || '') === uid) {
      ap.driver = nm;
      if (ap.driverName != null) ap.driverName = nm;
      n++;
    } else if (!uid && oldN && String(ap.driver || '').trim() === oldN) {
      ap.driver = nm;
      n++;
    }
  }
  for (const f of erp.fuelPurchases || []) {
    if (uid && String(f.driverId || '') === uid) {
      f.driverName = sliceStr(nm, 160);
      n++;
    } else if (!uid && oldN && String(f.driverName || '').trim() === oldN) {
      f.driverName = sliceStr(nm, 160);
      n++;
    }
  }
  for (const p of erp.driverProfiles || []) {
    if (uid && String(p.id || '') === uid) {
      p.name = nm;
      n++;
    }
  }
  for (const a of erp.integrityAlerts || []) {
    if (uid && String(a.driverId || '') === uid && a.driverName != null) {
      a.driverName = nm;
      n++;
    }
  }
  return n;
}
