import { test, expect } from '@playwright/test';

/** Viewports requested for responsive QA (width × height). */
const VIEWPORTS = [
  { width: 800, height: 720 },
  { width: 1200, height: 800 },
  { width: 1440, height: 900 }
];

/** Shell root selectors — element should sit within the viewport width (no horizontal clip). */
const PAGES = [
  { path: '/maintenance.html', root: '#erpApp', name: 'maintenance' },
  { path: '/dispatch.html', root: '#dispatchApp', name: 'dispatch' },
  { path: '/index.html', root: 'body.hub-page', name: 'hub' },
  { path: '/fuel.html', root: 'body.fuel-board', name: 'fuel' },
  { path: '/banking.html', root: 'body.banking-page', name: 'banking' },
  { path: '/settings.html', root: 'body.settings-page', name: 'settings' }
];

for (const vw of VIEWPORTS) {
  test.describe(`viewport ${vw.width}×${vw.height}`, () => {
    test.use({ viewport: { width: vw.width, height: vw.height } });

    for (const p of PAGES) {
      test(`${p.name}: shell root fits viewport width`, async ({ page }) => {
        await page.goto(p.path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const loc = page.locator(p.root).first();
        await expect(loc).toBeVisible({ timeout: 20_000 });

        const fit = await page.evaluate(
          ({ sel, innerWidth }) => {
            const el = document.querySelector(sel);
            if (!el) return { ok: false, reason: 'missing root' };
            const r = el.getBoundingClientRect();
            const tol = 6;
            const ok = r.left >= -tol && r.right <= innerWidth + tol;
            return { ok, left: r.left, right: r.right, innerWidth };
          },
          { sel: p.root, innerWidth: vw.width }
        );

        expect(fit.ok, JSON.stringify(fit)).toBe(true);
      });
    }
  });
}
