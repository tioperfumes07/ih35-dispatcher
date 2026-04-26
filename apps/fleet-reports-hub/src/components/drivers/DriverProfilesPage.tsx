import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import {
  fetchDriverProfiles,
  patchDriversBulk,
  type DriverProfile,
  updateDriverProfileById,
  upsertDriverProfile,
} from '../../lib/fleetRegistriesApi'
import { BulkActionBar } from '../ui/BulkActionBar'

type Props = {
  onViewSchedule: (unitNumber: string) => void
}

type DriverTableRow = {
  id: number
  unit_number: string
  full_name: string | null
  cdl_number: string | null
  cdl_expiry: string | null
  medical_expiry: string | null
  phone: string | null
  status: string
  notes: string | null
  placeholder?: boolean
}

const STATUS_OPTIONS = ['active', 'inactive', 'unassigned']

function daysUntil(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.floor((t - Date.now()) / 86400000)
}

function fallbackRows(): DriverTableRow[] {
  return Array.from({ length: 58 }, (_, i) => {
    const unit = `T${120 + i}`
    return {
      id: -(i + 1),
      unit_number: unit,
      full_name: 'Unassigned',
      cdl_number: null,
      cdl_expiry: null,
      medical_expiry: null,
      phone: null,
      status: 'active',
      notes: null,
      placeholder: true,
    }
  })
}

function badgeStyle(kind: 'red' | 'yellow' | 'green' | 'gray'): CSSProperties {
  if (kind === 'red') return { background: '#7f1d1d', color: '#fecaca', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }
  if (kind === 'yellow') return { background: '#78350f', color: '#fde68a', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }
  if (kind === 'green') return { background: '#14532d', color: '#bbf7d0', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }
  return { background: '#374151', color: '#d1d5db', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }
}

function expiryBadge(iso: string | null | undefined): React.ReactNode {
  if (!iso) return <span style={badgeStyle('gray')}>No expiry</span>
  const d = daysUntil(iso)
  if (!Number.isFinite(d)) return <span style={badgeStyle('gray')}>No expiry</span>
  if (d < 0) return <span style={badgeStyle('red')}>Expired</span>
  if (d < 30) return <span style={badgeStyle('red')}>{d}d left</span>
  if (d < 60) return <span style={badgeStyle('yellow')}>{d}d left</span>
  return <span style={badgeStyle('green')}>{d}d left</span>
}

function normalizeApiRows(rows: DriverProfile[]): DriverTableRow[] {
  return rows.map((d) => ({
    id: d.id,
    unit_number: String(d.unit_number || '').trim().toUpperCase(),
    full_name: d.full_name || 'Unassigned',
    cdl_number: d.cdl_number,
    cdl_expiry: d.cdl_expiry,
    medical_expiry: d.medical_expiry,
    phone: d.phone,
    status: String(d.status || 'active').toLowerCase(),
    notes: d.notes,
    placeholder: false,
  }))
}

function mergeRows(apiRows: DriverTableRow[]): DriverTableRow[] {
  const base = fallbackRows()
  const byUnit = new Map<string, DriverTableRow>()
  apiRows.forEach((r) => byUnit.set(String(r.unit_number || '').toUpperCase(), r))

  const merged = base.map((row) => {
    const hit = byUnit.get(String(row.unit_number || '').toUpperCase())
    if (!hit) return row
    return {
      ...row,
      ...hit,
      unit_number: row.unit_number,
      full_name: hit.full_name || 'Unassigned',
      placeholder: false,
    }
  })

  const extras = apiRows.filter((r) => !/^T(12\d|1[3-6]\d|17[0-7])$/i.test(String(r.unit_number || '')))
  return [...merged, ...extras]
}

function parseUnitSort(unit: string): number {
  const m = String(unit || '').match(/^T(\d{3})$/i)
  if (!m) return Number.MAX_SAFE_INTEGER
  return Number(m[1])
}

function draftFromRow(r: DriverTableRow): DriverTableRow {
  return {
    ...r,
    full_name: r.full_name || 'Unassigned',
    status: String(r.status || 'active').toLowerCase(),
  }
}

function exportSelectedCsv(rows: DriverTableRow[]) {
  const headers = ['Unit', 'Driver name', 'CDL expiry', 'Medical expiry', 'Status']
  const esc = (v: unknown) => {
    const text = String(v ?? '')
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  const body = rows
    .map((r) => [r.unit_number, r.full_name || '', r.cdl_expiry || '', r.medical_expiry || '', r.status || ''].map(esc).join(','))
    .join('\n')
  const csv = `${headers.map(esc).join(',')}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = 'driver-profiles-selected.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

export function DriverProfilesPage({ onViewSchedule }: Props) {
  const [rows, setRows] = useState<DriverTableRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DriverTableRow | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDriverProfiles()
      const apiRows = normalizeApiRows(Array.isArray(data.drivers) ? data.drivers : [])
      const merged = mergeRows(apiRows).sort((a, b) => {
        const ua = parseUnitSort(a.unit_number)
        const ub = parseUnitSort(b.unit_number)
        if (ua !== ub) return ua - ub
        return String(a.unit_number || '').localeCompare(String(b.unit_number || ''))
      })
      setRows(merged)
    } catch (e) {
      setRows(fallbackRows())
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
    return rows.filter((r) => `${r.unit_number || ''} ${r.full_name || ''} ${r.status || ''}`.toLowerCase().includes(q))
  }, [rows, search])

  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected])

  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const allowed = new Set(filtered.map((r) => r.id))
      const next = new Set<number>()
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

  const save = async () => {
    if (!draft?.unit_number) {
      setError('Unit is required')
      return
    }
    setError(null)
    try {
      const body = {
        unit_number: String(draft.unit_number || '').trim().toUpperCase(),
        full_name: String(draft.full_name || '').trim() || 'Unassigned',
        cdl_number: String(draft.cdl_number || '').trim() || null,
        cdl_expiry: String(draft.cdl_expiry || '').trim() || null,
        medical_expiry: String(draft.medical_expiry || '').trim() || null,
        phone: String(draft.phone || '').trim() || null,
        notes: String(draft.notes || '').trim() || null,
        status: String(draft.status || 'active').trim().toLowerCase() || 'active',
      }
      if (Number(draft.id) > 0) {
        await updateDriverProfileById(Number(draft.id), body)
      } else {
        await upsertDriverProfile(body)
      }
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
        </div>
      </header>

      <div style={{ marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by unit, driver, or status"
          style={{ width: 'min(360px, 100%)' }}
        />
      </div>

      {error ? <p className="nm-banner nm-banner--err">{error}</p> : null}

      <div className="table-wrap" style={{ maxHeight: '62vh' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 40, padding: '8px' }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())}
                />
              </th>
              <th>Unit</th>
              <th>Driver name</th>
              <th>CDL expiry</th>
              <th>Medical expiry</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={`${r.unit_number}-${r.id}`}
                onClick={() => setDraft(draftFromRow(r))}
                style={{
                  cursor: 'pointer',
                  opacity: r.placeholder ? 0.9 : 1,
                  background: selected.has(r.id) ? 'rgba(59,130,246,0.1)' : undefined,
                }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(r.id)
                      else next.delete(r.id)
                      setSelected(next)
                    }}
                  />
                </td>
                <td>{r.unit_number || '—'}</td>
                <td>{r.full_name || 'Unassigned'}</td>
                <td>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span>{r.cdl_expiry || '—'}</span>
                    {expiryBadge(r.cdl_expiry)}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span>{r.medical_expiry || '—'}</span>
                    {expiryBadge(r.medical_expiry)}
                  </div>
                </td>
                <td>{String(r.status || 'active')}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn sm ghost" onClick={() => setDraft(draftFromRow(r))}>Edit</button>
                    <button type="button" className="btn sm" onClick={() => onViewSchedule(r.unit_number)}>Schedule</button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr><td colSpan={7} className="muted">No driver profiles found.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <BulkActionBar
        selectedCount={selectedRows.length}
        totalCount={filtered.length}
        onSelectAll={() => setSelected(new Set(filtered.map((r) => r.id)))}
        onClearSelection={() => setSelected(new Set())}
        actions={[
          {
            label: 'Set Active',
            onClick: () => {
              void (async () => {
                const ids = selectedRows.map((row) => row.id).filter((id) => id > 0)
                if (!ids.length) return
                await patchDriversBulk(ids, 'active')
                await load()
              })()
            },
          },
          {
            label: 'Set Inactive',
            variant: 'warning',
            onClick: () => {
              void (async () => {
                const ids = selectedRows.map((row) => row.id).filter((id) => id > 0)
                if (!ids.length) return
                await patchDriversBulk(ids, 'inactive')
                await load()
              })()
            },
          },
          {
            label: 'Export selected',
            onClick: () => exportSelectedCsv(selectedRows),
          },
        ]}
      />

      {draft ? (
        <div className="maint-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="maint-modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: 'min(720px,100%)' }}>
            <header className="modal-generic-head">
              <h3 style={{ margin: 0 }}>Edit Driver</h3>
              <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>Close</button>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Unit</span>
                <input value={String(draft.unit_number || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), unit_number: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Driver name</span>
                <input value={String(draft.full_name || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), full_name: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">CDL number</span>
                <input value={String(draft.cdl_number || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), cdl_number: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">CDL expiry</span>
                <input type="date" value={String(draft.cdl_expiry || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), cdl_expiry: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Medical card expiry</span>
                <input type="date" value={String(draft.medical_expiry || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), medical_expiry: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Phone number</span>
                <input value={String(draft.phone || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), phone: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="muted">Status</span>
                <select value={String(draft.status || 'active')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), status: e.target.value }))}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span className="muted">Notes</span>
                <textarea value={String(draft.notes || '')} onChange={(e) => setDraft((prev) => ({ ...(prev || draft), notes: e.target.value }))} rows={3} />
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
