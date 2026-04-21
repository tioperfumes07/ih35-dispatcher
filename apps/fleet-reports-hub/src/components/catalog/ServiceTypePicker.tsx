import { useEffect, useMemo, useRef, useState } from 'react'
import type { ServiceTypeRow } from '../../types/serviceCatalog'
import { FLEET_AVG_MILES_PER_MONTH } from '../../data/maintenanceScheduleData'

export function appliesToMake(s: ServiceTypeRow, makeKey: string) {
  const a = s.applies_to_makes || ['all']
  return a.includes('all') || a.includes(makeKey) || a.includes('generic')
}

export function formatServiceSubtitle(s: ServiceTypeRow) {
  if (s.interval_miles == null) return 'As needed'
  const mo = s.interval_months ?? Math.floor(s.interval_miles / FLEET_AVG_MILES_PER_MONTH)
  return `Every ${s.interval_miles.toLocaleString()} mi · ≈ ${mo} months`
}

export function formatServiceCostLine(s: ServiceTypeRow) {
  if (s.avg_cost_low == null && s.avg_cost_high == null) return '—'
  const lo = Math.round(s.avg_cost_low ?? 0)
  const hi = Math.round(s.avg_cost_high ?? 0)
  return `$${lo.toLocaleString()} – $${hi.toLocaleString()}`
}

type PickerProps = {
  vehicleMakeKey: string
  value: string
  onChange: (serviceKey: string) => void
  services: ServiceTypeRow[]
}

export function ServiceTypePicker({ vehicleMakeKey, value, onChange, services }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  const list = useMemo(() => {
    const base = services.filter((s) => appliesToMake(s, vehicleMakeKey))
    const n = q.trim().toLowerCase()
    if (!n) return base
    return base.filter(
      (s) =>
        s.service_name.toLowerCase().includes(n) || s.service_key.toLowerCase().includes(n),
    )
  }, [services, vehicleMakeKey, q])

  const selected = services.find((s) => s.service_key === value) || null

  return (
    <div className="svc-picker" ref={rootRef}>
      <label className="field">
        <span>Service type</span>
        <button
          type="button"
          className="svc-picker__trigger"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {selected ? (
            <span className="svc-picker__trigger-inner">
              <span className="svc-picker__name">{selected.service_name}</span>
              <span className="svc-picker__sub">{formatServiceSubtitle(selected)}</span>
              <span className="svc-picker__cost">{formatServiceCostLine(selected)}</span>
            </span>
          ) : (
            <span className="muted">Select service…</span>
          )}
        </button>
      </label>
      {open && (
        <div className="svc-picker__panel">
          <input
            className="svc-picker__search"
            placeholder="Filter…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="svc-picker__list" role="listbox">
            {list.map((s) => (
              <li key={s.service_key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === s.service_key}
                  className={value === s.service_key ? 'svc-picker__opt is-active' : 'svc-picker__opt'}
                  onClick={() => {
                    onChange(s.service_key)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  <span className="svc-picker__trigger-inner">
                    <span className="svc-picker__name">{s.service_name}</span>
                    <span className="svc-picker__sub">{formatServiceSubtitle(s)}</span>
                    <span className="svc-picker__cost">{formatServiceCostLine(s)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
