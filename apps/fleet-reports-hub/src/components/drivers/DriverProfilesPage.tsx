import { useEffect, useMemo, useState } from 'react'
import { fetchDriverProfiles, type DriverProfile } from '../../lib/fleetRegistriesApi'

type Props = {
  onViewSchedule: (unitNumber: string) => void
}

type QboVendor = { id: string; name: string }

type Draft = Partial<DriverProfile> & { unit_number: string; full_name: string; status: string }

const emptyDraft = (): Draft => ({
  full_name: '',
  unit_number: '',
  status: 'active',
  phone: '',
  email: '',
  hire_date: '',
  cdl_number: '',
  cdl_state: '',
  cdl_expiry: '',
  license_number: '',
  medical_expiry: '',
  date_of_birth: '',
  emergency_contact: '',
  emergency_phone: '',
  notes: '',
  qbo_vendor_id: '',
  qbo_vendor_name: '',
  samsara_driver_id: '',
})

function daysUntil(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = Date.parse(String(iso))
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.floor((t - Date.now()) / 86400000)
}

function expiryBadge(cdl?: string | null, med?: string | null): { text: string; style: React.CSSProperties } {
  const d = Math.min(daysUntil(cdl), daysUntil(med))
  if (!Number.isFinite(d)) return { text: '⚪ not set', style: { background: '#6b7280', color: '#e5e7eb' } }
  if (d < 0 || d < 30) return { text: '🔴 urgent', style: { background: '#991b1b', color: '#fecaca' } }
  if (d < 60) return { text: '🟡 soon', style: { background: '#92400e', color: '#fde68a' } }
  return { text: '🟢 good', style: { background: '#14532d', color: '#bbf7d0' } }
}

function inputStyle(full = false): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    border: '1px solid rgba(148,163,184,0.35)',
    borderRadius: 6,
    background: '#0f172a',
    color: '#e2e8f0',
    gridColumn: full ? '1 / -1' : undefined,
  }
}

export function DriverProfilesPage({ onViewSchedule }: Props) {
  const [rows, setRows] = useState<DriverProfile[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [vendors, setVendors] = useState<QboVendor[]>([])
  const [err, setErr] = useState('')

  const load = async () => {
    setErr('')
    const d = await fetchDriverProfiles()
    setRows(Array.isArray(d.drivers) ? d.drivers : [])
  }

  useEffect(() => {
    void load()
    void (async () => {
      try {
        const res = await fetch('/api/qbo/master')
        const d = await res.json().catch(() => ({}))
        const list = Array.isArray(d?.vendors) ? d.vendors : []
        setVendors(list.map((v: any) => ({ id: String(v.id || v.value || ''), name: String(v.name || v.displayName || v.companyName || '') })).filter((v: QboVendor) => Boolean(v.id || v.name)))
      } catch {
        setVendors([])
      }
    })()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.full_name || ''} ${r.unit_number || ''} ${r.status || ''}`.toLowerCase().includes(q))
  }, [rows, query])

  const selected = useMemo(() => rows.find((r) => Number(r.id) === Number(selectedId)) || null, [rows, selectedId])

  useEffect(() => {
    if (!selected) return
    setDraft({
      ...emptyDraft(),
      ...selected,
      unit_number: String(selected.unit_number || ''),
      full_name: String(selected.full_name || ''),
      status: String(selected.status || 'active'),
      qbo_vendor_id: String((selected as any).qbo_vendor_id || ''),
      qbo_vendor_name: String((selected as any).qbo_vendor_name || ''),
      samsara_driver_id: String((selected as any).samsara_driver_id || ''),
    })
  }, [selectedId])

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '35% 65%', gap: 12, minHeight: 620 }}>
      <aside className="panel" style={{ padding: 10, display: 'grid', gridTemplateRows: 'auto auto 1fr' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Driver Profiles</h3>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search drivers..." style={inputStyle()} />
        <div style={{ marginTop: 8, overflow: 'auto', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8 }}>
          {filtered.map((r) => {
            const badge = expiryBadge(r.cdl_expiry, r.medical_expiry)
            return (
              <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} style={{ width: '100%', textAlign: 'left', background: selectedId === r.id ? 'rgba(59,130,246,0.15)' : 'transparent', border: 'none', borderBottom: '1px solid rgba(148,163,184,0.18)', padding: 10, color: '#e2e8f0', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{r.full_name || 'Unassigned'}</strong>
                  <span style={{ fontSize: 11, background: '#1e3a8a', color: '#bfdbfe', borderRadius: 999, padding: '2px 8px' }}>{r.unit_number || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
                  <span>{String(r.status || 'active')}</span>
                  <span style={{ ...badge.style, borderRadius: 999, padding: '1px 8px' }}>{badge.text}</span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="panel" style={{ padding: 12 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{draft.full_name || 'New driver'}</div>
            <div style={{ color: '#93c5fd', fontSize: 12 }}>{draft.unit_number || 'No unit'} · {draft.status || 'active'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm ghost" type="button" onClick={() => onViewSchedule(String(draft.unit_number || ''))}>Schedule</button>
          </div>
        </header>

        {err ? <div style={{ marginBottom: 8, color: '#fca5a5' }}>{err}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
          <label><span>Full name</span><input value={String(draft.full_name || '')} readOnly style={inputStyle()} /></label>
          <label><span>Unit number</span><input value={String(draft.unit_number || '')} readOnly style={inputStyle()} /></label>
          <label><span>Status</span><input value={String(draft.status || 'active')} readOnly style={inputStyle()} /></label>

          <label><span>Phone</span><input value={String(draft.phone || '')} readOnly style={inputStyle()} /></label>
          <label><span>Email</span><input value={String(draft.email || '')} readOnly style={inputStyle()} /></label>
          <label><span>Hire date</span><input type="date" value={String((draft as any).hire_date || '')} readOnly style={inputStyle()} /></label>

          <label><span>CDL number</span><input value={String(draft.cdl_number || '')} readOnly style={inputStyle()} /></label>
          <label><span>CDL state</span><input value={String((draft as any).cdl_state || '')} readOnly style={inputStyle()} /></label>
          <label><span>CDL expiry</span><input type="date" value={String(draft.cdl_expiry || '')} readOnly style={inputStyle()} /></label>

          <label><span>License number</span><input value={String((draft as any).license_number || '')} readOnly style={inputStyle()} /></label>
          <label><span>Medical expiry</span><input type="date" value={String(draft.medical_expiry || '')} readOnly style={inputStyle()} /></label>
          <label><span>Date of birth</span><input type="date" value={String((draft as any).date_of_birth || '')} readOnly style={inputStyle()} /></label>

          <label><span>Emergency contact</span><input value={String((draft as any).emergency_contact || '')} readOnly style={inputStyle()} /></label>
          <label><span>Emergency phone</span><input value={String((draft as any).emergency_phone || '')} readOnly style={inputStyle()} /></label>
          <div />

          <label style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea rows={3} value={String(draft.notes || '')} readOnly style={inputStyle(true)} /></label>

          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(148,163,184,0.2)', paddingTop: 8 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>QBO Vendor (links expenses to this driver)</span>
              <input list="driverQboVendorList" value={String((draft as any).qbo_vendor_name || '')} readOnly style={inputStyle()} />
              <datalist id="driverQboVendorList">
                {vendors.map((v) => <option key={v.id || v.name} value={v.name} />)}
              </datalist>
            </label>
            {(draft as any).qbo_vendor_name ? <span style={{ display: 'inline-block', marginTop: 8, background: '#14532d', color: '#bbf7d0', borderRadius: 999, padding: '2px 10px', fontSize: 12 }}>✅ Linked to {(draft as any).qbo_vendor_name}</span> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
