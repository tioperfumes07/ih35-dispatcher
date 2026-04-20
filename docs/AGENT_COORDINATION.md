# Agent coordination — avoid duplicate work

Use this split so parallel agents do not edit the same surfaces twice. **Agent B** in this repo also means the **Rule 0 / smoke** guardrails (`scripts/rule-zero-agent-b*.mjs`, `npm run rule0:check`).

## Parallel Agent 1 — ERP master redesign (do not overlap without coordination)

**Agent 1 currently owns:**

- **`public/css/erp-master-redesign.css`**
- Changelog lines in **`docs/ERP_MASTER_REDESIGN_STATUS.md`**

**Coordinated / follow-up:** Large satellite-shell passes on **`fuel.html`**, **`index.html`**, **`dispatch.html`**, etc. — **inline `<style>` blocks are cleared** into the redesign sheet (see recent changelogs); further polish still goes through Agent 1 unless coordinated.

Other agents should **avoid editing `erp-master-redesign.css` and the rolling status changelog** unless explicitly coordinated. Broader redesign context: [`ERP_MASTER_REDESIGN_PARALLEL_AGENT.md`](./ERP_MASTER_REDESIGN_PARALLEL_AGENT.md).

## Agent A — UI shell & layout

- **`public/css/erp-master-spec-2026.css`**, **`public/css/board-nav.css`**
- **`public/css/app-theme.css`** — only when needed for tokens/layout used across pages (Rule 0 still applies)
- **`public/css/maint-accounting-ui-2026.css`** — accounting-specific layout (Rule 0)
- **Modals / drawers / popups** — sizing, `resize`, safe-area, dedicated accounting modal, maintenance modals, `erp-drawer`
- **Satellite pages** (`banking.html`, `dispatch.html`, `settings.html`) — visual parity when the task is shell-only  
  **Note:** `fuel.html` and `index.html` are coordinated with **Agent 1** above.

### Agent A alt — behavior / JS (not the redesign sheet)

Prefer this lane when the task is **logic, copy, or structure-light** changes without a full chrome pass:

- **`public/maintenance.html`** — client behavior, validation, copy; **avoid large CSS edits** to `app-theme.css` / `maint-accounting-ui-2026.css` without `npm run rule0:check` + coordination
- **`public/tracking.html`** — small parity fixes that do not require `erp-master-redesign.css`
- **`public/js/**`** — shared helpers with minimal CSS coupling

## Agent B — Guards, APIs, persistence, tooling

- **`scripts/rule-zero-agent-b.mjs`**, **`scripts/rule-zero-agent-b-check.mjs`**, **`scripts/system-smoke.mjs`**, **`package.json`** test/qa scripts — if smoke expectations change, sync with Agent A / Agent 1 as needed. **`npm run smoke`** (server up; optional **`SMOKE_BASE`**, default **`http://localhost:<PORT>`**) GETs ERP HTML shells (including **`/tracking.html`** — redirect target + **`viewport-fit=cover`**) plus static assets with stable header needles: **`/css/design-tokens.css`**, **`/css/app-theme.css`**, **`/css/erp-master-redesign.css`**, **`/css/erp-master-spec-2026.css`**, **`/css/maint-accounting-ui-2026.css`**, **`/css/board-nav.css`**, **`/js/erp-ui.js`**, **`/js/board-nav.js`**; **`GET /api/__smoke_not_found__`** (auth-exempt) asserts unknown API paths return **404** JSON (`error`, `path`). Rule 0 stack guard reuses cached bodies for **`app-theme`**, **`maint-accounting`**, **`maintenance.html`**. **`npm run qa:automated`** = **`rule0:check`** + smoke.
- **`.github/workflows/rule0-check.yml`**
- **`server.js`**, **`routes/**`**, migrations, **`data/**` semantics**
- **`README.md`** — **verification / how to run checks only** (not the big redesign narrative in `ERP_MASTER_REDESIGN_STATUS.md`; that changelog is Agent 1–owned unless coordinated)

## Overlap rules

1. If the task touches **Rule 0 files** (`app-theme.css`, `maint-accounting-ui-2026.css`, `maintenance.html`), run **`npm run rule0:check`** before handoff.
2. **One PR per theme** when possible: e.g. “modal resize” (Agent A) vs “QBO endpoint change” (Agent B) vs “redesign token pass” (Agent 1).
3. **Browser window** size is controlled by the user, not JS. **In-app** panels use CSS **`resize`** on the relevant shell (see modal CSS).
