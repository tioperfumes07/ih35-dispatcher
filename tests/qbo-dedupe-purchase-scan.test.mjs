/**
 * QBO dedupe vendor merge — Purchase scan env (lookback + cache TTL).
 * Reads process.env at call time; restores env after each test.
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let savedLookback;
let savedCache;

afterEach(() => {
  if (savedLookback === undefined) delete process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS;
  else process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS = savedLookback;
  if (savedCache === undefined) delete process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
  else process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC = savedCache;
  savedLookback = undefined;
  savedCache = undefined;
});

function stashEnv() {
  savedLookback = process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS;
  savedCache = process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
}

test('lookback unset => no cutoff, default cache TTL 5m', async () => {
  stashEnv();
  delete process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS;
  delete process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
  const { getQboDedupePurchaseScanTuning, clearQboDedupePurchaseScanCache } = await import(
    '../lib/qbo-dedupe-merge.mjs'
  );
  clearQboDedupePurchaseScanCache();
  const t = getQboDedupePurchaseScanTuning();
  assert.equal(t.cutoffIso, null);
  assert.equal(t.cacheScopeLabel, 'all');
  assert.equal(t.cacheTtlMs, 5 * 60 * 1000);
});

test('lookback 10 years => cutoff matches UTC midnight N years ago', async () => {
  stashEnv();
  process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS = '10';
  delete process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
  const { getQboDedupePurchaseScanTuning, clearQboDedupePurchaseScanCache } = await import(
    '../lib/qbo-dedupe-merge.mjs'
  );
  clearQboDedupePurchaseScanCache();
  const t = getQboDedupePurchaseScanTuning();
  assert.ok(t.cutoffIso && /^\d{4}-\d{2}-\d{2}$/.test(t.cutoffIso));
  const expected = new Date();
  expected.setUTCHours(0, 0, 0, 0);
  expected.setUTCFullYear(expected.getUTCFullYear() - 10);
  assert.equal(t.cutoffIso, expected.toISOString().slice(0, 10));
  assert.equal(t.cacheScopeLabel, 'y10');
});

test('lookback caps at 50 years', async () => {
  stashEnv();
  process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS = '99';
  delete process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
  const { getQboDedupePurchaseScanTuning, clearQboDedupePurchaseScanCache } = await import(
    '../lib/qbo-dedupe-merge.mjs'
  );
  clearQboDedupePurchaseScanCache();
  const t = getQboDedupePurchaseScanTuning();
  assert.equal(t.cacheScopeLabel, 'y50');
  const expected = new Date();
  expected.setUTCHours(0, 0, 0, 0);
  expected.setUTCFullYear(expected.getUTCFullYear() - 50);
  assert.equal(t.cutoffIso, expected.toISOString().slice(0, 10));
});

test('invalid lookback => full scan', async () => {
  stashEnv();
  process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS = '0';
  delete process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC;
  const { getQboDedupePurchaseScanTuning, clearQboDedupePurchaseScanCache } = await import(
    '../lib/qbo-dedupe-merge.mjs'
  );
  clearQboDedupePurchaseScanCache();
  const t = getQboDedupePurchaseScanTuning();
  assert.equal(t.cutoffIso, null);
  assert.equal(t.cacheScopeLabel, 'all');
});

test('QBO_DEDUPE_PURCHASE_CACHE_SEC=0 disables cache TTL', async () => {
  stashEnv();
  delete process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS;
  process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC = '0';
  const { getQboDedupePurchaseScanTuning } = await import('../lib/qbo-dedupe-merge.mjs');
  assert.equal(getQboDedupePurchaseScanTuning().cacheTtlMs, 0);
});

test('Purchase scan query uses TxnDate only when cutoff is valid ISO date', async () => {
  stashEnv();
  process.env.QBO_DEDUPE_PURCHASE_LOOKBACK_YEARS = '1';
  process.env.QBO_DEDUPE_PURCHASE_CACHE_SEC = '0';
  const calls = [];
  const qboQuery = sql => {
    calls.push(sql);
    return Promise.resolve({ QueryResponse: { Purchase: [] } });
  };
  const { countVendorTransactions, clearQboDedupePurchaseScanCache } = await import('../lib/qbo-dedupe-merge.mjs');
  clearQboDedupePurchaseScanCache();
  await countVendorTransactions(qboQuery, '42');
  const purchaseSqls = calls.filter(s => /from Purchase/i.test(s));
  assert.ok(purchaseSqls.length >= 1);
  assert.match(purchaseSqls[0], /TxnDate >= '\d{4}-\d{2}-\d{2}'/i);
  assert.match(purchaseSqls[0], /STARTPOSITION 1 MAXRESULTS 500/i);
});
