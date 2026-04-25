import { useEffect, useMemo, useState } from 'react'
import {
  fetchFleetAssetProfiles,
  updateFleetAssetProfile,
  type FleetAssetProfile,
  type FleetAssetProfilePatch,
} from '../../lib/fleetRegistriesApi'
import { BulkActionBar } from '../ui/BulkActionBar'

type Props = { onCloseList: () => void }

type FilterKey = 'all' | 'trucks' | 'trailers' | 'out-of-service' | 'sold'

const TYPE_OPTIONS: FleetAssetProfile['asset_type'][] = [
  'Truck',
  'Reefer Van',
  'Flatbed',
  'Dry Van',
  'Company Vehicle',
  'Trailer',
  'Other',
]

const STATUS_OPTIONS: FleetAssetProfile['status'][] = [
  'Active',
  'In Shop',
  'Out of Service',
  'Sold',
  'Crashed/Total Loss',
  'Permanently Removed',
]

function emptyPatchFrom(asset: FleetAssetProfile | null): FleetAssetProfilePatch {
  if (!asset) return {}
  return {
    unit_number: asset.unit_number,
    asset_type: asset.asset_type,
    status: asset.status,
    vin_override: asset.vin,
    license_plate_override: asset.licensePlate,
    year_override: asset.year,
    make_override: asset.make,
    model_override: asset.model,
    notes: asset.notes,
  }
}

function exportSelectedAsCsv(rows: FleetAssetProfile[]) {
  const headers = ['Unit#', 'Make', 'Model', 'Year', 'VIN', 'License Plate', 'Type', 'Status', 'Notes']
  const esc = (v: unknown) => {
    const text = String(v ?? '')
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  const body = rows
    .map((r) =>
      [
        r.unit_number,
        r.make || '',
        r.model || '',
        r.year ?? '',
        r.vin || '',
        r.licensePlate || '',
        r.asset_type,
        r.status,
        r.notes || '',
      ]
        .map(esc)
        .join(','),
    )
    .join('\n')
  const csv = `${headers.map(esc).join(',')}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = 'fleet-assets-selected.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

function isTruck(unit: string): boolean {
  const m = String(unit || '').trim().toUpperCase().match(/^T(\d{3})$/)
  if (!m) return false
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 120 && n <= 177
}

export function FleetAssetsDatabase({ onCloseList }: Props) {
  const [rows, setRows] = useState<FleetAssetProfile[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<FleetAssetProfilePatch>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFleetAssetProfiles()
      const list = Array.isArray(data.assets) ? data.assets : []
      setRows(list)
      if (!selectedId && list.length) {
        setSelectedId(list[0].samsara_id)
        setDraft(emptyPatchFrom(list[0]))
      }
      if (selectedId && !list.some((r) => r.samsara_id === selectedId)) {
        const first = list[0] || null
        setSelectedId(first?.samsara_id ?? null)
        setDraft(emptyPatchFrom(first))
      }
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const truck = isTruck(r.unit_number)
      if (filter === 'trucks' && !truck) return false
      if (filter === 'trailers' && truck) return false
      if (filter === 'out-of-service' && r.status !== 'Out of Service') return false
      if (filter === 'sold' && r.status !== 'Sold') return false
      if (!q) return true
      const hay = [
        r.unit_number,
        r.make,
        r.model,
        r.vin,
        r.licensePlate,
        r.asset_type,
        r.status,
        r.notes,
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [rows, search, filter])

  const selected = useMemo(
    () => rows.find((r) => r.samsara_id === selectedId) || null,
    [rows, selectedId],
  )
  const selectedFilteredRows = useMemo(
    () => filtered.filter((r) => selectedRows.has(r.samsara_id)),
    [filtered, selectedRows],
  )

  useEffect(() => {
    setSelectedRows((prev) => {
      if (!prev.size) return prev
      const allowed = new Set(filtered.map((r) => r.samsara_id))
      const next = new Set<string>()
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [filtered])


  useEffect(() => {
    setDraft(emptyPatchFrom(selected))
  }, [selected])

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await updateFleetAssetProfile(selected.samsara_id, {
        unit_number: String(draft.unit_number || '').trim() || null,
        asset_type: draft.asset_type,
        status: draft.status,
        vin_override: String(draft.vin_override || '').trim() || null,
        license_plate_override: String(draft.license_plate_override || '').trim() || null,
        year_override:
          draft.year_override == null || draft.year_override === ('' as unknown as number)
            ? null
            : Number(draft.year_override),
        make_override: String(draft.make_override || '').trim() || null,
        model_override: String(draft.model_override || '').trim() || null,
        notes: String(draft.notes || '').trim() || null,
      })
      await load()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="lists-db" style={{ display: 'grid', gap: 12 }}>
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Vehicles Database</h3>
          <p className="muted tiny lists-db__sub">Samsara source data with editable fleet profile overrides.</p>
        </div>
        <div className="lists-db__actions" style={{ gap: 8 }}>
          <button type="button" className="btn sm ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="btn sm ghost" onClick={onCloseList}>
            Close list
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="list-edit-field__inp"
          style={{ minWidth: 260, maxWidth: 420 }}
          placeholder="Search unit, make, model, VIN, status..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(
          [
            ['all', 'All'],
            ['trucks', 'Trucks'],
            ['trailers', 'Trailers'],
            ['out-of-service', 'Out of Service'],
            ['sold', 'Sold'],
          ] as Array<[FilterKey, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn sm ${filter === key ? 'primary' : 'ghost'}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(620px, 1fr) 360px', gap: 12 }}>
        <div>
          <div className="table-wrap" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40, padding: '8px' }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedRows.size === filtered.length}
                    onChange={(e) =>
                      setSelectedRows(e.target.checked ? new Set(filtered.map((r) => r.samsara_id)) : new Set())
                    }
                  />
                </th>
                <th>Unit#</th>
                <th>Make</th>
                <th>Model</th>
                <th>Year</th>
                <th>VIN</th>
                <th>License Plate</th>
                <th>Type</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const active = selectedId === r.samsara_id
                return (
                  <tr
                    key={r.samsara_id}
                    onClick={() => setSelectedId(r.samsara_id)}
                    style={{
                      cursor: 'pointer',
                      background: selectedRows.has(r.samsara_id)
                        ? 'rgba(59,130,246,0.1)'
                        : active
                          ? 'var(--surface-hover, rgba(37,99,235,.07))'
                          : undefined,
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(r.samsara_id)}
                        onChange={(e) => {
                          const next = new Set(selectedRows)
                          if (e.target.checked) next.add(r.samsara_id)
                          else next.delete(r.samsara_id)
                          setSelectedRows(next)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>{r.unit_number}</td>
                    <td>{r.make || '—'}</td>
                    <td>{r.model || '—'}</td>
                    <td>{r.year ?? '—'}</td>
                    <td>{r.vin || '—'}</td>
                    <td>{r.licensePlate || '—'}</td>
                    <td>{r.asset_type}</td>
                    <td>{r.status}</td>
                    <td>{r.notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <BulkActionBar
            selectedCount={selectedFilteredRows.length}
            totalCount={filtered.length}
            onSelectAll={() => setSelectedRows(new Set(filtered.map((r) => r.samsara_id)))}
            onClearSelection={() => setSelectedRows(new Set())}
            actions={[
              {
                label: 'Set Active',
                onClick: () => {
                  void (async () => {
                    await Promise.all(selectedFilteredRows.map((row) => updateFleetAssetProfile(row.samsara_id, { status: 'Active' })))
                    await load()
                  })()
                },
              },
              {
                label: 'Set Inactive',
                variant: 'warning',
                onClick: () => {
                  void (async () => {
                    await Promise.all(selectedFilteredRows.map((row) => updateFleetAssetProfile(row.samsara_id, { status: 'Out of Service' })))
                    await load()
                  })()
                },
              },
              {
                label: 'Export selected',
                onClick: () => exportSelectedAsCsv(selectedFilteredRows),
              },
            ]}
          />
        </div>

        <aside className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-head">
            <div className="panel-title">Asset Profile</div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
            {!selected ? (
              <p className="muted tiny">Select a row to edit.</p>
            ) : (
              <>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Type</span>
                  <select
                    className="list-edit-field__sel"
                    value={String(draft.asset_type || selected.asset_type)}
                    onChange={(e) => setDraft((d) => ({ ...d, asset_type: e.target.value as FleetAssetProfile['asset_type'] }))}
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Status</span>
                  <select
                    className="list-edit-field__sel"
                    value={String(draft.status || selected.status)}
                    onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as FleetAssetProfile['status'] }))}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">VIN override</span>
                  <input
                    className="list-edit-field__inp"
                    value={String(draft.vin_override ?? selected.vin ?? '')}
                    onChange={(e) => setDraft((d) => ({ ...d, vin_override: e.target.value }))}
                  />
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">License plate override</span>
                  <input
                    className="list-edit-field__inp"
                    value={String(draft.license_plate_override ?? selected.licensePlate ?? '')}
                    onChange={(e) => setDraft((d) => ({ ...d, license_plate_override: e.target.value }))}
                  />
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Year override</span>
                  <input
                    type="number"
                    className="list-edit-field__inp"
                    value={String(draft.year_override ?? selected.year ?? '')}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        year_override: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  />
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Make override</span>
                  <input
                    className="list-edit-field__inp"
                    value={String(draft.make_override ?? selected.make ?? '')}
                    onChange={(e) => setDraft((d) => ({ ...d, make_override: e.target.value }))}
                  />
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Model override</span>
                  <input
                    className="list-edit-field__inp"
                    value={String(draft.model_override ?? selected.model ?? '')}
                    onChange={(e) => setDraft((d) => ({ ...d, model_override: e.target.value }))}
                  />
                </label>
                <label className="list-edit-field">
                  <span className="list-edit-field__lbl">Notes</span>
                  <textarea
                    rows={3}
                    className="list-edit-field__inp"
                    value={String(draft.notes ?? selected.notes ?? '')}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  />
                </label>
                <button type="button" className="btn sm primary" onClick={() => void save()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
