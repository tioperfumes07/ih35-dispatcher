# IH35 ERP — Post–master redesign suggested check list

**When to use:** Run this list **before a release** (or when you treat the master redesign checklist as “complete enough” for your milestone). It expands the smoke pass into **repeatable QA** across maintenance, satellites, and shared UI patterns.

**Companion docs:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) (rule mapping + changelog) · [`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md) (risks, §7 pointer) · [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) (items **not** required for “checklist done” until product picks them up).

---

## 0. Environment

- [ ] **Dependencies:** `npm install` succeeds on a clean clone (or CI image).
- [ ] **Config:** `.env` present (from `.env.example`); required secrets for your test (e.g. `IH35_TOKEN`, QBO, `DATABASE_URL`) documented for whoever runs QA.
- [ ] **Server:** `npm start` (or `npm run dev`); note **`PORT`** (default **3400** in `server.js` if unset).
- [ ] **Automated smoke:** With server up, `npm run smoke` → **`node scripts/system-smoke.mjs`** completes without failures (expects `localhost` reachable).

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

---

## 4. Maintenance — accounting (high value)

- [ ] **Accounting board:** Dash cards and **Connections** strip (`#maintIntegrationStrip`) render; **Refresh** updates counts where applicable.
- [ ] **QuickBooks Live Master:** **`erp-help-tip`** on title; **Create vendor** / refresh master still work.
- [ ] **Fuel expenses:** Filter **`mr-filter-bar`** (dates, search, QBO fields) + grid; **Manual fuel / DEF expense** — document header fields in **`mr-filter-bar`**; **Refresh fuel purchases**; pager with **16+** rows; **Record filtered to QuickBooks** still includes rows **off the current page** (regression from Rule 23 wiring).
- [ ] **Expense history:** Filters + pager (**16+** rows); **Export filtered CSV** = full filtered set, not current page only.
- [ ] **Pay bills:** Load open bills (if QBO available); **Create bill payment** path; **Recent bill payments** — **Refresh log**, filters (**`mr-filter-bar`**), pager (**16+**), clear search restores full loaded set; **Export CSV**.
- [ ] **QuickBooks rollback:** **Refresh** loads batches + posted checklist; **Revert** / undo flows unchanged.
- [ ] **Saved WO + AP cards:** Pager when **11+** cards; exports still full dataset.

---

## 5. Maintenance — reports (Rule 17)

- [ ] **Executive overview:** **Refresh reports** + **Sync QuickBooks lists + activity**; timestamp line; metrics populate.
- [ ] **TMS / QBO / sync / IFTA tabs:** Empty and loaded states; **?** tips open.
- [ ] **Maintenance spend by unit:** After refresh, pager with **16+** units; **Download CSV** full export.
- [ ] **Maintenance detailed:** Filters + pager (**11+** records); filters reset page to **1**.
- [ ] **Settlement / P&L:** Index pager (**16+** loads), line-item pager on heavy load, **Download CSV** full load; **Driver pay settlements** refresh; TMS box when applicable.
- [ ] **Team & security:** **Refresh panel** loads without error when auth enabled.

---

## 6. Maintenance — shop, safety, tracking, fleet (Rules 12, 16–17)

- [ ] **Shop board:** Each queue tab — pager (**16+**), filters reset page.
- [ ] **Safety / HOS:** HOS + active + in-service + assignments pagers and filter reset behavior.
- [ ] **Tracking:** Map units pager; assets + drivers pagers; **Idle** snapshot pager uses cache on page change (no unnecessary refetch).
- [ ] **Maintenance table (fleet):** Pager + category/service filter reset page.
- [ ] **Security alerts:** **`mr-filter-bar`** + **Refresh alerts**.

---

## 7. Maintenance — uploads and catalogs (Rules 14–15)

- [ ] **Upload center:** Each sub-tab (Bank, Comdata, Connections, Fuel, AP, Maint history, Other) — title **?** + short intro; file pick / stub flows do not throw in console.
- [ ] **Lists & catalogs → Service types (DB):** Name filter + pager (**16+**); activate/deactivate refreshes grid.

---

## 8. Maintenance — work orders and modals (Rules 5–9, 22 samples)

- [ ] **Accident WO:** Cost breakdown **?** opens/closes.
- [ ] **Tire WO:** First-tire / same-invoice **?** panel.
- [ ] **AP expense modal:** QBO banner tier colors when posting errors present.

---

## 9. Satellite pages

- [ ] **Dispatch:** Refresh, catalog sync, save load, upload doc, auto miles, row **Create invoice** / **Sync attachments**, status `<select>` busy state, toasts on failure.
- [ ] **Banking:** Snapshot, CSV import, suggest pager, link row, **`erp-auth-banner`** on 401, connection strip.
- [ ] **Settings:** Login/bootstrap, employees pager, connection strip, focus/error token styles.
- [ ] **Fuel:** **Selected Unit** title **?** opens; **Diesel purchase** fields sit in **`mr-filter-bar`**; save purchase, recommend (busy if wired), connection strip; write-secret banner styling when **`ERP_WRITE_SECRET`** is configured.
- [ ] **Index (hub):** Connection strip, no console errors.

---

## 10. Responsive and visual spot checks (Rule 1)

- [ ] **Maintenance:** Resize to **≤900px** — **Reports** hub sidebar stacks; toolbar spacing acceptable; no unusable horizontal scroll on primary flows you care about.
- [ ] **Print (optional):** **Print** from a board or report — chrome hides per **`@media print`** rules where implemented.

---

## 11. Deferred themes (only when implemented)

Re-run targeted checks from [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md), for example:

- [ ] **Pay bills → Open bills** pagination + **selection / pay amount** state across pages (if a `Map<billId, …>` model ships).
- [ ] **Driver pay settlements** nested pagination (if UX is specified).
- [ ] **Safety → Driver files** pager without losing per-row edits (if draft store or warnings ship).

---

## 12. Sign-off

- [ ] **Owner + date:** _______________________
- [ ] **Notes / blockers:** _______________________

**Tip:** Copy unchecked sections into a release ticket and attach environment + QBO/Samsara test account notes for the next reviewer.
