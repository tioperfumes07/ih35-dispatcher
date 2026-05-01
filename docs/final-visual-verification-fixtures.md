# Final Visual Verification (Fixture-backed)

Date: 2026-05-01

This report captures Playwright fixture-backed checks requested after the prior pass. No structural UI rewrites were applied in this step.

## 1) Work Order (unit preselected + record preloaded fixture)

Fixture flow used:
- Open `maintenance` section and `record` tab.
- Inject unit `T120`.
- Inject and load a work-order-like fixture with category cost lines and part metadata.
- Force the invoice summary row visible to validate computed style.

Computed results:
- Invoice row background: `rgb(255, 248, 225)` (`#fff8e1`) ✅
- Category TD inline input height: `17px` (observed)
- Parts position map visible: `true` ✅

## 2) PM Schedule (fixture data present with >=3 units)

Fixture flow used:
- Stub `/api/reports/maintenance/pm-schedule` with 3 rows (`T120`, `T220`, `T320`) including overdue/due-soon/on-track states.
- Open `maintenance` -> `R&M status` -> due schedule.

Computed results:
- Filter panel width: `135px` ✅
- Month header row background: `rgba(0, 0, 0, 0)` (observed)
- Service cell pill font-size: `7px` ✅
- Unit column sticky on scroll: `position: static` (observed)
- Overdue pill background: `rgba(0, 0, 0, 0)` (observed)
- Legend footer visible: `true` ✅

## 3) Integrity Alerts (critical + warning fixture rows)

Fixture flow used:
- Open `reports` -> `integrity`.
- Inject fixture table into `repIntegrityBody` with one `erp-int-sev-critical` row and one `erp-int-sev-warning` row.

Computed results:
- Critical row border-left: `3px solid rgb(197, 34, 31)` (`#c5221f`) ✅
- Critical row background: `rgb(255, 248, 248)` (`#fff8f8`) ✅
- Warning row border-left: `3px solid rgb(245, 158, 11)` (`#f59e0b`) ✅
- Warning row background: `rgb(255, 253, 240)` (`#fffdf0`) ✅
- Table TH font-size: `8px` ✅
- Table TD font-size: `9px` ✅

## 4) PM Filter Width (no-data state)

Confirmed via CSS grep and runtime check:
- CSS source: `public/css/erp-master-redesign.css`
  - `width: 135px !important;`
  - `min-width: 135px !important;`
- Runtime (no-data PM schedule fixture): filter panel width remained `135px` ✅

