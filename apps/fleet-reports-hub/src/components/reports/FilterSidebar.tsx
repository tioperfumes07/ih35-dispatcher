import { useMemo } from 'react'
import type { ReportFilters, ServiceLocationFilterType } from '../../types'
import { appliedChips } from '../FilterPanel'
import { IntegrationSidebarFooter } from '../IntegrationSidebarFooter'
import { MultiSelectField } from './MultiSelectField'
import {
  MOCK_RECORD_TYPES,
  MOCK_SERVICE_TYPES,
  MOCK_UNITS,
} from '../../data/reports'
import { MAINT_FLEET_UNITS } from '../../data/maintFleetUnits'

function unitOptionRank(label: string) {
  const m = /^Unit\s+(\d+)$/i.exec(label.trim())
  return m ? Number(m[1]) : 1e9
}

const UNIT_OPTIONS = (() => {
  const fromSeed = MOCK_UNITS.map((u) => `Unit ${u}`)
  const fromFleet = MAINT_FLEET_UNITS.map((u) => `Unit ${u.unitNo}`)
  return Array.from(new Set([...fromSeed, ...fromFleet])).sort(
    (a, b) => unitOptionRank(a) - unitOptionRank(b),
  )
})()

type Props = {
  draft: ReportFilters
  applied: ReportFilters
  onChange: (next: ReportFilters) => void
  onApply: () => void
  onReset: () => void
  /** Extra service names from live catalog (merged with defaults). */
  catalogServiceNames: string[]
}

export function FilterSidebar({
  draft,
  applied,
  onChange,
  onApply,
  onReset,
  catalogServiceNames,
}: Props) {
  const set = (patch: Partial<ReportFilters>) => onChange({ ...draft, ...patch })

  const serviceOptions = useMemo(
    () =>
      Array.from(
        new Set([...MOCK_SERVICE_TYPES, ...catalogServiceNames].filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [catalogServiceNames],
  )

  return (
    <aside className="fr-filter-sidebar" aria-label="Report filters">
      <div className="fr-filter-sidebar__head">
        <h2 className="fr-filter-sidebar__title">Filters</h2>
        <p className="fr-filter-sidebar__sub">Draft until you apply.</p>
      </div>

      <label className="fr-filter-field">
        <span className="fr-filter-field__lbl">Date quick</span>
        <select
          className="fr-filter-input"
          value={draft.dateQuick}
          onChange={(e) =>
            set({
              dateQuick: e.target.value as ReportFilters['dateQuick'],
            })
          }
        >
          <option value="30d">Last 30 days</option>
          <option value="7d">Last 7 days</option>
          <option value="mtd">This month</option>
          <option value="">Custom range</option>
        </select>
      </label>

      <div className="fr-filter-dates fr-filter-dates--tight">
        <label className="fr-filter-field fr-filter-field--half">
          <span className="fr-filter-field__lbl">From</span>
          <input
            className="fr-filter-input"
            type="text"
            inputMode="numeric"
            placeholder="mm/dd"
            value={draft.dateFrom}
            onChange={(e) => set({ dateFrom: e.target.value })}
          />
        </label>
        <label className="fr-filter-field fr-filter-field--half">
          <span className="fr-filter-field__lbl">To</span>
          <input
            className="fr-filter-input"
            type="text"
            inputMode="numeric"
            placeholder="mm/dd"
            value={draft.dateTo}
            onChange={(e) => set({ dateTo: e.target.value })}
          />
        </label>
      </div>

      <MultiSelectField
        label="Units (multi)"
        options={UNIT_OPTIONS}
        value={draft.units}
        onChange={(units) => set({ units })}
        allowCustom
        customHint="unit"
        listPlaceholder="Search or add..."
      />

      <MultiSelectField
        label="Service type (multi)"
        options={serviceOptions}
        value={draft.serviceTypes}
        onChange={(serviceTypes) => set({ serviceTypes })}
        allowCustom
        customHint="service type"
        listPlaceholder="Search or add..."
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

      <label className="fr-filter-field">
        <span className="fr-filter-field__lbl">Location</span>
        <input
          className="fr-filter-input"
          value={draft.location}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="State, terminal..."
        />
      </label>

      <label className="fr-filter-field">
        <span className="fr-filter-field__lbl">Location type (WO)</span>
        <select
          className="fr-filter-input"
          value={draft.locationType}
          onChange={(e) =>
            set({ locationType: e.target.value as ServiceLocationFilterType })
          }
        >
          <option value="">Any</option>
          <option value="internal">Terminal</option>
          <option value="dealer">Shop</option>
          <option value="roadside">Roadside</option>
        </select>
      </label>

      <label className="fr-filter-field">
        <span className="fr-filter-field__lbl">Vendor</span>
        <input
          className="fr-filter-input"
          value={draft.vendor}
          onChange={(e) => set({ vendor: e.target.value })}
          placeholder="Vendor contains..."
        />
      </label>

      <label className="fr-filter-field">
        <span className="fr-filter-field__lbl">Driver</span>
        <input
          className="fr-filter-input"
          value={draft.driver}
          onChange={(e) => set({ driver: e.target.value })}
          placeholder="Driver name..."
        />
      </label>

      <div className="fr-filter-sidebar__actions">
        <button type="button" className="btn primary fr-filter-btn" onClick={onApply}>
          Apply
        </button>
        <button type="button" className="btn ghost fr-filter-btn" onClick={onReset}>
          Reset all
        </button>
      </div>

      <div className="fr-filter-sidebar__applied">
        <div className="fr-filter-sidebar__applied-h">Active filters</div>
        {appliedChips(applied).length === 0 ? (
          <p className="muted fr-filter-sidebar__applied-none">None — defaults only.</p>
        ) : (
          <ul className="fr-filter-chips">
            {appliedChips(applied).map((c) => (
              <li key={c} className="chip sm">
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
