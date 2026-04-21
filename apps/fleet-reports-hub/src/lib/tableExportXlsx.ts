import * as XLSX from 'xlsx'

export type ExportDomTableOpts = {
  /** When true, `baseFileName` is used as the full stem (no trailing `-YYYY-MM-DD` added). */
  omitDateSuffix?: boolean
}

/** Export a live DOM table to .xlsx (uses project `xlsx` dependency). */
export function exportDomTableToXlsx(
  table: HTMLTableElement | null,
  baseFileName: string,
  opts?: ExportDomTableOpts,
): void {
  if (!table) return
  const day = new Date().toISOString().slice(0, 10)
  const safe = baseFileName.replace(/[^\w.-]+/g, '_')
  const ws = XLSX.utils.table_to_sheet(table, { raw: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Export')
  const fileName = opts?.omitDateSuffix ? `${safe}.xlsx` : `${safe}-${day}.xlsx`
  XLSX.writeFile(wb, fileName)
}

/** Export plain objects (e.g. catalog rows) to .xlsx */
export function exportJsonRowsToXlsx(
  rows: object[],
  baseFileName: string,
  sheetName = 'Data',
): void {
  if (!rows.length) return
  const day = new Date().toISOString().slice(0, 10)
  const safe = baseFileName.replace(/[^\w.-]+/g, '_')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, `${safe}-${day}.xlsx`)
}

/** Multi-sheet workbook (e.g. work order categories + items). */
export function exportJsonSheetsToXlsx(
  sheets: { name: string; rows: object[] }[],
  baseFileName: string,
  opts?: ExportDomTableOpts,
): void {
  const usable = sheets.filter((s) => s.rows.length > 0)
  if (!usable.length) return
  const wb = XLSX.utils.book_new()
  for (const s of usable) {
    const ws = XLSX.utils.json_to_sheet(s.rows)
    const safeName = s.name.replace(/[\[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet'
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  const day = new Date().toISOString().slice(0, 10)
  const safe = baseFileName.replace(/[^\w.-]+/g, '_')
  const fileName = opts?.omitDateSuffix ? `${safe}.xlsx` : `${safe}-${day}.xlsx`
  XLSX.writeFile(wb, fileName)
}
