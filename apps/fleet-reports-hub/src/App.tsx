import { useCallback, useEffect, useMemo, useState } from 'react'
import { REPORTS, TABS } from './data/reports'
import type { ReportCategory, ReportDef, ReportFilters } from './types'
import { defaultFilters } from './types'
import { appliedChips } from './components/FilterPanel'
import { FilterSidebar } from './components/reports/FilterSidebar'
import { PartsCatalogPanel } from './components/reports/PartsCatalogPanel'
import { useServiceCatalogRows } from './hooks/useServiceCatalogRows'
import { ReportCard } from './components/ReportCard'
import { ReportViewer } from './components/ReportViewer'
import {
  MaintenanceWorkspace,
  type MaintView,
} from './components/MaintenanceWorkspace'
import {
  AccountingDashboard,
  type AccountingListsBootstrap,
} from './components/accounting/AccountingDashboard'
import type { AccountingMaintNavTarget } from './components/accounting/accountingNav'
import { FuelTransactionForm } from './components/fuel/FuelTransactionForm'
import {
  FUEL_TRANSACTION_TYPE_LABELS,
  fuelTransactionTypesAlphabetical,
  type FuelTransactionType,
} from './types/fuelTransaction'
import { WorkOrderForm } from './components/maintenance/WorkOrderForm'
import type { WorkOrderShellKind } from './components/workorder/WorkOrderShell'
import { useRecentReports } from './hooks/usePersisted'
import { IntegrationConnectionsProvider } from './context/IntegrationConnectionsContext'
import { IntegrationOfflineBanner } from './components/IntegrationOfflineBanner'
import { IntegrationConnectionStrip } from './components/IntegrationConnectionStrip'
import { ModalFullscreenToggle } from './components/ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from './hooks/useFullScreen'

function matchesSearch(r: ReportDef, q: string) {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  return (
    r.title.toLowerCase().includes(s) ||
    r.description.toLowerCase().includes(s) ||
    r.id.toLowerCase().includes(s) ||
    r.tags.some((t) => t.toLowerCase().includes(s))
  )
}

function readInitialReportTab(): ReportCategory {
  if (typeof window === 'undefined') return 'overview'
  const p = new URLSearchParams(window.location.search)
  if (p.get('erpWoModal') === '1' || p.get('erpWoEmbed') === '1') return 'maintenance'
  return 'overview'
}

export default function App() {
  const [tab, setTab] = useState<ReportCategory>(readInitialReportTab)
  const [search, setSearch] = useState('')
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(
    defaultFilters,
  )
  const [active, setActive] = useState<ReportDef | null>(null)
  const [maintExtNav, setMaintExtNav] = useState<{
    view: MaintView
    token: number
  } | null>(null)
  const [appWoPickOpen, setAppWoPickOpen] = useState(false)
  const [appWoModalOpen, setAppWoModalOpen] = useState(false)
  const [appWoKind, setAppWoKind] = useState<WorkOrderShellKind>('IWO')
  const [appWoModalKey, setAppWoModalKey] = useState(0)
  const { isFullScreen: woPickFullScreen, toggle: toggleWoPickFullScreen } = useFullScreen()
  const [fuelPlannerTxn, setFuelPlannerTxn] = useState<FuelTransactionType | null>(null)
  const [acctListsBootstrap, setAcctListsBootstrap] = useState<AccountingListsBootstrap | null>(null)

  useEffect(() => {
    if (!appWoPickOpen && woPickFullScreen) toggleWoPickFullScreen()
  }, [appWoPickOpen, woPickFullScreen, toggleWoPickFullScreen])

  const openAppWorkOrder = (kind: WorkOrderShellKind) => {
    setAppWoKind(kind)
    setAppWoPickOpen(false)
    setAppWoModalKey((k) => k + 1)
    setAppWoModalOpen(true)
  }

  const navigateMaintenanceFromAccounting = useCallback(
    (target: AccountingMaintNavTarget) => {
      const viewMap: Record<AccountingMaintNavTarget, MaintView> = {
        expense: 'expense',
        bill: 'bill',
        'repair-wo': 'repair-wo',
      }
      setTab('maintenance')
      setMaintExtNav((prev) => ({
        view: viewMap[target],
        token: (prev?.token ?? 0) + 1,
      }))
    },
    [],
  )

  const clearMaintExtNav = useCallback(() => setMaintExtNav(null), [])

  useEffect(() => {
    if (tab !== 'maintenance') setMaintExtNav(null)
  }, [tab])

  /**
   * ERP maintenance full-window modal loads hub via iframe with ?erpWoModal=1.
   * Record-tab embed uses ?erpWoEmbed=1 (tab is set synchronously via readInitialReportTab).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('erpWoModal') !== '1') return
    setTab('maintenance')
    setAppWoPickOpen(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('erpWoModal')
      const qs = url.searchParams.toString()
      window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
    } catch {
      /* ignore */
    }
  }, [])

  const recent = useRecentReports('fleet-reports:recent')
  const { rows: serviceCatalogRows } = useServiceCatalogRows('all')
  const catalogServiceNames = useMemo(
    () => serviceCatalogRows.map((s) => s.service_name),
    [serviceCatalogRows],
  )

  /** Report cards on the right: Overview = all reports; other tabs = that category only. */
  const catalogReportsForGrid = useMemo(() => {
    const list =
      tab === 'overview' ? REPORTS : REPORTS.filter((r) => r.category === tab)
    return list.filter((r) => matchesSearch(r, search))
  }, [tab, search])

  /** Domain section headings + cards (Overview = one block per category). */
  const reportCardGroups = useMemo(() => {
    const list = catalogReportsForGrid
    if (tab !== 'overview') {
      const meta = TABS.find((t) => t.id === tab)
      return [{ key: String(tab), section: meta?.label ?? tab, reports: list }]
    }
    const catOrder = TABS.filter((t) => t.id !== 'overview').map((t) => t.id)
    const byCat = new Map<ReportCategory, typeof list>()
    for (const r of list) {
      const arr = byCat.get(r.category) ?? []
      arr.push(r)
      byCat.set(r.category, arr)
    }
    return catOrder
      .filter((id) => (byCat.get(id)?.length ?? 0) > 0)
      .map((id) => ({
        key: id,
        section: TABS.find((t) => t.id === id)?.label ?? id,
        reports: byCat.get(id)!,
      }))
  }, [tab, catalogReportsForGrid])

  /** Maintenance workspace nav cards — always maintenance category. */
  const maintenanceListReports = useMemo(() => {
    return REPORTS.filter((r) => r.category === 'maintenance').filter((r) =>
      matchesSearch(r, search),
    )
  }, [search])

  const openReport = (r: ReportDef) => {
    recent.recordOpen(r.id)
    setActive(r)
  }

  return (
    <IntegrationConnectionsProvider>
    <div className="app app--fleet-reports">
      <div className="layout fleet-reports-layout">
      <div className={`reports-page reports-page--redesign reports-page--tab-${tab}`}>
        <header className="reports-page__header">
          <h1 className="reports-page__title">Fleet reports</h1>
          <p className="reports-page__subtitle">
            Cards by domain, live search, shared filters, exports.
          </p>
          <nav
            className="tabs reports-tabs"
            role="tablist"
            aria-label="Report categories"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                className={t.id === tab ? 'reports-tab reports-tab--active' : 'reports-tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        <IntegrationOfflineBanner />

        <div
          className={
            'reports-page__body-split' +
            (tab === 'accounting' ? ' reports-page__body-split--no-sidebar' : '')
          }
        >
          {tab !== 'accounting' ? (
            <FilterSidebar
              draft={draftFilters}
              applied={appliedFilters}
              onChange={setDraftFilters}
              onApply={() => setAppliedFilters({ ...draftFilters })}
              onReset={() => {
                const z = defaultFilters()
                setDraftFilters(z)
                setAppliedFilters(z)
              }}
              catalogServiceNames={catalogServiceNames}
            />
          ) : null}

          <main
            className={
              'reports-page__main main tab-panel' +
              (tab === 'accounting' ? ' reports-page__main--accounting' : '')
            }
          >
          {tab !== 'accounting' && tab !== 'maintenance' && (
            <>
              <div className="fr-reports-toolbar">
                <label className="search fr-reports-search">
                  <span className="sr-only">Search reports</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search reports (title, tags, id)…"
                  />
                </label>
              </div>
            </>
          )}

          {tab === 'maintenance' ? (
            <>
              <div className="chips-inline maint-applied-filters" aria-label="Applied filters summary">
                {appliedChips(appliedFilters).map((c) => (
                  <span key={c} className="chip sm">
                    {c}
                  </span>
                ))}
              </div>
              <MaintenanceWorkspace
                tabReports={maintenanceListReports}
                onOpenReport={openReport}
                externalNavRequest={maintExtNav}
                onExternalNavConsumed={clearMaintExtNav}
                onOpenAppWorkOrder={() => setAppWoPickOpen(true)}
              />
            </>
          ) : tab === 'accounting' ? (
            <AccountingDashboard
              onRequestMaintenanceNav={navigateMaintenanceFromAccounting}
              onNewWorkOrder={() => setAppWoPickOpen(true)}
              listsBootstrap={acctListsBootstrap}
              onListsBootstrapConsumed={() => setAcctListsBootstrap(null)}
            />
          ) : (
            <>
              {tab === 'fuel' ? (
                <div className="fr-fuel-entry-strip" role="region" aria-label="Fuel bills and expenses">
                  <p className="fr-fuel-entry-strip__lead muted">
                    Opens the same fuel / DEF entry dialog as Accounting. Choose a transaction type below.
                  </p>
                  <div className="fr-fuel-entry-strip__btns">
                    {fuelTransactionTypesAlphabetical().map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="btn sm primary"
                        onClick={() => setFuelPlannerTxn(t)}
                      >
                        {FUEL_TRANSACTION_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {catalogReportsForGrid.length === 0 ? (
                <p className="empty">No reports match this search.</p>
              ) : (
                reportCardGroups.map((g) => (
                  <div key={g.key} className="fr-reports-domain">
                    <div className="fr-reports-kicker" role="heading" aria-level={2}>
                      {g.section}
                    </div>
                    <section className="report-cards-grid fr-report-cards-grid" aria-live="polite">
                      {g.reports.map((r) => (
                        <ReportCard key={r.id} report={r} onOpen={() => openReport(r)} />
                      ))}
                    </section>
                  </div>
                ))
              )}
              <PartsCatalogPanel />
            </>
          )}
          </main>
        </div>
      </div>
      </div>

      <div className="toast-host" id="toast-host" aria-live="polite" />

      <IntegrationConnectionStrip />

      {active && (
        <ReportViewer
          report={active}
          filters={appliedFilters}
          onClose={() => setActive(null)}
          onApplyFilters={(patch) => {
            setDraftFilters((f) => ({ ...f, ...patch }))
            setAppliedFilters((f) => ({ ...f, ...patch }))
          }}
        />
      )}

      {appWoPickOpen ? (
        <div
          className={
            'maint-modal-backdrop' +
            (woPickFullScreen ? ' app-modal-backdrop--fullscreen' : '')
          }
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAppWoPickOpen(false)
          }}
        >
          <div
            className={
              'maint-modal' + (woPickFullScreen ? ' app-modal-panel--fullscreen' : '')
            }
            style={
              woPickFullScreen
                ? MODAL_FULLSCREEN_STYLE
                : { maxWidth: 420, width: 'min(420px, 100%)' }
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="wo-kind-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header
              className="modal-generic-head"
              style={{ marginBottom: 12, paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}
            >
              <p id="wo-kind-title" className="acct-kicker" style={{ margin: 0 }}>
                New work order
              </p>
              <div className="modal-generic-head__actions">
                <ModalFullscreenToggle
                  isFullScreen={woPickFullScreen}
                  onToggle={toggleWoPickFullScreen}
                />
                <button
                  type="button"
                  className="modal-fs-toggle"
                  onClick={() => setAppWoPickOpen(false)}
                  aria-label="Close"
                  title="Close"
                >
                  <span className="modal-fs-toggle__icon" aria-hidden>
                    ×
                  </span>
                </button>
              </div>
            </header>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Pick WO prefix (sets IWO / EWO / RSWO number and default service location).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn" onClick={() => openAppWorkOrder('EWO')}>
                External shop — EWO
              </button>
              <button type="button" className="btn primary" onClick={() => openAppWorkOrder('IWO')}>
                Internal — IWO
              </button>
              <button type="button" className="btn" onClick={() => openAppWorkOrder('RSWO')}>
                Roadside — RSWO
              </button>
              <button type="button" className="btn ghost" onClick={() => setAppWoPickOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <FuelTransactionForm
        open={fuelPlannerTxn !== null}
        transactionType={fuelPlannerTxn ?? 'fuel-bill'}
        onClose={() => setFuelPlannerTxn(null)}
        onOpenVendorDirectory={() => {
          setFuelPlannerTxn(null)
          setTab('accounting')
          setAcctListsBootstrap({
            token: Date.now(),
            tab: 'name-management',
            list: 'name-registry',
          })
        }}
      />

      {appWoModalOpen ? (
        <div
          className="maint-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAppWoModalOpen(false)
          }}
        >
          <div
            className="maint-modal maint-modal--drawerish maint-modal--wo-shell"
            role="dialog"
            aria-modal="true"
            aria-label="Create work order"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <WorkOrderForm
              key={appWoModalKey}
              variant="modal"
              initialUnitId="101"
              initialShellKind={appWoKind}
              onClose={() => {
                setAppWoModalOpen(false)
                setAppWoKind('IWO')
              }}
              onIntegrityBatch={() => {
                /* mergeAlertsIntoStore runs inside save */
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
    </IntegrationConnectionsProvider>
  )
}
