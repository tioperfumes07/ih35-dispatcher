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
  onActivate: () => void
}

function SectionBlock({
  id,
  title,
  rows,
  expanded,
  onToggle,
}: {
  id: SectionId
  title: string
  rows: RowDef[]
  expanded: boolean
  onToggle: (id: SectionId) => void
}) {
  return (
    <div className="acct-hub-sec">
      <button
        type="button"
        className="acct-hub-sec__head"
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
      >
        <span>{title}</span>
        <span className="acct-hub-sec__chev" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <ul className="acct-hub-sec__body">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" className="acct-hub-sec__row" onClick={r.onActivate}>
                <span>{r.label}</span>
                <span className="acct-hub-sec__arrow" aria-hidden>
                  →
                </span>
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

  const qboStub = useCallback((label: string) => {
    alert(`${label} — demo shell (no live QuickBooks).`)
  }, [])

  const sections = useMemo(() => {
    const billRows: RowDef[] = [
      {
        key: 'driver-bill',
        label: 'Driver bill',
        onActivate: () => onOpenSpecialized('driver-settlement'),
      },
      { key: 'fuel-bill', label: 'Fuel bill', onActivate: () => onOpenFuel('fuel-bill') },
      {
        key: 'maint-bill',
        label: 'Maintenance bill',
        onActivate: () => onRequestMaintenanceNav('bill'),
      },
      { key: 'multi', label: 'Multiple bills', onActivate: () => onOpenRecurring() },
      {
        key: 'repair-bill',
        label: 'Repair bill',
        onActivate: () => onRequestMaintenanceNav('bill'),
      },
      {
        key: 'vendor-bill',
        label: 'Vendor bill',
        onActivate: () => onSetHomeOverlay('vendor-bill'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const expRows: RowDef[] = [
      {
        key: 'exp',
        label: 'Expense',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
      { key: 'fuel-exp', label: 'Fuel expense', onActivate: () => onOpenFuel('fuel-expense') },
      {
        key: 'maint-exp',
        label: 'Maintenance expense',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
      {
        key: 'repair-exp',
        label: 'Repair expense',
        onActivate: () => onRequestMaintenanceNav('expense'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const payRows: RowDef[] = [
      {
        key: 'bp',
        label: 'Bill payment',
        onActivate: () => onSetHomeOverlay('bill-payment'),
      },
      {
        key: 'dbp',
        label: 'Driver bill payment',
        onActivate: () => onOpenSpecialized('driver-settlement'),
      },
      {
        key: 'ph',
        label: 'Payment history',
        onActivate: () => onSetHomeOverlay('payment-history'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const qboRows: RowDef[] = [
      {
        key: 'conn',
        label: 'Connect QuickBooks',
        onActivate: () => qboStub('Connect QuickBooks'),
      },
      {
        key: 'items',
        label: 'Items & accounts',
        onActivate: () => onOpenLists('qbo-items', 'qbo-items-list'),
      },
      {
        key: 'sync',
        label: 'Sync status',
        onActivate: () => qboStub('Sync status'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const upRows: RowDef[] = [
      {
        key: 'bank',
        label: 'Bank CSV matching',
        onActivate: () => onOpenLists('vendors-drivers', 'bank-csv'),
      },
      {
        key: 'sam-cloud',
        label: 'Samsara Cloud',
        onActivate: () => alert('Samsara Cloud — connect flows are configured in Telematics.'),
      },
      {
        key: 'upload',
        label: 'Upload center',
        onActivate: () => alert('Upload center — demo shell.'),
      },
    ].sort((a, b) => a.label.localeCompare(b.label))

    const specRows: RowDef[] = [
      {
        key: 'settings',
        label: 'Settings & users',
        onActivate: () => alert('Settings & users — demo shell.'),
      },
      {
        key: 'tms',
        label: 'TMS loads',
        onActivate: () => onOpenSpecialized('load-tms'),
      },
      {
        key: 'tools',
        label: 'Tools & data',
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
    onSetHomeOverlay,
    qboStub,
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
