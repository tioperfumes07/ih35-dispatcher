# Agent B — maintenance / accounting / smoke (parallel log)

Agent A merges summarized bullets into `ERP_MASTER_REDESIGN_STATUS.md`; do not edit that file from this track.

---

## 2026-04-17

- **Token sweep (Rule 0):** Removed redundant hex and `var(--line, …)` fallbacks in `public/css/maint-accounting-ui-2026.css` now that `design-tokens.css` + `erp-master-redesign.css` load first; QB / pill / border stacks resolve through `var(--color-*)`, `var(--qb-*)`, and `var(--pill-*)` only.
- **`app-theme.css`:** Normalized shared `var(--color-border, var(--line, …))` / `var(--line-strong, …)` chains to token-first stacks (`var(--color-border)` or `var(--color-border, var(--line-strong))` / `var(--line-strong)` for fills) so maintenance and satellite shells do not re-specify bare hex in those fallbacks.
- **Rule 1 (horizontal bleed):** `public/css/maint-accounting-ui-2026.css` — `#section-accounting` active section and key panel / KPI grid wrappers use `min-width: 0` so dense accounting content stays inside the main column.
- **`maintenance.html`:** Global replace of a small set of inline `style=` token stacks (e.g. `var(--color-text-body,#3c4257)` → `var(--color-text-body)`, legacy `var(--color-border,var(--line,#e2e8f0))` → `var(--color-border)`) wherever those exact patterns appeared (including accounting board strip).
- **Smoke:** `scripts/system-smoke.mjs` — maintenance HTML check now requires stable markers `section-accounting` and `acct-dash-kpis` in addition to existing needles.

**Follow-up (same day):**

- **`app-theme.css`:** Second-pass cleanup — common `var(--color-bg-card, #fff)`, `var(--color-bg-hover, #f8fafc)`, `var(--color-border, #e8eaed)`, `var(--color-border-focus, #1967d2)`, `var(--color-text-primary, #202124)`, catalog card head gradient, and `var(--color-bg-card, var(--panel|bg-elevated, #fff)))` stacks now rely on `design-tokens.css` / legacy `:root` without repeating hex in the outer `var()`.
- **`maintenance.html`:** Broader inline + JS template sweep — `var(--color-text-label,#6b7385)`, ad hoc border hexes on dividers/cards, `var(--color-border,var(--line))`, semantic / pill stacks with redundant fallbacks, and strip-board / settlement / upload / shop-queue adjacent patterns normalized to token-only `var(--color-*)` / `var(--pill-*)`.
- **Rule 1:** `maint-accounting-ui-2026.css` — `#section-reports` and `#section-uploads` active shells, panels, and key layout wrappers get `min-width: 0` (parity with accounting board pass).
- **Smoke:** Maintenance HTML needles extended with `section-uploads` and `erp-reports-shell` so regressions in those large static regions fail the GET check early.

**Files (cumulative this log date):** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`, `docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md` (§9 pointer to this log; former §9 Maintainer note renumbered to §10).

---

## 2026-04-18

- **`app-theme.css`:** Additional token-first cleanup for slate-style stacks (`var(--color-text-body, #334155)`, label grays, `#cbd5e1` / `#e2e8f0` borders → `var(--color-border-input)` / `var(--color-border)`, header grays → `var(--color-bg-header)`) used by maintenance-adjacent panels and tables.
- **`maintenance.html`:** Remaining `var(--color-text-primary,#0f172a)`, shop queue warn accent, pill green, and danger button text stacks normalized to token-only; **`paintQboStatusBanner`** / **`paintApTxnQboBanner`** tier maps now assign **`var(--color-bg-hover)`**, **`var(--pill-*-bg)`**, **`var(--color-*-border-soft)`**, **`var(--btn-danger-border)`** instead of bare hex for fills and strokes.
- **Rule 1:** `maint-accounting-ui-2026.css` — `:is(#section-dashboard, #section-fuel, #section-safety, #section-maintenance, #section-tracking, #section-catalog)` active sections plus `.panel` / `.panel-body` get **`min-width: 0`** so remaining modules match accounting / reports / uploads overflow discipline.
- **Smoke:** Maintenance HTML needles add **`section-maintenance`** and **`section-catalog`** (core shells always present in the static document).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-19

- **`app-theme.css`:** Further token cleanup on maintenance chrome — `var(--color-text-primary, #0f172a)`, modal flow title (navy via **`var(--color-app-frame-border)`**), asset picker hover ring, save-toolbar split focus / pill soft fills, semantic warn/error hints, **`var(--color-app-frame-border, var(--app-frame-border, …))`** inner hex removed, and remaining **`#ffffff`** / **`#2563eb`** / **`#93c5fd`** fallbacks folded to design tokens.
- **Rule 1:** `maint-accounting-ui-2026.css` — **`#section-maintenance .shop-tab-panel`** and nested **`.erp-table-scroll`** use **`min-width: 0`** so **`min-width:980px`** shop tables stay inside the horizontal scroll frame instead of widening the page shell.
- **Smoke:** Maintenance HTML check requires **`shopBoardSubtabs`** (stable shop board anchor next to wide queue tables).

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-20

- **`app-theme.css`:** Cleared more maintenance-only hex fallbacks — warning/success soft borders, semantic warn accent / warning accents, **`stroke: var(--muted, …)`** / **`fill: var(--accent|nav-bg, …)`**, **`var(--accent, #1d4ed8)`** in mixes, semantic success in **`color-mix`**, hero/panel gradients using **`#e8eef9` / `#eef2f9`**, **`var(--color-nav-bg, var(--app-frame-border, …))`** inner hex, and settlement table header gradient now uses **`var(--color-nav-bg)`** + **`color-mix(…, black)`** instead of literal navy stops; settlement **`th`** bottom border uses **`var(--sidebar-bg)`** without a hex fallback.
- **Rule 1:** `maint-accounting-ui-2026.css` — **`#section-accounting .maint-qb-lines-scroll`** gets **`min-width: 0`** so wide QB line tables stay inside the doc’s horizontal scroll region under flex layout.
- **Smoke:** Maintenance HTML needles include **`id="erpApp"`** so the master shell root cannot disappear without failing the static GET check.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-21

- **`app-theme.css`:** QBO sync bar, sidebar / nav dropdown, **`qb-btn-primary`**, and related stacks now use token-only **`var(--btn-danger-border)`**, **`var(--pill-*)`**, **`var(--sidebar-border|nav-hover|nav-text|sidebar-text)`**, **`var(--btn-info-border)`**, and **`var(--btn-primary-save-*)`** (hex fallbacks removed). **`.cost-total-bad`** drops the redundant raw **`#f87171`** border in favor of the existing semantic **`color-mix`** border. **`.st-settlement-wrap`** uses **`min-width: 0`**, **`border: 1px solid var(--color-border)`**, and keeps overflow clipping for settlement tables inside flex columns.
- **Smoke:** Maintenance static HTML check now also requires **`section-dashboard`** and **`section-fuel`** alongside the existing section markers.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-22

- **`app-theme.css`:** Dispatch **`banner.err`**, maintenance **`.sec-alert-*`**, save-toolbar **`.qb-split--primary|neutral`**, and sidebar copy still using hex fallbacks (**`#fecaca`**, **`#f8fafc`**, **`#15803d`**, **`#94a3b8`**, **`#dc2626`**, **`#2563eb`**) now rely on **`var(--btn-danger-border)`**, **`var(--sidebar-text|muted)`**, **`var(--btn-primary-save-bg)`**, **`var(--pill-red-text|pill-blue-text)`** only. **`var(--color-bg-card, var(--panel))`** simplified to **`var(--color-bg-card)`** wherever that pair appeared. **`.qb-split--primary .qb-split__main`** green gradient uses **`var(--btn-primary-save-bg)` → `var(--btn-primary-save-hover)`** instead of raw Tailwind-style hex stops.
- **Rule 1:** **`body.erp-maintenance .maint-save-toolbar--qb`** gains **`min-width: 0`** so the save/post strip can shrink inside narrow WO / modal columns without forcing horizontal overflow.
- **Smoke:** Maintenance HTML needles add **`section-safety`** and **`section-tracking`** (ops sections always present in the static shell).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-23

- **`app-theme.css`:** Company **`.hub-page`** drops the redundant legacy radial + **`#0c1220`** base layer; hub **`color-mix`** / text now use **`var(--color-hub-accent|hub-card|hub-text|hub-bg-deep)`** without hex fallbacks. **`.cost-total-bad`** border **`color-mix`** uses **`var(--color-bg-card)`** instead of **`#ffffff`**. QB split **primary `.qb-split__caret`** gradient aligns with **`var(--btn-primary-save-bg)` / `var(--btn-primary-save-hover)`**. Print **`@media`** block no longer declares a raw **`#fff`** background before the token line.
- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`#section-maintenance .maint-page-shell`** adds **`min-width: 0`** alongside **`min-height: 0`** for flex shrink in the WO workspace.
- **Smoke:** Maintenance HTML needles include **`maint-action-strip`**.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-24

- **`maintenance.html`:** Sidebar QuickBooks / desktop-notification and sync-alert brief text colors now use **`var(--color-success-border-soft)`**, **`var(--pill-red-text)`**, and **`var(--color-warning-border-soft)`** instead of raw Tailwind-style hex. **Tracking map** **`L.circleMarker`** stroke/fill read **`--color-border-focus`**, **`--color-hub-accent`**, and **`--color-text-label`** from **`getComputedStyle(document.documentElement)`** so markers follow **`design-tokens.css`** while keeping safe string fallbacks if a token is missing.
- **Smoke:** Maintenance HTML needles add **`maint-page-shell`** (WO workspace root next to the action strip).

**Files:** `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-25

- **`maintenance.html`:** **`ERP_WRENCH_ICON`** / **`ERP_PUMP_ICON`** inline SVG paths use **`fill="var(--pill-green-text)"`** and **`fill="var(--color-border-focus)"`** instead of hard-coded greens/blues.
- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`body.erp-maintenance #erpApp.erp-master .erp-main-col`** gets **`min-width: 0`** as a defensive flex shrink hook (harmless if **`erp-master-spec`** already sets it).
- **Smoke:** Maintenance HTML needles add **`id="erpToastHost"`** and **`id="qboSyncAlertBar"`** so toast host + QBO sync strip cannot be removed without failing the static GET check.

**Files:** `public/maintenance.html`, `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-26

- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`#erpApp.erp-master .main.erp-main-surface`** and **`.erp-main-body`** now include **`min-width: 0`** alongside **`.erp-main-col`**, so the topbar + scroll column stack cannot force the master shell wider than the viewport under nested flex/grid content.
- **Smoke:** Maintenance HTML check requires **`id="acctBoardStrip"`** (accounting board strip anchor next to **`acct-dash-kpis`**).

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-27

- **`app-theme.css`:** **`.erp-drawer`** scroll column — **`erp-drawer__body`** is now **`flex: 1 1 auto`** with **`min-height: 0`** so long create-menu / injected form content scrolls inside the drawer instead of stretching past the fixed **`100vh`** shell (drawer is maintenance-only in this repo’s HTML shells).
- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`#erpApp.erp-master .erp-topbar__search-inner`** gets **`min-width: 0`** so the global search field can shrink next to dense **`erp-topbar__actions`** on narrow widths.

**Files:** `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-28

- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`#erpApp .erp-new-menu__cols`** gets **`min-width: 0`** so the three-column **+ New** flyout flex row respects the menu’s **`min(…vw, 860px)`** cap without forcing extra horizontal overflow.
- **Smoke:** **`scripts/system-smoke.mjs`** — after HTML page checks, **`oneStatic()`** GETs **`/css/maint-accounting-ui-2026.css`** and **`/css/app-theme.css`** and asserts stable header substrings (**`Maintenance center action strip`**, **`IH35 — shared visual language`**) so a broken `public/` mount fails CI before paint.

**Files:** `public/css/maint-accounting-ui-2026.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-29

- **Rule 1:** **`maint-accounting-ui-2026.css`** — **`maint-action-strip`** / **`maint-action-strip__qbo`** get **`min-width: 0`** so the WO maintenance shell’s flex column does not inherit an implicit min-content width from long QBO copy or many strip buttons. **`#erpApp.erp-master .erp-topbar__search`** and **`.erp-topbar__actions`** also get **`min-width: 0`** (after **`erp-topbar__search-inner`**) so the ERP master top bar can narrow below the redesign search floor when the main column is tight.
- **Rule 0:** **`maint-accounting-ui-2026.css`** — active strip button ring uses **`color-mix`** on **`--color-border-focus`** instead of a hard-coded blue **`rgba`**. **`app-theme.css`** — maintenance form control focus halo uses the same token-driven **`color-mix`** pattern.

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-04-30

- **Rule 0:** **`maint-accounting-ui-2026.css`** — **`.erp-toast`** uses **`var(--shadow-toast)`** from **`design-tokens.css`** instead of a bespoke **`rgba`** stack. **`.maint-form-actions--sticky`** edge lift uses **`color-mix`** on **`--color-text-primary`** instead of neutral black **`rgba`**.
- **Rule 1:** **`maint-accounting-ui-2026.css`** — toast cards cap width with **`min(400px, calc(100vw - 32px))`** and allow a shrinking floor with **`min(280px, calc(100vw - 32px))`** on **`min-width`**, so fixed toasts do not force horizontal overflow on narrow phones.
- **`app-theme.css`** — **`.cost-total-ok`** / **`.cost-total-bad`** drop the dead first **`box-shadow`** declaration (keep token **`color-mix`** rings only).

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-01

- **`app-theme.css`:** Removed dead “first **`box-shadow`** / **`background`**” duplicates where a second line already applied **`var(--shadow-drawer)`**, **`var(--color-modal-backdrop)`**, **`var(--shadow-dropdown)`** (`.erp-drawer`, `.erp-drawer__backdrop`, maintenance **`.nav-dropdown-menu`**, **`.maint-modal-bg`**, **`.maint-save-toolbar--qb .qb-split__menu`**).
- **Smoke:** **`scripts/system-smoke.mjs`** — **`STATIC_TEXT`** now GETs **`/css/design-tokens.css`** and asserts the stable header line **`IH35 ERP — Master spec design tokens (Rule 0).`** so a missing or truncated token file fails CI alongside theme and maintenance CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-02

- **`app-theme.css` (Rule 0):** Dropped shadow/background/border “first line” duplicates that were always overridden — **`.hub-page .grid a.card`** (+ **`:hover`**), **`.qb-picker-menu`**, maintenance sidebar **`.nav-btn:hover`** / **`.active`**, **`.nav-dd-item:hover`**, and **`.maint-board-nav__btn:hover`**. Each rule now keeps a single token-driven **`color-mix`** or **`var(--shadow-dropdown, …)`** declaration.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-03

- **`app-theme.css` (Rule 0):** **`.maint-wo-banner`** hairline shadow uses **`color-mix`** on **`--color-text-primary`** instead of slate **`rgba`**. **`.maint-save-toolbar--qb .qb-split__caret`** uses a single **`border-left`** with **`color-mix`** on **`--color-bg-card`** instead of **`rgba(255,255,255,…)`** plus a second **`border-left-color`** override.
- **Smoke:** **`scripts/system-smoke.mjs`** — **`STATIC_TEXT`** includes **`/css/board-nav.css`** with needle **`Persistent operations bar`** (matches **`board-nav.css`** header comment).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-04

- **Rule 1:** **`app-theme.css`** — **`.qbo-sync-alert-bar .qbo-sync-actions`** and **`body.erp-maintenance .maint-top-toolbar__inner`** get **`min-width: 0`** so wrapped flex rows do not widen parent shells from intrinsic min-content.
- **Rule 0:** **`app-theme.css`** — **`.qbo-sync-alert-bar .qbo-sync-meta`** uses **`var(--color-text-label)`** (banner is maintenance-only; **`design-tokens.css`** is always loaded there).
- **Smoke:** **`scripts/system-smoke.mjs`** — **`oneStatic()`** accepts an optional **`Accept`** header; **`STATIC_TEXT`** adds **`/js/erp-ui.js`** with needle **`IH35 ERP — shared UI helpers`** and a broad **`Accept`** value so a missing **`public/js`** mount fails CI alongside CSS.

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-05

- **Rule 1:** **`app-theme.css`** — legacy maintenance shell **`.app`** (sidebar + main grid) gets **`min-width: 0`** so the page can shrink inside nested viewports without the grid’s default min-content floor forcing horizontal scroll. **`sidebar-brand-row`** and **`.topbar`** get **`min-width: 0`** so dense sidebar chrome and classic topbars cooperate with **`flex-wrap`** without widening the column.
- **Smoke:** **`scripts/system-smoke.mjs`** — **`STATIC_TEXT`** adds **`/js/board-nav.js`** with stable substring **`Fuel & route planning`** (first board entry in that bundle).

**Files:** `public/css/app-theme.css`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-06

- **Rule 1:** **`app-theme.css`** — legacy maintenance **`.split`** uses **`minmax(0, 1fr)`** for the fluid column (was plain **`1fr`**) plus **`min-width: 0`** on the grid so the list + detail pattern cannot force extra horizontal overflow. **`hero-grid`**, **`.toolbar`**, **`.search-row`**, and **`.unit-summary`** grids get **`min-width: 0`** so **`minmax(0, 1fr)`** tracks can actually shrink inside narrow shells.
- **Rule 0:** **`app-theme.css`** — **`body.erp-maintenance .list-sub`** reads **`var(--color-text-label)`** only (maintenance loads **`design-tokens.css`**).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-07

- **Rule 1:** **`app-theme.css`** — legacy maintenance **`.grid`**, **`.panel-head`**, and **`.chips`** get **`min-width: 0`** so nested **`minmax(0, 1fr)`** grids and chip rows do not inherit min-content width from flex/grid parents.
- **Rule 0:** **`app-theme.css`** — under **`body.erp-maintenance`**, drop redundant **`var(--muted)`** / legacy accent fallbacks where **`design-tokens.css`** already defines the stack (**`.hero-card p`**, **`.metric-label`**, **`.table-wrap th`**, general **`th`**, **`.unit-box .k`**, **`.chip.active`**, **`.list-row.active`**) and use **`var(--color-app-frame-border)`** alone on **`.panel-head`** (same maintenance-only assumption).

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-08

- **Rule 0:** **`app-theme.css`** — legacy maintenance chrome: **`.title`**, default **`.btn` / `button` / `input` / `select` / `textarea`** text colors use spec tokens only (**`--color-text-primary`**, **`--color-text-body`**). Button hover border uses **`--color-border-input`** (replacing **`--color-border` + `--line-strong`**). **`.status-*`** pills use **`--pill-*`** tokens only. **`.mini-note`** uses **`--color-text-label`**. **`.record-card:hover`** border uses **`--color-border-input`** for a slightly stronger edge than the resting card border.
- **Rule 1:** **`app-theme.css`** — **`form-stack`**, **`card-list`**, **`record-head`**, and **`subtabs`** get **`min-width: 0`** so dashboard cards and subtabs do not widen the main column from intrinsic min-width.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.

---

## 2026-05-09

- **Rule 1:** **`app-theme.css`** — WO / tracking / tires: **`.tire-layout-wrap`** and **`.track-grid`** use **`minmax(0, 1fr)`** for the fluid column plus **`min-width: 0`** where missing; **`.track-list`**, **`.maint-form-stack`**, **`.maint-expense-strip`**, **`.shop-queue-row`**, **`.maint-board-nav`**, **`.maint-repair-chip-row`**, **`.vendor-row-maint`**, **`.shop-action-row`**, **`.shop-board-grid`**, **`.wo-line-grid`**, **`.maint-cost-line__primary`**, **`.maint-cost-lines-head` / `-footer`**, **`.maint-form-actions__row`**, **`.maint-asset-header-card`** (+ **`__row`**) get **`min-width: 0`** as needed. **`.maint-wo-banner__refs`** drops the **`min(100%, 360px)`** floor in favor of **`0`** so the banner flex row can shrink on narrow widths. QB doc chrome (**`.qb-doc-title-row`**, **`.qb-logistics-bar`**, **`.qb-lines-header`**, **`.qb-doc-actions`**, **`.qb-doc-memo-row`**) gets the same overflow discipline.
- **Rule 0:** **`app-theme.css`** — broad **`body.erp-maintenance`** sweep: borders that chained **`--color-border` + `--line-strong`** or **`--color-app-frame-border` + `--app-frame-border`** now use the spec token alone; label/body text drops **`var(--muted)` / `var(--text)` / `var(--text-secondary)`** fallbacks in favor of **`--color-text-label`** / **`--color-text-body`**; **`--color-bg-card`** replaces **`--bg-elevated`** on KPI cards; board nav active state uses **`--color-nav-bg`** consistently.

**Files:** `public/css/app-theme.css`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`.
