# Agent B — maintenance / accounting / smoke (parallel log)

Agent A merges summarized bullets into `ERP_MASTER_REDESIGN_STATUS.md`; do not edit that file from this track.

---

## 2026-04-17

- **Token sweep (Rule 0):** Removed redundant hex and `var(--line, …)` fallbacks in `public/css/maint-accounting-ui-2026.css` now that `design-tokens.css` + `erp-master-redesign.css` load first; QB / pill / border stacks resolve through `var(--color-*)`, `var(--qb-*)`, and `var(--pill-*)` only.
- **`app-theme.css`:** Normalized shared `var(--color-border, var(--line, …))` / `var(--line-strong, …)` chains to token-first stacks (`var(--color-border)` or `var(--color-border, var(--line-strong))` / `var(--line-strong)` for fills) so maintenance and satellite shells do not re-specify bare hex in those fallbacks.
- **Rule 1 (horizontal bleed):** `public/css/maint-accounting-ui-2026.css` — `#section-accounting` active section and key panel / KPI grid wrappers use `min-width: 0` so dense accounting content stays inside the main column.
- **`maintenance.html`:** Global replace of a small set of inline `style=` token stacks (e.g. `var(--color-text-body,#3c4257)` → `var(--color-text-body)`, legacy `var(--color-border,var(--line,#e2e8f0))` → `var(--color-border)`) wherever those exact patterns appeared (including accounting board strip).
- **Smoke:** `scripts/system-smoke.mjs` — maintenance HTML check now requires stable markers `section-accounting` and `acct-dash-kpis` in addition to existing needles.

**Files:** `public/css/maint-accounting-ui-2026.css`, `public/css/app-theme.css`, `public/maintenance.html`, `scripts/system-smoke.mjs`, `docs/ERP_MASTER_REDESIGN_AGENT_B_LOG.md`, `docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md` (§9 pointer to this log; former §9 Maintainer note renumbered to §10).
