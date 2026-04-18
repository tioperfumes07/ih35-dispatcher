# IH35 ERP — Deferred work after the master redesign checklist

**Purpose:** Items intentionally **not** done during the master Rules 0–24 pass, or that need **product / architecture** decisions before implementation. Revisit this document **after** the main checklist in [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) is considered complete.

**Companion:** [`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md) (changelog, verification, short backlog pointer).

---

## 1. Pagination — interaction model (Apr 2026)

The three **large-table** themes below shipped in **`public/maintenance.html`** with **`erpPagerRender`** / **`erpPagerSliceRange`** and (where needed) **`Map`**-backed client state. What remains is mostly **product polish** (select-all, flattened lists, unsaved banners) where called out.

| Item | Why it was deferred |
|------|---------------------|
| **Pay bills → Open bills** (`#bpOpenBillsBody`) | **Shipped (2026-04-18):** pager under the grid + **`window.__bpOpenBillsSelection`** **`Map<billId, { checked, payAmount }>`** + **`bpRenderOpenBillsPage`** / **`bpGetFilteredOpenBills`** — see **`ERP_MASTER_REDESIGN_STATUS.md` changelog 215**. Remaining product gaps (if any): explicit **“select all matching filter”** control, server-backed draft, or different default page size. |
| **Driver pay settlements** (nested tables per QBO vendor in Reports → Settlement) | **Shipped (2026-04-18):** **per-vendor** **`erpPagerRender`** under each load table (**default 15** rows; shared **`erpPagerSliceRange`**), state in **`window.__driverPaySettPagerByVendor`** + cached **`window.__driverPaySettlementsPayload`** — **`ERP_MASTER_REDESIGN_STATUS.md` changelog 216**. A **flattened** virtual list remains a future alternative if product prefers one pager. |
| **Safety → Driver files** | **Shipped (2026-04-18):** **`#driverFilesPagerHost`** + **`driverFilesPager`**; in-memory **`window.__driverFilesFieldDraft`** **`Map`** (key = driver name lowercased, same as **`mergeDriversForFiles`**) holds CDL / dates / notes until **Save** or cleared fields; **`renderDriverFiles`** merges draft for filter badges + row values. See **`ERP_MASTER_REDESIGN_STATUS.md` changelog 217**. Optional later: explicit **“unsaved”** banner or server autosave. |

---

## 2. Rule 22 — remaining `mini-note` / copy cleanup

- **Upload center** tab descriptions (`mr-upload-panel-desc`, `details.mr-upload-help`) — fold long paragraphs into **`erp-help-tip`** where it helps without hiding required legal/import wording.
- **Accounting / settlement / fuel** — any remaining dense **`mini-note`** blocks not yet converted (spot-check after checklist sign-off).
- **Reports hub** bodies (`repMaintBody`, `repOverviewBody`, etc.) — tip pattern only where it reduces noise.

---

## 3. Connection strip & status (Rule 24 / P1)

- **Second strip line** (e.g. Samsara + board freshness) — only if a **cheap read-only** aggregate exists; avoid **`GET /api/board`** on every navigation unless server-side cache or piggyback on maintenance dashboard refresh is agreed.

---

## 4. Spec / platform (P2 / P3 from final report)

- **Rule 4 — + New menu:** which rows are **deep-links** vs new modals (no new save APIs without approval).
- **Rule 18 — QBO GET aliases:** thin `GET /api/qbo/accounts`-style routes vs documentation-only mapping to existing catalog.
- **Rule 10 — StandardExpenseLines:** shared module / build step vs single canonical HTML/JS implementation.
- **Rule 0 — Token sweep:** migrate legacy `--bg` / `--panel` to `--color-*` where contrast is proven (hub stays dark).

---

## 5. Verification & hardening (post-checklist)

- Full **manual regression** with server + QBO + Samsara credentials.
- **`node scripts/system-smoke.mjs`** with server up.
- Re-audit **`erpNotify`** call sites for explicit `type` where strings are ambiguous.

---

## 6. Maintainer note

When closing the master checklist, **append dated notes** under this file (or open a GitHub milestone) so deferred items are not lost. Prefer **one issue per deferred theme** (open bills pager, driver settlements layout, driver files pager) for assignability.

### Dated log

- **2026-04-18 — Master checklist engineering closure:** [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) **changelog 213** records **`npm run rule0:check`** + **`npm run smoke`** green and **`npm run report:erp`** RTF refresh; **§5 P0** audit row updated (automated checks done, sign-in / **401** / live **QBO** realm still manual). **`public/tracking.html`** gained **`viewport-fit=cover`** for parity with other ERP shells. **§1 pagination row items** later shipped (**changelogs 215–217**); **Rule 24** second-line strip and **§2–4** themes unchanged unless picked up separately.
- **2026-04-18 — `erpNotify` hardening (partial vs §5):** **`public/maintenance.html`** — explicit toast **`type`** on fuel-expense **validation** path, generic **error** path, and shop-queue **PATCH** failure (`'warning'` / `'error'` / `'error'`) so messages are not left to inference alone.
- **2026-04-18 — Pay bills open-bills pager + selection map:** Implements deferred **§1** first-row recommendation — **`#bpOpenBillsPagerHost`**, **`erpPagerRender`**, **`Map`**-backed selection, **`submitAccountingBillPayment`** reads full loaded set + map (**changelog 215**).
- **2026-04-18 — Driver pay settlements per-vendor pagers:** **`loadDriverPaySettlements`** caches payload and **`renderDriverPaySettlementsBox`** renders each vendor’s load slice + pager (**changelog 216**).
- **2026-04-18 — Safety → Driver files pager + draft map:** **`driverFilesPager`** + **`__driverFilesFieldDraft`** so paging does not discard unsaved row edits (**changelog 217**).
- **2026-04-18 — Driver files `beforeunload` + smoke pager needles:** Unsaved draft triggers leave-page confirm; smoke asserts **`bpOpenBillsPagerHost`** / **`driverFilesPagerHost`** (**changelog 218**).
