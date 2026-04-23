import { useMemo, useState } from 'react'
import type { MaintFleetCategory, MaintFleetUnit } from '../../data/maintFleetUnits'

type Props = {
  units: MaintFleetUnit[]
  fleetFilter: MaintFleetCategory | 'all'
  selectedId: string
  onSelect: (id: string) => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** Double-click a unit: open work order shell modal with that unit (Maintenance board). */
  onOpenRecordModal?: (unitId: string) => void
}

export function MaintUnitListColumn({
  units,
  fleetFilter,
  selectedId,
  onSelect,
  collapsed,
  onCollapsedChange,
  onOpenRecordModal,
}: Props) {
  const [q, setQ] = useState('')
  const [svc, setSvc] = useState('')

  const filtered = useMemo(() => {
    const a = fleetFilter === 'all' ? units : units.filter((u) => u.fleet === fleetFilter)
    const n = q.trim().toLowerCase()
    const s = svc.trim().toLowerCase()
    return a.filter((u) => {
      if (n && !u.unitNo.toLowerCase().includes(n) && !u.makeModel.toLowerCase().includes(n))
        return false
      if (s && !u.serviceHaystack.includes(s)) return false
      return true
    })
  }, [units, fleetFilter, q, svc])

  return (
    <div className={'maint-unit-col' + (collapsed ? ' maint-unit-col--collapsed' : '')}>
      <button
        type="button"
        className="maint-unit-col__collapse"
        onClick={() => onCollapsedChange(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand unit list' : 'Collapse unit list'}
        title={collapsed ? 'Expand unit list' : 'Collapse unit list'}
      >
        {collapsed ? '▸' : '◂'}
      </button>
      <div className="maint-unit-col__inner">
        {!collapsed && (
          <>
            <div className="maint-unit-col__search">
              <span className="maint-unit-col__search-icon" aria-hidden />
              <input
                type="search"
                className="maint-unit-col__search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search units…"
                aria-label="Search units"
              />
            </div>
            <label className="maint-unit-col__svc">
              <span className="muted tiny">Filter by service</span>
              <input
                value={svc}
                onChange={(e) => setSvc(e.target.value)}
                placeholder="e.g. pm, reefer…"
              />
            </label>
          </>
        )}
        <ul className="maint-unit-col__list">
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={
                  'maint-unit-card' +
                  (u.id === selectedId ? ' maint-unit-card--selected' : '') +
                  (u.pastDue ? ' maint-unit-card--due' : '')
                }
                onClick={() => onSelect(u.id)}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  onOpenRecordModal?.(u.id)
                }}
                title={
                  collapsed
                    ? `${u.unitNo} · ${u.makeModel} · ${u.mileage.toLocaleString()} mi${
                        onOpenRecordModal ? ' · Double-click: open record' : ''
                      }`
                    : onOpenRecordModal
                      ? 'Double-click to open work order for this unit'
                      : undefined
                }
              >
                <span
                  className={
                    'maint-unit-card__avatar' + (u.pastDue ? ' maint-unit-card__avatar--bad' : '')
                  }
                  aria-hidden
                >
                  {u.unitNo.slice(-2)}
                </span>
                {!collapsed && (
                  <span className="maint-unit-card__body">
                    <span className="maint-unit-card__no">{u.unitNo}</span>
                    <span className="maint-unit-card__mm">{u.makeModel}</span>
                    <span className="maint-unit-card__mi">{u.mileage.toLocaleString()} mi</span>
                    <span className="maint-unit-card__fuel" aria-hidden>
                      <span
                        className="maint-unit-card__fuel-fill"
                        style={{ width: `${Math.min(100, Math.max(0, u.fuelPct))}%` }}
                      />
                    </span>
                    <span className="maint-unit-card__pills">
                      {u.pastDue ? <span className="maint-pill maint-pill--bad">Past due</span> : null}
                      {u.dueSoon && !u.pastDue ? (
                        <span className="maint-pill maint-pill--soon">Due soon</span>
                      ) : null}
                    </span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {!collapsed && filtered.length === 0 && (
          <p className="muted small maint-unit-col__empty">No units match filters.</p>
        )}
      </div>
    </div>
  )
}
