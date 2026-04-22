import type { ReportDef, ReportFilters } from '../types'
import { smartFilename } from './filename'
import type { MockRow } from './mockRows'

export function exportCsv(
  report: ReportDef,
  filters: ReportFilters,
  rows: MockRow[],
) {
  const headers = [
    'date',
    'unit',
    'driver',
    'vendor',
    'amount',
    'category',
    'location',
    'locationType',
    'recordKind',
  ]
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h as keyof MockRow]
          const s = String(v)
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(','),
    ),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = smartFilename(report, filters, 'csv')
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function exportExcel(
  report: ReportDef,
  filters: ReportFilters,
  rows: MockRow[],
) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const tableHeaders = [
    'Date',
    'Unit',
    'Driver',
    'Vendor',
    'Amount',
    'Category',
    'Location',
    'Location type',
    'Record',
  ]
  const aoa = [
    tableHeaders,
    ...rows.map((r) => [
      r.date,
      r.unit,
      r.driver,
      r.vendor,
      r.amount,
      r.category,
      r.location,
      r.locationType,
      r.recordKind,
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const widths = tableHeaders.map((h, colIdx) => {
    const lens = aoa.map((row) => String(row[colIdx] ?? '').length)
    const wch = Math.min(36, Math.max(h.length, ...lens) + 1)
    return { wch }
  })
  ws['!cols'] = widths
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', state: 'frozen' }
  XLSX.utils.book_append_sheet(wb, ws, 'Report')

  const filterRows = [
    ['Filter', 'Value'],
    ...Object.entries(filters).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.join('; ') : String(v ?? ''),
    ]),
  ]
  const wsFilters = XLSX.utils.aoa_to_sheet(filterRows)
  wsFilters['!cols'] = [{ wch: 22 }, { wch: 48 }]
  XLSX.utils.book_append_sheet(wb, wsFilters, 'Filters')

  const meta = [
    ['Key', 'Value'],
    ['Report ID', report.id],
    ['Title', report.title],
    ['Exported (UTC)', new Date().toISOString()],
    ['QBO proxy', report.qboReportName ? `/api/reports/qbo/${report.qboReportName}` : ''],
    ['API hint', report.apiHint ?? ''],
  ]
  const wsMeta = XLSX.utils.aoa_to_sheet(meta)
  wsMeta['!cols'] = [{ wch: 18 }, { wch: 56 }]
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta')

  XLSX.writeFile(wb, smartFilename(report, filters, 'xlsx'))
}

export function exportPdfPrint(report: ReportDef, filters: ReportFilters, rows: MockRow[]) {
  const w = window.open('', '_blank')
  if (!w) return
  const title = `${report.id} — ${report.title}`
  w.document.write(`<!doctype html><html><head><title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:16px;color:#111}
    h1{font-size:18px;margin:0 0 8px}
    table{border-collapse:collapse;width:100%;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px;text-align:left}
    th{background:#f3f4f6}
    .muted{color:#555;font-size:12px;margin-bottom:16px}
    @media print { button { display:none } }
  </style></head><body>`)
  w.document.write(`<h1>${title}</h1>`)
  w.document.write(
    `<p class="muted">Use your browser Print dialog → Save as PDF. Filename suggestion: <strong>${smartFilename(report, filters, 'pdf')}</strong></p>`,
  )
  w.document.write(
    '<button onclick="window.print()">Print / Save as PDF</button><table><thead><tr>',
  )
  const headers = [
    'Date',
    'Unit',
    'Driver',
    'Vendor',
    'Amount',
    'Category',
    'Location',
    'Loc. type',
    'Record',
  ]
  for (const h of headers) w.document.write(`<th>${h}</th>`)
  w.document.write('</tr></thead><tbody>')
  for (const r of rows) {
    w.document.write(
      `<tr><td>${r.date}</td><td>${r.unit}</td><td>${r.driver}</td><td>${r.vendor}</td><td>${r.amount}</td><td>${r.category}</td><td>${r.location}</td><td>${r.locationType}</td><td>${r.recordKind}</td></tr>`,
    )
  }
  w.document.write('</tbody></table></body></html>')
  w.document.close()
}
