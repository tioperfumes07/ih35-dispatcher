import test from 'node:test';
import assert from 'node:assert/strict';
import {
  milesToFloorMonths,
  breakdownTimeFromMilesRemaining,
  clampFleetAvgMilesPerMonth,
  formatFleetPaceDueLabel
} from '../lib/fleet-mileage-settings.mjs';

test('milesToFloorMonths uses FLOOR and min 1', () => {
  assert.equal(milesToFloorMonths(25000, 12000), 2);
  assert.equal(milesToFloorMonths(50000, 12000), 4);
  assert.equal(milesToFloorMonths(150000, 12000), 12);
  assert.equal(milesToFloorMonths(40000, 12000), 3);
  assert.equal(milesToFloorMonths(200000, 12000), 16);
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

test('formatFleetPaceDueLabel tiers months / weeks / days', () => {
  assert.match(formatFleetPaceDueLabel(50000, 12000), /months/);
  assert.match(formatFleetPaceDueLabel(8000, 12000), /weeks/);
  assert.match(formatFleetPaceDueLabel(2000, 12000), /days/);
  assert.match(formatFleetPaceDueLabel(-25000, 12000), /overdue/);
});
