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
