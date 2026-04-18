# Agent coordination — avoid duplicate work

Use this split so parallel agents do not edit the same surfaces twice. **Agent B** in this repo also means the **Rule 0 / smoke** guardrails (`scripts/rule-zero-agent-b*.mjs`, `npm run rule0:check`).

## Agent A — UI shell & layout

- **`public/css/erp-master-redesign.css`**, **`public/css/erp-master-spec-2026.css`**, **`public/css/board-nav.css`**
- **`public/css/app-theme.css`** — only when needed for tokens/layout used across pages (Rule 0 still applies)
- **`public/css/maint-accounting-ui-2026.css`** — accounting-specific layout (Rule 0)
- **`public/maintenance.html`** — structure, inline handlers, client JS in page (Rule 0)
- **Modals / drawers / popups** — sizing, `resize`, safe-area, dedicated accounting modal, maintenance modals, `erp-drawer`
- **Satellite pages** (`fuel.html`, `banking.html`, `dispatch.html`, `settings.html`, `index.html`) — visual parity when the task is shell-only

## Agent B — Guards, APIs, persistence, tooling

- **`scripts/rule-zero-agent-b.mjs`**, **`scripts/rule-zero-agent-b-check.mjs`**, **`scripts/system-smoke.mjs`**, **`package.json`** test/qa scripts
- **`.github/workflows/rule0-check.yml`**
- **`server.js`**, **`routes/**`**, migrations, **`data/**` semantics**
- **Docs that describe CI/verification only** — `README.md` verification section, checklist cross-links (coordinate if Agent A changes smoke expectations)

## Overlap rules

1. If the task touches **Rule 0 files** (`app-theme.css`, `maint-accounting-ui-2026.css`, `maintenance.html`), run **`npm run rule0:check`** before handoff.
2. **One PR per theme** when possible: e.g. “modal resize” (Agent A) vs “QBO endpoint change” (Agent B).
3. **Browser window** size is controlled by the user, not JS. **In-app** panels use CSS **`resize`** on the relevant shell (see modal CSS).
