import test from 'node:test';
import assert from 'node:assert/strict';
import { milesToRoundMonths, breakdownTimeFromMilesRemaining, clampFleetAvgMilesPerMonth } from '../lib/fleet-mileage-settings.mjs';

test('milesToRoundMonths uses ROUND and min 1', () => {
  assert.equal(milesToRoundMonths(25000, 12000), 2);
  assert.equal(milesToRoundMonths(50000, 12000), 4);
  assert.equal(milesToRoundMonths(150000, 12000), 13);
  assert.equal(milesToRoundMonths(40000, 12000), 3);
  assert.equal(milesToRoundMonths(200000, 12000), 17);
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
