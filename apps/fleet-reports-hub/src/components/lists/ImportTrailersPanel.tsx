import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { importFleetAssetsBulk } from '../../lib/fleetRegistriesApi'

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

export function ImportTrailersPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<TrailerImportRow[]>([])
  const [message, setMessage] = useState<string>('Upload .xlsx or .csv to preview trailer rows before import.')
  const [loading, setLoading] = useState(false)

  const canImport = rows.length > 0 && !loading

  const parseFile = async (file: File) => {
    setMessage('Reading file...')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0] || '']
    if (!ws) {
      setRows([])
      setMessage('No worksheet found in file.')
      return
    }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const next = raw.map(normalizeRow).filter((r): r is TrailerImportRow => !!r)
    setRows(next)
    setMessage(`Loaded ${next.length} rows. Expected columns: ${EXPECTED_COLUMNS.join(', ')}`)
  }

  const doImport = async () => {
    if (!canImport) return
    setLoading(true)
    setMessage('Importing rows...')
    try {
      const res = await importFleetAssetsBulk(rows)
      setMessage(`Import complete: ${res.inserted} inserted, ${res.updated} updated, ${res.errors} errors (total ${res.total}).`)
    } catch (e) {
      setMessage(`Import failed: ${String((e as Error).message || e)}`)
    } finally {
      setLoading(false)
    }
  }

  const sample = useMemo(() => rows.slice(0, 200), [rows])

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
      <p className="muted" style={{ marginTop: 0 }}>{message}</p>
      {sample.length ? (
        <div className="table-wrap" style={{ maxHeight: '58vh' }}>
          <table>
            <thead>
              <tr>
                <th>Unit</th><th>Make</th><th>Model</th><th>Year</th><th>VIN</th><th>License plate</th><th>Type</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((r, idx) => (
                <tr key={`${r.unit_number}-${idx}`}>
                  <td>{r.unit_number}</td>
                  <td>{r.make || '—'}</td>
                  <td>{r.model || '—'}</td>
                  <td>{r.year ?? '—'}</td>
                  <td>{r.vin || '—'}</td>
                  <td>{r.license_plate || '—'}</td>
                  <td>{r.asset_type || 'Trailer'}</td>
                  <td>{r.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
