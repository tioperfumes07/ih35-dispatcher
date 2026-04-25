import { useEffect, useMemo, useState } from 'react'

type ChecklistItem = {
  id?: number
  item_name: string
  quantity?: number
  category?: string
  unit_number?: string
  status?: string
}

type SubmissionRow = {
  id: number
  unit_number: string
  driver_name: string
  submitted_at: string
  items: Array<{ item_id?: number; status?: string; photo_base64?: string }> | string
  all_confirmed: boolean
}

const DEFAULT_UNITS = Array.from({ length: 58 }, (_, i) => `T${120 + i}`)

export function EquipmentPage() {
  const [unit, setUnit] = useState('T120')
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [itemName, setItemName] = useState('')
  const [itemQty, setItemQty] = useState('1')
  const [message, setMessage] = useState('')

  const loadChecklist = async (u: string) => {
    const r = await fetch(`/api/equipment/checklist?unit=${encodeURIComponent(u)}`)
    const d = await r.json().catch(() => ({}))
    setChecklist(Array.isArray(d.items) ? d.items : [])
  }

  const loadSubmissions = async () => {
    const r = await fetch('/api/equipment/submissions')
    const d = await r.json().catch(() => ({}))
    setSubmissions(Array.isArray(d.submissions) ? d.submissions : [])
  }

  useEffect(() => {
    void loadChecklist(unit)
  }, [unit])

  useEffect(() => {
    void loadSubmissions()
  }, [])

  const missingAlerts = useMemo(() => {
    return submissions.filter((s) => {
      const rows = Array.isArray(s.items) ? s.items : []
      return rows.some((i) => String(i.status || '').toLowerCase() === 'missing')
    })
  }, [submissions])

  const addAssignment = () => {
    if (!itemName.trim()) return
    setChecklist((prev) => [
      ...prev,
      { item_name: itemName.trim(), quantity: Number(itemQty || 1), unit_number: unit, category: 'manual', status: 'active' },
    ])
    setItemName('')
    setItemQty('1')
    setMessage('Added to local draft list for this unit.')
  }

  return (
    <section className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Equipment Management</h2>
        <button type="button" className="btn sm ghost" onClick={() => { void loadChecklist(unit); void loadSubmissions() }}>
          Refresh
        </button>
      </header>

      <div className="card" style={{ padding: 10 }}>
        <h3 style={{ marginTop: 0 }}>Assign to unit</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 120px auto', gap: 8 }}>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {DEFAULT_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Item name" />
          <input value={itemQty} onChange={(e) => setItemQty(e.target.value)} placeholder="Qty" type="number" min={1} />
          <button type="button" className="btn sm" onClick={addAssignment}>Add</button>
        </div>
        {message ? <p className="muted" style={{ marginBottom: 0 }}>{message}</p> : null}
      </div>

      <div className="card" style={{ padding: 10 }}>
        <h3 style={{ marginTop: 0 }}>Equipment inventory ({unit})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Category</th><th>Status</th></tr>
            </thead>
            <tbody>
              {checklist.map((it, i) => (
                <tr key={`${it.item_name}-${i}`}>
                  <td>{it.item_name}</td>
                  <td>{it.quantity || 1}</td>
                  <td>{it.category || '—'}</td>
                  <td>{it.status || 'active'}</td>
                </tr>
              ))}
              {!checklist.length ? <tr><td colSpan={4} className="muted">No items for this unit.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 10 }}>
        <h3 style={{ marginTop: 0 }}>Submissions log</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Unit</th><th>Driver</th><th>Submitted</th><th>All confirmed</th></tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.unit_number}</td>
                  <td>{s.driver_name || '—'}</td>
                  <td>{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}</td>
                  <td>{s.all_confirmed ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {!submissions.length ? <tr><td colSpan={5} className="muted">No submissions yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 10 }}>
        <h3 style={{ marginTop: 0 }}>Missing items alerts</h3>
        {!missingAlerts.length ? (
          <p className="muted" style={{ margin: 0 }}>No missing-item alerts.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {missingAlerts.map((a) => (
              <li key={`miss-${a.id}`}>
                {a.unit_number} · {a.driver_name || 'Driver'} · {a.submitted_at ? new Date(a.submitted_at).toLocaleString() : 'n/a'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
