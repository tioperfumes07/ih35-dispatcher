import { useEffect, useMemo, useState } from 'react'

type MappingMode = 'required' | 'optional' | 'not_needed'

type ExpenseTypeDef = {
  id: string
  icon: string
  label: string
}

type QboAccount = {
  id: string
  name: string
  accountType: string
  active: boolean
}

type QboItem = {
  id: string
  name: string
  itemType: string
  active: boolean
}

type QboVendor = {
  id: string
  name: string
  active: boolean
}

type MappingRow = {
  expense_type: string
  qbo_account_id?: string | null
  qbo_account_name?: string | null
  qbo_item_id?: string | null
  qbo_item_name?: string | null
  default_vendor_id?: string | null
  default_vendor_name?: string | null
  requires_load_number?: MappingMode | null
  requires_reefer_number?: boolean | null
  requires_receipt?: boolean | null
  requires_odometer?: boolean | null
  auto_post_qbo?: boolean | null
}

const BASE_EXPENSE_TYPES: ExpenseTypeDef[] = [
  { id: 'truck_diesel', icon: '⛽', label: 'Truck Diesel' },
  { id: 'reefer_diesel', icon: '❄️', label: 'Reefer Diesel' },
  { id: 'def', icon: '🟦', label: 'DEF' },
  { id: 'maintenance_expense', icon: '🔧', label: 'Maintenance' },
  { id: 'tire_expense', icon: '🛞', label: 'Tire expense' },
  { id: 'parts_supplies', icon: '🔩', label: 'Parts & supplies' },
  { id: 'tolls', icon: '🛣️', label: 'Tolls' },
  { id: 'parking', icon: '🅿️', label: 'Parking' },
  { id: 'meals_per_diem', icon: '🍽️', label: 'Meals (per diem)' },
  { id: 'lumper_fees', icon: '📦', label: 'Lumper fees' },
  { id: 'hotel_lodging', icon: '🏨', label: 'Hotel/lodging' },
  { id: 'other_expense', icon: '🔄', label: 'Other' },
]

function normalizeId(v: string): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeLoadMode(v: unknown): MappingMode {
  const mode = String(v || '').trim().toLowerCase()
  if (mode === 'required' || mode === 'optional' || mode === 'not_needed') return mode
  if (mode === 'true') return 'required'
  if (mode === 'false') return 'optional'
  return 'optional'
}

function defaultRow(expenseType: string): MappingRow {
  return {
    expense_type: expenseType,
    qbo_account_id: '',
    qbo_account_name: '',
    qbo_item_id: '',
    qbo_item_name: '',
    default_vendor_id: '',
    default_vendor_name: '',
    requires_load_number: expenseType === 'reefer_diesel' ? 'required' : 'optional',
    requires_reefer_number: expenseType === 'reefer_diesel',
    requires_receipt: true,
    requires_odometer: expenseType === 'truck_diesel' || expenseType === 'reefer_diesel' || expenseType === 'def',
    auto_post_qbo: true,
  }
}

function toAccount(a: any): QboAccount | null {
  const id = String(a?.Id || a?.id || '').trim()
  const name = String(a?.Name || a?.name || '').trim()
  const accountType = String(a?.AccountType || a?.accountType || '').trim()
  const active = a?.Active !== false
  if (!id || !name) return null
  return { id, name, accountType, active }
}

function toItem(i: any): QboItem | null {
  const id = String(i?.Id || i?.id || '').trim()
  const name = String(i?.Name || i?.name || '').trim()
  const itemType = String(i?.Type || i?.type || '').trim()
  const active = i?.Active !== false
  if (!id || !name) return null
  return { id, name, itemType, active }
}

function toVendor(v: any): QboVendor | null {
  const id = String(v?.Id || v?.id || '').trim()
  const name = String(v?.DisplayName || v?.display_name || v?.Name || v?.name || '').trim()
  const active = v?.Active !== false
  if (!id || !name) return null
  return { id, name, active }
}

export function DriverExpenseMappingPage() {
  const [expenseTypes, setExpenseTypes] = useState<ExpenseTypeDef[]>(BASE_EXPENSE_TYPES)
  const [activeType, setActiveType] = useState<string>(BASE_EXPENSE_TYPES[0].id)
  const [rows, setRows] = useState<Record<string, MappingRow>>({})

  const [accounts, setAccounts] = useState<QboAccount[]>([])
  const [items, setItems] = useState<QboItem[]>([])
  const [vendors, setVendors] = useState<QboVendor[]>([])

  const [accountSearch, setAccountSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [vendorSearch, setVendorSearch] = useState('')

  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customName, setCustomName] = useState('')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const [masterRes, mappingRes] = await Promise.all([
        fetch('/api/qbo/master', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({})),
        fetch('/api/fuel/expense-mapping', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ mappings: [] })),
      ])
      if (cancelled) return

      const rawAccounts = Array.isArray((masterRes as any)?.accountsExpense)
        ? (masterRes as any).accountsExpense
        : Array.isArray((masterRes as any)?.accounts)
          ? (masterRes as any).accounts
          : []
      const rawItems = Array.isArray((masterRes as any)?.items) ? (masterRes as any).items : []
      const rawVendors = Array.isArray((masterRes as any)?.vendors) ? (masterRes as any).vendors : []

      const normalizedAccounts = rawAccounts
        .map((a: any) => toAccount(a))
        .filter((a: QboAccount | null): a is QboAccount => Boolean(a))
        .filter((a: QboAccount) => {
          const t = a.accountType.toLowerCase()
          return t === 'expense' || t === 'cost of goods sold'
        })
      const normalizedItems = rawItems
        .map((i: any) => toItem(i))
        .filter((i: QboItem | null): i is QboItem => Boolean(i))
      const normalizedVendors = rawVendors
        .map((v: any) => toVendor(v))
        .filter((v: QboVendor | null): v is QboVendor => Boolean(v))

      setAccounts(normalizedAccounts)
      setItems(normalizedItems)
      setVendors(normalizedVendors)

      const baseRows: Record<string, MappingRow> = {}
      BASE_EXPENSE_TYPES.forEach((t) => {
        baseRows[t.id] = defaultRow(t.id)
      })

      const dbMappings = Array.isArray((mappingRes as any)?.mappings) ? (mappingRes as any).mappings : []
      const extraTypes: ExpenseTypeDef[] = []
      dbMappings.forEach((m: any) => {
        const id = String(m?.expense_type || '').trim()
        if (!id) return
        if (!BASE_EXPENSE_TYPES.some((t) => t.id === id)) {
          extraTypes.push({ id, icon: '➕', label: String(m?.expense_type_label || id).replace(/_/g, ' ') })
        }
        baseRows[id] = {
          expense_type: id,
          qbo_account_id: String(m?.qbo_account_id || '').trim(),
          qbo_account_name: String(m?.qbo_account_name || '').trim(),
          qbo_item_id: String(m?.qbo_item_id || '').trim(),
          qbo_item_name: String(m?.qbo_item_name || '').trim(),
          default_vendor_id: String(m?.default_vendor_id || '').trim(),
          default_vendor_name: String(m?.default_vendor_name || '').trim(),
          requires_load_number: normalizeLoadMode(m?.requires_load_number),
          requires_reefer_number: Boolean(m?.requires_reefer_number),
          requires_receipt: Boolean(m?.requires_receipt),
          requires_odometer: Boolean(m?.requires_odometer),
          auto_post_qbo: Boolean(m?.auto_post_qbo),
        }
      })

      setRows(baseRows)
      if (extraTypes.length) setExpenseTypes((prev) => [...prev, ...extraTypes])
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const activeExpense = useMemo(
    () => expenseTypes.find((t) => t.id === activeType) || expenseTypes[0],
    [expenseTypes, activeType],
  )
  const activeRow = rows[activeType] || defaultRow(activeType)

  const mappedCount = useMemo(
    () => expenseTypes.filter((t) => Boolean(rows[t.id]?.qbo_account_id)).length,
    [expenseTypes, rows],
  )
  const completionPercent = expenseTypes.length ? Math.round((mappedCount / expenseTypes.length) * 100) : 0

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter((a) => `${a.name} ${a.accountType}`.toLowerCase().includes(q))
  }, [accounts, accountSearch])

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => `${i.name} ${i.itemType}`.toLowerCase().includes(q))
  }, [items, itemSearch])

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter((v) => v.name.toLowerCase().includes(q))
  }, [vendors, vendorSearch])

  const patchActive = (patch: Partial<MappingRow>) => {
    setRows((prev) => ({
      ...prev,
      [activeType]: {
        ...(prev[activeType] || defaultRow(activeType)),
        ...patch,
      },
    }))
    setSavedMsg('')
  }

  const saveCurrent = async () => {
    const row = rows[activeType] || defaultRow(activeType)
    if (!row.qbo_account_id) {
      setSavedMsg('Select a QBO expense account first.')
      return
    }
    setSaving(true)
    setSavedMsg('')
    try {
      const payload = {
        expense_type: activeType,
        qbo_account_id: row.qbo_account_id || '',
        qbo_account_name: row.qbo_account_name || '',
        qbo_item_id: row.qbo_item_id || '',
        qbo_item_name: row.qbo_item_name || '',
        default_vendor_id: row.default_vendor_id || '',
        default_vendor_name: row.default_vendor_name || '',
        requires_load_number: row.requires_load_number || 'optional',
        requires_reefer_number: Boolean(row.requires_reefer_number),
        requires_receipt: Boolean(row.requires_receipt),
        requires_odometer: Boolean(row.requires_odometer),
        auto_post_qbo: Boolean(row.auto_post_qbo),
      }
      const resp = await fetch('/api/fuel/expense-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json())
      setSavedMsg(resp?.ok ? '✅ Saved' : String(resp?.error || 'Save failed'))
    } catch (e: any) {
      setSavedMsg(String(e?.message || e || 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const addCustomExpense = async () => {
    const name = customName.trim()
    const id = normalizeId(name)
    if (!name || !id) return
    if (expenseTypes.some((t) => t.id === id)) {
      setStatusMsg('Custom expense already exists.')
      return
    }
    const next: ExpenseTypeDef = { id, icon: '➕', label: name }
    setExpenseTypes((prev) => [...prev, next])
    setRows((prev) => ({ ...prev, [id]: defaultRow(id) }))
    setActiveType(id)
    setCustomName('')
    setShowAddCustom(false)
    setStatusMsg('Custom expense type added. Configure and save mapping.')
  }

  const testQbo = async () => {
    setStatusMsg('Checking QBO connection...')
    try {
      const resp = await fetch('/api/qbo/status', { headers: { Accept: 'application/json' } }).then((r) => r.json())
      if (resp?.connected) setStatusMsg('QBO connection: connected')
      else if (resp?.configured) setStatusMsg('QBO connection: configured but disconnected')
      else setStatusMsg('QBO connection: not configured')
    } catch {
      setStatusMsg('QBO connection check failed')
    }
  }

  return (
    <div className="acct-hub" style={{ height: '100%', minHeight: 560, gap: 10 }}>
      <div
        className="panel"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 520,
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
          }}
        >
          <aside
            style={{
              width: '35%',
              minWidth: 280,
              borderRight: '1px solid var(--border)',
              overflowY: 'auto',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <h3 style={{ margin: 0 }}>Driver App Expense Types</h3>
            {expenseTypes.map((t) => {
              const mapped = Boolean(rows[t.id]?.qbo_account_id)
              return (
                <button
                  key={t.id}
                  type="button"
                  className="btn ghost"
                  onClick={() => setActiveType(t.id)}
                  style={{
                    justifyContent: 'space-between',
                    display: 'flex',
                    alignItems: 'center',
                    background: activeType === t.id ? 'rgba(11,102,214,0.1)' : 'transparent',
                    borderColor: activeType === t.id ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <span>{t.icon} {t.label}</span>
                  <span
                    className="chip"
                    style={{
                      background: mapped ? 'rgba(34,197,94,0.16)' : 'rgba(250,204,21,0.16)',
                      color: mapped ? '#16a34a' : '#ca8a04',
                    }}
                  >
                    {mapped ? 'Mapped' : 'Not mapped'}
                  </span>
                </button>
              )
            })}

            <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <button type="button" className="btn sm" onClick={() => setShowAddCustom((s) => !s)}>
                + Add custom expense type
              </button>
              {showAddCustom ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Custom expense name"
                  />
                  <button type="button" className="btn sm ghost" onClick={() => void addCustomExpense()}>
                    Save type
                  </button>
                </div>
              ) : null}
            </div>
          </aside>

          <section
            style={{
              width: '65%',
              overflowY: 'auto',
              padding: 20,
              display: 'grid',
              gap: 12,
            }}
          >
            <h3 style={{ margin: 0 }}>{activeExpense?.icon || '🔧'} {activeExpense?.label || activeType}</h3>

            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                <label>QBO Expense Account (required)</label>
                <input
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search accounts..."
                />
                <select
                  size={8}
                  value={String(activeRow.qbo_account_id || '')}
                  onChange={(e) => {
                    const picked = accounts.find((a) => a.id === e.target.value)
                    patchActive({
                      qbo_account_id: e.target.value,
                      qbo_account_name: picked?.name || '',
                    })
                  }}
                >
                  {filteredAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name + ' (' + (a.accountType || 'Expense') + ')'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                <label>QBO Item/Product (optional)</label>
                <input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items..." />
                <select
                  size={7}
                  value={String(activeRow.qbo_item_id || '')}
                  onChange={(e) => {
                    const picked = items.find((i) => i.id === e.target.value)
                    patchActive({
                      qbo_item_id: e.target.value,
                      qbo_item_name: picked?.name || '',
                    })
                  }}
                >
                  {filteredItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.name + (i.itemType ? ` (${i.itemType})` : '')}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                <label>Default Vendor (optional)</label>
                <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Search vendors..." />
                <select
                  size={7}
                  value={String(activeRow.default_vendor_id || '')}
                  onChange={(e) => {
                    const picked = vendors.find((v) => v.id === e.target.value)
                    patchActive({
                      default_vendor_id: e.target.value,
                      default_vendor_name: picked?.name || '',
                    })
                  }}
                >
                  {filteredVendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
                <strong>Required fields</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={activeRow.requires_load_number === 'required'}
                    onChange={(e) => patchActive({ requires_load_number: e.target.checked ? 'required' : 'optional' })}
                    style={{ width: 18, height: 18 }}
                  />
                  Load number required
                </label>

                {activeType === 'reefer_diesel' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(activeRow.requires_reefer_number)}
                      onChange={(e) => patchActive({ requires_reefer_number: e.target.checked })}
                      style={{ width: 18, height: 18 }}
                    />
                    Reefer unit number required
                  </label>
                ) : null}

                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeRow.requires_receipt)}
                    onChange={(e) => patchActive({ requires_receipt: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  Receipt photo required
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeRow.auto_post_qbo)}
                    onChange={(e) => patchActive({ auto_post_qbo: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  Auto-post to QuickBooks
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => void saveCurrent()} disabled={saving}>
                {saving ? 'Saving...' : 'Save mapping'}
              </button>
              {savedMsg ? <span className="muted">{savedMsg}</span> : null}
            </div>
          </section>
        </div>

        <footer style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong>{mappedCount} of {expenseTypes.length} expense types mapped to QuickBooks</strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn sm ghost" onClick={() => void testQbo()}>Test QBO connection</button>
              <button type="button" className="btn sm ghost" onClick={() => { window.location.href = '/maintenance.html#drivers-fuel' }}>View all driver expenses</button>
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'rgba(148,163,184,0.22)', overflow: 'hidden' }}>
            <div style={{ width: `${completionPercent}%`, height: '100%', background: '#2563eb' }} />
          </div>
          {statusMsg ? <span className="muted">{statusMsg}</span> : null}
        </footer>
      </div>
    </div>
  )
}
