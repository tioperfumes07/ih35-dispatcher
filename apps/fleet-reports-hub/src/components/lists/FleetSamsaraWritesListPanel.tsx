import { useCallback, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'
import type { FleetWriteRow } from '../../data/mockCatalogLists'
import { INITIAL_FLEET_WRITE_ROWS } from '../../data/mockCatalogLists'

type Row = FleetWriteRow & Record<string, unknown>

function newId() {
  return `fw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function sortByUnit(list: FleetWriteRow[]) {
  return [...list].sort((a, b) => a.unit.localeCompare(b.unit))
}

export function FleetSamsaraWritesListPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<FleetWriteRow[]>(() => sortByUnit(INITIAL_FLEET_WRITE_ROWS))
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    unit: '',
    writeType: '',
    value: '',
    lastWritten: '',
    status: 'active',
  })

  const openAdd = () => {
    setFormErr(null)
    setEditingId(null)
    setDraft({
      unit: '',
      writeType: 'Odometer',
      value: '',
      lastWritten: new Date().toISOString().slice(0, 10),
      status: 'active',
    })
    setModalOpen(true)
  }

  const openEdit = (r: FleetWriteRow) => {
    setFormErr(null)
    setEditingId(r.id)
    setDraft({
      unit: r.unit,
      writeType: r.writeType,
      value: r.value,
      lastWritten: r.lastWritten.slice(0, 10),
      status: r.status,
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setFormErr(null)
    setModalOpen(false)
    setEditingId(null)
  }

  const persist = (): boolean => {
    if (!draft.unit.trim()) {
      setFormErr('Unit # is required.')
      return false
    }
    setFormErr(null)
    const next: FleetWriteRow = {
      id: editingId ?? newId(),
      unit: draft.unit.trim(),
      writeType: draft.writeType.trim() || '—',
      value: draft.value.trim() || '—',
      lastWritten: draft.lastWritten.trim() || new Date().toISOString().slice(0, 10),
      status: draft.status,
    }
    setRows((prev) => {
      if (editingId == null) return sortByUnit([...prev, next])
      return sortByUnit(prev.map((r) => (r.id === editingId ? next : r)))
    })
    return true
  }

  const save = () => {
    if (!persist()) return
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'u', label: 'Unit #', width: 72, render: (r) => r.unit },
      { id: 'w', label: 'Write type', width: 100, render: (r) => r.writeType },
      { id: 'v', label: 'Value', width: 88, render: (r) => r.value },
      { id: 'lw', label: 'Last written', width: 100, render: (r) => r.lastWritten },
      { id: 'st', label: 'Status', width: 72, render: (r) => r.status },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  const handleDelete = useCallback((r: Row) => {
    const row = r as FleetWriteRow
    if (!window.confirm(`Delete write row for ${row.unit}?`)) return
    setRows((prev) => prev.filter((x) => x.id !== row.id))
  }, [])

  return (
    <>
      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add fleet write row' : 'Edit fleet write row'}
        subtitle="Demo telemetry log — not persisted to Samsara."
        onClose={closeModal}
        onSave={save}
      >
        <div className="list-edit-form">
          {formErr ? (
            <p className="nm-banner nm-banner--err" role="alert">
              {formErr}
            </p>
          ) : null}
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Unit #</span>
            <input
              className="list-edit-field__inp"
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              disabled={editingId != null}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Write type</span>
            <input
              className="list-edit-field__inp"
              value={draft.writeType}
              onChange={(e) => setDraft((d) => ({ ...d, writeType: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Value</span>
            <input
              className="list-edit-field__inp"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Last written</span>
            <input
              className="list-edit-field__inp"
              type="date"
              value={draft.lastWritten}
              onChange={(e) => setDraft((d) => ({ ...d, lastWritten: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Status</span>
            <select
              className="list-edit-field__sel"
              value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            >
              <option value="active">OK</option>
              <option value="inactive">Error</option>
            </select>
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Fleet & Samsara writes"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => r.id}
        searchPlaceholder="Search unit, write type…"
        searchKeys={['unit', 'writeType', 'value']}
        exportFilename="FleetSamsaraWrites"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        onEdit={(r) => openEdit(r as FleetWriteRow)}
        onDelete={handleDelete}
        onDeactivate={(r) => {
          setRows((prev) =>
            prev.map((x) => (x.id === (r as FleetWriteRow).id ? { ...x, status: 'inactive' } : x)),
          )
        }}
        onActivate={(r) => {
          setRows((prev) =>
            prev.map((x) => (x.id === (r as FleetWriteRow).id ? { ...x, status: 'active' } : x)),
          )
        }}
      />
    </>
  )
}
