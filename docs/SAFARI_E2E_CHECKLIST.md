# Safari End-to-End Checklist

Use this checklist after any deploy or major UI change to confirm section routing, data surfaces, and modal behavior.

## 1) Start and Health Check

Quick gate (recommended):

- `npm run verify:safari:full`

Manual equivalent:

1. Run:
   - `npm run build:fleet`
   - `npm run qa:isolated`
2. Confirm smoke output shows all critical API endpoints as `200`.
3. Open in Safari:
   - `http://127.0.0.1:PORT/maintenance.html`
   - `http://127.0.0.1:PORT/fleet-reports/`

## 2) Top-Level Navigation (Fleet Hub)

From `fleet-reports/`, click each top tab once:
- `Home`
- `Maintenance`
- `Accounting`
- `Lists`
- `Reports`
- `Safety`
- `Tracking`
- `Fuel`
- `Loads`

Expected:
- No white screen
- No section overlap
- Header title/subtitle changes per section
- URL state updates without stale modal overlays

## 3) Home + Accounting Live Metadata

### Home
- Verify KPI cards load values (not static placeholder set).
- Verify metadata line includes:
  - QBO connection state
  - Samsara vehicles count
  - Environment mode
  - Data refresh timestamp

### Accounting
- Verify page title reflects live company when available.
- Verify subtitle reflects live QBO + Samsara status.
- Verify metadata row shows environment + data refresh timestamp.

## 4) Accounting Actions

### Header Buttons
- Click `Test QuickBooks`
  - Expected: inline success/error status banner.
- Click `Refresh QBO lists`
  - Expected: status banner and navigation to QBO items list.

### Home Hub Sections
- `Samsara Cloud` -> opens `Tracking`.
- `Upload center` -> opens `Lists` -> `Bank CSV matching`.
- `Settings & users` -> opens `Lists` -> `Name management`.
- No alert-only dead ends.

## 5) Lists and Catalogs

Open `Lists` and verify:
- Tab bar is alphabetical.
- Card search filters cards.
- Each card opens inline panel.
- Table controls exist:
  - Search
  - Status filter
  - Pagination
  - Export Excel
  - CRUD actions where applicable

Specific:
- `Bank CSV matching` supports add/edit/delete/activate/deactivate/export.
- `Service types` tab includes both `Service types (DB)` and `Parts reference`.
- Zero-result filters show inline empty-row message.

## 6) Reports Surface

In `maintenance.html` -> `Reports`:
- Confirm in-shell reports catalog is default.
- Confirm Fleet Hub iframe is fallback-only and hidden unless explicitly opened.
- Confirm `Form 425C` fallback action still opens correctly when invoked.

In `fleet-reports/` -> `Reports`:
- Confirm category tabs render correctly.
- Confirm report search and filter sidebar work.
- Open/close at least one report viewer without layout break.

## 7) Modal Consistency

Open these modal families:
- Work order picker/modal
- Fuel transaction form
- Recurring bills
- Accounting specialized modals
- List edit modal

Expected:
- Light theme backgrounds
- Consistent fullscreen/close controls
- Header action alignment is consistent
- Escape and close behavior works

## 8) Tracking and Integrations

Open `Tracking`:
- Verify telematics table renders.
- Verify detail drawer opens for a unit.
- Verify export buttons work.

Integration strip:
- Confirm message cadence says auto recheck every 5 min.
- Confirm status text is coherent with QBO/Samsara connectivity.

## 9) Cache and Staleness

In Safari:
1. Hard refresh (`Cmd+Option+R`).
2. Re-open `maintenance.html` and `fleet-reports/`.
3. Confirm latest UI (no stale old surfaces).

Expected:
- Hashed assets load new build.
- No stale iframe-only reports behavior.

## 10) Release Gate

Before release:
- `npm run build:fleet` passes
- `npm run qa:isolated` passes
- Manual checklist above passes without:
  - white screens
  - stale content
  - dead-end actions
  - modal/control misalignment
