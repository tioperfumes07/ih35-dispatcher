export type ReportCategory =
  | 'overview'
  | 'maintenance'
  | 'accounting'
  | 'compliance'
  | 'safety'
  | 'fuel'
  | 'operations'
  | 'dot'
  | 'custom'

export type ServiceLocationFilterType =
  | ''
  | 'internal'
  | 'external'
  | 'roadside'
  | 'dealer'

export type ReportViewerKind =
  | 'location_work_by_service'
  | 'location_internal_external'
  | 'location_all_summary'
  | 'dot_4i_service_locations'

export interface ReportDef {
  id: string
  title: string
  description: string
  category: ReportCategory
  tags: string[]
  /** QuickBooks Online proxy: GET /api/reports/qbo/:reportName */
  qboReportName?: string
  /** ERP or internal API hint */
  apiHint?: string
  hasChart?: boolean
  /** Rich layout in ReportViewer instead of generic mock table */
  viewer?: ReportViewerKind
  /** Load standalone Express HTML tool inside ReportViewer (same-origin iframe). */
  embedToolUrl?: string
}

export interface ReportFilters {
  dateFrom: string
  dateTo: string
  dateQuick: '' | '7d' | '30d' | 'mtd' | 'qtd' | 'ytd'
  units: string[]
  serviceTypes: string[]
  /** Record type filter (UI: single “Any” or one kind; stored as 0–1 strings). */
  recordTypes: string[]
  location: string
  /** Service location category (WO shop type) */
  locationType: ServiceLocationFilterType
  vendor: string
  driver: string
  make: string
  costMin: string
  costMax: string
  groupBy: string
  sortBy: string
}

export const defaultFilters = (): ReportFilters => ({
  dateFrom: '',
  dateTo: '',
  dateQuick: '30d',
  units: [],
  serviceTypes: [],
  recordTypes: [],
  location: '',
  locationType: '',
  vendor: '',
  driver: '',
  make: '',
  costMin: '',
  costMax: '',
  groupBy: 'unit',
  sortBy: 'date_desc',
})
