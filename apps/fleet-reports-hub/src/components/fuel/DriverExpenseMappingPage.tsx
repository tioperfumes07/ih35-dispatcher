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
}

type QboItem = {
  id: string
  name: string
  itemType: string
}

type QboVendor = {
  id: string
  name: string
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

const EXPENSE_TYPES: ExpenseTypeDef[] = [
  { id: 'truck_diesel', icon: '⛽', label: 'Truck Diesel' },
  { id: 'reefer_diesel', icon: '❄️', label: 'Reefer Diesel' },
  { id: 'def', icon: '🟦', label: 'DEF' },
  { id: 'maintenance_expense', icon: '🔧', label: 'Maintenance expense' },
  { id: 'tire_expense', icon: '🛞', label: 'Tire expense' },
  { id: 'parts_supplies', icon: '🔩', label: 'Parts & supplies' },
  { id: 'tolls', icon: '🛣️', label: 'Tolls' },
  { id: 'parking', icon: '🅿️', label: 'Parking' },
  { id: 'meals_per_diem', icon: '🍽️', label: 'Meals (per diem)' },
  { id: 'lumper_fees', icon: '📦', label: 'Lumper fees' },
  { id: 'hotel_lodging', icon: '🏨', label: 'Hotel / lodging' },
  { id: 'other_expense', icon: '🔄', label: 'Other expense' },
]

const LOAD_MODE_OPTIONS: Array<{ value: MappingMode; label: string }> = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'not_needed', label: 'Not needed' },
]

function rowForExpense(expenseType: string): MappingRow {
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

function toId(v: unknown): string {
  return String(v ?? '').trim()
}

function toName(v: unknown): string {
  return String(v ?? '').trim()
}

export function DriverExpenseMappingPage() {
  const [activeType, setActiveType] = useState<string>(EXPENSE_TYPES[0].id)
  const [accounts, setAccounts] = useState<QboAccount[]>([])
  const [items, setItems] = useState<QboItem[]>([])
  const [vendors, setVendors] = useState<QboVendor[]>([])
  const [rows, setRows] = useState<Record<string, MappingRow>>({})
  const [saving, setSaving] = useState(false)
  const [savedLabel, setSavedLabel] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [masterRes, mappingRes] = await Promise.all([
        fetch('/api/qbo/master', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ ok: false })),
        fetch('/api/fuel/expense-mapping', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ ok: false, mappings: [] })),
      ])
      if (cancelled) return

      const master = masterRes && typeof masterRes === 'object' ? masterRes : {}
      const rawAccounts = Array.isArray((master as any).accounts) ? (master as any).accounts : []
      const rawItems = Array.isArray((master as any).items) ? (master as any).items : []
      const rawVendors = Array.isArray((master as any).vendors) ? (master as any).vendors : []

      const normalizedAccounts = rawAccounts
        .map((a: any) => ({
          id: toId(a.id || a.Id),
          name: toName(a.name || a.Name),
          accountType: toName(a.AccountType || a.accountType || a.Classification),
        }))
        .filter((a: QboAccount) => {
          const t = a.accountType.toLowerCase()
          return a.id && a.name && (t === 'expense' || t === 'cost of goods sold')
        })
      const normalizedItems = rawItems
        .map((i: any) => ({
          id: toId(i.id || i.Id),
          name: toName(i.name || i.Name),
          itemType: toName(i.Type || i.type),
        }))
        .filter((i: QboItem) => i.id && i.name)
      const normalizedVendors = rawVendors
        .map((v: any) => ({
          id: toId(v.id || v.Id),
          name: toName(v.display_name || v.DisplayName || v.name || v.Name),
        }))
        .filter((v: QboVendor) => v.id && v.name)

      setAccounts(normalizedAccounts)
      setItems(normalizedItems)
      setVendors(normalizedVendors)

      const baseRows: Record<string, MappingRow> = {}
      EXPENSE_TYPES.forEach((t) => {
        baseRows[t.id] = rowForExpense(t.id)
      })

      const dbRows = Array.isArray((mappingRes as any)?.mappings) ? (mappingRes as any).mappings : []
      dbRows.forEach((m: any) => {
        const key = String(m.expense_type || '').trim()
        if (!key || !baseRows[key]) return
        const loadModeRaw = String(m.requires_load_number ?? '').trim().toLowerCase()
        const loadMode: MappingMode =
          loadModeRaw === 'required' || loadModeRaw === 'not_needed' ? (loadModeRaw as MappingMode) : 'optional'
        baseRows[key] = {
          expense_type: key,
          qbo_account_id: toId(m.qbo_account_id),
          qbo_account_name: toName(m.qbo_account_name),
          qbo_item_id: toId(m.qbo_item_id),
          qbo_item_name: toName(m.qbo_item_name),
          default_vendor_id: toId(m.default_vendor_id),
          default_vendor_name: toName(m.default_vendor_name),
          requires_load_number: loadMode,
          requires_reefer_number: Boolean(m.requires_reefer_number),
          requires_receipt: Boolean(m.requires_receipt),
          requires_odometer: Boolean(m.requires_odometer),
          auto_post_qbo: Boolean(m.auto_post_qbo),
        }
      })
      setRows(baseRows)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const activeRow = rows[activeType] || rowForExpense(activeType)

  const mappedCount = useMemo(
    () => EXPENSE_TYPES.filter((t) => Boolean(rows[t.id]?.qbo_account_id)).length,
    [rows],
  )

  const setRow = (patch: Partial<MappingRow>) => {
    setRows((prev) => ({
      ...prev,
      [activeType]: {
        ...(prev[activeType] || rowForExpense(activeType)),
        ...patch,
      },
    }))
    setSavedLabel('')
  }

  const saveMapping = async () => {
    const selected = rows[activeType] || rowForExpense(activeType)
    if (!selected.qbo_account_id) {
      setSavedLabel('Pick an expense account first.')
      return
    }
    setSaving(true)
    setSavedLabel('')
    try {
      const payload = {
        expense_type: activeType,
        qbo_account_id: selected.qbo_account_id || '',
        qbo_account_name: selected.qbo_account_name || '',
        qbo_item_id: selected.qbo_item_id || '',
        qbo_item_name: selected.qbo_item_name || '',
        default_vendor_id: selected.default_vendor_id || '',
        default_vendor_name: selected.default_vendor_name || '',
        requires_load_number: selected.requires_load_number || 'optional',
        requires_reefer_number: Boolean(selected.requires_reefer_number),
        requires_receipt: Boolean(selected.requires_receipt),
        requires_odometer: Boolean(selected.requires_odometer),
        auto_post_qbo: Boolean(selected.auto_post_qbo),
      }
      const resp = await fetch('/api/fuel/expense-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json())
      if (resp?.ok) setSavedLabel('✅ Saved')
      else setSavedLabel(String(resp?.error || 'Save failed'))
    } catch (e: any) {
      setSavedLabel(String(e?.message || e || 'Save failed'))
    } finally {
      setSaving(false)
    }
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
    <div className="acct-hub" style={{ gap: 10 }}>
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>Driver App Expenses</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ margin: 0 }}>
            Configure once, then driver app expense submissions follow this QuickBooks mapping.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 40%) minmax(420px, 60%)', gap: 10 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title" style={{ margin: 0 }}>Driver App Expenses</div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 6 }}>
            {EXPENSE_TYPES.map((t) => {
              const row = rows[t.id] || rowForExpense(t.id)
              const mapped = Boolean(row.qbo_account_id)
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
                    borderColor: activeType === t.id ? 'var(--accent)' : 'var(--border)',
                    background: activeType === t.id ? 'rgba(11, 102, 214, 0.1)' : undefined,
                  }}
                >
                  <span>{t.icon} {t.label}</span>
                  {mapped ? (
                    <span className="chip" style={{ background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' }}>
                      {row.qbo_account_name || 'Mapped'}
                    </span>
                  ) : (
                    <span className="chip" style={{ background: 'rgba(250, 204, 21, 0.14)', color: '#eab308' }}>
                      Not mapped
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title" style={{ margin: 0 }}>
              {(EXPENSE_TYPES.find((t) => t.id === activeType)?.label || 'Expense type') + ' → QuickBooks'}
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            <label>
              Expense account
              <select
                value={String(activeRow.qbo_account_id || '')}
                onChange={(e) => {
                  const picked = accounts.find((a) => a.id === e.target.value)
                  setRow({
                    qbo_account_id: e.target.value,
                    qbo_account_name: picked?.name || '',
                  })
                }}
              >
                <option value="">Select expense account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name + ' (' + (a.accountType || 'Expense') + ')'}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Item / product (optional)
              <select
                value={String(activeRow.qbo_item_id || '')}
                onChange={(e) => {
                  const picked = items.find((i) => i.id === e.target.value)
                  setRow({
                    qbo_item_id: e.target.value,
                    qbo_item_name: picked?.name || '',
                  })
                }}
              >
                <option value="">None</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name + (i.itemType ? ' (' + i.itemType + ')' : '')}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Default vendor
              <select
                value={String(activeRow.default_vendor_id || '')}
                onChange={(e) => {
                  const picked = vendors.find((v) => v.id === e.target.value)
                  setRow({
                    default_vendor_id: e.target.value,
                    default_vendor_name: picked?.name || '',
                  })
                }}
              >
                <option value="">None</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="panel" style={{ margin: 0 }}>
              <div className="panel-head">
                <div className="panel-title" style={{ margin: 0 }}>Requires fields</div>
              </div>
              <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                <label>
                  Load number
                  <select
                    value={String(activeRow.requires_load_number || 'optional')}
                    onChange={(e) => setRow({ requires_load_number: e.target.value as MappingMode })}
                  >
                    {LOAD_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {activeType === 'reefer_diesel' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(activeRow.requires_reefer_number)}
                      onChange={(e) => setRow({ requires_reefer_number: e.target.checked })}
                      style={{ width: 18, height: 18 }}
                    />
                    Reefer unit number required
                  </label>
                ) : null}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeRow.requires_receipt)}
                    onChange={(e) => setRow({ requires_receipt: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  Receipt photo required
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(activeRow.requires_odometer)}
                    onChange={(e) => setRow({ requires_odometer: e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  Odometer reading required
                </label>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(activeRow.auto_post_qbo)}
                onChange={(e) => setRow({ auto_post_qbo: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              Auto-post to QBO
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => void saveMapping()} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              {savedLabel ? <span className="muted">{savedLabel}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <strong>{mappedCount + ' of ' + EXPENSE_TYPES.length + ' expense types mapped'}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost" onClick={() => void testQbo()}>
              Test QBO connection
            </button>
            <button type="button" className="btn ghost" onClick={() => { window.location.href = '/maintenance.html#drivers-fuel' }}>
              View all driver expenses
            </button>
          </div>
        </div>
        {statusMsg ? <p className="muted" style={{ margin: '0 12px 12px' }}>{statusMsg}</p> : null}
      </div>
    </div>
  )
}
