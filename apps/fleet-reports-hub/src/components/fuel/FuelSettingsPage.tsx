import { useEffect, useMemo, useState } from 'react'
import { showToast } from '../ui/Toast'

type FuelType = 'truck_diesel' | 'reefer_diesel' | 'def'
type RowMode = 'account' | 'item'

type QboAccount = {
  qboId: string
  name: string
  accountType: string
}

type QboItem = {
  qboId: string
  name: string
  type: string
}

type FuelSettingRow = {
  fuel_type: FuelType
  qbo_account_id?: string | null
  qbo_account_name?: string | null
  qbo_item_id?: string | null
  qbo_item_name?: string | null
}

type RowState = {
  mode: RowMode
  value: string
  saving: boolean
  status: '' | 'saved' | 'error'
}

const FUEL_ROWS: Array<{ fuelType: FuelType; title: string }> = [
  { fuelType: 'truck_diesel', title: '⛽ Truck Diesel' },
  { fuelType: 'reefer_diesel', title: '❄️ Reefer Diesel' },
  { fuelType: 'def', title: '🟦 DEF' },
]

const inputStyle = {
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

const emptyRowState = (): RowState => ({
  mode: 'account',
  value: '',
  saving: false,
  status: '',
})

export function FuelSettingsPage() {
  const [accounts, setAccounts] = useState<QboAccount[]>([])
  const [items, setItems] = useState<QboItem[]>([])
  const [rows, setRows] = useState<Record<FuelType, RowState>>({
    truck_diesel: emptyRowState(),
    reefer_diesel: emptyRowState(),
    def: emptyRowState(),
  })

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

      const nextAccounts: QboAccount[] = rawAccounts
        .map((a: any) => ({
          qboId: String(a?.qboId || '').trim(),
          name: String(a?.name || '').trim(),
          accountType: String(a?.accountType || '').trim(),
        }))
        .filter((a: QboAccount) => Boolean(a.qboId && a.name))

      const nextItems: QboItem[] = rawItems
        .map((i: any) => ({
          qboId: String(i?.qboId || '').trim(),
          name: String(i?.name || '').trim(),
          type: String(i?.type || '').trim(),
        }))
        .filter((i: QboItem) => Boolean(i.qboId && i.name))

      setAccounts(nextAccounts)
      setItems(nextItems)

      const settingsRows: FuelSettingRow[] = Array.isArray((settingsRes as any)?.settings)
        ? (settingsRes as any).settings
        : []

      setRows((prev) => {
        const next = { ...prev }
        settingsRows.forEach((s: any) => {
          const fuelType = String(s?.fuel_type || '') as FuelType
          if (!next[fuelType]) return
          const accountName = String(s?.qbo_account_name || '').trim()
          const itemName = String(s?.qbo_item_name || '').trim()
          if (accountName) {
            next[fuelType] = { ...next[fuelType], mode: 'account', value: accountName, status: '' }
          } else if (itemName) {
            next[fuelType] = { ...next[fuelType], mode: 'item', value: itemName, status: '' }
          } else {
            next[fuelType] = { ...next[fuelType], mode: 'account', value: '', status: '' }
          }
        })
        return next
      })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const setRowMode = (fuelType: FuelType, mode: RowMode) => {
    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], mode, status: '' },
    }))
  }

  const setRowValue = (fuelType: FuelType, value: string) => {
    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], value, status: '' },
    }))
  }

  const saveRow = async (fuelType: FuelType) => {
    const row = rows[fuelType]
    const value = String(row.value || '').trim()

    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], saving: true, status: '' },
    }))

    try {
      let payload: any

      if (row.mode === 'account') {
        const found = accountByName.get(value) || accounts.find((a) => a.qboId === value) || null
        payload = {
          fuel_type: fuelType,
          qbo_account_id: found?.qboId || '',
          qbo_account_name: value,
          qbo_item_id: '',
          qbo_item_name: '',
        }
      } else {
        const found = itemByName.get(value) || items.find((i) => i.qboId === value) || null
        payload = {
          fuel_type: fuelType,
          qbo_account_id: '',
          qbo_account_name: '',
          qbo_item_id: found?.qboId || '',
          qbo_item_name: value,
        }
      }

      const resp = await fetch('/api/fuel/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json())

      if (resp?.ok) {
        setRows((prev) => ({
          ...prev,
          [fuelType]: { ...prev[fuelType], saving: false, status: 'saved' },
        }))
        showToast('✅ Fuel mapping saved', 'success')
      } else {
        setRows((prev) => ({
          ...prev,
          [fuelType]: { ...prev[fuelType], saving: false, status: 'error' },
        }))
        showToast('❌ Error saving fuel mapping', 'error')
      }
    } catch {
      setRows((prev) => ({
        ...prev,
        [fuelType]: { ...prev[fuelType], saving: false, status: 'error' },
      }))
      showToast('❌ Error saving fuel mapping', 'error')
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px' }}>
      <h2 style={{ color: '#e2e8f0', marginBottom: '4px' }}>Fuel settings</h2>
      <p style={{ color: '#8892a4', fontSize: '13px', marginBottom: '24px' }}>
        Map driver fuel types to QuickBooks accounts/items for auto-posting.
      </p>

      {FUEL_ROWS.map((rowDef) => {
        const fuelType = rowDef.fuelType
        const row = rows[fuelType]
        return (
          <div
            key={fuelType}
            style={{
              marginBottom: '24px',
              paddingBottom: '24px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '15px', color: '#e2e8f0', marginBottom: '12px' }}>
              {rowDef.title}
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', color: '#8892a4', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`mode_${fuelType}`}
                  value="account"
                  checked={row.mode === 'account'}
                  onChange={() => setRowMode(fuelType, 'account')}
                  style={{ marginRight: '4px' }}
                />
                Expense Account
              </label>
              <label style={{ fontSize: '12px', color: '#8892a4', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`mode_${fuelType}`}
                  value="item"
                  checked={row.mode === 'item'}
                  onChange={() => setRowMode(fuelType, 'item')}
                  style={{ marginRight: '4px' }}
                />
                Item/Product
              </label>
            </div>

            {row.mode === 'account' ? (
              <label style={{ fontSize: '12px', color: '#8892a4' }}>
                QBO Expense Account
                <input
                  type="text"
                  list={`acct_${fuelType}`}
                  placeholder="Type to search QBO accounts..."
                  value={row.value}
                  onChange={(e) => setRowValue(fuelType, e.target.value)}
                  style={inputStyle}
                />
                <datalist id={`acct_${fuelType}`}>
                  {accounts.map((a) => (
                    <option key={a.qboId} value={a.name} />
                  ))}
                </datalist>
              </label>
            ) : (
              <label style={{ fontSize: '12px', color: '#8892a4' }}>
                QBO Item/Product
                <input
                  type="text"
                  list={`item_${fuelType}`}
                  placeholder="Type to search QBO items..."
                  value={row.value}
                  onChange={(e) => setRowValue(fuelType, e.target.value)}
                  style={inputStyle}
                />
                <datalist id={`item_${fuelType}`}>
                  {items.map((i) => (
                    <option key={i.qboId} value={i.name} />
                  ))}
                </datalist>
              </label>
            )}

            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => void saveRow(fuelType)}
                disabled={row.saving}
                style={{
                  padding: '8px 20px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                type="button"
              >
                {row.saving ? 'Saving...' : 'Save'}
              </button>
              {row.status === 'saved' ? <span style={{ color: '#22c55e', fontSize: '13px' }}>✅ Saved</span> : null}
              {row.status === 'error' ? <span style={{ color: '#ef4444', fontSize: '13px' }}>❌ Error</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
