import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { seedIntegrityDemoIfEmpty } from '../data/integritySeed'
import { INTEGRITY_LIVE_FEED_INTERVAL_MS } from '../hooks/useIntegrityAlertsFeed'
import { openAlertCount } from '../api/postIntegrityCheck'
import type { IntegrityAlert } from '../types/integrity'
import { WorkOrderForm } from './maintenance/WorkOrderForm'
import { AccidentWorkOrderForm } from './maintenance/AccidentWorkOrderForm'
import { IntegrityDashboard } from './maintenance/IntegrityDashboard'
import { IntegrityThresholdSettings } from './maintenance/IntegrityThresholdSettings'
import { PostSaveIntegrityPanel } from './maintenance/PostSaveIntegrityPanel'
import { MaintenanceIntelligencePage } from './maintenance/MaintenanceIntelligencePage'
import {
  ListsCatalogsWorkspace,
  type ListsCatalogsTab,
  type ListsCatalogListId,
} from './accounting/ListsCatalogsWorkspace'
import { TelematicsFleetPage } from './telematics/TelematicsFleetPage'
import { ReportCard } from './ReportCard'
import type { ReportDef } from '../types'
import { WorkspaceSnapshot } from './maintenance/WorkspaceSnapshot'

export type MaintView =
  | 'grid'
  | 'repair-wo'
  | 'accident-wo'
  | 'expense'
  | 'bill'
  | 'integrity'
  | 'integrity-settings'
  | 'telematics'
  | 'maint-intel'
  | 'lists-catalogs'

function readErpEmbedRepairInitialView(): MaintView {
  if (typeof window === 'undefined') return 'grid'
  const p = new URLSearchParams(window.location.search)
  return p.get('erpWoEmbed') === '1' ? 'repair-wo' : 'grid'
}

function readErpEmbedRepairUnitId(): string {
  if (typeof window === 'undefined') return '101'
  const p = new URLSearchParams(window.location.search)
  if (p.get('erpWoEmbed') !== '1') return '101'
  const raw = p.get('erpUnitId')
  if (raw == null || raw === '') return '101'
  try {
    const s = decodeURIComponent(raw.replace(/\+/g, ' ')).trim()
    return s || '101'
  } catch {
    return String(raw).trim() || '101'
  }
}

type Props = {
  tabReports: ReportDef[]
  onOpenReport: (r: ReportDef) => void
  /** When `token` changes, switches the active maintenance view (e.g. from Accounting). */
  externalNavRequest?: { view: MaintView; token: number } | null
  onExternalNavConsumed?: () => void
  /** Opens the app-level WO kind picker (same as Accounting + New → work order). */
  onOpenAppWorkOrder?: () => void
  /** ERP maintenance.html record tab — minimal chrome, repair WO only. */
  erpRecordEmbed?: boolean
}

export function MaintenanceWorkspace({
  tabReports,
  onOpenReport,
  externalNavRequest,
  onExternalNavConsumed,
  onOpenAppWorkOrder,
  erpRecordEmbed,
}: Props) {
  const [view, setView] = useState<MaintView>(readErpEmbedRepairInitialView)
  const [listsCatalogsTab, setListsCatalogsTab] =
    useState<ListsCatalogsTab>('fleet-samsara')
  const [listsDeepLink, setListsDeepLink] = useState<ListsCatalogListId | null>(null)
  const [listsSidebarKey, setListsSidebarKey] = useState<string | null>(null)
  const [lastIntegrity, setLastIntegrity] = useState<IntegrityAlert[] | null>(
    null,
  )
  const [badge, setBadge] = useState(0)
  const [dashKey, setDashKey] = useState(0)
  const [repairTabUnitId, setRepairTabUnitId] = useState(readErpEmbedRepairUnitId)
  const [woModalOpen, setWoModalOpen] = useState(false)
  const [woModalKey, setWoModalKey] = useState(0)
  const consumeExtNavRef = useRef(onExternalNavConsumed)
  consumeExtNavRef.current = onExternalNavConsumed

  useEffect(() => {
    seedIntegrityDemoIfEmpty()
    setBadge(openAlertCount())
  }, [])

  /** ERP Create record tab loads this app in an iframe with ?erpWoEmbed=1&erpUnitId=… */
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    if (p.get('erpWoEmbed') !== '1') return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('erpWoEmbed')
      url.searchParams.delete('erpUnitId')
      const qs = url.searchParams.toString()
      window.history.replaceState(
        {},
        '',
        url.pathname + (qs ? `?${qs}` : '') + url.hash,
      )
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const refreshBadge = () => setBadge(openAlertCount())
    refreshBadge()
    const id = window.setInterval(refreshBadge, INTEGRITY_LIVE_FEED_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!woModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWoModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [woModalOpen])

  /** Run after DOM has the integrity block (flushSync + id). */
  function scrollIntegrityIntoView() {
    const run = () => {
      const el = document.getElementById('maint-integrity-root')
      if (!el) return
      const margin = 20
      const docTop = window.scrollY + el.getBoundingClientRect().top - margin
      window.scrollTo({ top: Math.max(0, docTop), behavior: 'instant' })

      const mainEl = document.querySelector('main.main')
      if (
        mainEl instanceof HTMLElement &&
        mainEl.scrollHeight > mainEl.clientHeight + 1
      ) {
        const er = el.getBoundingClientRect()
        const mr = mainEl.getBoundingClientRect()
        const nextTop = mainEl.scrollTop + (er.top - mr.top) - margin
        mainEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'instant' })
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(run))
  }

  /** Accounting → Maintenance handoff; layout effect so it wins over paint/scroll races. */
  useLayoutEffect(() => {
    if (!externalNavRequest) return
    setView(externalNavRequest.view)
    consumeExtNavRef.current?.()
  }, [externalNavRequest?.token, externalNavRequest?.view])

  const onBatch = (alerts: IntegrityAlert[]) => {
    setLastIntegrity(alerts)
    setBadge(openAlertCount())
    setDashKey((k) => k + 1)
  }

  const goToIntegrityView = () => {
    flushSync(() => {
      setView('integrity')
      setDashKey((k) => k + 1)
    })
    scrollIntegrityIntoView()
  }

  const OPS_NAV_SRC: { id: MaintView; label: string }[] = [
    { id: 'accident-wo', label: 'Accident work orders' },
    { id: 'telematics', label: 'Fleet telematics (Samsara)' },
    { id: 'integrity', label: 'Integrity' },
    { id: 'integrity-settings', label: 'Integrity thresholds' },
    { id: 'bill', label: 'Maintenance bill' },
    { id: 'expense', label: 'Maintenance expense' },
    { id: 'maint-intel', label: 'Maintenance intelligence' },
    { id: 'grid', label: 'Report cards' },
    { id: 'repair-wo', label: 'Repair work orders' },
  ]
  const OPS_NAV: { id: MaintView; label: string }[] = [...OPS_NAV_SRC].sort((a, b) =>
    a.label.localeCompare(b.label),
  )

  const LISTS_NAV_SRC: { tab: ListsCatalogsTab; list: ListsCatalogListId | null; label: string }[] = [
    { tab: 'assets-database', list: null, label: 'Assets (Samsara mirror)' },
    { tab: 'vendors-drivers', list: 'bank-csv', label: 'Bank CSV matching' },
    { tab: 'drivers-database', list: null, label: 'Drivers database' },
    { tab: 'name-management', list: 'find-merge', label: 'Find & merge duplicates' },
    { tab: 'fleet-samsara', list: 'fleet-writes', label: 'Fleet & Samsara writes' },
    { tab: 'name-management', list: 'name-registry', label: 'Name management' },
    { tab: 'operational-status', list: 'op-status', label: 'Operational status labels' },
    { tab: 'service-types', list: 'parts-ref', label: 'Parts reference' },
    { tab: 'qbo-items', list: 'qbo-items-list', label: 'QuickBooks items & accounts' },
    { tab: 'name-management', list: 'rename-vendors', label: 'Rename vendors & drivers' },
    { tab: 'service-types', list: 'service-types-db', label: 'Service types (DB)' },
    { tab: 'vendors-drivers', list: 'vendors-payees', label: 'Vendors & driver payees' },
    { tab: 'vendors-database', list: null, label: 'Vendors database' },
  ]
  const LISTS_NAV: { tab: ListsCatalogsTab; list: ListsCatalogListId | null; label: string }[] = [
    ...LISTS_NAV_SRC,
  ].sort((a, b) => a.label.localeCompare(b.label))

  const notifyErpParentAfterSave = (detail: { unitId: string }) => {
    if (!erpRecordEmbed) return
    try {
      window.parent?.postMessage(
        {
          source: 'ih35-fleet-hub',
          type: 'maint-repair-wo-saved',
          unitId: detail.unitId,
        },
        '*',
      )
    } catch {
      /* ignore */
    }
  }

  const navBtn = (id: MaintView, label: string, extra?: ReactNode) => (
    <li key={id}>
      <button
        type="button"
        className={view === id ? 'acct-bills-link is-active' : 'acct-bills-link'}
        onClick={() => {
          if (id === 'integrity') {
            goToIntegrityView()
            return
          }
          setView(id)
        }}
      >
        {label}
        {extra}
      </button>
    </li>
  )

  return (
    <div
      className={
        'acct-shell maint-workspace' + (erpRecordEmbed ? ' maint-workspace--erp-embed' : '')
      }
    >
      {!erpRecordEmbed ? (
        <aside className="acct-bills-sidebar" aria-label="Maintenance">
          <p className="acct-kicker">Maintenance</p>
          {onOpenAppWorkOrder ? (
            <button
              type="button"
              className="btn sm primary maint-workspace__new-wo"
              onClick={() => onOpenAppWorkOrder()}
            >
              + New work order
            </button>
          ) : null}
          <h3 className="acct-side-h">Operations</h3>
          <ul className="acct-bills-nav">
            {OPS_NAV.map((n) =>
              n.id === 'integrity'
                ? navBtn(
                    'integrity',
                    n.label,
                    badge > 0 ? (
                      <span className="nav-badge" aria-label={`${badge} open alerts`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null,
                  )
                : navBtn(n.id, n.label),
            )}
          </ul>
          <p className="acct-kicker" style={{ marginTop: 14 }}>
            Tools &amp; data
          </p>
          <ul className="acct-bills-nav">
            {LISTS_NAV.map((n) => (
              <li key={n.label}>
                <button
                  type="button"
                  className={
                    view === 'lists-catalogs' &&
                    listsSidebarKey === `${n.tab}:${n.list ?? 'root'}`
                      ? 'acct-bills-link is-active'
                      : 'acct-bills-link'
                  }
                  onClick={() => {
                    setListsCatalogsTab(n.tab)
                    setListsDeepLink(n.list)
                    setListsSidebarKey(`${n.tab}:${n.list ?? 'root'}`)
                    setView('lists-catalogs')
                  }}
                >
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="acct-main-col">
        {!erpRecordEmbed ? (
          <WorkspaceSnapshot onViewAllIntegrity={goToIntegrityView} />
        ) : null}

        <PostSaveIntegrityPanel
          alerts={lastIntegrity}
          onDismiss={() => setLastIntegrity(null)}
          onOpenDashboard={() => {
            flushSync(() => {
              setView('integrity')
              setLastIntegrity(null)
              setDashKey((k) => k + 1)
            })
            scrollIntegrityIntoView()
          }}
        />

        {view === 'grid' && (
          <section className="grid" aria-live="polite">
            {tabReports.length === 0 ? (
              <p className="empty">No reports match this search.</p>
            ) : (
              tabReports.map((r) => (
                <ReportCard key={r.id} report={r} onOpen={() => onOpenReport(r)} />
              ))
            )}
          </section>
        )}
        {view === 'repair-wo' && (
          <WorkOrderForm
            unitId={repairTabUnitId}
            onUnitIdChange={setRepairTabUnitId}
            onRequestCreateWorkOrder={() => {
              setWoModalKey((k) => k + 1)
              setWoModalOpen(true)
            }}
            onUnitOpenRecordModal={(id) => {
              setRepairTabUnitId(id)
              setWoModalKey((k) => k + 1)
              setWoModalOpen(true)
            }}
            onIntegrityBatch={onBatch}
            onAfterSaveSuccess={notifyErpParentAfterSave}
            onViewAllIntegrity={goToIntegrityView}
          />
        )}
        {view === 'accident-wo' && (
          <AccidentWorkOrderForm onIntegrityBatch={onBatch} />
        )}
        {view === 'expense' && (
          <WorkOrderForm
            integritySaveType="maintenance_expense"
            onIntegrityBatch={onBatch}
            onViewAllIntegrity={goToIntegrityView}
          />
        )}
        {view === 'bill' && (
          <WorkOrderForm
            integritySaveType="maintenance_bill"
            onIntegrityBatch={onBatch}
            onViewAllIntegrity={goToIntegrityView}
          />
        )}
        {view === 'integrity' && (
          <div id="maint-integrity-root" className="maint-integrity-anchor">
            <IntegrityDashboard
              refreshKey={dashKey}
              onAlertsChanged={() => setBadge(openAlertCount())}
            />
          </div>
        )}
        {view === 'integrity-settings' && <IntegrityThresholdSettings />}
        {view === 'telematics' && <TelematicsFleetPage />}
        {view === 'maint-intel' && <MaintenanceIntelligencePage />}
        {view === 'lists-catalogs' && (
          <ListsCatalogsWorkspace
            activeTab={listsCatalogsTab}
            onTabChange={(t) => {
              setListsCatalogsTab(t)
              setListsDeepLink(null)
              setListsSidebarKey(null)
            }}
            deepLinkList={listsDeepLink}
            onDeepLinkConsumed={() => setListsDeepLink(null)}
          />
        )}

        {woModalOpen ? (
          <div
            className="maint-modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setWoModalOpen(false)
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
                key={woModalKey}
                variant="modal"
                initialUnitId={repairTabUnitId}
                initialShellKind="IWO"
                onClose={() => setWoModalOpen(false)}
                onIntegrityBatch={onBatch}
                onAfterSaveSuccess={notifyErpParentAfterSave}
                onViewAllIntegrity={goToIntegrityView}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
