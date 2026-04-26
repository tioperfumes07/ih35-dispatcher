import { useCallback, useEffect, useMemo, useState } from 'react'
import { showToast } from '../ui/Toast'
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

type QboClass = {
  qboId: string
  name: string
}

type AssetQboClassMapping = {
  unit_number: string
  qbo_class_id?: string | null
  qbo_class_name?: string | null
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'in_shop', label: 'In Shop' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'sold', label: 'Sold' },
  { value: 'crashed_total_loss', label: 'Crashed/Total Loss' },
  { value: 'permanently_removed', label: 'Permanently Removed' },
]

const STATUS_FILTER_TABS = ['All', 'Active', 'Inactive', 'Out of Service', 'In Shop', 'Accident', 'Sold'] as const
const TYPE_FILTER_TABS = ['All Types', 'Trucks', 'Reefer Trailers', 'Flatbeds', 'Dry Vans', 'Step Decks', 'Vans', 'Company Vehicles', 'Other'] as const

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

function normalizeStatusForFilter(value: string | null | undefined): string {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === 'active') return 'Active'
  if (raw === 'inactive') return 'Inactive'
  if (raw === 'out_of_service' || raw === 'out of service') return 'Out of Service'
  if (raw === 'in_shop' || raw === 'in shop' || raw === 'maintenance') return 'In Shop'
  if (raw === 'accident' || raw === 'crashed_total_loss') return 'Accident'
  if (raw === 'sold') return 'Sold'
  return value ? String(value) : 'Active'
}

function isTruckUnit(unitNumber: string | null | undefined): boolean {
  const unit = String(unitNumber || '').trim().toUpperCase()
  return unit.startsWith('T1')
}

function classifyType(assetType: string | null | undefined, unitNumber: string | null | undefined): Exclude<(typeof TYPE_FILTER_TABS)[number], 'All Types'> {
  const raw = String(assetType || '').trim().toLowerCase()
  if (raw.includes('truck') || isTruckUnit(unitNumber)) return 'Trucks'
  if (raw.includes('reefer') || raw.includes("53' reefer")) return 'Reefer Trailers'
  if (raw.includes('flatbed')) return 'Flatbeds'
  if (raw.includes('dry') || raw.includes('dry van')) return 'Dry Vans'
  if (raw.includes('step')) return 'Step Decks'
  if (raw.includes('van') && !raw.includes('dry')) return 'Vans'
  if (raw.includes('company')) return 'Company Vehicles'
  return 'Other'
}

function matchesTypeFilter(
  assetType: string | null | undefined,
  unitNumber: string | null | undefined,
  typeFilter: typeof TYPE_FILTER_TABS[number],
): boolean {
  if (typeFilter === 'All Types') return true
  return classifyType(assetType, unitNumber) === typeFilter
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
    vin: (r.vin ?? (r as any).vin_override ?? '') as string,
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
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTER_TABS)[number]>('All')
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTER_TABS)[number]>('All Types')
  const [showInactive, setShowInactive] = useState(false)

  const [qboClasses, setQboClasses] = useState<QboClass[]>([])
  const [qboClassMappings, setQboClassMappings] = useState<Record<string, AssetQboClassMapping>>({})
  const [qboClassInput, setQboClassInput] = useState('')
  const [savingQboClass, setSavingQboClass] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [assetsRes, mappingRes] = await Promise.all([
        fetchAssets(),
        fetch('/api/fleet/assets/qbo-classes', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .catch(() => ({ mappings: [] })),
      ])
      setRows(assetsRes.assets)
      const nextMappings: Record<string, AssetQboClassMapping> = {}
      const mappings = Array.isArray(mappingRes?.mappings) ? mappingRes.mappings : []
      mappings.forEach((m: any) => {
        const unit = String(m?.unit_number || '').trim()
        if (!unit) return
        nextMappings[unit] = {
          unit_number: unit,
          qbo_class_id: String(m?.qbo_class_id || '').trim(),
          qbo_class_name: String(m?.qbo_class_name || '').trim(),
        }
      })
      setQboClassMappings(nextMappings)
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    const loadClasses = async () => {
      const master = await fetch('/api/qbo/master', { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .catch(() => ({}))
      if (cancelled) return
      const raw = Array.isArray((master as any)?.classes) ? (master as any).classes : []
      const normalized = raw
        .map((c: any) => ({
          qboId: String(c?.qboId || '').trim(),
          name: String(c?.name || '').trim(),
        }))
        .filter((c: QboClass) => Boolean(c.qboId && c.name))
      setQboClasses(normalized)
    }
    void loadClasses()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    const unit = String(draft.unit_number || '').trim()
    if (!unit) {
      setQboClassInput('')
      return
    }
    const mapping = qboClassMappings[unit]
    setQboClassInput(String(mapping?.qbo_class_name || ''))
  }, [modalOpen, draft.unit_number, qboClassMappings])

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

  const resolveQboClassFromInput = useCallback((raw: string) => {
    const value = String(raw || '').trim()
    if (!value) return null
    const key = value.toLowerCase()
    return qboClasses.find((c) => String(c.name || '').trim().toLowerCase() === key) || null
  }, [qboClasses])

  const saveQboClassMapping = useCallback(async (unitNumber: string) => {
    const unit = String(unitNumber || '').trim()
    if (!unit) return
    const match = resolveQboClassFromInput(qboClassInput)
    setSavingQboClass(true)
    try {
      const resp = await fetch('/api/fleet/assets/qbo-class', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          unit_number: unit,
          qbo_class_id: match?.qboId || '',
          qbo_class_name: match?.name || String(qboClassInput || '').trim(),
        }),
      }).then((r) => r.json())
      if (!resp?.ok) throw new Error(String(resp?.error || 'Failed to save QBO class'))
      const savedName = match?.name || String(qboClassInput || '').trim()
      setQboClassMappings((prev) => ({
        ...prev,
        [unit]: { unit_number: unit, qbo_class_id: match?.qboId || '', qbo_class_name: savedName },
      }))
      setQboClassInput(savedName)
      showToast('✅ Saved', 'success')
    } catch (e) {
      setErr(String((e as Error).message || e))
      showToast('❌ Error saving QBO class', 'error')
    } finally {
      setSavingQboClass(false)
    }
  }, [qboClassInput, resolveQboClassFromInput])

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
      {
        id: 'currentDriver',
        label: 'Current Driver',
        width: 130,
        render: (r) => {
          const driver = String((r as any).currentDriver || (r as any).currentDriverName || (r as any).current_driver_name || '').trim()
          return driver || '—'
        },
      },
      { id: 'make', label: 'Make', width: 80, render: (r) => String((r as any).make || (r as any).make_override || '').trim() || '—' },
      { id: 'model', label: 'Model', width: 80, render: (r) => String((r as any).model || (r as any).model_override || '').trim() || '—' },
      { id: 'year', label: 'Year', width: 56, render: (r) => (r.year ?? (r as any).year_override ?? '—') },
      { id: 'vin', label: 'VIN', width: 120, render: (r) => String((r as any).vin || (r as any).vin_override || '').trim() || '—' },
      { id: 'plate', label: 'License Plate', width: 92, render: (r) => String((r as any).license_plate || (r as any).licensePlate || (r as any).license_plate_override || '').trim() || '—' },
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

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const normalizedStatus = normalizeStatusForFilter(row.status)
      const statusTabOk = statusFilter === 'All' ? true : normalizedStatus === statusFilter
      const activeVisibilityOk = showInactive ? true : normalizedStatus === 'Active'
      const typeOk = matchesTypeFilter(row.asset_type, row.unit_number, typeFilter)
      return statusTabOk && activeVisibilityOk && typeOk
    })
  }, [rows, statusFilter, typeFilter, showInactive])

  const data: Row[] = filteredRows.map((r) => ({ ...r }))

  return (
    <div className="lists-db">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Vehicles database — Fleet & Samsara</h3>
          <p className="muted tiny lists-db__sub">
            Master vehicle records for maintenance/accounting. Pulls from Samsara and remains editable locally.
          </p>
        </div>
        <div className="lists-db__actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn sm ghost shared-list__head-btn"
            onClick={() => setShowInactive((v) => !v)}
            style={{
              background: showInactive ? '#3b82f6' : 'transparent',
              color: showInactive ? '#fff' : '#8892a4',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
            }}
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
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
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">QuickBooks Class</span>
            <input
              className="list-edit-field__inp"
              type="text"
              list="qboClassList"
              placeholder="Type to search QBO classes..."
              value={qboClassInput}
              onChange={(e) => setQboClassInput(e.target.value)}
            />
            <datalist id="qboClassList">
              {qboClasses.map((c) => (
                <option key={c.qboId} value={c.name} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn sm ghost"
              style={{ marginTop: 6 }}
              onClick={() => void saveQboClassMapping(draft.unit_number)}
              disabled={savingQboClass || !String(draft.unit_number || '').trim()}
            >
              {savingQboClass ? 'Saving...' : 'Save QBO class'}
            </button>
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Notes</span>
            <textarea className="list-edit-field__inp" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={3} />
          </label>
        </div>
      </ListItemEditModal>

      <div style={{ display: 'grid', gap: 8, margin: '10px 0 12px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted tiny" style={{ minWidth: 56 }}>Status</span>
          {STATUS_FILTER_TABS.map((tab) => {
            const active = statusFilter === tab
            return (
              <button
                key={tab}
                type="button"
                className="btn sm"
                onClick={() => setStatusFilter(tab)}
                style={{
                  background: active ? '#3b82f6' : 'transparent',
                  color: active ? '#fff' : '#8892a4',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                }}
              >
                {tab}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted tiny" style={{ minWidth: 56 }}>Type</span>
          {TYPE_FILTER_TABS.map((tab) => {
            const active = typeFilter === tab
            return (
              <button
                key={tab}
                type="button"
                className="btn sm"
                onClick={() => setTypeFilter(tab)}
                style={{
                  background: active ? '#3b82f6' : 'transparent',
                  color: active ? '#fff' : '#8892a4',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                }}
              >
                {tab}
              </button>
            )
          })}
        </div>
      </div>

      <SharedListTable<Row>
        title="Vehicles"
        itemCount={filteredRows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search unit, name, VIN, make, model…"
        searchKeys={['unit_number', 'vin', 'make', 'model', 'asset_type', 'status', 'currentDriver', 'currentDriverName', 'current_driver_name']}
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
        onBulkTypeChange={async (type, selectedRows) => {
          const ids = selectedRows
            .map((row) => String((row as AssetRow).unit_number || '').trim())
            .filter(Boolean)
          if (!ids.length) return
          setErr(null)
          try {
            const resp = await fetch('/api/fleet/assets/bulk', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids, asset_type: type }),
            })
            const data = await resp.json().catch(() => ({ ok: false, error: 'Invalid server response' }))
            if (!resp.ok || !data?.ok) {
              setErr(String(data?.error || 'Bulk type update failed'))
              return
            }
            setSamMsg(`${Number(data.updated || 0)} unit(s) type set to ${type}.`)
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
