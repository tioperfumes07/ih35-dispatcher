import { useEffect, useMemo, useState } from 'react'
import { fetchDriverProfiles, type DriverProfile, upsertDriverProfile } from '../../lib/fleetRegistriesApi'

type Props = {
  onViewSchedule: (unitNumber: string) => void
}

type DriverTableRow = {
  id: number
  full_name: string | null
  unit_number: string
  team: string | null
  manager: string | null
  cdl_number: string | null
  cdl_expiry: string | null
  medical_expiry: string | null
  phone: string | null
  email: string | null
  status: string
  notes: string | null
  placeholder?: boolean
  make?: string | null
  model?: string | null
}

const STATUSES: string[] = ['Active', 'On Vacation', 'Sick', 'Terminated', 'Vacante']

function daysUntil(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.floor((t - Date.now()) / 86400000)
}

function emptyDraft(): Partial<DriverTableRow> {
  return {
    full_name: '',
    unit_number: '',
    team: '',
    manager: '',
    cdl_number: '',
    cdl_expiry: '',
    medical_expiry: '',
    phone: '',
    email: '',
    status: 'Active',
    notes: '',
  }
}

function fallbackUnitsRows(): DriverTableRow[] {
  const placeholders = Array.from({length:58}, (_,i) => ({
    id: -(i+1),
    unit_number: `T${120+i}`,
    full_name: 'Vacante',
    team: '', manager: '', cdl_number: '',
    cdl_expiry: null, medical_expiry: null,
    phone: '', email: '', status: 'Vacante', notes: ''
  }))
  return placeholders.map((r) => ({ ...r, placeholder: true }))
}

async function fetchFleetUnitsRows(): Promise<DriverTableRow[]> {
  try {
    const r = await fetch('/api/fleet/assets')
    if (!r.ok) return fallbackUnitsRows()
    const data = await r.json()
    const assets = Array.isArray(data?.assets) ? data.assets : []
    const trucks = assets.filter((a: Record<string, unknown>) => /^T\d{3}$/i.test(String(a.unit_number || '')))
    if (!trucks.length) return fallbackUnitsRows()
    const byUnit = new Map<string, { make: string | null; model: string | null }>()
    trucks.forEach((a: Record<string, unknown>) => {
      const unit = String(a.unit_number || '').trim().toUpperCase()
      if (!unit) return
      byUnit.set(unit, {
        make: String(a.make || '').trim() || null,
        model: String(a.model || '').trim() || null,
      })
    })
    return fallbackUnitsRows().map((row) => {
      const meta = byUnit.get(String(row.unit_number || '').toUpperCase())
      return meta ? { ...row, make: meta.make, model: meta.model } : row
    })
  } catch {
    return fallbackUnitsRows()
  }
}

export function DriverProfilesPage({ onViewSchedule }: Props) {
  const [rows, setRows] = useState<DriverTableRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<DriverTableRow> | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDriverProfiles()
      const apiRows = Array.isArray(data.drivers) ? data.drivers : []
      if (apiRows.length) {
        setRows(
          apiRows.map((d: DriverProfile) => ({
            id: d.id,
            full_name: d.full_name,
            unit_number: d.unit_number,
            team: d.team,
            manager: d.manager,
            cdl_number: d.cdl_number,
            cdl_expiry: d.cdl_expiry,
            medical_expiry: d.medical_expiry,
            phone: d.phone,
            email: d.email,
            status: d.status,
            notes: d.notes,
            placeholder: false,
          })),
        )
      } else {
        setRows(await fetchFleetUnitsRows())
      }
    } catch (e) {
      setRows(await fetchFleetUnitsRows())
      setError(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.unit_number || ''} ${r.full_name || ''}`.toLowerCase().includes(q))
  }, [rows, search])

  const save = async () => {
    if (!draft?.unit_number) {
      setError('Unit is required')
      return
    }
    setError(null)
    try {
      await upsertDriverProfile({
        unit_number: String(draft.unit_number || '').trim(),
        full_name: String(draft.full_name || '').trim(),
        team: String(draft.team || '').trim() || null,
        manager: String(draft.manager || '').trim() || null,
        cdl_number: String(draft.cdl_number || '').trim() || null,
        cdl_expiry: String(draft.cdl_expiry || '').trim() || null,
        medical_expiry: String(draft.medical_expiry || '').trim() || null,
        phone: String(draft.phone || '').trim() || null,
        email: String(draft.email || '').trim() || null,
        status: (String(draft.status || 'Active') as DriverProfile['status']) || 'Active',
        notes: String(draft.notes || '').trim() || null,
      })
      setDraft(null)
      await load()
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }

  return (
    <section className="panel" style={{ padding: 12 }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Driver Profiles</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn sm ghost" onClick={() => void load()}>{loading ? 'Refreshing...' : 'Refresh'}</button>
          <button type="button" className="btn sm primary" onClick={() => setDraft(emptyDraft())}>Add Driver</button>
        </div>
      </header>
      <div style={{ marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or unit"
          style={{ width: 'min(360px, 100%)' }}
        />
      </div>
      {error ? <p className="nm-banner nm-banner--err">{error}</p> : null}
      <div className="table-wrap" style={{ maxHeight: '62vh' }}>
        <table>
          <thead>
            <tr>
              <th>Unit</th><th>Full Name</th><th>Team</th><th>Manager</th><th>CDL #</th><th>CDL Expiry</th><th>Medical Expiry</th><th>Phone</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const cdlDays = daysUntil(r.cdl_expiry)
              const medDays = daysUntil(r.medical_expiry)
              const critical = cdlDays < 30 || medDays < 30
              const warning = !critical && (cdlDays < 60 || medDays < 60)
              return (
                <tr
                  key={`${r.unit_number}-${r.id}`}
                  style={{
                    opacity: r.placeholder ? 0.5 : 1,
                    fontStyle: r.placeholder ? 'italic' : 'normal',
                    color: r.placeholder ? 'var(--color-text-label)' : undefined,
                    background: critical ? 'rgba(239,68,68,.12)' : warning ? 'rgba(234,179,8,.12)' : undefined,
                  }}
                >
                  <td title={r.make || r.model ? `${r.make || ''} ${r.model || ''}`.trim() : ''}>{r.unit_number || '—'}</td>
                  <td>{r.full_name || 'Vacante'}</td>
                  <td>{r.team || '—'}</td>
                  <td>{r.manager || '—'}</td>
                  <td>{r.cdl_number || '—'}</td>
                  <td>{r.cdl_expiry || '—'}</td>
                  <td>{r.medical_expiry || '—'}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{r.status || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn sm ghost" onClick={() => setDraft({ ...r })}>Edit</button>
                      <button type="button" className="btn sm" onClick={() => onViewSchedule(r.unit_number)}>Schedule</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!filtered.length ? (
              <tr><td colSpan={10} className="muted">No drivers found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="maint-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="maint-modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: 'min(720px,100%)' }}>
            <header className="modal-generic-head">
              <h3 style={{ margin: 0 }}>{draft.id ? 'Edit Driver' : 'Add Driver'}</h3>
              <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>Close</button>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
              {[
                ['full_name', 'Full Name'],
                ['unit_number', 'Unit Number'],
                ['team', 'Team'],
                ['manager', 'Manager'],
                ['cdl_number', 'CDL #'],
                ['cdl_expiry', 'CDL Expiry'],
                ['medical_expiry', 'Medical Expiry'],
                ['phone', 'Phone'],
                ['email', 'Email'],
              ].map(([key, label]) => (
                <label key={key} style={{ display: 'grid', gap: 4 }}>
                  <span className="muted">{label}</span>
                  <input
                    type={key.includes('expiry') ? 'date' : 'text'}
                    value={String((draft as Record<string, unknown>)[key] || '')}
                    onChange={(e) => setDraft((prev) => ({ ...(prev || {}), [key]: e.target.value }))}
                  />
                </label>
              ))}
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Status</span>
                <select
                  value={String(draft.status || 'Active')}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), status: e.target.value }))}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className="muted">Notes</span>
                <textarea
                  value={String(draft.notes || '')}
                  onChange={(e) => setDraft((prev) => ({ ...(prev || {}), notes: e.target.value }))}
                  rows={3}
                />
              </label>
            </div>
            <footer style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="btn sm primary" onClick={() => void save()}>Save</button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}
