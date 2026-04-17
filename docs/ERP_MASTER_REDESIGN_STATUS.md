# IH35 ERP — Master redesign checklist vs codebase

**Consolidated report:** For a single document with **changelog**, **recommendations**, and **verification**, see **[`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md)**. **Post-checklist / deferred work** (e.g. open bills pager + selection model): **[`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md)**.

This file maps the **consolidated master redesign** (Rules 0–24 + protection block) to **this repository** (`public/*.html`, `public/css/*`, `server.js`, no `/src` React tree). It is the durable checklist the assistant referenced when uploaded lists lived only in chat.

**Protection block:** No backend save/post/sync behavior was changed for this pass. No fields removed. No parts-map SVG removed.

**Architecture note:** The spec assumes `/src/styles/design-tokens.css` and `/src/components/StandardExpenseLines`. This app is **vanilla HTML + inline scripts + Express**. Equivalent locations are `public/css/` and markup inside `public/maintenance.html` (and siblings).

---

## System inspection (high level)

| Area | Finding |
|------|---------|
| **APIs** | QuickBooks and Samsara routes live in `server.js` (`/api/qbo/*`, maintenance/fleet/board APIs). Token refresh and error handling are embedded in those flows — **not re-audited line-by-line** in this pass. |
| **Forms** | Primary ERP forms are in `public/maintenance.html` (maintenance, accounting, fuel tabs, uploads, etc.). Satellite pages: `banking.html`, `settings.html`, `fuel.html`, `dispatch.html`. |
| **Routes** | Static HTML under `public/`; no client router. |
| **Smoke test** | `node scripts/system-smoke.mjs` requires a **running server** and network to `localhost`; it failed in CI sandbox with “fetch failed” (expected when server off). |

---

## Rules — status

Legend: **Done** (meets intent in this repo), **Partial**, **Skipped** (already satisfied or out of scope), **Blocked** (would violate protection block or needs product decision), **Future** (large build).

### Rule 0 — Design system tokens

- **Partial (this pass):** Added `public/css/design-tokens.css` with spec-aligned **additional** `:root` variables (`--color-*`, `--btn-*`, `--pill-*`, spacing, dimensions). Linked **before** `app-theme.css` on maintenance, dispatch, fuel, banking, settings. **Satellite page shells** use **`background: var(--color-bg-page, var(--bg))`** on **banking**, **settings**, and **fuel** (company hub stays dark **`--bg`** only).
- **Not done:** Full migration of all components from legacy `--bg`, `--panel`, etc. to `--color-*` (would be a large visual sweep).
- **Spec path:** Use `public/css/design-tokens.css`, not `/src/styles/`.

### Rule 1 — Responsive layout

- **Partial:** `erp-master-spec-2026.css` + `app-theme.css` already enforce `min-width:0`, scroll columns, table wrappers for maintenance shell. Dispatch/fuel/banking use simpler layouts.
- **Future:** Strict “no horizontal scrollbar at 1280/1440/1920” audit across every section tab.

### Rule 2 — App shell

- **Partial:** Maintenance uses `erp-master` shell (icon nav, sidebars, top bar patterns in HTML/CSS). Labels and module order differ in places from the spec’s canonical list (e.g. “Fuel Plan” naming).
- **Future:** Align copy, dimensions (68px / 216px / 48px), and tab set exactly to spec.

### Rule 3 — Collapsible sidebar

- **Done (pattern):** Maintenance uses `erpSbGroup` / `erpToggleSbGroup` with `localStorage` keys `ih35_sb_*`. Not every sidebar in the spec has been re-enumerated item-by-item in this audit.

### Rule 4 — “+ New” menu

- **Partial:** Maintenance has a **+ New** menu; width/columns/custom fleet rows may not match the full 680px / three-column / custom-type matrix in the spec.
- **Blocked:** Implementing **new** modal types that change save endpoints would violate “no new backend unless instructed”; **UI-only** presets that reuse existing save paths are allowed in principle but were not expanded in this pass.

### Rules 5–9 — Modal shells (Expense, Bill, WO, etc.)

- **Partial:** QuickBooks-style modals exist (`erp-qb-dialog`, maintenance work order / accounting flows). Full parity with spec (running total bar, footer links, unsaved confirm everywhere) is **not verified rule-by-rule**.

### Rule 10 — StandardExpenseLines component

- **Blocked / Future:** There is **no** `/src/components/StandardExpenseLines`. Cost lines are implemented in **maintenance HTML/JS** (`maint-cost-line`, etc.). Extracting a shared component would be a large refactor; **not started** to avoid breaking saves.

### Rule 11 — Pay bills

- **Partial:** Pay bills / QBO flows exist in maintenance + `server.js` (`/api/qbo/open-bills`, `bill-payment`, etc.). “Driver bill pay” as a dedicated filtered variant per spec — **verify** in UI vs spec.

### Rule 12 — Maintenance page layout

- **Partial / evolving:** Layout has been iterated (action bar, two-column patterns). Spec’s “remove views/QBO panels” list may not be 100% applied — needs visual QA against spec.

### Rule 13 — Accounting board

- **Partial:** KPI-style cards and QBO chrome exist in maintenance accounting sections; “remove dark panel / instruction paragraphs” — partially addressed over time; confirm with UX pass.

### Rule 14 — Upload center

- **Partial:** Tabs and import flows exist; alphabetical tab order and “every tab fully functional” should be verified with manual tests and real files.

### Rule 15 — Samsara-style filter bar

- **Partial:** Filter patterns exist on several tables (see spec comments in `erp-master-spec-2026.css`). Not every table has full chip + pager parity.

### Rule 16 — Safety / HOS

- **Partial:** Tables and pills exist in maintenance for safety/tracking; column sets vs spec — verify.

### Rule 17 — Reports

- **Partial:** Reports hub shell in maintenance; “all reports on one page / remove links from other sidebars” — **not fully enforced** in this pass.

### Rule 18 — QBO GET endpoints

- **Skipped (different shape):** Catalog data is served via existing routes such as **`GET /api/qbo/catalog`**, **`GET /api/qbo/master`**, **`GET /api/qbo/status`** and cached in `erp.qboCache` — not the exact `/api/qbo/accounts` … list from the spec. Adding parallel read-only GETs would be **new API surface** (allowed only if product wants duplication); **not added** here to avoid confusion with existing clients.

### Rule 19 — Toasts

- **Done (this pass):** Global **`.erp-toast-host` / `.erp-toast*`** styles in `erp-master-spec-2026.css`. **`window.showToast(message, type)`** and **`window.erpNotify(message, type?)`** in `erp-ui.js` (`success` | `error` | `warning` | `info`; `erpNotify` infers type when omitted and replaces legacy **`alert()`** across maintenance, fuel, banking, settings, dispatch). Host div on banking, settings, dispatch, fuel, maintenance, and company **`index.html`** (hub loads **`erp-ui.js`** deferred for future use).

### Rule 20 — Button loading

- **Done (pattern):** **FIX 10** — `erpWithBusy`, `erp-btn--busy`, spinners in `erp-ui.js` + CSS. Applied on multiple async actions (maintenance save split, banking, settings, fuel, **dispatch** refresh / catalog / save / uploads / auto miles / QBO doc sync from modal, **row** Create invoice & Sync attachments, quick-add truck/trailer; status `<select>` uses `disabled` + `aria-busy` while patching).

### Rule 21 — QBO error banner

- **Partial:** QBO alert / sync messaging exists in maintenance; sticky banner + accounting badge behavior — compare to spec.

### Rule 22 — Instruction cleanup → “?” tips

- **Done (pattern):** Global **`.erp-help-tip*`** styles; **`erpHelpTipToggle`** + click/Escape close in **`erp-ui.js`**. Banking includes a sample tip. Dispatch board uses compact copy + tips. **Maintenance:** **accident** WO **Cost breakdown** + **tire** WO “same invoice / multiple positions” + **shop → Parts** queue intro each use a short line + **`erp-help-tip`** panel; **reports → Settlement / P&L** intro + trip rollup panel use the same pattern. Many other long **`mini-note`** blocks remain for future passes.

### Rule 23 — Pagination

- **Partial:** **`erpPagerRender`** / **`erpPagerSliceRange`** for tables that were wired (**banking** suggestions, **settings** employees, **maintenance shop board** internal / external / roadside / parts queue tables with per-tab page state; **maintenance accounting → Fuel expense** grid with **`fuelExpensePager`**; **maintenance accounting → Expense history** with **`expHistPager`**; **maintenance accounting → Saved Maintenance Expense Transactions** card list (**`apTxnListPager`**); **accounting → Pay bills → Recent bill payments** log (**`bpLogPager`**, **`__bpBillPaymentLogAllRows`** + client filter); **reports → Settlement / P&L** load index + per-load line items (**`settlementIndexPager`**, **`settlementLinesPager`**); **maintenance → Maintenance Table** (**`maintDashboardTablePager`**); **tracking → Map → Units** cards (**`trackingListPager`**); **tracking → All tracked assets** + **Drivers (HOS)** tables (**`trackingAssetsTablePager`**, **`trackingDriversPager`**)). Not literally every table >10 rows.

### Rule 24 — Connection verification on load

- **Partial:** Maintenance loads QBO status / sync alerts in the **sidebar** and embed bars. **`erpMountConnectionStrip(hostId)`** in **`erp-ui.js`** + **`.erp-connection-strip*`** in **`erp-master-spec-2026.css`** show a **read-only QuickBooks status** line on **banking**, **settings**, **fuel**, and **company hub** (`index.html`) after load. Universal yellow **Samsara + QBO** banner on every surface — still **not** fully unified with maintenance’s richer status text.

---

## Changes made in the pass that produced this document

1. **`public/css/design-tokens.css`** — Rule 0 token file (public path; spec’s `/src/styles/` noted as inapplicable).
2. **Linked `design-tokens.css`** in `maintenance.html`, `dispatch.html`, `fuel.html`, `banking.html`, `settings.html`.
3. **`public/css/erp-master-spec-2026.css`** — Global Rule 19 toast styles.
4. **`public/js/erp-ui.js`** — `window.showToast(message, type)`.
5. **`#erpToastHost`** on banking, settings, dispatch, fuel (maintenance already had it).
6. **`showErpToast`** in maintenance delegates to **`window.showToast`** when present (single toast implementation).
7. **Banking / settings / fuel** async flows call **`showToast`** on success and error (and banking uses **warning/info** where appropriate).
8. **`dispatch.html`** — Rule 22 compact intro + help tips; token-backed main column tweaks in **`erp-master-spec-2026.css`**; **`erpWithBusy`** on refresh, QBO catalog sync (toolbar), save load, doc upload, rate-con PDF extract, auto miles, docs-modal QBO sync, **board row** QBO buttons (invoice + attachments), and **quick-add** truck/trailer; status changes disable the row `<select>` while saving; **`showToast`** on those outcomes plus QBO invoice / attachment sync, **`patchStatus`**, and **openEditLoad** load failures; **`showMsg`** escapes text; manual refresh passes **`loadTab(true)`** so failures surface as toasts while the timer refresh stays quiet.
9. **`erp-ui.js` — `erpNotify(message, type?)`:** toast-first replacement for legacy **`alert()`** across **`maintenance.html`**, **`fuel.html`**, **`banking.html`**, **`settings.html`**, **`dispatch.html`** (with heuristic type when `type` omitted). **`index.html`** — shared **`design-tokens`**, **`erp-master-spec-2026`** (toasts), **`#erpToastHost`**, **`erp-ui.js`** for consistency if hub gains scripts later.
10. **Rule 24 + Rule 0 (continuation):** **`erpMountConnectionStrip`** + **`#erpConnectionStrip`** on **banking**, **settings**, **fuel**, **index**; token-backed **`--color-bg-page`** body background on banking/settings/fuel. **Rule 22:** maintenance **accident** WO inline help → **`erp-help-tip`**.
11. **Rule 22 (tire WO):** **Tire** record first-tire / same-invoice copy → compact line + **`erp-help-tip`** panel in **`maintenance.html`**.
12. **Documentation:** **[`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md)** — consolidated changelog, rule matrix, recommendations, verification, risks.
13. **Rule 23 + 22 (shop board):** **`maintenance.html`** — shop queue tables (**internal**, **external**, **roadside**, **parts**) use **`erpPagerRender`** with **`shopQueuePager`** state (default 15 rows/page; filters reset page). **Parts** tab intro uses compact copy + **`erp-help-tip`**.
14. **Rule 23 (fuel expense grid):** **`maintenance.html`** — **`#fuelExpPagerHost`** + **`fuelExpensePager`** slice the fuel expense table; **`postFuelExpenseToQbo`** reads ERP row + draft when the row is not on the current page so **Record filtered to QuickBooks** still posts the full filtered set.
15. **Rule 23 (expense history):** **`maintenance.html`** — **`#expHistPagerHost`** + **`expHistPager`** paginate the combined expense history table; **Export filtered CSV** still uses the full filtered row set.
16. **Rule 23 (settlement report):** **`maintenance.html`** — **`#settlementIndexPagerHost`** / **`settlementIndexPager`** for **Loads with recorded costs**; **`#settlementLinesPagerHost`** / **`settlementLinesPager`** for trip lookup line items (new load # resets page). **Download CSV** still exports the full load from the API.
17. **Rule 23 (saved WO + AP cards):** **`maintenance.html`** — **`#apListPagerHost`** + **`apTxnListPager`** paginate the combined work-order and AP **record-card** list (default 10 cards/page); CSV exports still use server / full **`erp`** datasets.
18. **Rule 22 (settlement report copy):** **`maintenance.html`** — **Reports → Settlement / P&L** page intro and trip rollup panel: long paragraphs replaced with short **`mini-note`** lines plus **`erp-help-tip`** panels.
19. **Rule 23 (maintenance fleet table):** **`maintenance.html`** — **`#maintTablePagerHost`** + **`maintDashboardTablePager`** paginate the **Maintenance Table** (filter key = fleet category + service filter string).
20. **Rule 23 (tracking unit cards):** **`maintenance.html`** — **`#trackingListPagerHost`** + **`trackingListPager`** paginate **Tracking → Map → Units** cards (filter key = search text).
21. **Rule 23 (tracking assets + drivers + bill pay log):** **`maintenance.html`** — **`#trackingAssetsPagerHost`** / **`#trackingDriversPagerHost`**; **Pay bills** payment log uses **`window.__bpBillPaymentLogAllRows`** so clearing the log search shows all loaded payments again, with **`#bpLogPagerHost`** + **`bpLogPager`** slicing the filtered list.

---

## Items needing **human review**

1. **Priorities:** Which rules are mandatory for the next release vs nice-to-have (spec asks for everything at once; engineering needs sequencing).
2. **Rule 10 / React path:** Whether to invest in a **shared component** (would likely mean introducing a build step or strict ES modules) vs keeping **one** canonical cost-line implementation in JS.
3. **Rule 4 custom New menu rows:** Which presets are worth shipping if they only **deep-link** or **pre-fill** existing modals (no new APIs).
4. **Rule 18:** Whether to add **thin** `GET /api/qbo/accounts`-style aliases that delegate to existing catalog cache (documentation win vs endpoint proliferation).
5. **Full regression:** Run server + manual click-through of every tab and import path; run smoke script with server up.

---

## Rules that could **not** be “fully completed” in one autonomous pass (why)

- **Scope:** Rules 5–12, 17, modals, and layout restructures touch **tens of thousands** of lines in `maintenance.html` alone.
- **Protection block:** No mass changes to save/post/sync without explicit approval.
- **No `/src` tree:** StandardExpenseLines as a separate framework component **does not apply** without a broader platform decision.
- **Verification:** “Click every button / every API” requires a **running environment**, credentials, and QBO/Samsara connectivity — not automated here.

---

## Reminder (uploaded lists)

If a newer checklist lives **outside** this repo, add it under `docs/` or paste unchecked items into a GitHub issue / this file’s appendix so implementation can be traced rule-by-rule.
