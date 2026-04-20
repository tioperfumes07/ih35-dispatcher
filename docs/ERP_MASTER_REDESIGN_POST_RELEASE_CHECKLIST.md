# IH35 ERP — Post–master redesign suggested check list

**When to use:** Run this list **before a release** (or when you treat the master redesign checklist as “complete enough” for your milestone). It expands the smoke pass into **repeatable QA** across maintenance, satellites, and shared UI patterns.

**Companion docs:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) (rule mapping + changelog) · [`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md) (risks, §7 pointer) · [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) (items **not** required for “checklist done” until product picks them up).

**Fast path (2026-04-18):** **Rule 10** (shared expense-line module) and **optional DEFERRED §2** Rule 22 copy/`innerHTML` cleanup are **deferred** until after go-live — see deferred checklist **§6** dated log. Dispatch parity is **out of scope** until product needs it.

---

## 0. Environment

- [ ] **Dependencies:** `npm install` succeeds on a clean clone (or CI image).
- [ ] **Config:** `.env` present (from `.env.example`); required secrets for your test (e.g. `IH35_TOKEN`, QBO, `DATABASE_URL`) documented for whoever runs QA.
- [ ] **Server:** `npm start` (or `npm run dev`); note **`PORT`** (default **3400** in `server.js` if unset).
- [ ] **Rule 0 guard:** `npm run rule0:check` passes (Agent B stack guard on **`app-theme.css`**, **`maint-accounting-ui-2026.css`**, **`maintenance.html`**).
- [ ] **Automated smoke:** With server up, `npm run smoke` → **`node scripts/system-smoke.mjs`** completes without failures (default **`http://localhost:<PORT>`**, same **`PORT`** as the server / default **3400**). Shortcut: `npm run qa:automated` runs **rule0** then **smoke** (requires server already listening). If the listen port or host differs from smoke’s default, set **`SMOKE_BASE`** (see root **`README.md`** — Verification). Optional: **`SMOKE_QUIET=1`** hides the trailing “Smoke target” line on success.
- [ ] **CI (GitHub):** Workflow **[`.github/workflows/rule0-check.yml`](../.github/workflows/rule0-check.yml)** — **`npm ci`** + **`npm test`** (Rule 0 guard only) is **green** on the commit/tag you release. (Smoke is still local — not run in Actions.)

---

## 1. Authentication and security surfaces

- [ ] **Unauthenticated:** Open **banking** and **maintenance** without a token where auth is required — **`#authBanner`** / **`erp-auth-banner`** appears (warning strip), no broken layout.
- [ ] **Sign-in:** **Settings** login (or bootstrap) → token stored → **banking** / **maintenance** load data; **401** paths show banner or toast, not silent failure.
- [ ] **Roles / write secret:** Actions that require **ERP write secret** or admin still show clear errors (toast / inline), not raw stack traces in UI.

---

## 2. Shared UI (Rules 19–21, global JS/CSS)

- [ ] **Toasts:** `showToast` / `erpNotify` — success and error paths; dismiss **×**; no duplicate **`#erpToastHost`** on a single page.
- [ ] **Busy buttons:** At least one async action shows **busy** state (`erpWithBusy` / disabled + spinner where wired).
- [ ] **Help tips:** Open a few **`erp-help-tip`** panels (**?**); click outside and **Escape** close; no trapped focus in modals you rely on.
- [ ] **QBO sync bar:** On maintenance accounting, **`#qboSyncAlertBar`** stays readable while scrolling main column (**sticky** behavior).
- [ ] **Connection strip:** **Banking**, **settings**, **fuel**, **index** — strip mounts without console errors; connected vs disconnected styling sensible.

---

## 3. Maintenance — navigation and shell (Rules 2–4)

- [ ] **Lists icon (**▤**):** Opens **Lists & catalogs** (`#catalog`); deep links **`#catalog-*`** open the right sub-tab when pasted in the address bar.
- [ ] **Board nav / hub:** Company hub and satellite strips link to expected workspaces (maintenance, banking, fuel, dispatch, settings).
- [ ] **+ New menu:** Columns load; items are usable (handlers fire); **A–Z** order still looks correct after any menu edits.
- [ ] **Collapsible sidebars:** Toggle groups; refresh page — **`localStorage`** keys **`ih35_sb_*`** restore state without layout break.
- [ ] **Home dashboard:** **System Summary** + **Sync Summary** panel **`?`** tips open; copy matches expectations (cards vs QBO window). **Maintenance → Units** list column **`?`** describes selection vs **Maintenance Table** filters and the collapse **▼** control. **Maintenance** top **Workspace snapshot** strip **`?`** opens (strip vs **Home** overview).

---

## 4. Maintenance — accounting (high value)

- [ ] **Accounting board:** Dash cards and **Connections** strip (`#maintIntegrationStrip`) render; **Refresh** updates counts where applicable. **`#acctBoardStrip`** **Accounting board** title-row **`?`** opens (KPI strip vs dash cards vs **Connections**).
- [ ] **Maintenance expense / bill composer (`acct-transactions`) and **`+ New`** (maintenance expense/bill, fuel bill): Two-column header (vendor / unit / payment / bank on the left; **Txn date**, load/inv, vendor invoice, internal WO on the right); the old **logistics** strip (settlement miles / lane) is removed — confirm **Save** / **Record to QuickBooks** still succeed.
- [ ] **QuickBooks Live Master:** **`erp-help-tip`** on title + **Vendors** / **Items** / **Accounts** column titles; **Create vendor** / refresh master still work.
- [ ] **Fuel expenses:** Ledger row uses **`mr-filter-bar`** (dates, search, QBO fields) + grid; **Manual fuel / DEF** composer uses the same **two-column** header pattern as the AP shell (read-only **Fuel expense** type; optional load / vendor inv / WO on the right). **Refresh fuel purchases**; pager with **16+** rows; **Record filtered to QuickBooks** still includes rows **off the current page** (regression from Rule 23 wiring). **`+ New` → Fuel expense** opens the modal with the same layout.
- [ ] **Expense history:** Panel title **`?`** + body **`?`**; filters + pager (**16+** rows); **Export filtered CSV** = full filtered set, not current page only.
- [ ] **Pay bills:** Load open bills (if QBO available); **Create bill payment** path; **Recent bill payments** — title **`?`** + **Refresh log**, filters (**`mr-filter-bar`**), pager (**16+**), clear search restores full loaded set; **Export CSV**.
- [ ] **QuickBooks rollback:** **Refresh** loads batches + posted checklist; **ERP import batches** + **Fuel / Relay import batches** sub-head **`?`** tips; **Revert** / undo flows unchanged.
- [ ] **Saved WO + AP cards:** Panel title **`?`**; pager when **11+** cards; exports still full dataset.

---

## 5. Maintenance — reports (Rule 17)

- [ ] **Executive overview:** **Refresh reports** + **Sync QuickBooks lists + activity**; timestamp line; metrics populate.
- [ ] **TMS / QBO / sync / IFTA tabs:** Empty and loaded states; **?** tips open.
- [ ] **Maintenance spend by unit:** After refresh, pager with **16+** units; **Download CSV** full export.
- [ ] **Maintenance detailed:** Filters + pager (**11+** records); filters reset page to **1**.
- [ ] **Settlement / P&L:** **Trip cost rollup** + **Loads with recorded costs (index)** panel **`?`** tips open; index pager (**16+** loads), line-item pager on heavy load, **Download CSV** full load; **Driver pay settlements** refresh — with **two vendors** and **15+** loads on at least one vendor, confirm **per-vendor** pager (**Previous / Next**, rows-per-page); TMS box when applicable.
- [ ] **Team & security:** **Refresh panel** loads without error when auth enabled. **Configuration posture**, **ERP user activity**, **Security audit log**, and **CMMS benchmark** panel **`?`** tips open (admin); borders use token fallback.

---

## 6. Maintenance — shop, safety, tracking, fleet (Rules 12, 16–17)

- [ ] **Shop board:** Each queue tab — pager (**16+**), filters reset page. **Maintenance reports** + **Integrity · fuel · parts alerts** panel title **`?`** tips open.
- [ ] **Safety / HOS:** HOS + active + in-service + assignments pagers and filter reset behavior. **Active drivers** + **In service now** column title **`?`** tips open. **Driver files:** with **16+** drivers after merge, use pager; type on page **1**, advance page and back — values persist until **Save** or clear (**changelog 217**).
- [ ] **Tracking:** **Fleet mix snapshot** (above the four-metric strip) **`?`** opens. Map **Units** + **Live map** panel **`?`** tips open; copy matches expectations (map list vs **Maintenance → Units**). **Yard & idle** + **Summary** title **`?`** tips. Map units pager; assets + drivers pagers; **Idle** snapshot pager uses cache on page change (no unnecessary refetch). Pager chrome borders look correct in light theme (token **`--color-border`** when set).
- [ ] **Maintenance table (fleet):** **Maintenance Table** + **Unit History** panel **`?`** tips; pager + category/service filter reset page.
- [ ] **Security alerts:** **`mr-filter-bar`** + **Refresh alerts**.

---

## 7. Maintenance — uploads and catalogs (Rules 14–15)

- [ ] **Upload center:** Main **Upload center** panel — title + **`?`** on one row. Each sub-tab (Bank, Comdata, Connections, Fuel, AP, Maint history, Other) — title **`?`** + intro (all tabs lean on **`?`** for the short lead after **changelogs 219–220**); file pick / stub flows do not throw in console. **Maintenance → Imports & uploads** shortcut panel — title **`?`** (body no duplicate **`?`**).
- [ ] **Lists & catalogs → Service types (DB):** Name filter + pager (**16+**); activate/deactivate refreshes grid.

---

## 8. Maintenance — work orders and modals (Rules 5–9, 22 samples)

- [ ] **WO chrome:** **Operational status** flyout + **QuickBooks — posting header** title **`?`** tips open when panel visible.
- [ ] **Accident WO:** Cost breakdown **?** opens/closes.
- [ ] **Tire WO:** First-tire / same-invoice **?** panel.
- [ ] **AP expense modal:** QBO banner tier colors when posting errors present.

---

## 9. Satellite pages

- [ ] **Dispatch:** Refresh, catalog sync, save load, upload doc, auto miles, row **Create invoice** / **Sync attachments**, status `<select>` busy state, toasts on failure; **QBO / maintenance** banner tiers and **autocomplete** dropdown use token-backed chrome (no raw gray-only strips).
- [ ] **Banking:** **Step 1** days + **Load snapshot** and **step 3** batch id + **Run suggestions** in **`mr-filter-bar`**; **step 2** column hint + **?** (batch id → step 3); CSV import; suggest pager; link row; **`erp-auth-banner`** on 401; connection strip.
- [ ] **Settings:** Login/bootstrap; **Users** + **Employees** title **?** panels open; **Employees** search + **Refresh** in **`mr-filter-bar`**; employees pager (**16+**); connection strip; focus/error token styles.
- [ ] **Fuel:** **Selected Unit** title **?** opens; **Diesel purchase** fields sit in **`mr-filter-bar`**; save purchase, recommend (busy if wired), connection strip; write-secret banner styling when **`ERP_WRITE_SECRET`** is configured.
- [ ] **Index (hub):** Header **?** opens; connection strip; workspace cards + tags readable on dark shell; no console errors.

---

## 10. Responsive and visual spot checks (Rule 1)

- [ ] **Maintenance:** Resize to **≤900px** — **Reports** hub sidebar stacks; toolbar spacing acceptable; no unusable horizontal scroll on primary flows you care about.
- [ ] **Print (optional):** **Print** from a board or report — chrome hides per **`@media print`** rules where implemented.

---

## 11. Deferred themes (only when implemented)

Re-run targeted checks from [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md), for example:

- [ ] **Pay bills → Open bills:** pager + **`Map`** selection across pages (**changelog 215** — load **25+** bills, check rows on page 1, page forward, confirm **draft total** still includes page 1; **Create bill payment** posts checked rows from **all** pages; clear filters resets pager to page **1**).
- [ ] **Driver pay settlements** — full sign-off on per-vendor pagers after **`Refresh driver settlements`** (**changelog 216**); re-open if product switches to a **single** flattened pager.
- [ ] **Safety → Driver files** — pager + draft persistence (**changelog 217**); confirm **Save** clears draft and server round-trip; with unsaved edits, closing the tab or refreshing should trigger the browser **leave-site** prompt (**changelog 218**).

---

## 12. Sign-off

- [ ] **Owner + date:** _______________________
- [ ] **Notes / blockers:** _______________________

**Tip:** Copy unchecked sections into a release ticket and attach environment + QBO/Samsara test account notes for the next reviewer.
