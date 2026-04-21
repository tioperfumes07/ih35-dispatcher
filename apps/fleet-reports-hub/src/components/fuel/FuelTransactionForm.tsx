/**
 * Unified fuel / DEF transaction shell (bills, expenses, DEF, combined).
 * Entry points: Accounting (+ New, hub quick actions, lists route) and Fuel & Energy tab (App).
 * “Open vendor directory” from the Fuel tab switches to Accounting → Lists → Name management.
 * Theme: all chrome via `fuel-txn-*` classes in index.css (CSS variables only).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportJsonRowsToXlsx } from '../../lib/tableExportXlsx'
import {
  emptyAddress,
  lookupVendorAddressByName,
  saveVendorAddressByName,
  type VendorCustomerAddress,
} from '../../lib/vendorCustomerAddresses'
import {
  FUEL_TRANSACTION_TYPE_LABELS,
  fuelTransactionTypesAlphabetical,
  type FuelTransactionType,
} from '../../types/fuelTransaction'
import { fetchQboItems } from '../../lib/qboItemsApi'
import type { QboItemRow } from '../../lib/qboItemsApi'
import { SearchableCombo, type ComboOption } from '../maintenance/SearchableCombo'

const TERMS_OPTS = [
  { value: '', label: '— None —' },
  { value: 'net15', label: 'Net 15' },
  { value: 'net30', label: 'Net 30' },
  { value: 'net60', label: 'Net 60' },
  { value: 'receipt', label: 'Due on receipt' },
]

/** Demo QBO-style items when `/api/accounting/qbo-items` is empty or offline. */
const QBO_PRODUCT_FALLBACK: ComboOption[] = [
  { value: 'def', label: 'DEF fluid' },
  { value: 'diesel', label: 'Diesel — bulk' },
  { value: 'oil', label: 'Engine oil' },
  { value: 'card', label: 'Fuel card purchase' },
  { value: 'reefer', label: 'Reefer fuel' },
  { value: 'labor', label: 'Shop labor' },
]

const DRIVER_HINTS = ['A. Patel', 'J. Martinez', 'R. Chen', 'S. Okafor']

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

type FuelCatLine = {
  id: string
  category: string
  description: string
  amount: string
  billable: boolean
  customer: string
  position: string
  partNo: string
  lineMemo: string
}

type FuelItemLine = {
  id: string
  product: string
  sku: string
  description: string
  qty: string
  unitPrice: string
  total: string
  billable: boolean
  customer: string
  position: string
  partNo: string
  lineMemo: string
}

function money(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export type FuelTransactionFormProps = {
  open: boolean
  transactionType: FuelTransactionType
  onClose: () => void
  /** Optional: parent can navigate to vendor directory (e.g. name management). */
  onOpenVendorDirectory?: () => void
}

type SaveMenuChoice = 'save' | 'save-close' | 'save-new'

export function FuelTransactionForm({
  open,
  transactionType: initialType,
  onClose,
  onOpenVendorDirectory,
}: FuelTransactionFormProps) {
  const titleId = useId()
  const { isFullScreen, toggle: toggleFs } = useFullScreen()
  const [txType, setTxType] = useState<FuelTransactionType>(initialType)
  const [wideIdx, setWideIdx] = useState(1)
  const [vendor, setVendor] = useState('')
  const [payFrom, setPayFrom] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState('')
  const [unitNo, setUnitNo] = useState('')
  const [driver, setDriver] = useState('')
  const [billExpenseNo, setBillExpenseNo] = useState('')
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [terms, setTerms] = useState('')
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState('')
  const [loadInvoiceNo, setLoadInvoiceNo] = useState('')
  const [memo, setMemo] = useState('')
  const [addrOverride, setAddrOverride] = useState<VendorCustomerAddress | null>(null)
  const [addrEditing, setAddrEditing] = useState(false)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [defaultSaveChoice, setDefaultSaveChoice] = useState<SaveMenuChoice>('save')
  const saveMenuRef = useRef<HTMLDivElement>(null)
  const [productOptions, setProductOptions] = useState<ComboOption[]>(() => [
    { value: '__add', label: '＋ Add new' },
    ...QBO_PRODUCT_FALLBACK,
  ])

  const catCol = useColumnResize([28, 108, 120, 72, 52, 88, 72, 56, 64, 96, 40])
  const itemCol = useColumnResize([
    28, 116, 56, 96, 44, 56, 64, 52, 80, 72, 56, 56, 88, 40,
  ])

  const [catLines, setCatLines] = useState<FuelCatLine[]>(() => [
    {
      id: uid(),
      category: 'Fuel',
      description: '',
      amount: '',
      billable: false,
      customer: '',
      position: '',
      partNo: '',
      lineMemo: '',
    },
  ])
  const [itemLines, setItemLines] = useState<FuelItemLine[]>(() => [
    {
      id: uid(),
      product: 'diesel',
      sku: '',
      description: '',
      qty: '',
      unitPrice: '',
      total: '',
      billable: false,
      customer: '',
      position: '',
      partNo: '',
      lineMemo: '',
    },
  ])

  useEffect(() => {
    if (open) setTxType(initialType)
  }, [open, initialType])

  useEffect(() => {
    if (!saveMenuOpen) return
    const fn = (e: MouseEvent) => {
      if (!saveMenuRef.current?.contains(e.target as Node)) setSaveMenuOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [saveMenuOpen])

  useEffect(() => {
    let cancelled = false
    void fetchQboItems()
      .then((rows: QboItemRow[]) => {
        if (cancelled || !rows.length) return
        setProductOptions([
          { value: '__add', label: '＋ Add new' },
          ...rows.map((i) => ({
            value: i.id,
            label: i.name,
            subtitle: i.category,
          })),
        ])
      })
      .catch(() => {
        /* keep embedded fallback list */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const dbAddress = useMemo(() => {
    if (!vendor.trim()) return null
    return lookupVendorAddressByName(vendor)
  }, [vendor])

  const displayAddress = addrOverride ?? dbAddress

  const balanceDue = useMemo(() => {
    const c = catLines.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    const i = itemLines.reduce((s, r) => s + (parseFloat(r.total) || 0), 0)
    return c + i
  }, [catLines, itemLines])

  const billNoLabel =
    txType === 'fuel-expense' ? 'Expense No.' : 'Bill No.'

  const title = FUEL_TRANSACTION_TYPE_LABELS[txType]

  const clearCat = () =>
    setCatLines([
      {
        id: uid(),
        category: 'Fuel',
        description: '',
        amount: '',
        billable: false,
        customer: '',
        position: '',
        partNo: '',
        lineMemo: '',
      },
    ])

  const clearItem = () =>
    setItemLines([
      {
        id: uid(),
        product: 'diesel',
        sku: '',
        description: '',
        qty: '',
        unitPrice: '',
        total: '',
        billable: false,
        customer: '',
        position: '',
        partNo: '',
        lineMemo: '',
      },
    ])

  const exportXlsx = () => {
    const rows = [
      ...catLines.map((r, i) => ({
        lineType: 'category',
        row: i + 1,
        ...r,
        class: unitNo || '—',
      })),
      ...itemLines.map((r, i) => ({
        lineType: 'item',
        row: i + 1,
        ...r,
        class: unitNo || '—',
      })),
    ]
    exportJsonRowsToXlsx(rows, `FuelTxn-${txType}`, 'Lines')
  }

  const runSave = (choice: SaveMenuChoice) => {
    setDefaultSaveChoice(choice)
    setSaveMenuOpen(false)
    if (vendor.trim()) {
      const toStore = addrOverride ?? dbAddress
      if (toStore && (toStore.street_address || toStore.city)) {
        saveVendorAddressByName(vendor, { ...toStore, country: toStore.country || 'USA' })
      }
    }
    if (choice === 'save-close') onClose()
    if (choice === 'save-new') {
      /* keep form open for another entry */
    }
  }

  const printForm = () => window.print()

  const WIDTHS = [920, 1040, 1180, 1320]
  const dialogWidth = WIDTHS[Math.min(wideIdx, WIDTHS.length - 1)]!

  if (!open) return null

  const classBadge = unitNo.trim() || '—'

  const addrBlock = !vendor.trim() ? (
    <p className="muted fuel-txn__addr-placeholder">
      Select a vendor above — address auto-fills
    </p>
  ) : !displayAddress || !displayAddress.street_address ? (
    <div>
      <p className="muted fuel-txn__addr-placeholder">
        No address on file — add in vendor settings
        {onOpenVendorDirectory ? (
          <>
            {' '}
            <button type="button" className="fuel-txn__link" onClick={onOpenVendorDirectory}>
              Open vendor directory
            </button>
          </>
        ) : null}
      </p>
    </div>
  ) : addrEditing ? (
    <div className="fuel-txn__addr-edit">
      <label className="fuel-txn__field">
        <span className="fuel-txn__lbl">Street</span>
        <input
          className="fuel-txn__inp"
          value={(addrOverride ?? displayAddress).street_address}
          onChange={(e) =>
            setAddrOverride({
              ...(addrOverride ?? displayAddress ?? emptyAddress()),
              street_address: e.target.value,
            })
          }
        />
      </label>
      <div className="fuel-txn__row2">
        <label className="fuel-txn__field">
          <span className="fuel-txn__lbl">City</span>
          <input
            className="fuel-txn__inp"
            value={(addrOverride ?? displayAddress).city}
            onChange={(e) =>
              setAddrOverride({
                ...(addrOverride ?? displayAddress ?? emptyAddress()),
                city: e.target.value,
              })
            }
          />
        </label>
        <label className="fuel-txn__field">
          <span className="fuel-txn__lbl">State</span>
          <input
            className="fuel-txn__inp"
            value={(addrOverride ?? displayAddress).state}
            onChange={(e) =>
              setAddrOverride({
                ...(addrOverride ?? displayAddress ?? emptyAddress()),
                state: e.target.value,
              })
            }
          />
        </label>
        <label className="fuel-txn__field">
          <span className="fuel-txn__lbl">ZIP</span>
          <input
            className="fuel-txn__inp"
            value={(addrOverride ?? displayAddress).zip}
            onChange={(e) =>
              setAddrOverride({
                ...(addrOverride ?? displayAddress ?? emptyAddress()),
                zip: e.target.value,
              })
            }
          />
        </label>
      </div>
      <label className="fuel-txn__field">
        <span className="fuel-txn__lbl">Country</span>
        <input
          className="fuel-txn__inp"
          value={(addrOverride ?? displayAddress).country}
          onChange={(e) =>
            setAddrOverride({
              ...(addrOverride ?? displayAddress ?? emptyAddress()),
              country: e.target.value,
            })
          }
        />
      </label>
      <button type="button" className="btn sm" onClick={() => setAddrEditing(false)}>
        Done editing
      </button>
    </div>
  ) : (
    <div className="fuel-txn__addr-ro">
      <button type="button" className="fuel-txn__addr-edit-link" onClick={() => setAddrEditing(true)}>
        Edit
      </button>
      <p className="fuel-txn__addr-name">{vendor.trim()}</p>
      <p>{displayAddress.street_address}</p>
      <p>
        {displayAddress.city}, {displayAddress.state} {displayAddress.zip}
      </p>
      <p>{displayAddress.country}</p>
      {displayAddress.phone ? <p className="muted tiny">{displayAddress.phone}</p> : null}
      {displayAddress.email ? <p className="muted tiny">{displayAddress.email}</p> : null}
    </div>
  )

  const tabBase = 200

  return (
    <div
      className="fuel-txn-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={'fuel-txn-dialog' + (isFullScreen ? ' fuel-txn-dialog--fs' : '')}
        style={
          isFullScreen
            ? MODAL_FULLSCREEN_STYLE
            : { width: `min(${dialogWidth}px, 100% - 24px)`, maxHeight: 'min(96vh, 920px)' }
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="fuel-txn-topbar">
          <div className="fuel-txn-topbar__left">
            <h2 id={titleId} className="fuel-txn-title">
              {title}
            </h2>
            <label className="fuel-txn-type-lbl">
              <span className="sr-only">Transaction type</span>
              <select
                className="fuel-txn__sel fuel-txn-type-sel"
                value={txType}
                onChange={(e) => setTxType(e.target.value as FuelTransactionType)}
              >
                {fuelTransactionTypesAlphabetical().map((v) => (
                  <option key={v} value={v}>
                    {FUEL_TRANSACTION_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
            <div className="fuel-txn-balance">
              <span className="muted fuel-txn-balance__lbl">Balance due</span>
              <span className="fuel-txn-balance__val">{money(balanceDue)}</span>
            </div>
          </div>
          <div className="fuel-txn-topbar__right">
            <button
              type="button"
              className="btn sm fuel-txn-bar-btn"
              onClick={() => setWideIdx((i) => (i + 1) % WIDTHS.length)}
            >
              Maximize
            </button>
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggleFs}
              className="btn sm fuel-txn-bar-btn fuel-txn-bar-btn--fs"
              title="Full screen"
            />
            <button type="button" className="btn sm fuel-txn-bar-btn" onClick={printForm}>
              Print
            </button>
            <button type="button" className="btn sm fuel-txn-bar-btn danger" onClick={onClose}>
              Cancel
            </button>
          </div>
        </header>

        <div className="fuel-txn-scroll">
          <div className="fuel-txn-header-grid">
            <div className="fuel-txn-header-grid__left">
              <div className="fuel-txn-row2">
                <label className="fuel-txn__field fuel-txn__field--grow">
                  <span className="fuel-txn__lbl">Vendor (QuickBooks)</span>
                  <input
                    className="fuel-txn__inp"
                    value={vendor}
                    onChange={(e) => {
                      setVendor(e.target.value)
                      setAddrOverride(null)
                      setAddrEditing(false)
                    }}
                    placeholder="Vendor name"
                  />
                </label>
                <label className="fuel-txn__field fuel-txn__field--grow">
                  <span className="fuel-txn__lbl">Pay from account (QuickBooks)</span>
                  <input
                    className="fuel-txn__inp"
                    value={payFrom}
                    onChange={(e) => setPayFrom(e.target.value)}
                    placeholder="Checking / credit card"
                  />
                </label>
              </div>

              <div className="fuel-txn-addr-box">
                {addrBlock}
                <p className="fuel-txn-addr-hint muted tiny">
                  Address stored in vendor database · editable per transaction
                </p>
              </div>

              <div className="fuel-txn-row2">
                <label className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Payment date</span>
                  <input
                    className="fuel-txn__inp"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </label>
                <label className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Payment method</span>
                  <input
                    className="fuel-txn__inp"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    placeholder="Payment method"
                  />
                </label>
              </div>

              <div className="fuel-txn-row2">
                <div className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Unit / asset</span>
                  {unitNo.trim() ? (
                    <>
                      <div className="fuel-txn-unit-row">
                        <span className="fuel-txn-unit-badge">{unitNo.trim()}</span>
                        <button type="button" className="fuel-txn__link" onClick={() => setUnitNo('')}>
                          Change
                        </button>
                      </div>
                      <p className="muted tiny">Unit number = Class in QuickBooks</p>
                    </>
                  ) : (
                    <>
                      <input
                        className="fuel-txn__inp"
                        value={unitNo}
                        onChange={(e) => setUnitNo(e.target.value)}
                        placeholder="Search or enter unit"
                      />
                      <p className="muted tiny">Unit number = Class in QuickBooks</p>
                    </>
                  )}
                </div>
                <label className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Driver</span>
                  <input
                    className="fuel-txn__inp"
                    value={driver}
                    onChange={(e) => setDriver(e.target.value)}
                    placeholder="Driver name (from vendors)"
                    list="fuel-txn-drivers"
                  />
                  <datalist id="fuel-txn-drivers">
                    {DRIVER_HINTS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </label>
              </div>
            </div>

            <div className="fuel-txn-header-grid__right">
              <label className="fuel-txn__field">
                <span className="fuel-txn__lbl">{billNoLabel}</span>
                <input
                  className="fuel-txn__inp mono"
                  value={billExpenseNo}
                  onChange={(e) => setBillExpenseNo(e.target.value)}
                  placeholder="Supplier invoice no."
                />
              </label>
              <div className="fuel-txn-row2">
                <label className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Date</span>
                  <input
                    className="fuel-txn__inp"
                    type="date"
                    value={invDate}
                    onChange={(e) => setInvDate(e.target.value)}
                  />
                </label>
                <label className="fuel-txn__field">
                  <span className="fuel-txn__lbl">Due date</span>
                  <input
                    className="fuel-txn__inp"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </label>
              </div>
              <label className="fuel-txn__field">
                <span className="fuel-txn__lbl">Terms</span>
                <select
                  className="fuel-txn__sel"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                >
                  {TERMS_OPTS.map((o) => (
                    <option key={o.value || 'none'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fuel-txn__field">
                <span className="fuel-txn__lbl">Vendor invoice #</span>
                <input
                  className="fuel-txn__inp mono"
                  value={vendorInvoiceNo}
                  onChange={(e) => setVendorInvoiceNo(e.target.value)}
                  placeholder="Supplier invoice no."
                />
              </label>
              <label className="fuel-txn__field">
                <span className="fuel-txn__lbl">Load / invoice #</span>
                <input
                  className="fuel-txn__inp"
                  value={loadInvoiceNo}
                  onChange={(e) => setLoadInvoiceNo(e.target.value)}
                  placeholder="P&L key (often load #)"
                />
              </label>
            </div>
          </div>

          <div className="fuel-txn-pdf-strip">
            <span className="fuel-txn-pdf-strip__icon" aria-hidden>
              PDF
            </span>
            <span className="fuel-txn-pdf-strip__txt">
              Vendor invoice PDF — upload to auto-extract and fill lines
            </span>
            <button type="button" className="btn sm">
              Choose file
            </button>
            <button type="button" className="btn sm success">
              Extract &amp; fill lines
            </button>
          </div>

          <section className="fuel-txn-table-sec">
            <div className="fuel-txn-sec-head">
              <span className="fuel-txn-sec-title">Category details</span>
              <span className="fuel-txn-sec-badge">{catLines.length}</span>
            </div>
            <div className="fuel-txn-table-wrap">
              <table
                className="fuel-txn-table fr-data-table"
                ref={catCol.tableRef}
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {catCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(
                      [
                        '#',
                        'Category',
                        'Description',
                        'Amount',
                        'Billable',
                        'Customer',
                        'Class',
                        'Position',
                        'Part #',
                        'Line memo',
                        '',
                      ] as const
                    ).map((h, i) => (
                      <th key={h + String(i)} className="fuel-txn-th fr-th-resizable">
                        {h}
                        {i < catCol.widths.length - 1 ? (
                          <span
                            className="fr-col-resize"
                            role="presentation"
                            onMouseDown={catCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catLines.map((row, ri) => (
                    <tr key={row.id} className="fuel-txn-tr">
                      <td className="fuel-txn-drag-cell">
                        <span className="fuel-txn-drag" aria-hidden>
                          ⠿
                        </span>
                        <span>{ri + 1}</span>
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.category}
                          tabIndex={tabBase + ri * 12}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, category: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.description}
                          tabIndex={tabBase + ri * 12 + 1}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, description: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.amount}
                          tabIndex={tabBase + ri * 12 + 2}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, amount: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td className="fuel-txn-cb">
                        <input
                          type="checkbox"
                          checked={row.billable}
                          tabIndex={tabBase + ri * 12 + 3}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, billable: e.target.checked }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.customer}
                          tabIndex={tabBase + ri * 12 + 4}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, customer: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <span className="fuel-txn-class-badge">{classBadge}</span>
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.position}
                          tabIndex={tabBase + ri * 12 + 5}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, position: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.partNo}
                          tabIndex={tabBase + ri * 12 + 6}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, partNo: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.lineMemo}
                          tabIndex={tabBase + ri * 12 + 7}
                          onChange={(e) => {
                            const n = [...catLines]
                            n[ri] = { ...row, lineMemo: e.target.value }
                            setCatLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="fuel-txn-del"
                          aria-label="Delete line"
                          tabIndex={tabBase + ri * 12 + 8}
                          onClick={() => setCatLines((L) => L.filter((x) => x.id !== row.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fuel-txn-table-foot">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  setCatLines((L) => [
                    ...L,
                    {
                      id: uid(),
                      category: 'Fuel',
                      description: '',
                      amount: '',
                      billable: false,
                      customer: '',
                      position: '',
                      partNo: '',
                      lineMemo: '',
                    },
                  ])
                }
              >
                Add category line
              </button>
              <button type="button" className="btn sm danger ghost" onClick={clearCat}>
                Clear category lines
              </button>
              <span className="fuel-txn-table-hint muted tiny">
                Drag column edges to resize · Tab to navigate
              </span>
            </div>
          </section>

          <section className="fuel-txn-table-sec">
            <div className="fuel-txn-sec-head">
              <span className="fuel-txn-sec-title">Item details — product / service</span>
              <span className="fuel-txn-sec-badge">{itemLines.length}</span>
            </div>
            <div className="fuel-txn-table-wrap">
              <table
                className="fuel-txn-table fr-data-table"
                ref={itemCol.tableRef}
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {itemCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {(
                      [
                        '#',
                        'Product/Service',
                        'SKU',
                        'Description',
                        'Qty',
                        'Unit $',
                        'Total',
                        'Billable',
                        'Customer',
                        'Class',
                        'Position',
                        'Part #',
                        'Line memo',
                        '',
                      ] as const
                    ).map((h, i) => (
                      <th key={h + String(i)} className="fuel-txn-th fr-th-resizable">
                        {h}
                        {i < itemCol.widths.length - 1 ? (
                          <span
                            className="fr-col-resize"
                            role="presentation"
                            onMouseDown={itemCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemLines.map((row, ri) => (
                    <tr key={row.id} className="fuel-txn-tr">
                      <td className="fuel-txn-drag-cell">
                        <span className="fuel-txn-drag" aria-hidden>
                          ⠿
                        </span>
                        <span>{ri + 1}</span>
                      </td>
                      <td>
                        <div className="fuel-txn-combo-wrap">
                          <SearchableCombo
                            label="Product / service"
                            value={row.product}
                            onChange={(v) => {
                              const n = [...itemLines]
                              n[ri] = { ...row, product: v }
                              setItemLines(n)
                            }}
                            options={productOptions}
                            placeholder="Search QBO item…"
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.sku}
                          tabIndex={tabBase + 500 + ri * 14}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, sku: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.description}
                          tabIndex={tabBase + 500 + ri * 14 + 1}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, description: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.qty}
                          tabIndex={tabBase + 500 + ri * 14 + 2}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, qty: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.unitPrice}
                          tabIndex={tabBase + 500 + ri * 14 + 3}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, unitPrice: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.total}
                          tabIndex={tabBase + 500 + ri * 14 + 4}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, total: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td className="fuel-txn-cb">
                        <input
                          type="checkbox"
                          checked={row.billable}
                          tabIndex={tabBase + 500 + ri * 14 + 5}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, billable: e.target.checked }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.customer}
                          tabIndex={tabBase + 500 + ri * 14 + 6}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, customer: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <span className="fuel-txn-class-badge">{classBadge}</span>
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.position}
                          tabIndex={tabBase + 500 + ri * 14 + 7}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, position: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.partNo}
                          tabIndex={tabBase + 500 + ri * 14 + 8}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, partNo: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="fuel-txn-cell-inp"
                          value={row.lineMemo}
                          tabIndex={tabBase + 500 + ri * 14 + 9}
                          onChange={(e) => {
                            const n = [...itemLines]
                            n[ri] = { ...row, lineMemo: e.target.value }
                            setItemLines(n)
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="fuel-txn-del"
                          aria-label="Delete line"
                          tabIndex={tabBase + 500 + ri * 14 + 10}
                          onClick={() => setItemLines((L) => L.filter((x) => x.id !== row.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fuel-txn-table-foot">
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  setItemLines((L) => [
                    ...L,
                    {
                      id: uid(),
                      product: 'diesel',
                      sku: '',
                      description: '',
                      qty: '',
                      unitPrice: '',
                      total: '',
                      billable: false,
                      customer: '',
                      position: '',
                      partNo: '',
                      lineMemo: '',
                    },
                  ])
                }
              >
                Add item line
              </button>
              <button type="button" className="btn sm danger ghost" onClick={clearItem}>
                Clear item lines
              </button>
              <span className="fuel-txn-table-hint muted tiny">
                Drag column edges to resize · Tab to navigate
              </span>
            </div>
          </section>

          <div className="fuel-txn-totals">
            <span className="muted">Total lines: {catLines.length + itemLines.length}</span>
            <span className="muted">Total:</span>
            <span className="fuel-txn-totals__amt">{money(balanceDue)}</span>
          </div>

          <div className="fuel-txn-memo-grid">
            <label className="fuel-txn__field">
              <span className="fuel-txn__lbl">Memo</span>
              <textarea
                className="fuel-txn-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Notes for QuickBooks (header)"
                rows={3}
              />
            </label>
            <div className="fuel-txn-attach">
              <span className="fuel-txn__lbl">Attachments</span>
              <div className="fuel-txn-attach-box">
                <button type="button" className="btn sm">
                  Choose files
                </button>
                <span className="muted tiny">Multiple files ok</span>
                <p className="muted tiny" style={{ marginTop: 8 }}>
                  Saved with ERP work order before QBO post.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="fuel-txn-bottom">
          <div className="fuel-txn-bottom__left">
            <button
              type="button"
              className="btn sm ghost fuel-txn-bar-btn"
              onClick={() => {
                clearCat()
                clearItem()
              }}
            >
              Clear lines
            </button>
            <button type="button" className="btn sm ghost fuel-txn-bar-btn" onClick={onClose}>
              Cancel
            </button>
            <span className="fuel-txn-bottom__div" aria-hidden />
            <div className="fuel-txn-save-split" ref={saveMenuRef}>
              <button
                type="button"
                className="btn success fuel-txn-save-split__main fuel-txn-bar-btn"
                onClick={() => runSave(defaultSaveChoice)}
              >
                {defaultSaveChoice === 'save'
                  ? 'Save'
                  : defaultSaveChoice === 'save-close'
                    ? 'Save and close'
                    : 'Save and new'}
              </button>
              <button
                type="button"
                className="btn success fuel-txn-save-split__caret fuel-txn-bar-btn"
                aria-haspopup="menu"
                aria-expanded={saveMenuOpen}
                onClick={() => setSaveMenuOpen((o) => !o)}
              >
                ▾
              </button>
              {saveMenuOpen ? (
                <ul className="fuel-txn-save-menu" role="menu">
                  <li>
                    <button type="button" role="menuitem" onClick={() => runSave('save')}>
                      Save
                    </button>
                  </li>
                  <li>
                    <button type="button" role="menuitem" onClick={() => runSave('save-close')}>
                      Save and close
                    </button>
                  </li>
                  <li>
                    <button type="button" role="menuitem" onClick={() => runSave('save-new')}>
                      Save and new
                    </button>
                  </li>
                </ul>
              ) : null}
            </div>
            <button type="button" className="btn primary fuel-txn-bar-btn">
              Post to QuickBooks
            </button>
            <span className="fuel-txn-bottom__div" aria-hidden />
            <button type="button" className="btn sm fuel-txn-bar-btn fuel-txn-export" onClick={exportXlsx}>
              Export to Excel
            </button>
          </div>
          <span className="muted tiny fuel-txn-status">Save/post status: draft</span>
        </footer>
      </div>
    </div>
  )
}
