import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'
import type { AssetPatch, AssetRow } from '../../lib/fleetRegistriesApi'
import {
  createAsset,
  deleteAsset,
  fetchAssets,
  patchAsset,
  syncAssetsQboClasses,
  syncAssetsSamsara,
} from '../../lib/fleetRegistriesApi'

const SAMSARA_REGISTRY_POLL_MS = 60_000
const ASSET_META_STORAGE_KEY = 'fleet-assets-local-meta-v1'

type Row = AssetRow & Record<string, unknown>

type LocalMeta = {
  name?: string
  notes?: string
}

type Draft = {
  unit_number: string
  name: string
  year: string
  make: string
  model: string
  vin: string
  license_plate: string
  license_state: string
  odometer_miles: string
  engine_hours: string
  fuel_type: string
  asset_type: string
  status: string
  notes: string
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'in_shop', label: 'In Shop' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'sold', label: 'Sold' },
  { value: 'crashed_total_loss', label: 'Crashed/Total Loss' },
  { value: 'permanently_removed', label: 'Permanently Removed' },
]

function normalizeStatus(status: string | null | undefined): string {
  const s = String(status || '').trim().toLowerCase()
  if (s === 'maintenance') return 'in_shop'
  if (s === 'inactive') return 'out_of_service'
  if (STATUS_OPTIONS.some((o) => o.value === s)) return s
  return 'active'
}

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label || value
}

function loadMetaMap(): Record<string, LocalMeta> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(ASSET_META_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, LocalMeta>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveMetaMap(next: Record<string, LocalMeta>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ASSET_META_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore localStorage limits
  }
}

function rowToDraft(r: AssetRow, meta: LocalMeta | undefined): Draft {
  return {
    unit_number: r.unit_number ?? '',
    name: String(meta?.name || r.unit_number || '').trim(),
    year: r.year != null ? String(r.year) : '',
    make: r.make ?? '',
    model: r.model ?? '',
    vin: r.vin ?? '',
    license_plate: r.license_plate ?? '',
    license_state: r.license_state ?? '',
    odometer_miles: r.odometer_miles != null ? String(r.odometer_miles) : '',
    engine_hours: r.engine_hours != null ? String(r.engine_hours) : '',
    fuel_type: r.fuel_type ?? '',
    asset_type: r.asset_type ?? 'truck',
    status: normalizeStatus(r.status),
    notes: String(meta?.notes || '').trim(),
  }
}

function emptyDraft(): Draft {
  return {
    unit_number: '',
    name: '',
    year: '',
    make: '',
    model: '',
    vin: '',
    license_plate: '',
    license_state: '',
    odometer_miles: '',
    engine_hours: '',
    fuel_type: '',
    asset_type: 'truck',
    status: 'active',
    notes: '',
  }
}

function toPatch(d: Draft): AssetPatch {
  const p: AssetPatch = {
    unit_number: d.unit_number.trim(),
    make: d.make.trim() || null,
    model: d.model.trim() || null,
    vin: d.vin.trim() || null,
    license_plate: d.license_plate.trim() || null,
    license_state: d.license_state.trim() || null,
    fuel_type: d.fuel_type.trim() || null,
    asset_type: d.asset_type.trim() || 'truck',
    status: normalizeStatus(d.status),
  }
  const y = Number(d.year)
  if (d.year.trim() && Number.isFinite(y)) p.year = y
  else p.year = null
  const odo = Number(d.odometer_miles)
  if (d.odometer_miles.trim() && Number.isFinite(odo)) p.odometer_miles = odo
  else p.odometer_miles = null
  const eh = Number(d.engine_hours)
  if (d.engine_hours.trim() && Number.isFinite(eh)) p.engine_hours = eh
  else p.engine_hours = null
  return p
}

export function AssetsDatabase({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<AssetRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [samMsg, setSamMsg] = useState<string | null>(null)
  const [lastSamSyncAt, setLastSamSyncAt] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [metaMap, setMetaMap] = useState<Record<string, LocalMeta>>(() => loadMetaMap())

  const load = useCallback(async () => {
    setErr(null)
    try {
      const j = await fetchAssets()
      setRows(j.assets)
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateMetaForId = useCallback((id: number, meta: LocalMeta) => {
    setMetaMap((prev) => {
      const next = { ...prev, [String(id)]: meta }
      saveMetaMap(next)
      return next
    })
  }, [])

  const runSamsaraSync = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!opts?.quiet) setErr(null)
      try {
        const r = await syncAssetsSamsara()
        const total = Number(r.totalVehicles ?? 0)
        const synced = Number(r.synced ?? 0)
        const inserted = Number(r.inserted ?? 0)
        const skippedNoUnit = Number(r.skippedNoUnit ?? 0)
        if (total <= 0) {
          setSamMsg('Samsara returned 0 vehicles. Check SAMSARA_API_TOKEN / fleet access scope.')
        } else {
          setSamMsg(
            `Samsara sync complete: ${synced} touched, ${inserted} inserted, ${skippedNoUnit} skipped (no unit). Source vehicles: ${total}.`,
          )
        }
        setLastSamSyncAt(new Date().toISOString())
        await load()
      } catch (e) {
        if (!opts?.quiet) setErr(String((e as Error).message || e))
      }
    },
    [load],
  )

  useEffect(() => {
    void runSamsaraSync({ quiet: true })
    const id = window.setInterval(() => void runSamsaraSync({ quiet: true }), SAMSARA_REGISTRY_POLL_MS)
    return () => window.clearInterval(id)
  }, [runSamsaraSync])

  const onSam = () => void runSamsaraSync()

  const onQbo = async () => {
    setErr(null)
    try {
      const r = await syncAssetsQboClasses()
      const fail = r.errors?.length
      if (fail) setErr(r.errors!.map((e) => `#${e.id} ${e.unit ?? ''}: ${e.error}`).join('\n'))
      await load()
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }

  const openAdd = () => {
    setErr(null)
    setEditingId(null)
    setDraft(emptyDraft())
    setModalOpen(true)
  }

  const openEdit = (r: AssetRow) => {
    setErr(null)
    setEditingId(r.id)
    setDraft(rowToDraft(r, metaMap[String(r.id)]))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const persist = async () => {
    if (!draft.unit_number.trim()) {
      setErr('Unit # is required.')
      throw new Error('validation')
    }
    if (editingId == null) {
      const { asset } = await createAsset({ unit_number: draft.unit_number.trim() })
      await patchAsset(asset.id, toPatch(draft))
      return asset.id
    }
    await patchAsset(editingId, toPatch(draft))
    return editingId
  }

  const saveMetaFromDraft = (id: number) => {
    updateMetaForId(id, {
      name: draft.name.trim() || draft.unit_number.trim(),
      notes: draft.notes.trim(),
    })
  }

  const save = async () => {
    let id = -1
    try {
      id = await persist()
    } catch {
      return
    }
    if (id > 0) saveMetaFromDraft(id)
    await load()
    closeModal()
  }

  const saveAndSyncClasses = async () => {
    let id = -1
    try {
      id = await persist()
    } catch {
      return
    }
    if (id > 0) saveMetaFromDraft(id)
    await syncAssetsQboClasses()
    await load()
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'unit', label: 'Unit#', width: 70, render: (r) => <span className="lists-db__pill lists-db__pill--info">{r.unit_number}</span> },
      { id: 'name', label: 'Name', width: 100, render: (r) => metaMap[String(r.id)]?.name || r.unit_number },
      { id: 'make', label: 'Make', width: 80, render: (r) => r.make ?? '—' },
      { id: 'model', label: 'Model', width: 80, render: (r) => r.model ?? '—' },
      { id: 'year', label: 'Year', width: 56, render: (r) => r.year ?? '—' },
      { id: 'vin', label: 'VIN', width: 120, render: (r) => r.vin ?? '—' },
      { id: 'plate', label: 'License Plate', width: 92, render: (r) => r.license_plate ?? '—' },
      { id: 'type', label: 'Type', width: 88, render: (r) => r.asset_type || 'truck' },
      {
        id: 'status',
        label: 'Status',
        width: 120,
        render: (r) => {
          const s = normalizeStatus(r.status)
          const warn = s === 'in_shop' || s === 'out_of_service'
          const bad = s === 'sold' || s === 'crashed_total_loss' || s === 'permanently_removed'
          if (bad) return <span className="lists-db__pill lists-db__pill--danger">{statusLabel(s)}</span>
          if (warn) return <span className="lists-db__pill lists-db__pill--warn">{statusLabel(s)}</span>
          return <span className="lists-db__pill lists-db__pill--ok">{statusLabel(s)}</span>
        },
      },
      { id: 'notes', label: 'Notes', width: 160, render: (r) => metaMap[String(r.id)]?.notes || '—' },
    ],
    [metaMap],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  return (
    <div className="lists-db">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Vehicles database — Fleet & Samsara</h3>
          <p className="muted tiny lists-db__sub">
            Master vehicle records for maintenance/accounting. Pulls from Samsara and remains editable locally.
          </p>
        </div>
        <div className="lists-db__actions">
          <button type="button" className="btn sm primary shared-list__head-btn" onClick={openAdd}>
            + Add vehicle
          </button>
        </div>
      </div>
      <div className="lists-db__banner lists-db__banner--ok muted tiny">
        {samMsg ??
          `Samsara mirror · ${rows.length} vehicles${lastSamSyncAt ? ` · last sync ${new Date(lastSamSyncAt).toLocaleString()}` : ''} · auto every 60s · local edits do NOT push to Samsara.`}
      </div>
      {err ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      ) : null}

      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add vehicle' : 'Edit vehicle'}
        subtitle="Samsara sync refreshes telemetry fields; operational status, type, name, and notes are editable here."
        onClose={closeModal}
        onSave={save}
        extraSaveButton={
          <button type="button" className="btn sm success" onClick={() => void saveAndSyncClasses()}>
            Save &amp; sync QBO classes
          </button>
        }
      >
        <div className="list-edit-form">
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Unit #</span>
            <input className="list-edit-field__inp" value={draft.unit_number} onChange={(e) => setDraft((d) => ({ ...d, unit_number: e.target.value }))} disabled={editingId != null} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Name</span>
            <input className="list-edit-field__inp" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Year</span>
            <input className="list-edit-field__inp" value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Make</span>
            <input className="list-edit-field__inp" value={draft.make} onChange={(e) => setDraft((d) => ({ ...d, make: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Model</span>
            <input className="list-edit-field__inp" value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">VIN</span>
            <input className="list-edit-field__inp" value={draft.vin} onChange={(e) => setDraft((d) => ({ ...d, vin: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">License plate</span>
            <input className="list-edit-field__inp" value={draft.license_plate} onChange={(e) => setDraft((d) => ({ ...d, license_plate: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">License state</span>
            <input className="list-edit-field__inp" value={draft.license_state} onChange={(e) => setDraft((d) => ({ ...d, license_state: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Type</span>
            <input className="list-edit-field__inp" value={draft.asset_type} onChange={(e) => setDraft((d) => ({ ...d, asset_type: e.target.value }))} />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Status</span>
            <select className="list-edit-field__sel" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Notes</span>
            <textarea className="list-edit-field__inp" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} />
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Vehicles"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search unit, name, VIN, make, model…"
        searchKeys={['unit_number', 'vin', 'make', 'model', 'asset_type', 'status']}
        exportFilename="VehiclesDatabase"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        onBulkStatusChange={async (status, selectedRows) => {
          const ids = selectedRows
            .map((row) => String((row as AssetRow).unit_number || '').trim())
            .filter(Boolean)
          if (!ids.length) return
          setErr(null)
          try {
            const resp = await fetch('/api/fleet/assets/bulk', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids, status }),
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'Invalid server response' }))
            if (!resp.ok || !data?.ok) {
              setErr(String(data?.error || 'Bulk update failed'))
              return
            }
            setSamMsg(`${Number(data.updated || 0)} unit(s) set to ${status}.`)
            await load()
          } catch (e) {
            setErr(String((e as Error).message || e))
          }
        }}
        toolbarExtra={
          <>
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void load()}>
              Refresh
            </button>
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void onSam()}>
              Sync from Samsara
            </button>
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void onQbo()}>
              Sync QBO classes
            </button>
          </>
        }
        onEdit={(r) => openEdit(r as AssetRow)}
        onDelete={async (r) => {
          if (!window.confirm(`Delete vehicle ${(r as AssetRow).unit_number}?`)) return
          await deleteAsset((r as AssetRow).id)
          await load()
        }}
        onDeactivate={async (r) => {
          await patchAsset((r as AssetRow).id, { status: 'out_of_service' })
          await load()
        }}
        onActivate={async (r) => {
          await patchAsset((r as AssetRow).id, { status: 'active' })
          await load()
        }}
      />
    </div>
  )
}
