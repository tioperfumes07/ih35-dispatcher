# IH35 ERP — Master redesign: final report (living document)

**Generated:** 2026-04-16 · **Repo:** `ih35_dispatch_v3_starter` (vanilla HTML + Express, no `/src` React tree)  
**Companion:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) (rule-by-rule checklist) · **Post-checklist backlog:** [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md)

This report consolidates **what was built**, **how it maps to the master rules (0–24)**, **recommendations for the next increment**, and **how to verify** work without assuming QBO/Samsara credentials in CI.

---

## 1. Implementation guardrails

These **engineering** practices stay in force; they are **not** “permission slips” to remove product security:

- **Application security:** Authentication, roles, API tokens, and server-side checks remain as implemented—**do not** strip them to “speed up” the checklist.
- **Persistence:** Prefer **not** mixing large **save / post / sync** semantic changes with cosmetic-only passes; scope persistence edits in their own PRs with clear notes.
- **Assets / fields:** Do **not** remove form fields or **parts-map SVG** assets.
- **New server reads:** Prefer **read-only** additions for cross-page UI (e.g. `GET /api/qbo/status` for connection strips) unless a write route is explicitly part of the task.

PRs that change `server.js` persistence should still describe intent and risk briefly.

---

## 2. Executive summary

| Theme | Outcome |
|--------|---------|
| **Shared UI layer** | `public/js/erp-ui.js`: `erpWithBusy`, `erpPagerRender`, `erpHelpTipToggle`, `showToast`, `erpNotify`, `erpMountConnectionStrip`. |
| **Global styles** | `public/css/erp-master-spec-2026.css`: toasts, busy buttons, help tips, dispatch shell, **connection strip** modifiers. |
| **Design tokens** | `public/css/design-tokens.css` linked **before** `app-theme.css` on ERP surfaces; satellite pages use **`--color-bg-page`** for body background where appropriate. |
| **Blocking `alert()`** | Replaced with **`erpNotify`** (toast-first + type inference) across maintenance, fuel, banking, settings, dispatch. |
| **Dispatch parity** | Tokens, toasts, busy buttons, Rule 22 intro, row QBO actions, `patchStatus` busy state, escaped `showMsg`. |
| **Rule 24 (partial)** | One-line **QuickBooks** status strip on **banking, settings, fuel, index**, **maintenance**, and **dispatch** (non-embed) via `erpMountConnectionStrip`. **Hub** neutral strip uses **`--color-hub-*`** until ok/warn/muted tiers apply (**changelog 69**). Sidebars / embed bars still hold richer **QBO / Samsara** context where applicable. |
| **Rule 22 (samples)** | Dispatch board + banking (lead + **CSV import** step) + maintenance **accident** + **tire** WO + **reports settlement** intros + **Home** **System / Sync Summary** + **Units** column + **Maintenance Table** + **Unit History** + **Tracking → Map** (**Units** + **Live map**) + **Tracking** **Fleet mix snapshot** KPI row (**changelog 63**) + **Shop / tracking / accounting / settlement / Live Master columns / Team & security** (**`loadTeamSecurityPanel`**) + **Reports** hub toolbar + **Accounting board** strip + **Maintenance** **Workspace snapshot** (**changelog 62**) + **Upload center** shell + **WO** **Operational status** / **QBO posting header** + **rollback** batch sub-heads + **Safety** **Active drivers** / **In service now** + **`fuel.html`** **Selected Unit** + **`settings.html`** **Users** / **Employees** + **`index.html`** hub + **footer** mileage titles folded into **`erp-help-tip`** (**changelog 67**). |

---

## 3. Changelog (files touched in this program of work)

### 3.1 JavaScript

| File | Changes |
|------|---------|
| **`public/js/erp-ui.js`** | `showToast`, `erpWithBusy`, pager helpers, Rule 22 toggle + document listeners, **`erpNotify`**, **`erpMountConnectionStrip`** (QBO `GET /api/qbo/status`). |

### 3.2 CSS

| File | Changes |
|------|---------|
| **`public/css/design-tokens.css`** | Spec-aligned `:root` tokens (colors, buttons, pills, spacing, radii, toast shadow, focus ring, transitions); **`--color-modal-backdrop`** for modal overlays (**changelog 87**); **`--color-success-border-soft`** / **`--color-warning-border-soft`** for QBO connection strip tiers (**changelog 89**). |
| **`public/css/erp-master-redesign.css`** | ERP shell / module chrome; **`body.erp-maintenance #qboSyncAlertBar`** visible strip uses **`var(--pill-red-*|btn-danger-border|color-text-primary)`** (**changelog 76**); **≤720px** hides **`.topbar-hint--lead`**, keeps topbar **`?`** (**changelog 86**). |
| **`public/css/erp-master-spec-2026.css`** | Toasts, busy spinners, help tips, maintenance/dispatch/fuel/banking/settings hooks, **`.erp-connection-strip*`**, **`#authBanner.erp-auth-banner`** on **maintenance** + **banking** (login-required strip, Rules **0** / **13**), dispatch main-column token bridge; **`mr-filter-bar`** / **`__grow`** / **`__actions`** on **`body.erp-maintenance`**, **`body.fuel-board`**, **`body.banking-page`**, **`body.settings-page`** (shared bottom border uses **`var(--color-border)`**); **`.erp-pager`** / **`erp-pager__btn`** / **`erp-pager__size-sel`** borders use **`var(--color-border, var(--line, …))`** (**changelog 63**); **`body.hub-page .erp-help-tip__btn`** uses **`--color-hub-*`** for border / fill / hover / **`focus-visible`** (**changelog 73**); **`.erp-help-tip*`** (default) + **`body.erp-maintenance .mr-filter-chipwrap`** / **`.mr-filter-drop`** / **`.mr-filter-search`** token + **`focus-visible`** on chip **`<summary>`** (**changelog 78**); **`mr-filter-search`** / **`mr-filter-inline-select`** **`:focus-visible`** (**changelog 79**); **`mr-filter-bar .qb-in` / `.in`** **`focus-visible`** + **`.mr-violation-legend*`** pill tokens (**changelog 80**); **`mr-filter-bar .btn` / `button`** **`focus-visible`** (**changelog 81**) + same field/button **`focus-visible`** on **`fuel-board` / `banking-page` / `settings-page`** filter rows (**changelog 82**); **fuel / banking / settings / dispatch** **`board-nav`** strip **`--font-spec-sans`** + **500**-weight triggers (**changelog 83**); **`.erp-pager`** background **`var(--color-bg-header)`** + **`erp-pager__btn` / `erp-pager__size-sel`** **`focus-visible`** (**changelog 84**); **Upload** **`.mr-upload-pills .subtab.active`** uses **`var(--color-border-focus)`** (**changelog 75**); **Reports** `.erp-reports-roadmap` uses **`var(--pill-yellow-*|color-semantic-warning)`** (**changelog 85**); **≤900px** maintenance **`.erp-main-body`** + **`.erp-topbar.topbar`** padding/gap trim (**changelog 85**); **`body.erp-maintenance .modal`** border **`var(--color-border, var(--qb-line))`** + **`.topbar-hint-wrap`** flex row (**changelog 86**); **`.modal-bg`** uses **`var(--color-modal-backdrop)`**; **≤900px** module sidebar head/inner/footer trim (**changelog 87**); **Dispatch** modals + **≤900px** dispatch / banking / settings / fuel horizontal chrome (**changelog 88**); maintenance **KPI ok** border + cost table header token (**changelog 88**); **`.erp-connection-strip--ok` / `--warn`** borders + **`.erp-dedicated-form-modal__backdrop`** + hub strip **≤900px** padding (**changelog 89**); **`.mr-qbo-banner*`** + **+ New** **`erp-new-menu__col-title`** token colors (**changelog 91**); **Reports** hub **≤900px** toolbar + main-column gap tighten (Rule **1**). |
| **`public/css/board-nav.css`** | Company hub workspace strip: dropdown row borders, shadow, link hover use **`var(--color-*|pill-*|shadow-dropdown)`** with fallbacks; **`body.hub-page`** strip / hovers / hint + **dark hub dropdown** (`.board-nav-dd`) use **`--color-hub-*`** + **`--font-spec-sans`** (**changelogs 70–71**); **`:focus-visible`** on strip controls + dropdown links (**changelog 72**). |
| **`public/css/maint-accounting-ui-2026.css`** | Accounting / AP doc / upload-center chrome; **Upload center** **≤900px** tab + panel + drop padding (**changelog 74**); active upload sub-tab uses **`var(--color-border-focus)`** (**changelog 75**); **`.mr-upload-drop`** surfaces / hover / labels use **`var(--color-*|pill-blue-bg|color-border-focus)`** (**changelog 76**); **`.mr-upload-drop:focus-visible`** ring (**changelog 77**); **`.mr-upload-help`** + **`summary`** tokens + **`summary:focus-visible`** (**changelog 79**); **`.mr-upload-panel-title`** / **`.mr-upload-panel-desc`** / **`.mr-upload-section-h`** text tokens (**changelog 80**); **Connections** **`.mr-upload-conn-card*`** + **`.mr-upload-pill-*`** tokens (**changelog 81**). |
| **`public/css/app-theme.css`** | **`.qbo-sync-alert-bar`** — **`position: sticky`** + **`z-index: 40`**; tier backgrounds/borders use **`var(--pill-*|btn-danger-border|color-border|color-text-primary)`** fallbacks (Rule **21** + Rule **0**); **`.qbo-sync-meta`** muted **`--color-text-label`** fallback; **`.qbo-sync-actions`** **`a` / `button`** **`:focus-visible`** (**changelog 76**). |

### 3.3 HTML pages

| File | Changes |
|------|---------|
| **`public/maintenance.html`** | `design-tokens.css`, `#erpToastHost`, `erp-ui.js`, `showErpToast` → `showToast`, **`erpNotify`** replaces **`alert`**, save split / busy patterns (prior), **accident** + **tire** WO Rule 22 tips; **Topbar** **`.topbar-hint-wrap`**: short lead + **`erp-help-tip`** for rail / search / **+ New** (**changelog 86**); **WO Field help** drawer: service lead + **`erp-help-tip`** for QBO cost lines / invoice lock (**changelog 85**); **`openSection` / `openAccountingTab`** missing-DOM guards + **`erpDocClickCloseNew`** **`closest`** guard + **`loadAll`** **`catch`** → **`applyNavHash()`** (**changelog 84**); **#erpIconNav** **Lists** (**▤**) opens **`#catalog`**; sidebar **`erpSbAdmin`** block titled **Lists & catalogs**; **Lists & catalogs → Service types (DB)** — **`mr-filter-bar`** name filter + **`serviceCatalogAdminPager`** / **`#serviceCatalogAdminPagerHost`** + **`renderServiceCatalogAdmin`**; **shop board** queue tables paginated (**`erpPagerRender`** + **`shopQueuePager`**); **parts** queue tab Rule 22 tip; **Fuel expense** accounting grid paginated (**`fuelExpensePager`**) with off-page **`postFuelExpenseToQbo`** draft/data path for bulk QBO post; **Expense history** log paginated (**`expHistPager`** / **`#expHistPagerHost`**); **Reports → Executive overview** panel title **`erp-help-tip`**; **`#authBanner`** **`erp-auth-banner`**; **`renderReportsAll`** shorter **QBO / sync / IFTA** body copy + label tokens; **Executive overview** timestamp + **TMS** summary / empty / error use **`var(--color-text-label|semantic-error)`**; **`renderRepMaintSpendByUnitTable`** empty state two-line pattern; **Reports → Settlement** load index + line-item tables paginated (**`settlementIndexPager`**, **`settlementLinesPager`**) + Rule 22 intro tips + trip rollup **`mr-filter-bar`** + **`#settlementTmsBox`** token border/background + **Driver pay settlements** title **`erp-help-tip`**; **Accounting → QuickBooks rollback** title **`erp-help-tip`** + compact intro + token sub-head borders; **Accounting → QuickBooks Live Master** title **`erp-help-tip`** + vendor intro shortened + token section borders; **Fuel & DEF** Relay import panel + **fuel ledger** filters **`mr-filter-bar`** + **manual fuel / DEF** document header **`mr-filter-bar`** + **Pay bills** composer + **bill payment log** **`mr-filter-bar`** + **`#maintIntegrationStrip`** / **Lists** subtitle tokens + **expense history** / **AP** QBO banner + **rollback** list scroller + **fleet roster** divider tokens; **Reports → Maintenance spend by unit** paginated (**`repMaintByUnitPager`** / **`#repMaintByUnitPagerHost`**, **`renderRepMaintSpendByUnitTable`**); **Reports → Maintenance detailed** filtered record cards paginated (**`repMaintDetailPager`** / **`#repMaintDetailPagerHost`**); **Saved Maintenance Expense** WO/AP card list (**`apTxnListPager`** / **`#apListPagerHost`**); **Maintenance Table** + **Tracking → Map → Units** pagers (**`maintDashboardTablePager`**, **`trackingListPager`**); **Tracking → All tracked assets** + **Drivers** + **Pay bills → Recent bill payments** (**`trackingAssetsTablePager`**, **`trackingDriversPager`**, **`bpLogPager`** + **`__bpBillPaymentLogAllRows`**); **Safety / HOS** tab (**`safetyHosPager`**, **`safetyActivePager`**, **`safetyInServicePager`**, **`safetyAssignPager`**); **Tracking → Idle** snapshot (**`idleSnapshotPager`**, **`idleSnapshotPager._rows`**, **`renderIdleSnapshotTableBody`**); **+ New** menu rows **A–Z** within each column; **Reports → Maintenance detailed** filters wrapped in **`mr-filter-bar`**; **Home** **System Summary** + **Sync Summary** + **Maintenance → Units** panel titles **`erp-help-tip`**; **`#retiredAssetsWrap`** border **`var(--color-border, …)`** (**changelog 58**); **Maintenance Table** + **Unit History** + **Tracking → Map** (**Units** + **Live map**) titles **`erp-help-tip`** (**changelog 59**); **Imports & uploads** + **Shop** / **Tracking** / **Accounting** / **Settlement** / **Live Master** three-column / **`loadTeamSecurityPanel`** title tips + **Team** panel **`var(--color-border, var(--line))`** borders (**changelog 60**); **Upload center** title row merge + **WO** **Operational status** / **QBO posting header** / **rollback** batch sub-heads / **Safety** active-column tips + token borders on posting dashed rule + **PDF** link (**changelog 61**); **Reports** hub toolbar + **`#acctBoardStrip`** **Accounting board** + **Maintenance** **Workspace snapshot** KPI strips + **`erp-help-tip`** (**changelog 62**); **Tracking** **Fleet mix snapshot** KPI label row + **`erp-help-tip`** (**changelog 63**); **Maintenance detailed** JS borders + **Vendors** cache scrollboxes **`var(--color-border, var(--line))`** (**changelog 62**); **Upload center** **≤900px** chrome (**changelog 74**); **Tracking → Map** **Rename vehicle in Samsara** **`erp-help-tip`** (**changelog 74**); **Rename driver in Samsara** **`erp-help-tip`** (**changelog 75**); **Upload** drop **`tabindex` / `role="button"` / keyboard** + **Safety → HOS** muted lead (**changelog 77**). |
| **`public/dispatch.html`** | Tokens, toast host, `erp-ui.js`, **Lists** nav link to **`/maintenance.html#catalog`**, intro + stops help tips, sidebar **Connections** + **Tips** (**`erp-help-tip`**), `erpWithBusy` / `showToast` on refresh, QBO catalog, save, uploads, PDF, auto miles, row QBO, quick-add, `patchStatus`, escaped `showMsg`, `loadTab(rethrow)` for manual refresh; load-docs list + sidebar **QBO alert** + page `<style>` chrome (**stops**, modal, miles table, buttons) use **`var(--color-*)`**; **`maint-banner`** / **delivered** chip / **stop** & **miles** panels / **autocomplete** / **embed** sep / **`.btn-primary`** use expanded token fallbacks (**changelog 56**). |
| **`public/fuel.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy on key actions, **`erpNotify`**, **`--color-bg-page`** body, **connection strip** + `load` mount; page `<style>` token fallbacks (panels, fleet, badges, roadmap, write-secret banner, relay info, autocomplete); **Selected Unit** title **`erp-help-tip`**; **Diesel purchase** row **`mr-filter-bar`** + **`__grow`** / **`__actions`**. |
| **`public/banking.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy, Rule 22 tips (lead + **step 2** import batch id / dates), **`erpNotify`**, pager on suggestions, **`--color-bg-page`**, **connection strip** + `load` mount; **`#authBanner`** **`erp-auth-banner`** (shared spec CSS, no inline banner colors); **.ph** / default buttons use **`var(--color-bg-header|bg-card)`**; **steps 1 + 3** **`mr-filter-bar`** + **`__grow`** / **`__actions`**; suggest cards use token borders/backgrounds. |
| **`public/settings.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy, **`erpNotify`**, **`--color-bg-page`**, **connection strip** + `load` mount; **`board-nav.css`** + **`#boardNavMount`** / **`board-nav.js`** (same workspace strip as banking / hub); focus + **`.err`** use **`var(--color-border-focus|focus-ring|semantic-error)`**; **Users** + **Employees** titles **`erp-help-tip`**; **Employees** search **`mr-filter-bar`**; primary **`color: var(--color-bg-card)`**. |
| **`public/index.html`** | `design-tokens` (**`--color-hub-*`** dark hub palette — **changelog 68**) before hub `<style>`, `erp-master-spec-2026`, toast host, **`erp-ui.js`** (sync at end for strip), **connection strip**; **Safety** / **Tracking** cards use **`.tag-safety`** / **`.tag-tracking`**; workspace **`pill-*`** / **`btn-info-*`** tag fallbacks + **`var(--shadow-dropdown)`** card hover + **`var(--color-nav-bg)`** body glow + **`var(--color-hub-footer-strong)`** footer **`<strong>`**; **`a.card:focus-visible`** ring (**changelog 73**); **header** **`erp-help-tip`**; **footer** mileage lead + **`erp-help-tip`** (OSRM / PCMiler — **changelog 67**); **`.tag-banking`** for bank card. |

### 3.4 Documentation

| File | Role |
|------|------|
| **`docs/ERP_MASTER_REDESIGN_STATUS.md`** | Rule-by-rule **Done / Partial / Blocked** + numbered change list. |
| **`docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md`** | **This file** — narrative, recommendations, verification (§7 points to post-release checklist). |
| **`docs/ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md`** | **Suggested check items** when redesign is complete / before release (smoke, auth, maintenance, satellites, deferred themes). |
| **`scripts/system-smoke.mjs`** | Non-destructive HTTP smoke: **`HTML_PAGES`** includes **`/tracking.html`** (**`maintenance.html#tracking`** — **changelog 85**); **`/maintenance.html`** asserts **`topbar-hint-wrap`** (**changelog 86**). |
| **`scripts/generate-erp-progress-report.mjs`** | Word-openable **RTF** report from **`ERP_MASTER_REDESIGN_STATUS.md`** → **`docs/reports/ERP_MASTER_REDESIGN_PROGRESS_latest.rtf`**; **`npm run report:erp`** (**changelog 90**). |

---

## 4. Rules 0–24 — current mapping (short)

| Rule | Theme | Status in repo |
|------|--------|------------------|
| **0** | Design tokens | **Partial** — `design-tokens.css` + satellite **`--color-bg-page`** + **`board-nav.css`** token bridges + **QBO sync bar** (maintenance strip + **`.qbo-sync-meta` / `:focus-visible` on actions** — **changelog 76**) + **`#authBanner`** **`erp-auth-banner`** on **maintenance** + **banking**; **accounting** **`#maintIntegrationStrip`** + posting preflight + **Lists & catalogs** subtitle; **`fuel.html`** / **`banking.html`** / **`settings.html`** / **`index.html`** hub / **`dispatch.html`** load-board inline chrome uses **`--color-*`** / **`pill-*`** / **`shadow-dropdown`** where updated; **`index.html`** **`--color-hub-*`** dark hub tokens (**changelog 68**); **`erp-master-spec-2026.css`** **`body.hub-page .erp-help-tip__btn`** uses **`--color-hub-*`** (**changelog 73**); **Upload center** active tab + **drop zone** token surfaces + **drop `focus-visible` / keyboard targets** (**changelogs 75–77**); **`erp-master-spec`** **`.erp-help-tip*`** + **maintenance `mr-filter-chip` `summary`** + **`mr-filter-search` / `mr-filter-inline-select` / `mr-filter-bar .qb-in`** `focus-visible`** + **HOS violation legend pills** (**changelogs 78–80**); **`maint-accounting-ui`** **`.mr-upload-help`** + **upload panel typography** + **Connections** card / pill tokens (**changelogs 79–81**); **`mr-filter-bar .btn` / `button`** **`focus-visible`** maintenance + **`fuel` / `banking` / `settings`** (**changelogs 81–82**); **`board-nav.css`** hub strip + dropdowns **`--color-hub-*`** (**changelogs 70–71**); **`board-nav`** **`:focus-visible`** (**changelog 72**); **`.erp-pager`** borders use **`var(--color-border, var(--line, …))`** on pagers across surfaces (**changelog 63**); **fuel / banking / settings / dispatch** **`board-nav`** **`--font-spec-sans`** + **500** triggers (**changelog 83**); fuel Relay panel (maintenance), **expense history** / **AP** QBO banners, **rollback** scroller, **fleet roster** divider, **settlement** TMS box + rollback sub-heads use **`--color-*`** fallbacks; **reports** generated copy uses **`--color-text-label`** / **`--color-semantic-error`**; full migration of every legacy var not done. |
| **1** | Responsive | **Partial** — maintenance + spec CSS; **Reports** hub toolbar + main gap tighten at **≤900px**; **Upload center** tab + cards + drop zone tighten at **≤900px** (**changelog 74**); full viewport audit **Future**. |
| **2** | App shell | **Partial** — maintenance **`erp-master`** + **Lists** (**▤**) icon opens **`#catalog`**; dispatch + **settings** + hub strips link workspaces; **`index.html`** hub header **`erp-help-tip`**; **`index.html`** hub workspace **`a.card:focus-visible`** (**changelog 73**); **`board-nav.css`** **`body.hub-page`** strip + dropdowns use **`--color-hub-*`** (**changelogs 70–71**); **`erp-master-spec`** **fuel / banking / settings / dispatch** **`board-nav`** **`--font-spec-sans`** + trigger weight **500** (**changelog 83**); **`system-smoke.mjs`** GET **`/index.html`** (**changelog 67**) + **`/tracking.html`** (**changelog 85**); maintenance smoke asserts **`topbar-hint-wrap`** (**changelog 86**); spec copy/dimensions **Future**. |
| **3** | Collapsible sidebar | **Done (pattern)** — `ih35_sb_*` keys. |
| **4** | + New menu | **Partial** — exists; **+ New** column rows **A–Z**; new modal types **Blocked** without product/API intent. |
| **5–9** | Modal shells | **Partial** — QB-style dialogs exist; full spec parity **Future**. |
| **10** | StandardExpenseLines | **Blocked/Future** — no React tree; cost lines live in HTML/JS. |
| **11** | Pay bills | **Partial** — verify “driver bill pay” variant vs spec. |
| **12** | Maintenance layout | **Partial / evolving** — **Lists** shell target + **Service types (DB)** filter/pager in **Lists & catalogs**; **Accounting → QuickBooks rollback** title tip + compact intro; **Tracking** **Fleet mix snapshot** KPI row + **`erp-help-tip`** (**changelog 63**); **Tracking → Map** Samsara vehicle + driver rename rows **`erp-help-tip`** (**changelogs 74–75**). |
| **13** | Accounting board | **Partial** — KPI strip + **`#acctBoardStrip`** **Accounting board** title **`erp-help-tip`** (**changelog 62**); **`#authBanner`** **`erp-auth-banner`** on **maintenance** + **banking**; **QuickBooks Live Master** title **`erp-help-tip`** + token-backed QBO banners in **AP** / **expense history** chrome. |
| **14** | Upload center | **Partial** — tips shipped; sub-tabs **A–Z**; **≤900px** upload chrome (**changelog 74**); **drop zone** token colors (**changelog 76**); **drop targets** keyboard + **`focus-visible`** (**changelog 77**); **`mr-upload-help`** **`summary`** token + **`focus-visible`** (**changelog 79**); **panel title / desc / section** text tokens (**changelog 80**); **Connections** **`.mr-upload-conn-card*`** + **`.mr-upload-pill-*`** (**changelog 81**); manual file QA **Future**. |
| **15** | Filter bar | **Partial** — security alerts + **Lists & catalogs → Service types (DB)** search row + **Reports → Maintenance detailed** + **Reports → Settlement** trip lookup + **Accounting → Fuel expenses** (ledger + manual fuel header) + **Expense history** + **Pay bills** composer + **Recent bill payments** log + **`fuel.html`** diesel purchase + **`banking.html`** snapshot / suggestions + **`settings.html`** employees search **`mr-filter-bar`**; maintenance **`mr-filter-chipwrap`** token + **`summary` `focus-visible`** (**changelog 78**); **`mr-filter-search`** / **`mr-filter-inline-select`** **`focus-visible`** (**changelog 79**); **`mr-filter-bar`** **`.qb-in` / `.in`** **`focus-visible`** (**changelog 80**); **`mr-filter-bar .btn` / `button`** + field **`focus-visible`** on **maintenance** + **`fuel` / `banking` / `settings`** (**changelogs 81–82**); not every table. |
| **16** | Safety / HOS | **Partial** — **HOS clocks** muted intro line (**changelog 77**); **`.mr-violation-legend`** token text + pill dots (**changelog 80**); tables + pagers remain partial vs spec. |
| **17** | Reports | **Partial** — hub toolbar **Reports** title **`erp-help-tip`** (**changelog 62**) + **Executive overview** title **`erp-help-tip`**; **QBO / sync / IFTA** body intros shortened in **`renderReportsAll`**; **TMS** + **spend-by-unit** empty states aligned with headline + muted second line; **Settlement** trip rollup **`mr-filter-bar`** + TMS trip box + **Driver pay settlements** title tip + short body. |
| **18** | QBO GET aliases | **Skipped** — existing catalog routes; thin aliases optional product call. |
| **19** | Toasts | **Done** — `showToast` + styles + hosts; **`erpNotify`** for legacy alerts. |
| **20** | Button loading | **Done (pattern)** — `erpWithBusy` on key flows incl. dispatch rows. |
| **21** | QBO error banner | **Partial** — **`#qboSyncAlertBar`** is **sticky** + token-backed tiers; **`.qbo-sync-actions`** **`:focus-visible`** + maintenance strip **`var(--pill-red-*)`** (**changelog 76**); compare full spec (badge, copy). |
| **22** | “?” tips | **Done (pattern)** + **samples** (incl. **reports** hub toolbar + **Accounting board** + **Maintenance** **Workspace snapshot** — **changelog 62**; **Tracking** **Fleet mix snapshot** — **changelog 63**; **Tracking → Map** Samsara vehicle + driver rename — **changelogs 74–75**; **Safety → HOS clocks** muted lead — **changelog 77**; **`.erp-help-tip*`** default token chrome — **changelog 78**; **reports** settlement, **Executive overview**, shorter **QBO/sync/IFTA** intros, **TMS** + **spend-by-unit** empty two-liners, **rollback** + **driver pay settlements** + **QuickBooks Live Master** titles, **`fuel.html`** **Selected Unit**, **`settings.html`** **Users** / **Employees**, **`banking.html`** CSV step, **`index.html`** hub + **footer** routing — **changelog 67**); many maintenance paragraphs remain. |
| **23** | Pagination | **Partial** — banking/settings + maintenance **shop queues**, **fuel expense**, **expense history**, **saved WO/AP cards**, **Lists & catalogs → Service types (DB)**, **maintenance fleet table**, **Safety / HOS** (HOS table + active / in-service + assignments), **tracking** (map unit cards, assets grid, HOS drivers, **idle snapshot**), **bill payment log**, **reports settlement** (index + load lines), **reports → Maintenance spend by unit**, and **reports → Maintenance detailed** record cards wired; upload center “recent” lists stay capped at 10; other long tables remain. |
| **24** | Connection verification | **Partial** — maintenance sidebar + **new strip** on satellites/index; not universal Samsara+QBO banner everywhere. |

---

## 5. Recommendations (prioritized backlog)

**After the master checklist is done**, revisit **[`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md)** for deferred pagination (e.g. **open bills** + cross-page selection state), remaining **Rule 22** copy, **Rule 24** strip depth, **P2/P3** spec and token sweep items, and post-release verification.

**Assistant audit (code vs recommendations):** P0 and §7 items are **manual or server-dependent** — they are not missing implementations in source. **Deferred** items (open bills pager, driver pay nested pagination, driver files pager, universal second-line connection strip) are **documented as not shipped** until product/architecture decisions. **`ERP_MASTER_REDESIGN_STATUS.md`** now includes a **“Recommendation audit”** table that maps each category to this status.

### P0 — Verify with a running server (keep here)

1. **`node scripts/system-smoke.mjs`** with server up and `localhost` reachable (sandbox often fails fetch — expected). Smoke GETs **`/index.html`**, **`/maintenance.html`**, **`/dispatch.html`**, **`/fuel.html`**, **`/banking.html`**, **`/settings.html`**, **`/tracking.html`** and checks for stable substrings (including **`erpConnectionStrip`** on hub + ERP satellites and the **tracking** redirect target).
2. **Sign-in flows:** settings → banking → maintenance with token; confirm **401** paths still show **`authBanner`** / toasts only where intended.
3. **QBO:** with a connected realm, confirm **`erpMountConnectionStrip`** shows **connected + company**; disconnected shows warn styling.

---

## 6. Known gaps & risks

| Gap / risk | Mitigation |
|------------|------------|
| **`erpNotify` inference** | Heuristic types can mis-classify edge strings; pass explicit **`type`** for new call sites when ambiguous. |
| **Deferred `erp-ui.js` + inline script order** | Pages that call **`erpMountConnectionStrip`** on **`load`** are safe; **`index.html`** uses **sync** `erp-ui.js` at end of body for immediate mount. |
| **Connection strip + unauthenticated users** | **`/api/qbo/status`** should remain non-secret; if it ever returns **401**, strip should degrade gracefully (today: muted “could not load status”). |
| **Maintenance size** | Large single file — refactors should stay **surgical**; prefer extracting **small** shared JS modules only when build pipeline is agreed. |

---

## 7. Verification checklist (manual)

The **canonical expanded** release / sign-off list (environment, auth, maintenance by area, satellites, deferred follow-ups, sign-off block) lives in **[`ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md`](./ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md)**. Use that document for QA before ship.

The bullets that used to live here are **merged and grouped** there (§0–12 plus deferred §11). This section remains as the **pointer** so older links to “§7” still resolve to actionable check items.

---

## 8. Appendix — Read-only endpoints used by new UI

| Endpoint | Use |
|----------|-----|
| **`GET /api/qbo/status`** | `erpMountConnectionStrip` (QBO configured / connected / company name). |

No new write routes were added for this program of work.

---

## 9. Maintainer note

When the **“master instructions list”** changes outside this repo, append deltas under **`docs/`** or extend **`ERP_MASTER_REDESIGN_STATUS.md`** so implementation traceability stays in git history.

**End of report.**
