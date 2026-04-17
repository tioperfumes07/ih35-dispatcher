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
| **Rule 24 (partial)** | One-line **QuickBooks** status strip on **banking, settings, fuel, index** via `erpMountConnectionStrip`. Maintenance keeps richer **sidebar** status. |
| **Rule 22 (samples)** | Dispatch board + banking sample + maintenance **accident** + **tire** WO + **reports settlement** intros folded into **`erp-help-tip`**. |

---

## 3. Changelog (files touched in this program of work)

### 3.1 JavaScript

| File | Changes |
|------|---------|
| **`public/js/erp-ui.js`** | `showToast`, `erpWithBusy`, pager helpers, Rule 22 toggle + document listeners, **`erpNotify`**, **`erpMountConnectionStrip`** (QBO `GET /api/qbo/status`). |

### 3.2 CSS

| File | Changes |
|------|---------|
| **`public/css/design-tokens.css`** | Spec-aligned `:root` tokens (colors, buttons, pills, spacing, radii, toast shadow, focus ring, transitions). |
| **`public/css/erp-master-redesign.css`** | (Prior passes) ERP shell / module chrome. |
| **`public/css/erp-master-spec-2026.css`** | Toasts, busy spinners, help tips, maintenance/dispatch/fuel/banking/settings hooks, **`.erp-connection-strip*`**, dispatch main-column token bridge. |

### 3.3 HTML pages

| File | Changes |
|------|---------|
| **`public/maintenance.html`** | `design-tokens.css`, `#erpToastHost`, `erp-ui.js`, `showErpToast` → `showToast`, **`erpNotify`** replaces **`alert`**, save split / busy patterns (prior), **accident** + **tire** WO Rule 22 tips; **shop board** queue tables paginated (**`erpPagerRender`** + **`shopQueuePager`**); **parts** queue tab Rule 22 tip; **Fuel expense** accounting grid paginated (**`fuelExpensePager`**) with off-page **`postFuelExpenseToQbo`** draft/data path for bulk QBO post; **Expense history** log paginated (**`expHistPager`** / **`#expHistPagerHost`**); **Reports → Settlement** load index + line-item tables paginated (**`settlementIndexPager`**, **`settlementLinesPager`**) + Rule 22 intro tips; **Saved Maintenance Expense** WO/AP card list (**`apTxnListPager`** / **`#apListPagerHost`**); **Maintenance Table** + **Tracking → Map → Units** pagers (**`maintDashboardTablePager`**, **`trackingListPager`**); **Tracking → All tracked assets** + **Drivers** + **Pay bills → Recent bill payments** (**`trackingAssetsTablePager`**, **`trackingDriversPager`**, **`bpLogPager`** + **`__bpBillPaymentLogAllRows`**); **Safety / HOS** tab (**`safetyHosPager`**, **`safetyActivePager`**, **`safetyInServicePager`**, **`safetyAssignPager`**); **Tracking → Idle** snapshot (**`idleSnapshotPager`**, **`idleSnapshotPager._rows`**, **`renderIdleSnapshotTableBody`**). |
| **`public/dispatch.html`** | Tokens, toast host, `erp-ui.js`, intro + stops help tips, `erpWithBusy` / `showToast` on refresh, QBO catalog, save, uploads, PDF, auto miles, row QBO, quick-add, `patchStatus`, escaped `showMsg`, `loadTab(rethrow)` for manual refresh. |
| **`public/fuel.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy on key actions, **`erpNotify`**, **`--color-bg-page`** body, **connection strip** + `load` mount. |
| **`public/banking.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy, Rule 22 tip, **`erpNotify`**, pager on suggestions, **`--color-bg-page`**, **connection strip** + `load` mount. |
| **`public/settings.html`** | Tokens, toast host, `erp-ui.js`, toasts + busy, **`erpNotify`**, **`--color-bg-page`**, **connection strip** + `load` mount. |
| **`public/index.html`** | `design-tokens`, `erp-master-spec-2026`, toast host, **`erp-ui.js`** (sync at end for strip), **connection strip**, hub unchanged dark **`--bg`**. |

### 3.4 Documentation

| File | Role |
|------|------|
| **`docs/ERP_MASTER_REDESIGN_STATUS.md`** | Rule-by-rule **Done / Partial / Blocked** + numbered change list. |
| **`docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md`** | **This file** — narrative, recommendations, verification. |

---

## 4. Rules 0–24 — current mapping (short)

| Rule | Theme | Status in repo |
|------|--------|------------------|
| **0** | Design tokens | **Partial** — `design-tokens.css` + satellite **`--color-bg-page`**; full migration of every legacy var not done. |
| **1** | Responsive | **Partial** — maintenance + spec CSS; full viewport audit **Future**. |
| **2** | App shell | **Partial** — maintenance `erp-master`; spec copy/dimensions **Future**. |
| **3** | Collapsible sidebar | **Done (pattern)** — `ih35_sb_*` keys. |
| **4** | + New menu | **Partial** — exists; new modal types **Blocked** without product/API intent. |
| **5–9** | Modal shells | **Partial** — QB-style dialogs exist; full spec parity **Future**. |
| **10** | StandardExpenseLines | **Blocked/Future** — no React tree; cost lines live in HTML/JS. |
| **11** | Pay bills | **Partial** — verify “driver bill pay” variant vs spec. |
| **12** | Maintenance layout | **Partial / evolving**. |
| **13** | Accounting board | **Partial**. |
| **14** | Upload center | **Partial** — manual file QA **Future**. |
| **15** | Filter bar | **Partial** — not every table. |
| **16** | Safety / HOS | **Partial**. |
| **17** | Reports | **Partial**. |
| **18** | QBO GET aliases | **Skipped** — existing catalog routes; thin aliases optional product call. |
| **19** | Toasts | **Done** — `showToast` + styles + hosts; **`erpNotify`** for legacy alerts. |
| **20** | Button loading | **Done (pattern)** — `erpWithBusy` on key flows incl. dispatch rows. |
| **21** | QBO error banner | **Partial** — maintenance has messaging; compare to spec. |
| **22** | “?” tips | **Done (pattern)** + **samples** (incl. **reports settlement** intros); many maintenance paragraphs remain. |
| **23** | Pagination | **Partial** — banking/settings + maintenance **shop queues**, **fuel expense**, **expense history**, **saved WO/AP cards**, **maintenance fleet table**, **Safety / HOS** (HOS table + active / in-service + assignments), **tracking** (map unit cards, assets grid, HOS drivers, **idle snapshot**), **bill payment log**, and **reports settlement** (index + load lines) wired; upload center “recent” lists stay capped at 10; other long tables remain. |
| **24** | Connection verification | **Partial** — maintenance sidebar + **new strip** on satellites/index; not universal Samsara+QBO banner everywhere. |

---

## 5. Recommendations (prioritized backlog)

**After the master checklist is done**, revisit **[`ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md`](./ERP_MASTER_REDESIGN_DEFERRED_AFTER_CHECKLIST.md)** for deferred pagination (e.g. **open bills** + cross-page selection state), remaining **Rule 22** copy, **Rule 24** strip depth, **P2/P3** spec and token sweep items, and post-release verification.

### P0 — Verify with a running server (keep here)

1. **`node scripts/system-smoke.mjs`** with server up and `localhost` reachable (sandbox often fails fetch — expected).
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

- [ ] **Maintenance:** **Shop board** (internal / external / roadside / parts) — with 16+ filtered rows, pager appears; change page size; filters reset to page 1.
- [ ] **Maintenance:** **Accounting → Fuel expense** — 16+ rows with date/search filter: pager appears; **Record filtered to QuickBooks** still processes unposted rows not on the current page (optional: narrow filters so some unposted rows sit on page 2, then bulk post).
- [ ] **Maintenance:** **Accounting → Expense history** — 16+ filtered rows: pager under table; summary line shows page count when multi-page; **Export filtered CSV** includes all filtered rows, not only the current page.
- [ ] **Maintenance:** **Reports → Settlement / P&L** (TMS on) — **Loads with recorded costs** pager when 16+ loads; **Run lookup** on a heavy load: line-item pager; **Download CSV** still full load.
- [ ] **Maintenance:** **Accounting → Maintenance expense** — saved WO + AP card list: pager when 11+ combined cards; export buttons still full dataset.
- [ ] **Maintenance:** **Reports → Settlement** — intro **?** panels open/close; copy still accurate vs your TMS workflow.
- [ ] **Maintenance:** **Maintenance → Fleet** maintenance table — 16+ rows for current category: pager under grid; changing **Fleet by type** or service filter resets to page 1.
- [ ] **Maintenance:** **Tracking → Map → Units** — 13+ vehicles (or narrowed filter): pager; selected unit detail still works when selection is off the current page.
- [ ] **Maintenance:** **Tracking → All tracked assets** / **Drivers** — 16+ rows: pagers; duty filter resets drivers pager to page 1.
- [ ] **Maintenance:** **Safety / HOS** — HOS table: 16+ filtered rows → pager; **Active** / **In service** panels paginate independently; duty filter resets those pagers to page 1. **Assignments:** 16+ filtered rows → pager; changing assign filter or search resets to page 1.
- [ ] **Maintenance:** **Tracking → Idle** — after snapshot loads with 16+ vehicles, pager appears; page changes do not refetch (uses cached **`_rows`** until reload).
- [ ] **Maintenance:** **Accounting → Pay bills → Recent bill payments** — clear log search after filtering: all rows from last refresh return; pager with 16+ entries; **Export CSV** unchanged.
- [ ] **Maintenance:** open WO → **Accident** → help **?** opens/closes; Escape closes.
- [ ] **Maintenance:** **Tire** record → first-tire help **?** panel.
- [ ] **Dispatch:** Refresh, QBO catalog, save load, upload doc, auto miles, row **Create invoice** / **Sync attachments**, status select.
- [ ] **Banking:** snapshot, import, suggest pager, link row, connection strip.
- [ ] **Settings:** login/bootstrap, employees pager, connection strip.
- [ ] **Fuel:** save purchase, recommend (busy), connection strip.
- [ ] **Index:** connection strip loads without console errors.
- [ ] **Toasts:** dismiss **×**, auto-dismiss ~5s, no duplicate hosts.

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
