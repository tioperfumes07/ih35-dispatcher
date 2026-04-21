import test from 'node:test';
import assert from 'node:assert/strict';
import {
  milesToRoundMonths,
  breakdownTimeFromMilesRemaining,
  clampFleetAvgMilesPerMonth,
  formatIntervalDualLine
} from '../lib/fleet-mileage-settings.mjs';

test('milesToRoundMonths uses ROUND (matches catalog SQL) and min 1 when miles > 0', () => {
  assert.equal(milesToRoundMonths(25000, 12000), 2);
  assert.equal(milesToRoundMonths(50000, 12000), 4);
  assert.equal(milesToRoundMonths(150000, 12000), 13);
  assert.equal(milesToRoundMonths(40000, 12000), 3);
  assert.equal(milesToRoundMonths(200000, 12000), 17);
});

test('milesToRoundMonths returns null for missing or non-positive miles', () => {
  assert.equal(milesToRoundMonths(null, 12000), null);
  assert.equal(milesToRoundMonths('', 12000), null);
  assert.equal(milesToRoundMonths(0, 12000), null);
  assert.equal(milesToRoundMonths(-100, 12000), null);
});

test('clampFleetAvgMilesPerMonth enforces bounds', () => {
  assert.equal(clampFleetAvgMilesPerMonth(500), 1000);
  assert.equal(clampFleetAvgMilesPerMonth(50000), 30000);
  assert.equal(clampFleetAvgMilesPerMonth(15000), 15000);
});

test('breakdownTimeFromMilesRemaining uses months when far out', () => {
  const r = breakdownTimeFromMilesRemaining(50000, 12000);
  assert.equal(r.time_unit, 'months');
  assert.ok(r.months_remaining > 4);
});

test('breakdownTimeFromMilesRemaining returns unknown for invalid input', () => {
  const r = breakdownTimeFromMilesRemaining(NaN, 12000);
  assert.equal(r.time_unit, 'unknown');
});

test('formatIntervalDualLine shows miles and stored months when both present', () => {
  const { milesLine, monthsLine } = formatIntervalDualLine(30000, 3, 12000);
  assert.equal(milesLine, '30,000 mi');
  assert.ok(monthsLine.includes('3 mo'));
  assert.ok(monthsLine.includes('12,000'));
});
