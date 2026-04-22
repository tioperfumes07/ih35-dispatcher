import type { ReportFilters, ServiceLocationFilterType } from '../types'
import { MOCK_RECORD_TYPES, MOCK_SERVICE_TYPES, MOCK_UNITS } from '../data/reports'
import { IntegrationSidebarFooter } from './IntegrationSidebarFooter'
import { MultiSelectFilterField } from './MultiSelectFilterField'
import { MultiSelectField } from './reports/MultiSelectField'

type Props = {
  draft: ReportFilters
  applied: ReportFilters
  onChange: (next: ReportFilters) => void
  onApply: () => void
  onReset: () => void
}

function chipLabel(key: keyof ReportFilters, v: ReportFilters): string | null {
  const val = v[key]
  if (val === '' || val === null || val === undefined) return null
  if (Array.isArray(val)) {
    if (val.length === 0) return null
    if (key === 'recordTypes') {
      return val.length === 1
        ? `Record type: ${val[0]}`
        : `Record types: ${val.join(', ')}`
    }
    return `${String(key)}: ${val.join(', ')}`
  }
  if (key === 'dateQuick' && val) return `Date: ${String(val)}`
  if (key === 'dateFrom' && v.dateFrom) return `From: ${v.dateFrom}`
  if (key === 'dateTo' && v.dateTo) return `To: ${v.dateTo}`
  if (key === 'groupBy' && v.groupBy === 'unit') return null
  if (key === 'sortBy' && v.sortBy === 'date_desc') return null
  if (key === 'locationType' && v.locationType) {
    return `Location type: ${String(v.locationType)}`
  }
  return `${String(key)}: ${String(val)}`
}

export function appliedChips(filters: ReportFilters) {
  const skipCustomDates = Boolean(filters.dateQuick)
  const keys: (keyof ReportFilters)[] = [
    'dateQuick',
    ...(!skipCustomDates ? (['dateFrom', 'dateTo'] as const) : []),
    'units',
    'serviceTypes',
    'recordTypes',
    'location',
    'locationType',
    'vendor',
    'driver',
    'make',
    'costMin',
    'costMax',
    'groupBy',
    'sortBy',
  ]
  const out: string[] = []
  for (const k of keys) {
    const s = chipLabel(k, filters)
    if (s) out.push(s)
  }
  return out
}

function formatUnitLabel(v: string) {
  return /^\d+$/.test(String(v)) ? `Unit ${v}` : v
}

function formatServiceLabel(v: string) {
  return v
}

export function FilterPanel({ draft, applied, onChange, onApply, onReset }: Props) {
  const set = (patch: Partial<ReportFilters>) => onChange({ ...draft, ...patch })

  return (
    <aside className="filter-panel filter-panel--reports" aria-label="Report filters">
      <div className="filter-panel__head">
        <h2 className="filter-panel__title">Filters</h2>
        <p className="filter-panel__sub muted">Draft until you apply.</p>
      </div>

      <label className="field field--reports">
        <span className="field__label">Date quick</span>
        <select
          value={draft.dateQuick}
          onChange={(e) =>
            set({
              dateQuick: e.target.value as ReportFilters['dateQuick'],
            })
          }
        >
          <option value="">Custom range</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="mtd">Month to date</option>
          <option value="qtd">Quarter to date</option>
          <option value="ytd">Year to date</option>
        </select>
      </label>

      <div className="date-range-pair date-range-pair--reports">
        <label className="field field--reports">
          <span className="field__label">From</span>
          <input
            type="date"
            value={draft.dateFrom}
            onChange={(e) => set({ dateFrom: e.target.value })}
            disabled={!!draft.dateQuick}
          />
        </label>
        <label className="field field--reports">
          <span className="field__label">To</span>
          <input
            type="date"
            value={draft.dateTo}
            onChange={(e) => set({ dateTo: e.target.value })}
            disabled={!!draft.dateQuick}
          />
        </label>
      </div>

      <MultiSelectFilterField
        label="Units (multi)"
        optionValues={MOCK_UNITS}
        formatLabel={formatUnitLabel}
        selected={draft.units}
        onChange={(units) => set({ units })}
        listPlaceholder="Search units…"
      />

      <MultiSelectFilterField
        label="Service type (multi)"
        optionValues={MOCK_SERVICE_TYPES}
        formatLabel={formatServiceLabel}
        selected={draft.serviceTypes}
        onChange={(serviceTypes) => set({ serviceTypes })}
        listPlaceholder="Search service types…"
      />

      <MultiSelectField
        label="Record type (multi)"
        options={MOCK_RECORD_TYPES}
        value={draft.recordTypes}
        onChange={(recordTypes) => set({ recordTypes })}
        allowCustom
        customHint="record type"
        listPlaceholder="Search or add..."
      />

      <label className="field field--reports">
        <span className="field__label">Location</span>
        <input
          value={draft.location}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="State, terminal, geo fence."
        />
      </label>

      <label className="field field--reports">
        <span className="field__label">Location type (WO)</span>
        <select
          value={draft.locationType}
          onChange={(e) =>
            set({ locationType: e.target.value as ServiceLocationFilterType })
          }
        >
          <option value="">Any</option>
          <option value="internal">Internal</option>
          <option value="external">External</option>
          <option value="roadside">Roadside</option>
          <option value="dealer">Dealer</option>
        </select>
      </label>

      <label className="field field--reports">
        <span className="field__label">Vendor</span>
        <input
          value={draft.vendor}
          onChange={(e) => set({ vendor: e.target.value })}
          placeholder="Vendor contains..."
        />
      </label>

      <label className="field field--reports">
        <span className="field__label">Driver</span>
        <input
          value={draft.driver}
          onChange={(e) => set({ driver: e.target.value })}
          placeholder="Driver name..."
        />
      </label>

      <div className="filter-panel__actions">
        <button type="button" className="btn primary" onClick={onApply}>
          Apply
        </button>
        <button type="button" className="btn ghost" onClick={onReset}>
          Reset all
        </button>
      </div>

      <div className="filter-panel__applied">
        <h3>Active filters</h3>
        {appliedChips(applied).length === 0 ? (
          <p className="muted">None — defaults only.</p>
        ) : (
          <ul className="chips">
            {appliedChips(applied).map((c) => (
              <li key={c} className="chip">
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      <IntegrationSidebarFooter />
    </aside>
  )
}
