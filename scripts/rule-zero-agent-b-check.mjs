#!/usr/bin/env node
/**
 * Offline Rule 0 check (no server): reads Agent B files from disk and exits 1 if forbidden substrings appear.
 * Run: `npm run rule0:check`. Full gate with HTTP smoke (server must listen): `npm run qa:automated`, or ephemeral server: `npm run qa:isolated` (**`scripts/smoke-gate-paths-sync.mjs`** first, then **`rule0:check`** + **`system-smoke.mjs`** on a child **`server.js`** with **`IH35_SMOKE_GATE=1`**).
 * In CI (`CI=true`) or when `RULE0_QUIET=1`, success logs one summary line instead of per-file OK lines; failures always print details. Locally, `RULE0_QUIET=1` also hides the release tip (unless `--skip-release-tip` already did).
 * `npm run qa:automated` invokes this script with `--skip-release-tip` so the tip is not printed twice.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleZeroForbiddenHits } from './rule-zero-agent-b.mjs';

const skipReleaseTip = process.argv.includes('--skip-release-tip');
const quietSuccess = process.env.CI === 'true' || process.env.RULE0_QUIET === '1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  path.join(root, 'public/css/app-theme.css'),
  path.join(root, 'public/css/maint-accounting-ui-2026.css'),
  path.join(root, 'public/maintenance.html')
];

let failed = false;
for (const file of FILES) {
  const rel = path.relative(root, file);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    console.error(`rule0:check: cannot read ${rel}: ${e.message || e}`);
    failed = true;
    continue;
  }
  const hits = ruleZeroForbiddenHits(text);
  if (hits.length) {
    failed = true;
    console.error(`rule0:check FAIL ${rel}`);
    for (const h of hits) console.error(`  forbidden: ${h}`);
  } else if (!quietSuccess) {
    console.log(`rule0:check OK ${rel}`);
  }
}

if (!failed && quietSuccess) {
  console.log(`rule0:check OK (${FILES.length} files)`);
}

if (
  !failed &&
  !skipReleaseTip &&
  process.env.CI !== 'true' &&
  process.env.RULE0_QUIET !== '1'
) {
  console.log(
    'rule0:check: OK — with the server up, run `npm run smoke` or `npm run qa:automated` (Rule 0 + smoke), or `npm run qa:isolated` (smoke-gate sync + temp server + smoke), before release.'
  );
}

process.exit(failed ? 1 : 0);
