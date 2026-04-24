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

type CategoryId =
  | 'expenses'
  | 'bills'
  | 'bill-payment'
  | 'specialized'
  | 'quickbooks'
  | 'tools-data'

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
  onOpenTracking,
  onOpenUploadCenter,
  onOpenSettingsUsers,
  onSetHomeOverlay,
  kpis,
}: Props) {
  // On first load, show KPI home + category tabs only (no default item list).
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
          { key: 'driver-bill', label: 'Driver bill', onActivate: () => onOpenSpecialized('driver-settlement') },
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
          { key: 'driver-settlement', label: 'Driver settlement', onActivate: () => onOpenSpecialized('driver-settlement') },
          { key: 'load-tms', label: 'TMS loads', onActivate: () => onOpenSpecialized('load-tms') },
        ],
      },
      {
        id: 'quickbooks',
        label: 'QuickBooks',
        rows: [
          { key: 'qbo-items', label: 'Items & accounts', onActivate: () => onOpenLists('qbo-items', 'qbo-items-list') },
          { key: 'qbo-sync-status', label: 'Sync status', onActivate: () => onOpenLists('qbo-items', 'qbo-items-list') },
        ],
      },
      {
        id: 'tools-data',
        label: 'Tools & Data',
        rows: [
          { key: 'bank-csv', label: 'Bank CSV matching', onActivate: () => onOpenLists('vendors-drivers', 'bank-csv') },
          { key: 'upload-center', label: 'Upload center', onActivate: onOpenUploadCenter },
          { key: 'settings-users', label: 'Settings & users', onActivate: onOpenSettingsUsers },
          { key: 'tracking', label: 'Samsara cloud', onActivate: onOpenTracking },
        ],
      },
    ]
  }, [
    onOpenFuel,
    onOpenLists,
    onOpenRecurring,
    onOpenSettingsUsers,
    onOpenSpecialized,
    onOpenTracking,
    onOpenUploadCenter,
    onRequestMaintenanceNav,
    onSetHomeOverlay,
  ])

  const activeCategoryDef = categories.find((c) => c.id === activeCategory) ?? null

  return (
    <div className="acct-hub">
      <div className="acct-hub__kpis" aria-label="Accounting KPIs">
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Open bills</span>
          <span className="acct-hub__kpi-val">{kpis?.openBillsCount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.openBillsSub ?? 'No open bill data yet'}</span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">Expenses this month</span>
          <span className="acct-hub__kpi-val">{kpis?.expensesMonthAmount ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.expensesMonthSub ?? 'No expense transactions this month'}</span>
        </div>
        <div className="acct-hub__kpi">
          <span className="acct-hub__kpi-lbl">QBO vendors</span>
          <span className="acct-hub__kpi-val">{kpis?.qboVendors ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.qboVendorsSub ?? 'QuickBooks cache not loaded'}</span>
        </div>
        <div className={'acct-hub__kpi' + (kpis?.pendingQboPostsWarn ? ' acct-hub__kpi--warn' : '')}>
          <span className="acct-hub__kpi-lbl">Pending QBO posts</span>
          <span className="acct-hub__kpi-val">{kpis?.pendingQboPosts ?? '—'}</span>
          <span className="acct-hub__kpi-sub muted">{kpis?.pendingQboPostsSub ?? 'No pending sync alerts'}</span>
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
            {c.label}
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
