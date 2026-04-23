import { useCallback, useEffect, useRef, useState } from 'react'
import { BillPaymentPage } from '../BillPaymentPage'
import { RecurringBillsModal } from '../RecurringBillsModal'
import {
  AccountingSpecializedModals,
  type SpecializedModalId,
} from './AccountingSpecializedModals'
import {
  type ListsCatalogsTab,
  type ListsCatalogListId,
} from './ListsCatalogsWorkspace'
import { FuelTransactionForm } from '../fuel/FuelTransactionForm'
import {
  FUEL_TRANSACTION_TYPE_LABELS,
  fuelTransactionTypesAlphabetical,
  type FuelTransactionType,
} from '../../types/fuelTransaction'
import { AccountingHomeHub, type AccountingHomeOverlay } from './AccountingHomeHub'
import type { AccountingMaintNavTarget } from './accountingNav'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'

export type { AccountingMaintNavTarget } from './accountingNav'

type Props = {
  onRequestMaintenanceNav: (target: AccountingMaintNavTarget) => void
  /** Fuel / integrity “View all” → Maintenance → Integrity in the hub. */
  onOpenMaintenanceIntegrity?: () => void
  /** Top nav "+ New" → work order / service record (app-level modal). */
  onNewWorkOrder?: () => void
  /** ERP iframe embed/modal — notify parent window when fuel form closes. */
  erpFuelHost?: boolean
  /** When ERP embed: open fuel dialog at app level (single FuelTransactionForm). */
  onFuelOpenFromAccounting?: (t: FuelTransactionType) => void
  /** + New → Form 425C — Monthly report (hub report viewer iframe). */
  onOpenForm425c?: () => void
  /** Open global Lists section in App shell (preferred). */
  onOpenListsSection: (tab: ListsCatalogsTab, listId?: ListsCatalogListId | null) => void
  onOpenTrackingSection?: () => void
  onOpenUploadCenter?: () => void
  onOpenSettingsUsers?: () => void
  homeKpis?: {
    accountingTitle: string
    environmentSub: string
    openBillsCount: string
    openBillsSub: string
    expensesMonthAmount: string
    expensesMonthSub: string
    qboVendors: string
    qboVendorsSub: string
    pendingQboPosts: string
    pendingQboPostsSub: string
    pendingQboPostsWarn: boolean
    qboConnectionSub: string
    samsaraVehiclesSub: string
    lastKpiRefreshSub: string
  }
}

export function AccountingDashboard({
  onRequestMaintenanceNav,
  onOpenMaintenanceIntegrity,
  onNewWorkOrder,
  erpFuelHost = false,
  onFuelOpenFromAccounting,
  onOpenForm425c,
  onOpenListsSection,
  onOpenTrackingSection,
  onOpenUploadCenter,
  onOpenSettingsUsers,
  homeKpis,
}: Props) {
  const [recurringOpen, setRecurringOpen] = useState(false)
  const [specializedOpen, setSpecializedOpen] = useState<SpecializedModalId | null>(
    null,
  )
  const [fuelOpen, setFuelOpen] = useState<FuelTransactionType | null>(null)
  const [acctNewOpen, setAcctNewOpen] = useState(false)
  const acctNewRef = useRef<HTMLDivElement>(null)
  const [homeOverlay, setHomeOverlay] = useState<AccountingHomeOverlay>(null)
  const [qboActionMsg, setQboActionMsg] = useState<string | null>(null)
  const [qboActionErr, setQboActionErr] = useState(false)
  const [qboActionBusy, setQboActionBusy] = useState(false)
  const {
    isFullScreen: homeOverlayFullScreen,
    toggle: toggleHomeOverlayFullScreen,
    reset: resetHomeOverlayFullScreen,
  } = useFullScreen()

  useEffect(() => {
    resetHomeOverlayFullScreen()
  }, [homeOverlay, resetHomeOverlayFullScreen])

  useEffect(() => {
    if (!acctNewOpen) return
    const close = (e: MouseEvent) => {
      if (!acctNewRef.current?.contains(e.target as Node)) setAcctNewOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [acctNewOpen])

  const openLists = useCallback((tab: ListsCatalogsTab, listId?: ListsCatalogListId | null) => {
    onOpenListsSection(tab, listId)
  }, [onOpenListsSection])

  const openFuel = useCallback(
    (ft: FuelTransactionType) => {
      if (erpFuelHost && onFuelOpenFromAccounting) onFuelOpenFromAccounting(ft)
      else setFuelOpen(ft)
    },
    [erpFuelHost, onFuelOpenFromAccounting],
  )

  const runQboStatusCheck = useCallback(async () => {
    setQboActionBusy(true)
    setQboActionErr(false)
    setQboActionMsg(null)
    try {
      const res = await fetch('/api/qbo/status', { headers: { Accept: 'application/json' } })
      const j = (await res.json().catch(() => null)) as
        | { connected?: boolean; configured?: boolean; lastRefreshError?: string }
        | null
      if (!res.ok || !j) {
        setQboActionErr(true)
        setQboActionMsg(`QBO status check failed (${res.status}).`)
        return
      }
      if (j.configured && j.connected) {
        if (typeof j.lastRefreshError === 'string' && j.lastRefreshError.trim()) {
          setQboActionErr(true)
          setQboActionMsg(`QBO connected with warning: ${j.lastRefreshError}`)
          return
        }
        setQboActionMsg('QuickBooks connected and healthy.')
        return
      }
      if (j.configured && !j.connected) {
        setQboActionErr(true)
        setQboActionMsg('QuickBooks configured but disconnected.')
        return
      }
      setQboActionErr(true)
      setQboActionMsg('QuickBooks is not configured.')
    } catch (e) {
      setQboActionErr(true)
      setQboActionMsg(`QBO status check failed: ${String((e as Error).message || e)}`)
    } finally {
      setQboActionBusy(false)
    }
  }, [])

  const runQboItemsRefresh = useCallback(async () => {
    setQboActionBusy(true)
    setQboActionErr(false)
    setQboActionMsg(null)
    try {
      const res = await fetch('/api/accounting/qbo-items', { headers: { Accept: 'application/json' } })
      const j = (await res.json().catch(() => null)) as { items?: unknown[] } | null
      if (!res.ok || !j || !Array.isArray(j.items)) {
        setQboActionErr(true)
        setQboActionMsg(`Unable to refresh QBO list (${res.status}).`)
      } else {
        setQboActionMsg(`QBO items refreshed: ${j.items.length} rows.`)
        openLists('qbo-items', 'qbo-items-list')
      }
    } catch (e) {
      setQboActionErr(true)
      setQboActionMsg(`Unable to refresh QBO list: ${String((e as Error).message || e)}`)
    } finally {
      setQboActionBusy(false)
    }
  }, [openLists])

  const fuelForm = !erpFuelHost ? (
    <FuelTransactionForm
      open={fuelOpen !== null}
      transactionType={fuelOpen ?? 'fuel-bill'}
      onClose={() => setFuelOpen(null)}
      onOpenVendorDirectory={() => {
        setFuelOpen(null)
        openLists('name-management', 'name-registry')
      }}
      onViewAllIntegrity={() => {
        setFuelOpen(null)
        onOpenMaintenanceIntegrity?.()
      }}
    />
  ) : null

  const overlayTitle =
    homeOverlay === 'payment-history'
      ? 'Payment history'
      : homeOverlay === 'vendor-bill'
        ? 'Vendor bill'
        : homeOverlay === 'bill-payment'
          ? 'Bill payment'
          : null

  return (
    <div className="acct-dash">
      <header className="acct-dash__page-head">
        <div className="acct-dash__page-head-text">
          <h1 className="acct-dash__page-title">
            {homeKpis?.accountingTitle ?? 'Accounting — IH 35 Transportation LLC'}
          </h1>
          <p className="acct-dash__page-sub muted">
            {(homeKpis?.qboConnectionSub ?? 'QuickBooks status unknown') +
              ' · ' +
              (homeKpis?.samsaraVehiclesSub ?? 'Samsara vehicles: —')}
          </p>
          <p className="acct-dash__page-meta muted">
            {(homeKpis?.environmentSub ?? 'Environment unknown') +
              ' · ' +
              (homeKpis?.lastKpiRefreshSub ?? 'Data refresh: —')}
          </p>
        </div>
        <div className="acct-dash__page-head-actions">
          <div className="acct-new-wrap" ref={acctNewRef}>
            <button
              type="button"
              className="btn primary acct-dash__head-btn"
              aria-expanded={acctNewOpen}
              aria-haspopup="menu"
              onClick={() => setAcctNewOpen((o) => !o)}
            >
              + New
            </button>
          {acctNewOpen && (
            <ul className="acct-new-dd" role="menu">
              {(
                [
                  {
                    label: 'Assets (Samsara mirror)',
                    onClick: () => openLists('assets-database'),
                  },
                  {
                    label: 'Bill payment',
                    onClick: () => setHomeOverlay('bill-payment'),
                  },
                  {
                    label: 'Driver bill',
                    onClick: () => setSpecializedOpen('driver-settlement'),
                  },
                  {
                    label: 'Drivers database',
                    onClick: () => openLists('drivers-database'),
                  },
                  {
                    label: 'Expense',
                    onClick: () => onRequestMaintenanceNav('expense'),
                  },
                  ...(onOpenForm425c
                    ? [
                        {
                          label: 'Form 425C — Monthly report',
                          onClick: () => onOpenForm425c(),
                        },
                      ]
                    : []),
                  ...fuelTransactionTypesAlphabetical().map((ft) => ({
                    label: FUEL_TRANSACTION_TYPE_LABELS[ft],
                    onClick: () => openFuel(ft),
                  })),
                  {
                    label: 'Lists & catalogs — dedup',
                    onClick: () => openLists('name-management', 'find-merge'),
                  },
                  {
                    label: 'Maintenance bill',
                    onClick: () => onRequestMaintenanceNav('bill'),
                  },
                  {
                    label: 'Maintenance expense',
                    onClick: () => onRequestMaintenanceNav('expense'),
                  },
                  {
                    label: 'Multiple bills',
                    onClick: () => setRecurringOpen(true),
                  },
                  {
                    label: 'Name management',
                    onClick: () => openLists('name-management', 'name-registry'),
                  },
                  {
                    label: 'Parts reference',
                    onClick: () => openLists('service-types', 'parts-ref'),
                  },
                  {
                    label: 'Repair bill',
                    onClick: () => onRequestMaintenanceNav('bill'),
                  },
                  {
                    label: 'Repair expense',
                    onClick: () => onRequestMaintenanceNav('expense'),
                  },
                  {
                    label: 'Vendor bill',
                    onClick: () => setHomeOverlay('vendor-bill'),
                  },
                  {
                    label: 'Vendors & driver payees',
                    onClick: () => openLists('vendors-drivers', 'vendors-payees'),
                  },
                  {
                    label: 'Vendors database',
                    onClick: () => openLists('vendors-database'),
                  },
                  ...(onNewWorkOrder
                    ? [
                        {
                          label: 'Work order / service record',
                          onClick: () => onNewWorkOrder(),
                        },
                      ]
                    : []),
                ] as { label: string; onClick: () => void }[]
              )
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((item) => (
                  <li key={item.label}>
                    <button
                      type="button"
                      role="menuitem"
                      className="acct-new-dd__item"
                      onClick={() => {
                        setAcctNewOpen(false)
                        item.onClick()
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          </div>
          <button
            type="button"
            className="btn sm ghost acct-dash__head-btn"
            onClick={() => void runQboStatusCheck()}
            disabled={qboActionBusy}
          >
            Test QuickBooks
          </button>
          <button
            type="button"
            className="btn sm ghost acct-dash__head-btn"
            onClick={() => void runQboItemsRefresh()}
            disabled={qboActionBusy}
          >
            {qboActionBusy ? 'Working…' : 'Refresh QBO lists'}
          </button>
        </div>
      </header>
      {qboActionMsg ? (
        <p
          className={`nm-banner ${qboActionErr ? 'nm-banner--err' : 'nm-banner--ok'}`}
          role="status"
        >
          {qboActionMsg}
        </p>
      ) : null}

      <AccountingHomeHub
        onOpenFuel={openFuel}
        onOpenSpecialized={setSpecializedOpen}
        onRequestMaintenanceNav={onRequestMaintenanceNav}
        onOpenRecurring={() => setRecurringOpen(true)}
        onOpenLists={openLists}
        onOpenTracking={() => onOpenTrackingSection?.()}
        onOpenUploadCenter={() =>
          onOpenUploadCenter ? onOpenUploadCenter() : openLists('vendors-drivers', 'bank-csv')
        }
        onOpenSettingsUsers={() =>
          onOpenSettingsUsers ? onOpenSettingsUsers() : openLists('name-management', 'name-registry')
        }
        onSetHomeOverlay={setHomeOverlay}
        kpis={homeKpis}
      />

      {homeOverlay ? (
        <div
          className={'acct-hub-overlay' + (homeOverlayFullScreen ? ' acct-hub-overlay--fullscreen' : '')}
          role="dialog"
          aria-modal="true"
          aria-label={overlayTitle ?? ''}
          style={homeOverlayFullScreen ? { ...MODAL_FULLSCREEN_STYLE, margin: 0 } : undefined}
        >
          <div className="acct-hub-overlay__bar">
            <h2 className="acct-hub-overlay__title">{overlayTitle}</h2>
            <div className="acct-hub-overlay__bar-actions">
              <ModalFullscreenToggle
                isFullScreen={homeOverlayFullScreen}
                onToggle={toggleHomeOverlayFullScreen}
                className="btn sm ghost"
              />
              <button type="button" className="btn sm ghost" onClick={() => setHomeOverlay(null)}>
                ← Back to home
              </button>
            </div>
          </div>
          <div className="acct-hub-overlay__body">
            {homeOverlay === 'payment-history' ? (
              <p className="muted">Payment history opens here — connect ERP payment feed to populate.</p>
            ) : (
              <BillPaymentPage suppressHelpText hidePageTitle />
            )}
          </div>
        </div>
      ) : null}

      <RecurringBillsModal open={recurringOpen} onClose={() => setRecurringOpen(false)} />
      <AccountingSpecializedModals
        open={specializedOpen}
        onClose={() => setSpecializedOpen(null)}
      />
      {fuelForm}
    </div>
  )
}
