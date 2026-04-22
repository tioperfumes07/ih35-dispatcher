import type { ReportDef, ReportFilters } from '../types'

function slug(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function smartFilename(
  report: ReportDef,
  filters: ReportFilters,
  ext: string,
) {
  const range =
    filters.dateQuick ||
    [filters.dateFrom, filters.dateTo].filter(Boolean).join('_to_') ||
    'range'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${report.id}_${slug(report.title)}_${slug(String(range))}_${stamp}.${ext}`
}
