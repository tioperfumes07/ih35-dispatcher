import { useState } from 'react'
import {
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
  type IntegrityThresholds,
} from '../../lib/integrityThresholds'
import { INTEGRITY_RULE_DOCS } from '../../data/integrityCheckDocs'

const FIELDS: { key: keyof IntegrityThresholds; label: string; rule?: string }[] = [
  {
    key: 'fleet_avg_miles_per_month',
    label: 'Fleet avg miles / month (PM month floor)',
    rule: 'FLOOR(interval_miles ÷ this value) for “months at fleet avg”',
  },
  { key: 't1_max_tires_per_unit_90d', label: 'T1 max tires / unit / 90d', rule: INTEGRITY_RULE_DOCS.T1 },
  { key: 't2_same_position_max_180d', label: 'T2 same position max / 180d', rule: INTEGRITY_RULE_DOCS.T2 },
  { key: 't3_cost_vs_avg_multiplier', label: 'T3 cost vs avg (×)', rule: INTEGRITY_RULE_DOCS.T3 },
  { key: 't4_fleet_tires_per_month', label: 'T4 fleet tires / month', rule: INTEGRITY_RULE_DOCS.T4 },
  { key: 'd1_repairs_per_driver_90d', label: 'D1 repairs / driver / 90d', rule: INTEGRITY_RULE_DOCS.D1 },
  { key: 'd2_accidents_per_driver_year', label: 'D2 accidents / driver / year', rule: INTEGRITY_RULE_DOCS.D2 },
  { key: 'd3_driver_spend_90d', label: 'D3 driver spend / 90d ($)', rule: INTEGRITY_RULE_DOCS.D3 },
  { key: 'd4_same_driver_unit_60d', label: 'D4 same driver+unit / 60d', rule: INTEGRITY_RULE_DOCS.D4 },
  { key: 'f1_consumption_pct_above_avg', label: 'F1 consumption % above avg', rule: INTEGRITY_RULE_DOCS.F1 },
  { key: 'f4_price_spike_pct', label: 'F4 price spike %', rule: INTEGRITY_RULE_DOCS.F4 },
  { key: 'm1_single_repair_vs_avg', label: 'M1 single repair vs avg (×)', rule: INTEGRITY_RULE_DOCS.M1 },
  { key: 'm2_monthly_spend_per_unit', label: 'M2 monthly $ / unit', rule: INTEGRITY_RULE_DOCS.M2 },
  { key: 'm3_records_per_unit_60d', label: 'M3 records / unit / 60d', rule: INTEGRITY_RULE_DOCS.M3 },
  { key: 'm4_vendor_invoice_pct_above_avg', label: 'M4 vendor % above avg', rule: INTEGRITY_RULE_DOCS.M4 },
]

export function IntegrityThresholdSettings() {
  const [t, setT] = useState<IntegrityThresholds>(() => loadThresholds())
  const [saved, setSaved] = useState(false)

  const set = (key: keyof IntegrityThresholds, v: number) => {
    setT((prev) => ({ ...prev, [key]: v }))
    setSaved(false)
  }

  const reset = () => {
    setT({ ...DEFAULT_THRESHOLDS })
    saveThresholds(DEFAULT_THRESHOLDS)
    setSaved(true)
  }

  const persist = () => {
    saveThresholds(t)
    setT(loadThresholds())
    setSaved(true)
  }

  return (
    <div className="maint-form integrity-settings">
      <h3>Integrity thresholds</h3>
      <p className="muted small">
        Stored in browser for this demo; wire to tenant settings API in production.
      </p>
      <div className="integrity-settings__grid">
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            {f.rule && <span className="muted tiny">{f.rule}</span>}
            <input
              type="number"
              step={f.key.includes('pct') || f.key.includes('multiplier') ? 0.1 : 1}
              value={t[f.key]}
              onChange={(e) => set(f.key, parseFloat(e.target.value) || 0)}
            />
          </label>
        ))}
      </div>
      <div className="integrity-settings__actions">
        <button type="button" className="btn primary" onClick={persist}>
          Save thresholds
        </button>
        <button type="button" className="btn ghost" onClick={reset}>
          Reset defaults
        </button>
        {saved && <span className="muted small">Saved.</span>}
      </div>
    </div>
  )
}
