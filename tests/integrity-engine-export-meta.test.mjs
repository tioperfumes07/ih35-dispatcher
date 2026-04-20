import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultIntegrityThresholds,
  mergeIntegrityThresholds,
  integrityThresholdExportRows,
  integrityAlertRuleCatalogFlat,
  alertCategory
} from '../lib/integrity-engine.mjs';

test('integrityThresholdExportRows keys match defaultIntegrityThresholds order', () => {
  const th = defaultIntegrityThresholds();
  const rows = integrityThresholdExportRows(th);
  const expectedKeys = Object.keys(th);
  assert.equal(rows.length, expectedKeys.length);
  assert.deepEqual(
    rows.map((r) => r.key),
    expectedKeys
  );
  for (const r of rows) {
    assert.equal(typeof r.label, 'string');
    assert.ok(r.label.length > 2);
    assert.equal(typeof r.unitLabel, 'string');
    assert.equal(Number(r.value), th[r.key]);
  }
});

test('mergeIntegrityThresholds overrides appear in integrityThresholdExportRows', () => {
  const erp = { integrityThresholds: { maxTiresPerUnit90d: 99 } };
  const rows = integrityThresholdExportRows(mergeIntegrityThresholds(erp));
  const t1 = rows.find((r) => r.key === 'maxTiresPerUnit90d');
  assert.equal(t1.value, 99);
  const def = defaultIntegrityThresholds();
  const t2 = rows.find((r) => r.key === 'maxSameTirePosition180d');
  assert.equal(t2.value, def.maxSameTirePosition180d);
});

test('integrityAlertRuleCatalogFlat includes save-time, Samsara, and predictive codes', () => {
  const flat = integrityAlertRuleCatalogFlat();
  const codes = new Set(flat.map((r) => r.code));
  assert.ok(codes.has('T1'));
  assert.ok(codes.has('M4'));
  assert.ok(codes.has('F5'));
  assert.ok(codes.has('OD1'));
  assert.ok(codes.has('MAINTENANCE_OVERDUE'));
  assert.ok(flat.every((r) => typeof r.summary === 'string' && r.summary.length > 0));
});

test('alertCategory maps engine prefixes for dashboard filters', () => {
  assert.equal(alertCategory('T1'), 'tires');
  assert.equal(alertCategory('D2'), 'drivers');
  assert.equal(alertCategory('A3'), 'accidents');
  assert.equal(alertCategory('F4'), 'fuel');
  assert.equal(alertCategory('M2'), 'maintenance');
  assert.equal(alertCategory('OD2'), 'samsara');
  assert.equal(alertCategory('MAINTENANCE_DUE_SOON'), 'predictive');
});
