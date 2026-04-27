import { useEffect, useMemo, useState } from 'react'
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

type QboQueueItem = {
  id: number
  transaction_type?: string | null
  transaction_id?: number | null
  payload?: Record<string, unknown> | null
  status?: string | null
  error_message?: string | null
  created_at?: string | null
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
  const [queueItems, setQueueItems] = useState<QboQueueItem[]>([])
  const [queuePending, setQueuePending] = useState(0)
  const [queueFailed, setQueueFailed] = useState(0)
  const [queueBusy, setQueueBusy] = useState(false)
  const [queueMsg, setQueueMsg] = useState<string | null>(null)

  const loadQueue = async () => {
    setQueueBusy(true)
    try {
      const data = await fetch('/api/qbo/sync-queue', { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .catch(() => ({ ok: false, items: [], pending: 0, failed: 0 }))
      const items = Array.isArray(data?.items) ? (data.items as QboQueueItem[]) : []
      setQueueItems(items)
      setQueuePending(Number(data?.pending || 0))
      setQueueFailed(Number(data?.failed || 0))
    } finally {
      setQueueBusy(false)
    }
  }

  const retryQueue = async () => {
    setQueueBusy(true)
    setQueueMsg(null)
    try {
      const data = await fetch('/api/qbo/sync-queue/retry', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      }).then((r) => r.json())
      if (data?.ok) {
        setQueueMsg(`✅ ${Number(data?.synced || 0)} transactions synced to QuickBooks`)
      } else {
        setQueueMsg(String(data?.error || 'Sync retry failed'))
      }
    } catch (e) {
      setQueueMsg(String((e as Error).message || e))
    } finally {
      await loadQueue()
      setQueueBusy(false)
    }
  }

  useEffect(() => {
    void loadQueue()
    const id = window.setInterval(() => void loadQueue(), 60000)
    return () => window.clearInterval(id)
  }, [])

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

      <div style={{ marginBottom: 12, border: '1px solid rgba(148,163,184,0.22)', borderRadius: 10, padding: 10, background: queuePending > 0 ? 'rgba(250,204,21,0.08)' : 'rgba(34,197,94,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <strong>
            {queuePending > 0
              ? `⚠️ ${queuePending} transactions pending QuickBooks sync`
              : '✅ No pending QuickBooks sync transactions'}
          </strong>
          <button type="button" className="btn sm ghost" onClick={() => void retryQueue()} disabled={queueBusy}>
            {queueBusy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {queueMsg ? <div className="muted tiny" style={{ marginTop: 6 }}>{queueMsg}</div> : null}
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Created</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.length ? queueItems.slice(0, 12).map((item) => {
                const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
                const descUnit = String((payload as any)?.payload?.unit_number || '').trim()
                const descAmt = Number((payload as any)?.payload?.total_amount || 0)
                const desc = descUnit ? `${descUnit}${descAmt > 0 ? ` · $${descAmt.toFixed(2)}` : ''}` : `Transaction #${item.transaction_id || item.id}`
                return (
                  <tr key={item.id} style={{ borderTop: '1px solid rgba(148,163,184,0.18)' }}>
                    <td style={{ padding: '6px 8px' }}>{item.transaction_type || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{desc}</td>
                    <td style={{ padding: '6px 8px' }}>{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{item.status || 'pending'}</td>
                    <td style={{ padding: '6px 8px', color: '#fca5a5' }}>{item.error_message || '—'}</td>
                  </tr>
                )
              }) : (
                <tr>
                  <td style={{ padding: '8px' }} colSpan={5}>No pending queue items</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="muted tiny" style={{ marginTop: 6 }}>
          Pending: {queuePending} · Failed: {queueFailed}
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
