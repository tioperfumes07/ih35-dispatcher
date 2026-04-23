import { useCallback, useMemo, useState } from 'react'
import type { SharedListColumn } from './SharedListTable'
import { SharedListTable } from './SharedListTable'
import { ListItemEditModal } from './ListItemEditModal'

type BankCsvRow = {
  id: string
  importedAt: string
  file: string
  vendor: string
  amount: string
  status: 'active' | 'inactive'
  notes: string
}

type Row = BankCsvRow & Record<string, unknown>

const INITIAL_ROWS: BankCsvRow[] = [
  {
    id: 'bank-1',
    importedAt: '2026-04-20',
    file: 'statement-apr-week3.csv',
    vendor: 'Pilot Flying J',
    amount: '1250.35',
    status: 'active',
    notes: 'Matched 8/10 transactions',
  },
  {
    id: 'bank-2',
    importedAt: '2026-04-18',
    file: 'statement-apr-week2.csv',
    vendor: "Love's",
    amount: '842.10',
    status: 'active',
    notes: 'Matched 6/6 transactions',
  },
  {
    id: 'bank-3',
    importedAt: '2026-04-16',
    file: 'statement-apr-week2-misc.csv',
    vendor: 'Misc vendors',
    amount: '214.92',
    status: 'inactive',
    notes: 'Needs manual vendor mapping',
  },
]

function newId() {
  return `bank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function sortRows(list: BankCsvRow[]) {
  return [...list].sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export function BankCsvMatchingListPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<BankCsvRow[]>(() => sortRows(INITIAL_ROWS))
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    importedAt: new Date().toISOString().slice(0, 10),
    file: '',
    vendor: '',
    amount: '',
    status: 'active',
    notes: '',
  })

  const openAdd = () => {
    setEditingId(null)
    setDraft({
      importedAt: new Date().toISOString().slice(0, 10),
      file: '',
      vendor: '',
      amount: '',
      status: 'active',
      notes: '',
    })
    setModalOpen(true)
  }

  const openEdit = (r: BankCsvRow) => {
    setEditingId(r.id)
    setDraft({
      importedAt: r.importedAt,
      file: r.file,
      vendor: r.vendor,
      amount: r.amount,
      status: r.status,
      notes: r.notes,
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const persist = (): boolean => {
    if (!draft.file.trim()) {
      alert('File name is required.')
      return false
    }
    const n = Number(draft.amount)
    if (!Number.isFinite(n) || n < 0) {
      alert('Amount must be a valid non-negative number.')
      return false
    }
    const next: BankCsvRow = {
      id: editingId ?? newId(),
      importedAt: draft.importedAt || new Date().toISOString().slice(0, 10),
      file: draft.file.trim(),
      vendor: draft.vendor.trim() || '—',
      amount: n.toFixed(2),
      status: draft.status as 'active' | 'inactive',
      notes: draft.notes.trim() || '—',
    }
    setRows((prev) => {
      if (editingId == null) return sortRows([...prev, next])
      return sortRows(prev.map((r) => (r.id === editingId ? next : r)))
    })
    return true
  }

  const save = () => {
    if (!persist()) return
    closeModal()
  }

  const cols: SharedListColumn<Row>[] = useMemo(
    () => [
      { id: 'dt', label: 'Imported', width: 94, render: (r) => r.importedAt },
      { id: 'f', label: 'File', width: 180, render: (r) => r.file },
      { id: 'v', label: 'Vendor', width: 120, render: (r) => r.vendor },
      {
        id: 'amt',
        label: 'Amount',
        width: 90,
        className: 'fr-td-right',
        render: (r) => `$${Number(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      { id: 'st', label: 'Status', width: 74, render: (r) => r.status },
      { id: 'n', label: 'Notes', width: 180, render: (r) => r.notes },
    ],
    [],
  )

  const data: Row[] = rows.map((r) => ({ ...r }))

  const handleDelete = useCallback((r: Row) => {
    const row = r as BankCsvRow
    if (!window.confirm(`Delete CSV import "${row.file}"?`)) return
    setRows((prev) => prev.filter((x) => x.id !== row.id))
  }, [])

  return (
    <>
      <ListItemEditModal
        open={modalOpen}
        title={editingId == null ? 'Add bank CSV import' : 'Edit bank CSV import'}
        subtitle="Session-only list to validate matching workflow and export behavior."
        onClose={closeModal}
        onSave={save}
      >
        <div className="list-edit-form">
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Imported date</span>
            <input
              className="list-edit-field__inp"
              type="date"
              value={draft.importedAt}
              onChange={(e) => setDraft((d) => ({ ...d, importedAt: e.target.value }))}
            />
          </label>
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">File name</span>
            <input
              className="list-edit-field__inp"
              value={draft.file}
              onChange={(e) => setDraft((d) => ({ ...d, file: e.target.value }))}
              placeholder="statement-apr-week4.csv"
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Vendor</span>
            <input
              className="list-edit-field__inp"
              value={draft.vendor}
              onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))}
              placeholder="Pilot Flying J"
            />
          </label>
          <label className="list-edit-field">
            <span className="list-edit-field__lbl">Amount</span>
            <input
              className="list-edit-field__inp"
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              inputMode="decimal"
              placeholder="0.00"
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
          <label className="list-edit-field list-edit-field--full">
            <span className="list-edit-field__lbl">Notes</span>
            <input
              className="list-edit-field__inp"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Matched 10/12 transactions"
            />
          </label>
        </div>
      </ListItemEditModal>

      <SharedListTable<Row>
        title="Bank CSV matching"
        itemCount={rows.length}
        columns={cols}
        data={data}
        rowKey={(r) => String(r.id)}
        searchPlaceholder="Search file, vendor, notes..."
        searchKeys={['file', 'vendor', 'notes', 'amount', 'importedAt']}
        exportFilename="BankCsvMatching"
        onCloseList={onCloseList}
        onAddNew={openAdd}
        onEdit={(r) => openEdit(r as BankCsvRow)}
        onDelete={handleDelete}
        onDeactivate={(r) => {
          setRows((prev) =>
            prev.map((x) => (x.id === (r as BankCsvRow).id ? { ...x, status: 'inactive' } : x)),
          )
        }}
        onActivate={(r) => {
          setRows((prev) =>
            prev.map((x) => (x.id === (r as BankCsvRow).id ? { ...x, status: 'active' } : x)),
          )
        }}
      />
    </>
  )
}
