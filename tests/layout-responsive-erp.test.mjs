/**
 * Disk-only checks: ERP HTML shells load the global responsive stylesheet after
 * board-nav so layout overrides apply in the intended order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const RESPONSIVE_HREF = 'href="/css/erp-responsive-global-2026.css"';
const BOARD_NAV = 'board-nav.css';

const HTML_PAGES = [
  'public/index.html',
  'public/maintenance.html',
  'public/dispatch.html',
  'public/fuel.html',
  'public/banking.html',
  'public/settings.html'
];

for (const rel of HTML_PAGES) {
  test(`responsive CSS linked in ${rel}`, () => {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(html.includes(RESPONSIVE_HREF), `expected ${RESPONSIVE_HREF}`);
    const iBoard = html.indexOf(BOARD_NAV);
    const iResp = html.indexOf('erp-responsive-global-2026.css');
    assert.ok(iBoard >= 0 && iResp >= 0, 'expected board-nav and responsive CSS references');
    assert.ok(iResp > iBoard, 'responsive stylesheet should load after board-nav.css');
  });
}

test('erp-responsive-global-2026.css defines viewport + active section shell', () => {
  const css = fs.readFileSync(path.join(root, 'public/css/erp-responsive-global-2026.css'), 'utf8');
  assert.ok(css.includes('100dvh'), 'dynamic viewport height');
  assert.ok(css.includes('.section.active'), 'active section flex shell');
  assert.ok(css.includes('fuel-board'), 'fuel board column shell');
});
