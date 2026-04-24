import { useMemo, useState } from 'react'
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

type CategoryId =
  | 'expenses'
  | 'bills'
  | 'bill-payment'
  | 'specialized'
  | 'quickbooks'

type RowDef = {
  key: string
  label: string
  onActivate: () => void
}

type CategoryDef = {
  id: CategoryId
  label: string
  rows: RowDef[]
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
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)

  const categories = useMemo<CategoryDef[]>(() => {
    return [
      {
        id: 'expenses',
        label: 'Expenses',
        rows: [
          { key: 'expense', label: 'Expense', onActivate: () => onRequestMaintenanceNav('expense') },
          {
            key: 'maintenance-expense',
            label: 'Maintenance expense',
            onActivate: () => onRequestMaintenanceNav('expense'),
          },
          {
            key: 'repair-expense',
            label: 'Repair expense',
            onActivate: () => onRequestMaintenanceNav('expense'),
          },
          { key: 'fuel-expense', label: 'Fuel expense', onActivate: () => onOpenFuel('fuel-expense') },
        ],
      },
      {
        id: 'bills',
        label: 'Bills',
        rows: [
          { key: 'maintenance-bill', label: 'Maintenance bill', onActivate: () => onRequestMaintenanceNav('bill') },
          { key: 'repair-bill', label: 'Repair bill', onActivate: () => onRequestMaintenanceNav('bill') },
          { key: 'fuel-bill', label: 'Fuel bill', onActivate: () => onOpenFuel('fuel-bill') },
          { key: 'vendor-bill', label: 'Vendor bill', onActivate: () => onSetHomeOverlay('vendor-bill') },
          { key: 'multiple-bills', label: 'Multiple bills', onActivate: onOpenRecurring },
        ],
      },
      {
        id: 'bill-payment',
        label: 'Bill Payment',
        rows: [
          { key: 'bill-payment', label: 'Bill payment', onActivate: () => onSetHomeOverlay('bill-payment') },
          { key: 'driver-bill-payment', label: 'Driver bill payment', onActivate: () => onOpenSpecialized('driver-settlement') },
          { key: 'payment-history', label: 'Payment history', onActivate: () => onSetHomeOverlay('payment-history') },
        ],
      },
      {
        id: 'specialized',
        label: 'Specialized',
        rows: [
          { key: 'transfer', label: 'Transfer', onActivate: () => onOpenSpecialized('transfer') },
          { key: 'journal-entry', label: 'Journal entry', onActivate: () => onOpenSpecialized('journal') },
          { key: 'bank-reconciliation', label: 'Bank reconciliation', onActivate: () => onOpenSpecialized('bank-reconciliation') },
        ],
      },
      {
        id: 'quickbooks',
        label: 'QuickBooks',
        rows: [
          { key: 'quickconnect-qbo', label: 'QuickConnect QuickBooks', onActivate: () => onOpenLists('qbo-items', 'qbo-items-list') },
          { key: 'qbo-items', label: 'Items & accounts', onActivate: () => onOpenLists('qbo-items', 'qbo-items-list') },
          { key: 'qbo-sync-status', label: 'Sync status', onActivate: () => onOpenLists('qbo-items', 'qbo-items-list') },
        ],
      },
    ]
  }, [
    onOpenFuel,
    onOpenLists,
    onOpenRecurring,
    onOpenSpecialized,
    onRequestMaintenanceNav,
    onSetHomeOverlay,
  ])

  const activeCategoryDef = categories.find((c) => c.id === activeCategory) ?? null

  return (
    <div className="acct-hub">
      <div className="acct-hub__kpis" aria-label="Accounting KPIs">
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Expenses this month</span>
          <span className="acct-hub__kpi-val">{kpis?.expensesMonthAmount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.expensesMonthSub ?? 'No expense transactions this month'}</span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Bills due</span>
          <span className="acct-hub__kpi-val">{kpis?.openBillsCount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.openBillsSub ?? 'No open bill data yet'}</span>
        </div>
        <div className={'acct-hub__kpi' + (kpis?.pendingQboPostsWarn ? ' acct-hub__kpi--warn' : '')}>
          <span className="acct-hub__kpi-lbl">QBO sync errors</span>
          <span className="acct-hub__kpi-val">{kpis?.pendingQboPosts ?? '0'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.pendingQboPostsSub ?? 'No pending sync alerts'}</span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Unreconciled</span>
          <span className="acct-hub__kpi-val">{kpis?.pendingQboPosts ?? '0'}</span>
          <span className="acct-hub__kpi-sub muted">Awaiting bank reconciliation</span>
        </div>
      </div>

      <nav className="acct-hub__category-tabs" aria-label="Accounting categories">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={activeCategory === c.id ? 'acct-hub__category-tab acct-hub__category-tab--active' : 'acct-hub__category-tab'}
            onClick={() => setActiveCategory(c.id)}
          >
            {c.label} ▾
          </button>
        ))}
      </nav>

      {activeCategoryDef ? (
        <div className="acct-hub__category-panel" aria-label={`${activeCategoryDef.label} items`}>
          <h3 className="acct-hub__category-title">{activeCategoryDef.label}</h3>
          <ul className="acct-hub-sec__body">
            {activeCategoryDef.rows.map((row) => (
              <li key={row.key}>
                <button type="button" className="acct-hub-sec__row" onClick={row.onActivate}>
                  <span>{row.label}</span>
                  <span className="acct-hub-sec__arrow" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="acct-hub__category-empty muted">
          Select a category tab to open that section.
        </p>
      )}
    </div>
  )
}
