import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'
import type { VendorLocalPatch, VendorLocalRow } from '../../lib/fleetRegistriesApi'
import {
  createVendorLocal,
  deleteVendorLocal,
  fetchVendorsLocal,
  patchVendorLocal,
  syncVendorsFromQbo,
} from '../../lib/fleetRegistriesApi'

type Row = VendorLocalRow & Record<string, unknown>

type Draft = {
  display_name: string
  company_name: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  phone: string
  email: string
  vendor_type: string
  payment_terms: string
}

function rowToDraft(r: VendorLocalRow): Draft {
  return {
    display_name: r.display_name ?? '',
    company_name: r.company_name ?? '',
    address: r.address ?? '',
    city: r.city ?? '',
    state: r.state ?? '',
    zip: r.zip ?? '',
    country: r.country ?? 'USA',
    phone: r.phone ?? '',
    email: r.email ?? '',
    vendor_type: r.vendor_type ?? '',
    payment_terms: r.payment_terms ?? '',
  }
}

function emptyDraft(): Draft {
  return {
    display_name: '',
    company_name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'USA',
    phone: '',
    email: '',
    vendor_type: '',
    payment_terms: '',
  }
}

function toPatch(d: Draft): VendorLocalPatch {
  return {
    display_name: d.display_name.trim(),
    company_name: d.company_name.trim() || null,
    address: d.address.trim() || null,
    city: d.city.trim() || null,
    state: d.state.trim() || null,
    zip: d.zip.trim() || null,
    country: d.country.trim() || null,
    phone: d.phone.trim() || null,
    email: d.email.trim() || null,
    vendor_type: d.vendor_type.trim() || null,
    payment_terms: d.payment_terms.trim() || null,
  }
}

export function VendorsDatabase({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<VendorLocalRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [lastQboSyncAt, setLastQboSyncAt] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())

  const load = useCallback(async () => {
    setErr(null)
    try {
      const j = await fetchVendorsLocal()
      setRows(j.vendors)
    } catch (e) {
      setErr(String((e as Error).message || e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onSync = async () => {
    setErr(null)
    try {
      const r = await syncVendorsFromQbo()
      const synced = Number(r.synced ?? 0)
      if (synced <= 0) {
        setSyncMsg('QuickBooks sync returned 0 vendors. Check QBO connection and vendor permissions.')
      } else {
        setSyncMsg(
          r.message
            ? `${r.message} (${synced} vendor${synced === 1 ? '' : 's'} synced)`
            : `QuickBooks sync complete: ${synced} vendor${synced === 1 ? '' : 's'} synced.`,
        )
      }
      setLastQboSyncAt(r.refreshedAt ?? new Date().toISOString())
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

  const openEdit = (r: VendorLocalRow) => {
    setErr(null)
    setEditingId(r.id)
    setDraft(rowToDraft(r))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const persist = async () => {
    if (!draft.display_name.trim()) {
      setErr('Display name is required.')
      throw new Error('validation')
    }
    if (editingId == null) {
      const { vendor } = await createVendorLocal({ display_name: draft.display_name.trim() })
      await patchVendorLocal(vendor.id, toPatch(draft))
    } else {
      await patchVendorLocal(editingId, toPatch(draft))
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

  const saveAndPullQbo = async () => {
    try {
      await persist()
    } catch {
      return
    }
    await syncVendorsFromQbo()
    await load()
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'nm', label: 'Name', width: 160, render: (r) => r.display_name },
      { id: 'typ', label: 'Type', width: 72, render: (r) => r.vendor_type ?? '—' },
      { id: 'addr', label: 'Address', width: 120, render: (r) => r.address ?? '—' },
      { id: 'city', label: 'City', width: 88, render: (r) => r.city ?? '—' },
      { id: 'state', label: 'State', width: 56, render: (r) => r.state ?? '—' },
      { id: 'zip', label: 'ZIP', width: 64, render: (r) => r.zip ?? '—' },
      { id: 'phone', label: 'Phone', width: 100, render: (r) => r.phone ?? '—' },
      { id: 'email', label: 'Email', width: 140, render: (r) => r.email ?? '—' },
      { id: 'terms', label: 'Payment terms', width: 96, render: (r) => r.payment_terms ?? '—' },
      {
        id: 'qbo',
        label: 'QBO sync',
        width: 72,
        render: (r) => (r.qbo_synced ? 'Yes' : '—'),
      },
      { id: 'status', label: 'Status', width: 72, render: (r) => r.status },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  return (
    <div className="lists-db">
      <div className="lists-db__head">
        <div>
          <h3 className="lists-db__title">Vendors database</h3>
          <p className="muted tiny lists-db__sub">
            Local mirror of QuickBooks vendors — use <strong>Sync all from QBO</strong> when connected; full
            address and contact fields.
          </p>
        </div>
        <div className="lists-db__actions">
          <button type="button" className="btn sm primary shared-list__head-btn" onClick={openAdd}>
            + Add vendor
          </button>
        </div>
      </div>
      <div className="lists-db__banner lists-db__banner--ok muted tiny">
        {syncMsg ??
          (lastQboSyncAt
            ? `QuickBooks · last sync ${new Date(lastQboSyncAt).toLocaleString()}`
            : 'QuickBooks: use Sync all from QBO to refresh vendors when a QBO connection is configured.')}
      </div>
      {err ? (
        <p className="nm-banner nm-banner--err" role="alert">
          {err}
        </p>
      ) : null}

      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add vendor' : 'Edit vendor'}
        subtitle="Saved to vendors_local (SQLite)."
        onClose={closeModal}
        onSave={save}
        extraSaveButton={
          <button type="button" className="btn sm success" onClick={() => void saveAndPullQbo()}>
            Save &amp; sync from QBO
          </button>
        }
      >
        <div className="list-edit-form">
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Display name</span>
            <input
              className="list-edit-field__inp"
              value={draft.display_name}
              onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Company name</span>
            <input
              className="list-edit-field__inp"
              value={draft.company_name}
              onChange={(e) => setDraft((d) => ({ ...d, company_name: e.target.value }))}
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
            <span className="list-edit-field__lbl">Vendor type</span>
            <input
              className="list-edit-field__inp"
              value={draft.vendor_type}
              onChange={(e) => setDraft((d) => ({ ...d, vendor_type: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Payment terms</span>
            <input
              className="list-edit-field__inp"
              value={draft.payment_terms}
              onChange={(e) => setDraft((d) => ({ ...d, payment_terms: e.target.value }))}
            />
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Vendors"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search name, email…"
        searchKeys={['display_name', 'email', 'phone']}
        exportFilename="VendorList"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        toolbarExtra={
          <>
            <button type="button" className="btn sm ghost shared-list__head-btn" onClick={() => void load()}>
              Refresh
            </button>
            <button type="button" className="btn sm primary shared-list__head-btn" onClick={() => void onSync()}>
              Sync all from QBO
            </button>
          </>
        }
        onEdit={(r) => openEdit(r as VendorLocalRow)}
        onDelete={async (r) => {
          if (!window.confirm(`Delete vendor ${(r as VendorLocalRow).display_name}?`)) return
          await deleteVendorLocal((r as VendorLocalRow).id)
          await load()
        }}
        onDeactivate={async (r) => {
          await patchVendorLocal((r as VendorLocalRow).id, { status: 'inactive' })
          await load()
        }}
        onActivate={async (r) => {
          await patchVendorLocal((r as VendorLocalRow).id, { status: 'active' })
          await load()
        }}
      />
    </div>
  )
}
