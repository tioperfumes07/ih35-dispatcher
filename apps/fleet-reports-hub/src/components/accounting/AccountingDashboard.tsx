import { useCallback, useEffect, useRef, useState } from 'react'
import { BillPaymentPage } from '../BillPaymentPage'
import { RecurringBillsModal } from '../RecurringBillsModal'
import {
  AccountingSpecializedModals,
  type SpecializedModalId,
} from './AccountingSpecializedModals'
import {
  ListsCatalogsWorkspace,
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

export type AccountingListsBootstrap = {
  token: number
  tab: ListsCatalogsTab
  list: ListsCatalogListId
}

type Props = {
  onRequestMaintenanceNav: (target: AccountingMaintNavTarget) => void
  /** Top nav "+ New" → work order / service record (app-level modal). */
  onNewWorkOrder?: () => void
  /** When set (e.g. from Fuel tab vendor link), open Lists & catalogs on the given list once. */
  listsBootstrap?: AccountingListsBootstrap | null
  onListsBootstrapConsumed?: () => void
}

export function AccountingDashboard({
  onRequestMaintenanceNav,
  onNewWorkOrder,
  listsBootstrap,
  onListsBootstrapConsumed,
}: Props) {
  const [route, setRoute] = useState<'home' | 'lists'>('home')
  const [listsTab, setListsTab] = useState<ListsCatalogsTab>('fleet-samsara')
  const [listsDeepLink, setListsDeepLink] = useState<ListsCatalogListId | null>(null)
  const [recurringOpen, setRecurringOpen] = useState(false)
  const [specializedOpen, setSpecializedOpen] = useState<SpecializedModalId | null>(
    null,
  )
  const [fuelOpen, setFuelOpen] = useState<FuelTransactionType | null>(null)
  const [acctNewOpen, setAcctNewOpen] = useState(false)
  const acctNewRef = useRef<HTMLDivElement>(null)
  const [homeOverlay, setHomeOverlay] = useState<AccountingHomeOverlay>(null)
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
    setListsTab(tab)
    setListsDeepLink(listId === undefined ? null : listId)
    setRoute('lists')
  }, [])

  useEffect(() => {
    if (!listsBootstrap) return
    setListsTab(listsBootstrap.tab)
    setListsDeepLink(listsBootstrap.list)
    setRoute('lists')
    onListsBootstrapConsumed?.()
  }, [listsBootstrap, onListsBootstrapConsumed])

  const fuelForm = (
    <FuelTransactionForm
      open={fuelOpen !== null}
      transactionType={fuelOpen ?? 'fuel-bill'}
      onClose={() => setFuelOpen(null)}
      onOpenVendorDirectory={() => {
        setFuelOpen(null)
        openLists('name-management', 'name-registry')
      }}
    />
  )

  if (route === 'lists') {
    return (
      <div className="acct-dash acct-dash--lists">
        <div className="acct-dash__lists-head">
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              setListsDeepLink(null)
              setRoute('home')
            }}
          >
            ← Back to accounting
          </button>
        </div>
        <ListsCatalogsWorkspace
          activeTab={listsTab}
          onTabChange={setListsTab}
          deepLinkList={listsDeepLink}
          onDeepLinkConsumed={() => setListsDeepLink(null)}
        />
        <RecurringBillsModal open={recurringOpen} onClose={() => setRecurringOpen(false)} />
        <AccountingSpecializedModals
          open={specializedOpen}
          onClose={() => setSpecializedOpen(null)}
        />
        {fuelForm}
      </div>
    )
  }

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
      <div className="acct-dash__toolbar">
        <div className="acct-new-wrap" ref={acctNewRef}>
          <button
            type="button"
            className="btn primary"
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
                    onClick: () => openLists('vendors-drivers', 'assets-db'),
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
                    onClick: () => openLists('vendors-drivers', 'drivers-db'),
                  },
                  {
                    label: 'Expense',
                    onClick: () => onRequestMaintenanceNav('expense'),
                  },
                  ...fuelTransactionTypesAlphabetical().map((ft) => ({
                    label: FUEL_TRANSACTION_TYPE_LABELS[ft],
                    onClick: () => setFuelOpen(ft),
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
                    onClick: () => onRequestMaintenanceNav('repair-wo'),
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
                    onClick: () => openLists('vendors-drivers', 'vendors-db'),
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
      </div>

      <AccountingHomeHub
        onOpenFuel={setFuelOpen}
        onOpenSpecialized={setSpecializedOpen}
        onRequestMaintenanceNav={onRequestMaintenanceNav}
        onOpenRecurring={() => setRecurringOpen(true)}
        onOpenLists={openLists}
        onSetHomeOverlay={setHomeOverlay}
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
