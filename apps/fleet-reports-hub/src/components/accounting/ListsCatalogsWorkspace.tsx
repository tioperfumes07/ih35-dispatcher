import { useEffect, useMemo, useState } from 'react'
import { VendorCustomerDedupWorkspace } from './VendorCustomerDedupWorkspace'
import { NameManagementPage } from './NameManagementPage'
import { ServiceCatalogTab } from '../catalog/ServiceCatalogTab'
import { PartsReferenceCatalogTab } from '../catalog/PartsReferenceCatalogTab'
import { DriversDatabase } from '../lists/DriversDatabase'
import { VendorsDatabase } from '../lists/VendorsDatabase'
import { FleetAssetsDatabase } from '../lists/FleetAssetsDatabase'
import { ImportTrailersPanel } from '../lists/ImportTrailersPanel'
import { OperationalStatusListPanel } from '../lists/OperationalStatusListPanel'
import { FleetSamsaraWritesListPanel } from '../lists/FleetSamsaraWritesListPanel'
import { BankCsvMatchingListPanel } from '../lists/BankCsvMatchingListPanel'
import { SharedListTable, type SharedListColumn } from '../lists/SharedListTable'
import { fetchQboItems, type QboItemRow } from '../../lib/qboItemsApi'
import { INITIAL_FLEET_WRITE_ROWS, INITIAL_OPERATIONAL_STATUS_ROWS } from '../../data/mockCatalogLists'
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
  | 'trailer-import'

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
  | 'import-trailers'

/** Keep legacy tab ids for URL/deep-link compatibility from ERP shell. */
export const LISTS_CATALOG_TAB_IDS: ListsCatalogsTab[] = [
  'assets-database',
  'drivers-database',
  'fleet-samsara',
  'name-management',
  'operational-status',
  'qbo-items',
  'service-types',
  'vendors-database',
  'vendors-drivers',
  'trailer-import',
]

type Props = {
  activeTab: ListsCatalogsTab
  onTabChange: (tab: ListsCatalogsTab) => void
  deepLinkList?: ListsCatalogListId | null
  onDeepLinkConsumed?: () => void
  activeParentSection?: string
}

type CategoryId =
  | 'fleet-samsara'
  | 'operational-status'
  | 'quickbooks'
  | 'drivers'
  | 'parts-repairs'
  | 'vendors'

type CategoryDef = {
  id: CategoryId
  label: string
  tabForUrl: ListsCatalogsTab
  items: { id: ListsCatalogListId; label: string; description: string }[]
}


const SECTION_LISTS_FILTER: Record<string, ListsCatalogListId[] | null> = {
  drivers: ['drivers-db', 'assets-db', 'name-registry'],
  accounting: ['vendors-db', 'vendors-payees', 'qbo-items-list', 'bank-csv', 'rename-vendors'],
  maintenance: ['parts-ref', 'service-types-db', 'assets-db', 'fleet-writes'],
  fuel: ['vendors-db', 'qbo-items-list'],
  safety: ['drivers-db', 'op-status'],
  lists: null,
}

function mapTabToCategory(tab: ListsCatalogsTab): CategoryId {
  if (tab === 'operational-status') return 'operational-status'
  if (tab === 'qbo-items' || tab === 'vendors-drivers') return 'quickbooks'
  if (tab === 'drivers-database' || tab === 'name-management') return 'drivers'
  if (tab === 'vendors-database') return 'vendors'
  if (tab === 'service-types') return 'parts-repairs'
  if (tab === 'trailer-import') return 'fleet-samsara'
  return 'fleet-samsara'
}

function mapListToCategory(listId: ListsCatalogListId): CategoryId {
  if (listId === 'op-status') return 'operational-status'
  if (listId === 'qbo-items-list' || listId === 'bank-csv' || listId === 'vendors-payees') return 'quickbooks'
  if (listId === 'drivers-db' || listId === 'name-registry' || listId === 'rename-vendors' || listId === 'find-merge') return 'drivers'
  if (listId === 'vendors-db') return 'vendors'
  if (listId === 'parts-ref' || listId === 'service-types-db') return 'parts-repairs'
  if (listId === 'import-trailers') return 'fleet-samsara'
  return 'fleet-samsara'
}

function QboItemsPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<QboItemRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setErr(null)
    setLoading(true)
    try {
      setRows(await fetchQboItems())
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
        searchPlaceholder="Search name, SKU..."
        exportFilename="QboItems"
        onCloseList={onClose}
        toolbarExtra={
          <button type="button" className="btn sm ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        }
      />
    </div>
  )
}

export function ListsCatalogsWorkspace({
  activeTab,
  onTabChange,
  deepLinkList,
  onDeepLinkConsumed,
  activeParentSection,
}: Props) {
  const { rows: svcRows } = useServiceCatalogRows('all')
  const [openedListId, setOpenedListId] = useState<ListsCatalogListId | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(mapTabToCategory(activeTab))

  const categories = useMemo<CategoryDef[]>(
    () => [
      {
        id: 'fleet-samsara',
        label: 'Fleet & Samsara',
        tabForUrl: 'assets-database',
        items: [
          {
            id: 'assets-db',
            label: 'Vehicles database',
            description: 'Master fleet records (Samsara sync + local editable fields)',
          },
          {
            id: 'fleet-writes',
            label: 'Fleet & Samsara writes',
            description: `Telemetry write log (${INITIAL_FLEET_WRITE_ROWS.length} demo rows)`,
          },
          {
            id: 'import-trailers',
            label: 'Import trailers',
            description: 'Upload .xlsx/.csv and bulk-upsert trailer records',
          },
        ],
      },
      {
        id: 'operational-status',
        label: 'Operational Status',
        tabForUrl: 'operational-status',
        items: [
          {
            id: 'op-status',
            label: 'Operational status labels',
            description: `${INITIAL_OPERATIONAL_STATUS_ROWS.length} labels`,
          },
        ],
      },
      {
        id: 'quickbooks',
        label: 'QuickBooks',
        tabForUrl: 'qbo-items',
        items: [
          { id: 'qbo-items-list', label: 'QuickBooks items & accounts', description: 'Catalog items and chart mappings' },
          { id: 'vendors-payees', label: 'Vendors & driver payees', description: 'Name registry links' },
          { id: 'bank-csv', label: 'Bank CSV matching', description: 'Import and match transactions' },
        ],
      },
      {
        id: 'drivers',
        label: 'Drivers',
        tabForUrl: 'drivers-database',
        items: [
          { id: 'drivers-db', label: 'Drivers database', description: 'Driver registry and sync controls' },
          { id: 'name-registry', label: 'Name management', description: 'Shared name registry and links' },
          { id: 'rename-vendors', label: 'Rename vendors & drivers', description: 'Bulk rename helper' },
          { id: 'find-merge', label: 'Find & merge duplicates', description: 'Duplicate cleanup workspace' },
        ],
      },
      {
        id: 'vendors',
        label: 'Vendors',
        tabForUrl: 'vendors-database',
        items: [
          { id: 'vendors-db', label: 'Vendors database', description: 'Vendor master table' },
        ],
      },
      {
        id: 'parts-repairs',
        label: 'Parts & Repairs',
        tabForUrl: 'service-types',
        items: [
          { id: 'parts-ref', label: 'Parts reference', description: 'Parts catalog table' },
          { id: 'service-types-db', label: 'Service types (DB)', description: `${svcRows.length} types` },
        ],
      },
    ],
    [svcRows.length],
  )

  const normalizedSection = String(activeParentSection || 'lists').trim().toLowerCase() || 'lists'
  const allowedLists = SECTION_LISTS_FILTER[normalizedSection] ?? null
  const filteredCategories = useMemo(() => {
    if (!allowedLists) return categories
    const set = new Set(allowedLists)
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => set.has(item.id)),
      }))
      .filter((category) => category.items.length > 0)
  }, [allowedLists, categories])

  useEffect(() => {
    const defaultCategory = filteredCategories[0]?.id ?? mapTabToCategory(activeTab)
    setExpandedCategory((prev) => prev ?? defaultCategory)
  }, [activeTab, filteredCategories])

  const allowedDeepLinkIds = useMemo(() => {
    if (!allowedLists) return null
    return new Set(allowedLists)
  }, [allowedLists])

  useEffect(() => {
    if (!deepLinkList) return
    if (allowedDeepLinkIds && !allowedDeepLinkIds.has(deepLinkList)) {
      onDeepLinkConsumed?.()
      return
    }
    setOpenedListId(deepLinkList)
    setExpandedCategory(mapListToCategory(deepLinkList))
    onDeepLinkConsumed?.()
  }, [allowedDeepLinkIds, deepLinkList, onDeepLinkConsumed])

  const closeList = () => setOpenedListId(null)

  const listPanel = (() => {
    switch (openedListId) {
      case 'find-merge':
        return <VendorCustomerDedupWorkspace />
      case 'name-registry':
      case 'rename-vendors':
      case 'vendors-payees':
        return <NameManagementPage />
      case 'service-types-db':
        return <ServiceCatalogTab recordType="maintenance" />
      case 'parts-ref':
        return <PartsReferenceCatalogTab />
      case 'qbo-items-list':
        return <QboItemsPanel onClose={closeList} />
      case 'op-status':
        return <OperationalStatusListPanel onCloseList={closeList} />
      case 'fleet-writes':
        return <FleetSamsaraWritesListPanel onCloseList={closeList} />
      case 'bank-csv':
        return <BankCsvMatchingListPanel onCloseList={closeList} />
      case 'drivers-db':
        return <DriversDatabase onCloseList={closeList} />
      case 'vendors-db':
        return <VendorsDatabase onCloseList={closeList} />
      case 'assets-db':
        return <FleetAssetsDatabase onCloseList={closeList} />
      case 'import-trailers':
        return <ImportTrailersPanel onCloseList={closeList} />
      default:
        return null
    }
  })()

  return (
    <div className="lists-catalogs lists-catalogs--hub lists-catalogs--categories-home">
      <div className="lists-catalogs__home" aria-label="Lists and catalogs categories">
        {filteredCategories.map((category) => {
          const expanded = expandedCategory === category.id
          return (
            <section key={category.id} className="lists-catalogs__cat">
              <button
                type="button"
                className="lists-catalogs__cat-head"
                aria-expanded={expanded}
                onClick={() => {
                  setExpandedCategory((prev) => (prev === category.id ? null : category.id))
                  onTabChange(category.tabForUrl)
                  setOpenedListId(null)
                }}
              >
                <span>{category.label}</span>
                <span aria-hidden>{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded ? (
                <ul className="lists-catalogs__cat-items">
                  {category.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="lists-catalogs__cat-item"
                        onClick={() => setOpenedListId(item.id)}
                      >
                        <span className="lists-catalogs__cat-item-name">{item.label}</span>
                        <span className="lists-catalogs__cat-item-desc muted">{item.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="lists-catalogs__body tab-panel">
        {openedListId ? (
          <div className="lists-catalogs__embedded">
            <header className="lists-catalogs__list-head">
              <span className="lists-catalogs__list-title">
                {filteredCategories
                  .flatMap((c) => c.items)
                  .find((item) => item.id === openedListId)
                  ?.label ?? 'List'}
              </span>
              <div className="lists-catalogs__list-head-actions">
                <button type="button" className="btn sm ghost lists-catalogs__list-btn" onClick={closeList}>
                  ← Close list
                </button>
              </div>
            </header>
            {listPanel}
          </div>
        ) : (
          <p className="lists-catalogs__empty muted">Select a category and list to open it in the panel.</p>
        )}
      </div>
    </div>
  )
}
