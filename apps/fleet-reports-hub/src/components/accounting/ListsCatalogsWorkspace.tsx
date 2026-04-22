import { useCallback, useEffect, useMemo, useState } from 'react'
import { VendorCustomerDedupWorkspace } from './VendorCustomerDedupWorkspace'
import { NameManagementPage } from './NameManagementPage'
import { ServiceCatalogTab } from '../catalog/ServiceCatalogTab'
import { PartsReferenceCatalogTab } from '../catalog/PartsReferenceCatalogTab'
import { SharedListTable, type SharedListColumn } from '../lists/SharedListTable'
import { DriversDatabase } from '../lists/DriversDatabase'
import { VendorsDatabase } from '../lists/VendorsDatabase'
import { AssetsDatabase } from '../lists/AssetsDatabase'
import { OperationalStatusListPanel } from '../lists/OperationalStatusListPanel'
import { FleetSamsaraWritesListPanel } from '../lists/FleetSamsaraWritesListPanel'
import { INITIAL_FLEET_WRITE_ROWS, INITIAL_OPERATIONAL_STATUS_ROWS } from '../../data/mockCatalogLists'
import { fetchQboItems, type QboItemRow } from '../../lib/qboItemsApi'
import { useServiceCatalogRows } from '../../hooks/useServiceCatalogRows'

export type ListsCatalogsTab =
  | 'assets-database'
  | 'drivers-database'
  | 'fleet-samsara'
  | 'name-management'
  | 'operational-status'
  | 'qbo-items'
  | 'service-types'
  | 'vendors-database'
  | 'vendors-drivers'

export type ListsCatalogListId =
  | 'fleet-writes'
  | 'op-status'
  | 'find-merge'
  | 'name-registry'
  | 'rename-vendors'
  | 'qbo-items-list'
  | 'service-types-db'
  | 'bank-csv'
  | 'vendors-payees'
  | 'parts-ref'
  | 'drivers-db'
  | 'vendors-db'
  | 'assets-db'

type TabDef = { id: ListsCatalogsTab; label: string }

const TAB_DEFS_SOURCE: TabDef[] = [
  { id: 'assets-database', label: 'Assets (Samsara mirror)' },
  { id: 'drivers-database', label: 'Drivers database' },
  { id: 'fleet-samsara', label: 'Fleet & Samsara writes' },
  { id: 'name-management', label: 'Name management' },
  { id: 'operational-status', label: 'Operational status labels' },
  { id: 'qbo-items', label: 'QuickBooks items & accounts' },
  { id: 'service-types', label: 'Service types (DB)' },
  { id: 'vendors-database', label: 'Vendors database' },
  { id: 'vendors-drivers', label: 'Vendors & driver payees' },
]

/** Lists & catalogs tab bar — alphabetical by label (Packet 8 + 9). */
const TAB_DEFS: TabDef[] = [...TAB_DEFS_SOURCE].sort((a, b) => a.label.localeCompare(b.label))

/** Tab ids for `?acctLists=1&listsTab=` deep links from ERP maintenance. */
export const LISTS_CATALOG_TAB_IDS: ListsCatalogsTab[] = TAB_DEFS_SOURCE.map((t) => t.id)

const DB_TABS = new Set<ListsCatalogsTab>([
  'assets-database',
  'drivers-database',
  'vendors-database',
])

type CardDef = {
  id: ListsCatalogListId
  name: string
  description: string
}

type Props = {
  activeTab: ListsCatalogsTab
  onTabChange: (tab: ListsCatalogsTab) => void
  deepLinkList?: ListsCatalogListId | null
  onDeepLinkConsumed?: () => void
}

function sortCatalogCardsAlpha(cards: CardDef[]): CardDef[] {
  return cards.slice().sort((a, b) => a.name.localeCompare(b.name))
}

function cardsForTab(tab: ListsCatalogsTab, serviceCount: number): CardDef[] {
  let cards: CardDef[]
  switch (tab) {
    case 'fleet-samsara':
      cards = [
        {
          id: 'fleet-writes',
          name: 'Fleet & Samsara writes',
          description: `Telemetry write log · ${INITIAL_FLEET_WRITE_ROWS.length} demo rows`,
        },
        {
          id: 'op-status',
          name: 'Operational status labels',
          description: `${INITIAL_OPERATIONAL_STATUS_ROWS.length} labels`,
        },
      ]
      break
    case 'name-management':
      cards = [
        {
          id: 'find-merge',
          name: 'Find & merge duplicates',
          description: 'Vendor / customer dedup',
        },
        { id: 'name-registry', name: 'Name management', description: 'Registry & links' },
        {
          id: 'rename-vendors',
          name: 'Rename vendors & drivers',
          description: 'Bulk rename tools',
        },
      ]
      break
    case 'operational-status':
      cards = [
        {
          id: 'op-status',
          name: 'Operational status labels',
          description: `${INITIAL_OPERATIONAL_STATUS_ROWS.length} labels`,
        },
      ]
      break
    case 'qbo-items':
      cards = [
        {
          id: 'qbo-items-list',
          name: 'QuickBooks items & accounts',
          description: 'Catalog items',
        },
      ]
      break
    case 'service-types':
      cards = [
        {
          id: 'service-types-db',
          name: 'Service types (DB)',
          description: `${serviceCount} types`,
        },
      ]
      break
    case 'vendors-drivers':
      cards = [
        { id: 'bank-csv', name: 'Bank CSV matching', description: 'Import & match' },
        {
          id: 'vendors-payees',
          name: 'Vendors & driver payees',
          description: 'Name registry',
        },
      ]
      break
    default:
      cards = []
  }
  return sortCatalogCardsAlpha(cards)
}

function QboItemsPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<QboItemRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      setRows(await fetchQboItems())
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  type R = QboItemRow & Record<string, unknown>
  const cols: SharedListColumn<R>[] = [
    { id: 'n', label: 'Name', width: 180, render: (r) => r.name },
    { id: 't', label: 'Type', width: 88, render: (r) => r.category ?? '—' },
    { id: 'a', label: 'Account', width: 120, render: () => '—' },
    { id: 'd', label: 'Description', width: 140, render: () => '—' },
    { id: 'act', label: 'Active', width: 64, render: () => 'Yes' },
  ]
  const data: R[] = rows.map((r) => ({ ...r }))

  return (
    <div>
      {err ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      ) : null}
      <SharedListTable<R>
        title="QuickBooks items & accounts"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => r.id}
        searchPlaceholder="Search name, SKU…"
        exportFilename="QboItems"
        onCloseList={onClose}
      />
    </div>
  )
}

export function ListsCatalogsWorkspace({
  activeTab,
  onTabChange,
  deepLinkList,
  onDeepLinkConsumed,
}: Props) {
  const { rows: svcRows } = useServiceCatalogRows('all')
  const [openedListId, setOpenedListId] = useState<ListsCatalogListId | null>(null)

  useEffect(() => {
    if (deepLinkList) {
      setOpenedListId(deepLinkList)
      onDeepLinkConsumed?.()
    }
  }, [deepLinkList, onDeepLinkConsumed])

  const cards = useMemo(
    () => cardsForTab(activeTab, svcRows.length),
    [activeTab, svcRows.length],
  )

  const closeList = () => setOpenedListId(null)

  const bankCols: SharedListColumn<Record<string, unknown>>[] = [
    { id: 'f', label: 'File', width: 160, render: (r) => String(r.file ?? '') },
    { id: 'st', label: 'Status', width: 88, render: (r) => String(r.status ?? '') },
  ]

  const isDbTab = DB_TABS.has(activeTab)
  const showCards = !isDbTab && !openedListId
  const showListPanel = !isDbTab && Boolean(openedListId)

  const dbClose = () => onTabChange('fleet-samsara')

  const listPanel = (() => {
    switch (openedListId) {
      case 'find-merge':
        return (
          <div className="lists-catalogs__embedded">
            <header className="lists-catalogs__list-head">
              <span className="lists-catalogs__list-title">Find & merge duplicates</span>
              <div className="lists-catalogs__list-head-actions">
                <button type="button" className="btn sm ghost lists-catalogs__list-btn" onClick={closeList}>
                  ← Close list
                </button>
              </div>
            </header>
            <VendorCustomerDedupWorkspace />
          </div>
        )
      case 'name-registry':
      case 'rename-vendors':
      case 'vendors-payees':
        return (
          <div className="lists-catalogs__embedded">
            <header className="lists-catalogs__list-head">
              <span className="lists-catalogs__list-title">
                {openedListId === 'rename-vendors'
                  ? 'Rename vendors & drivers'
                  : openedListId === 'name-registry'
                    ? 'Name management'
                    : 'Vendors & driver payees'}
              </span>
              <div className="lists-catalogs__list-head-actions">
                <button type="button" className="btn sm ghost lists-catalogs__list-btn" onClick={closeList}>
                  ← Close list
                </button>
              </div>
            </header>
            <NameManagementPage />
          </div>
        )
      case 'service-types-db':
        return (
          <div className="lists-catalogs__embedded">
            <header className="lists-catalogs__list-head">
              <span className="lists-catalogs__list-title">Service types (DB)</span>
              <div className="lists-catalogs__list-head-actions">
                <button type="button" className="btn sm ghost lists-catalogs__list-btn" onClick={closeList}>
                  ← Close list
                </button>
              </div>
            </header>
            <ServiceCatalogTab recordType="maintenance" />
          </div>
        )
      case 'parts-ref':
        return (
          <div className="lists-catalogs__embedded">
            <header className="lists-catalogs__list-head">
              <span className="lists-catalogs__list-title">Parts reference</span>
              <div className="lists-catalogs__list-head-actions">
                <button type="button" className="btn sm ghost lists-catalogs__list-btn" onClick={closeList}>
                  ← Close list
                </button>
              </div>
            </header>
            <PartsReferenceCatalogTab />
          </div>
        )
      case 'qbo-items-list':
        return <QboItemsPanel onClose={closeList} />
      case 'op-status':
        return <OperationalStatusListPanel onCloseList={closeList} />
      case 'fleet-writes':
        return <FleetSamsaraWritesListPanel onCloseList={closeList} />
      case 'bank-csv':
        return (
          <SharedListTable
            title="Bank CSV matching"
            itemCount={1}
            columns={bankCols}
            data={[{ id: '1', file: 'Sample-bank.csv', status: 'Draft' }]}
            rowKey={(r) => String(r.id)}
            exportFilename="BankCsv"
            onCloseList={closeList}
          />
        )
      case 'drivers-db':
        return <DriversDatabase onCloseList={closeList} />
      case 'vendors-db':
        return <VendorsDatabase onCloseList={closeList} />
      case 'assets-db':
        return <AssetsDatabase onCloseList={closeList} />
      default:
        return null
    }
  })()

  const dbBody =
    activeTab === 'drivers-database' ? (
      <DriversDatabase onCloseList={dbClose} />
    ) : activeTab === 'vendors-database' ? (
      <VendorsDatabase onCloseList={dbClose} />
    ) : activeTab === 'assets-database' ? (
      <AssetsDatabase onCloseList={dbClose} />
    ) : null

  if (showCards) {
    return (
      <div className="lists-catalogs lists-catalogs--hub">
        <div
          className="lists-catalogs__tabs integrity-tabs lists-catalogs__tabs--many"
          role="tablist"
        >
          {TAB_DEFS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={activeTab === t.id ? 'integrity-tab active' : 'integrity-tab'}
              onClick={() => {
                onTabChange(t.id)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="lists-catalogs__body tab-panel lists-catalogs__cards-wrap">
          <div className="lists-catalogs__cards">
            {cards.map((c) => (
              <button
                key={`${activeTab}-${c.id}`}
                type="button"
                className="lists-catalogs__card"
                onClick={() => setOpenedListId(c.id)}
              >
                <span className="lists-catalogs__card-name">{c.name}</span>
                <span className="lists-catalogs__card-desc muted">{c.description}</span>
                <span className="lists-catalogs__card-btn">Open list</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="lists-catalogs">
      <div
        className="lists-catalogs__tabs integrity-tabs lists-catalogs__tabs--many"
        role="tablist"
      >
        {TAB_DEFS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={activeTab === t.id ? 'integrity-tab active' : 'integrity-tab'}
            onClick={() => {
              onTabChange(t.id)
              setOpenedListId(null)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="lists-catalogs__body tab-panel">
        {isDbTab ? dbBody : showListPanel ? listPanel : null}
      </div>
    </div>
  )
}
