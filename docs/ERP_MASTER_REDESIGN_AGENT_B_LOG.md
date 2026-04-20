# Agent B — maintenance / accounting / smoke (parallel log)

Agent A merges summarized bullets into `ERP_MASTER_REDESIGN_STATUS.md`; do not edit that file from this track.

---

## 2026-04-17

- **Token sweep (Rule 0):** Removed redundant hex and `var(--line, …)` fallbacks in `public/css/maint-accounting-ui-2026.css` now that `design-tokens.css` + `erp-master-redesign.css` load first; QB / pill / border stacks resolve through `var(--color-*)`, `var(--qb-*)`, and `var(--pill-*)` only.
- `**app-theme.css`:** Normalized shared `var(--color-border, var(--line, …))` / `var(--line-strong, …)` chains to token-first stacks (`var(--color-border)` or `var(--color-border, var(--line-strong))` / `var(--line-strong)` for fills) so maintenance and satellite shells do not re-specify bare hex in those fallbacks.
- **Rule 1 (horizontal bleed):** `public/css/maint-accounting-ui-2026.css` — `#section-accounting` active section and key panel / KPI grid wrappers use `min-width: 0` so dense accounting content stays inside the main column.
- `**maintenance.html`:** Global replace of a small set of inline `style=` token stacks (e.g. `var(--color-text-body,#3c4257)` → `var(--color-text-body)`, legacy `var(--color-border,var(--line,#e2e8f0))` → `var(--color-border)`) wherever those exact patterns appeared (including accounting board strip).
- **Smoke:** `scripts/system-smoke.mjs` — maintenance HTML check now requires stable markers `section-accounting` and `acct-dash-kpis` in addition to existing needles.

**Follow-up (same day):**

- `**app-theme.css`:** Second-pass cleanup — common `var(--color-bg-card, #fff)`, `var(--color-bg-hover, #f8fafc)`, `var(--color-border, #e8eaed)`, `var(--color-border-focus, #1967d2)`, `var(--color-text-primary, #202124)`, catalog card head gradient, and `var(--color-bg-card, var(--panel|bg-elevated, #fff)))` stacks now rely on `design-tokens.css` / legacy `:root` without repeating hex in the outer `var()`.
- `**maintenance.html`:** Broader inline + JS template sweep — `var(--color-text-label,#6b7385)`, ad hoc border hexes on dividers/cards, `var(--color-border,var(--line))`, semantic / pill stacks with redundant fallbacks, and strip-board / settlement / upload / shop-queue adjacent patterns normalized to token-only `var(--color-*)` / `var(--pill-*)`.
- **Rule 1:** `maint-accounting-ui-2026.css` — `#section-reports` and `#section-uploads` active shells, panels, and key layout wrappers get `min-width: 0` (parity with accounting board pass).
- **Smoke:** Maintenance HTML needles extended with `section-uploads` and `erp-reports-shell` so regressions in those large static regions fail the GET check early.

**Files (cumulative this log date):** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`, `docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md` (§9 pointer to this log; former §9 Maintainer note renumbered to §10).

---

## 2026-04-18

- `**app-theme.css`:** Additional token-first cleanup for slate-style stacks (`var(--color-text-body, #334155)`, label grays, `#cbd5e1` / `#e2e8f0` borders → `var(--color-border-input)` / `var(--color-border)`, header grays → `var(--color-bg-header)`) used by maintenance-adjacent panels and tables.
- `**maintenance.html`:** Remaining `var(--color-text-primary,#0f172a)`, shop queue warn accent, pill green, and danger button text stacks normalized to token-only; `**paintQboStatusBanner`** / `**paintApTxnQboBanner`** tier maps now assign `**var(--color-bg-hover)`**, `**var(--pill-*-bg)**`, `**var(--color-*-border-soft)**`, `**var(--btn-danger-border)**` instead of bare hex for fills and strokes.
- **Rule 1:** `maint-accounting-ui-2026.css` — `:is(#section-dashboard, #section-fuel, #section-safety, #section-maintenance, #section-tracking, #section-catalog)` active sections plus `.panel` / `.panel-body` get `**min-width: 0`** so remaining modules match accounting / reports / uploads overflow discipline.
- **Smoke:** Maintenance HTML needles add `**section-maintenance`** and `**section-catalog`** (core shells always present in the static document).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-19

- `**app-theme.css`:** Further token cleanup on maintenance chrome — `var(--color-text-primary, #0f172a)`, modal flow title (navy via `**var(--color-app-frame-border)`**), asset picker hover ring, save-toolbar split focus / pill soft fills, semantic warn/error hints, `**var(--color-app-frame-border, var(--app-frame-border, …))`** inner hex removed, and remaining `**#ffffff**` / `**#2563eb**` / `**#93c5fd**` fallbacks folded to design tokens.
- **Rule 1:** `maint-accounting-ui-2026.css` — `**#section-maintenance .shop-tab-panel`** and nested `**.erp-table-scroll`** use `**min-width: 0`** so `**min-width:980px**` shop tables stay inside the horizontal scroll frame instead of widening the page shell.
- **Smoke:** Maintenance HTML check requires `**shopBoardSubtabs`** (stable shop board anchor next to wide queue tables).
- **CI / docs:** **`.github/workflows/rule0-check.yml`** runs **`npm run qa:isolated`** (Rule 0 + HTTP smoke on an ephemeral **`server.js`**); **`README`**, **`ARCHITECTURE`**, **`FINAL_REPORT`** §P0, **`POST_RELEASE_CHECKLIST`** §0, **`PARALLEL_AGENT`** §8, **`DEFERRED_AFTER_CHECKLIST`** dated note, and **`AGENT_COORDINATION`** aligned. **`npm test`** remains **`rule0:check`** for offline-only runs.
- **Server (smoke/CI hygiene):** **`hasSamsaraReadToken()`**, **`fetchSamsaraDriverVehicleAssignmentsWindow`**, and early returns in **`fetchVehiclesSafely`** / **`fetchVehicleStatsCurrentSafely`** / **`fetchAllSamsaraHosClocks`** avoid Samsara HTTP and log noise when **`SAMSARA_API_TOKEN`** is unset (fresh clone / Actions).
- **Log hygiene:** Older dated entries in this file (**§2026-05-20**, **§2026-05-23**) that describe GitHub Actions as **`rule0:check`** / **`npm test`** only are **obsolete** — use the **CI / docs** bullet above.
- **Tooling:** **`scripts/qa-with-server.mjs`** sets **`SMOKE_QUIET=1`** for the smoke child when **`CI=true`** (shorter Actions logs); **`README`** CI paragraph notes this. **`scripts/rule-zero-agent-b-check.mjs`** prints one **`rule0:check OK (N files)`** summary instead of per-file OK lines when **`CI=true`** or **`RULE0_QUIET=1`**.
- **CI workflow:** **`.github/workflows/rule0-check.yml`** — **`permissions: contents: read`**, **`concurrency`** (cancel in-progress runs per ref), **`timeout-minutes: 15`** on the job.
- **Dependencies:** Replaced unmaintained npm **`xlsx`** with **`@e965/xlsx@^0.20.3`** (SheetJS-compatible); **`server.js`** import updated; **`npm audit`** reports **0** vulnerabilities with the current lockfile.
- **Dependencies (pdfkit):** Bumped **`pdfkit`** to **`^0.18.0`** (from **0.15.x**) so installs no longer pull deprecated transitive **`jpeg-exif`**; **`routes/pdf.mjs`** uses the same **`PDFDocument`** API — manual PDF spot-check recommended after release.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/rule-zero-agent-b-check.mjs`, `scripts/system-smoke.mjs`, `scripts/qa-with-server.mjs`, `server.js`, `package.json`, `package-lock.json`, `.github/workflows/rule0-check.yml`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md`, `docs/ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md`, `docs/ERP_MASTER_REDESIGN_PARALLEL_AGENT.md`, `docs/ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`, `docs/AGENT_COORDINATION.md`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-20

- `**app-theme.css`:** Cleared more maintenance-only hex fallbacks — warning/success soft borders, semantic warn accent / warning accents, `**stroke: var(--muted, …)`** / `**fill: var(--accent|nav-bg, …)`**, `**var(--accent, #1d4ed8)`** in mixes, semantic success in `**color-mix**`, hero/panel gradients using `**#e8eef9` / `#eef2f9**`, `**var(--color-nav-bg, var(--app-frame-border, …))**` inner hex, and settlement table header gradient now uses `**var(--color-nav-bg)**` + `**color-mix(…, black)**` instead of literal navy stops; settlement `**th**` bottom border uses `**var(--sidebar-bg)**` without a hex fallback.
- **Rule 1:** `maint-accounting-ui-2026.css` — `**#section-accounting .maint-qb-lines-scroll`** gets `**min-width: 0`** so wide QB line tables stay inside the doc’s horizontal scroll region under flex layout.
- **Smoke:** Maintenance HTML needles include `**id="erpApp"`** so the master shell root cannot disappear without failing the static GET check.
- **Smoke (follow-up):** **`GET /api/pdf/__smoke__`** (auth-exempt in **`server.js`**) — **200**, **`application/pdf`**, **`%PDF`** magic (**`pdfkit`**); replaces probing **`/api/pdf/shop-queue`** so agents/CI stay green when ERP login is required. Documented in **`README`**, **`ARCHITECTURE`**, **`AGENT_COORDINATION`**.
- **Smoke gate + auth:** **`scripts/qa-with-server.mjs`** sets **`IH35_SMOKE_GATE=1`** on the ephemeral **`server.js`**; **`server.js`** **`SMOKE_GATE_API_PATHS`** matches **`system-smoke.mjs`** **`CRITICAL`** JSON GETs so **`npm run qa:isolated`** stays green when users exist / **`IH35_REQUIRE_AUTH=1`**. Do not set **`IH35_SMOKE_GATE`** on production listeners.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `README.md`, `docs/ARCHITECTURE.md`, `docs/AGENT_COORDINATION.md`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-21

- `**app-theme.css`:** QBO sync bar, sidebar / nav dropdown, `**qb-btn-primary`**, and related stacks now use token-only `**var(--btn-danger-border)`**, `**var(--pill-*)**`, `**var(--sidebar-border|nav-hover|nav-text|sidebar-text)**`, `**var(--btn-info-border)**`, and `**var(--btn-primary-save-*)**` (hex fallbacks removed). `**.cost-total-bad**` drops the redundant raw `**#f87171**` border in favor of the existing semantic `**color-mix**` border. `**.st-settlement-wrap**` uses `**min-width: 0**`, `**border: 1px solid var(--color-border)**`, and keeps overflow clipping for settlement tables inside flex columns.
- **Smoke:** Maintenance static HTML check now also requires `**section-dashboard`** and `**section-fuel`** alongside the existing section markers.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-22

- `**app-theme.css`:** Dispatch `**banner.err`**, maintenance `**.sec-alert-*`**, save-toolbar `**.qb-split--primary|neutral**`, and sidebar copy still using hex fallbacks (`**#fecaca**`, `**#f8fafc**`, `**#15803d**`, `**#94a3b8**`, `**#dc2626**`, `**#2563eb**`) now rely on `**var(--btn-danger-border)**`, `**var(--sidebar-text|muted)**`, `**var(--btn-primary-save-bg)**`, `**var(--pill-red-text|pill-blue-text)**` only. `**var(--color-bg-card, var(--panel))**` simplified to `**var(--color-bg-card)**` wherever that pair appeared. `**.qb-split--primary .qb-split__main**` green gradient uses `**var(--btn-primary-save-bg)` → `var(--btn-primary-save-hover)**` instead of raw Tailwind-style hex stops.
- **Rule 1:** `**body.erp-maintenance .maint-save-toolbar--qb`** gains `**min-width: 0`** so the save/post strip can shrink inside narrow WO / modal columns without forcing horizontal overflow.
- **Smoke:** Maintenance HTML needles add `**section-safety`** and `**section-tracking`** (ops sections always present in the static shell).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-23

- `**app-theme.css`:** Company `**.hub-page`** drops the redundant legacy radial + `**#0c1220`** base layer; hub `**color-mix`** / text now use `**var(--color-hub-accent|hub-card|hub-text|hub-bg-deep)**` without hex fallbacks. `**.cost-total-bad**` border `**color-mix**` uses `**var(--color-bg-card)**` instead of `**#ffffff**`. QB split **primary `.qb-split__caret`** gradient aligns with `**var(--btn-primary-save-bg)` / `var(--btn-primary-save-hover)**`. Print `**@media**` block no longer declares a raw `**#fff**` background before the token line.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#section-maintenance .maint-page-shell`** adds `**min-width: 0`** alongside `**min-height: 0**` for flex shrink in the WO workspace.
- **Smoke:** Maintenance HTML needles include `**maint-action-strip`**.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-24

- `**maintenance.html`:** Sidebar QuickBooks / desktop-notification and sync-alert brief text colors now use `**var(--color-success-border-soft)`**, `**var(--pill-red-text)`**, and `**var(--color-warning-border-soft)**` instead of raw Tailwind-style hex. Tracking map `**L.circleMarker**` stroke/fill read `**--color-border-focus**`, `**--color-hub-accent**`, and `**--color-text-label**` from `**getComputedStyle(document.documentElement)**` so markers follow `**design-tokens.css**` while keeping safe string fallbacks if a token is missing.
- **Smoke:** Maintenance HTML needles add `**maint-page-shell`** (WO workspace root next to the action strip).

**Files:** `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-25

- `**maintenance.html`:** `**ERP_WRENCH_ICON`** / `**ERP_PUMP_ICON`** inline SVG paths use `**fill="var(--pill-green-text)"`** and `**fill="var(--color-border-focus)"**` instead of hard-coded greens/blues.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**body.erp-maintenance #erpApp.erp-master .erp-main-col`** gets `**min-width: 0`** as a defensive flex shrink hook (harmless if `**erp-master-spec**` already sets it).
- **Smoke:** Maintenance HTML needles add `**id="erpToastHost"`** and `**id="qboSyncAlertBar"`** so toast host + QBO sync strip cannot be removed without failing the static GET check.

**Files:** `public/maintenance.html`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-26

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .main.erp-main-surface`** and `**.erp-main-body`** now include `**min-width: 0**` alongside `**.erp-main-col**`, so the topbar + scroll column stack cannot force the master shell wider than the viewport under nested flex/grid content.
- **Smoke:** Maintenance HTML check requires `**id="acctBoardStrip"`** (accounting board strip anchor next to `**acct-dash-kpis`**).

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-27

- `**app-theme.css`:** `**.erp-drawer`** scroll column — `**erp-drawer__body`** is now `**flex: 1 1 auto`** with `**min-height: 0**` so long create-menu / injected form content scrolls inside the drawer instead of stretching past the fixed `**100vh**` shell (drawer is maintenance-only in this repo’s HTML shells).
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .erp-topbar__search-inner`** gets `**min-width: 0`** so the global search field can shrink next to dense `**erp-topbar__actions**` on narrow widths.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-28

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp .erp-new-menu__cols`** gets `**min-width: 0`** so the three-column **+ New** flyout flex row respects the menu’s `**min(…vw, 860px)`** cap without forcing extra horizontal overflow.
- **Smoke:** `**scripts/system-smoke.mjs`** — after HTML page checks, `**oneStatic()`** GETs `**/css/maint-accounting-ui-2026.css`** and `**/css/app-theme.css**` and asserts stable header substrings (`**Maintenance center action strip**`, `**IH35 — shared visual language**`) so a broken `public/` mount fails CI before paint.

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-29

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**maint-action-strip`** / `**maint-action-strip__qbo`** get `**min-width: 0**` so the WO maintenance shell’s flex column does not inherit an implicit min-content width from long QBO copy or many strip buttons. `**#erpApp.erp-master .erp-topbar__search**` and `**.erp-topbar__actions**` also get `**min-width: 0**` (after `**erp-topbar__search-inner**`) so the ERP master top bar can narrow below the redesign search floor when the main column is tight.
- **Rule 0:** `**maint-accounting-ui-2026.css`** — active strip button ring uses `**color-mix`** on `**--color-border-focus`** instead of a hard-coded blue `**rgba**`. `**app-theme.css**` — maintenance form control focus halo uses the same token-driven `**color-mix**` pattern.

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-30

- **Rule 0:** `**maint-accounting-ui-2026.css`** — `**.erp-toast`** uses `**var(--shadow-toast)`** from `**design-tokens.css**` instead of a bespoke `**rgba**` stack. `**.maint-form-actions--sticky**` edge lift uses `**color-mix**` on `**--color-text-primary**` instead of neutral black `**rgba**`.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — toast cards cap width with `**min(400px, calc(100vw - 32px))`** and allow a shrinking floor with `**min(280px, calc(100vw - 32px))`** on `**min-width**`, so fixed toasts do not force horizontal overflow on narrow phones.
- `**app-theme.css**` — `**.cost-total-ok**` / `**.cost-total-bad**` drop the dead first `**box-shadow**` declaration (keep token `**color-mix**` rings only).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-01

- `**app-theme.css`:** Removed dead “first `**box-shadow`** / `**background`**” duplicates where a second line already applied `**var(--shadow-drawer)`**, `**var(--color-modal-backdrop)**`, `**var(--shadow-dropdown)**` (`.erp-drawer`, `.erp-drawer__backdrop`, maintenance `**.nav-dropdown-menu**`, `**.maint-modal-bg**`, `**.maint-save-toolbar--qb .qb-split__menu**`).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** now GETs `**/css/design-tokens.css`** and asserts the stable header line `**IH35 ERP — Master spec design tokens (Rule 0).**` so a missing or truncated token file fails CI alongside theme and maintenance CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-02

- `**app-theme.css` (Rule 0):** Dropped shadow/background/border “first line” duplicates that were always overridden — `**.hub-page .grid a.card`** (+ `**:hover`**), `**.qb-picker-menu`**, maintenance sidebar `**.nav-btn:hover**` / `**.active**`, `**.nav-dd-item:hover**`, and `**.maint-board-nav__btn:hover**`. Each rule now keeps a single token-driven `**color-mix**` or `**var(--shadow-dropdown, …)**` declaration.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-03

- `**app-theme.css` (Rule 0):** `**.maint-wo-banner`** hairline shadow uses `**color-mix`** on `**--color-text-primary`** instead of slate `**rgba**`. `**.maint-save-toolbar--qb .qb-split__caret**` uses a single `**border-left**` with `**color-mix**` on `**--color-bg-card**` instead of `**rgba(255,255,255,…)**` plus a second `**border-left-color**` override.
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** includes `**/css/board-nav.css`** with needle `**Persistent operations bar**` (matches `**board-nav.css**` header comment).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-04

- **Rule 1:** `**app-theme.css`** — `**.qbo-sync-alert-bar .qbo-sync-actions`** and `**body.erp-maintenance .maint-top-toolbar__inner`** get `**min-width: 0**` so wrapped flex rows do not widen parent shells from intrinsic min-content.
- **Rule 0:** `**app-theme.css`** — `**.qbo-sync-alert-bar .qbo-sync-meta`** uses `**var(--color-text-label)`** (banner is maintenance-only; `**design-tokens.css**` is always loaded there).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneStatic()`** accepts an optional `**Accept`** header; `**STATIC_TEXT**` adds `**/js/erp-ui.js**` with needle `**IH35 ERP — shared UI helpers**` and a broad `**Accept**` value so a missing `**public/js**` mount fails CI alongside CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-05

- **Rule 1:** `**app-theme.css`** — legacy maintenance shell `**.app`** (sidebar + main grid) gets `**min-width: 0`** so the page can shrink inside nested viewports without the grid’s default min-content floor forcing horizontal scroll. `**sidebar-brand-row**` and `**.topbar**` get `**min-width: 0**` so dense sidebar chrome and classic topbars cooperate with `**flex-wrap**` without widening the column.
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** adds `**/js/board-nav.js`** with stable substring `**Fuel & route planning**` (first board entry in that bundle).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-06

- **Rule 1:** `**app-theme.css`** — legacy maintenance `**.split`** uses `**minmax(0, 1fr)`** for the fluid column (was plain `**1fr**`) plus `**min-width: 0**` on the grid so the list + detail pattern cannot force extra horizontal overflow. `**hero-grid**`, `**.toolbar**`, `**.search-row**`, and `**.unit-summary**` grids get `**min-width: 0**` so `**minmax(0, 1fr)**` tracks can actually shrink inside narrow shells.
- **Rule 0:** `**app-theme.css`** — `**body.erp-maintenance .list-sub`** reads `**var(--color-text-label)`** only (maintenance loads `**design-tokens.css**`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-07

- **Rule 1:** `**app-theme.css`** — legacy maintenance `**.grid`**, `**.panel-head`**, and `**.chips**` get `**min-width: 0**` so nested `**minmax(0, 1fr)**` grids and chip rows do not inherit min-content width from flex/grid parents.
- **Rule 0:** `**app-theme.css`** — under `**body.erp-maintenance`**, drop redundant `**var(--muted)`** / legacy accent fallbacks where `**design-tokens.css**` already defines the stack (`**.hero-card p**`, `**.metric-label**`, `**.table-wrap th**`, general `**th**`, `**.unit-box .k**`, `**.chip.active**`, `**.list-row.active**`) and use `**var(--color-app-frame-border)**` alone on `**.panel-head**` (same maintenance-only assumption).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-08

- **Rule 0:** `**app-theme.css`** — legacy maintenance chrome: `**.title`**, default `**.btn` / `button` / `input` / `select` / `textarea`** text colors use spec tokens only (`**--color-text-primary**`, `**--color-text-body**`). Button hover border uses `**--color-border-input**` (replacing `**--color-border` + `--line-strong**`). `**.status-***` pills use `**--pill-***` tokens only. `**.mini-note**` uses `**--color-text-label**`. `**.record-card:hover**` border uses `**--color-border-input**` for a slightly stronger edge than the resting card border.
- **Rule 1:** `**app-theme.css`** — `**form-stack`**, `**card-list`**, `**record-head**`, and `**subtabs**` get `**min-width: 0**` so dashboard cards and subtabs do not widen the main column from intrinsic min-width.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-09

- **Rule 1:** `**app-theme.css`** — WO / tracking / tires: `**.tire-layout-wrap`** and `**.track-grid`** use `**minmax(0, 1fr)**` for the fluid column plus `**min-width: 0**` where missing; `**.track-list**`, `**.maint-form-stack**`, `**.maint-expense-strip**`, `**.shop-queue-row**`, `**.maint-board-nav**`, `**.maint-repair-chip-row**`, `**.vendor-row-maint**`, `**.shop-action-row**`, `**.shop-board-grid**`, `**.wo-line-grid**`, `**.maint-cost-line__primary**`, `**.maint-cost-lines-head` / `-footer**`, `**.maint-form-actions__row**`, `**.maint-asset-header-card**` (+ `**__row**`) get `**min-width: 0**` as needed. `**.maint-wo-banner__refs**` drops the `**min(100%, 360px)**` floor in favor of `**0**` so the banner flex row can shrink on narrow widths. QB doc chrome (`**.qb-doc-title-row**`, `**.qb-logistics-bar**`, `**.qb-lines-header**`, `**.qb-doc-actions**`, `**.qb-doc-memo-row**`) gets the same overflow discipline.
- **Rule 0:** `**app-theme.css`** — broad `**body.erp-maintenance`** sweep: borders that chained `**--color-border` + `--line-strong`** or `**--color-app-frame-border` + `--app-frame-border**` now use the spec token alone; label/body text drops `**var(--muted)` / `var(--text)` / `var(--text-secondary)**` fallbacks in favor of `**--color-text-label**` / `**--color-text-body**`; `**--color-bg-card**` replaces `**--bg-elevated**` on KPI cards; board nav active state uses `**--color-nav-bg**` consistently.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-10

- **Rule 0:** `**app-theme.css`** — repo-wide cleanup of redundant `**var(--color-text-label, var(--muted))`**, `**var(--color-text-body, var(--text|text-secondary))`**, `**var(--color-text-primary, var(--text))**`, `**var(--color-bg-card, var(--bg-elevated))**`, and `**var(--color-nav-bg, var(--sidebar-bg))**` now use the outer design-token names only (every HTML shell that loads `**app-theme.css**` already loads `**design-tokens.css**`). `**maint-field--readonly**` and dispatch tab chrome were fixed where `**!important**` or `**text-secondary**` prevented the earlier bulk replace.
- **Rule 1:** `**body.erp-maintenance`** — `**maint-board-layout`**, `**maint-wo-workspace-grid`**, `**maint-form-grid**`, and `**maint-vendor-ref-row**` gain `**min-width: 0**` so board / WO / vendor rows cooperate with `**minmax(0, …)**` tracks and flex shrink without widening the page.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-11

- **Rule 0:** `**app-theme.css`** — Restored the text-token sweep where stacks had reappeared; also dropped legacy second hops on `**--color-border`** / `**--line-strong`**, `**--color-bg-page**` / `**--bg**`, `**--color-app-frame-border**` / `**--app-frame-border**`, `**--color-border-focus**` / `**--accent**`, and `**--color-modal-backdrop**` / raw `**rgba(...)**` so values resolve through `**design-tokens.css**` only.
- **Rule 1:** `**body.erp-maintenance .maint-form-grid__row`** — `**min-width: 0`** on the row grid so `**minmax(0, 1fr)`** columns in `**maint-form-grid__row--3**` can shrink inside narrow shells.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-12

- **Rule 0:** `**maintenance.html`** — Inline styles, template literals, and small JS style maps now use token-only `**var(--color-text-label)`**, `**var(--color-text-body)`**, `**var(--color-text-primary)**`, `**var(--color-border)**`, `**var(--color-bg-card)**`, `**var(--color-bg-header)**`, and `**var(--color-bg-hover)**` (removed `**var(--muted)` / `var(--text)` / `var(--line)` / `var(--panel)**` hops and redundant hex on `**--color-bg-header**` / `**--color-bg-hover**`).
- **Rule 0:** `**app-theme.css`** — Full Rule 0 pass on the shared sheet: `**var(--color-border, var(--line))`**, `**var(--color-bg-card, var(--panel))`**, `**var(--color-bg-page, var(--bg))**`, `**var(--color-bg-header|hover, #…)**`, text stacks (`**--muted` / `--text` / `--text-secondary**`), `**var(--color-nav-bg, #16213e)**`, and the WO banner `**color-mix**` hairline now resolve through `**design-tokens.css**` names only; file header comment updated to match (no redundant `**var(--color-foo, var(--legacy))**` guidance).

**Files:** `public/maintenance.html`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-13

- **Rule 0:** `**public/maintenance.html`** — Re-normalized inline / template / JS string styles after stack regressions: `**--color-text-*`**, `**--color-border`**, `**--color-bg-card**`, `**--color-bg-header**`, `**--color-bg-hover**` use token names only (no `**var(--muted)` / `var(--text)` / `var(--line)` / `var(--panel)**` or redundant hex).
- **Rule 0:** `**public/css/maint-accounting-ui-2026.css`** — Accounting action strip, board chrome, QB panels, and related selectors now use `**var(--color-border)`**, `**var(--color-bg-card)`**, `**var(--color-bg-page)**`, `**var(--color-text-label|body|primary)**`, `**var(--color-bg-hover|header)**` only (same patterns as the shared theme sheet).
- **Rule 0:** `**public/css/app-theme.css`** — `**var(--color-nav-bg, #16213e)`** → `**var(--color-nav-bg)`**; file comment no longer references Agent A status docs or recommends a hex fallback stack for nav.

**Files:** `public/maintenance.html`, `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-14

- **Rule 0:** `**app-theme.css`** — Large regression sweep: removed `**var(--color-*, var(--line|panel|bg|text|muted|accent|app-frame-border))`** chains, `**--color-bg-header|hover` + hex**, `**--color-nav-bg` + hex**, hub (`**--color-hub-*` + hex**), semantic + soft-border (`**--color-semantic-*`**, `**--color-*-border-soft` + hex**), `**--color-modal-backdrop` + rgba**, and text stacks; `**maint-wo-banner`** hairline `**color-mix`** uses `**var(--color-text-primary)`** only. File header now states Rule 0 without referencing Agent A status docs.
- **Rule 0:** `**maint-accounting-ui-2026.css`** — Same token-only treatment: borders, surfaces, page background, text, focus (`**--color-border-focus`**), and header/hover backgrounds align with `**design-tokens.css`** (no legacy `**--line` / `--panel` / `--bg` / `--accent**` hops).
- `**maintenance.html`:** Verified clean (no `**var(--color-*, var(--…))`** regressions in the current tree).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-15

- **Rule 0 / hygiene:** `**app-theme.css`** — Header comment refreshed again: no embedded example legacy stacks, no Agent A doc pointer; references `**design-tokens.css`** and the smoke Rule 0 guard.
- **Smoke:** `**scripts/system-smoke.mjs`** — After static CSS needle checks, a Rule 0 guard GETs `**app-theme.css`** and `**maint-accounting-ui-2026.css`** and fails if forbidden substring regressions appear (common `**var(--color-*, var(...))**` merges).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-16

- **Rule 0:** `**maintenance.html`** — Token-only pass on inline / template / script strings (`**--color-text-*`**, `**--color-border`**, `**--color-bg-card**`, `**--color-bg-header**`, `**--color-bg-hover**`) and link / SVG accents (`**var(--color-border-focus)**` without `**var(--accent)**`).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneRuleZeroGuard(path, accept)`** runs after static needles; `**RULE0_GUARD_FETCHES`** includes `**/maintenance.html**`. `**RULE0_FORBIDDEN_SUBSTRINGS**` adds compact comma forms, common `**--color-*` + `#**` prefixes, `**var(--color-modal-backdrop, rgba**`, and the prior `**var(--color-*, var(...))**` list.

**Files:** `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-17

- **Smoke:** `**scripts/system-smoke.mjs`** — `**RULE0_FORBIDDEN_SUBSTRINGS`** adds compact forms without spaces after commas (`**var(--color-border,var(--line))`**, `**var(--color-text-primary,var(--text))**`, etc.). Successful `**STATIC_TEXT**` responses cache `**bodyText**` so `**oneRuleZeroGuard**` reuses bytes for `**app-theme.css**` and `**maint-accounting-ui-2026.css**` (one fewer HTTP GET each). Extracted `**ruleZeroForbiddenHits(text)**` for clarity.

**Files:** `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-18

- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneHtml`** now returns `**bodyText`**; when `**/maintenance.html**` passes its needle list, that body is stored in `**ruleZeroBodyCache**` so `**oneRuleZeroGuard**` does not fetch maintenance again (third cached guard line). `**RULE0_FORBIDDEN_SUBSTRINGS**` adds `**var(--color-text-body,var(--text-secondary))**`.

**Files:** `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-19

- **Smoke / tooling:** Shared list `**scripts/rule-zero-agent-b.mjs`** exports `**RULE0_FORBIDDEN_SUBSTRINGS`** and `**ruleZeroForbiddenHits`**, imported by `**system-smoke.mjs**` so HTTP and disk checks stay aligned. New forbidden entries: `**var(--color-bg-card, var(--bg-elevated))**` (compact + spaced) and `**var(--color-nav-bg, var(--sidebar-bg))**` (compact + spaced).
- **Offline CI:** `**scripts/rule-zero-agent-b-check.mjs`** reads `**public/css/app-theme.css`**, `**public/css/maint-accounting-ui-2026.css`**, and `**public/maintenance.html**` from the repo and exits `**1**` on any hit — run via `**npm run rule0:check**` without `**npm start**`.

**Files:** `scripts/rule-zero-agent-b.mjs`, `scripts/rule-zero-agent-b-check.mjs`, `scripts/system-smoke.mjs`, `package.json`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-20

- **CI:** `**.github/workflows/rule0-check.yml`** — Runs `**npm run rule0:check`** on `**push` / `pull_request`** (Ubuntu, Node 20); no `**npm ci**` so the job stays fast and dependency-free. *(Push trigger broadened to all branches on 2026-05-21.)*
- **Docs in CSS:** `**app-theme.css`** file header now points maintainers at `**rule0:check`**, HTTP smoke, and `**scripts/rule-zero-agent-b.mjs*`* as the shared forbidden list.

**Files:** `.github/workflows/rule0-check.yml`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-21

- **CI:** `**.github/workflows/rule0-check.yml`** — `**push`** now runs on **all branches** (not only `**main` / `master`**), so feature-branch commits get the same Rule 0 scan; `**pull_request`** unchanged.
- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-semantic-{success,error,warning,warn-accent}, #`** prefixes (duplicate hex after semantic tokens; values belong in `**design-tokens.css`** only).

**Files:** `.github/workflows/rule0-check.yml`, `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-22

- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-success-border-soft, #`** / `**var(--color-warning-border-soft, #`** and hub token `**var(--color-hub-{accent,bg-deep,text,card}, #**` (duplicate hex; hub + soft borders live in `**design-tokens.css**` only).
- **Log hygiene:** `**## 2026-05-20`** CI bullet clarified (push filter note points at **2026-05-21**).

**Files:** `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-23

- `**package.json`:** `**npm test`** runs `**npm run rule0:check`** so generic CI / local `**npm test`** hits the Agent B disk guard without a server.
- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-bg-page|bg-card, #`** and `**var(--color-text-primary|body|label, #`** (hex chained after `**--color-***` ink/surface roles).
- **CI:** `**.github/workflows/rule0-check.yml`** — `**workflow_dispatch`** for manual runs from the Actions tab; job step invokes `**npm test`** (same as `**rule0:check**`).

**Files:** `package.json`, `scripts/rule-zero-agent-b.mjs`, `.github/workflows/rule0-check.yml`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-17

- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Mirror `**, #`** / `**, rgba`** forbidden entries with **no space after the comma** (e.g. `**var(--color-bg-page,#`**, `**var(--color-modal-backdrop,rgba`**) so minified or hand-tightened CSS cannot bypass the guard.
- **Log hygiene:** Removed duplicate `**## 2026-05-23`** block (same bullets appeared twice).

**Files:** `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-18

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0`** on `**acct-dash-kpi`**, `**acct-dash-card**`, `**mr-upload-conn-card**` (children of `**repeat(auto-fit, minmax(…, 1fr))**` grids) and on `**maint-qb-cost-details__sum**` (flex summary row) so long labels / numeric copy can shrink inside the column instead of forcing page-level horizontal scroll.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-19

- **Rule 1:** `**public/css/app-theme.css`** — `**qb-picker-item__label`** gets `**min-width: 0`** plus `**overflow: hidden**` / `**text-overflow: ellipsis**` so long vendor or account names do not widen the QB combobox row past the menu; `**body.erp-maintenance .title**` gets `**min-width: 0**` so the topbar flex row can shrink on narrow widths.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**erp-topbar .title`** and `**maint-wo-form-stack-inner`** get `**min-width: 0**` (compact accounting topbar + WO form stack shrink with the shell).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-20

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**maint-wo-columns`** and `**maint-fleet-inline`** get `**min-width: 0**` so the WO workspace row and inline fleet controls can shrink inside the maintenance shell without forcing horizontal overflow.
- **Rule 1:** `**public/css/app-theme.css`** — `**erp-drawer`** gets `**min-width: 0`**; `**erp-drawer__head**` gets `**min-width: 0**`; `**erp-drawer__title**` gets `**min-width: 0**` with ellipsis so long “Add new” titles stay inside the drawer chrome beside the close control.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-21

- **Rule 1:** `**public/css/app-theme.css`** — `**erp-drawer__body`** gets `**min-width: 0`** so the scrollable drawer column respects flex shrink; `**body.erp-maintenance .panel-title**` gets `**min-width: 0**` so long panel headings cooperate with `**panel-head**` flex / wrap instead of widening the row.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**mr-upload-panel-card`** gets `**min-width: 0`** so upload-center cards stay within narrow viewports when stacked beside other columns.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-22

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**maint-kpi-card`** (compact KPI grid cells), `**maint-aside-kv**` (WO aside key/value flex rows), and `**maint-form-actions__meta**` (footer meta flex row) so dense maintenance chrome can shrink inside `**minmax(0, 1fr)**` / flex parents without widening the viewport.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-23

- **Rule 1 (grid tracks):** `**public/css/app-theme.css`** — Maintenance shell `**grid-template-columns: 260px 1fr`** → `**260px minmax(0, 1fr)`**; WO / QB line grids and header use `**minmax(0, 1.3fr)**` / `**minmax(0, 1.1fr)**` instead of bare `**fr**` so fractional columns respect `**min-width: 0**` semantics; `**qb-doc-memo-row**` uses `**minmax(0, 1fr)**` pair; large-viewport `**#woLines .wo-line-grid**` override and **print** `**.app`** column updated the same way.
- **Rule 1 (flex + items):** `**qb-lines-actions`**, `**qb-doc-actions`** child flex groups, `**list**`, `**hero-card**`, and narrow (`**max-width: 800px**`) single-column dashboard grids use `**min-width: 0**` or `**minmax(0, 1fr)**` so list shells and doc chrome do not widen the main column.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-24

- **Rule 1 (responsive / print grids):** `**public/css/app-theme.css`** — Normalized remaining maintenance `**grid-template-columns: 1fr`**, `**1fr 1fr`**, and `**1fr !important**` declarations inside `**@media**` and print rules to `**minmax(0, 1fr)**` (or paired `**minmax(0, 1fr) minmax(0, 1fr)`**) so collapsed layouts (WO form rows, board layout, shop kanban, fuel import split, print WO, etc.) inherit the same minimum track semantics as the primary `**minmax(0, …)`** grids.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-25

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — In the `**max-width: 900px`** accounting block (includes QBO Live Master `**#acct-qbo`** stack rules), `**grid-template-columns: 1fr**` for the stacked `**.grid-3**` (panels) and `**.search-row**` now uses `**minmax(0, 1fr)**`, matching the `**app-theme.css**` responsive grid convention.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-26

- **Rule 1 (auto-fit / auto-fill grids):** Replaced `**minmax(<px>, 1fr)`** with `**minmax(min(100%, <px>), minmax(0, 1fr))`** on maintenance accounting KPI/cards grids, upload connection grid, maintenance hero and expense strips, QB logistics bar, and global `**.vendor-link-grid`** so track minimums cap at the container width and `**fr**` tracks can shrink without forcing horizontal overflow.
- `**public/css/maint-accounting-ui-2026.css**` — `**acct-dash-kpis**`, `**acct-dash-cards**`, and `**mr-upload-conn-grid**` also get `**min-width: 0**` on the grid host where missing.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-27

- **Rule 1:** `**public/css/app-theme.css`** — `**#woLines .wo-line-grid`** auto-fill override now ends with `**minmax(0, 1fr)`** (was trailing `**1fr**`). `**maint-cost-lines-head**`, `**maint-cost-line__primary**`, and the `**max-width: 1100px**` shared override use `**minmax(min(100%, …), minmax(0, 1fr))**` (and `**minmax(0, 2.2fr)**` for the description column) so cost-line grids behave like the other hardened maintenance tracks on narrow widths.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-28

- **Rule 1:** `**public/maintenance.html`** — Inline flex hosts (`**#acctBoardStrip`** header row, `**#apTxnQboBanner**`, `**#expHistQboBanner**`) get `**min-width: 0**` so title + help tips / banner rows shrink inside the accounting column.
- `**paintQboStatusBanner**` / `**paintApTxnQboBanner**` set `**el.style.minWidth = '0'**` when showing a banner so scripted `**display**` toggles keep the same shrink behavior as CSS.

**Files:** `public/maintenance.html`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-29

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acctBoardStrip`** / `**.mr-acct-board**` and `**.mr-filter-bar__grow**` get `**min-width: 0**` so accounting board chrome and filter rows (including inline `**display:flex**` blocks) shrink inside the main column without relying on each inline style.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-30

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0`** on `**maint-qbo-header-grid**`, `**#erpConnectionStrip**`, `**erp-topbar__actions**`, `**shop-wo-fallback**`, `**erp-reports-toolbar__actions**`, and `**mr-qbo-banner__right**` where they carry `**print-hide-actions**` (or the QBO header helper) so connection strip, shop fallbacks, and toolbar action clusters participate in flex/grid shrink on narrow viewports.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-01

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**mr-filter-bar`**, `**mr-filter-bar__right**`, `**mr-filter-bar__chips**`, and `**mr-filter-bar__show**` get `**min-width: 0**` so ops / fleet / security filter rows shrink beside `**mr-filter-bar__grow**` on narrow widths.
- **Rule 1:** `**public/css/app-theme.css`** — `**qb-doc-h2`** gets `**min-width: 0**` inside `**qb-doc-title-row**` flex so long AP/Bill titles do not widen the doc header.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-02

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**qb-doc-shell**`, `**qb-doc-head**`, `**qb-doc-body**`, `**qb-doc-total-block**`, and `**qb-lines-wrap**` so QB-style expense/bill shells and line tables participate in the accounting column’s shrink chain (with `**qb-doc-title-row**` / `**qb-doc-h2**`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-03

- **Rule 1:** `**public/css/app-theme.css`** — `**qb-panel`** and `**qb-attach-box**` get `**min-width: 0**`; `**erp-iframe**` gets `**min-width: 0**` + `**max-width: 100%**` (embedded tracking / fuel views); `**fuel-exp-table-wrap**` gets `**min-width: 0**` so scroll regions sit correctly inside flex/grid parents.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-04

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**.table-wrap**`, `**.safety-table-wrap**`, `**.safety-active-grid**`, and `**.shop-col-head-row**`; `**#erpTrackingMap**` gets `**min-width: 0**` + `**max-width: 100%**` so wide tables and the map host shrink inside the maintenance main column instead of widening the viewport.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-05

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**.shop-col-body**` and `**.nav-dropdown-menu**` (scroll regions); WO full-screen modal `**maint-workorder-fullmodal__shell**` / `**__head**` / `**__body**` get `**min-width: 0**` and `**__body**` gets `**min-height: 0**` so the flex column layout scrolls correctly on small viewports.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-06

- **Rule 1:** `**public/css/app-theme.css`** — Shared `**hero-card` / `panel` / `metric` / `record-card`** surface rule now includes `**min-width: 0**` (duplicate removed from `**hero-card**` only); `**panel-body**` and sidebar `**brand-sub**` get `**min-width: 0**` so default maintenance panels and sidebar copy shrink inside the shell grid.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-07

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**section.active**` (maintenance section host), sidebar `**brand**`, maintenance `**qb-picker-menu**`, `**maint-modal-bg**` / `**maint-modal**`, and `**maint-workorder-fullmodal__title**` so modals, picker popovers, and WO full-modal titles respect narrow viewports and flex centering.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-08

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0`** on WO `**maint-search-row**`, `**maint-wo-summary-bar**`, units column / nested `**panel**`, `**maint-wo-placeholder**`, accounting dash `**acct-dash-card__btnrow**` / `**acct-dash-tools-grid**`, AP `**ap-exp-row**` / `**ap-lines-section-label**` / `**ap-attach-head**`, fuel manual title, QB cost label row, upload `**mr-upload-tabbar**` / `**mr-upload-pickline**` / `**mr-upload-conn-card__actions**`, and `**maint-qb-cost-totals-bar**`. `**maint-wo-col-form**` gets `**min-height: 0**` so the flex column scroll region can shrink inside `**maint-wo-columns**`.
- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**iframe-wrap**`, `**catalog-subpanel.active**` / `**upload-subpanel.active**`, `**shop-tab-panel.active**` / `**shop-col**`, `**asset-cat-grid**`, compact KPI strip grid, asset header IDs row, status panel head, cost-line QB rows (`**maint-cost-line__acct**` / `**extras**` / `**maint-cost-qbo-custclass**`), `**maint-wo-split**`, `**maint-wo-banner**`, and `**maint-save-toolbar__actions**`; `**maint-main-tab-panel.active**` matches other visible tab hosts.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-09

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on cost coordination (`**maint-cost-coordination**` + `**.coord-row**`), accounting fuel relay preview (`**acct-fuel-import-preview**`), reports `**.rep-maint-detail-filters.wo-line-grid**` in the ≤768px column layout, and cost line `**maint-cost-line__billable**`.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0`** on `**maint-qb-cost-details**`, horizontal scroll frame `**maint-qb-lines-scroll**`, toast column `**erp-toast-host**`, `**acct-conn-sb__row**`, table cell `**maint-qb-bill-lbl**`; segment control `**erp-qb-seg**` gets `**max-width: 100%**` with `**min-width: 0**` so `**width: fit-content**` cannot widen the doc column past the viewport.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-10

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#maintIntegrationStrip`** and its first child row (**Connections** inline flex in `**maintenance.html`**) get `**min-width: 0`** so the accounting board card does not widen the viewport when status text and the checkbox label wrap together.
- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**.erp-main-body .erp-ops-toolbar**` and `**.erp-reports-toolbar**` so dense maintenance / tracking / safety ops bars and the reports hub toolbar respect the capped main column next to spec/redesign flex rules.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-11

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**.erp-ops-subtabs-bar**`, `**.erp-reports-toolbar__title**`, and `**.erp-reports-toolbar__search**`; WO `**.maint-panel-head-center**` (inherits flex from `**.panel-head**`); save toolbar split `**.maint-save-toolbar--qb .qb-split**` gets `**min-width: 0**` + `**max-width: 100%**` so the primary/caret control does not force the sticky save row wider than the form column.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — global `**body.erp-maintenance .erp-table-scroll { min-width: 0 }`** so wide-data tables (shop + any other module using the shared scroll frame) shrink inside flex/grid parents, not only under `**#section-maintenance .shop-tab-panel**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-12

- **Rule 1:** `**public/css/app-theme.css`** — Accounting `**.qb-doc-topbar`** / `**.qb-doc-topbar--fuel**`, AP/fuel `**.qb-doc-footer--ap**` / `**--fuel**`, and `**.qb-doc-footer__left**` / `**__right**` get `**min-width: 0**` so doc chrome stays within `**#section-accounting**` width; maintenance `**.qb-picker-item**` rows get `**min-width: 0**` next to the existing ellipsis on `**.qb-picker-item__label**`.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .erp-topbar.topbar`** gets `**min-width: 0**` so the master-layout topbar flex row respects the main column when spec/redesign set `**display: flex**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-13

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .erp-reports-sidebar`** joins shell/columns/main on `**min-width: 0**` so the two-column reports layout can shrink on narrow main columns; `**#acct-bill-pay**` `**.mr-bp-panel-head**`, `**.mr-bp-hintrow**`, and `**.mr-bp-submitrow**` get `**min-width: 0**` at all breakpoints (not only the ≤900px padding tweaks).
- **Rule 1:** `**public/css/app-theme.css`** — WO `**.maint-wo-save-split-wrap`** (`**inline-flex**`) gets `**min-width: 0**` + `**max-width: 100%**` so split save controls align with `**.maint-save-toolbar--qb .qb-split**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-14

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acct-bill-pay .mr-bp-panel-head__title`** gets `**min-width: 0**`; `**#acct-expense-history**` `**.panel-head**` and its direct child flex row get `**min-width: 0**`; `**#acct-qbo-rollback**` `**.panel-head**` and `**.panel-title**` get `**min-width: 0**` so expense history and rollback tab chrome matches other accounting overflow-safe patterns.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-15

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acct-expense-history .panel-head > div > div:last-child`** (**Apply filters** / **Export** column) gets `**min-width: 0`**; `**#acct-qbo-rollback .panel-body .panel-head > div`** for subsection import-batch headers; `**#acct-qbo .panel-head**` for Live Master outer head and **Vendors / Items / Accounts** column mini-heads.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-16

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — Reports hub `**.erp-reports-hub`**, `**.erp-reports-hub__tiles**` / `**__tiles--dense**`, `**.erp-reports-hub__card**`, and `**.erp-reports-hub__tile**` under `**#section-reports**` get `**min-width: 0**` so the tile grid respects `**erp-reports-main**` width.
- **Rule 1:** `**public/css/app-theme.css`** — WO `**.maint-subcard`** and `**.maint-subcard__body**` get `**min-width: 0**` so nested form blocks stay inside the main column.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-17

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — Reports `**.erp-reports-hub__tile-title`** / `**__tile-meta**`, sidebar `**.mr-rep-nav-group**` (with `**__head**` / `**__body**`), and each `**.reports-tab**` panel get `**min-width: 0**` under `**#section-reports**`.
- **Rule 1:** `**public/css/app-theme.css`** — Cost coordination `**.coord-total`** gets `**min-width: 0**` so large totals wrap inside `**.coord-row**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-18

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-uploads`** `**.panel-head**` / `**.panel-head > div**` and `**.mr-upload-panel-title**` get `**min-width: 0**` for inline-flex upload headers in `**maintenance.html**`.
- **Rule 1:** `**public/css/app-theme.css`** — Tracking `**.track-card`** gets `**min-width: 0**` inside `**track-grid**`; `**.erp-reports-toolbar__actions**` gets `**min-width: 0**` so the action cluster wraps inside the reports toolbar row.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-19

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-catalog`** `**.panel-head**` / `**.panel-head .panel-title**` and `**.catalog-subpanel > div:first-child**` (**mini-note** + help intro rows) get `**min-width: 0`** so Lists & catalogs chrome matches upload/accounting overflow-safe patterns.
- **Rule 1:** `**public/css/app-theme.css`** — Maintenance tire diagram `**.tire-svg`** gets `**min-width: 0**` inside `**tire-layout-wrap**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-20

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance`** `**.catalog-add-card**` / `**__head**` / `**__title**` / `**__body**` get `**min-width: 0**` for flex heads and form bodies in Lists & catalogs; `**#section-dashboard**` and `**#section-fuel**` `**.panel-head > div**` for inline-flex panel titles; `**#section-safety**` `**.tracking-sub > div:first-child**` (tab intro rows) and `**.safety-active-grid > div > div:first-child**` (per-column title rows).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-21

- **Rule 1:** `**public/css/app-theme.css`** — `**#section-maintenance`** `**.maint-kpi-strip__body > div:first-child**` (workspace snapshot row), `**.unit-list-panel .panel-head**`, and `**#maintTopQboIssuesInd**`; `**#section-tracking**` `**> div:first-child**` (fleet mix strip intro), `**.tracking-sub > div:first-child**` (e.g. shop tab intros), and `**.erp-ops-hero-head**` / `**> div**` (shop board hero head).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-22

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance .shop-subtabs`** gets `**min-width: 0**` so the shop queue subtabs row can shrink inside the tracking embed column; `**body.erp-maintenance .vendor-link-grid**` gets `**min-width: 0**` so the catalog vendor link auto-fit grid respects the Lists & catalogs column; `**#section-tracking .panel-head**` and `**.panel-head > div**` get `**min-width: 0**` for map / assets / yard-idle / summary headers that use flex (including inline `**display:flex**` on `**tr-idle**` heads).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-23

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance .safety-active-grid > div`** gets `**min-width: 0**` so each two-column track can shrink with `**minmax(0, 1fr)**` tracks; `**#section-maintenance .panel-head > div**` joins dashboard/fuel so nested flex title rows in the maintenance workspace respect the main column.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-accounting .panel-head > div`** and `**#section-catalog .panel-head > div**` get `**min-width: 0**` for AP/fuel/QBO/dash stacked panels and catalog panel wrappers (beyond tab-specific rules already present).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-24

- **Rule 1 / selector fix:** `**public/css/app-theme.css`** — Reports inner tab row rules targeted `**#section-reports > .subtabs`**, but `**maintenance.html**` nests the row as `**#repMainSubtabs**` inside `**.erp-reports-main**` (no direct `**.subtabs**` under `**#section-reports**`). Selectors are retargeted to `**#section-reports #repMainSubtabs**` so flex wrap, `**min-width: 0**`, and dropdown trigger sizing actually apply.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .panel-head`** and `**.panel-head > div**` get `**min-width: 0**` for report panels (overview, TMS, settlement, etc.) with flex title / action rows.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-25

- **Cleanup / Rule 1:** `**public/css/app-theme.css`** — Removed `**#section-accounting > .subtabs`** rules and the `**@media (max-width: 640px)**` override for them; `**maintenance.html**` has no direct `**.subtabs**` child under `**#section-accounting**` (accounting uses the board, `**accounting-tab**` panels, and SR stubs), so those rules never matched and only added confusion next to live catalog/reports subtabs styling.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .erp-reports-hub__label`** gets `**min-width: 0**` so hub card column labels participate in the hub flex/grid shrink model.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-26

- **Rule 1:** `public/css/app-theme.css` — `#section-reports .erp-reports-main` gets `min-height: 0` so the browse column flex stack can shrink with the shell/columns row (nested hubs/tabs participate in the same overflow-safe flex chain as shell + columns).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-27

- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `#maintIntegrationStrip > div` uses `min-width: 0` for every direct row (replacing `> div:first-of-type` only) so the optional `#maintPostingPreflight` line wraps inside the board column the same way as the Connections flex row.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-28

- **Rule 1:** `public/css/app-theme.css` — `.qbo-sync-alert-bar` gets `min-width: 0` so the sticky QuickBooks banner does not force the main column wider than the flex/grid host; `body.erp-maintenance .erp-topbar .topbar-hint-wrap` gets `min-width: 0` so the tip + help cluster can shrink beside title, search, and actions on narrow widths.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-29

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance #authBanner.erp-auth-banner` gets `min-width: 0` (with existing `width` / `max-width` from spec); `body.erp-maintenance .erp-main-surface > .erp-connection-strip` gets `min-width: 0` and `max-width: 100%` so the QuickBooks connection line cannot widen the main column past its host.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-30

- **Rule 1:** `public/css/app-theme.css` — `#erpDedicatedFormModal` shell and bar chrome: `body.erp-maintenance .erp-dedicated-form-modal__shell`, `__bar`, `__bar-actions`, and `__total-wrap` get `min-width: 0` so flex rows in the dedicated expense modal (spec layout) stay within `width: min(1000px, 100%)` on narrow viewports.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-31

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .erp-qb-dialog__body` and `.erp-qb-dialog__foot` get `min-width: 0` so the scrollable body and the flex-wrap footer in category / shop-queue / delay modals stay inside the `maint-modal` width (redesign already sets `min-height: 0` on the body).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-01

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .catalog-search-results` and `.catalog-search-hit` get `min-width: 0` so the vendor search scroll frame and flex column hit buttons respect the Lists & catalogs panel width instead of widening the column.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-02

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .list` (WO unit picker column) and `.track-list` (tracking map unit list) get `min-height: 0` alongside existing `overflow: auto` / `min-width: 0` so they can shrink inside flex/grid parents and scroll instead of forcing the ancestor height.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-03

- **Rule 1:** `public/css/app-theme.css` — `min-height: 0` added on scroll hosts that already used `overflow: auto` + `min-width: 0`: `.table-wrap`, `.shop-col-body`, `.safety-table-wrap`, `.acct-fuel-import-scroll`, and `.fuel-exp-table-wrap` so nested maintenance / safety / fuel / accounting table viewports can shrink in flex or grid columns and scroll reliably.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-04

- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `body.erp-maintenance .erp-table-scroll` gets `min-height: 0` (with existing `min-width: 0`); `.maint-qb-lines-scroll` gets `min-height: 0` so horizontal QB line table frames participate in flex height shrink like other scroll wrappers.
- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .form-stack` and `.card-list` get `min-height: 0` alongside `min-width: 0` so dense form stacks and dashboard card grids can shrink inside column flex layouts.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-05

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .erp-main-body` gets `min-width: 0` so the redesign’s vertical scroll region does not inherit a flex min-content width from wide tables or QB docs inside the main column. `body.erp-maintenance .erp-icon-nav` gets `min-height: 0` so the left icon rail can shrink inside `#erpApp`’s `100vh` flex row and use its own `overflow-y: auto` when many shortcuts are present.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `.maint-wo-form-stack-inner` gets `min-height: 0` alongside `min-width: 0` so the work-order form stack participates in the `.maint-wo-col-form` scroll column flex chain.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-06

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .catalog-search-results` gets `min-height: 0` (split from the shared `min-width` rule with `.catalog-search-hit`). QBO sync alert expandable list (`.qbo-sync-alert-bar .qbo-sync-list`), legacy `.sidebar` scroll column, sidebar module `.nav-dropdown-menu`, compact `.qb-picker-menu`, WO `.maint-form-stack`, and fuel `.fuel-expense-stack` each get `min-height: 0` where they already scroll or sit in flex/grid chains so they can shrink instead of blocking ancestor layout.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `#section-accounting .maint-qb-lines-scroll` gains `min-height: 0` to match the global `.maint-qb-lines-scroll` scroll frame behavior inside accounting panels.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-07

- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `body.erp-maintenance [style*='display:flex']` sets `min-width: 0` so inline flex toolbars / panel rows in `maintenance.html` participate in shrink like class-based flex rows (avoids bulk `style=` edits; explicit inline `min-width` on the same element still overrides).

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-08

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .main` gets `min-height: 0` next to `overflow: auto` and `min-width: 0` so the legacy grid main column can shrink inside height-constrained parents and scroll instead of forcing overflow past the shell.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — inline flex Rule 1 selector extended with `[style*='display: flex']` (spaced spelling) alongside `display:flex` for future-proofing.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-09

- **Rule 1:** `public/css/app-theme.css` — `.qbo-sync-alert-bar .qbo-sync-list` gains `min-width: 0` and `min-height: 0` at the shared rule (all ERP shells that show the expandable issue list); removed the duplicate `body.erp-maintenance`-only block. `body.erp-maintenance .section.active`, `.grid`, and `.split` each get `min-height: 0` next to existing `min-width: 0` so module roots and legacy two-column grids shrink inside flex-height chains instead of blocking nested scroll.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-10

- **Rule 1:** `public/css/app-theme.css` — Shared `.qb-picker-menu` gets `min-height: 0` with `max-height` + `overflow: auto`. Under `body.erp-maintenance`, `.hero-grid`; `.hero-card` / `.panel` / `.metric` / `.record-card`; `.shop-tab-panel.active`; `.qb-doc-shell`, `.qb-doc-body`, and `.qb-lines-wrap` each gain `min-height: 0` alongside existing `min-width: 0` so dashboard grids, shop boards, and QuickBooks-style doc shells participate in flex/grid height shrink and nested scroll regions behave reliably.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-11

- **Rule 1:** `public/css/app-theme.css` — Under `body.erp-maintenance`, `.panel-head` and `.panel-body` get `min-height: 0`; `.st-settlement-wrap` gets `min-height: 0` with `overflow: hidden`. QB doc chrome: `.qb-doc-title-row`, `.qb-logistics-bar`, `.qb-lines-header`, `.qb-lines-actions`, `.qb-doc-memo-row`, `.qb-doc-actions`, and `.qb-doc-actions .qb-actions-left` / `.qb-actions-right` each gain `min-height: 0` next to existing `min-width: 0` so panels, settlement tables, and cost-line footers shrink correctly inside nested flex/grid layouts.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-12

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance` `.topbar`, `.chips`, `.track-grid`, `.track-card`, `.qb-panel`, and `.maint-cost-panel` get `min-height: 0` (and `.maint-cost-panel` also gets `min-width: 0`) so tracking, filter chips, and cost panels participate in height shrink beside existing width rules.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — WO action strip (`.maint-action-strip`, `.maint-fleet-inline`, `.maint-action-strip__qbo`) get `min-height: 0`. Inline layout helper extended to match `display:grid` / `display: grid` as well as flex spellings, with both `min-width: 0` and `min-height: 0` for JS-built grids in `maintenance.html`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-13

- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — WO search row / fields (`.maint-search-row`, `.maint-search-field`, `.maint-search-field--grow`), `.maint-wo-summary-bar`, accounting `.acct-dash-kpis` / `.acct-dash-kpi`, `#maintIntegrationStrip` and its direct child rows, and `.erp-topbar .title` each get `min-height: 0` where they already use flex or grid with `min-width: 0`, so maintenance and accounting chrome shrink reliably inside the page shell.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-14

- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `min-height: 0` added on accounting dashboard cards (`.acct-dash-cards`, `.acct-dash-card`, `.acct-dash-card__btnrow`, `.acct-dash-tools-grid`), AP expense layout (`#acct-transactions` `.ap-expense-form`, `.ap-exp-row`, `.ap-exp-field`, `.ap-exp-field--pdf`, `.ap-lines-section-label`, `.ap-attach-head`), fuel / cost labels (`.fuel-manual-doc-title`, `.erp-qb-cost-shell__label--with-tip`), upload center (`.mr-upload-pickline`, `.mr-upload-conn-grid`, `.mr-upload-conn-card`, `.mr-upload-conn-card__actions`), `.acct-conn-sb__row`, `.erp-toast-host`, and QB cost chrome (`.maint-qb-cost-details`, `__sum`, `.maint-qb-cost-totals-bar`, `.erp-qb-seg`) so those flex/grid regions align with the rest of the maintenance Rule 1 pass.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-15

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance` dedicated expense modal chrome (`.erp-dedicated-form-modal__shell`, `__bar`, `__bar-actions`, `__total-wrap`) gains `min-height: 0` next to `min-width: 0`.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `.maint-qb-bill-lbl`; upload `.mr-upload-tabbar` and `.mr-upload-panel-card`; toast `.erp-toast` and `.erp-toast__msg` each get `min-height: 0` where flex + `min-width: 0` already apply.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-16

- **Rule 1:** `public/css/app-theme.css` — QB dialogs `.erp-qb-dialog__body` / `__foot`, category modal `.asset-cat-grid`, `.maint-cost-panel-card` (with `overflow: hidden`), WO save toolbar (`.maint-save-toolbar--qb`, `__hint`, `__actions`, `.qb-split`), and dashboard/fuel/maintenance `.panel-head > div` flex title clusters get `min-height: 0` (and `min-width` on the cost card) for nested flex overflow chains.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `#erpApp .erp-new-menu__cols`, `#acctBoardStrip` / `.mr-acct-board`, `.mr-filter-bar__grow`, QBO/print action strip selectors (with `.maint-qbo-header-grid` etc.), and `.mr-filter-bar` group gain `min-height: 0`. Inline style helper adds `display:inline-flex` / `display: inline-flex` attribute matches next to existing flex/grid selectors.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-17

- **Rule 1:** `public/css/app-theme.css` — `body.erp-maintenance .erp-main-body` gains `min-height: 0` next to `min-width: 0` so the redesign scroll column participates in vertical flex shrink like other nested scroll hosts. Ops/reports chrome (`.erp-ops-toolbar`, `.erp-reports-toolbar`, `.erp-ops-subtabs-bar`, `.erp-reports-toolbar__title`, `__search`, `__actions`) each get `min-height: 0`. `#acct-fuel-expense .qb-doc-shell` gets `min-height: 0` with existing width caps.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-18

- **Rule 1:** `public/css/app-theme.css` — Surface chrome: `#authBanner.erp-auth-banner` and `.erp-main-surface > .erp-connection-strip` gain `min-height: 0`. Reports: `#section-reports .erp-reports-main` now includes `min-width: 0` with `min-height: 0`. Section-scoped flex rows (safety `.tracking-sub` / `.safety-active-grid` first cells, maintenance KPI strip + unit list `.panel-head`, `#maintTopQboIssuesInd`, tracking column roots + `.erp-ops-hero-head` + `.panel-head` clusters) each get `min-height: 0` next to `min-width: 0`. Mobile `.rep-maint-detail-filters.wo-line-grid` adds `min-height: 0`.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-19

- **Rule 1:** `public/css/app-theme.css` — Upload `.upload-subpanel.active` gains `min-height: 0`. `#section-accounting` (`.accounting-tab`, `.qb-doc-shell`, `.qb-doc-body`, nested `.ap-expense-form`, `.qb-doc-topbar` / fuel topbar, AP/fuel `.qb-doc-footer*` flex rows) gains `min-height: 0` with existing width rules. `.maint-modal-bg` gains `min-height: 0`. Catalog `.panel-body > .subtabs` / `.subtab`, `.vendor-link-grid`, reports `#repMainSubtabs` / child `.subtab`+`.nav-dropdown`, and `#section-reports .nav-dropdown-menu` get `min-width: 0` / `min-height: 0` where needed for nested flex/scroll.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-20

- **Rule 1:** `public/css/app-theme.css` — `min-height: 0` added next to existing `min-width: 0` on maintenance shell pieces that participate in flex/grid shrink: `.sidebar-brand-row`, `.toolbar` / `.search-row` / `.unit-summary`, `.qb-doc-total-block`, `.vendor-row-maint`, `.shop-board-grid`, `.shop-subtabs`, `.shop-action-row`, full-screen WO modal (`.maint-workorder-fullmodal__shell`, `__head`, `__title`), `.maint-modal`, `.erp-iframe`, and `#erpTrackingMap`.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — Section-scoped overflow helpers that only declared `min-width: 0` now also declare `min-height: 0` for accounting, reports hub/tiles/nav, uploads/catalog panel heads, bill-pay rows, expense-history / QBO-rollback / QBO heads, and shop tab panels. `.maint-wo-col-units .panel-body` gains `min-width: 0` beside `min-height: 0` so the unit list scroll column cannot widen the WO split layout.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-21

- **Rule 1:** `public/css/app-theme.css` — Additional maintenance-only shrink pairs: catalog card stack (`.catalog-add-card*` + `.catalog-search-hit`), topbar text cluster (`.title`, `.topbar-hint-wrap`, `.panel-title`), list/record chrome (`.record-head`, `.subtabs`), tire + iframe hosts (`.tire-layout-wrap`, `.tire-svg`, `.iframe-wrap`), QB doc chrome (`.qb-doc-head`, `.qb-doc-h2`, `.wo-line-grid`), active `.catalog-subpanel`, QB picker rows (`.qb-picker-item`), and `.erp-icon-nav` (`min-width: 0` added next to existing `min-height: 0`).
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — Master shell helpers `#erpApp.erp-master` (`.erp-main-col`, `.main.erp-main-surface`, `.erp-main-body`, `.erp-topbar__search-inner`, `.erp-topbar__search`, `.erp-topbar__actions`, `.erp-topbar.topbar`) now pair `min-width: 0` with `min-height: 0`. `.maint-qb-lines-table .qb-in` gains `min-height: 0` beside `min-width: 0` for dense grid line editors.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-22

- **Rule 1:** `public/css/app-theme.css` — WO / board / cost UI band: `min-height: 0` added alongside `min-width: 0` (or introduced where only width was set) on flex/grid hosts including `.maint-expense-strip`, `.shop-queue-row`, `.maint-board-layout`, `.maint-board-nav`, `.maint-board-stage`, KPI strip/cards, `.maint-wo-workspace-grid`, `.maint-wo-workspace`, `.maint-wo-aside`, `.maint-aside-kv`, asset header/status rows, `.maint-cost-qbo-stack` / `.maint-cost-qbo-custclass`, form actions/split/grid rows, `.maint-field-cell` inputs, cost line head/primary/acct/extras/billable/footer, `.maint-main-tab-panel.active`, `.maint-top-toolbar__inner`, WO banner/refs/inputs, `.maint-subcard` / `__body`, `.maint-panel-head-center`, and `.maint-cost-coordination` (+ `.coord-row`, `.coord-total`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-23

- **Rule 1:** `public/css/app-theme.css` — Sidebar title stack (`.brand`, `.brand-sub`) gets `min-height: 0` next to `min-width: 0`. Catalog vendor grid (global `.vendor-link-grid`), vendor search scroller (global `.catalog-search-results` + `min-width: 0`), and combobox rows (global `.qb-picker-item`) complete horizontal/vertical shrink for maintenance Lists & catalogs + QB picker. Right drawer (global `.erp-drawer`, `__head`, `__title`; `__body` already had `min-height: 0`) aligns flex column overflow with the maintenance-only `erp-drawer` markup.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-24

- **Rule 1:** `public/css/app-theme.css` — QBO sync strip `.qbo-sync-actions` gets `min-height: 0` with `min-width: 0`. Global catalog rows (`.catalog-add-card__head`, `.catalog-search-hit`) and QB picker text cells (`.qb-picker-item__label`, `.qb-picker-item__meta`) gain matching mins so flex descendants stay overflow-safe without relying only on `body.erp-maintenance` overrides. Maintenance HOS grid `.safety-active-grid` and direct column children, plus shop `.shop-col-head-row`, add `min-height: 0` beside existing width caps.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-25

- **Rule 1:** `public/css/app-theme.css` — Base (all breakpoints) rules for reports `.rep-maint-detail-filters.wo-line-grid` and direct grid children so the maintenance WO-style filter row shrinks inside the reports column; `#section-maintenance .shop-kanban` gets `min-width` / `min-height` `0` to align with the existing ≤960px column override from spec layouts.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — WO summary inline key/value clusters (`.maint-wo-summary-bar .kv`) gain `min-width: 0` and `min-height: 0` next to `display: inline-flex`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-26

- **Rule 1:** `public/css/app-theme.css` — `#section-safety .tracking-sub` and `#section-tracking .tracking-sub` gain `min-width: 0` / `min-height: 0` so embed shells participate in the section flex column. `#section-maintenance .unit-list-panel` and `.unit-list-scroll` get the same pair beside the existing `.panel-head` rule for the WO split layout.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `.mr-upload-result` adds `min-width: 0` next to `min-height: 0` for upload result blocks under flex parents.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-27

- **Rule 1:** `public/css/app-theme.css` — `#section-fuel` and `#section-catalog` outer `> .panel` / `> .panel > .panel-body` chains get `min-width: 0` / `min-height: 0` so those modules align with the reports/accounting overflow discipline under the maintenance main column.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — Upload drop zone `.mr-upload-drop` gains `min-width: 0` / `min-height: 0`; `.mr-upload-recent` adds `min-width: 0` beside the existing `min-height: 48px` floor.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-28

- **Rule 1:** `public/css/app-theme.css` — `#section-reports > .erp-reports-shell` gains `min-width: 0` / `min-height: 0` next to the existing `.erp-reports-main` rule. Upload center joins fuel/catalog in the shared outer `> .panel` / `> .panel > .panel-body` Rule 1 block.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `.mr-upload-recent-table` adds `min-width: 0` so wide recent-upload tables can shrink inside flex parents without forcing horizontal overflow.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-29

- **Rule 1:** `public/css/app-theme.css` — `.maint-section-card` (KPI strip and other section cards) gains `min-width: 0` / `min-height: 0` so those surfaces participate cleanly in any flex/grid ancestor chain. `.mr-kpi-strip` adds the same pair so the Home dashboard KPI grid from `erp-master-spec-2026.css` still shrinks inside the main column when the spec layer omits container mins.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-06-30

- **Rule 1:** `public/css/app-theme.css` — `.qbo-sync-alert-bar` gains `min-height: 0` next to the existing `min-width: 0` so the sticky QBO strip participates in vertical flex shrink the same way as `.qbo-sync-list` / `.qbo-sync-actions`.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — Upload center file pick row: `.mr-upload-pickline__name` gets `flex: 1 1 auto`, `min-width` / `min-height` `0`, and single-line ellipsis so long filenames do not widen the flex row beside the remove control; `.mr-upload-pickline__meta` sets `flex-shrink: 0` so byte-size text stays visible; `.mr-upload-pickline__x` sets `flex-shrink: 0` so the remove control keeps a stable hit target.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-01

- **Rule 1:** `public/css/app-theme.css` — Flex grow slots that already set horizontal floors now pair `min-height: 0` so flex descendants can shrink vertically without fighting `min-height: auto`: `.maint-top-toolbar__grow`, `.maint-asset-header-card__ymm`, `.maint-cost-qbo-custclass__cell`, and `.maint-vendor-ref-row__field`.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-02

- **Rule 1:** `public/css/app-theme.css` — Accounting fuel relay import: `.acct-fuel-import-scroll-split` drops the large viewport `min-height` floors in favor of `min-height: 0` (base and ≤1100px) so the `flex: 1 1 auto` grid can shrink inside `.acct-fuel-import-preview` and let `.acct-fuel-import-scroll` / `max-height` own vertical overflow instead of fighting flex `min-height: auto`.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-03

- **Rule 1:** `public/css/app-theme.css` — At `max-width: 900px`, when `.shop-board-grid` collapses to a single column, `.shop-col` overrides the default `min-height: 120px` with `min-height: 0` so stacked shop / kanban columns participate in the same overflow-safe vertical chain as `.shop-col-body` (`max-height` + `overflow: auto`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-04

- **Rule 1:** `public/css/app-theme.css` — `.shop-col-head` gains `min-width: 0` / `min-height: 0` so column titles (including when combined with `.shop-col-head-row` flex layout) can shrink inside narrow shop / tracking columns without forcing min-content overflow.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-05

- **Rule 1:** `public/css/app-theme.css` — Ops sections parity: `#section-safety > div:first-child` joins `#section-tracking` in the Rule 1 first-row strip. `#section-safety .erp-ops-hero-head` / `> div` and `#section-safety .panel-head` / `> div` match the existing tracking rules so safety panels and hero heads shrink inside the maintenance main column the same way as tracking.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-06

- **Rule 1:** `public/css/app-theme.css` — `#section-safety .tracking-sub > div:first-child` joins the tracking rule for the top strip above HOS / shop embeds. `.mr-violation-legend` and `.mr-violation-legend__item` gain `min-width: 0` / `min-height: 0` so the spec-defined flex legend row wraps cleanly inside narrow ops columns (override lives in `app-theme.css`, not Agent A).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-07

- **Rule 1:** `public/css/app-theme.css` — `.metric-value` gains `min-width: 0` / `min-height: 0` so large KPI numbers can shrink inside dense `.metric` / grid cells without widening the Home or ops KPI strips.
- **Rule 1:** `public/css/maint-accounting-ui-2026.css` — `.mr-filter-bar__actions` (spec flex column) and `.mr-filter-chipwrap` / `> summary` gain `min-width: 0` / `min-height: 0` next to the existing `.mr-filter-bar*` Rule 1 cluster.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-08

- **Rule 1:** `public/css/app-theme.css` — `#section-tracking .erp-ops-kpi-strip` gains `min-width: 0` / `min-height: 0` (same intent as Home `.mr-kpi-strip`). `.list-title`, `.list-sub`, and `.shop-row` get the same pair so dense list / shop queue text participates in shrink-safe layout under flex or grid parents.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-09

- **Rule 1:** `public/css/app-theme.css` — `.list-row`, `.unit-box` (WO split summary tiles), and `.shop-queue-card` gain `min-width: 0` / `min-height: 0` so those blocks shrink cleanly inside `.list`, `.unit-summary` / toolbar grids, and shop queue stacks beside flex rows like `.shop-queue-row`.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-10

- **Rule 1:** `public/css/app-theme.css` — `.mini-note` gains `min-width: 0` / `min-height: 0` so helper copy in flex toolbars and panel stacks does not fight `min-content` width. `.unit-box .v` gets the same pair so summary values can shrink inside the four-column `.unit-summary` grid.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-11

- **Rule 1:** `public/css/app-theme.css` — `.unit-box .k` gains `min-width: 0` / `min-height: 0` next to `.unit-box .v`. QuickBooks-style `.qb-l` and `.qb-in` add shrink-safe mins (`min-height: 0` on inputs; labels get both). `.nav-dropdown` and `.nav-dropdown-trigger` gain `min-width: 0` / `min-height: 0` so reports / catalog tab rows with embedded dropdowns stay inside the main column.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-07-12

- **Rule 1:** `public/css/app-theme.css` — Global maintenance form controls (`input`, `select`, `textarea` under `body.erp-maintenance`) gain `min-width: 0` / `min-height: 0` so flex/grid parents can shrink fields; the existing `textarea { min-height: 84px; }` rule still sets the taller floor for text areas. `.subtab` pills get the same pair in flex tab rows. `.maint-field` adds `min-height: 0` beside its width caps.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.