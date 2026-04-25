import { useEffect, useMemo, useState } from 'react'
import { showToast } from '../ui/Toast'

type QboAccount = { qboId: string; name: string; accountType: string }
type QboItem = { qboId: string; name: string; type: string }
type FuelType = 'truck_diesel' | 'reefer_diesel' | 'def'

type FuelSetting = {
  fuel_type: FuelType
  qbo_account_id?: string | null
  qbo_account_name?: string | null
  qbo_item_id?: string | null
  qbo_item_name?: string | null
}

const FUEL_TYPES: Array<{ key: FuelType; label: string }> = [
  { key: 'truck_diesel', label: 'Truck Diesel' },
  { key: 'reefer_diesel', label: 'Reefer Diesel' },
  { key: 'def', label: 'DEF' },
]

const sharedInputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: '#1a1f2e',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '13px',
  marginTop: '4px',
  boxSizing: 'border-box',
} as const

export function FuelSettingsPage() {
  const [accounts, setAccounts] = useState<QboAccount[]>([])
  const [items, setItems] = useState<QboItem[]>([])
  const [settings, setSettings] = useState<Record<FuelType, FuelSetting>>({
    truck_diesel: { fuel_type: 'truck_diesel' },
    reefer_diesel: { fuel_type: 'reefer_diesel' },
    def: { fuel_type: 'def' },
  })
  const [accountInputs, setAccountInputs] = useState<Record<FuelType, string>>({
    truck_diesel: '',
    reefer_diesel: '',
    def: '',
  })
  const [itemInputs, setItemInputs] = useState<Record<FuelType, string>>({
    truck_diesel: '',
    reefer_diesel: '',
    def: '',
  })
  const [saving, setSaving] = useState<Record<FuelType, boolean>>({
    truck_diesel: false,
    reefer_diesel: false,
    def: false,
  })
  const [saved, setSaved] = useState<Record<FuelType, boolean>>({
    truck_diesel: false,
    reefer_diesel: false,
    def: false,
  })

  const [customName, setCustomName] = useState('')
  const [customAccountInput, setCustomAccountInput] = useState('')
  const [customItemInput, setCustomItemInput] = useState('')
  const [customMsg, setCustomMsg] = useState('')

  const accountByName = useMemo(() => new Map(accounts.map((a) => [a.name, a])), [accounts])
  const itemByName = useMemo(() => new Map(items.map((i) => [i.name, i])), [items])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [masterRes, settingsRes] = await Promise.all([
        fetch('/api/qbo/master', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({})),
        fetch('/api/fuel/settings', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ settings: [] })),
      ])
      if (cancelled) return

      const rawAccounts = Array.isArray((masterRes as any)?.accountsExpense)
        ? (masterRes as any).accountsExpense
        : Array.isArray((masterRes as any)?.accounts)
          ? (masterRes as any).accounts
          : []
      const rawItems = Array.isArray((masterRes as any)?.items) ? (masterRes as any).items : []

      const acc = rawAccounts
        .map((a: any) => ({
          qboId: String(a?.qboId || '').trim(),
          name: String(a?.name || '').trim(),
          accountType: String(a?.accountType || '').trim(),
        }))
        .filter((a: QboAccount) => Boolean(a.qboId && a.name))
      const itm = rawItems
        .map((i: any) => ({
          qboId: String(i?.qboId || '').trim(),
          name: String(i?.name || '').trim(),
          type: String(i?.type || '').trim(),
        }))
        .filter((i: QboItem) => Boolean(i.qboId && i.name))

      setAccounts(acc)
      setItems(itm)

      const rows = Array.isArray((settingsRes as any)?.settings) ? (settingsRes as any).settings : []
      const nextInputsA: Record<FuelType, string> = {
        truck_diesel: '',
        reefer_diesel: '',
        def: '',
      }
      const nextInputsI: Record<FuelType, string> = {
        truck_diesel: '',
        reefer_diesel: '',
        def: '',
      }

      setSettings((prev) => {
        const next = { ...prev }
        rows.forEach((r: any) => {
          const k = String(r?.fuel_type || '') as FuelType
          if (!FUEL_TYPES.some((f) => f.key === k)) return
          next[k] = {
            fuel_type: k,
            qbo_account_id: String(r?.qbo_account_id || ''),
            qbo_account_name: String(r?.qbo_account_name || ''),
            qbo_item_id: String(r?.qbo_item_id || ''),
            qbo_item_name: String(r?.qbo_item_name || ''),
          }
          // show saved mapping names directly on page load
          if (next[k].qbo_account_name) nextInputsA[k] = next[k].qbo_account_name || ''
          if (next[k].qbo_item_name) nextInputsI[k] = next[k].qbo_item_name || ''
        })
        return next
      })

      setAccountInputs(nextInputsA)
      setItemInputs(nextInputsI)
      setSaved({
        truck_diesel: rows.some((r: any) => r?.fuel_type === 'truck_diesel' && r?.qbo_account_id),
        reefer_diesel: rows.some((r: any) => r?.fuel_type === 'reefer_diesel' && r?.qbo_account_id),
        def: rows.some((r: any) => r?.fuel_type === 'def' && r?.qbo_account_id),
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const allConfigured = useMemo(
    () => FUEL_TYPES.every((f) => Boolean(settings[f.key]?.qbo_account_id)),
    [settings],
  )

  const syncAccount = (key: FuelType, raw: string) => {
    setAccountInputs((prev) => ({ ...prev, [key]: raw }))
    const byName = accountByName.get(raw)
    const byId = accounts.find((a) => a.qboId === raw)
    const picked = byName || byId || null
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        qbo_account_id: picked?.qboId || '',
        qbo_account_name: picked?.name || '',
      },
    }))
    setSaved((prev) => ({ ...prev, [key]: false }))
  }

  const syncItem = (key: FuelType, raw: string) => {
    setItemInputs((prev) => ({ ...prev, [key]: raw }))
    const byName = itemByName.get(raw)
    const byId = items.find((i) => i.qboId === raw)
    const picked = byName || byId || null
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        qbo_item_id: picked?.qboId || '',
        qbo_item_name: picked?.name || '',
      },
    }))
    setSaved((prev) => ({ ...prev, [key]: false }))
  }

  const saveRow = async (key: FuelType) => {
    const row = settings[key]
    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const resp = await fetch('/api/fuel/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          fuel_type: key,
          qbo_account_id: row?.qbo_account_id || '',
          qbo_account_name: row?.qbo_account_name || '',
          qbo_item_id: row?.qbo_item_id || '',
          qbo_item_name: row?.qbo_item_name || '',
        }),
      }).then((r) => r.json())
      if (resp?.ok) {
        setSaved((prev) => ({ ...prev, [key]: true }))
        showToast('✅ Fuel mapping saved', 'success')
      } else {
        showToast('❌ Error saving fuel mapping', 'error')
      }
    } catch {
      showToast('❌ Error saving fuel mapping', 'error')
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  const addCustomExpenseType = async () => {
    const customType = String(customName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!customType) {
      setCustomMsg('Enter a custom expense type name.')
      return
    }
    const account = accountByName.get(customAccountInput) || accounts.find((a) => a.qboId === customAccountInput)
    if (!account) {
      setCustomMsg('Pick a QBO account for the custom type.')
      return
    }
    const item = itemByName.get(customItemInput) || items.find((i) => i.qboId === customItemInput)
    const resp = await fetch('/api/fuel/expense-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        expense_type: customType,
        qbo_account_id: account.qboId,
        qbo_account_name: account.name,
        qbo_item_id: item?.qboId || '',
        qbo_item_name: item?.name || '',
        requires_load_number: 'optional',
        requires_reefer_number: false,
        requires_receipt: false,
        requires_odometer: false,
        auto_post_qbo: false,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false }))

    if (resp?.ok) {
      setCustomMsg('Custom expense type added.')
      showToast('✅ Saved successfully', 'success')
      setCustomName('')
      setCustomAccountInput('')
      setCustomItemInput('')
    } else {
      setCustomMsg(String(resp?.error || 'Unable to add custom type.'))
      showToast('❌ Error - please try again', 'error')
    }
  }

  return (
    <div className="acct-hub" style={{ gap: 12 }}>
      <datalist id="fuelSettingsItemOptions">
        {items.map((i) => (
          <option key={i.qboId} value={i.name} />
        ))}
      </datalist>

      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>
            Fuel expense - QuickBooks mapping
          </h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Set once - all driver fuel submissions will auto-post to QBO.
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            Auto-posting: <strong>{allConfigured ? 'Active' : 'Incomplete'}</strong>
          </p>
        </div>
      </div>

      {FUEL_TYPES.map((row) => {
        const fuelType = row.key
        const accountName = accountInputs[fuelType] || ''
        const val = settings[fuelType] || { fuel_type: fuelType }
        return (
          <div className="panel" key={fuelType}>
            <div className="panel-head">
              <div className="panel-title" style={{ margin: 0 }}>
                {row.label}
              </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
              <label>
                QBO Account
                <input
                  type="text"
                  list={`qboAccts_${fuelType}`}
                  placeholder="Type to search QBO accounts..."
                  value={accountName}
                  onChange={(e) => syncAccount(fuelType, e.target.value)}
                  style={sharedInputStyle}
                />
                <datalist id={`qboAccts_${fuelType}`}>
                  {accounts.map((a) => (
                    <option key={a.qboId} value={a.name} />
                  ))}
                </datalist>
              </label>

              <label>
                QBO Item (optional)
                <input
                  type="text"
                  list="fuelSettingsItemOptions"
                  value={itemInputs[fuelType] || ''}
                  onChange={(e) => syncItem(fuelType, e.target.value)}
                  placeholder="Type to search QBO items..."
                  style={sharedInputStyle}
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void saveRow(fuelType)}
                  disabled={saving[fuelType] || !val.qbo_account_id}
                >
                  {saving[fuelType] ? 'Saving...' : 'Save'}
                </button>
                {saved[fuelType] ? <span className="ok">✅ Saved</span> : null}
              </div>
            </div>
          </div>
        )
      })}

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title" style={{ margin: 0 }}>
            Add custom expense type
          </div>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
          <label>
            Expense type name
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. parking_fees"
            />
          </label>
          <label>
            QBO Account
            <input
              type="text"
              list="qboAccts_truck_diesel"
              value={customAccountInput}
              onChange={(e) => setCustomAccountInput(e.target.value)}
              placeholder="Search account..."
              style={sharedInputStyle}
            />
          </label>
          <label>
            QBO Item
            <input
              type="text"
              list="fuelSettingsItemOptions"
              value={customItemInput}
              onChange={(e) => setCustomItemInput(e.target.value)}
              placeholder="Search item..."
              style={sharedInputStyle}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn" onClick={() => void addCustomExpenseType()}>
              Add
            </button>
            {customMsg ? <span className="muted">{customMsg}</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
