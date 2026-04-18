# IH35 ERP — Instructions for a parallel agent (master redesign)

**Role:** You are a second implementer continuing the **IH35 ERP master redesign** (Rules **0–24**) in this repo. Your output should merge cleanly with work tracked in [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md).

**Primary owner context:** Vanilla **Express** app; UI is **`public/*.html`**, **`public/css/*`**, inline scripts — **no `/src` React tree**. Spec tokens live in **`public/css/design-tokens.css`**. Shared ERP chrome overrides: **`public/css/erp-master-redesign.css`**, **`public/css/erp-master-spec-2026.css`**. Maintenance accounting/upload: **`public/css/maint-accounting-ui-2026.css`**.

---

## 1. Non-negotiables (read before editing)

1. **Small, focused diffs** — one logical change per PR/commit when possible. Do not mix large persistence / sync semantics with cosmetic passes.
2. **Do not remove** application authentication, roles, API tokens, user-visible security controls, form fields, or **parts-map SVG** assets.
3. **Defer architecture changes** called out in [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) unless the user explicitly picks them up (e.g. open-bills pager + selection model).
4. **Dispatch-only work is lower priority** unless clearing a documented backlog item; if you touch dispatch, keep changes scoped (CSS/HTML only preferred).

---

## 2. Rule 0 — CI / smoke guard (critical)

`npm run smoke` (via `scripts/system-smoke.mjs`) HTTP-fetches these bodies and fails if forbidden substrings appear:

- `public/css/app-theme.css`
- `public/css/maint-accounting-ui-2026.css`
- `public/maintenance.html`

**Forbidden patterns** are defined in **`scripts/rule-zero-agent-b.mjs`** (`RULE0_FORBIDDEN_SUBSTRINGS`). Examples: `var(--color-border-focus, var(--accent))`, `var(--color-bg-header, #`, and many `var(--color-*, var(--legacy))` stacks.

**When editing those three files:** use **`var(--color-*)`** (and approved stacks from existing patterns in-repo) only in ways that **do not introduce** any substring from that array. When in doubt, grep the file against the list in `rule-zero-agent-b.mjs` or run smoke.

**Verification:** With the app listening (e.g. port **3400**):

```bash
SMOKE_BASE=http://127.0.0.1:3400 npm run smoke
```

Exit code must be **0** before you consider your task done.

---

## 3. Status doc — keep the checklist honest

After substantive UI/CSS/verification work, update **[`docs/ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md)**:

1. **Headline block (~line 17):** bump rolling changelog range (**141–N**), append a **short** bullet for your changelog **N** (file + what changed).
2. **Table rows (Rules 0–24):** prepend your changelog to the **Notes** column for every rule your change materially advances (token hygiene → Rule **0**; + New → Rule **4**; etc.).
3. **Fractions:** adjust per-rule **Fraction** if judgment warrants; recompute the **Rolling average** line at the bottom of the table section so it matches the sum ÷ 25.

Do **not** inflate percentages without real scope; figures are planning aids, not a contract.

---

## 4. Design direction (token-first)

- Prefer **`design-tokens.css`** roles: `--color-text-*`, `--color-border*`, `--color-bg-*`, `--pill-*`, `--btn-*`, `--shadow-*`, `--radius-*`, `--erp-btn-busy-*`, etc.
- Prefer **bare** `var(--color-…)` when `design-tokens.css` is always linked first on that page (maintenance, dispatch, fuel, banking, settings, hub).
- **`erp-master-spec-2026.css`:** busy spinner on **solid green / accent primaries** uses the consolidated **`erp-btn--busy::after`** selector list + **`--erp-btn-busy-on-solid-track`** / **`--color-bg-card`** — extend that list only for **real** button classes that can receive **`erpWithBusy`** (see `public/js/erp-ui.js`).

---

## 5. Suggested work queue (pick in order; coordinate to avoid conflicts)

| Priority | Area | Hint |
|---------:|------|------|
| P1 | **Rule 22** | Remaining **`mini-note`** / dense copy → **`erp-help-tip`** where it helps ([`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) §2). |
| P2 | **Rule 4 (+ New)** | Spec parity: deep-link vs modal behavior needs **product** sign-off before new save APIs ([`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) §4). |
| P3 | **Rule 1 responsive** | Full viewport audit still deferred in status table — tighten **≤900px** / safe-area where gaps remain. |
| P4 | **`erp-master-spec` / `erp-master-redesign`** | Remaining **`font-weight: 600`** in non-exempt chrome — align to **500** where Rule 1 applies (do not mass-change modal titles without visual review). |
| P5 | **Dispatch** | Only if assigned: print/CSS already tokenized in **`erp-master-redesign.css`** `@media print`; avoid broad TMS refactors. |

**Out of scope unless user approves:** Pay bills open-bills pagination without selection model; driver settlements pagination; Safety driver-files pager with unsaved row state.

---

## 6. Optional reporting

- **`npm run report:erp`** — refreshes RTF progress report under `docs/reports/` (see `docs/reports/README.md`).

---

## 7. Handoff checklist (copy for your final message)

- [ ] Changes limited to agreed scope; no auth/data-model surprises.
- [ ] **`SMOKE_BASE=http://127.0.0.1:3400 npm run smoke`** passes (or document port if different).
- [ ] **`docs/ERP_MASTER_REDESIGN_STATUS.md`** updated (headline **141–N**, table notes, rolling average if fractions changed).
- [ ] Rule 0 files: no new forbidden substrings (`scripts/rule-zero-agent-b.mjs`).

**Reference docs:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) · [`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md) · [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) · [`ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md`](./ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md)

---

## 8. Multi-agent coordination (do not duplicate work)

**Before picking a task:** read this subsection and run a quick search so two agents do not ship the same UI pass twice.

| Slice | Status | How to verify |
|------|--------|----------------|
| **Accounting:** AP + manual fuel **Load / invoice #** labels/placeholders; fuel header **column order** (vendor → unit → payment → bank); **optional QBO class & location** (`fuel-manual-header-more` details); matching **CSS** in `maint-accounting-ui-2026.css`; WO/AP **saved card** line + PDF copy | **Done (2026-04)** — search `fuel-manual-header-more` or `Load / invoice #` in `maintenance.html` | If present, **do not redo** — extend elsewhere only. |
| **`erpDedicatedFormDirty()`** for **fuel** dedicated modal (vendor/unit/memo, load + invoice refs, optional class/location, payment/bank, lines **total**) | **Owned by maintenance track** — extend only if you add new fuel fields | Grep `erpDedicatedFormDirty` in `maintenance.html`. |
| **Rule 22** (`mini-note` → `erp-help-tip`) | **Deferred** on fast path — see [`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md) §2 | Claim **file families** in your PR message (e.g. “Rule 22: banking only”). |
| **`npm run smoke` / `npm run qa:automated`** | **Whoever has the server** — not duplicated in CI | Document port via `SMOKE_BASE` if not **3400**. |
| **Rule 10** (shared expense-line module) | **Deferred** until product | See deferred checklist §6. |

**Tip:** Another agent should take **§5 P3–P5** (responsive, font-weight 500 sweep, dispatch) while this track stays on **accounting shell / fuel composer** unless the user re-prioritizes.
