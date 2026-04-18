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

- **Upload center** — **partial (2026-04-18, changelogs 219–222 + 330 + 355):** duplicate **`mr-upload-panel-desc`** removed (**219–220**); nested **`details.mr-upload-help`** collapsed except **Connections → Samsara write scopes** (**222**); **330** shortens remaining **`erp-help-tip`** + a few **`mini-note`** lines across sub-tabs; **355** shortens all tab **`erp-help-tip`** bodies + fuel preview / recent-import empty / AP+maint batch log / other-stub **`innerHTML`** + log detail strings. Optional: other dense upload **`innerHTML`** only if product asks.
- **Reports hub** — **partial (2026-04-18, changelogs 221 + 224–227 + 320 + 351 + 353 + 357 + 358 + 360 + 363 + 365):** **Settlement** static + tips + JS empty / no-match strings (**320**) alongside **overview** / **spend** / **driver pay** / **index** / **TMS** / **Team** / **sync** (**221**, **224**–**227**); **Spend by unit** static lead (**351**); **Reports hub** inline toolbar + per-tab **`erp-help-tip`** bodies (**353**); **357** driver pay panel lead; **358** shortens **`renderReportsAll`** / **`renderRepMaintSpendByUnitTable`** `**mini-note**` (TMS / QBO / sync / spend empty + QBO window line); **360** shortens **`loadTeamSecurityPanel`** / **`#repTeamBody`** `**innerHTML**` (posture, CMMS, roster, audit, non-admin); **363** maint detail `**#repMaintDetailBody**` lead; **365** Settlement trip lookup / driver pay / cost index inline copy + global shell `**erp-help-tip**` (sidebar host, create drawer, auth strip, QBO alert bar, global search, topbar). Optional polish on other dense **`innerHTML`** only if product asks.
- **Accounting / settlement / fuel** — **partial (changelogs 223–224, Reports settlement 320, 359, 360, 364, 366, 367, 376):** accounting **dash** + **Fuel / DEF** tab tips trimmed; **Reports → Settlement / P&amp;L** copy pass aligned with deferred §2; **359** bill payment log `**#bpLogBody**` lead; **360** Relay / Love’s fuel import `**erp-help-tip**` + preview tip + checkbox label; **364** expense history `**#expHistBody**` lead; **366** Live Master list hosts; **367** Pay bills composer + saved AP + attachment `**erp-help-tip**` bodies; **376** Pay bills + **Fuel expenses** tab + Live Master + expense history + rollback **`erp-help-tip`** / lead **`mini-note`** bodies (complements static hosts above).
- **Lists and catalogs** — **partial (changelogs 224 + 321 + 348 + 362):** **Service types** (**224**); **QuickBooks**, **Vendors**, **Operational**, **Fleet** sub-panel `**mini-note**` / `**erp-help-tip**` trims (**321**); **`#section-catalog`** panel + all sub-tab `**erp-help-tip**` bodies tightened again (**348**); **362** shortens **QBO** / **Vendors &amp; drivers** / **Operational** / **Fleet** catalog copy, **`erpSbAdmin`** lists blurb, **`renderErpModuleSidebar`** accounting Connections + reports hub `**mini-note**`, and **`erpNewPlaceholder`** drawer. Optional JS-rendered catalog strings if product asks.
- **Home + Safety** — **partial (changelogs 331 + 336 + 347 + 356 + 367 + 368 + 373):** **Home** dashboard + **Safety → HOS / Active** intro (**331**); **Assignments**, **Fleet snapshot**, **Driver files** (**336**); **HOS clocks** chip **`mr-filter-drop__hint`** lines + HOS / Active / In-service `**erp-help-tip**` (**347**); **356** shortens **`renderSafetyHos`** grid **`emptyMsg`** strings; **367** trims **Home** System/Sync + Reports hero `**erp-help-tip**` and **HOS** filter hints + grid tip; **368** re-trims **Safety** Active / Assignments / Fleet / Driver files `**erp-help-tip**` bodies (after **336** / **347**); **373** **`#section-fuel`** embed tip + **`#safe-hos`** chip hints / leads / **`renderSafetyHos`** panel. Optional: other dense **`innerHTML`**.
- **Tracking** — **partial (changelogs 338 + 341 + 356 + 368 + 369):** **Shop & maintenance** + **Yard & idle** title `**erp-help-tip**` / `**?**` (**338**); **Map** / **Assets** / **Drivers** / **Summary** `**?**` panels + **Shop → Integrity** alerts band tip (**341**); **356** shortens **`renderShopQueues`** empty rows + WO / OOS fallbacks; **368** shortens **Tracking** fleet-mix KPI + **Shop & maintenance** (nav, shop tabs, queue tables, integrity band, map, assets) `**mini-note**` / `**erp-help-tip**`; **369** shortens **`#tr-drivers`** / **`#tr-idle`** / bottom **Summary** copy (after **308**–**309**, **325**). Optional: other dense JS-built table strings if product asks.
- **Maintenance → Shop stack + unit history** — **partial (changelogs 344 + 356 + 370):** **Tracking → Shop & maintenance** — **External** / **Roadside** / **Parts** / **OOS** queue `**erp-help-tip**` + short table leads (**344**); **356** tightens the same **`renderShopQueues`** empty / fallback copy; **Parts** stages `**?**`; **Maintenance reports** export `**?**`; **Integrity · fuel · parts** title `**?**` + lead `**mini-note**`; **Maintenance** workspace **Unit history** `**?**` above **`#unitHistory`**. **WO** service mileage hint + fill-from-Samsara warning (**356**). **370** shortens **`#section-maintenance`** KPI strip through **Unit history** static `**mini-note**` / `**erp-help-tip**` / table chip hints (WO form, R&amp;M, shop board, fleet grid).

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
- Re-audit **`erpNotify`** call sites for explicit `type` where strings are ambiguous. (**Large `maintenance.html` batch:** **changelog 224** + prior **219–223** passes.)

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
- **2026-04-18 — Upload Rule 22 + `erpNotify` batch:** Connections / Fuel / Other desc dedupe + typed toasts on QBO / settlement / bulk fuel paths (**changelog 219**).
- **2026-04-18 — Upload bank/AP/history + Samsara success toasts:** Remaining upload cards + **`erpNotify` `success`** on Samsara renames / TMS miles (**changelog 220**).
- **2026-04-18 — Reports Rule 22 + maintenance QBO toasts:** Reports hub copy trim + explicit **`erpNotify`** types on maintenance save when QBO post fails or is skipped (**changelog 221**).
- **2026-04-18 — Upload `details.mr-upload-help` collapse:** Bank / Comdata / Fuel accordions removed; AP + maint template downloads inline; Connections advanced block shortened (**changelog 222**).
- **2026-04-18 — Accounting dash + `erpNotify` batch:** Dash card sublines removed; typed toasts on fuel import / QBO post / revert / undo / AP validation / Samsara mileage (**changelog 223**).
- **2026-04-18 — Fuel tab + IFTA + lists copy + `erpNotify` sweep:** Rule **22** trims + explicit toast types on pay bills, manual fuel, settlement, Samsara, maintenance paths (**changelog 224**).
- **2026-04-18 — Settlement rollup + Team + maintenance toasts:** Reports settlement second help row removed; Team panel tip shortened; maintenance save validation + partial manual fuel QBO post **`erpNotify`** typed (**changelog 225**).
- **2026-04-18 — Reports TMS + CMMS details + sync lead:** **`renderReportsAll`** TMS strings; Team CMMS benchmark collapsed; sync tab **`mini-note`** trim (**changelog 226**).
- **2026-04-18 — Reports overview + maint spend + settlement + audit:** **`renderReportsAll`** overview line; **`renderRepMaintSpendByUnitTable`** empty copy; settlement driver pay + index; security audit intro (**changelog 227**).
- **2026-04-18 — Reports settlement remainder + Tracking idle:** **`rep-settlement`** tips + JS strings + **Yard & idle** lead (**changelog 320**).
- **2026-04-18 — Lists &amp; catalogs copy:** **`#section-catalog`** Rule 22 pass across QBO / vendors / operational / fleet + service admin intro (**changelog 321**; headline log **327**).
- **2026-04-18 — Upload center tips + short leads:** **`#section-uploads`** Rule 22 remainder (**changelog 330**).
- **2026-04-18 — Home dashboard + Safety HOS copy:** **`#section-dashboard`** + **Safety → HOS / Active** static tips (**changelog 331**).
- **2026-04-18 — Safety Assignments + Fleet + Driver files:** **`safe-assign`** / **`safe-fleet`** / **`safe-files`** Rule 22 copy (**changelog 336**).
- **2026-04-18 — Tracking shop-under-tracking + Yard & idle tips:** **`#tr-maint-shop`** nav + **Shop tabs** + **Internal shop** row; **`#tr-idle`** band / geofence / idle-snapshot title **`?`** panels — Rule 22 **`erp-help-tip`** trim (**changelog 338**).
- **2026-04-18 — Tracking Map / Assets / Drivers / Summary + Shop integrity tips:** **`#tr-map`** list **`?`**; **`#tr-assets`** / **`#tr-drivers`** / **Summary** technical **`?`**; **Shop → Integrity** band before **`#securityAlertsBody`** — Rule 22 **`erp-help-tip`** trim (**changelog 341**).
- **2026-04-18 — Shop queues remainder + unit history + integrity panel:** **External** / **Roadside** / **Parts** / **OOS** `**erp-help-tip**` + table leads; **Maint reports** + **Integrity** title **`?`** + integrity lead; **`#unitHistory`** technical **`?`** — Rule 22 (**changelog 344**).
- **2026-04-18 — Safety HOS + Active / in service chip hints + technical tips:** **`#safe-hos`** **`mr-filter-drop__hint`** lines + duty legend / grid **`?`**; **`#safe-active`** split + **In service now** column **`?`** — Rule 22 (**changelog 347**).
- **2026-04-18 — Lists &amp; catalogs sub-panel help tips:** **`#section-catalog`** panel + **Service** / **QBO** / **Vendors** / **Operational** / **Fleet** `**erp-help-tip**` bodies (incl. **`refreshQboMaster`** + Samsara POST rename) — Rule 22 (**changelog 348**).
- **2026-04-18 — Upload center tips + import feedback strings:** **`#section-uploads`** `**erp-help-tip**` + Comdata/Connections `**mini-note**`; **`uploadCenterFuelPreview`** / **`upImportLogRender`** / **`uploadMaintenanceFile`** / **`uploadApFile`** / **`uploadCenterRunOtherStub`** shorter copy — Rule 22 (**changelog 355**).
- **2026-04-18 — Shop queues + Safety HOS empty + WO mileage hint:** **`renderShopQueues`** table / WO / OOS empty copy; **`renderSafetyHos`** `**emptyMsg**`; **`updateServiceMileageHint`** / **`fillServiceMileageFromSamsara`** — Rule 22 (**changelog 356**).
- **2026-04-18 — WO help drawer + Reports render copy:** **`#maintFormHelpDrawer`** + **`#maintWoSummaryBar`** tip; **`renderReportsAll`** / **`renderRepMaintSpendByUnitTable`** `**mini-note**` — Rule 22 (**changelog 358**).
- **2026-04-18 — Team security + Relay fuel + WO roster / mileage:** **`loadTeamSecurityPanel`** strings; Relay / Love’s import tips; **`#maintAssetStatusPanel`** retired-units note; **`updateServiceMileageHint`** — Rule 14 / DEFERRED §2 (**changelog 360**).
- **2026-04-18 — Lists catalog + module sidebar + New placeholder:** **`#section-catalog`** QBO/vendors/operational/fleet; **`erpSbAdmin`**; **`renderErpModuleSidebar`** accounting/reports; **`erpNewPlaceholder`** — Rule 22 (**changelog 362**).
- **2026-04-18 — Shell chrome + Settlement rollup inline tips:** module sidebar host, create drawer, auth banner, QBO sync bar, global search, topbar nav; **Settlement** trip / driver pay / cost index — Rule 22 (**changelog 365**).
- **2026-04-18 — Home + HOS + Pay bills/AP tips:** **System Summary** / **Sync Summary**; **HOS** chip hints + **`renderSafetyHos`**; **Pay bills** + saved AP + attachments — Rule 22 (**changelog 367**).
- **2026-04-18 — Tracking shop/integrity/map/assets + Safety Active/Assign/Fleet/Files:** **`#section-tracking`** KPI strip; **`#tr-maint-shop`** / integrity / map / assets `**erp-help-tip**`; **`#safe-active`** / **`#safe-assign`** / **`#safe-fleet`** / **`#safe-files`** — Rule 22 (**changelog 368**).
- **2026-04-18 — Tracking Drivers + Yard & idle + Summary:** **`#tr-drivers`** / **`#tr-idle`** / **`#trackingSummaryText`** band — Rule 22 (**changelog 369**).
- **2026-04-18 — Maintenance workspace (`#section-maintenance`) tips:** KPI strip, action strip, WO form, R&amp;M integrity, shop/location, fleet table, unit history — Rule 22 (**changelog 370**).
- **2026-04-18 — Fuel embed + Safety HOS clocks:** **`#section-fuel`** iframe tip; **`#safe-hos`** filter chips + grid lead — Rule 22 (**changelog 373**).
- **2026-04-18 — Accounting Pay bills + Fuel + Live Master + history + rollback tips:** **`#section-accounting`** static **`erp-help-tip`** / **`mini-note`** trim (Pay bills, fuel tab, QBO master, expense history, rollback) — Rule 22 / DEFERRED §2 (**changelog 376**).
- **2026-04-18 — Reports hub inline tab help tips:** **`#section-reports`** toolbar + **Overview** / **TMS** / **Settlement** / **Maint spend** / **Maint detail** / **QBO** / **Sync** / **Team** / **IFTA** `**erp-help-tip**` panels — shorter Rule 22 copy (**changelog 353**).
