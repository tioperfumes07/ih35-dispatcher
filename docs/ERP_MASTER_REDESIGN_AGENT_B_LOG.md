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
- `**maintenance.html`:** Remaining `var(--color-text-primary,#0f172a)`, shop queue warn accent, pill green, and danger button text stacks normalized to token-only; `**paintQboStatusBanner`** / `**paintApTxnQboBanner`** tier maps now assign `**var(--color-bg-hover)**`, `**var(--pill-*-bg)**`, `**var(--color-*-border-soft)**`, `**var(--btn-danger-border)**` instead of bare hex for fills and strokes.
- **Rule 1:** `maint-accounting-ui-2026.css` — `:is(#section-dashboard, #section-fuel, #section-safety, #section-maintenance, #section-tracking, #section-catalog)` active sections plus `.panel` / `.panel-body` get `**min-width: 0`** so remaining modules match accounting / reports / uploads overflow discipline.
- **Smoke:** Maintenance HTML needles add `**section-maintenance`** and `**section-catalog`** (core shells always present in the static document).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-19

- `**app-theme.css`:** Further token cleanup on maintenance chrome — `var(--color-text-primary, #0f172a)`, modal flow title (navy via `**var(--color-app-frame-border)`**), asset picker hover ring, save-toolbar split focus / pill soft fills, semantic warn/error hints, `**var(--color-app-frame-border, var(--app-frame-border, …))`** inner hex removed, and remaining `**#ffffff**` / `**#2563eb**` / `**#93c5fd**` fallbacks folded to design tokens.
- **Rule 1:** `maint-accounting-ui-2026.css` — `**#section-maintenance .shop-tab-panel`** and nested `**.erp-table-scroll`** use `**min-width: 0**` so `**min-width:980px**` shop tables stay inside the horizontal scroll frame instead of widening the page shell.
- **Smoke:** Maintenance HTML check requires `**shopBoardSubtabs`** (stable shop board anchor next to wide queue tables).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-20

- `**app-theme.css`:** Cleared more maintenance-only hex fallbacks — warning/success soft borders, semantic warn accent / warning accents, `**stroke: var(--muted, …)`** / `**fill: var(--accent|nav-bg, …)`**, `**var(--accent, #1d4ed8)**` in mixes, semantic success in `**color-mix**`, hero/panel gradients using `**#e8eef9` / `#eef2f9**`, `**var(--color-nav-bg, var(--app-frame-border, …))**` inner hex, and settlement table header gradient now uses `**var(--color-nav-bg)**` + `**color-mix(…, black)**` instead of literal navy stops; settlement `**th**` bottom border uses `**var(--sidebar-bg)**` without a hex fallback.
- **Rule 1:** `maint-accounting-ui-2026.css` — `**#section-accounting .maint-qb-lines-scroll`** gets `**min-width: 0`** so wide QB line tables stay inside the doc’s horizontal scroll region under flex layout.
- **Smoke:** Maintenance HTML needles include `**id="erpApp"`** so the master shell root cannot disappear without failing the static GET check.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

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

- `**app-theme.css`:** Company `**.hub-page`** drops the redundant legacy radial + `**#0c1220`** base layer; hub `**color-mix**` / text now use `**var(--color-hub-accent|hub-card|hub-text|hub-bg-deep)**` without hex fallbacks. `**.cost-total-bad**` border `**color-mix**` uses `**var(--color-bg-card)**` instead of `**#ffffff**`. QB split **primary `.qb-split__caret`** gradient aligns with `**var(--btn-primary-save-bg)` / `var(--btn-primary-save-hover)**`. Print `**@media**` block no longer declares a raw `**#fff**` background before the token line.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#section-maintenance .maint-page-shell`** adds `**min-width: 0**` alongside `**min-height: 0**` for flex shrink in the WO workspace.
- **Smoke:** Maintenance HTML needles include `**maint-action-strip`**.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-24

- `**maintenance.html`:** Sidebar QuickBooks / desktop-notification and sync-alert brief text colors now use `**var(--color-success-border-soft)`**, `**var(--pill-red-text)`**, and `**var(--color-warning-border-soft)**` instead of raw Tailwind-style hex. Tracking map `**L.circleMarker**` stroke/fill read `**--color-border-focus**`, `**--color-hub-accent**`, and `**--color-text-label**` from `**getComputedStyle(document.documentElement)**` so markers follow `**design-tokens.css**` while keeping safe string fallbacks if a token is missing.
- **Smoke:** Maintenance HTML needles add `**maint-page-shell`** (WO workspace root next to the action strip).

**Files:** `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-25

- `**maintenance.html`:** `**ERP_WRENCH_ICON`** / `**ERP_PUMP_ICON`** inline SVG paths use `**fill="var(--pill-green-text)"**` and `**fill="var(--color-border-focus)"**` instead of hard-coded greens/blues.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**body.erp-maintenance #erpApp.erp-master .erp-main-col`** gets `**min-width: 0**` as a defensive flex shrink hook (harmless if `**erp-master-spec**` already sets it).
- **Smoke:** Maintenance HTML needles add `**id="erpToastHost"`** and `**id="qboSyncAlertBar"`** so toast host + QBO sync strip cannot be removed without failing the static GET check.

**Files:** `public/maintenance.html`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-26

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .main.erp-main-surface`** and `**.erp-main-body**` now include `**min-width: 0**` alongside `**.erp-main-col**`, so the topbar + scroll column stack cannot force the master shell wider than the viewport under nested flex/grid content.
- **Smoke:** Maintenance HTML check requires `**id="acctBoardStrip"`** (accounting board strip anchor next to `**acct-dash-kpis`**).

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-27

- `**app-theme.css`:** `**.erp-drawer`** scroll column — `**erp-drawer__body`** is now `**flex: 1 1 auto**` with `**min-height: 0**` so long create-menu / injected form content scrolls inside the drawer instead of stretching past the fixed `**100vh**` shell (drawer is maintenance-only in this repo’s HTML shells).
- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .erp-topbar__search-inner`** gets `**min-width: 0**` so the global search field can shrink next to dense `**erp-topbar__actions**` on narrow widths.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-28

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**#erpApp .erp-new-menu__cols`** gets `**min-width: 0**` so the three-column **+ New** flyout flex row respects the menu’s `**min(…vw, 860px)`** cap without forcing extra horizontal overflow.
- **Smoke:** `**scripts/system-smoke.mjs`** — after HTML page checks, `**oneStatic()`** GETs `**/css/maint-accounting-ui-2026.css**` and `**/css/app-theme.css**` and asserts stable header substrings (`**Maintenance center action strip**`, `**IH35 — shared visual language**`) so a broken `public/` mount fails CI before paint.

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-29

- **Rule 1:** `**maint-accounting-ui-2026.css`** — `**maint-action-strip`** / `**maint-action-strip__qbo**` get `**min-width: 0**` so the WO maintenance shell’s flex column does not inherit an implicit min-content width from long QBO copy or many strip buttons. `**#erpApp.erp-master .erp-topbar__search**` and `**.erp-topbar__actions**` also get `**min-width: 0**` (after `**erp-topbar__search-inner**`) so the ERP master top bar can narrow below the redesign search floor when the main column is tight.
- **Rule 0:** `**maint-accounting-ui-2026.css`** — active strip button ring uses `**color-mix`** on `**--color-border-focus**` instead of a hard-coded blue `**rgba**`. `**app-theme.css**` — maintenance form control focus halo uses the same token-driven `**color-mix**` pattern.

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-30

- **Rule 0:** `**maint-accounting-ui-2026.css`** — `**.erp-toast`** uses `**var(--shadow-toast)**` from `**design-tokens.css**` instead of a bespoke `**rgba**` stack. `**.maint-form-actions--sticky**` edge lift uses `**color-mix**` on `**--color-text-primary**` instead of neutral black `**rgba**`.
- **Rule 1:** `**maint-accounting-ui-2026.css`** — toast cards cap width with `**min(400px, calc(100vw - 32px))`** and allow a shrinking floor with `**min(280px, calc(100vw - 32px))**` on `**min-width**`, so fixed toasts do not force horizontal overflow on narrow phones.
- `**app-theme.css**` — `**.cost-total-ok**` / `**.cost-total-bad**` drop the dead first `**box-shadow**` declaration (keep token `**color-mix**` rings only).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-01

- `**app-theme.css`:** Removed dead “first `**box-shadow`** / `**background`**” duplicates where a second line already applied `**var(--shadow-drawer)**`, `**var(--color-modal-backdrop)**`, `**var(--shadow-dropdown)**` (`.erp-drawer`, `.erp-drawer__backdrop`, maintenance `**.nav-dropdown-menu**`, `**.maint-modal-bg**`, `**.maint-save-toolbar--qb .qb-split__menu**`).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** now GETs `**/css/design-tokens.css**` and asserts the stable header line `**IH35 ERP — Master spec design tokens (Rule 0).**` so a missing or truncated token file fails CI alongside theme and maintenance CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-02

- `**app-theme.css` (Rule 0):** Dropped shadow/background/border “first line” duplicates that were always overridden — `**.hub-page .grid a.card`** (+ `**:hover`**), `**.qb-picker-menu**`, maintenance sidebar `**.nav-btn:hover**` / `**.active**`, `**.nav-dd-item:hover**`, and `**.maint-board-nav__btn:hover**`. Each rule now keeps a single token-driven `**color-mix**` or `**var(--shadow-dropdown, …)**` declaration.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-03

- `**app-theme.css` (Rule 0):** `**.maint-wo-banner`** hairline shadow uses `**color-mix`** on `**--color-text-primary**` instead of slate `**rgba**`. `**.maint-save-toolbar--qb .qb-split__caret**` uses a single `**border-left**` with `**color-mix**` on `**--color-bg-card**` instead of `**rgba(255,255,255,…)**` plus a second `**border-left-color**` override.
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** includes `**/css/board-nav.css**` with needle `**Persistent operations bar**` (matches `**board-nav.css**` header comment).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-04

- **Rule 1:** `**app-theme.css`** — `**.qbo-sync-alert-bar .qbo-sync-actions`** and `**body.erp-maintenance .maint-top-toolbar__inner**` get `**min-width: 0**` so wrapped flex rows do not widen parent shells from intrinsic min-content.
- **Rule 0:** `**app-theme.css`** — `**.qbo-sync-alert-bar .qbo-sync-meta`** uses `**var(--color-text-label)**` (banner is maintenance-only; `**design-tokens.css**` is always loaded there).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneStatic()`** accepts an optional `**Accept**` header; `**STATIC_TEXT**` adds `**/js/erp-ui.js**` with needle `**IH35 ERP — shared UI helpers**` and a broad `**Accept**` value so a missing `**public/js**` mount fails CI alongside CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-05

- **Rule 1:** `**app-theme.css`** — legacy maintenance shell `**.app`** (sidebar + main grid) gets `**min-width: 0**` so the page can shrink inside nested viewports without the grid’s default min-content floor forcing horizontal scroll. `**sidebar-brand-row**` and `**.topbar**` get `**min-width: 0**` so dense sidebar chrome and classic topbars cooperate with `**flex-wrap**` without widening the column.
- **Smoke:** `**scripts/system-smoke.mjs`** — `**STATIC_TEXT`** adds `**/js/board-nav.js**` with stable substring `**Fuel & route planning**` (first board entry in that bundle).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-06

- **Rule 1:** `**app-theme.css`** — legacy maintenance `**.split`** uses `**minmax(0, 1fr)**` for the fluid column (was plain `**1fr**`) plus `**min-width: 0**` on the grid so the list + detail pattern cannot force extra horizontal overflow. `**hero-grid**`, `**.toolbar**`, `**.search-row**`, and `**.unit-summary**` grids get `**min-width: 0**` so `**minmax(0, 1fr)**` tracks can actually shrink inside narrow shells.
- **Rule 0:** `**app-theme.css`** — `**body.erp-maintenance .list-sub`** reads `**var(--color-text-label)**` only (maintenance loads `**design-tokens.css**`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-07

- **Rule 1:** `**app-theme.css`** — legacy maintenance `**.grid`**, `**.panel-head**`, and `**.chips**` get `**min-width: 0**` so nested `**minmax(0, 1fr)**` grids and chip rows do not inherit min-content width from flex/grid parents.
- **Rule 0:** `**app-theme.css`** — under `**body.erp-maintenance`**, drop redundant `**var(--muted)**` / legacy accent fallbacks where `**design-tokens.css**` already defines the stack (`**.hero-card p**`, `**.metric-label**`, `**.table-wrap th**`, general `**th**`, `**.unit-box .k**`, `**.chip.active**`, `**.list-row.active**`) and use `**var(--color-app-frame-border)**` alone on `**.panel-head**` (same maintenance-only assumption).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-08

- **Rule 0:** `**app-theme.css`** — legacy maintenance chrome: `**.title`**, default `**.btn` / `button` / `input` / `select` / `textarea**` text colors use spec tokens only (`**--color-text-primary**`, `**--color-text-body**`). Button hover border uses `**--color-border-input**` (replacing `**--color-border` + `--line-strong**`). `**.status-***` pills use `**--pill-***` tokens only. `**.mini-note**` uses `**--color-text-label**`. `**.record-card:hover**` border uses `**--color-border-input**` for a slightly stronger edge than the resting card border.
- **Rule 1:** `**app-theme.css`** — `**form-stack`**, `**card-list**`, `**record-head**`, and `**subtabs**` get `**min-width: 0**` so dashboard cards and subtabs do not widen the main column from intrinsic min-width.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-09

- **Rule 1:** `**app-theme.css`** — WO / tracking / tires: `**.tire-layout-wrap`** and `**.track-grid**` use `**minmax(0, 1fr)**` for the fluid column plus `**min-width: 0**` where missing; `**.track-list**`, `**.maint-form-stack**`, `**.maint-expense-strip**`, `**.shop-queue-row**`, `**.maint-board-nav**`, `**.maint-repair-chip-row**`, `**.vendor-row-maint**`, `**.shop-action-row**`, `**.shop-board-grid**`, `**.wo-line-grid**`, `**.maint-cost-line__primary**`, `**.maint-cost-lines-head` / `-footer**`, `**.maint-form-actions__row**`, `**.maint-asset-header-card**` (+ `**__row**`) get `**min-width: 0**` as needed. `**.maint-wo-banner__refs**` drops the `**min(100%, 360px)**` floor in favor of `**0**` so the banner flex row can shrink on narrow widths. QB doc chrome (`**.qb-doc-title-row**`, `**.qb-logistics-bar**`, `**.qb-lines-header**`, `**.qb-doc-actions**`, `**.qb-doc-memo-row**`) gets the same overflow discipline.
- **Rule 0:** `**app-theme.css`** — broad `**body.erp-maintenance`** sweep: borders that chained `**--color-border` + `--line-strong**` or `**--color-app-frame-border` + `--app-frame-border**` now use the spec token alone; label/body text drops `**var(--muted)` / `var(--text)` / `var(--text-secondary)**` fallbacks in favor of `**--color-text-label**` / `**--color-text-body**`; `**--color-bg-card**` replaces `**--bg-elevated**` on KPI cards; board nav active state uses `**--color-nav-bg**` consistently.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-10

- **Rule 0:** `**app-theme.css`** — repo-wide cleanup of redundant `**var(--color-text-label, var(--muted))`**, `**var(--color-text-body, var(--text|text-secondary))**`, `**var(--color-text-primary, var(--text))**`, `**var(--color-bg-card, var(--bg-elevated))**`, and `**var(--color-nav-bg, var(--sidebar-bg))**` now use the outer design-token names only (every HTML shell that loads `**app-theme.css**` already loads `**design-tokens.css**`). `**maint-field--readonly**` and dispatch tab chrome were fixed where `**!important**` or `**text-secondary**` prevented the earlier bulk replace.
- **Rule 1:** `**body.erp-maintenance`** — `**maint-board-layout`**, `**maint-wo-workspace-grid**`, `**maint-form-grid**`, and `**maint-vendor-ref-row**` gain `**min-width: 0**` so board / WO / vendor rows cooperate with `**minmax(0, …)**` tracks and flex shrink without widening the page.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-11

- **Rule 0:** `**app-theme.css`** — Restored the text-token sweep where stacks had reappeared; also dropped legacy second hops on `**--color-border`** / `**--line-strong**`, `**--color-bg-page**` / `**--bg**`, `**--color-app-frame-border**` / `**--app-frame-border**`, `**--color-border-focus**` / `**--accent**`, and `**--color-modal-backdrop**` / raw `**rgba(...)**` so values resolve through `**design-tokens.css**` only.
- **Rule 1:** `**body.erp-maintenance .maint-form-grid__row`** — `**min-width: 0`** on the row grid so `**minmax(0, 1fr)**` columns in `**maint-form-grid__row--3**` can shrink inside narrow shells.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-12

- **Rule 0:** `**maintenance.html`** — Inline styles, template literals, and small JS style maps now use token-only `**var(--color-text-label)`**, `**var(--color-text-body)**`, `**var(--color-text-primary)**`, `**var(--color-border)**`, `**var(--color-bg-card)**`, `**var(--color-bg-header)**`, and `**var(--color-bg-hover)**` (removed `**var(--muted)` / `var(--text)` / `var(--line)` / `var(--panel)**` hops and redundant hex on `**--color-bg-header**` / `**--color-bg-hover**`).
- **Rule 0:** `**app-theme.css`** — Full Rule 0 pass on the shared sheet: `**var(--color-border, var(--line))`**, `**var(--color-bg-card, var(--panel))**`, `**var(--color-bg-page, var(--bg))**`, `**var(--color-bg-header|hover, #…)**`, text stacks (`**--muted` / `--text` / `--text-secondary**`), `**var(--color-nav-bg, #16213e)**`, and the WO banner `**color-mix**` hairline now resolve through `**design-tokens.css**` names only; file header comment updated to match (no redundant `**var(--color-foo, var(--legacy))**` guidance).

**Files:** `public/maintenance.html`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-13

- **Rule 0:** `**public/maintenance.html`** — Re-normalized inline / template / JS string styles after stack regressions: `**--color-text-*`**, `**--color-border**`, `**--color-bg-card**`, `**--color-bg-header**`, `**--color-bg-hover**` use token names only (no `**var(--muted)` / `var(--text)` / `var(--line)` / `var(--panel)**` or redundant hex).
- **Rule 0:** `**public/css/maint-accounting-ui-2026.css`** — Accounting action strip, board chrome, QB panels, and related selectors now use `**var(--color-border)`**, `**var(--color-bg-card)**`, `**var(--color-bg-page)**`, `**var(--color-text-label|body|primary)**`, `**var(--color-bg-hover|header)**` only (same patterns as the shared theme sheet).
- **Rule 0:** `**public/css/app-theme.css`** — `**var(--color-nav-bg, #16213e)`** → `**var(--color-nav-bg)**`; file comment no longer references Agent A status docs or recommends a hex fallback stack for nav.

**Files:** `public/maintenance.html`, `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-14

- **Rule 0:** `**app-theme.css`** — Large regression sweep: removed `**var(--color-*, var(--line|panel|bg|text|muted|accent|app-frame-border))`** chains, `**--color-bg-header|hover` + hex**, `**--color-nav-bg` + hex**, hub (`**--color-hub-*` + hex**), semantic + soft-border (`**--color-semantic-*`**, `**--color-*-border-soft` + hex**), `**--color-modal-backdrop` + rgba**, and text stacks; `**maint-wo-banner`** hairline `**color-mix`** uses `**var(--color-text-primary)**` only. File header now states Rule 0 without referencing Agent A status docs.
- **Rule 0:** `**maint-accounting-ui-2026.css`** — Same token-only treatment: borders, surfaces, page background, text, focus (`**--color-border-focus`**), and header/hover backgrounds align with `**design-tokens.css**` (no legacy `**--line` / `--panel` / `--bg` / `--accent**` hops).
- `**maintenance.html`:** Verified clean (no `**var(--color-*, var(--…))`** regressions in the current tree).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-15

- **Rule 0 / hygiene:** `**app-theme.css`** — Header comment refreshed again: no embedded example legacy stacks, no Agent A doc pointer; references `**design-tokens.css`** and the smoke Rule 0 guard.
- **Smoke:** `**scripts/system-smoke.mjs`** — After static CSS needle checks, a Rule 0 guard GETs `**app-theme.css`** and `**maint-accounting-ui-2026.css**` and fails if forbidden substring regressions appear (common `**var(--color-*, var(...))**` merges).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-16

- **Rule 0:** `**maintenance.html`** — Token-only pass on inline / template / script strings (`**--color-text-*`**, `**--color-border**`, `**--color-bg-card**`, `**--color-bg-header**`, `**--color-bg-hover**`) and link / SVG accents (`**var(--color-border-focus)**` without `**var(--accent)**`).
- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneRuleZeroGuard(path, accept)`** runs after static needles; `**RULE0_GUARD_FETCHES**` includes `**/maintenance.html**`. `**RULE0_FORBIDDEN_SUBSTRINGS**` adds compact comma forms, common `**--color-*` + `#**` prefixes, `**var(--color-modal-backdrop, rgba**`, and the prior `**var(--color-*, var(...))**` list.

**Files:** `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-17

- **Smoke:** `**scripts/system-smoke.mjs`** — `**RULE0_FORBIDDEN_SUBSTRINGS`** adds compact forms without spaces after commas (`**var(--color-border,var(--line))**`, `**var(--color-text-primary,var(--text))**`, etc.). Successful `**STATIC_TEXT**` responses cache `**bodyText**` so `**oneRuleZeroGuard**` reuses bytes for `**app-theme.css**` and `**maint-accounting-ui-2026.css**` (one fewer HTTP GET each). Extracted `**ruleZeroForbiddenHits(text)**` for clarity.

**Files:** `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-18

- **Smoke:** `**scripts/system-smoke.mjs`** — `**oneHtml`** now returns `**bodyText**`; when `**/maintenance.html**` passes its needle list, that body is stored in `**ruleZeroBodyCache**` so `**oneRuleZeroGuard**` does not fetch maintenance again (third cached guard line). `**RULE0_FORBIDDEN_SUBSTRINGS**` adds `**var(--color-text-body,var(--text-secondary))**`.

**Files:** `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-19

- **Smoke / tooling:** Shared list `**scripts/rule-zero-agent-b.mjs`** exports `**RULE0_FORBIDDEN_SUBSTRINGS`** and `**ruleZeroForbiddenHits**`, imported by `**system-smoke.mjs**` so HTTP and disk checks stay aligned. New forbidden entries: `**var(--color-bg-card, var(--bg-elevated))**` (compact + spaced) and `**var(--color-nav-bg, var(--sidebar-bg))**` (compact + spaced).
- **Offline CI:** `**scripts/rule-zero-agent-b-check.mjs`** reads `**public/css/app-theme.css`**, `**public/css/maint-accounting-ui-2026.css**`, and `**public/maintenance.html**` from the repo and exits `**1**` on any hit — run via `**npm run rule0:check**` without `**npm start**`.

**Files:** `scripts/rule-zero-agent-b.mjs`, `scripts/rule-zero-agent-b-check.mjs`, `scripts/system-smoke.mjs`, `package.json`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-20

- **CI:** `**.github/workflows/rule0-check.yml`** — Runs `**npm run rule0:check`** on `**push` / `pull_request**` (Ubuntu, Node 20); no `**npm ci**` so the job stays fast and dependency-free. *(Push trigger broadened to all branches on 2026-05-21.)*
- **Docs in CSS:** `**app-theme.css`** file header now points maintainers at `**rule0:check*`*, HTTP smoke, and `**scripts/rule-zero-agent-b.mjs**` as the shared forbidden list.

**Files:** `.github/workflows/rule0-check.yml`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-21

- **CI:** `**.github/workflows/rule0-check.yml`** — `**push`** now runs on **all branches** (not only `**main` / `master`**), so feature-branch commits get the same Rule 0 scan; `**pull_request`** unchanged.
- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-semantic-{success,error,warning,warn-accent}, #`** prefixes (duplicate hex after semantic tokens; values belong in `**design-tokens.css**` only).

**Files:** `.github/workflows/rule0-check.yml`, `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-22

- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-success-border-soft, #`** / `**var(--color-warning-border-soft, #**` and hub token `**var(--color-hub-{accent,bg-deep,text,card}, #**` (duplicate hex; hub + soft borders live in `**design-tokens.css**` only).
- **Log hygiene:** `**## 2026-05-20`** CI bullet clarified (push filter note points at **2026-05-21**).

**Files:** `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-23

- `**package.json`:** `**npm test`** runs `**npm run rule0:check`** so generic CI / local `**npm test**` hits the Agent B disk guard without a server.
- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Forbid `**var(--color-bg-page|bg-card, #`** and `**var(--color-text-primary|body|label, #**` (hex chained after `**--color-***` ink/surface roles).
- **CI:** `**.github/workflows/rule0-check.yml`** — `**workflow_dispatch`** for manual runs from the Actions tab; job step invokes `**npm test**` (same as `**rule0:check**`).

**Files:** `package.json`, `scripts/rule-zero-agent-b.mjs`, `.github/workflows/rule0-check.yml`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-17

- **Rule 0 list:** `**scripts/rule-zero-agent-b.mjs`** — Mirror `**, #`** / `**, rgba**` forbidden entries with **no space after the comma** (e.g. `**var(--color-bg-page,#`**, `**var(--color-modal-backdrop,rgba`**) so minified or hand-tightened CSS cannot bypass the guard.
- **Log hygiene:** Removed duplicate `**## 2026-05-23`** block (same bullets appeared twice).

**Files:** `scripts/rule-zero-agent-b.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-18

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0`** on `**acct-dash-kpi**`, `**acct-dash-card**`, `**mr-upload-conn-card**` (children of `**repeat(auto-fit, minmax(…, 1fr))**` grids) and on `**maint-qb-cost-details__sum**` (flex summary row) so long labels / numeric copy can shrink inside the column instead of forcing page-level horizontal scroll.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-19

- **Rule 1:** `**public/css/app-theme.css`** — `**qb-picker-item__label`** gets `**min-width: 0**` plus `**overflow: hidden**` / `**text-overflow: ellipsis**` so long vendor or account names do not widen the QB combobox row past the menu; `**body.erp-maintenance .title**` gets `**min-width: 0**` so the topbar flex row can shrink on narrow widths.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**erp-topbar .title`** and `**maint-wo-form-stack-inner**` get `**min-width: 0**` (compact accounting topbar + WO form stack shrink with the shell).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-20

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**maint-wo-columns`** and `**maint-fleet-inline**` get `**min-width: 0**` so the WO workspace row and inline fleet controls can shrink inside the maintenance shell without forcing horizontal overflow.
- **Rule 1:** `**public/css/app-theme.css`** — `**erp-drawer`** gets `**min-width: 0**`; `**erp-drawer__head**` gets `**min-width: 0**`; `**erp-drawer__title**` gets `**min-width: 0**` with ellipsis so long “Add new” titles stay inside the drawer chrome beside the close control.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-21

- **Rule 1:** `**public/css/app-theme.css`** — `**erp-drawer__body`** gets `**min-width: 0**` so the scrollable drawer column respects flex shrink; `**body.erp-maintenance .panel-title**` gets `**min-width: 0**` so long panel headings cooperate with `**panel-head**` flex / wrap instead of widening the row.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**mr-upload-panel-card`** gets `**min-width: 0**` so upload-center cards stay within narrow viewports when stacked beside other columns.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-22

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0`** on `**maint-kpi-card**` (compact KPI grid cells), `**maint-aside-kv**` (WO aside key/value flex rows), and `**maint-form-actions__meta**` (footer meta flex row) so dense maintenance chrome can shrink inside `**minmax(0, 1fr)**` / flex parents without widening the viewport.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-23

- **Rule 1 (grid tracks):** `**public/css/app-theme.css`** — Maintenance shell `**grid-template-columns: 260px 1fr`** → `**260px minmax(0, 1fr)**`; WO / QB line grids and header use `**minmax(0, 1.3fr)**` / `**minmax(0, 1.1fr)**` instead of bare `**fr**` so fractional columns respect `**min-width: 0**` semantics; `**qb-doc-memo-row**` uses `**minmax(0, 1fr)**` pair; large-viewport `**#woLines .wo-line-grid**` override and **print** `**.app`** column updated the same way.
- **Rule 1 (flex + items):** `**qb-lines-actions`**, `**qb-doc-actions`** child flex groups, `**list**`, `**hero-card**`, and narrow (`**max-width: 800px**`) single-column dashboard grids use `**min-width: 0**` or `**minmax(0, 1fr)**` so list shells and doc chrome do not widen the main column.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-24

- **Rule 1 (responsive / print grids):** `**public/css/app-theme.css`** — Normalized remaining maintenance `**grid-template-columns: 1fr`**, `**1fr 1fr**`, and `**1fr !important**` declarations inside `**@media**` and **print** rules to `**minmax(0, 1fr)`** (or paired `**minmax(0, 1fr) minmax(0, 1fr)`**) so collapsed layouts (WO form rows, board layout, shop kanban, fuel import split, print WO, etc.) inherit the same minimum track semantics as the primary `**minmax(0, …)**` grids.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-25

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — In the `**max-width: 900px`** accounting block (includes QBO Live Master `**#acct-qbo**` stack rules), `**grid-template-columns: 1fr**` for the stacked `**.grid-3**` (panels) and `**.search-row**` now uses `**minmax(0, 1fr)**`, matching the `**app-theme.css**` responsive grid convention.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-26

- **Rule 1 (auto-fit / auto-fill grids):** Replaced `**minmax(<px>, 1fr)`** with `**minmax(min(100%, <px>), minmax(0, 1fr))`** on maintenance accounting KPI/cards grids, upload connection grid, maintenance hero and expense strips, QB logistics bar, and global `**.vendor-link-grid**` so track minimums cap at the container width and `**fr**` tracks can shrink without forcing horizontal overflow.
- `**public/css/maint-accounting-ui-2026.css**` — `**acct-dash-kpis**`, `**acct-dash-cards**`, and `**mr-upload-conn-grid**` also get `**min-width: 0**` on the grid host where missing.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-27

- **Rule 1:** `**public/css/app-theme.css`** — `**#woLines .wo-line-grid`** auto-fill override now ends with `**minmax(0, 1fr)**` (was trailing `**1fr**`). `**maint-cost-lines-head**`, `**maint-cost-line__primary**`, and the `**max-width: 1100px**` shared override use `**minmax(min(100%, …), minmax(0, 1fr))**` (and `**minmax(0, 2.2fr)**` for the description column) so cost-line grids behave like the other hardened maintenance tracks on narrow widths.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-28

- **Rule 1:** `**public/maintenance.html`** — Inline flex hosts (`**#acctBoardStrip**` header row, `**#apTxnQboBanner**`, `**#expHistQboBanner**`) get `**min-width: 0**` so title + help tips / banner rows shrink inside the accounting column.
- `**paintQboStatusBanner**` / `**paintApTxnQboBanner**` set `**el.style.minWidth = '0'**` when showing a banner so scripted `**display**` toggles keep the same shrink behavior as CSS.

**Files:** `public/maintenance.html`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-29

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acctBoardStrip**` / `**.mr-acct-board**` and `**.mr-filter-bar__grow**` get `**min-width: 0**` so accounting board chrome and filter rows (including inline `**display:flex**` blocks) shrink inside the main column without relying on each inline style.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-30

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0**` on `**maint-qbo-header-grid**`, `**#erpConnectionStrip**`, `**erp-topbar__actions**`, `**shop-wo-fallback**`, `**erp-reports-toolbar__actions**`, and `**mr-qbo-banner__right**` where they carry `**print-hide-actions**` (or the QBO header helper) so connection strip, shop fallbacks, and toolbar action clusters participate in flex/grid shrink on narrow viewports.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-01

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**mr-filter-bar**`, `**mr-filter-bar__right**`, `**mr-filter-bar__chips**`, and `**mr-filter-bar__show**` get `**min-width: 0**` so ops / fleet / security filter rows shrink beside `**mr-filter-bar__grow**` on narrow widths.
- **Rule 1:** `**public/css/app-theme.css`** — `**qb-doc-h2**` gets `**min-width: 0**` inside `**qb-doc-title-row**` flex so long AP/Bill titles do not widen the doc header.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-02

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**qb-doc-shell**`, `**qb-doc-head**`, `**qb-doc-body**`, `**qb-doc-total-block**`, and `**qb-lines-wrap**` so QB-style expense/bill shells and line tables participate in the accounting column’s shrink chain (with `**qb-doc-title-row**` / `**qb-doc-h2**`).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-03

- **Rule 1:** `**public/css/app-theme.css`** — `**qb-panel**` and `**qb-attach-box**` get `**min-width: 0**`; `**erp-iframe**` gets `**min-width: 0**` + `**max-width: 100%**` (embedded tracking / fuel views); `**fuel-exp-table-wrap**` gets `**min-width: 0**` so scroll regions sit correctly inside flex/grid parents.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-04

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**.table-wrap**`, `**.safety-table-wrap**`, `**.safety-active-grid**`, and `**.shop-col-head-row**`; `**#erpTrackingMap**` gets `**min-width: 0**` + `**max-width: 100%**` so wide tables and the map host shrink inside the maintenance main column instead of widening the viewport.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-05

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**.shop-col-body**` and `**.nav-dropdown-menu**` (scroll regions); WO full-screen modal `**maint-workorder-fullmodal__shell**` / `**__head**` / `**__body**` get `**min-width: 0**` and `**__body**` gets `**min-height: 0**` so the flex column layout scrolls correctly on small viewports.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-06

- **Rule 1:** `**public/css/app-theme.css`** — Shared `**hero-card` / `panel` / `metric` / `record-card**` surface rule now includes `**min-width: 0**` (duplicate removed from `**hero-card**` only); `**panel-body**` and sidebar `**brand-sub**` get `**min-width: 0**` so default maintenance panels and sidebar copy shrink inside the shell grid.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-07

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**section.active**` (maintenance section host), sidebar `**brand**`, maintenance `**qb-picker-menu**`, `**maint-modal-bg**` / `**maint-modal**`, and `**maint-workorder-fullmodal__title**` so modals, picker popovers, and WO full-modal titles respect narrow viewports and flex centering.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-08

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0**` on WO `**maint-search-row**`, `**maint-wo-summary-bar**`, units column / nested `**panel**`, `**maint-wo-placeholder**`, accounting dash `**acct-dash-card__btnrow**` / `**acct-dash-tools-grid**`, AP `**ap-exp-row**` / `**ap-lines-section-label**` / `**ap-attach-head**`, fuel manual title, QB cost label row, upload `**mr-upload-tabbar**` / `**mr-upload-pickline**` / `**mr-upload-conn-card__actions**`, and `**maint-qb-cost-totals-bar**`. `**maint-wo-col-form**` gets `**min-height: 0**` so the flex column scroll region can shrink inside `**maint-wo-columns**`.
- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**iframe-wrap**`, `**catalog-subpanel.active**` / `**upload-subpanel.active**`, `**shop-tab-panel.active**` / `**shop-col**`, `**asset-cat-grid**`, compact KPI strip grid, asset header IDs row, status panel head, cost-line QB rows (`**maint-cost-line__acct**` / `**extras**` / `**maint-cost-qbo-custclass**`), `**maint-wo-split**`, `**maint-wo-banner**`, and `**maint-save-toolbar__actions**`; `**maint-main-tab-panel.active**` matches other visible tab hosts.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-09

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on cost coordination (`**maint-cost-coordination**` + `**.coord-row**`), accounting fuel relay preview (`**acct-fuel-import-preview**`), reports `**.rep-maint-detail-filters.wo-line-grid**` in the ≤768px column layout, and cost line `**maint-cost-line__billable**`.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**min-width: 0**` on `**maint-qb-cost-details**`, horizontal scroll frame `**maint-qb-lines-scroll**`, toast column `**erp-toast-host**`, `**acct-conn-sb__row**`, table cell `**maint-qb-bill-lbl**`; segment control `**erp-qb-seg**` gets `**max-width: 100%**` with `**min-width: 0**` so `**width: fit-content**` cannot widen the doc column past the viewport.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-10

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#maintIntegrationStrip**` and its first child row (**Connections** inline flex in `**maintenance.html`**) get `**min-width: 0**` so the accounting board card does not widen the viewport when status text and the checkbox label wrap together.
- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**.erp-main-body .erp-ops-toolbar**` and `**.erp-reports-toolbar**` so dense maintenance / tracking / safety ops bars and the reports hub toolbar respect the capped main column next to spec/redesign flex rules.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-11

- **Rule 1:** `**public/css/app-theme.css`** — `**min-width: 0**` on `**.erp-ops-subtabs-bar**`, `**.erp-reports-toolbar__title**`, and `**.erp-reports-toolbar__search**`; WO `**.maint-panel-head-center**` (inherits flex from `**.panel-head**`); save toolbar split `**.maint-save-toolbar--qb .qb-split**` gets `**min-width: 0**` + `**max-width: 100%**` so the primary/caret control does not force the sticky save row wider than the form column.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — global `**body.erp-maintenance .erp-table-scroll { min-width: 0 }**` so wide-data tables (shop + any other module using the shared scroll frame) shrink inside flex/grid parents, not only under `**#section-maintenance .shop-tab-panel**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-12

- **Rule 1:** `**public/css/app-theme.css`** — Accounting `**.qb-doc-topbar**` / `**.qb-doc-topbar--fuel**`, AP/fuel `**.qb-doc-footer--ap**` / `**--fuel**`, and `**.qb-doc-footer__left**` / `**__right**` get `**min-width: 0**` so doc chrome stays within `**#section-accounting**` width; maintenance `**.qb-picker-item**` rows get `**min-width: 0**` next to the existing ellipsis on `**.qb-picker-item__label**`.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#erpApp.erp-master .erp-topbar.topbar**` gets `**min-width: 0**` so the master-layout topbar flex row respects the main column when spec/redesign set `**display: flex**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-13

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .erp-reports-sidebar**` joins shell/columns/main on `**min-width: 0**` so the two-column reports layout can shrink on narrow main columns; `**#acct-bill-pay**` `**.mr-bp-panel-head**`, `**.mr-bp-hintrow**`, and `**.mr-bp-submitrow**` get `**min-width: 0**` at all breakpoints (not only the ≤900px padding tweaks).
- **Rule 1:** `**public/css/app-theme.css`** — WO `**.maint-wo-save-split-wrap**` (`**inline-flex**`) gets `**min-width: 0**` + `**max-width: 100%**` so split save controls align with `**.maint-save-toolbar--qb .qb-split**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-14

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acct-bill-pay .mr-bp-panel-head__title**` gets `**min-width: 0**`; `**#acct-expense-history**` `**.panel-head**` and its direct child flex row get `**min-width: 0**`; `**#acct-qbo-rollback**` `**.panel-head**` and `**.panel-title**` get `**min-width: 0**` so expense history and rollback tab chrome matches other accounting overflow-safe patterns.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-15

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#acct-expense-history .panel-head > div > div:last-child**` (**Apply filters** / **Export** column) gets `**min-width: 0`**; `**#acct-qbo-rollback .panel-body .panel-head > div**` for subsection import-batch headers; `**#acct-qbo .panel-head**` for Live Master outer head and **Vendors / Items / Accounts** column mini-heads.

**Files:** `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-16

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — Reports hub `**.erp-reports-hub**`, `**.erp-reports-hub__tiles**` / `**__tiles--dense**`, `**.erp-reports-hub__card**`, and `**.erp-reports-hub__tile**` under `**#section-reports**` get `**min-width: 0**` so the tile grid respects `**erp-reports-main**` width.
- **Rule 1:** `**public/css/app-theme.css`** — WO `**.maint-subcard**` and `**.maint-subcard__body**` get `**min-width: 0**` so nested form blocks stay inside the main column.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-17

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — Reports `**.erp-reports-hub__tile-title**` / `**__tile-meta**`, sidebar `**.mr-rep-nav-group**` (with `**__head**` / `**__body**`), and each `**.reports-tab**` panel get `**min-width: 0**` under `**#section-reports**`.
- **Rule 1:** `**public/css/app-theme.css`** — Cost coordination `**.coord-total**` gets `**min-width: 0**` so large totals wrap inside `**.coord-row**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-18

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-uploads**` `**.panel-head**` / `**.panel-head > div**` and `**.mr-upload-panel-title**` get `**min-width: 0**` for inline-flex upload headers in `**maintenance.html**`.
- **Rule 1:** `**public/css/app-theme.css`** — Tracking `**.track-card**` gets `**min-width: 0**` inside `**track-grid**`; `**.erp-reports-toolbar__actions**` gets `**min-width: 0**` so the action cluster wraps inside the reports toolbar row.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-19

- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-catalog**` `**.panel-head**` / `**.panel-head .panel-title**` and `**.catalog-subpanel > div:first-child**` (**mini-note** + help intro rows) get `**min-width: 0`** so Lists & catalogs chrome matches upload/accounting overflow-safe patterns.
- **Rule 1:** `**public/css/app-theme.css`** — Maintenance tire diagram `**.tire-svg**` gets `**min-width: 0**` inside `**tire-layout-wrap**`.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-20

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance**` `**.catalog-add-card**` / `**__head**` / `**__title**` / `**__body**` get `**min-width: 0**` for flex heads and form bodies in Lists & catalogs; `**#section-dashboard**` and `**#section-fuel**` `**.panel-head > div**` for inline-flex panel titles; `**#section-safety**` `**.tracking-sub > div:first-child**` (tab intro rows) and `**.safety-active-grid > div > div:first-child**` (per-column title rows).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-21

- **Rule 1:** `**public/css/app-theme.css`** — `**#section-maintenance**` `**.maint-kpi-strip__body > div:first-child**` (workspace snapshot row), `**.unit-list-panel .panel-head**`, and `**#maintTopQboIssuesInd**`; `**#section-tracking**` `**> div:first-child**` (fleet mix strip intro), `**.tracking-sub > div:first-child**` (e.g. shop tab intros), and `**.erp-ops-hero-head**` / `**> div**` (shop board hero head).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-22

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance .shop-subtabs**` gets `**min-width: 0**` so the shop queue subtabs row can shrink inside the tracking embed column; `**body.erp-maintenance .vendor-link-grid**` gets `**min-width: 0**` so the catalog vendor link auto-fit grid respects the Lists & catalogs column; `**#section-tracking .panel-head**` and `**.panel-head > div**` get `**min-width: 0**` for map / assets / yard-idle / summary headers that use flex (including inline `**display:flex**` on `**tr-idle**` heads).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-23

- **Rule 1:** `**public/css/app-theme.css`** — `**body.erp-maintenance .safety-active-grid > div**` gets `**min-width: 0**` so each two-column track can shrink with `**minmax(0, 1fr)**` tracks; `**#section-maintenance .panel-head > div**` joins dashboard/fuel so nested flex title rows in the maintenance workspace respect the main column.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-accounting .panel-head > div**` and `**#section-catalog .panel-head > div**` get `**min-width: 0**` for AP/fuel/QBO/dash stacked panels and catalog panel wrappers (beyond tab-specific rules already present).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-24

- **Rule 1 / selector fix:** `**public/css/app-theme.css`** — Reports inner tab row rules targeted `**#section-reports > .subtabs**`, but `**maintenance.html**` nests the row as `**#repMainSubtabs**` inside `**.erp-reports-main**` (no direct `**.subtabs**` under `**#section-reports**`). Selectors are retargeted to `**#section-reports #repMainSubtabs**` so flex wrap, `**min-width: 0**`, and dropdown trigger sizing actually apply.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .panel-head**` and `**.panel-head > div**` get `**min-width: 0**` for report panels (overview, TMS, settlement, etc.) with flex title / action rows.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-25

- **Cleanup / Rule 1:** `**public/css/app-theme.css`** — Removed `**#section-accounting > .subtabs**` rules and the `**@media (max-width: 640px)**` override for them; `**maintenance.html**` has no direct `**.subtabs**` child under `**#section-accounting**` (accounting uses the board, `**accounting-tab**` panels, and SR stubs), so those rules never matched and only added confusion next to live catalog/reports subtabs styling.
- **Rule 1:** `**public/css/maint-accounting-ui-2026.css`** — `**#section-reports .erp-reports-hub__label**` gets `**min-width: 0**` so hub card column labels participate in the hub flex/grid shrink model.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.