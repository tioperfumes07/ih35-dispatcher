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
  isSaved: boolean
  isEditing: boolean
  savedMode: RowMode
  savedValue: string
}

type CustomMappedRow = {
  id: string
  name: string
  mode: RowMode
  value: string
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
  isSaved: false,
  isEditing: true,
  savedMode: 'account',
  savedValue: '',
})

export function FuelSettingsPage() {
  const [accounts, setAccounts] = useState<QboAccount[]>([])
  const [items, setItems] = useState<QboItem[]>([])
  const [rows, setRows] = useState<Record<FuelType, RowState>>({
    truck_diesel: emptyRowState(),
    reefer_diesel: emptyRowState(),
    def: emptyRowState(),
  })

  const [customTypeName, setCustomTypeName] = useState('')
  const [customMode, setCustomMode] = useState<RowMode>('account')
  const [customValue, setCustomValue] = useState('')
  const [customSaving, setCustomSaving] = useState(false)
  const [customRows, setCustomRows] = useState<CustomMappedRow[]>([])

  const accountByName = useMemo(() => new Map(accounts.map((a) => [a.name, a])), [accounts])
  const itemByName = useMemo(() => new Map(items.map((i) => [i.name, i])), [items])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const [masterRes, settingsRes, mappingsRes] = await Promise.all([
        fetch('/api/qbo/master', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({})),
        fetch('/api/fuel/settings', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ settings: [] })),
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
            next[fuelType] = {
              ...next[fuelType],
              mode: 'account',
              value: accountName,
              status: '',
              isSaved: true,
              isEditing: false,
              savedMode: 'account',
              savedValue: accountName,
            }
          } else if (itemName) {
            next[fuelType] = {
              ...next[fuelType],
              mode: 'item',
              value: itemName,
              status: '',
              isSaved: true,
              isEditing: false,
              savedMode: 'item',
              savedValue: itemName,
            }
          } else {
            next[fuelType] = { ...next[fuelType], isSaved: false, isEditing: true, savedValue: '' }
          }
        })
        return next
      })

      const mappingRows = Array.isArray((mappingsRes as any)?.mappings) ? (mappingsRes as any).mappings : []
      const custom = mappingRows
        .filter((m: any) => !FUEL_ROWS.some((r) => r.fuelType === String(m?.expense_type || '')))
        .map((m: any) => {
          const accountName = String(m?.qbo_account_name || '').trim()
          const itemName = String(m?.qbo_item_name || '').trim()
          return {
            id: String(m?.expense_type || '').trim(),
            name: String(m?.expense_type || '').trim(),
            mode: itemName ? 'item' : 'account',
            value: itemName || accountName,
          } as CustomMappedRow
        })
        .filter((c: CustomMappedRow) => Boolean(c.id && c.value))
      setCustomRows(custom)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const mappedCount = useMemo(() => FUEL_ROWS.filter((r) => rows[r.fuelType]?.isSaved).length, [rows])
  const allMapped = mappedCount === FUEL_ROWS.length

  const setRowMode = (fuelType: FuelType, mode: RowMode) => {
    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], mode, status: '', isEditing: true },
    }))
  }

  const setRowValue = (fuelType: FuelType, value: string) => {
    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], value, status: '', isEditing: true },
    }))
  }

  const setRowEditing = (fuelType: FuelType, editing: boolean) => {
    setRows((prev) => ({
      ...prev,
      [fuelType]: { ...prev[fuelType], isEditing: editing },
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
          [fuelType]: {
            ...prev[fuelType],
            saving: false,
            status: 'saved',
            isSaved: true,
            isEditing: false,
            savedMode: prev[fuelType].mode,
            savedValue: value,
          },
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

  const addCustomExpenseType = async () => {
    const name = String(customTypeName || '').trim()
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    const value = String(customValue || '').trim()
    if (!name || !id || !value) {
      showToast('❌ Error saving mapping', 'error')
      return
    }

    setCustomSaving(true)
    try {
      let payload: any
      if (customMode === 'account') {
        const found = accountByName.get(value) || accounts.find((a) => a.qboId === value) || null
        payload = {
          expense_type: id,
          qbo_account_id: found?.qboId || '',
          qbo_account_name: value,
          qbo_item_id: '',
          qbo_item_name: '',
          default_vendor_id: '',
          default_vendor_name: '',
          requires_load_number: 'optional',
          requires_reefer_number: false,
          requires_receipt: false,
          requires_odometer: false,
          auto_post_qbo: false,
        }
      } else {
        const found = itemByName.get(value) || items.find((i) => i.qboId === value) || null
        payload = {
          expense_type: id,
          qbo_account_id: '',
          qbo_account_name: '',
          qbo_item_id: found?.qboId || '',
          qbo_item_name: value,
          default_vendor_id: '',
          default_vendor_name: '',
          requires_load_number: 'optional',
          requires_reefer_number: false,
          requires_receipt: false,
          requires_odometer: false,
          auto_post_qbo: false,
        }
      }

      const resp = await fetch('/api/fuel/expense-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json())

      if (resp?.ok) {
        setCustomRows((prev) => [...prev, { id, name, mode: customMode, value }])
        setCustomTypeName('')
        setCustomValue('')
        setCustomMode('account')
        showToast('✅ Expense mapping saved', 'success')
      } else {
        showToast('❌ Error saving mapping', 'error')
      }
    } catch {
      showToast('❌ Error saving mapping', 'error')
    } finally {
      setCustomSaving(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '780px' }}>
      <h2 style={{ color: '#e2e8f0', marginBottom: '4px' }}>Fuel settings</h2>
      <p style={{ color: '#8892a4', fontSize: '13px', marginBottom: '12px' }}>
        Map driver fuel types to QuickBooks accounts/items for auto-posting.
      </p>

      <div
        style={{
          marginBottom: '20px',
          padding: '8px 12px',
          borderRadius: '6px',
          border: `1px solid ${allMapped ? '#22c55e' : '#f59e0b'}`,
          background: allMapped ? '#052e16' : '#3f2b08',
          color: allMapped ? '#86efac' : '#fcd34d',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {mappedCount} of {FUEL_ROWS.length} fuel types mapped {allMapped ? '✅' : '⚠️'}
      </div>

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

            {row.isSaved && !row.isEditing ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: '#052e16',
                  border: '1px solid #22c55e',
                  borderRadius: '6px',
                }}
              >
                <span style={{ color: '#86efac', fontSize: '13px' }}>
                  ✅ Mapped to QBO {row.savedMode === 'item' ? 'Item/Product' : 'Expense Account'}: {row.savedValue}
                </span>
                <button
                  type="button"
                  onClick={() => setRowEditing(fuelType, true)}
                  style={{
                    padding: '4px 12px',
                    background: 'transparent',
                    color: '#8892a4',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <>
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
                  {row.status === 'saved' ? (
                    <span style={{ color: '#22c55e', fontSize: '13px' }}>✅ Saved</span>
                  ) : null}
                  {row.status === 'error' ? (
                    <span style={{ color: '#ef4444', fontSize: '13px' }}>❌ Error</span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )
      })}

      <div style={{ marginTop: '6px' }}>
        <h3 style={{ color: '#e2e8f0', fontSize: '14px', marginBottom: '10px' }}>+ Add expense type</h3>

        <label style={{ fontSize: '12px', color: '#8892a4' }}>
          Expense type name
          <input
            type="text"
            value={customTypeName}
            onChange={(e) => setCustomTypeName(e.target.value)}
            placeholder="e.g. parking_fees"
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'flex', gap: '12px', marginTop: '10px', marginBottom: '8px' }}>
          <label style={{ fontSize: '12px', color: '#8892a4', cursor: 'pointer' }}>
            <input
              type="radio"
              name="custom_mode"
              value="account"
              checked={customMode === 'account'}
              onChange={() => setCustomMode('account')}
              style={{ marginRight: '4px' }}
            />
            Expense Account
          </label>
          <label style={{ fontSize: '12px', color: '#8892a4', cursor: 'pointer' }}>
            <input
              type="radio"
              name="custom_mode"
              value="item"
              checked={customMode === 'item'}
              onChange={() => setCustomMode('item')}
              style={{ marginRight: '4px' }}
            />
            Item/Product
          </label>
        </div>

        {customMode === 'account' ? (
          <label style={{ fontSize: '12px', color: '#8892a4' }}>
            QBO Expense Account
            <input
              type="text"
              list="custom_acct"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="Type to search QBO accounts..."
              style={inputStyle}
            />
            <datalist id="custom_acct">
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
              list="custom_item"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="Type to search QBO items..."
              style={inputStyle}
            />
            <datalist id="custom_item">
              {items.map((i) => (
                <option key={i.qboId} value={i.name} />
              ))}
            </datalist>
          </label>
        )}

        <div style={{ marginTop: '12px' }}>
          <button
            type="button"
            onClick={() => void addCustomExpenseType()}
            disabled={customSaving}
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
          >
            {customSaving ? 'Adding...' : 'Add'}
          </button>
        </div>

        {customRows.length ? (
          <div style={{ marginTop: '14px', display: 'grid', gap: '8px' }}>
            {customRows.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  background: '#052e16',
                  border: '1px solid #22c55e',
                  borderRadius: '6px',
                }}
              >
                <span style={{ color: '#86efac', fontSize: '13px' }}>
                  ✅ {c.name} mapped to QBO {c.mode === 'item' ? 'Item/Product' : 'Expense Account'}: {c.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
