import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { importFleetAssetsBulk } from '../../lib/fleetRegistriesApi'
import { BulkActionBar } from '../ui/BulkActionBar'

type TrailerImportRow = {
  unit_number: string
  make?: string
  model?: string
  year?: number
  vin?: string
  license_plate?: string
  asset_type?: string
  notes?: string
}

const EXPECTED_COLUMNS = [
  'unit_number',
  'make',
  'model',
  'year',
  'vin',
  'license_plate',
  'asset_type',
  'notes',
]

function normalizeRow(raw: Record<string, unknown>): TrailerImportRow | null {
  const unit = String(raw.unit_number ?? raw.Unit ?? raw.unit ?? '').trim()
  if (!unit) return null
  const yearNum = Number(raw.year)
  return {
    unit_number: unit,
    make: String(raw.make ?? '').trim() || undefined,
    model: String(raw.model ?? '').trim() || undefined,
    year: Number.isFinite(yearNum) ? yearNum : undefined,
    vin: String(raw.vin ?? '').trim() || undefined,
    license_plate: String(raw.license_plate ?? raw.plate ?? '').trim() || undefined,
    asset_type: String(raw.asset_type ?? 'Trailer').trim() || 'Trailer',
    notes: String(raw.notes ?? '').trim() || undefined,
  }
}

function exportSelectedCsv(rows: TrailerImportRow[]) {
  const esc = (v: unknown) => {
    const text = String(v ?? '')
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  const headers = ['Unit', 'Make', 'Model', 'Year', 'VIN', 'License plate', 'Type', 'Notes']
  const body = rows
    .map((r) => [r.unit_number, r.make || '', r.model || '', r.year ?? '', r.vin || '', r.license_plate || '', r.asset_type || 'Trailer', r.notes || '']
      .map(esc)
      .join(','))
    .join('\n')
  const csv = `${headers.map(esc).join(',')}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = 'import-trailers-selected.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

export function ImportTrailersPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<TrailerImportRow[]>([])
  const [message, setMessage] = useState<string>('Upload .xlsx or .csv to preview trailer rows before import.')
  const [messageTone, setMessageTone] = useState<'neutral' | 'success' | 'error'>('neutral')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const canImport = rows.length > 0 && !loading

  const parseFile = async (file: File) => {
    setMessage('Reading file...')
    setMessageTone('neutral')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0] || '']
    if (!ws) {
      setRows([])
      setMessage('No worksheet found in file.')
      setMessageTone('error')
      return
    }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const next = raw.map(normalizeRow).filter((r): r is TrailerImportRow => !!r)
    setRows(next)
    setSelected(new Set())
    setMessage(`Loaded ${next.length} rows. Expected columns: ${EXPECTED_COLUMNS.join(', ')}`)
    setMessageTone('neutral')
  }

  const doImport = async () => {
    if (!canImport) return
    setLoading(true)
    setMessage('Importing rows...')
    setMessageTone('neutral')
    try {
      const res = await importFleetAssetsBulk(rows)
      setMessage(`✅ Import complete: ${res.inserted} inserted, ${res.updated} updated, ${res.errors} errors`)
      setMessageTone('success')
    } catch (e) {
      setMessage(`Import failed: ${String((e as Error).message || e)}`)
      setMessageTone('error')
    } finally {
      setLoading(false)
    }
  }

  const sample = useMemo(() => rows.slice(0, 200), [rows])
  const selectedRows = useMemo(
    () => sample.filter((r, idx) => selected.has(`${r.unit_number}-${idx}`)),
    [sample, selected],
  )

  return (
    <section className="panel" style={{ padding: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Import Trailers</h3>
        <button type="button" className="btn sm ghost" onClick={onCloseList}>Close</button>
      </header>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void parseFile(f)
          }}
        />
        <button type="button" className="btn sm primary" onClick={() => void doImport()} disabled={!canImport}>
          {loading ? 'Importing...' : 'Import'}
        </button>
      </div>
      <p
        className="muted"
        style={{
          marginTop: 0,
          color: messageTone === 'success' ? '#16a34a' : messageTone === 'error' ? '#dc2626' : undefined,
          fontWeight: messageTone === 'success' ? 600 : 400,
        }}
      >
        {message}
      </p>
      {sample.length ? (
        <>
          <div className="table-wrap" style={{ maxHeight: '58vh' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40, padding: '8px' }}>
                    <input
                      type="checkbox"
                      checked={sample.length > 0 && selected.size === sample.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(sample.map((r, idx) => `${r.unit_number}-${idx}`)) : new Set())
                      }
                    />
                  </th>
                  <th>Unit</th><th>Make</th><th>Model</th><th>Year</th><th>VIN</th><th>License plate</th><th>Type</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((r, idx) => {
                  const rowId = `${r.unit_number}-${idx}`
                  return (
                    <tr key={rowId} style={{ background: selected.has(rowId) ? 'rgba(59,130,246,0.1)' : undefined }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(rowId)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(rowId)
                            else next.delete(rowId)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td>{r.unit_number}</td>
                      <td>{r.make || '—'}</td>
                      <td>{r.model || '—'}</td>
                      <td>{r.year ?? '—'}</td>
                      <td>{r.vin || '—'}</td>
                      <td>{r.license_plate || '—'}</td>
                      <td>{r.asset_type || 'Trailer'}</td>
                      <td>{r.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <BulkActionBar
            selectedCount={selectedRows.length}
            totalCount={sample.length}
            onSelectAll={() => setSelected(new Set(sample.map((r, idx) => `${r.unit_number}-${idx}`)))}
            onClearSelection={() => setSelected(new Set())}
            actions={[
              {
                label: 'Export selected',
                onClick: () => exportSelectedCsv(selectedRows),
              },
            ]}
          />
        </>
      ) : null}
    </section>
  )
}
