import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultIntegrityThresholds,
  mergeIntegrityThresholds,
  integrityThresholdExportRows,
  integrityAlertRuleCatalogFlat,
  alertCategory,
  effectiveIntegrityAlertCategory,
  compareIntegrityAlertsDesc
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

test('effectiveIntegrityAlertCategory fills missing category from alertType', () => {
  assert.equal(effectiveIntegrityAlertCategory({ category: '', alertType: 'T1' }), 'tires');
  assert.equal(effectiveIntegrityAlertCategory({ alertType: 'OD1' }), 'samsara');
  assert.equal(effectiveIntegrityAlertCategory({ type: 'F3', category: '' }), 'fuel');
});

test('effectiveIntegrityAlertCategory keeps stored category when set', () => {
  assert.equal(effectiveIntegrityAlertCategory({ category: 'fuel', alertType: 'T1' }), 'fuel');
});

test('compareIntegrityAlertsDesc orders by triggered day then createdAt', () => {
  const older = { triggeredDate: '2024-01-15', createdAt: '2024-06-01T12:00:00.000Z' };
  const newer = { triggeredDate: '2024-02-01', createdAt: '2024-05-01T12:00:00.000Z' };
  assert.ok(compareIntegrityAlertsDesc(older, newer) > 0);
  assert.ok(compareIntegrityAlertsDesc(newer, older) < 0);
  const sameDayA = { triggeredDate: '2024-03-01', createdAt: '2024-03-01T10:00:00.000Z' };
  const sameDayB = { triggeredDate: '2024-03-01', createdAt: '2024-03-01T15:00:00.000Z' };
  assert.ok(compareIntegrityAlertsDesc(sameDayA, sameDayB) > 0);
});
