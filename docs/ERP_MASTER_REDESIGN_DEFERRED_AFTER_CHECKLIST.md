# IH35 ERP — Deferred work after the master redesign checklist

**Purpose:** Items intentionally **not** done during the master Rules 0–24 pass, or that need **product / architecture** decisions before implementation. Revisit this document **after** the main checklist in [`ERP_MASTER_REDESIGN_STATUS.md`](./ERP_MASTER_REDESIGN_STATUS.md) is considered complete.

**Companion:** [`ERP_MASTER_REDESIGN_FINAL_REPORT.md`](./ERP_MASTER_REDESIGN_FINAL_REPORT.md) (changelog, verification, short backlog pointer).

---

## 1. Pagination — needs a new interaction model

| Item | Why it was deferred |
|------|---------------------|
| **Pay bills → Open bills** (`#bpOpenBillsBody`) | **Pay** checkboxes, **pay amount** inputs, **Remaining**, and **Create bill payment** are driven by **visible DOM rows** (`submitAccountingBillPayment`, `bpRefreshSelectionTotal`, `bpApplyOpenBillsFilter`). Paginating without a parallel **per–bill-id state map** (checked, amount, remainder) would drop selections off-page or double-count. **Recommendation:** introduce `Map<billId, { checked, payAmount }>` (or mirror server draft) and render pages from filtered `window.__bpOpenBills`; keep “select all on filter” semantics explicit. |
| **Driver pay settlements** (nested tables per QBO vendor in Reports → Settlement) | Each vendor block can have **many loads**; pagination could be **per vendor** (multiple pager hosts) or one **flattened** virtual list. Deferred until UX is specified. |
| **Safety → Driver files** | Rows are **editable** with **Save** per row; paging away loses in-progress edits unless drafts are persisted per page change. Defer or add explicit “unsaved” warnings + draft store. |

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
