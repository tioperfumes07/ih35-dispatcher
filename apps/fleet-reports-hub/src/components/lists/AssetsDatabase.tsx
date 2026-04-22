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

type Row = AssetRow & Record<string, unknown>

type Draft = {
  unit_number: string
  year: string
  make: string
  model: string
  vin: string
  license_plate: string
  license_state: string
  odometer_miles: string
  engine_hours: string
  fuel_type: string
  status: string
}

function rowToDraft(r: AssetRow): Draft {
  return {
    unit_number: r.unit_number ?? '',
    year: r.year != null ? String(r.year) : '',
    make: r.make ?? '',
    model: r.model ?? '',
    vin: r.vin ?? '',
    license_plate: r.license_plate ?? '',
    license_state: r.license_state ?? '',
    odometer_miles: r.odometer_miles != null ? String(r.odometer_miles) : '',
    engine_hours: r.engine_hours != null ? String(r.engine_hours) : '',
    fuel_type: r.fuel_type ?? '',
    status: r.status ?? 'active',
  }
}

function emptyDraft(): Draft {
  return {
    unit_number: '',
    year: '',
    make: '',
    model: '',
    vin: '',
    license_plate: '',
    license_state: '',
    odometer_miles: '',
    engine_hours: '',
    fuel_type: '',
    status: 'active',
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
    status: d.status.trim() || 'active',
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
    setEditingId(null)
    setDraft(emptyDraft())
    setModalOpen(true)
  }

  const openEdit = (r: AssetRow) => {
    setEditingId(r.id)
    setDraft(rowToDraft(r))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const persist = async () => {
    if (!draft.unit_number.trim()) {
      alert('Unit # is required.')
      throw new Error('validation')
    }
    if (editingId == null) {
      const { asset } = await createAsset({ unit_number: draft.unit_number.trim() })
      await patchAsset(asset.id, toPatch(draft))
    } else {
      await patchAsset(editingId, toPatch(draft))
    }
  }

  const save = async () => {
    try {
      await persist()
    } catch {
      return
    }
    await load()
    closeModal()
  }

  const saveAndSyncClasses = async () => {
    try {
      await persist()
    } catch {
      return
    }
    await syncAssetsQboClasses()
    await load()
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      {
        id: 'unit',
        label: 'Unit #',
        width: 72,
        render: (r) => <span className="lists-db__pill lists-db__pill--info">{r.unit_number}</span>,
      },
      { id: 'year', label: 'Year', width: 52, render: (r) => r.year ?? '—' },
      { id: 'make', label: 'Make', width: 88, render: (r) => r.make ?? '—' },
      { id: 'model', label: 'Model', width: 88, render: (r) => r.model ?? '—' },
      { id: 'vin', label: 'VIN', width: 120, render: (r) => r.vin ?? '—' },
      { id: 'odo', label: 'Odometer', width: 88, render: (r) => r.odometer_miles ?? '—' },
      { id: 'plate', label: 'License plate', width: 88, render: (r) => r.license_plate ?? '—' },
      {
        id: 'sid',
        label: 'Samsara ID',
        width: 100,
        render: (r) =>
          r.samsara_id ? <span className="lists-db__mono">{r.samsara_id}</span> : '—',
      },
      {
        id: 'cls',
        label: 'QBO Class',
        width: 96,
        render: (r) =>
          r.qbo_class_name || r.qbo_class_id ? (
            <span className="lists-db__pill lists-db__pill--info">{r.qbo_class_name ?? r.qbo_class_id}</span>
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        label: 'Status',
        width: 96,
        render: (r) => {
          const s = String(r.status || 'active').toLowerCase()
          if (s === 'inactive') return <span className="muted">Inactive</span>
          if (s === 'maintenance') return <span className="lists-db__pill lists-db__pill--warn">Maintenance</span>
          return <span className="lists-db__pill lists-db__pill--ok">Active</span>
        },
      },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  return (
    <div className="lists-db">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Assets — Samsara mirror (trucks)</h3>
          <p className="muted tiny lists-db__sub">
            Vehicles upsert from Samsara; QBO class name mirrors unit # in demo mode.
          </p>
        </div>
        <div className="lists-db__actions">
          <button type="button" className="btn sm primary shared-list__head-btn" onClick={openAdd}>
            + Add asset
          </button>
        </div>
      </div>
      <div className="lists-db__banner lists-db__banner--ok muted tiny">
        {samMsg ??
          `Samsara mirror · ${rows.length} trucks${lastSamSyncAt ? ` · last sync ${new Date(lastSamSyncAt).toLocaleString()}` : ''} · auto every 60s · Mirror is read-only from Samsara · editable locally · changes here do NOT push to Samsara.`}
      </div>
      {err ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      ) : null}

      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add asset' : 'Edit asset'}
        subtitle="Local edits only — Samsara sync overwrites telemetry fields when re-synced."
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
            <input
              className="list-edit-field__inp"
              value={draft.unit_number}
              onChange={(e) => setDraft((d) => ({ ...d, unit_number: e.target.value }))}
              disabled={editingId != null}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Year</span>
            <input
              className="list-edit-field__inp"
              value={draft.year}
              onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Make</span>
            <input
              className="list-edit-field__inp"
              value={draft.make}
              onChange={(e) => setDraft((d) => ({ ...d, make: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Model</span>
            <input
              className="list-edit-field__inp"
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">VIN</span>
            <input
              className="list-edit-field__inp"
              value={draft.vin}
              onChange={(e) => setDraft((d) => ({ ...d, vin: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">License plate</span>
            <input
              className="list-edit-field__inp"
              value={draft.license_plate}
              onChange={(e) => setDraft((d) => ({ ...d, license_plate: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">License state</span>
            <input
              className="list-edit-field__inp"
              value={draft.license_state}
              onChange={(e) => setDraft((d) => ({ ...d, license_state: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Odometer</span>
            <input
              className="list-edit-field__inp"
              value={draft.odometer_miles}
              onChange={(e) => setDraft((d) => ({ ...d, odometer_miles: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Engine hours</span>
            <input
              className="list-edit-field__inp"
              value={draft.engine_hours}
              onChange={(e) => setDraft((d) => ({ ...d, engine_hours: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Fuel type</span>
            <input
              className="list-edit-field__inp"
              value={draft.fuel_type}
              onChange={(e) => setDraft((d) => ({ ...d, fuel_type: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Status</span>
            <select
              className="list-edit-field__sel"
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Assets"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search unit, VIN, make…"
        searchKeys={['unit_number', 'vin', 'make', 'model']}
        exportFilename="AssetsDatabase"
        onCloseList={onCloseList}
        onAddNew={openAdd}
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
          if (!window.confirm(`Delete asset ${(r as AssetRow).unit_number}?`)) return
          await deleteAsset((r as AssetRow).id)
          await load()
        }}
        onDeactivate={async (r) => {
          await patchAsset((r as AssetRow).id, { status: 'inactive' })
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
