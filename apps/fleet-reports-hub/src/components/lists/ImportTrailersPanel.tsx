import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

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
] as const

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

function detectedColumns(rawRows: Record<string, unknown>[]): string[] {
  const set = new Set<string>()
  rawRows.forEach((row) => {
    Object.keys(row || {}).forEach((k) => {
      const key = String(k || '').trim()
      if (key) set.add(key)
    })
  })
  return Array.from(set)
}

export function ImportTrailersPanel({ onCloseList }: { onCloseList: () => void }) {
  const [rows, setRows] = useState<TrailerImportRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [message, setMessage] = useState<string>('Upload a .xlsx or .csv file to bulk-import trailer records')
  const [messageTone, setMessageTone] = useState<'neutral' | 'success' | 'error'>('neutral')
  const [loading, setLoading] = useState(false)

  const parseFile = async (file: File) => {
    setMessage('Reading file...')
    setMessageTone('neutral')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0] || '']
    if (!ws) {
      setRows([])
      setColumns([])
      setMessage('No worksheet found in file.')
      setMessageTone('error')
      return
    }

    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const next = raw.map(normalizeRow).filter((r): r is TrailerImportRow => !!r)
    setRows(next)
    setColumns(detectedColumns(raw))
    setMessage(`Loaded ${next.length} row(s). Review column mapping below and click Import.`)
    setMessageTone('neutral')
  }

  const doImport = async () => {
    if (!rows.length || loading) return
    setLoading(true)
    setMessage('Importing trailers...')
    setMessageTone('neutral')
    try {
      // Preferred endpoint for trailer import; fallback keeps compatibility with older backend.
      let resp = await fetch('/api/fleet/assets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: rows }),
      })
      if (resp.status === 404) {
        resp = await fetch('/api/fleet/assets/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: rows }),
        })
      }
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || data?.ok === false) {
        const reason = String(data?.error || resp.statusText || 'Import failed').trim()
        setMessage('Import failed: ' + reason)
        setMessageTone('error')
      } else {
        const inserted = Number(data?.inserted || 0)
        const updated = Number(data?.updated || 0)
        const total = inserted + updated
        setMessage('Success: imported ' + String(total) + ' record(s).')
        setMessageTone('success')
      }
    } catch (e) {
      setMessage('Import failed: ' + String((e as Error).message || e))
      setMessageTone('error')
    } finally {
      setLoading(false)
    }
  }

  const preview = useMemo(() => rows.slice(0, 100), [rows])

  return (
    <section className="panel" style={{ padding: 12 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Import trailers</h3>
        <button type="button" className="btn sm ghost" onClick={onCloseList}>Close</button>
      </header>

      <p className="muted" style={{ marginTop: 0 }}>
        Upload a .xlsx or .csv file to bulk-import trailer records.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void parseFile(file)
          }}
        />
        <button type="button" className="btn sm primary" onClick={() => void doImport()} disabled={!rows.length || loading}>
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

      {!!columns.length ? (
        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Column mapping preview</strong>
          <div className="muted tiny" style={{ marginBottom: 6 }}>
            Detected columns: {columns.join(', ')}
          </div>
          <div className="muted tiny">
            Expected columns: {EXPECTED_COLUMNS.join(', ')}
          </div>
        </div>
      ) : null}

      {preview.length ? (
        <div className="table-wrap" style={{ maxHeight: '58vh' }}>
          <table>
            <thead>
              <tr>
                <th>Unit</th><th>Make</th><th>Model</th><th>Year</th><th>VIN</th><th>License plate</th><th>Type</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, idx) => (
                <tr key={String(r.unit_number) + '-' + String(idx)}>
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
