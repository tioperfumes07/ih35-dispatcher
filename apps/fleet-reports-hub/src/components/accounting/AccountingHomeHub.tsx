import { useCallback, useMemo, useState } from 'react'
import type { FuelTransactionType } from '../../types/fuelTransaction'
import type { AccountingMaintNavTarget } from './accountingNav'
import type { ListsCatalogsTab } from './ListsCatalogsWorkspace'
import type { ListsCatalogListId } from './ListsCatalogsWorkspace'
import type { SpecializedModalId } from './AccountingSpecializedModals'

export type AccountingHomeOverlay =
  | null
  | 'bill-payment'
  | 'payment-history'
  | 'vendor-bill'

type Props = {
  onOpenFuel: (t: FuelTransactionType) => void
  onOpenSpecialized: (id: SpecializedModalId) => void
  onRequestMaintenanceNav: (target: AccountingMaintNavTarget) => void
  onOpenRecurring: () => void
  onOpenLists: (tab: ListsCatalogsTab, listId?: ListsCatalogListId | null) => void
  onOpenTracking: () => void
  onOpenUploadCenter: () => void
  onOpenSettingsUsers: () => void
  onSetHomeOverlay: (o: AccountingHomeOverlay) => void
  kpis?: {
    openBillsCount: string
    openBillsSub: string
    expensesMonthAmount: string
    expensesMonthSub: string
    qboVendors: string
    qboVendorsSub: string
    pendingQboPosts: string
    pendingQboPostsSub: string
    pendingQboPostsWarn: boolean
  }
}

type SectionId =
  | 'bills'
  | 'expenses'
  | 'bill-payment'
  | 'quickbooks'
  | 'uploads'
  | 'specialized'

type RowDef = {
  key: string
  label: string
  desc: string
  onActivate: () => void
}

function SectionBlock({
  id,
  title,
  newLabel,
  onCreate,
  rows,
  expanded,
  onToggle,
}: {
  id: SectionId
  title: string
  newLabel: string
  onCreate: () => void
  rows: RowDef[]
  expanded: boolean
  onToggle: (id: SectionId) => void
}) {
  return (
    <div className="acct-hub-sec">
      <div className="section-breadcrumb">
        <button type="button" className="bc-back" onClick={() => onToggle(id)}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="bc-slash">/</span>
        <span className="bc-title">{title}</span>
        <button type="button" className="bc-new-btn" onClick={onCreate}>
          {newLabel}
        </button>
      </div>
      {expanded ? (
        <ul className="acct-hub-sec__body">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className="acct-hub-sec__row" onClick={r.onActivate}>
                <span className="acct-hub-sec__row-copy">
                  <span className="type-row-name">{r.label}</span>
                  <span className="type-row-desc">{r.desc}</span>
                </span>
                <span className="type-row-btn">Open →</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function AccountingHomeHub({
  onOpenFuel,
  onOpenSpecialized,
  onRequestMaintenanceNav,
  onOpenRecurring,
  onOpenLists,
  onOpenTracking,
  onOpenUploadCenter,
  onOpenSettingsUsers,
  onSetHomeOverlay,
  kpis,
}: Props) {
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>(() => ({
    bills: true,
    expenses: true,
    'bill-payment': true,
    quickbooks: true,
    uploads: true,
    specialized: true,
  }))

  const toggle = useCallback((id: SectionId) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }, [])

  const sections = useMemo(() => {
    const billRows: RowDef[] = [
      {
        key: 'driver-bill',
        label: 'Driver bill',
        desc: 'Driver-related expense bill linked to driver vendor in QuickBooks.',
        onActivate: () => onOpenSpecialized('driver-settlement'),
      },
      {
        key: 'fuel-bill',
        label: 'Fuel bill',
        desc: 'Fuel purchase bill with vendor address autofill and class by unit.',
        onActivate: () => onOpenFuel('fuel-bill'),
      },
      {
        key: 'maint-bill',
        label: 'Maintenance bill',
        desc: 'Maintenance vendor bill that can be tied to a work order.',
        onActivate: () => onRequestMaintenanceNav('bill'),
      },
      {
        key: 'multi',
        label: 'Multiple bills',
        desc: 'Enter multiple bills at once from vendor statement lines.',
        onActivate: () => onOpenRecurring(),
      },
      {
        key: 'repair-bill',
        label: 'Repair bill',
        desc: 'Repair-order related bill synced to QuickBooks expense records.',
        onActivate: () => onRequestMaintenanceNav('bill'),
      },
      {
        key: 'vendor-bill',
        label: 'Vendor bill',
        desc: 'General vendor bill for any QuickBooks vendor.',
        onActivate: () => onSetHomeOverlay('vendor-bill'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const expRows: RowDef[] = [
      {
        key: 'exp',
        label: 'Expense',
        desc: 'General expense record for any vendor and category.',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
      {
        key: 'fuel-exp',
        label: 'Fuel expense',
        desc: 'Fuel expense record with QuickBooks vendor linkage.',
        onActivate: () => onOpenFuel('fuel-expense'),
      },
      {
        key: 'maint-exp',
        label: 'Maintenance expense',
        desc: 'Maintenance-related expense that can link to work order context.',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
      {
        key: 'repair-exp',
        label: 'Repair expense',
        desc: 'Repair-related expense record for accounting and integrity checks.',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const payRows: RowDef[] = [
      {
        key: 'bp',
        label: 'Bill payment',
        desc: 'Pay a standard vendor bill and keep QuickBooks in sync.',
        onActivate: () => onSetHomeOverlay('bill-payment'),
      },
      {
        key: 'dbp',
        label: 'Driver bill payment',
        desc: 'Pay driver bills with automatic driver-vendor mapping.',
        onActivate: () => onOpenSpecialized('driver-settlement'),
      },
      {
        key: 'ph',
        label: 'Payment history',
        desc: 'Review posted bill payments with date/vendor filtering.',
        onActivate: () => onSetHomeOverlay('payment-history'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const qboRows: RowDef[] = [
      {
        key: 'conn',
        label: 'Connect QuickBooks',
        desc: 'Open QuickBooks list sync workspace and connection status.',
        onActivate: () => onOpenLists('qbo-items', 'qbo-items-list'),
      },
      {
        key: 'items',
        label: 'Items & accounts',
        desc: 'Manage item and account lists pulled from QuickBooks.',
        onActivate: () => onOpenLists('qbo-items', 'qbo-items-list'),
      },
      {
        key: 'sync',
        label: 'Sync status',
        desc: 'Check sync health, warnings, and QuickBooks list freshness.',
        onActivate: () => onOpenLists('qbo-items', 'qbo-items-list'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const upRows: RowDef[] = [
      {
        key: 'bank',
        label: 'Bank CSV matching',
        desc: 'Open bank import matching and mapping tools.',
        onActivate: () => onOpenLists('vendors-drivers', 'bank-csv'),
      },
      {
        key: 'sam-cloud',
        label: 'Samsara Cloud',
        desc: 'Open tracking data and Samsara-linked fleet views.',
        onActivate: () => onOpenTracking(),
      },
      {
        key: 'upload',
        label: 'Upload center',
        desc: 'Open upload center for docs and import payloads.',
        onActivate: () => onOpenUploadCenter(),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const specRows: RowDef[] = [
      {
        key: 'settings',
        label: 'Settings & users',
        desc: 'Open users/settings surface for accounting controls.',
        onActivate: () => onOpenSettingsUsers(),
      },
      {
        key: 'tms',
        label: 'TMS loads',
        desc: 'Open load settlement and specialized accounting flow.',
        onActivate: () => onOpenSpecialized('load-tms'),
      },
      {
        key: 'tools',
        label: 'Tools & data',
        desc: 'Open tools and list catalog management workspace.',
        onActivate: () => onOpenLists('fleet-samsara', null),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const blocks = [
      { id: 'bill-payment' as const, title: 'Bill payment', rows: payRows },
      { id: 'bills' as const, title: 'Bills', rows: billRows },
      { id: 'expenses' as const, title: 'Expenses', rows: expRows },
      { id: 'quickbooks' as const, title: 'QuickBooks', rows: qboRows },
      { id: 'specialized' as const, title: 'Specialized', rows: specRows },
      { id: 'uploads' as const, title: 'Uploads', rows: upRows },
    ]
    return blocks.sort((a, b) => a.title.localeCompare(b.title))
  }, [
    onOpenFuel,
    onOpenSpecialized,
    onRequestMaintenanceNav,
    onOpenRecurring,
    onOpenLists,
    onOpenTracking,
    onOpenUploadCenter,
    onOpenSettingsUsers,
    onSetHomeOverlay,
  ])

  /** Packet 8 quick actions — alphabetical (DEF / combined stay in + New and Bills via navigation). */
  const quickActions = useMemo(
    () =>
      [
        { key: 'qa-bp', label: '+ Bill payment', onClick: () => onSetHomeOverlay('bill-payment') },
        {
          key: 'qa-db',
          label: '+ Driver bill',
          onClick: () => onOpenSpecialized('driver-settlement'),
        },
        { key: 'qa-ex', label: '+ Expense', onClick: () => onRequestMaintenanceNav('expense') },
        { key: 'qa-fb', label: '+ Fuel bill', onClick: () => onOpenFuel('fuel-bill') },
        { key: 'qa-fe', label: '+ Fuel expense', onClick: () => onOpenFuel('fuel-expense') },
        {
          key: 'qa-mb',
          label: '+ Maintenance bill',
          onClick: () => onRequestMaintenanceNav('bill'),
        },
        {
          key: 'qa-me',
          label: '+ Maintenance expense',
          onClick: () => onRequestMaintenanceNav('expense'),
        },
        { key: 'qa-mul', label: '+ Multiple bills', onClick: () => onOpenRecurring() },
        {
          key: 'qa-rb',
          label: '+ Repair bill',
          onClick: () => onRequestMaintenanceNav('bill'),
        },
        {
          key: 'qa-re',
          label: '+ Repair expense',
          onClick: () => onRequestMaintenanceNav('expense'),
        },
        { key: 'qa-vb', label: '+ Vendor bill', onClick: () => onSetHomeOverlay('vendor-bill') },
      ].sort((a, b) => a.label.localeCompare(b.label)),
    [onOpenFuel, onOpenSpecialized, onRequestMaintenanceNav, onOpenRecurring, onSetHomeOverlay],
  )

  return (
    <div className="acct-hub">
      <div className="acct-hub__kpis" aria-label="Key metrics">
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Open bills</span>
          <span className="acct-hub__kpi-val">{kpis?.openBillsCount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.openBillsSub ?? 'No open bill data yet'}</span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Expenses this month</span>
          <span className="acct-hub__kpi-val">{kpis?.expensesMonthAmount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">
            {kpis?.expensesMonthSub ?? 'No expense transactions this month'}
          </span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">QBO vendors</span>
          <span className="acct-hub__kpi-val">{kpis?.qboVendors ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.qboVendorsSub ?? 'QuickBooks cache not loaded'}</span>
        </div>
        <div
          className={
            'acct-hub__kpi' + (kpis?.pendingQboPostsWarn ? ' acct-hub__kpi--warn' : '')
          }
        >
          <span className="acct-hub__kpi-lbl">Pending QBO posts</span>
          <span className="acct-hub__kpi-val">{kpis?.pendingQboPosts ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">
            {kpis?.pendingQboPostsSub ?? 'No pending sync alerts'}
          </span>
        </div>
      </div>

      <div className="acct-hub__quick" aria-label="Quick actions">
        {quickActions.map((a) => (
          <button key={a.key} type="button" className="acct-hub__quick-btn" onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="acct-hub__grid">
        {sections.map((s) => (
          <SectionBlock
            key={s.id}
            id={s.id}
            title={s.title}
            newLabel={`+ New ${s.title.toLowerCase()}`}
            onCreate={() => {
              const first = s.rows[0]
              if (first) first.onActivate()
            }}
            rows={s.rows}
            expanded={expanded[s.id]}
            onToggle={toggle}
          />
        ))}
      </div>

      <p className="acct-hub__foot muted">
        Records are not shown on this home page — click any item above to open that section and view
        records.
      </p>
    </div>
  )
}
