# IH35 ERP — Master redesign: final report (living document)

**Generated:** 2026-04-16 · **Repo:** `ih35_dispatch_v3_starter` (vanilla HTML + Express, no `/src` React tree)  
**Companion:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) (rule-by-rule checklist)

This report consolidates **what was built**, **how it maps to the master rules (0–24)**, **recommendations for the next increment**, and **how to verify** work without assuming QBO/Samsara credentials in CI.

---

## 1. Protection block (non-negotiable)

The following were **respected** across implementation passes:

- **No** intentional changes to backend **save / post / sync** semantics unless explicitly scoped (most work was **UI/CSS/client JS**).
- **No** removal of form fields or **parts-map SVG** assets.
- **Read-only** server use for new cross-page features (e.g. `GET /api/qbo/status` for connection strips).

Any future work that touches `server.js` persistence should re-state the protection block in the PR description.

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
| **`public/maintenance.html`** | `design-tokens.css`, `#erpToastHost`, `erp-ui.js`, `showErpToast` → `showToast`, **`erpNotify`** replaces **`alert`**, save split / busy patterns (prior), **accident** + **tire** WO Rule 22 tips; **shop board** queue tables paginated (**`erpPagerRender`** + **`shopQueuePager`**); **parts** queue tab Rule 22 tip; **Fuel expense** accounting grid paginated (**`fuelExpensePager`**) with off-page **`postFuelExpenseToQbo`** draft/data path for bulk QBO post; **Expense history** log paginated (**`expHistPager`** / **`#expHistPagerHost`**); **Reports → Settlement** load index + line-item tables paginated (**`settlementIndexPager`**, **`settlementLinesPager`**) + Rule 22 intro tips; **Saved Maintenance Expense** WO/AP card list (**`apTxnListPager`** / **`#apListPagerHost`**). |
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
| **23** | Pagination | **Partial** — banking/settings + maintenance **shop queues**, **fuel expense**, **expense history**, **saved WO/AP cards**, and **reports settlement** (index + load lines) wired; upload center “recent” lists stay capped at 10; other long tables remain. |
| **24** | Connection verification | **Partial** — maintenance sidebar + **new strip** on satellites/index; not universal Samsara+QBO banner everywhere. |

---

## 5. Recommendations (prioritized backlog)

### P0 — Verify with a running server

1. **`node scripts/system-smoke.mjs`** with server up and `localhost` reachable (sandbox often fails fetch — expected).
2. **Sign-in flows:** settings → banking → maintenance with token; confirm **401** paths still show **`authBanner`** / toasts only where intended.
3. **QBO:** with a connected realm, confirm **`erpMountConnectionStrip`** shows **connected + company**; disconnected shows warn styling.

### P1 — UX consistency (no new APIs)

1. **Maintenance `erpPagerRender`:** shop queues, **Fuel expense**, **Expense history**, **Saved Maintenance Expense** card list, and **Reports → Settlement** (load index + trip line items) are wired. Upload center “recent imports” stays at 10 rows per category in localStorage; other long tables (e.g. driver-pay nested tables) remain if needed.
2. **More Rule 22:** convert remaining long **`mini-note`** blocks (**accounting fuel** grid area if any, **upload center** tab descriptions, other reports) using the same **`erp-help-tip`** pattern.
3. **`erpMountConnectionStrip`:** optional second line **only if** a **cheap read-only** endpoint exists (avoid calling **`GET /api/board`** on every page load — it can fan out to Samsara; cache server-side or piggyback maintenance dashboard payload if product wants it).

### P2 — Spec / product decisions

1. **Rule 4:** define which **+ New** rows are **deep-links** vs new modals (no new save endpoints without approval).
2. **Rule 18:** decide on thin **`GET /api/qbo/accounts`**-style aliases vs documentation-only mapping to existing catalog.
3. **Rule 10:** decide whether a **build step** / shared ES module for cost lines is worth the migration cost.

### P3 — Visual token sweep

1. Gradually replace **`var(--bg)`** / **`--panel`** usage in dense components with **`--color-*`** where contrast is proven in light + dark contexts (hub stays dark — do not force **`--color-bg-page`** on **`index.html`** body).

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
