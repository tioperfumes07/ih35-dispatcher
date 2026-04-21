import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx, exportJsonSheetsToXlsx } from '../../lib/tableExportXlsx'
import { fetchPartsCatalog } from '../../lib/serviceCatalogApi'
import type { PartRefApiRow } from '../../types/serviceCatalog'
import { SearchableCombo, type ComboOption } from '../maintenance/SearchableCombo'
import { DriverField } from '../maintenance/DriverField'
import './workorder-shell.css'

export type WorkOrderShellKind = 'IWO' | 'EWO' | 'RSWO'

export type PlannedLine = { id: string; text: string; tag?: string }

export type PartLine = { id: string; partName: string; partNo: string; qty: string; cost: string }

export type CategoryLine = {
  id: string
  category: string
  description: string
  amount: string
  billable: boolean
  customer: string
}

export type ItemLine = {
  id: string
  product: string
  sku: string
  description: string
  qty: string
  rate: string
  amount: string
  billable: boolean
  customer: string
}

type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

function SectionCard(props: {
  sid: SectionId
  label: string
  extraHead?: ReactNode
  children: ReactNode
}) {
  const { isFullScreen, toggle } = useFullScreen()
  return (
    <section
      className={'wo-sec' + (isFullScreen ? ' wo-sec--fs' : '')}
      aria-labelledby={props.sid + '-lbl'}
    >
      <header className="wo-sec__head">
        <div id={props.sid + '-lbl'} className="wo-sec__label">
          {props.label}
          {props.extraHead}
        </div>
        <ModalFullscreenToggle
          isFullScreen={isFullScreen}
          onToggle={toggle}
          className="wo-ico-btn"
          title="Full screen (section)"
        />
      </header>
      <div className="wo-sec__body" style={isFullScreen ? { flex: 1, overflow: 'auto' } : undefined}>
        {props.children}
      </div>
    </section>
  )
}

export type WorkOrderShellProps = {
  /** WO number prefix (IWO / EWO / RSWO). Spec text calls this `recordType`; kept as recordKind to avoid clashing with service record type. */
  recordKind: WorkOrderShellKind
  /**
   * Maintenance ledger (expense vs bill): top bar title, section labels, locked TXN type,
   * and QuickBooks footer copy — without changing theme tokens.
   */
  ledgerMode?: 'expense' | 'bill'
  workOrderNumber: string
  unitNo: string
  unitTitle: string
  vehicleTypeLabel: string
  pills: { recordType: string; location: string; total: string }
  unitStats: { odometer: number; pastDue: number; dueSoon: number; savedOdoDisplay: string }
  shellFullScreen: boolean
  onToggleShellFullScreen: () => void
  onClose?: () => void
  integrity: { showDriverBar: boolean; onViewAllIntegrity?: () => void }
  catalogError: string | null
  /** Service / catalog panel (existing ServiceWorkOrderInfoPanel host) */
  servicePanel: ReactNode
  /** Section A–H + memo + model fields */
  recordTypeOptions: ComboOption[]
  serviceTypeOptions: ComboOption[]
  serviceLocationOptions: ComboOption[]
  repairStatusOptions: ComboOption[]
  recordType: string
  onRecordType: (v: string) => void
  serviceType: string
  onServiceType: (v: string) => void
  serviceLocation: string
  onServiceLocation: (v: string) => void
  repairStatus: string
  onRepairStatus: (v: string) => void
  serviceDate: string
  onServiceDate: (v: string) => void
  vendor: string
  onVendor: (v: string) => void
  vendorOptions: ComboOption[]
  fleetMileage: string
  onFleetMileage: (v: string) => void
  onFleetMileageSave?: () => void
  locationDetail: string
  onLocationDetail: (v: string) => void
  driverId: string
  driverName: string
  onDriverChange: (id: string, name: string) => void
  loadNumber: string
  onLoadNumber: (v: string) => void
  odometerInput: string
  onOdometerInput: (v: string) => void
  samsaraOdoHint: string
  suggestedLoad: string
  plannedLines: PlannedLine[]
  onPlannedLines: (rows: PlannedLine[]) => void
  partLines: PartLine[]
  onPartLines: (rows: PartLine[]) => void
  categoryLines: CategoryLine[]
  onCategoryLines: (rows: CategoryLine[]) => void
  itemLines: ItemLine[]
  onItemLines: (rows: ItemLine[]) => void
  productOptions: ComboOption[]
  txnType: string
  onTxnType: (v: string) => void
  expenseBillNo: string
  onExpenseBillNo: (v: string) => void
  paymentMethod: string
  onPaymentMethod: (v: string) => void
  txnDate: string
  onTxnDate: (v: string) => void
  payFromAccount: string
  onPayFromAccount: (v: string) => void
  notes: [string, string, string, string, string]
  onNotes: (n: [string, string, string, string, string]) => void
  additionalServices: string
  onAdditionalServices: (v: string) => void
  memo: string
  onMemo: (v: string) => void
  saveBar: ReactNode
}

const TXN_OPTS: ComboOption[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'bill', label: 'Bill' },
  { value: 'check', label: 'Check' },
]

const PAYMENT_OPTS: ComboOption[] = [
  { value: 'ACH', label: 'ACH' },
  { value: 'Check', label: 'Check' },
  { value: 'Credit card', label: 'Credit card' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Wire', label: 'Wire' },
  { value: 'Instant pay', label: 'Instant pay' },
]

/** Left-to-right tab order within category / item grids (section D / E). */
const TAB_CAT = 400
const TAB_ITEM = 900

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function workOrderExportStem(workOrderNumber: string) {
  const d = new Date().toISOString().slice(0, 10)
  return `WorkOrder-${workOrderNumber}-${d}`
}

function categoryLinesToExportRows(lines: CategoryLine[]) {
  return lines.map((r, ri) => ({
    line: ri + 1,
    category: r.category,
    description: r.description,
    amount: r.amount,
    billable: r.billable,
    customer: r.customer,
  }))
}

function itemLinesToExportRows(lines: ItemLine[]) {
  return lines.map((r, ri) => ({
    line: ri + 1,
    product: r.product,
    sku: r.sku,
    description: r.description,
    qty: r.qty,
    rate: r.rate,
    amount: r.amount,
    billable: r.billable,
    customer: r.customer,
  }))
}

export function WorkOrderShell(props: WorkOrderShellProps) {
  const titleId = useId()
  const ledger = useMemo(() => {
    if (props.ledgerMode === 'expense') {
      return {
        topTitle: 'Maintenance expense',
        topHint:
          'Tie spend to unit, service type, and vendor. Integrity runs on save using the expense date in section A.',
        sectionA: 'Expense header',
        serviceDateLbl: 'Expense date',
        refLbl: 'Reference # (optional)',
        fTxnDateLbl: 'Posting date',
        fNote:
          'Save posts a maintenance_expense payload. The date in section A is the expense date sent to integrity.',
      } as const
    }
    if (props.ledgerMode === 'bill') {
      return {
        topTitle: 'Maintenance bill',
        topHint:
          'Vendor AP-style entry: bill number, amount, and service line. Integrity uses section A as the bill date.',
        sectionA: 'Bill header',
        serviceDateLbl: 'Bill date',
        refLbl: 'Vendor bill #',
        fTxnDateLbl: 'Posting date',
        fNote:
          'Save posts a maintenance_bill payload. Bill date and vendor bill # must align with vendor records.',
      } as const
    }
    return null
  }, [props.ledgerMode])
  const catCol = useColumnResize([40, 120, 160, 72, 56, 100, 72, 56])
  const itemCol = useColumnResize([40, 140, 72, 160, 44, 56, 56, 56, 56, 100, 72, 56])
  const partsLineCol = useColumnResize([200, 120, 64, 96])

  const [partsQ, setPartsQ] = useState('')
  const [partsHits, setPartsHits] = useState<PartRefApiRow[]>([])
  const [partsErr, setPartsErr] = useState<string | null>(null)
  const [partDraft, setPartDraft] = useState({ qty: '1', cost: '' })

  const reloadParts = useCallback(async () => {
    setPartsErr(null)
    try {
      const rows = await fetchPartsCatalog(partsQ || undefined, undefined)
      setPartsHits(rows.slice(0, 40))
    } catch (e) {
      setPartsHits([])
      setPartsErr(String((e as Error).message || e))
    }
  }, [partsQ])

  useEffect(() => {
    const t = window.setTimeout(() => void reloadParts(), 200)
    return () => window.clearTimeout(t)
  }, [reloadParts])

  const classBadge = props.unitNo

  const catSum = useMemo(
    () =>
      props.categoryLines.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [props.categoryLines],
  )
  const itemSum = useMemo(
    () => props.itemLines.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
    [props.itemLines],
  )
  const totalSum = catSum + itemSum

  const addPlanned = () => {
    props.onPlannedLines([
      ...props.plannedLines,
      { id: uid(), text: '', tag: '' },
    ])
  }

  const addPartFromHit = (p: PartRefApiRow) => {
    props.onPartLines([
      ...props.partLines,
      {
        id: uid(),
        partName: p.part_name,
        partNo: p.category,
        qty: partDraft.qty || '1',
        cost: partDraft.cost || String(p.cost_mid ?? ''),
      },
    ])
  }

  return (
    <div
      className={'wo-shell-root' + (props.shellFullScreen ? ' wo-shell-root--fs' : '')}
      style={props.shellFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
      aria-labelledby={titleId}
    >
      <header className={'wo-topbar' + (ledger ? ' wo-topbar--ledger' : '')}>
        <div className="wo-topbar__left-col">
          <div className="wo-topbar__left">
            <span className="wo-topbar__title" id={titleId}>
              {ledger ? ledger.topTitle : 'Create work order'}
            </span>
            <span className="wo-wo-badge">{props.workOrderNumber}</span>
            <span className="wo-pill">{props.unitNo}</span>
            <span className="wo-pill">{props.pills.recordType}</span>
            <span className="wo-pill">{props.pills.location}</span>
            <span className="wo-pill">{props.pills.total}</span>
          </div>
          {ledger ? <p className="wo-topbar__ledger-hint">{ledger.topHint}</p> : null}
        </div>
        <div className="wo-topbar__actions">
          <span className="wo-fs-wrap">
            <ModalFullscreenToggle
              isFullScreen={props.shellFullScreen}
              onToggle={props.onToggleShellFullScreen}
              className="wo-ico-btn"
              title="Full screen"
            />
            <span className="wo-fs-lbl">Full screen</span>
          </span>
          {props.onClose ? (
            <button type="button" className="wo-ico-btn wo-close-btn" onClick={props.onClose}>
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div className="wo-unit-card">
        <div className="wo-unit-card__left">
          <span className="wo-unit-badge">Unit</span>
          <strong style={{ fontSize: 12 }}>
            {props.unitNo} · {props.unitTitle}
          </strong>
          <span className="wo-pill">{props.vehicleTypeLabel}</span>
        </div>
        <div className="wo-unit-card__stats">
          <span>Odometer {props.unitStats.odometer.toLocaleString()}</span>
          <span style={{ color: props.unitStats.pastDue > 0 ? 'var(--danger)' : undefined }}>
            Past due {props.unitStats.pastDue}
          </span>
          <span style={{ color: props.unitStats.dueSoon > 0 ? 'var(--warn)' : undefined }}>
            Due soon {props.unitStats.dueSoon}
          </span>
          <span>Saved odo {props.unitStats.savedOdoDisplay}</span>
        </div>
      </div>

      {props.integrity.showDriverBar ? (
        <div className="wo-integrity">
          <span>
            Integrity: no driver assigned — assign below to log accountability for this service record.
          </span>
          {props.integrity.onViewAllIntegrity ? (
            <button
              type="button"
              className="wo-link"
              onClick={() => props.integrity.onViewAllIntegrity?.()}
            >
              View all →
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="wo-scroll">
        <SectionCard
          sid="A"
          label={`A — ${ledger ? ledger.sectionA : 'Service information'} · ${props.workOrderNumber}`}
          extraHead={null}
        >
          {props.catalogError ? (
            <p className="maint-form__err" role="alert">
              {props.catalogError}
            </p>
          ) : null}
          <div className="wo-grid5">
            <div>
              <SearchableCombo
                label="Record type"
                value={props.recordType}
                onChange={props.onRecordType}
                options={props.recordTypeOptions}
                placeholder="Search or add custom type…"
              />
            </div>
            <div>
              <SearchableCombo
                label="Service type"
                value={props.serviceType}
                onChange={props.onServiceType}
                options={props.serviceTypeOptions}
              />
            </div>
            <div>
              <SearchableCombo
                label="Service location"
                value={props.serviceLocation}
                onChange={props.onServiceLocation}
                options={props.serviceLocationOptions}
              />
            </div>
            <div>
              <SearchableCombo
                label="Repair status"
                value={props.repairStatus}
                onChange={props.onRepairStatus}
                options={props.repairStatusOptions}
              />
            </div>
            <label className="field">
              <span className="wo-field-lbl">{ledger ? ledger.serviceDateLbl : 'Service date'}</span>
              <input
                className="wo-input"
                type="date"
                value={props.serviceDate}
                onChange={(e) => props.onServiceDate(e.target.value)}
              />
            </label>
          </div>
          <div className="wo-grid3">
            <div>
              <SearchableCombo
                label="Vendor (QuickBooks)"
                value={props.vendor}
                onChange={props.onVendor}
                options={props.vendorOptions}
              />
            </div>
            <div>
              <span className="wo-field-lbl">Fleet mileage (ERP)</span>
              <div className="wo-inline-row">
                <input
                  className="wo-input"
                  value={props.fleetMileage}
                  onChange={(e) => props.onFleetMileage(e.target.value)}
                />
                <button type="button" className="wo-mini-btn" onClick={() => props.onFleetMileageSave?.()}>
                  Save
                </button>
              </div>
            </div>
            <label className="field">
              <span className="wo-field-lbl">Location detail</span>
              <input
                className="wo-input"
                required
                placeholder="Where work happened"
                value={props.locationDetail}
                onChange={(e) => props.onLocationDetail(e.target.value)}
              />
            </label>
          </div>
        </SectionCard>

        <SectionCard
          sid="B"
          label="B — Driver assignment (integrity tracked)"
          extraHead={<span className="wo-sec__badge-ok">Integrity tracked</span>}
        >
          <div className="wo-grid4">
            <DriverField
              driverId={props.driverId}
              driverName={props.driverName}
              onChange={props.onDriverChange}
            />
            <label className="field">
              <span className="wo-field-lbl">Load #</span>
              <div className="wo-inline-row">
                <input
                  className="wo-input"
                  value={props.loadNumber}
                  onChange={(e) => props.onLoadNumber(e.target.value)}
                />
                <button type="button" className="wo-mini-btn">
                  Load/settl
                </button>
              </div>
            </label>
            <label className="field">
              <span className="wo-field-lbl">Odometer</span>
              <div>
                <input
                  className="wo-input"
                  value={props.odometerInput}
                  onChange={(e) => props.onOdometerInput(e.target.value)}
                />
                <div className="wo-table-hint">{props.samsaraOdoHint}</div>
              </div>
            </label>
            <label className="field">
              <span className="wo-field-lbl">Suggested load</span>
              <input className="wo-input" readOnly value={props.suggestedLoad} />
            </label>
          </div>
          {props.driverName.trim() ? (
            <div className="wo-driver-ok">
              Driver recorded on this entry — applies to all service types: repairs, PM, work orders, accidents,
              inspections.
            </div>
          ) : null}
        </SectionCard>

        <SectionCard sid="C" label="C — Planned work & parts">
          <div className="wo-split">
            <div>
              <span className="wo-field-lbl">Planned service / repair lines</span>
              {props.plannedLines.map((row, i) => (
                <div key={row.id} className="wo-planned-row">
                  <span className="wo-drag" aria-hidden>
                    ⋮⋮
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', width: 16 }}>{i + 1}</span>
                  <input
                    className="wo-input"
                    value={row.text}
                    onChange={(e) => {
                      const next = [...props.plannedLines]
                      next[i] = { ...row, text: e.target.value }
                      props.onPlannedLines(next)
                    }}
                  />
                  <input
                    className="wo-input"
                    style={{ maxWidth: 88 }}
                    placeholder="Tag"
                    value={row.tag ?? ''}
                    onChange={(e) => {
                      const next = [...props.plannedLines]
                      next[i] = { ...row, tag: e.target.value }
                      props.onPlannedLines(next)
                    }}
                    aria-label={`Line ${i + 1} type tag`}
                  />
                  <button
                    type="button"
                    className="wo-mini-btn"
                    onClick={() => props.onPlannedLines(props.plannedLines.filter((x) => x.id !== row.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="wo-link" onClick={addPlanned}>
                + Planned line
              </button>
            </div>
            <div>
              <span className="wo-field-lbl">Parts used (from catalog)</span>
              {partsErr ? (
                <p className="maint-form__err" role="alert">
                  {partsErr}
                </p>
              ) : null}
              <div className="wo-inline-row" style={{ marginBottom: 6 }}>
                <input
                  className="wo-input"
                  placeholder="Search parts catalog…"
                  value={partsQ}
                  onChange={(e) => setPartsQ(e.target.value)}
                />
                <input
                  className="wo-input"
                  style={{ width: 48 }}
                  value={partDraft.qty}
                  onChange={(e) => setPartDraft((d) => ({ ...d, qty: e.target.value }))}
                />
                <input
                  className="wo-input"
                  style={{ width: 72 }}
                  placeholder="Cost"
                  value={partDraft.cost}
                  onChange={(e) => setPartDraft((d) => ({ ...d, cost: e.target.value }))}
                />
                <button
                  type="button"
                  className="wo-mini-btn"
                  disabled={!partsHits[0]}
                  onClick={() => {
                    if (partsHits[0]) addPartFromHit(partsHits[0])
                  }}
                >
                  Add
                </button>
              </div>
              <div style={{ maxHeight: 120, overflow: 'auto', marginBottom: 6 }}>
                {partsHits.map((p) => (
                  <button
                    key={p.category + p.part_name}
                    type="button"
                    className="wo-link"
                    style={{ display: 'block', textAlign: 'left' }}
                    onClick={() => addPartFromHit(p)}
                  >
                    {p.part_name} <span className="muted">({p.category})</span>
                  </button>
                ))}
              </div>
              <table className="wo-parts-table" ref={partsLineCol.tableRef}>
                <colgroup>
                  {partsLineCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(['Part name', 'Part #', 'Qty', 'Cost'] as const).map((h, i) => (
                      <th key={h} style={{ width: partsLineCol.widths[i] }}>
                        {h}
                        {i < 3 ? (
                          <span
                            className="wo-col-resize"
                            onMouseDown={partsLineCol.onResizeMouseDown(i)}
                            role="separator"
                            aria-hidden
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {props.partLines.map((r) => (
                    <tr key={r.id}>
                      <td>{r.partName}</td>
                      <td>{r.partNo}</td>
                      <td>{r.qty}</td>
                      <td>{r.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="wo-mini-btn wo-bar-btn--excel"
                  onClick={() =>
                    exportDomTableToXlsx(
                      partsLineCol.tableRef.current,
                      `${workOrderExportStem(props.workOrderNumber)}-parts`,
                      { omitDateSuffix: true },
                    )
                  }
                >
                  Export parts to Excel
                </button>
              </div>
              <p className="wo-table-hint">Drag column edges to resize · Tab to navigate</p>
            </div>
          </div>
        </SectionCard>

        {props.servicePanel}

        <SectionCard sid="D" label="D — Category details (QuickBooks)">
          <div className="wo-table-wrap">
            <table className="wo-data-table" ref={catCol.tableRef}>
              <colgroup>
                {catCol.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {['#', 'Category', 'Description', 'Amount', 'Billable', 'Customer', 'Class', ''].map(
                    (h, i) => (
                      <th key={h + i} style={{ width: catCol.widths[i] }}>
                        {h}
                        {i < 7 ? (
                          <span
                            className="wo-col-resize"
                            onMouseDown={catCol.onResizeMouseDown(i)}
                            role="separator"
                            aria-hidden
                          />
                        ) : null}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {props.categoryLines.map((r, ri) => (
                  <tr key={r.id}>
                    <td>{ri + 1}</td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_CAT + ri * 8 + 1}
                        value={r.category}
                        onChange={(e) => {
                          const n = [...props.categoryLines]
                          n[ri] = { ...r, category: e.target.value }
                          props.onCategoryLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_CAT + ri * 8 + 2}
                        value={r.description}
                        onChange={(e) => {
                          const n = [...props.categoryLines]
                          n[ri] = { ...r, description: e.target.value }
                          props.onCategoryLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_CAT + ri * 8 + 3}
                        value={r.amount}
                        onChange={(e) => {
                          const n = [...props.categoryLines]
                          n[ri] = { ...r, amount: e.target.value }
                          props.onCategoryLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        tabIndex={TAB_CAT + ri * 8 + 4}
                        checked={r.billable}
                        onChange={(e) => {
                          const n = [...props.categoryLines]
                          n[ri] = { ...r, billable: e.target.checked }
                          props.onCategoryLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_CAT + ri * 8 + 5}
                        value={r.customer}
                        onChange={(e) => {
                          const n = [...props.categoryLines]
                          n[ri] = { ...r, customer: e.target.value }
                          props.onCategoryLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <span className="wo-class-chip">{classBadge}</span>
                    </td>
                    <td>
                      <div className="wo-row-actions">
                        <button
                          type="button"
                          className="wo-mini-btn"
                          tabIndex={TAB_CAT + ri * 8 + 6}
                          onClick={() => {
                            const copy: CategoryLine = {
                              ...r,
                              id: uid(),
                            }
                            const next = [...props.categoryLines]
                            next.splice(ri + 1, 0, copy)
                            props.onCategoryLines(next)
                          }}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className="wo-mini-btn"
                          tabIndex={TAB_CAT + ri * 8 + 7}
                          onClick={() =>
                            props.onCategoryLines(props.categoryLines.filter((x) => x.id !== r.id))
                          }
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wo-mini-btn"
              onClick={() =>
                props.onCategoryLines([
                  ...props.categoryLines,
                  {
                    id: uid(),
                    category: '',
                    description: '',
                    amount: '',
                    billable: true,
                    customer: '',
                  },
                ])
              }
            >
              Add lines
            </button>
            <button type="button" className="wo-mini-btn" onClick={() => props.onCategoryLines([])}>
              Clear all lines
            </button>
            <button
              type="button"
              className="wo-mini-btn wo-bar-btn--excel"
              onClick={() =>
                exportDomTableToXlsx(
                  catCol.tableRef.current,
                  `${workOrderExportStem(props.workOrderNumber)}-categories`,
                  { omitDateSuffix: true },
                )
              }
            >
              Export to Excel
            </button>
          </div>
          <p className="wo-table-hint">
            Drag column edges to resize · Tab to navigate (left-to-right, row by row)
          </p>
        </SectionCard>

        <SectionCard sid="E" label="E — Item details (product / service)">
          <div className="wo-table-wrap">
            <table className="wo-data-table" ref={itemCol.tableRef}>
              <colgroup>
                {itemCol.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {[
                    '#',
                    'Product/Service',
                    'SKU',
                    'Description',
                    'Qty',
                    'Rate',
                    'Amount',
                    'Billable',
                    'Customer',
                    'Class',
                    '',
                  ].map((h, i) => (
                    <th key={h + i} style={{ width: itemCol.widths[i] }}>
                      {h}
                      {i < 10 ? (
                        <span
                          className="wo-col-resize"
                          onMouseDown={itemCol.onResizeMouseDown(i)}
                          aria-hidden
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.itemLines.map((r, ri) => (
                  <tr key={r.id}>
                    <td>{ri + 1}</td>
                    <td>
                      <SearchableCombo
                        label="Product / service"
                        value={r.product}
                        tabIndex={TAB_ITEM + ri * 12 + 1}
                        onChange={(v) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, product: v }
                          props.onItemLines(n)
                        }}
                        options={props.productOptions}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 2}
                        value={r.sku}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, sku: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 3}
                        value={r.description}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, description: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 4}
                        value={r.qty}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, qty: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 5}
                        value={r.rate}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, rate: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 6}
                        value={r.amount}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, amount: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        tabIndex={TAB_ITEM + ri * 12 + 7}
                        checked={r.billable}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, billable: e.target.checked }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="wo-input"
                        tabIndex={TAB_ITEM + ri * 12 + 8}
                        value={r.customer}
                        onChange={(e) => {
                          const n = [...props.itemLines]
                          n[ri] = { ...r, customer: e.target.value }
                          props.onItemLines(n)
                        }}
                      />
                    </td>
                    <td>
                      <span className="wo-class-chip">{classBadge}</span>
                    </td>
                    <td>
                      <div className="wo-row-actions">
                        <button
                          type="button"
                          className="wo-mini-btn"
                          tabIndex={TAB_ITEM + ri * 12 + 9}
                          onClick={() => {
                            const copy: ItemLine = {
                              ...r,
                              id: uid(),
                            }
                            const next = [...props.itemLines]
                            next.splice(ri + 1, 0, copy)
                            props.onItemLines(next)
                          }}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className="wo-mini-btn"
                          tabIndex={TAB_ITEM + ri * 12 + 10}
                          onClick={() => props.onItemLines(props.itemLines.filter((x) => x.id !== r.id))}
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="wo-mini-btn"
              onClick={() =>
                props.onItemLines([
                  ...props.itemLines,
                  {
                    id: uid(),
                    product: '',
                    sku: '',
                    description: '',
                    qty: '1',
                    rate: '',
                    amount: '',
                    billable: true,
                    customer: '',
                  },
                ])
              }
            >
              Add lines
            </button>
            <button type="button" className="wo-mini-btn" onClick={() => props.onItemLines([])}>
              Clear all lines
            </button>
            <button
              type="button"
              className="wo-mini-btn wo-bar-btn--excel"
              onClick={() =>
                exportDomTableToXlsx(
                  itemCol.tableRef.current,
                  `${workOrderExportStem(props.workOrderNumber)}-items`,
                  { omitDateSuffix: true },
                )
              }
            >
              Export to Excel
            </button>
          </div>
          <p className="wo-table-hint">
            Drag column edges to resize · Tab to navigate (left-to-right, row by row)
          </p>
          <div className="wo-totals-bar">
            <span>Category lines: ${catSum.toFixed(2)}</span>
            <span>Item lines: ${itemSum.toFixed(2)}</span>
            <strong>Total: ${totalSum.toFixed(2)}</strong>
          </div>
        </SectionCard>

        <SectionCard
          sid="F"
          label={
            ledger
              ? props.ledgerMode === 'expense'
                ? 'F — QuickBooks expense header'
                : 'F — QuickBooks bill header'
              : 'F — QuickBooks posting header'
          }
        >
          <div className="wo-grid-f">
            <div>
              {ledger ? (
                <label className="field">
                  <span className="wo-field-lbl">TXN type</span>
                  <input
                    className="wo-input"
                    readOnly
                    aria-readonly
                    value={ledger === null ? '' : props.ledgerMode === 'bill' ? 'Bill' : 'Expense'}
                  />
                </label>
              ) : (
                <SearchableCombo
                  label="TXN type"
                  value={props.txnType}
                  onChange={props.onTxnType}
                  options={TXN_OPTS}
                />
              )}
            </div>
            <label className="field">
              <span className="wo-field-lbl">{ledger ? ledger.refLbl : 'Expense / bill #'}</span>
              <input
                className="wo-input"
                value={props.expenseBillNo}
                onChange={(e) => props.onExpenseBillNo(e.target.value)}
              />
            </label>
            <div>
              <SearchableCombo
                label="Payment method"
                value={props.paymentMethod}
                onChange={props.onPaymentMethod}
                options={PAYMENT_OPTS}
                placeholder="Select or type…"
              />
            </div>
            <label className="field">
              <span className="wo-field-lbl">Date</span>
              <input
                className="wo-input"
                type="date"
                value={props.txnDate}
                onChange={(e) => props.onTxnDate(e.target.value)}
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 6 }}>
            <span className="wo-field-lbl">Pay from account</span>
            <input
              className="wo-input"
              value={props.payFromAccount}
              onChange={(e) => props.onPayFromAccount(e.target.value)}
            />
          </label>
          <div className="wo-note-box">
            Post to QuickBooks syncs this WO as an expense or bill. Confirm vendor and category lines before posting.
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="wo-field-lbl" style={{ margin: 0 }}>
              Imports & uploads
            </span>
            <button type="button" className="wo-mini-btn">
              Open upload center
            </button>
          </div>
        </SectionCard>

        <SectionCard
          sid="G"
          label="G — Notes (1–5)"
          extraHead={
            <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400, textTransform: 'none' }}>
              Each box = one topic · Enter = new line
            </span>
          }
        >
          <div className="wo-grid2">
            {[0, 1, 2, 3].map((i) => (
              <label key={i} className="field">
                <span className="wo-field-lbl">Note {i + 1}</span>
                <textarea
                  className="wo-textarea"
                  value={props.notes[i]}
                  onChange={(e) => {
                    const n = [...props.notes] as [string, string, string, string, string]
                    n[i] = e.target.value
                    props.onNotes(n)
                  }}
                />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 8 }}>
            <span className="wo-field-lbl">Note 5</span>
            <textarea
              className="wo-textarea"
              value={props.notes[4]}
              onChange={(e) => {
                const n = [...props.notes] as [string, string, string, string, string]
                n[4] = e.target.value
                props.onNotes(n)
              }}
            />
          </label>
        </SectionCard>

        <SectionCard sid="H" label="H — Additional services (optional)">
          <label className="field">
            <span className="wo-field-lbl">Additional services</span>
            <textarea
              className="wo-textarea"
              placeholder="e.g. Mount & balance, alignment, extra filters — still one total cost above"
              value={props.additionalServices}
              onChange={(e) => props.onAdditionalServices(e.target.value)}
            />
          </label>
        </SectionCard>

        <div className="wo-memo-grid">
          <label className="field">
            <span className="wo-field-lbl">Memo</span>
            <textarea className="wo-textarea" value={props.memo} onChange={(e) => props.onMemo(e.target.value)} />
          </label>
          <div className="wo-attach">
            <div className="wo-field-lbl">Attachments</div>
            <button type="button" className="wo-link">
              Add attachment
            </button>
            <div className="wo-table-hint">Max file size: 20 MB · Show existing</div>
          </div>
        </div>
      </div>

      <footer className="wo-bottombar">
        <div className="wo-bottombar__btns">
          {props.saveBar}
          <button type="button" className="wo-bar-btn wo-bar-btn--info">
            Post to QuickBooks
          </button>
          <button type="button" className="wo-bar-btn">
            Attach file
          </button>
          <button type="button" className="wo-bar-btn">
            Parse PDF to lines
          </button>
          <button type="button" className="wo-bar-btn" onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="wo-bar-btn wo-bar-btn--excel"
            onClick={() => {
              const stem = workOrderExportStem(props.workOrderNumber)
              exportJsonSheetsToXlsx(
                [
                  { name: 'Categories', rows: categoryLinesToExportRows(props.categoryLines) },
                  { name: 'Items', rows: itemLinesToExportRows(props.itemLines) },
                ],
                stem,
                { omitDateSuffix: true },
              )
            }}
          >
            Export to Excel
          </button>
        </div>
        <span className="wo-bar-status">Save/post: draft · edit-mode uses plain textContent only</span>
      </footer>
    </div>
  )
}
