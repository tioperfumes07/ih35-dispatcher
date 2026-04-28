import { useCallback, useEffect, useMemo, useState } from 'react'
import { showToast } from '../ui/Toast'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import type { AssetRow } from '../../lib/fleetRegistriesApi'
import {
  fetchAssets,
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

function normalizeDutyStatus(raw: unknown): 'driving' | 'onduty' | 'offduty' | 'unknown' {
  const v = String(raw || '').replace(/[\s_\-]+/g, '').trim().toLowerCase()
  if (v === 'driving') return 'driving'
  if (v === 'onduty' || v === 'on') return 'onduty'
  if (v === 'offduty' || v === 'off') return 'offduty'
  return 'unknown'
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

export function AssetsDatabase({ onCloseList }: { onCloseList: () => void }) {
  const READ_ONLY = true
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
  void setModalOpen
  void editingId
  void setEditingId
  void setDraft
  void qboClasses
  void qboClassMappings
  void qboClassInput
  void setQboClassInput
  void savingQboClass

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
      if (READ_ONLY) return
      if (!opts?.quiet) setErr(null)
      try {
        const r = await Promise.resolve({ totalVehicles: 0, synced: 0, inserted: 0, skippedNoUnit: 0 })
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
    if (READ_ONLY) return
    void runSamsaraSync({ quiet: true })
    const id = window.setInterval(() => void runSamsaraSync({ quiet: true }), SAMSARA_REGISTRY_POLL_MS)
    return () => window.clearInterval(id)
  }, [READ_ONLY, runSamsaraSync])

  const onSam = () => void runSamsaraSync()

  const onQbo = async () => {
    if (READ_ONLY) return
    setErr(null)
    try {
      const r = await Promise.resolve({ errors: [] as { id: string; unit?: string; error: string }[] })
      const fail = r.errors?.length
      if (fail) setErr(r.errors!.map((e) => `#${e.id} ${e.unit ?? ''}: ${e.error}`).join('\n'))
      await load()
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }

  const openAdd = () => {
    if (READ_ONLY) return
    setErr(null)
    setDraft(emptyDraft())
  }

  const openEdit = (r: AssetRow) => {
    if (READ_ONLY) return
    setErr(null)
    setDraft(rowToDraft(r, metaMap[String(r.id)]))
  }

  const resolveQboClassFromInput = useCallback((raw: string) => {
    const value = String(raw || '').trim()
    if (!value) return null
    const key = value.toLowerCase()
    return qboClasses.find((c) => String(c.name || '').trim().toLowerCase() === key) || null
  }, [qboClasses])

  const saveQboClassMapping = useCallback(async (unitNumber: string) => {
    if (READ_ONLY) return
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
    if (READ_ONLY) return -1
    if (!draft.unit_number.trim()) {
      setErr('Unit # is required.')
      throw new Error('validation')
    }
    return -1
  }

  const saveMetaFromDraft = (id: number) => {
    updateMetaForId(id, {
      name: draft.name.trim() || draft.unit_number.trim(),
      notes: draft.notes.trim(),
    })
  }

  const save = async () => {
    if (READ_ONLY) return
    let id = -1
    try {
      id = await persist()
    } catch {
      return
    }
    if (id > 0) saveMetaFromDraft(id)
    await load()
  }

  const saveAndSyncClasses = async () => {
    if (READ_ONLY) return
    let id = -1
    try {
      id = await persist()
    } catch {
      return
    }
    if (id > 0) saveMetaFromDraft(id)
    await load()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'unit', label: 'Unit#', width: 70, render: (r) => <span className="lists-db__pill lists-db__pill--info">{r.unit_number}</span> },
      { id: 'name', label: 'Name', width: 100, render: (r) => metaMap[String(r.id)]?.name || r.unit_number },
      {
        id: 'currentDriver',
        label: 'Current Driver',
        width: 170,
        render: (r) => {
          const row = r as any
          const driver = String(row.currentDriver || row.currentDriverName || row.current_driver_name || '').trim()
          if (!driver) return '—'

          const duty = normalizeDutyStatus(row.currentDriverStatus)
          const badgeMeta = duty === 'driving'
            ? { text: '🟢 driving', bg: 'rgba(34,197,94,0.18)', color: '#bbf7d0', border: 'rgba(34,197,94,0.35)' }
            : duty === 'onduty'
              ? { text: '🟡 onDuty', bg: 'rgba(234,179,8,0.18)', color: '#fef08a', border: 'rgba(234,179,8,0.35)' }
              : duty === 'offduty'
                ? { text: '⚪ offDuty', bg: 'rgba(148,163,184,0.16)', color: '#e2e8f0', border: 'rgba(148,163,184,0.35)' }
                : null

          return (
            <div style={{ display: 'grid', gap: 4 }}>
              <span>{driver}</span>
              {badgeMeta ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    width: 'fit-content',
                    padding: '1px 7px',
                    borderRadius: 999,
                    fontSize: 11,
                    lineHeight: 1.4,
                    background: badgeMeta.bg,
                    color: badgeMeta.color,
                    border: `1px solid ${badgeMeta.border}`,
                  }}
                >
                  {badgeMeta.text}
                </span>
              ) : null}
            </div>
          )
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
  void onSam
  void onQbo
  void openAdd
  void openEdit
  void saveQboClassMapping
  void save
  void saveAndSyncClasses

  return (
    <div className="lists-db">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Vehicles database — Fleet & Samsara</h3>
          <p className="muted tiny lists-db__sub">
            Master vehicle records for maintenance/accounting. View, search, filter, and export only.
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
        toolbarExtra={
          <>
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void load()}>
              Refresh
            </button>
          </>
        }
      />
    </div>
  )
}
