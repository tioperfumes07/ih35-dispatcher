#!/usr/bin/env node
/**
 * Offline Rule 0 check (no server): reads Agent B files from disk and exits 1 if forbidden substrings appear.
 * Run: `npm run rule0:check`
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleZeroForbiddenHits } from './rule-zero-agent-b.mjs';

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
  } else {
    console.log(`rule0:check OK ${rel}`);
  }
}

process.exit(failed ? 1 : 0);
