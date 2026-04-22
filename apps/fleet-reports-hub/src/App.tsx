import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { REPORTS, TABS } from './data/reports'
import type { ReportCategory, ReportDef, ReportFilters } from './types'
import { defaultFilters } from './types'
import { appliedChips } from './components/FilterPanel'
import { FilterSidebar } from './components/reports/FilterSidebar'
import { PartsCatalogPanel } from './components/reports/PartsCatalogPanel'
import { useServiceCatalogRows } from './hooks/useServiceCatalogRows'
import { ReportCard } from './components/ReportCard'
import { ReportViewer } from './components/ReportViewer'
import { ErrorBoundary } from './components/ErrorBoundary'
import {
  MaintenanceWorkspace,
  type MaintView,
} from './components/MaintenanceWorkspace'
import {
  AccountingDashboard,
} from './components/accounting/AccountingDashboard'
import {
  LISTS_CATALOG_TAB_IDS,
  type ListsCatalogListId,
  type ListsCatalogsTab,
  ListsCatalogsWorkspace,
} from './components/accounting/ListsCatalogsWorkspace'
import type { AccountingMaintNavTarget } from './components/accounting/accountingNav'
import { FuelTransactionForm } from './components/fuel/FuelTransactionForm'
import {
  FUEL_TRANSACTION_TYPE_LABELS,
  fuelTransactionTypesAlphabetical,
  parseFuelTransactionTypeParam,
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
import { TelematicsFleetPage } from './components/telematics/TelematicsFleetPage'

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

const REPORT_TAB_QUERY_VALUES: ReportCategory[] = [
  'overview',
  'maintenance',
  'accounting',
  'compliance',
  'safety',
  'fuel',
  'operations',
  'dot',
  'custom',
]
const REPORT_TAB_SET = new Set<ReportCategory>(REPORT_TAB_QUERY_VALUES)
const REPORTS_PAGE_TAB_IDS: ReportCategory[] = REPORT_TAB_QUERY_VALUES.filter(
  (id) => id !== 'safety' && id !== 'fuel' && id !== 'operations',
)

type AppSection =
  | 'home'
  | 'maintenance'
  | 'accounting'
  | 'lists'
  | 'reports'
  | 'safety'
  | 'tracking'
  | 'fuel'
  | 'loads'

const APP_SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'lists', label: 'Lists' },
  { id: 'reports', label: 'Reports' },
  { id: 'safety', label: 'Safety' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'loads', label: 'Loads' },
]
const APP_SECTION_ID_SET = new Set<AppSection>(APP_SECTIONS.map((s) => s.id))
const ORDERED_APP_SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  ...APP_SECTIONS.filter((s) => s.id !== 'home').sort((a, b) => a.label.localeCompare(b.label)),
]
const REPORT_SECTION_IDS = new Set<AppSection>(['reports', 'safety', 'fuel', 'loads'])
const SECTION_REPORT_TAB_OVERRIDES: Partial<Record<AppSection, ReportCategory>> = {
  safety: 'safety',
  fuel: 'fuel',
  loads: 'operations',
}
const TAB_SECTION_OVERRIDES: Partial<Record<ReportCategory, AppSection>> = {
  safety: 'safety',
  fuel: 'fuel',
  operations: 'loads',
}
const LISTS_CATALOG_LIST_IDS: ListsCatalogListId[] = [
  'fleet-writes',
  'op-status',
  'find-merge',
  'name-registry',
  'rename-vendors',
  'qbo-items-list',
  'service-types-db',
  'bank-csv',
  'vendors-payees',
  'parts-ref',
  'drivers-db',
  'vendors-db',
  'assets-db',
]
const LISTS_TAB_ID_SET = new Set<ListsCatalogsTab>(LISTS_CATALOG_TAB_IDS)
const LISTS_LIST_ID_SET = new Set<ListsCatalogListId>(LISTS_CATALOG_LIST_IDS)

function isValidListsTab(value: string): value is ListsCatalogsTab {
  return LISTS_TAB_ID_SET.has(value as ListsCatalogsTab)
}

function normalizeListsTab(value: string): ListsCatalogsTab {
  return isValidListsTab(value) ? value : 'fleet-samsara'
}

function isValidListsListId(value: string): value is ListsCatalogListId {
  return LISTS_LIST_ID_SET.has(value as ListsCatalogListId)
}

function normalizeListsListId(value: string): ListsCatalogListId | null {
  return isValidListsListId(value) ? value : null
}

function parseListsStateFromSearchParams(params: URLSearchParams): {
  tab: ListsCatalogsTab
  list: ListsCatalogListId | null
} {
  return {
    tab: normalizeListsTab(String(params.get('listsTab') || '').trim()),
    list: normalizeListsListId(String(params.get('listsList') || '').trim()),
  }
}

const SECTION_DESCRIPTIONS: Record<AppSection, string> = {
  home: 'Operational dashboard with section shortcuts and KPI snapshot.',
  maintenance: 'Work orders, integrity operations, and maintenance workflows.',
  accounting: 'Accounting workspace with QBO-facing actions and controls.',
  lists: 'Catalog and registry management with inline CRUD workflows.',
  reports: 'Cards by domain, live search, shared filters, exports.',
  safety: 'Safety-focused report cards and audit drill-down entry points.',
  tracking: 'Telematics fleet inventory, integrity, and connection status.',
  fuel: 'Fuel-focused report cards with direct transaction launch actions.',
  loads: 'Operations and load-facing reporting surfaces.',
}

function sectionForReportTab(tab: ReportCategory): AppSection {
  return TAB_SECTION_OVERRIDES[tab] ?? 'reports'
}

function isValidReportTab(value: string): value is ReportCategory {
  return REPORT_TAB_SET.has(value as ReportCategory)
}

function normalizeReportTab(value: string): ReportCategory {
  return isValidReportTab(value) ? value : 'overview'
}

function normalizeReportTabForSection(section: AppSection, tab: ReportCategory): ReportCategory {
  if (section === 'reports' && !REPORTS_PAGE_TAB_IDS.includes(tab)) return 'overview'
  return tab
}

function isValidSectionId(value: string): value is AppSection {
  return APP_SECTION_ID_SET.has(value as AppSection)
}

function resolveSectionFromSearchParams(p: URLSearchParams): AppSection {
  if (p.get('erpWoModal') === '1' || p.get('erpWoEmbed') === '1') return 'maintenance'
  if (p.get('erpFuelEmbed') === '1' || p.get('erpFuelModal') === '1') return 'accounting'
  if (p.get('erpEmbed') === '1') return 'reports'
  const q = String(p.get('section') || '').trim().toLowerCase() as AppSection
  if (isValidSectionId(q)) {
    if (q === 'reports') {
      const tabQ = String(p.get('tab') || '').trim().toLowerCase() as ReportCategory
      if (isValidReportTab(tabQ)) return sectionForReportTab(tabQ)
    }
    return q
  }
  const tabQ = String(p.get('tab') || '').trim().toLowerCase() as ReportCategory
  if (isValidReportTab(tabQ)) {
    return sectionForReportTab(tabQ)
  }
  return 'home'
}

function resolveReportTabFromSearchParams(p: URLSearchParams): ReportCategory {
  return normalizeReportTab(String(p.get('tab') || '').trim().toLowerCase())
}

function readLocationStateFromSearchParams(p: URLSearchParams): {
  section: AppSection
  tab: ReportCategory
  listsTab: ListsCatalogsTab
  listsList: ListsCatalogListId | null
} {
  const section = resolveSectionFromSearchParams(p)
  const tab = normalizeReportTabForSection(section, resolveReportTabFromSearchParams(p))
  const listsState = parseListsStateFromSearchParams(p)
  return {
    section,
    tab,
    listsTab: listsState.tab,
    listsList: listsState.list,
  }
}

function readInitialLocationState(): {
  section: AppSection
  tab: ReportCategory
  listsTab: ListsCatalogsTab
  listsList: ListsCatalogListId | null
} {
  if (typeof window === 'undefined') {
    return { section: 'home', tab: 'overview', listsTab: 'fleet-samsara', listsList: null }
  }
  const p = new URLSearchParams(window.location.search)
  return readLocationStateFromSearchParams(p)
}

function readErpRecordEmbedFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('erpWoEmbed') === '1'
}

function readErpWoModalHostFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('erpWoModal') === '1'
}

function readErpFuelEmbedFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('erpFuelEmbed') === '1'
}

function readErpFuelModalHostFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('erpFuelModal') === '1'
}

function readErpEmbedFlag(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('erpEmbed') === '1'
}

export default function App() {
  const [initialLocation] = useState(readInitialLocationState)
  const [activeSection, setActiveSection] = useState<AppSection>(initialLocation.section)
  const [tab, setTab] = useState<ReportCategory>(initialLocation.tab)
  /** True for the session when opened from ERP record-tab iframe (?erpWoEmbed=1), after URL cleanup. */
  const [erpRecordEmbed] = useState(readErpRecordEmbedFlag)
  /** True for the session when opened from ERP full-window WO modal (?erpWoModal=1), after URL cleanup. */
  const [erpWoModalHost] = useState(readErpWoModalHostFlag)
  const [erpFuelEmbed] = useState(readErpFuelEmbedFlag)
  const [erpFuelModalHost] = useState(readErpFuelModalHostFlag)
  const [erpEmbed] = useState(readErpEmbedFlag)
  const erpHostedSurface =
    erpEmbed || erpRecordEmbed || erpWoModalHost || erpFuelEmbed || erpFuelModalHost
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
  const [listsTab, setListsTab] = useState<ListsCatalogsTab>(initialLocation.listsTab)
  const [listsDeepLink, setListsDeepLink] = useState<ListsCatalogListId | null>(
    initialLocation.listsList,
  )

  const openSection = useCallback((section: AppSection) => {
    setActiveSection(section)
    setActive(null)
    setFuelPlannerTxn(null)
    setAppWoPickOpen(false)
    setAppWoModalOpen(false)
    if (section === 'lists') {
      setListsTab('fleet-samsara')
      setListsDeepLink(null)
      return
    }
    if (section === 'reports') setTab('overview')
    setListsDeepLink(null)
  }, [])
  const openListsSection = useCallback(
    (tabId: ListsCatalogsTab = 'fleet-samsara', listId: ListsCatalogListId | null = null) => {
      openSection('lists')
      setListsTab(tabId)
      setListsDeepLink(listId)
    },
    [openSection],
  )

  useEffect(() => {
    if (!REPORT_SECTION_IDS.has(activeSection)) setActive(null)
  }, [activeSection])

  useEffect(() => {
    if (activeSection !== 'reports') return
    if (!REPORTS_PAGE_TAB_IDS.includes(tab)) setTab('overview')
  }, [activeSection, tab])

  /** ERP maintenance → hub lists deep link: `?acctLists=1&listsTab=drivers-database` (+ optional `listsList=`). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('acctLists') !== '1') return
    const listsTabRaw = p.get('listsTab') || ''
    if (!isValidListsTab(listsTabRaw)) return
    const listsListRaw = p.get('listsList') || ''
    const list = normalizeListsListId(listsListRaw)
    openListsSection(listsTabRaw, list)
    p.delete('acctLists')
    p.delete('listsTab')
    p.delete('listsList')
    try {
      const u = new URL(window.location.href)
      u.search = p.toString() ? `?${p.toString()}` : ''
      window.history.replaceState({}, '', u.pathname + u.search + u.hash)
    } catch {
      /* ignore */
    }
  }, [openListsSection])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (erpEmbed || erpRecordEmbed || erpFuelEmbed || erpFuelModalHost || erpWoModalHost) return
    try {
      const before = `${window.location.pathname}${window.location.search}${window.location.hash}`
      const url = new URL(window.location.href)
      if (activeSection === 'home') url.searchParams.delete('section')
      else url.searchParams.set('section', activeSection)
      if (activeSection === 'reports') {
        if (tab === 'overview' || !REPORTS_PAGE_TAB_IDS.includes(tab)) {
          url.searchParams.delete('tab')
        }
        else url.searchParams.set('tab', tab)
      } else if (SECTION_REPORT_TAB_OVERRIDES[activeSection]) {
        url.searchParams.set('tab', SECTION_REPORT_TAB_OVERRIDES[activeSection]!)
      } else if (activeSection === 'lists') {
        url.searchParams.set('listsTab', listsTab)
        if (listsDeepLink) url.searchParams.set('listsList', listsDeepLink)
        else url.searchParams.delete('listsList')
      } else {
        url.searchParams.delete('tab')
      }
      if (activeSection !== 'lists') {
        url.searchParams.delete('listsTab')
        url.searchParams.delete('listsList')
      }
      const after = `${url.pathname}${url.search}${url.hash}`
      if (after !== before) window.history.replaceState({}, '', after)
    } catch {
      /* ignore */
    }
  }, [
    activeSection,
    tab,
    erpEmbed,
    erpRecordEmbed,
    erpFuelEmbed,
    erpFuelModalHost,
    erpWoModalHost,
    listsTab,
    listsDeepLink,
  ])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (erpEmbed || erpRecordEmbed || erpFuelEmbed || erpFuelModalHost || erpWoModalHost) return
    const syncFromLocation = () => {
      const p = new URLSearchParams(window.location.search)
      const locationState = readLocationStateFromSearchParams(p)
      const nextSection = locationState.section
      const nextTab = locationState.tab
      if (nextSection !== activeSection) openSection(nextSection)
      setTab((prev) => (prev === nextTab ? prev : nextTab))
      if (nextSection === 'lists') {
        const nextListsTabResolved = locationState.listsTab
        setListsTab((prev) => (prev === nextListsTabResolved ? prev : nextListsTabResolved))
        const nextListsListResolved = locationState.listsList
        setListsDeepLink((prev) =>
          prev === nextListsListResolved ? prev : nextListsListResolved,
        )
      } else {
        setListsDeepLink(null)
      }
    }
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [
    activeSection,
    openSection,
    erpEmbed,
    erpRecordEmbed,
    erpFuelEmbed,
    erpFuelModalHost,
    erpWoModalHost,
  ])

  useEffect(() => {
    if (!erpEmbed) return
    if (activeSection !== 'reports') openSection('reports')
  }, [erpEmbed, activeSection, openSection])

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
      openSection('maintenance')
      setMaintExtNav((prev) => ({
        view: viewMap[target],
        token: (prev?.token ?? 0) + 1,
      }))
    },
    [openSection],
  )

  const clearMaintExtNav = useCallback(() => setMaintExtNav(null), [])

  const openMaintenanceIntegrityView = useCallback(() => {
    openSection('maintenance')
    setMaintExtNav((prev) => ({
      view: 'integrity',
      token: (prev?.token ?? 0) + 1,
    }))
  }, [openSection])

  const notifyErpWoModalParentAfterSave = useCallback(
    ({ unitId }: { unitId: string }) => {
      if (!erpWoModalHost) return
      try {
        window.parent?.postMessage(
          {
            source: 'ih35-fleet-hub',
            type: 'maint-repair-wo-saved',
            unitId,
          },
          '*',
        )
      } catch {
        /* ignore */
      }
    },
    [erpWoModalHost],
  )

  useEffect(() => {
    if (activeSection !== 'maintenance') setMaintExtNav(null)
  }, [activeSection])

  /**
   * ERP maintenance full-window modal loads hub via iframe with ?erpWoModal=1.
   * Record-tab embed uses ?erpWoEmbed=1 (tab is set synchronously via readInitialReportTab).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('erpWoModal') !== '1') return
    openSection('maintenance')
    setAppWoPickOpen(true)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('erpWoModal')
      const qs = url.searchParams.toString()
      window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
    } catch {
      /* ignore */
    }
  }, [openSection])

  /** ERP Accounting fuel tab iframe (?erpFuelEmbed=1) or dedicated modal (?erpFuelModal=1) — open hub FuelTransactionForm only. */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const embed = p.get('erpFuelEmbed') === '1'
    const modal = p.get('erpFuelModal') === '1'
    if (!embed && !modal) return
    const ft = parseFuelTransactionTypeParam(p.get('fuelTxnType'))
    openSection('accounting')
    setFuelPlannerTxn(ft ?? 'fuel-bill')
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('erpFuelEmbed')
      url.searchParams.delete('erpFuelModal')
      url.searchParams.delete('fuelTxnType')
      const qs = url.searchParams.toString()
      window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
    } catch {
      /* ignore */
    }
  }, [openSection])

  const recent = useRecentReports('fleet-reports:recent')
  const { rows: serviceCatalogRows } = useServiceCatalogRows('all')
  const catalogServiceNames = useMemo(
    () => serviceCatalogRows.map((s) => s.service_name),
    [serviceCatalogRows],
  )
  const reportsSectionVisible = REPORT_SECTION_IDS.has(activeSection)
  const reportTabForSection = useMemo<ReportCategory>(() => {
    return SECTION_REPORT_TAB_OVERRIDES[activeSection] ?? tab
  }, [activeSection, tab])

  /** Report cards on the right: Overview = all reports; other tabs = that category only. */
  const catalogReportsForGrid = useMemo(() => {
    const list =
      reportTabForSection === 'overview'
        ? REPORTS
        : REPORTS.filter((r) => r.category === reportTabForSection)
    return list.filter((r) => matchesSearch(r, search))
  }, [reportTabForSection, search])

  /** Domain section headings + cards (Overview = one block per category). */
  const reportCardGroups = useMemo(() => {
    const list = catalogReportsForGrid
    if (reportTabForSection !== 'overview') {
      const meta = TABS.find((t) => t.id === reportTabForSection)
      return [
        {
          key: String(reportTabForSection),
          section: meta?.label ?? reportTabForSection,
          reports: list,
        },
      ]
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
  }, [reportTabForSection, catalogReportsForGrid])

  /** Maintenance workspace nav cards — always maintenance category. */
  const maintenanceListReports = useMemo(() => {
    return REPORTS.filter((r) => r.category === 'maintenance')
  }, [])

  const openReport = (r: ReportDef) => {
    recent.recordOpen(r.id)
    setActive(r)
  }

  const openForm425cEmbedded = () => {
    const r = REPORTS.find((x) => x.id === 'form-425c')
    if (r) openReport(r)
  }

  const appThemeStyle = useMemo<CSSProperties | undefined>(() => {
    if (!erpHostedSurface) return undefined
    return {
      ['--bg' as '--bg']: '#f4f7fb',
      ['--panel' as '--panel']: '#ffffff',
      ['--panel-2' as '--panel-2']: '#f8fafc',
      ['--border' as '--border']: '#d8e1ec',
      ['--text' as '--text']: '#0f172a',
      ['--muted' as '--muted']: '#5b6476',
      ['--accent' as '--accent']: '#0b66d6',
      ['--accent-2' as '--accent-2']: '#1f8b4c',
      ['--ok' as '--ok']: '#1f8b4c',
      ['--warn' as '--warn']: '#b7791f',
      ['--danger' as '--danger']: '#b42318',
      ['--shadow' as '--shadow']: '0 12px 32px rgba(15, 23, 42, 0.12)',
      colorScheme: 'light',
    }
  }, [erpHostedSurface])

  return (
    <IntegrationConnectionsProvider>
    <div
      className={
        'app app--fleet-reports' +
        (erpHostedSurface ? ' app--erp-host' : '') +
        (erpEmbed ? ' app--erp-embed' : '') +
        (erpRecordEmbed ? ' app--erp-record-embed' : '') +
        (erpFuelEmbed || erpFuelModalHost ? ' app--erp-fuel-host' : '')
      }
      style={appThemeStyle}
    >
      {!erpEmbed && !erpRecordEmbed && !erpFuelEmbed && !erpFuelModalHost ? (
        <nav
          className="tabs reports-tabs"
          role="tablist"
          aria-label="Application sections"
          style={{ margin: '8px 12px 0' }}
        >
          {ORDERED_APP_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeSection === s.id}
              className={
                activeSection === s.id ? 'reports-tab reports-tab--active' : 'reports-tab'
              }
              onClick={() => openSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="layout fleet-reports-layout">
        <div
          className={
            `reports-page reports-page--redesign reports-page--tab-${reportTabForSection}` +
            (erpRecordEmbed ? ' reports-page--erp-record-embed' : '')
          }
        >
          {!erpRecordEmbed &&
          !erpFuelEmbed &&
          !erpFuelModalHost &&
          activeSection === 'reports' ? (
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
                {TABS.filter((t) => REPORTS_PAGE_TAB_IDS.includes(t.id)).map((t) => (
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
          ) : !erpEmbed && !erpRecordEmbed && !erpFuelEmbed && !erpFuelModalHost ? (
            <header className="reports-page__header">
              <h1 className="reports-page__title">
                {APP_SECTIONS.find((s) => s.id === activeSection)?.label ?? 'Workspace'}
              </h1>
              <p className="reports-page__subtitle">
                {SECTION_DESCRIPTIONS[activeSection]}
              </p>
            </header>
          ) : null}

          <IntegrationOfflineBanner />

          <div
            className={
              'reports-page__body-split' +
              (!reportsSectionVisible || erpFuelEmbed || erpFuelModalHost
                ? ' reports-page__body-split--no-sidebar'
                : '')
            }
          >
            {reportsSectionVisible && !erpFuelEmbed && !erpFuelModalHost ? (
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
                onOpenForm425c={openForm425cEmbedded}
              />
            ) : null}

            <main
              key={`section-${activeSection}-${reportTabForSection}`}
              className={
                'reports-page__main main tab-panel' +
                (activeSection === 'accounting' ? ' reports-page__main--accounting' : '')
              }
            >
              {activeSection === 'home' ? (
                <ErrorBoundary name="Home">
                  <div className="acct-hub">
                    <div className="acct-hub__kpis" aria-label="Home KPI summary">
                      <div className="acct-hub__kpi">
                        <span className="acct-hub__kpi-lbl">Open bills</span>
                        <span className="acct-hub__kpi-val">12</span>
                        <span className="acct-hub__kpi-sub muted">$42,180 due</span>
                      </div>
                      <div className="acct-hub__kpi">
                        <span className="acct-hub__kpi-lbl">Expenses this month</span>
                        <span className="acct-hub__kpi-val">$18,420</span>
                        <span className="acct-hub__kpi-sub muted">38 transactions</span>
                      </div>
                      <div className="acct-hub__kpi">
                        <span className="acct-hub__kpi-lbl">QBO vendors</span>
                        <span className="acct-hub__kpi-val">240</span>
                        <span className="acct-hub__kpi-sub muted">Last synced today</span>
                      </div>
                      <div className="acct-hub__kpi acct-hub__kpi--warn">
                        <span className="acct-hub__kpi-lbl">Pending QBO posts</span>
                        <span className="acct-hub__kpi-val">2</span>
                        <span className="acct-hub__kpi-sub muted">Review before sync</span>
                      </div>
                    </div>
                    <div className="acct-hub__quick" aria-label="Home shortcuts">
                      {ORDERED_APP_SECTIONS.filter((s) => s.id !== 'home').map((s) => (
                        <button
                          key={`home-link-${s.id}`}
                          type="button"
                          className="acct-hub__quick-btn"
                          onClick={() => openSection(s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <div className="acct-hub__grid" aria-label="Section cards">
                      {ORDERED_APP_SECTIONS.filter((s) => s.id !== 'home').map((s) => (
                        <div key={`home-card-${s.id}`} className="acct-hub-sec">
                          <button
                            type="button"
                            className="acct-hub-sec__head"
                            onClick={() => openSection(s.id)}
                            aria-label={`Open ${s.label}`}
                          >
                            <span>{s.label}</span>
                            <span className="acct-hub-sec__chev" aria-hidden>
                              →
                            </span>
                          </button>
                          <ul className="acct-hub-sec__body">
                            <li>
                              <button
                                type="button"
                                className="acct-hub-sec__row"
                                onClick={() => openSection(s.id)}
                              >
                                <span>{SECTION_DESCRIPTIONS[s.id]}</span>
                                <span className="acct-hub-sec__arrow" aria-hidden>
                                  Open
                                </span>
                              </button>
                            </li>
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                </ErrorBoundary>
              ) : activeSection === 'maintenance' ? (
                <ErrorBoundary name="Maintenance">
                  {!erpRecordEmbed ? (
                    <div className="chips-inline maint-applied-filters" aria-label="Applied filters summary">
                      {appliedChips(appliedFilters).map((c) => (
                        <span key={c} className="chip sm">
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <MaintenanceWorkspace
                    tabReports={maintenanceListReports}
                    onOpenReport={openReport}
                    externalNavRequest={maintExtNav}
                    onExternalNavConsumed={clearMaintExtNav}
                    onOpenAppWorkOrder={() => setAppWoPickOpen(true)}
                    erpRecordEmbed={erpRecordEmbed}
                  />
                </ErrorBoundary>
              ) : activeSection === 'accounting' ? (
                <ErrorBoundary name="Accounting">
                  <AccountingDashboard
                    onRequestMaintenanceNav={navigateMaintenanceFromAccounting}
                    onOpenMaintenanceIntegrity={openMaintenanceIntegrityView}
                    onNewWorkOrder={() => setAppWoPickOpen(true)}
                    onOpenListsSection={(tabId, listId) =>
                      openListsSection(tabId, listId === undefined ? null : listId)
                    }
                    erpFuelHost={erpFuelEmbed || erpFuelModalHost}
                    onFuelOpenFromAccounting={
                      erpFuelEmbed || erpFuelModalHost ? (t) => setFuelPlannerTxn(t) : undefined
                    }
                    onOpenForm425c={openForm425cEmbedded}
                  />
                </ErrorBoundary>
              ) : activeSection === 'lists' ? (
                <ErrorBoundary name="Lists">
                  <ListsCatalogsWorkspace
                    activeTab={listsTab}
                    onTabChange={setListsTab}
                    deepLinkList={listsDeepLink}
                    onDeepLinkConsumed={() => setListsDeepLink(null)}
                  />
                </ErrorBoundary>
              ) : activeSection === 'tracking' ? (
                <ErrorBoundary name="Tracking">
                  <TelematicsFleetPage />
                </ErrorBoundary>
              ) : reportsSectionVisible ? (
                <ErrorBoundary name={activeSection === 'reports' ? 'Reports' : activeSection}>
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
                  {reportTabForSection === 'fuel' ? (
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
                </ErrorBoundary>
              ) : null}
            </main>
          </div>
        </div>
      </div>

      <div className="toast-host" id="toast-host" aria-live="polite" />

      {!erpRecordEmbed && !erpFuelEmbed && !erpFuelModalHost ? (
        <IntegrationConnectionStrip />
      ) : null}

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
        onClose={() => {
          if (erpFuelEmbed || erpFuelModalHost) {
            try {
              window.parent?.postMessage(
                { source: 'ih35-fleet-hub', type: 'erp-fuel-txn-closed' },
                '*',
              )
            } catch {
              /* ignore */
            }
          }
          setFuelPlannerTxn(null)
        }}
        onOpenVendorDirectory={() => {
          setFuelPlannerTxn(null)
          openListsSection('name-management', 'name-registry')
        }}
        onViewAllIntegrity={() => {
          setFuelPlannerTxn(null)
          openMaintenanceIntegrityView()
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
            style={{
              resize: 'both',
              overflow: 'auto',
              minHeight: '58vh',
              minWidth: 'min(940px, 96vw)',
              maxWidth: '98vw',
              maxHeight: '94vh',
            }}
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
              onAfterSaveSuccess={
                erpWoModalHost ? notifyErpWoModalParentAfterSave : undefined
              }
            />
          </div>
        </div>
      ) : null}
    </div>
    </IntegrationConnectionsProvider>
  )
}
