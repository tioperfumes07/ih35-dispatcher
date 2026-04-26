import { useEffect, useMemo, useState } from 'react'
import { fetchDriverProfiles, updateDriverProfileById, upsertDriverProfile, type DriverProfile } from '../../lib/fleetRegistriesApi'

type Props = {
  onViewSchedule: (unitNumber: string) => void
}

type SamsaraDriver = {
  samsara_id?: string | number | null
  name?: string | null
  phone?: string | null
  licenseNumber?: string | null
  licenseState?: string | null
  currentVehicle?: string | null
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
  const [samsaraRows, setSamsaraRows] = useState<SamsaraDriver[]>([])
  const [info, setInfo] = useState('')
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

  const setField = (k: keyof Draft, v: string) => setDraft((prev) => ({ ...prev, [k]: v }))

  const save = async () => {
    try {
      setErr('')
      const body = { ...draft }
      if (selectedId && selectedId > 0) await updateDriverProfileById(selectedId, body)
      else await upsertDriverProfile(body as any)
      setInfo('✅ Saved')
      await load()
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  const importFromSamsara = async () => {
    try {
      setErr('')
      const r = await fetch('/api/drivers/samsara-list')
      const d = await r.json().catch(() => ({}))
      setSamsaraRows(Array.isArray(d?.drivers) ? d.drivers : [])
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  const applySamsara = async (row: SamsaraDriver) => {
    setDraft((prev) => ({
      ...prev,
      full_name: String(row.name || prev.full_name || ''),
      phone: String(row.phone || prev.phone || ''),
      license_number: String(row.licenseNumber || prev.license_number || ''),
      cdl_state: String(row.licenseState || prev.cdl_state || ''),
      samsara_driver_id: String(row.samsara_id || prev.samsara_driver_id || ''),
      unit_number: String(row.currentVehicle || prev.unit_number || ''),
    }))
    setInfo('Imported from Samsara ✅')
    try {
      await fetch('/api/drivers/profiles/import-samsara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samsara_driver_id: row.samsara_id,
          name: row.name,
          phone: row.phone,
          licenseNumber: row.licenseNumber,
          licenseState: row.licenseState,
          unit_number: row.currentVehicle,
        }),
      })
      await load()
    } catch {
      // non-blocking
    }
  }

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '35% 65%', gap: 12, minHeight: 620 }}>
      <aside className="panel" style={{ padding: 10, display: 'grid', gridTemplateRows: 'auto auto 1fr' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Driver Profiles</h3>
          <button className="btn sm" type="button" onClick={() => { setSelectedId(null); setDraft(emptyDraft()) }}>+ Add Driver</button>
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
            <button className="btn sm ghost" type="button" onClick={() => { if (selected) setDraft({ ...(selected as any), unit_number: String(selected.unit_number || ''), full_name: String(selected.full_name || ''), status: String(selected.status || 'active') }); else setDraft(emptyDraft()) }}>Cancel</button>
            <button className="btn sm" type="button" onClick={() => void save()}>Save</button>
            <button className="btn sm ghost" type="button" onClick={() => onViewSchedule(String(draft.unit_number || ''))}>Schedule</button>
          </div>
        </header>

        {info ? <div style={{ marginBottom: 8, color: '#86efac' }}>{info}</div> : null}
        {err ? <div style={{ marginBottom: 8, color: '#fca5a5' }}>{err}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
          <label><span>Full name</span><input value={String(draft.full_name || '')} onChange={(e) => setField('full_name', e.target.value)} style={inputStyle()} /></label>
          <label><span>Unit number</span><input value={String(draft.unit_number || '')} onChange={(e) => setField('unit_number', e.target.value)} style={inputStyle()} /></label>
          <label><span>Status</span><select value={String(draft.status || 'active')} onChange={(e) => setField('status', e.target.value)} style={inputStyle()}><option>active</option><option>inactive</option></select></label>

          <label><span>Phone</span><input value={String(draft.phone || '')} onChange={(e) => setField('phone', e.target.value)} style={inputStyle()} /></label>
          <label><span>Email</span><input value={String(draft.email || '')} onChange={(e) => setField('email', e.target.value)} style={inputStyle()} /></label>
          <label><span>Hire date</span><input type="date" value={String((draft as any).hire_date || '')} onChange={(e) => setField('hire_date' as any, e.target.value)} style={inputStyle()} /></label>

          <label><span>CDL number</span><input value={String(draft.cdl_number || '')} onChange={(e) => setField('cdl_number', e.target.value)} style={inputStyle()} /></label>
          <label><span>CDL state</span><input value={String((draft as any).cdl_state || '')} onChange={(e) => setField('cdl_state' as any, e.target.value)} style={inputStyle()} /></label>
          <label><span>CDL expiry</span><input type="date" value={String(draft.cdl_expiry || '')} onChange={(e) => setField('cdl_expiry', e.target.value)} style={inputStyle()} /></label>

          <label><span>License number</span><input value={String((draft as any).license_number || '')} onChange={(e) => setField('license_number' as any, e.target.value)} style={inputStyle()} /></label>
          <label><span>Medical expiry</span><input type="date" value={String(draft.medical_expiry || '')} onChange={(e) => setField('medical_expiry', e.target.value)} style={inputStyle()} /></label>
          <label><span>Date of birth</span><input type="date" value={String((draft as any).date_of_birth || '')} onChange={(e) => setField('date_of_birth' as any, e.target.value)} style={inputStyle()} /></label>

          <label><span>Emergency contact</span><input value={String((draft as any).emergency_contact || '')} onChange={(e) => setField('emergency_contact' as any, e.target.value)} style={inputStyle()} /></label>
          <label><span>Emergency phone</span><input value={String((draft as any).emergency_phone || '')} onChange={(e) => setField('emergency_phone' as any, e.target.value)} style={inputStyle()} /></label>
          <div />

          <label style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea rows={3} value={String(draft.notes || '')} onChange={(e) => setField('notes', e.target.value)} style={inputStyle(true)} /></label>

          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(148,163,184,0.2)', paddingTop: 8 }}>
            <button type="button" className="btn sm" onClick={() => void importFromSamsara()}>🔍 Search in Samsara</button>
            {samsaraRows.length ? (
              <div style={{ marginTop: 8, maxHeight: 130, overflow: 'auto', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6 }}>
                {samsaraRows.map((d, idx) => (
                  <button key={`${d.samsara_id || idx}`} type="button" onClick={() => void applySamsara(d)} style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid rgba(148,163,184,0.12)', background: 'transparent', color: '#cbd5e1', padding: 8 }}>
                    {d.name || 'Unnamed'} · {d.currentVehicle || 'No vehicle'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(148,163,184,0.2)', paddingTop: 8 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>QBO Vendor (links expenses to this driver)</span>
              <input list="driverQboVendorList" value={String((draft as any).qbo_vendor_name || '')} onChange={(e) => {
                const name = e.target.value
                const hit = vendors.find((v) => v.name === name)
                setDraft((prev) => ({ ...prev, qbo_vendor_name: name, qbo_vendor_id: hit?.id || '' }))
              }} style={inputStyle()} />
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
