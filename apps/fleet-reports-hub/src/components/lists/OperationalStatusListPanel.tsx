import { useCallback, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'
import type { OperationalStatusRow } from '../../data/mockCatalogLists'
import { INITIAL_OPERATIONAL_STATUS_ROWS } from '../../data/mockCatalogLists'

type Row = OperationalStatusRow & Record<string, unknown>

function newId() {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function OperationalStatusListPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<OperationalStatusRow[]>(() =>
    [...INITIAL_OPERATIONAL_STATUS_ROWS].sort((a, b) => a.label.localeCompare(b.label)),
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    label: '',
    color: '',
    description: '',
    sort: '',
    status: 'active',
  })

  const openAdd = () => {
    setFormErr(null)
    setEditingId(null)
    setDraft({
      label: '',
      color: 'var(--ok)',
      description: '',
      sort: '10',
      status: 'active',
    })
    setModalOpen(true)
  }

  const openEdit = (r: OperationalStatusRow) => {
    setFormErr(null)
    setEditingId(r.id)
    setDraft({
      label: r.label,
      color: r.color,
      description: r.description,
      sort: r.sort,
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
    if (!draft.label.trim()) {
      setFormErr('Label is required.')
      return false
    }
    setFormErr(null)
    const next: OperationalStatusRow = {
      id: editingId ?? newId(),
      label: draft.label.trim(),
      color: draft.color.trim() || 'var(--muted)',
      description: draft.description.trim() || '—',
      sort: draft.sort.trim() || '0',
      status: draft.status,
    }
    setRows((prev) => {
      if (editingId == null) return [...prev, next].sort((a, b) => a.label.localeCompare(b.label))
      return prev
        .map((r) => (r.id === editingId ? next : r))
        .sort((a, b) => a.label.localeCompare(b.label))
    })
    return true
  }

  const save = () => {
    if (!persist()) return
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'l', label: 'Label', width: 120, render: (r) => r.label },
      { id: 'c', label: 'Color', width: 80, render: (r) => r.color },
      { id: 'd', label: 'Description', width: 160, render: (r) => r.description },
      { id: 'a', label: 'Active', width: 64, render: (r) => r.status },
      { id: 's', label: 'Sort', width: 56, render: (r) => r.sort },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  const handleDelete = useCallback((r: Row) => {
    const row = r as OperationalStatusRow
    if (!window.confirm(`Delete status “${row.label}”?`)) return
    setRows((prev) => prev.filter((x) => x.id !== row.id))
  }, [])

  return (
    <>
      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add operational status' : 'Edit operational status'}
        subtitle="Demo list — changes stay in this browser session until you refresh."
        onClose={closeModal}
        onSave={save}
      >
        <div className="list-edit-form">
          {formErr ? (
            <p className="nm-banner nm-banner--err" role="alert">
              {formErr}
            </p>
          ) : null}
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Label</span>
            <input
              className="list-edit-field__inp"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Color (CSS)</span>
            <input
              className="list-edit-field__inp"
              value={draft.color}
              onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
              placeholder="var(--ok)"
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Description</span>
            <input
              className="list-edit-field__inp"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Sort</span>
            <input
              className="list-edit-field__inp"
              value={draft.sort}
              onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value }))}
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
            </select>
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Operational status labels"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => r.id}
        searchPlaceholder="Search label, description…"
        searchKeys={['label', 'description', 'sort']}
        exportFilename="OperationalStatus"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        onEdit={(r) => openEdit(r as OperationalStatusRow)}
        onDelete={handleDelete}
        onDeactivate={(r) => {
          setRows((prev) =>
            prev.map((x) =>
              x.id === (r as OperationalStatusRow).id ? { ...x, status: 'inactive' } : x,
            ),
          )
        }}
        onActivate={(r) => {
          setRows((prev) =>
            prev.map((x) =>
              x.id === (r as OperationalStatusRow).id ? { ...x, status: 'active' } : x,
            ),
          )
        }}
      />
    </>
  )
}
