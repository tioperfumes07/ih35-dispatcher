import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { REPORTS, TABS } from './data/reports'
import type { ReportCategory, ReportDef, ReportFilters } from './types'
import { defaultFilters } from './types'
import { appliedChips } from './components/FilterPanel'
import { FilterSidebar } from './components/reports/FilterSidebar'
import { PartsCatalogPanel } from './components/reports/PartsCatalogPanel'
import { useServiceCatalogRows } from './hooks/useServiceCatalogRows'
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
import { FuelSettingsPage } from './components/fuel/FuelSettingsPage'
import { DriverExpenseMappingPage } from './components/fuel/DriverExpenseMappingPage'
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
import { DriverSchedulerPage } from './components/drivers/DriverSchedulerPage'
import { DriverProfilesPage } from './components/drivers/DriverProfilesPage'
import { EquipmentPage } from './components/equipment/EquipmentPage'

function matchesSearch(r: ReportDef, q: string, titleOverride?: string) {
  if (!q.trim()) return true
  const s = q.toLowerCase()
  const title = String(titleOverride || r.title || '').toLowerCase()
  return (
    title.includes(s) ||
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
const REPORTS_PAGE_TAB_IDS: ReportCategory[] = [
  'overview',
  'maintenance',
  'accounting',
  'safety',
  'fuel',
  'operations',
  'dot',
  'custom',
]

type AppSection =
  | 'home'
  | 'maintenance'
  | 'accounting'
  | 'lists'
  | 'reports'
  | 'safety'
  | 'fuel'
  | 'fuel-settings'
  | 'expense-mapping'
  | 'loads'
  | 'scheduler'
  | 'drivers'
  | 'equipment'

const APP_SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'lists', label: 'Lists & Catalogs' },
  { id: 'reports', label: 'Reports' },
  { id: 'safety', label: 'Safety' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'fuel-settings', label: 'Fuel settings' },
  { id: 'expense-mapping', label: 'Expense mapping' },
  { id: 'loads', label: 'Loads' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'equipment', label: 'Equipment' },
]
const APP_SECTION_ID_SET = new Set<AppSection>(APP_SECTIONS.map((s) => s.id))
const ORDERED_APP_SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  ...APP_SECTIONS.filter((s) => s.id !== 'home').sort((a, b) => a.label.localeCompare(b.label)),
]
const REPORT_SECTION_IDS = new Set<AppSection>(['reports', 'fuel', 'loads'])
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
  home: 'Operational dashboard with section shortcuts and KPI status.',
  maintenance: 'Manage work orders, integrity operations, and maintenance workflows.',
  accounting: 'Run accounting actions, posting checks, and QuickBooks workflows.',
  lists: 'Open inline catalogs and registries with search, filters, CRUD, and export.',
  reports: 'Use filters and search to open report viewers and exports by domain.',
  safety: 'Review safety report cards and open related audits and drill-downs.',
  fuel: 'Open fuel report cards and launch transaction workflows directly.',
  'fuel-settings': 'Map driver fuel types to QuickBooks accounts/items for auto-posting.',
  'expense-mapping': 'Map all driver app expense types to QuickBooks accounts, items, and vendors.',
  loads: 'Review operations and load-facing reporting surfaces.',
  scheduler: 'Plan monthly vacation / leave schedule with HOS status and exports.',
  drivers: 'Manage driver profiles, expirations, and schedule links.',
  equipment: 'Manage truck equipment lists and driver checklist submissions.',
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

type HomeKpis = {
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

const FALLBACK_HOME_KPIS: HomeKpis = {
  accountingTitle: 'Accounting — IH 35 Transportation LLC',
  environmentSub: 'Environment unknown',
  openBillsCount: '—',
  openBillsSub: 'No open bill data yet',
  expensesMonthAmount: '$0',
  expensesMonthSub: '0 transactions',
  qboVendors: '—',
  qboVendorsSub: 'QuickBooks cache not loaded',
  pendingQboPosts: '0',
  pendingQboPostsSub: 'No pending sync alerts',
  pendingQboPostsWarn: false,
  qboConnectionSub: 'QuickBooks status unknown',
  samsaraVehiclesSub: 'Samsara vehicles: —',
  lastKpiRefreshSub: 'Data refresh: —',
}

function asNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function parseDateValue(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
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
  const appWoPickDialogRef = useRef<HTMLDivElement | null>(null)
  const appWoModalDialogRef = useRef<HTMLDivElement | null>(null)
  const appWoPickReturnFocusRef = useRef<HTMLElement | null>(null)
  const appWoModalReturnFocusRef = useRef<HTMLElement | null>(null)
  const [appWoKind, setAppWoKind] = useState<WorkOrderShellKind>('IWO')
  const [appWoModalKey, setAppWoModalKey] = useState(0)
  const { isFullScreen: woPickFullScreen, toggle: toggleWoPickFullScreen } = useFullScreen()
  const [fuelPlannerTxn, setFuelPlannerTxn] = useState<FuelTransactionType | null>(null)
  const [listsTab, setListsTab] = useState<ListsCatalogsTab>(initialLocation.listsTab)
  const [listsDeepLink, setListsDeepLink] = useState<ListsCatalogListId | null>(
    initialLocation.listsList,
  )
  const [homeKpis, setHomeKpis] = useState<HomeKpis>(FALLBACK_HOME_KPIS)
  const [selectedReportForTab, setSelectedReportForTab] = useState<Record<string, string>>({})
  const [schedulerFocusUnit, setSchedulerFocusUnit] = useState<string | null>(null)

  const openSection = useCallback((section: AppSection) => {
    setActiveSection(section)
    if (section !== 'scheduler') setSchedulerFocusUnit(null)
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
    if (typeof document === 'undefined') return

    const scrubHelpQuestionNodes = () => {
      const root = document.querySelector('.app--fleet-reports')
      if (!root) return
      const nodes = root.querySelectorAll<HTMLElement>('button, span, div')
      nodes.forEach((el) => {
        const txt = String(el.textContent || '').trim()
        if (txt !== '?') return
        const cls = String(el.className || '').toLowerCase()
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase()
        const title = String(el.getAttribute('title') || '').toLowerCase()
        const isHelpLike =
          cls.includes('help') ||
          cls.includes('hint') ||
          cls.includes('tooltip') ||
          aria.includes('help') ||
          title.includes('help')
        if (isHelpLike) el.remove()
      })
    }

    scrubHelpQuestionNodes()
    const obs = new MutationObserver(() => scrubHelpQuestionNodes())
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])


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
  useEffect(() => {
    if (!appWoPickOpen) {
      const el = appWoPickReturnFocusRef.current
      if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0)
      return
    }
    appWoPickReturnFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAppWoPickOpen(false)
    }
    const id = window.setTimeout(() => {
      const root = appWoPickDialogRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [appWoPickOpen])
  useEffect(() => {
    if (!appWoModalOpen) {
      const el = appWoModalReturnFocusRef.current
      if (el && typeof el.focus === 'function') window.setTimeout(() => el.focus(), 0)
      return
    }
    appWoModalReturnFocusRef.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAppWoModalOpen(false)
        setAppWoKind('IWO')
      }
    }
    const id = window.setTimeout(() => {
      const root = appWoModalDialogRef.current
      if (!root) return
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 0)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [appWoModalOpen])

  useEffect(() => {
    let cancelled = false

    const loadHomeKpis = async () => {
      const reqHeaders = { Accept: 'application/json' }
      const [masterRes, recordsRes, syncAlertsRes, qboStatusRes, healthRes, vendorsLocalRes] = await Promise.allSettled([
        fetch('/api/qbo/master', { headers: reqHeaders }),
        fetch('/api/maintenance/records', { headers: reqHeaders }),
        fetch('/api/qbo/sync-alerts', { headers: reqHeaders }),
        fetch('/api/qbo/status', { headers: reqHeaders }),
        fetch('/api/health', { headers: reqHeaders }),
        fetch('/api/vendors-local', { headers: reqHeaders }),
      ])

      const readJson = async (res: PromiseSettledResult<Response>) => {
        if (res.status !== 'fulfilled' || !res.value.ok) return null
        return res.value.json().catch(() => null)
      }

      const [master, records, syncAlerts, qboStatus, health, vendorsLocal] = await Promise.all([
        readJson(masterRes),
        readJson(recordsRes),
        readJson(syncAlertsRes),
        readJson(qboStatusRes),
        readJson(healthRes),
        readJson(vendorsLocalRes),
      ])

      if (cancelled) return

      const transactionActivity =
        master && typeof master === 'object' && master.transactionActivity && typeof master.transactionActivity === 'object'
          ? (master.transactionActivity as Record<string, unknown>)
          : null
      const bills = Array.isArray(transactionActivity?.bills) ? transactionActivity.bills : []
      const openBillsDue = bills.reduce((sum, row) => {
        if (!row || typeof row !== 'object') return sum
        const rec = row as Record<string, unknown>
        const amt = asNumber(rec.balance) ?? asNumber(rec.totalAmt) ?? asNumber(rec.amount) ?? 0
        return sum + amt
      }, 0)

      const recordsObj =
        records && typeof records === 'object' ? (records as Record<string, unknown>) : null
      const apTransactions = Array.isArray(recordsObj?.apTransactions) ? recordsObj.apTransactions : []
      const monthStart = startOfMonth()
      const expensesThisMonth = apTransactions.filter((row) => {
        if (!row || typeof row !== 'object') return false
        const rec = row as Record<string, unknown>
        const d =
          parseDateValue(rec.txnDate) ??
          parseDateValue(rec.date) ??
          parseDateValue(rec.transactionDate) ??
          parseDateValue(rec.createdAt)
        return d !== null && d >= monthStart
      })
      const expenseAmount = expensesThisMonth.reduce((sum, row) => {
        if (!row || typeof row !== 'object') return sum
        const rec = row as Record<string, unknown>
        return sum + (asNumber(rec.amount) ?? asNumber(rec.totalAmt) ?? asNumber(rec.total) ?? 0)
      }, 0)
      const vehicleCount = Array.isArray(recordsObj?.vehicles) ? recordsObj.vehicles.length : 0

      const masterObj = master && typeof master === 'object' ? (master as Record<string, unknown>) : null
      const recordsQboVendors = Array.isArray((recordsObj?.qboCache as Record<string, unknown> | undefined)?.vendors)
        ? ((recordsObj?.qboCache as Record<string, unknown>).vendors as unknown[])
        : []
      const vendorsLocalCount =
        vendorsLocal &&
        typeof vendorsLocal === 'object' &&
        Array.isArray((vendorsLocal as Record<string, unknown>).vendors)
          ? ((vendorsLocal as Record<string, unknown>).vendors as unknown[]).length
          : 0
      const vendorCount = Array.isArray(masterObj?.vendors) && masterObj.vendors.length > 0
        ? masterObj.vendors.length
        : recordsQboVendors.length > 0
          ? recordsQboVendors.length
          : vendorsLocalCount

      const syncObj =
        syncAlerts && typeof syncAlerts === 'object'
          ? (syncAlerts as Record<string, unknown>)
          : null
      const pendingCount = asNumber((syncObj?.counts as Record<string, unknown> | undefined)?.total) ?? 0

      const qboObj = qboStatus && typeof qboStatus === 'object' ? (qboStatus as Record<string, unknown>) : null
      const qboConnected = qboObj?.connected === true
      const qboConfigured = qboObj?.configured === true
      const companyName = String(qboObj?.companyName || '').trim()
      const healthObj = health && typeof health === 'object' ? (health as Record<string, unknown>) : null
      const healthSamsaraVehicles = asNumber(healthObj?.samsaraVehicles)
      const vehiclesCount = healthSamsaraVehicles ?? vehicleCount
      const hasDatabaseUrl = healthObj?.hasDatabaseUrl === true
      const refreshedAtLabel = new Date().toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })

      setHomeKpis({
        accountingTitle: `Accounting — ${companyName || 'IH 35 Transportation LLC'}`,
        environmentSub: hasDatabaseUrl ? 'Environment: Cloud database' : 'Environment: Local fallback',
        openBillsCount: String(bills.length),
        openBillsSub:
          bills.length > 0 ? `${formatUsd(openBillsDue)} due` : 'No open bills in current activity window',
        expensesMonthAmount: formatUsd(expenseAmount),
        expensesMonthSub: `${expensesThisMonth.length} transactions`,
        qboVendors: String(vendorCount),
        qboVendorsSub: qboConnected
          ? 'QuickBooks connected'
          : qboConfigured
            ? 'QuickBooks disconnected'
            : 'QuickBooks not configured',
        pendingQboPosts: String(pendingCount),
        pendingQboPostsSub:
          pendingCount > 0 ? 'Review sync alerts before posting' : 'No pending sync alerts',
        pendingQboPostsWarn: pendingCount > 0,
        qboConnectionSub: qboConnected
          ? 'QuickBooks connected'
          : qboConfigured
            ? 'QuickBooks disconnected'
            : 'QuickBooks not configured',
        samsaraVehiclesSub: `Samsara vehicles: ${vehiclesCount}`,
        lastKpiRefreshSub: `Data refresh: ${refreshedAtLabel}`,
      })
    }

    const safeLoadHomeKpis = () =>
      loadHomeKpis().catch(() => {
        if (cancelled) return
        setHomeKpis(FALLBACK_HOME_KPIS)
      })

    void safeLoadHomeKpis()
    const refreshId = window.setInterval(() => {
      void safeLoadHomeKpis()
    }, 60000)

    return () => {
      window.clearInterval(refreshId)
      cancelled = true
    }
  }, [])

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

  /** Report cards: each tab shows only its own category (no duplicated grouped headers below tabs). */
  const catalogReportsForGrid = useMemo(() => {
    const list = REPORTS.filter((r) => r.category === reportTabForSection)
    return list.filter((r) => matchesSearch(r, search))
  }, [reportTabForSection, search])

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
                {SECTION_DESCRIPTIONS.reports}
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn sm" onClick={() => { window.location.href = '/maintenance.html' }}>
                  ← Maintenance
                </button>
                <button type="button" className="btn sm ghost" onClick={() => openSection('reports')}>
                  Fleet reports view
                </button>
              </div>
              <nav
                className="tabs reports-tabs"
                role="tablist"
                aria-label="Report categories"
              >
                {REPORTS_PAGE_TAB_IDS.map((tabId) => {
                  const t = TABS.find((x) => x.id === tabId)
                  return (
                    <button
                      key={tabId}
                      type="button"
                      role="tab"
                      aria-selected={tabId === tab}
                      className={tabId === tab ? 'reports-tab reports-tab--active' : 'reports-tab'}
                      onClick={() => setTab(tabId)}
                    >
                      {t?.label ?? tabId}
                    </button>
                  )
                })}
              </nav>
            </header>
          ) : !erpEmbed && !erpRecordEmbed && !erpFuelEmbed && !erpFuelModalHost ? (
            <header className="reports-page__header">
              <h1 className="reports-page__title">
                {APP_SECTIONS.find((s) => s.id === activeSection)?.label ?? 'Workspace'}
              </h1>
              <p className="reports-page__subtitle">
                {activeSection === 'home'
                  ? `${SECTION_DESCRIPTIONS.home} ${homeKpis.lastKpiRefreshSub}.`
                  : SECTION_DESCRIPTIONS[activeSection]}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn sm" onClick={() => { window.location.href = '/maintenance.html' }}>
                  ← Maintenance
                </button>
                <button type="button" className="btn sm ghost" onClick={() => openSection('reports')}>
                  Fleet reports view
                </button>
              </div>
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
                        <span className="acct-hub__kpi-val">{homeKpis.openBillsCount}</span>
                        <span className="acct-hub__kpi-sub muted">{homeKpis.openBillsSub}</span>
                      </div>
                      <div className="acct-hub__kpi">
                        <span className="acct-hub__kpi-lbl">Expenses this month</span>
                        <span className="acct-hub__kpi-val">{homeKpis.expensesMonthAmount}</span>
                        <span className="acct-hub__kpi-sub muted">{homeKpis.expensesMonthSub}</span>
                      </div>
                      <div className="acct-hub__kpi">
                        <span className="acct-hub__kpi-lbl">QBO vendors</span>
                        <span className="acct-hub__kpi-val">{homeKpis.qboVendors}</span>
                        <span className="acct-hub__kpi-sub muted">{homeKpis.qboVendorsSub}</span>
                      </div>
                      <div
                        className={
                          'acct-hub__kpi' + (homeKpis.pendingQboPostsWarn ? ' acct-hub__kpi--warn' : '')
                        }
                      >
                        <span className="acct-hub__kpi-lbl">Pending QBO posts</span>
                        <span className="acct-hub__kpi-val">{homeKpis.pendingQboPosts}</span>
                        <span className="acct-hub__kpi-sub muted">{homeKpis.pendingQboPostsSub}</span>
                      </div>
                    </div>
                    <p className="acct-hub__meta muted">
                      {homeKpis.qboConnectionSub +
                        ' · ' +
                        homeKpis.samsaraVehiclesSub +
                        ' · ' +
                        homeKpis.environmentSub +
                        ' · ' +
                        homeKpis.lastKpiRefreshSub}
                    </p>
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
                    homeKpis={homeKpis}
                    onOpenListsSection={(tabId, listId) =>
                      openListsSection(tabId, listId === undefined ? null : listId)
                    }
                    erpFuelHost={erpFuelEmbed || erpFuelModalHost}
                    onFuelOpenFromAccounting={
                      erpFuelEmbed || erpFuelModalHost ? (t) => setFuelPlannerTxn(t as FuelTransactionType) : undefined
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
              ) : activeSection === 'drivers' ? (
                <ErrorBoundary name="Drivers">
                  <DriverProfilesPage
                    onViewSchedule={(unit) => {
                      setSchedulerFocusUnit(unit)
                      openSection('scheduler')
                    }}
                  />
                </ErrorBoundary>
              ) : activeSection === 'scheduler' ? (
                <ErrorBoundary name="Scheduler">
                  <DriverSchedulerPage
                    focusUnit={schedulerFocusUnit}
                    onOpenDriverProfile={(unit) => {
                      setSchedulerFocusUnit(unit)
                      openSection('drivers')
                    }}
                  />
                </ErrorBoundary>
              ) : activeSection === 'equipment' ? (
                <ErrorBoundary name="Equipment">
                  <EquipmentPage />
                </ErrorBoundary>
              ) : activeSection === 'fuel-settings' ? (
                <ErrorBoundary name="Fuel settings">
                  <FuelSettingsPage />
                </ErrorBoundary>
              ) : activeSection === 'expense-mapping' ? (
                <ErrorBoundary name="Expense mapping">
                  <DriverExpenseMappingPage />
                </ErrorBoundary>
              ) : activeSection === 'safety' ? (
                <ErrorBoundary name="Safety">
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
                    <section className="fr-report-dropdown-shell" aria-live="polite">
                      <label className="fr-report-dropdown-label" htmlFor="frReportDropdown">
                        Reports in this section
                      </label>
                      <div className="fr-report-dropdown-row">
                        <select
                          id="frReportDropdown"
                          className="fr-report-dropdown"
                          value={selectedReportForTab[reportTabForSection] || ''}
                          onChange={(e) => {
                            const id = e.target.value
                            setSelectedReportForTab((prev) => ({ ...prev, [reportTabForSection]: id }))
                            const picked = catalogReportsForGrid.find((r) => r.id === id)
                            if (picked) openReport(picked)
                          }}
                        >
                          <option value="">Select a report…</option>
                          {catalogReportsForGrid.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.title + ' — ' + r.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <ul className="fr-report-dropdown-list">
                        {catalogReportsForGrid.map((r) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              className="fr-report-dropdown-item"
                              onClick={() => openReport(r)}
                            >
                              <span>{r.title}</span>
                              <span className="muted">{r.id}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <PartsCatalogPanel />
                </ErrorBoundary>
              ) : (
                <ErrorBoundary name="Home">
                  <div className="acct-hub">
                    <p className="muted">Fallback: returning to Home overview.</p>
                  </div>
                </ErrorBoundary>
              )}
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
            ref={appWoPickDialogRef}
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
            ref={appWoModalDialogRef}
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
