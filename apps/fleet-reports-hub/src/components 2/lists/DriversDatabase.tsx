import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'
import type { DriverPatch, DriverRow } from '../../lib/fleetRegistriesApi'
import {
  createDriver,
  deleteDriver,
  fetchDrivers,
  patchDriver,
  syncDriversQbo,
  syncDriversSamsara,
} from '../../lib/fleetRegistriesApi'

/** Match telematics-style registry refresh cadence. */
const SAMSARA_REGISTRY_POLL_MS = 60_000

type Row = DriverRow & Record<string, unknown>

type Draft = {
  full_name: string
  first_name: string
  last_name: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  phone: string
  email: string
  cdl_number: string
  cdl_state: string
  cdl_expiry: string
  assigned_unit: string
}

function rowToDraft(r: DriverRow): Draft {
  return {
    full_name: r.full_name ?? '',
    first_name: r.first_name ?? '',
    last_name: r.last_name ?? '',
    address: r.address ?? '',
    city: r.city ?? '',
    state: r.state ?? '',
    zip: r.zip ?? '',
    country: r.country ?? 'USA',
    phone: r.phone ?? '',
    email: r.email ?? '',
    cdl_number: r.cdl_number ?? '',
    cdl_state: r.cdl_state ?? '',
    cdl_expiry: r.cdl_expiry ?? '',
    assigned_unit: r.assigned_unit ?? '',
  }
}

function emptyDraft(): Draft {
  return {
    full_name: '',
    first_name: '',
    last_name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'USA',
    phone: '',
    email: '',
    cdl_number: '',
    cdl_state: '',
    cdl_expiry: '',
    assigned_unit: '',
  }
}

function draftToPatch(d: Draft): DriverPatch {
  const p: DriverPatch = {
    full_name: d.full_name.trim(),
    first_name: d.first_name.trim() || null,
    last_name: d.last_name.trim() || null,
    address: d.address.trim() || null,
    city: d.city.trim() || null,
    state: d.state.trim() || null,
    zip: d.zip.trim() || null,
    country: d.country.trim() || null,
    phone: d.phone.trim() || null,
    email: d.email.trim() || null,
    cdl_number: d.cdl_number.trim() || null,
    cdl_state: d.cdl_state.trim() || null,
    cdl_expiry: d.cdl_expiry.trim() || null,
    assigned_unit: d.assigned_unit.trim() || null,
  }
  return p
}

export function DriversDatabase({
  onCloseList,
}: {
  onCloseList: () => void
}) {
  const [rows, setRows] = useState<DriverRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [samMsg, setSamMsg] = useState<string | null>(null)
  const [lastSamSyncAt, setLastSamSyncAt] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())

  const load = useCallback(async () => {
    setErr(null)
    try {
      const j = await fetchDrivers()
      setRows(j.drivers)
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
        const r = await syncDriversSamsara()
        const synced = Number(r.synced ?? 0)
        const fail = Number(r.errors?.length ?? 0)
        if (synced <= 0) {
          setSamMsg('Samsara returned 0 drivers. Check SAMSARA_API_TOKEN / driver read scope.')
        } else if (fail > 0) {
          setSamMsg(`Samsara sync: ${synced} driver(s) synced, ${fail} failed.`)
        } else {
          setSamMsg(`Samsara sync complete: ${synced} driver(s) synced.`)
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

  const onSyncSam = () => void runSamsaraSync()

  const onPushQbo = async () => {
    setErr(null)
    try {
      const r = await syncDriversQbo()
      const n = r.synced ?? r.updated ?? 0
      const fail = r.errors?.length
      setSamMsg(
        fail
          ? `QBO sync: ${n} ok, ${fail} failed — see error banner.`
          : `QBO vendor sync finished for ${n} driver(s).`,
      )
      if (fail) setErr(r.errors!.map((e) => `#${e.id}: ${e.error}`).join('\n'))
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

  const openEdit = (r: DriverRow) => {
    setEditingId(r.id)
    setDraft(rowToDraft(r))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const persistDriver = async () => {
    if (!draft.full_name.trim()) {
      alert('Full name is required.')
      throw new Error('validation')
    }
    if (editingId == null) {
      const { driver } = await createDriver({ full_name: draft.full_name.trim() })
      await patchDriver(driver.id, draftToPatch(draft))
    } else {
      await patchDriver(editingId, draftToPatch(draft))
    }
  }

  const saveDraft = async () => {
    try {
      await persistDriver()
    } catch {
      return
    }
    await load()
    closeModal()
  }

  const saveAndPushQbo = async () => {
    try {
      await persistDriver()
    } catch {
      return
    }
    await syncDriversQbo()
    await load()
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'full_name', label: 'Full name', width: 160, render: (r) => r.full_name },
      { id: 'address', label: 'Address', width: 120, render: (r) => r.address ?? '—' },
      { id: 'city', label: 'City', width: 88, render: (r) => r.city ?? '—' },
      { id: 'state', label: 'State', width: 56, render: (r) => r.state ?? '—' },
      { id: 'zip', label: 'ZIP', width: 64, render: (r) => r.zip ?? '—' },
      { id: 'phone', label: 'Phone', width: 100, render: (r) => r.phone ?? '—' },
      { id: 'email', label: 'Email', width: 140, render: (r) => r.email ?? '—' },
      { id: 'cdl', label: 'CDL #', width: 88, render: (r) => r.cdl_number ?? '—' },
      {
        id: 'unit',
        label: 'Assigned unit',
        width: 88,
        render: (r) =>
          r.assigned_unit ? (
            <span className="lists-db__pill lists-db__pill--info">{r.assigned_unit}</span>
          ) : (
            '—'
          ),
      },
      {
        id: 'qbo',
        label: 'QBO vendor',
        width: 96,
        render: (r) =>
          r.qbo_synced ? (
            <span className="lists-db__pill lists-db__pill--ok">Synced</span>
          ) : r.qbo_vendor_id ? (
            <span className="lists-db__pill lists-db__pill--warn">Pending</span>
          ) : (
            '—'
          ),
      },
      { id: 'status', label: 'Status', width: 72, render: (r) => r.status },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  const toolbarExtra = (
    <>
      <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void load()}>
        Refresh
      </button>
      <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void onSyncSam()}>
        Sync from Samsara
      </button>
      <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void onPushQbo()}>
        Push all to QBO
      </button>
    </>
  )

  return (
    <div className="lists-db lists-db--drivers">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Drivers database</h3>
          <p className="muted tiny lists-db__sub">
            QuickBooks vendor format — address, city, state, ZIP — sync from Samsara; push to QBO when
            connected (local <code>qbo_tokens.json</code> on the fleet API host).
          </p>
        </div>
        <div className="lists-db__actions">
          <button type="button" className="btn sm primary shared-list__head-btn" onClick={openAdd}>
            + Add driver
          </button>
        </div>
      </div>
      <div className="lists-db__banner lists-db__banner--info muted tiny">
        Drivers auto-sync to QuickBooks vendors — name, address, phone, email pushed to QBO on save. Unit
        assets auto-link as QBO Class.
      </div>
      <div className="lists-db__banner lists-db__banner--ok muted tiny">
        {samMsg ??
          (lastSamSyncAt
            ? `Samsara · last sync ${new Date(lastSamSyncAt).toLocaleString()} · auto every 60s`
            : 'Samsara: use Sync from Samsara to pull drivers when a read token is configured.')}
      </div>
      {err ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      ) : null}

      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add driver' : 'Edit driver'}
        subtitle="Fields map to QuickBooks Vendor (DisplayName, BillAddr, phone, email)."
        onClose={closeModal}
        onSave={saveDraft}
        extraSaveButton={
          <button type="button" className="btn sm success" onClick={() => void saveAndPushQbo()}>
            Save &amp; push to QBO
          </button>
        }
      >
        <div className="list-edit-form">
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Full name</span>
            <input
              className="list-edit-field__inp"
              value={draft.full_name}
              onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">First name</span>
            <input
              className="list-edit-field__inp"
              value={draft.first_name}
              onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Last name</span>
            <input
              className="list-edit-field__inp"
              value={draft.last_name}
              onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Street address</span>
            <input
              className="list-edit-field__inp"
              value={draft.address}
              onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">City</span>
            <input
              className="list-edit-field__inp"
              value={draft.city}
              onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">State</span>
            <input
              className="list-edit-field__inp"
              value={draft.state}
              onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">ZIP</span>
            <input
              className="list-edit-field__inp"
              value={draft.zip}
              onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Country</span>
            <input
              className="list-edit-field__inp"
              value={draft.country}
              onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Phone</span>
            <input
              className="list-edit-field__inp"
              value={draft.phone}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Email</span>
            <input
              className="list-edit-field__inp"
              value={draft.email}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">CDL #</span>
            <input
              className="list-edit-field__inp"
              value={draft.cdl_number}
              onChange={(e) => setDraft((d) => ({ ...d, cdl_number: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">CDL state</span>
            <input
              className="list-edit-field__inp"
              value={draft.cdl_state}
              onChange={(e) => setDraft((d) => ({ ...d, cdl_state: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">CDL expiry</span>
            <input
              className="list-edit-field__inp"
              type="date"
              value={(draft.cdl_expiry || '').slice(0, 10)}
              onChange={(e) => setDraft((d) => ({ ...d, cdl_expiry: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Assigned unit</span>
            <input
              className="list-edit-field__inp"
              value={draft.assigned_unit}
              onChange={(e) => setDraft((d) => ({ ...d, assigned_unit: e.target.value }))}
            />
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Drivers"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search name, phone, CDL…"
        searchKeys={['full_name', 'phone', 'cdl_number', 'email']}
        exportFilename="DriverList"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        toolbarExtra={toolbarExtra}
        onEdit={(r) => openEdit(r as DriverRow)}
        onDelete={async (r) => {
          if (!window.confirm(`Delete driver ${(r as DriverRow).full_name}?`)) return
          await deleteDriver((r as DriverRow).id)
          await load()
        }}
        onDeactivate={async (r) => {
          await patchDriver((r as DriverRow).id, { status: 'inactive' })
          await load()
        }}
        onActivate={async (r) => {
          await patchDriver((r as DriverRow).id, { status: 'active' })
          await load()
        }}
      />
    </div>
  )
}
