import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVendorNameToErp,
  countVendorUsageByQboId,
  applyCustomerNameToErp,
  applyDriverNameToErp,
  countDriverUsageInErp
} from '../lib/name-management-erp.mjs';

test('countVendorUsageByQboId counts references', () => {
  const erp = {
    workOrders: [{ qboVendorId: '99', vendor: 'A' }],
    records: [{ qboVendorId: '99' }],
    fuelPurchases: [{ qboVendorId: '88' }],
    qboCache: { vendors: [{ qboId: '99', name: 'Old' }] }
  };
  const c = countVendorUsageByQboId(erp, '99');
  assert.equal(c.workOrders, 1);
  assert.equal(c.records, 1);
  assert.equal(c.qboCache, 1);
});

test('applyVendorNameToErp updates matching rows', () => {
  const erp = {
    workOrders: [{ qboVendorId: '7', vendor: 'Old' }],
    records: [],
    fuelPurchases: [],
    vendorBillPaymentRecords: [],
    driverProfiles: [],
    qboCache: { vendors: [{ qboId: '7', name: 'Old' }] }
  };
  const n = applyVendorNameToErp(erp, '7', 'New Vendor LLC');
  assert.ok(n >= 2);
  assert.equal(erp.workOrders[0].vendor, 'New Vendor LLC');
  assert.equal(erp.qboCache.vendors[0].name, 'New Vendor LLC');
});

test('applyCustomerNameToErp updates WO line customerName', () => {
  const erp = {
    workOrders: [{ lines: [{ qboCustomerId: 'c1', customerName: 'x' }] }],
    fuelPurchases: []
  };
  const n = applyCustomerNameToErp(erp, 'c1', 'Acme');
  assert.equal(n, 1);
  assert.equal(erp.workOrders[0].lines[0].customerName, 'Acme');
});

test('countDriverUsageInErp matches uuid on work orders', () => {
  const erp = {
    workOrders: [{ driverId: 'd-1', driver: 'Joe' }],
    apTransactions: [],
    fuelPurchases: [],
    driverProfiles: [],
    integrityAlerts: []
  };
  const c = countDriverUsageInErp(erp, 'd-1', 'Joe');
  assert.equal(c.workOrders, 1);
});

test('applyDriverNameToErp renames by driver id', () => {
  const erp = {
    workOrders: [{ driverId: 'u1', driver: 'Old', driverName: 'Old' }],
    apTransactions: [],
    fuelPurchases: [],
    driverProfiles: [{ id: 'u1', name: 'Old' }],
    integrityAlerts: []
  };
  const n = applyDriverNameToErp(erp, 'u1', 'Old', 'New Name');
  assert.ok(n >= 2);
  assert.equal(erp.workOrders[0].driver, 'New Name');
  assert.equal(erp.driverProfiles[0].name, 'New Name');
});
