# IH35 ERP — Master redesign checklist vs codebase

**Consolidated report:** For a single document with **changelog**, **recommendations**, and **verification**, see **[`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md)**. **Post-checklist / deferred work** (e.g. open bills pager + selection model): **[`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md)**.

This file maps the **consolidated master redesign** (Rules 0–24) to **this repository** (`public/*.html`, `public/css/*`, `server.js`, no `/src` React tree). It is the durable checklist the assistant referenced when uploaded lists lived only in chat.

**Implementation guardrails (not “authorization gates”):** Ship checklist work in **focused diffs** (UI, CSS, client JS, read-only `GET` additions). **Prefer** not mixing large **save/post/sync** semantic changes with cosmetic passes—when persistence must change, document it in the PR. **Do not** remove **application authentication**, roles, API tokens, or user-visible security controls. **Do not** remove form fields or **parts-map SVG** assets. **Architecture deferrals** (e.g. open bills pager + selection model) stay in [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) until explicitly picked up.

**Architecture note:** The spec assumes `/src/styles/design-tokens.css` and `/src/components/StandardExpenseLines`. This app is **vanilla HTML + inline scripts + Express**. Equivalent locations are `public/css/` and markup inside `public/maintenance.html` (and siblings).

---

## Master checklist progress (revised)

**Overall completion: ~58%** toward the **documented intent** of Rules **0–24** in this repo (not pixel-perfect spec parity). Figures are for **planning and continuity**; they are judgment-based, not a contract metric. (Average of the per-rule fractions in the table below ÷ 25 ≈ **0.584** → **58.4%**; rounded headline **~58%**.)

**Method:** Treat each rule **0–24** as **one equal unit** (4% of the bar each). Assign a **fraction complete** per rule from the status text below (Done ≈ 1.0, strong Partial ≈ 0.45–0.75, Blocked/Future without alternate path ≈ 0–0.2, Skipped-by-design ≈ 0.85–1.0). **Overall = average of those 25 fractions × 100%.**

| Rule | Theme | Fraction (this revision) | Notes |
|------|--------|-------------------------|--------|
| 0 | Design tokens | 0.72 | **`board-nav.css`** bridges dropdown/hover to **`var(--color-*|pill-*|shadow-dropdown)`**; **`banking.html`** / **`settings.html`** / **`dispatch.html`** + **maintenance** prior passes; full **`app-theme`** migration still deferred |
| 1 | Responsive | 0.45 | Shell patterns; full viewport audit deferred |
| 2 | App shell | 0.47 | **`erp-master`** + **Lists** (**▤**) icon opens **`#catalog`**; dispatch nav link to same; spec dimensions/copy deferred |
| 3 | Collapsible sidebar | 1.0 | Pattern shipped (`ih35_sb_*`) |
| 4 | + New menu | 0.40 | Exists; spec matrix / new modals deferred or blocked |
| 5–9 | Modal shells | 0.45 each (avg) | QB-style modals; parity not verified rule-by-rule |
| 10 | StandardExpenseLines | 0.15 | No React tree; documented blocked / future |
| 11 | Pay bills | 0.45 | Flows exist; driver variant + open-bills pager deferred |
| 12 | Maintenance layout | 0.48 | **Lists & catalogs** sub-tab intros (**Rule 22**) + **Service types (DB)** filter/pager (**Rules 15/23**); full spec QA deferred |
| 13 | Accounting board | 0.46 | KPIs + dash cards; card subcopy uses **token** text colors; dark-panel cleanup partial |
| 14 | Upload center | 0.54 | Tabs + flows; **?** tips on every upload subpanel intro (Bank, Comdata, Fuel, AP, Maint, Other, Connections); alphabetical / full QA deferred |
| 15 | Filter bar | 0.54 | Several tables + **Security alerts** + **Lists & catalogs → Service types (DB)** search use **`mr-filter-bar`** / filter row; not universal |
| 16 | Safety / HOS | 0.55 | Tables + **Rule 23** pagers on Safety + idle snapshot |
| 17 | Reports | 0.56 | Hub + settlement; **TMS**, **QBO**, **sync**, **IFTA**, **Maintenance spend by unit**, **Team & security**, **Maint detailed** tab titles + **`erp-help-tip`**; **Maint spend by unit** + **Maint detailed** bodies paginated (**Rule 23**); “all on one page” partial |
| 18 | QBO GET aliases | 0.90 | Skipped — existing catalog/status routes |
| 19 | Toasts | 1.0 | `showToast` + `erpNotify` pattern |
| 20 | Button loading | 1.0 | `erpWithBusy` pattern |
| 21 | QBO error banner | 0.45 | Maintenance messaging; sticky spec deferred |
| 22 | “?” tips | 0.87 | **Lists & catalogs** — every sub-tab (**Service**, **QBO**, **Vendors**, **Operational**, **Fleet**) has short intro + **?**; + **Team** dynamic intro + prior report/upload/shop; **dispatch** sidebar **Tips** line + **?**; many `mini-note` blocks remain |
| 23 | Pagination | 0.86 | Broad `erpPagerRender` coverage; **Lists & catalogs → Service types (DB)** (**`serviceCatalogAdminPager`**); **Reports** spend-by-unit + maint detailed (prior); not every long table |
| 24 | Connection strip | 0.50 | Satellites + hub; universal Samsara+QBO banner deferred |

**Rolling average (above table):** sum of fractions ÷ 25 ≈ **0.584** (**58.4%**; headline **~58%**). When reporting updates, **revise fractions** (not the formula) as work lands, then re-average.

**Intentionally out of this % (until product agrees):** items in [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) (e.g. open bills pager + selection model).

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

- **Partial (this pass):** Added `public/css/design-tokens.css` with spec-aligned **additional** `:root` variables (`--color-*`, **`--color-semantic-*`**, `--btn-*`, `--pill-*`, spacing, dimensions). Linked **before** `app-theme.css` on maintenance, dispatch, fuel, banking, settings. **Satellite page shells** use **`background: var(--color-bg-page, var(--bg))`** on **banking**, **settings**, and **fuel** (company hub stays dark **`--bg`** only). **Banking**, **settings**, **dispatch**, and **maintenance** inline / `<style>` blocks increasingly use **`var(--color-*|pill-*|btn-danger-*|focus-ring|semantic-*)`** (see changelog **33**).
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

- **Partial / evolving:** Layout has been iterated (action bar, two-column patterns). **Lists & catalogs** sub-tabs use compact copy + **`erp-help-tip`** on each intro (Rule 22); **Service types (DB)** admin grid uses name filter + pager (**Rules 15/23**). Spec’s “remove views/QBO panels” list may not be 100% applied — needs visual QA against spec.

### Rule 13 — Accounting board

- **Partial:** KPI-style cards and QBO chrome exist in maintenance accounting sections; accounting **dash card** subcopy uses **`var(--color-text-body)`** / link color **`var(--color-border-focus)`** where updated. “Remove dark panel / instruction paragraphs” — partially addressed over time; confirm with UX pass.

### Rule 14 — Upload center

- **Partial:** Tabs and import flows exist; panel-head **?** on **Upload center**; **?** + one-line intro on **every** upload subpanel (**Bank**, **Comdata**, **Fuel**, **AP**, **Maint history**, **Other**, **Connections**). Alphabetical tab order and “every tab fully functional” should be verified with manual tests and real files.

### Rule 15 — Samsara-style filter bar

- **Partial:** Filter patterns exist on several tables (see spec comments in `erp-master-spec-2026.css`). **Maintenance → Security alerts** uses **`mr-filter-bar`** + **`mr-filter-bar__grow`** / **`__right`** for search, window, severity, and **Refresh alerts**. **Lists & catalogs → Service types (DB)** adds **`mr-filter-bar`** + live name filter for the Postgres catalog admin table. Not every table has full chip + pager parity.

### Rule 16 — Safety / HOS

- **Partial:** Tables and pills exist in maintenance for safety/tracking; column sets vs spec — verify.

### Rule 17 — Reports

- **Partial:** Reports hub shell in maintenance; **TMS**, **QBO**, **sync**, **IFTA**, **Maintenance spend by unit**, **Team activity & security**, **Maintenance detailed report** tab titles include **`erp-help-tip`** (IFTA / maint detailed body copy shortened + tip). **Spend by unit** rollup table and **Maintenance detailed** cards use **Rule 23** pagers after **Refresh reports**. “All reports on one page / remove links from other sidebars” — **not fully enforced** in this pass.

### Rule 18 — QBO GET endpoints

- **Skipped (different shape):** Catalog data is served via existing routes such as **`GET /api/qbo/catalog`**, **`GET /api/qbo/master`**, **`GET /api/qbo/status`** and cached in `erp.qboCache` — not the exact `/api/qbo/accounts` … list from the spec. Adding parallel read-only GETs would be **new API surface** (allowed only if product wants duplication); **not added** here to avoid confusion with existing clients.

### Rule 19 — Toasts

- **Done (this pass):** Global **`.erp-toast-host` / `.erp-toast*`** styles in `erp-master-spec-2026.css`. **`window.showToast(message, type)`** and **`window.erpNotify(message, type?)`** in `erp-ui.js` (`success` | `error` | `warning` | `info`; `erpNotify` infers type when omitted and replaces legacy **`alert()`** across maintenance, fuel, banking, settings, dispatch). Host div on banking, settings, dispatch, fuel, maintenance, and company **`index.html`** (hub loads **`erp-ui.js`** deferred for future use).

### Rule 20 — Button loading

- **Done (pattern):** **FIX 10** — `erpWithBusy`, `erp-btn--busy`, spinners in `erp-ui.js` + CSS. Applied on multiple async actions (maintenance save split, banking, settings, fuel, **dispatch** refresh / catalog / save / uploads / auto miles / QBO doc sync from modal, **row** Create invoice & Sync attachments, quick-add truck/trailer; status `<select>` uses `disabled` + `aria-busy` while patching).

### Rule 21 — QBO error banner

- **Partial:** QBO alert / sync messaging exists in maintenance; sticky banner + accounting badge behavior — compare to spec.

### Rule 22 — Instruction cleanup → “?” tips

- **Done (pattern):** Global **`.erp-help-tip*`** styles; **`erpHelpTipToggle`** + click/Escape close in **`erp-ui.js`**. Banking includes a sample tip. Dispatch board uses compact copy + tips. **Maintenance:** **accident** WO **Cost breakdown** + **tire** WO “same invoice / multiple positions” + **shop → Parts** queue intro each use a short line + **`erp-help-tip`** panel; **reports → Settlement / P&L** intro + trip rollup panel use the same pattern; **Fleet → Vehicles by shop / location context** title + **?**; **reports** tabs **TMS**, **QBO**, **sync**, **IFTA**, **maintenance spend**, **detailed**, **team** + **Lists & catalogs** (panel title + **all five** sub-tab intros) + **?**; **Upload center** (prior pass). Many other long **`mini-note`** blocks remain for future passes.

### Rule 23 — Pagination

- **Partial:** **`erpPagerRender`** / **`erpPagerSliceRange`** for tables that were wired (**banking** suggestions, **settings** employees, **maintenance shop board** internal / external / roadside / parts queue tables with per-tab page state; **maintenance accounting → Fuel expense** grid with **`fuelExpensePager`**; **maintenance accounting → Expense history** with **`expHistPager`**; **maintenance accounting → Saved Maintenance Expense Transactions** card list (**`apTxnListPager`**); **accounting → Pay bills → Recent bill payments** log (**`bpLogPager`**, **`__bpBillPaymentLogAllRows`** + client filter); **reports → Settlement / P&L** load index + per-load line items (**`settlementIndexPager`**, **`settlementLinesPager`**); **reports → Maintenance spend by unit** rollup table (**`repMaintByUnitPager`**, **`#repMaintByUnitPagerHost`**); **reports → Maintenance detailed report** filtered record cards (**`repMaintDetailPager`**, **`#repMaintDetailPagerHost`**); **Lists & catalogs → Service types (DB)** (**`serviceCatalogAdminPager`**, **`#serviceCatalogAdminPagerHost`**, client-side name filter); **maintenance → Maintenance Table** (**`maintDashboardTablePager`**); **maintenance → Safety / HOS** tab: **HOS clocks** (**`safetyHosPager`**), **Active** / **In service** panels (**`safetyActivePager`**, **`safetyInServicePager`**), **Assignments** (**`safetyAssignPager`**); **tracking → Map → Units** cards (**`trackingListPager`**); **tracking → All tracked assets** + **Drivers (HOS)** tables (**`trackingAssetsTablePager`**, **`trackingDriversPager`**); **tracking → Idle snapshot** vehicles table (**`idleSnapshotPager`**, rows cached on **`idleSnapshotPager._rows`** for page changes without refetch). Not literally every table >10 rows.

### Rule 24 — Connection verification on load

- **Partial:** Maintenance loads QBO status / sync alerts in the **sidebar** and embed bars. **`erpMountConnectionStrip(hostId)`** in **`erp-ui.js`** + **`.erp-connection-strip*`** in **`erp-master-spec-2026.css`** show a **read-only QuickBooks status** line on **banking**, **settings**, **fuel**, and **company hub** (`index.html`) after load. Universal yellow **Samsara + QBO** banner on every surface — still **not** fully unified with maintenance’s richer status text.

---

## Changes made in the pass that produced this document

1. **`public/css/design-tokens.css`** — Rule 0 token file (public path; spec’s `/src/styles/` noted as inapplicable); semantic status line colors (**`--color-semantic-*`**); bulk **`maintenance.html`** inline **`var(--*)`** for errors, links, QBO banners, import failures (see changelog **29**).
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
22. **Rule 23 (safety + idle snapshot):** **`maintenance.html`** — **Safety / HOS** tab: **`#safetyHosPagerHost`** + **`safetyHosPager`**; **`#safetyActivePagerHost`** / **`#safetyInServicePagerHost`** + **`safetyActivePager`** / **`safetyInServicePager`** (duty filter resets page); **`#safetyAssignPagerHost`** + **`safetyAssignPager`** (assign filter + search reset page). **Tracking → Idle:** **`#idleSnapshotPagerHost`** + **`idleSnapshotPager`** with **`renderIdleSnapshotTableBody`** paging **`idleSnapshotPager._rows`** after **`loadIdleSnapshot`** succeeds.
23. **Rule 22 (upload Connections):** **`maintenance.html`** — **Upload center → Connections**: title row **`erp-help-tip`** + shortened **`mr-upload-panel-desc`** so long guidance sits behind **?**.
24. **Rule 22 + 0 (upload subpanels):** **`maintenance.html`** — **Bank CSV**, **Comdata / Relay**, **Fuel / DEF**, **Maintenance AP**, **Maintenance history**, **Other**: same title **`erp-help-tip`** + one-line **`mr-upload-panel-desc`**; existing **`<details>`** help kept. **Connections** Samsara meta line uses **`var(--color-text-label, …)`**.
25. **Rules 22 + 15 + 17 + 0:** **`maintenance.html`** — **Fleet → Vehicles by shop / location context**: long intro → title **`erp-help-tip`** + short line. **Security alerts**: **`mr-filter-bar`** around search / window / severity + **Refresh**. **Reports → TMS load pipeline**: panel title **`erp-help-tip`**. Accounting nav QBO summary box: **`var(--color-text-body|label)`** instead of hard-coded grays.
26. **Rules 17 + 22 + 0 + 13:** **`maintenance.html`** — **Reports → QuickBooks** + **ERP vs QBO sync** + **IFTA** panel titles **`erp-help-tip`** (IFTA: three paragraphs → one line + tip). **Lists & catalogs** title **`erp-help-tip`**. Accounting board dash card copy + **View all errors** link: **`var(--color-text-body)`** / **`var(--color-border-focus)`**. Maintenance **edit record hint** + **QBO issues** aside: token text colors.
27. **Rules 17 + 22 + 0:** **`maintenance.html`** — **Reports → Team & security**, **Maintenance spend by unit**, **Maintenance detailed report**: panel title **`erp-help-tip`**; maint detailed intro → one line + **?**. **Connections** integration strip **QuickBooks: not configured** uses **`var(--color-text-label)`**; shop queue **Remove** uses same token.
28. **Rules 0 + 22:** **`design-tokens.css`** — **`--color-semantic-success|warning|warn-accent|error`**. **`maintenance.html`** — **`paintMaintConnectionStrip`** uses semantic tokens; **`loadTeamSecurityPanel`** intro → short line + **`erp-help-tip`**; team/audit errors + idle alert column colors use **`var(--color-semantic-*)`**.
29. **Rule 0 + docs:** **`maintenance.html`** — bulk **`var(--color-semantic-error|…)`**, **`var(--color-border-focus)`**, **`var(--pill-red-text|green-text)`** on inline error/link/import/QBO-dot/banner strings; **`paintQboStatusBanner`** / **`paintApTxnQboBanner`** tier text uses tokens. **`ERP_MASTER_REDESIGN_STATUS.md`** — “protection block” reframed as **implementation guardrails** (auth stays); “human review” → optional product notes.
30. **Rules 0 + 22:** **`fuel.html`** — **Home** + maintenance fuel link use **`var(--color-border-focus)`**. **`maintenance.html`** — **Lists & catalogs → QuickBooks items & accounts**: compact line + **`erp-help-tip`**.
31. **Rules 22 + 0:** **`maintenance.html`** — **Lists & catalogs** sub-tabs **Service types**, **Vendors & drivers**, **Operational status**, **Fleet & Samsara**: same short line + **`erp-help-tip`** pattern as QBO tab; **Fleet** Samsara write card top border uses **`var(--color-border)`**.
32. **Rule 0:** **`dispatch.html`** — load document list **`border-bottom`** uses **`var(--color-border)`**; **QBO posting alert** brief text colors use **`var(--color-semantic-error|warn-accent)`**; board intro **`mini-note`** uses **`var(--color-text-label)`**.
33. **Rule 0:** **`banking.html`** — metrics + table header + **`#authBanner`** + suggest-card inline styles use **`var(--color-bg-header|border|card|pill-red|btn-danger-*)`**. **`settings.html`** — **`input:focus`** + **`.err`** use **`var(--color-border-focus|focus-ring|semantic-error)`**. **`dispatch.html`** — modal/stop/embed/chrome backgrounds and miles table borders use **`var(--color-bg-header|bg-hover|bg-card|color-border)`**.
34. **Rules 23 + 22 + hub polish:** **`maintenance.html`** — **Reports → Maintenance detailed report**: **`#repMaintDetailPagerHost`** + **`repMaintDetailPager`** paginate filtered record cards (default 10/page; filters reset page). **`index.html`** — **Safety** / **Tracking** hub card tags use **`.tag-safety`** / **`.tag-tracking`** (no inline colors). **`dispatch.html`** — sidebar **Tips**: one-line summary + **`erp-help-tip`** behind **?** (**`erpHelpTipToggle`**).
35. **Rule 23:** **`maintenance.html`** — **Reports → Maintenance spend by unit**: **`#repMaintByUnitPagerHost`** + **`repMaintByUnitPager`** + **`renderRepMaintSpendByUnitTable`** paginate the rollup table after **Refresh reports** (default 15/page; full refresh resets page). **CSV export** unchanged (server route).
36. **Rules 0 + 12 + 15 + 23 (lists, not reports):** **`public/css/board-nav.css`** — company hub strip dropdown borders/shadow/hover use **`var(--color-border|shadow-dropdown|pill-blue-*|color-bg-card)`** with legacy fallbacks. **`maintenance.html`** — **Lists & catalogs → Service types (DB)**: **`mr-filter-bar`** + **`#serviceCatalogAdminSearch`**, **`#serviceCatalogAdminPagerHost`** + **`serviceCatalogAdminPager`**, **`renderServiceCatalogAdmin`** (filter slices rows then **`erpPagerRender`**); **`toggleCatalogActiveFromBtn`** calls **`loadServiceCatalogAdminOnly`** after **`loadAll`** so the grid refreshes.
37. **Discoverability (Rule 2 / shell):** **`maintenance.html`** — new **Lists** (**▤**) icon in **`#erpIconNav`** (between **Accounting** and **Reports**) opens **`#catalog`**; duplicate hidden ghost **`catalog`** nav control removed. Sidebar block title **`Lists, imports & admin`** → **`Lists & catalogs`** plus one-line pointer to the **Lists** icon. **`dispatch.html`** — same **Lists** link to **`/maintenance.html#catalog`** for parity.

---

## Product / engineering notes (optional; not blockers for checklist work)

1. **Priorities:** Which rules are mandatory for the next release vs nice-to-have (spec asks for everything at once; engineering may still sequence).
2. **Rule 10 / React path:** Shared component + build step vs one canonical HTML/JS cost-line implementation.
3. **Rule 4 — + New menu:** Which rows are deep-links vs new modals (avoid new save APIs unless explicitly scoped).
4. **Rule 18:** Thin `GET /api/qbo/accounts`-style aliases vs documenting existing catalog routes only.
5. **Regression:** Run server + manual click-through + `node scripts/system-smoke.mjs` when convenient before release.

---

## Rules that are **large** or **platform-shaped** (why “100%” is staged)

- **Scope:** Rules 5–12, 17, modals, and layout restructures touch **tens of thousands** of lines in `maintenance.html` alone.
- **Persistence:** Big-bang **save/post/sync** edits are **risky**—keep them scoped PRs, not mixed with UI-only sweeps.
- **No `/src` tree:** StandardExpenseLines as a separate framework component **does not apply** without a broader platform decision.
- **Verification:** Full QBO/Samsara click-through requires a **running environment** and credentials—not fully automated in CI.

---

## Reminder (uploaded lists)

If a newer checklist lives **outside** this repo, add it under `docs/` or paste unchecked items into a GitHub issue / this file’s appendix so implementation can be traced rule-by-rule.
