import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  deleteDriverScheduleEntry,
  fetchDriverHosStatus,
  fetchDriverProfiles,
  fetchDriverSchedule,
  saveDriverScheduleEntry,
  type DriverProfile,
  type DriverScheduleRow,
} from '../../lib/fleetRegistriesApi'

type Props = {
  focusUnit?: string | null
  onOpenDriverProfile: (unitNumber: string) => void
}

const LEAVE_TYPES = ['', 'Vacation', 'Sick', 'Personal', 'Sin Aviso', 'Bank Holiday', 'WFH']
const LEAVE_COLORS: Record<string, string> = {
  Vacation: '#3B82F6',
  Sick: '#F97316',
  Personal: '#EAB308',
  'Sin Aviso': '#EF4444',
  'Bank Holiday': '#6B7280',
  WFH: '#22C55E',
}
const HOS_COLORS: Record<string, string> = {
  driving: '#22C55E',
  on_duty: '#EAB308',
  off_duty: '#9CA3AF',
  sleeper: '#A855F7',
  out_of_service: '#EF4444',
}

function monthIso(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function daysForMonth(date: Date): Date[] {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => new Date(Date.UTC(y, m, i + 1)))
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function DriverSchedulerPage({ focusUnit, onOpenDriverProfile }: Props) {
  const [monthDate, setMonthDate] = useState(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  })
  const [drivers, setDrivers] = useState<DriverProfile[]>([])
  const [scheduleRows, setScheduleRows] = useState<DriverScheduleRow[]>([])
  const [hosRows, setHosRows] = useState<Array<Record<string, unknown>>>([])
  const [teamFilter, setTeamFilter] = useState('')
  const [managerFilter, setManagerFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const m = monthIso(monthDate)
      const [profiles, schedule, hos] = await Promise.all([
        fetchDriverProfiles(),
        fetchDriverSchedule(m),
        fetchDriverHosStatus(),
      ])
      setDrivers(Array.isArray(profiles.drivers) ? profiles.drivers : [])
      setScheduleRows(Array.isArray(schedule.rows) ? schedule.rows : [])
      setHosRows(Array.isArray(hos.rows) ? hos.rows : [])
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [monthDate])

  useEffect(() => {
    const t = window.setInterval(() => {
      void fetchDriverHosStatus().then((x) => setHosRows(Array.isArray(x.rows) ? x.rows : [])).catch(() => {})
    }, 60000)
    return () => window.clearInterval(t)
  }, [])

  const days = useMemo(() => daysForMonth(monthDate), [monthDate])

  const filteredDrivers = useMemo(() => {
    const unitFocus = String(focusUnit || '').trim().toLowerCase()
    return drivers.filter((d) => {
      if (unitFocus && String(d.unit_number || '').toLowerCase() !== unitFocus) return false
      if (teamFilter && String(d.team || '') !== teamFilter) return false
      if (managerFilter && String(d.manager || '') !== managerFilter) return false
      return true
    })
  }, [drivers, focusUnit, teamFilter, managerFilter])

  const scheduleMap = useMemo(() => {
    const m = new Map<string, DriverScheduleRow>()
    scheduleRows.forEach((r) => {
      m.set(`${r.unit_number}|${r.date}`, r)
    })
    return m
  }, [scheduleRows])

  const hosByUnit = useMemo(() => {
    const map = new Map<string, string>()
    hosRows.forEach((h) => {
      const vehicle = String((h.vehicleName as string) || (h.vehicle as string) || '').trim()
      const status = String((h.dutyStatus as string) || (h.status as string) || '').trim().toLowerCase()
      if (vehicle) map.set(vehicle, status)
    })
    return map
  }, [hosRows])

  const updateCell = async (unit: string, date: string, leaveType: string) => {
    const cur = scheduleMap.get(`${unit}|${date}`)
    if (!leaveType) {
      if (cur) await deleteDriverScheduleEntry(cur.id)
      await load()
      return
    }
    if (cur) await deleteDriverScheduleEntry(cur.id)
    await saveDriverScheduleEntry({ unit_number: unit, date, leave_type: leaveType })
    await load()
  }

  const exportExcel = () => {
    const rows: Array<Record<string, string | number>> = []
    filteredDrivers.forEach((d) => {
      const r: Record<string, string | number> = {
        Unit: d.unit_number,
        Driver: d.full_name || 'Vacante',
      }
      days.forEach((day) => {
        const key = `${d.unit_number}|${toIsoDay(day)}`
        r[toIsoDay(day)] = scheduleMap.get(key)?.leave_type || ''
      })
      rows.push(r)
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Scheduler')
    XLSX.writeFile(wb, `driver-scheduler-${monthIso(monthDate)}.xlsx`)
  }

  const summaryRows = useMemo(() => {
    return filteredDrivers.map((d) => {
      const unit = d.unit_number
      const entries = days.map((day) => scheduleMap.get(`${unit}|${toIsoDay(day)}`)?.leave_type || '')
      const vacation = entries.filter((x) => x === 'Vacation').length
      const sick = entries.filter((x) => x === 'Sick').length
      const wfh = entries.filter((x) => x === 'WFH').length
      const other = entries.filter((x) => !!x && !['Vacation', 'Sick', 'WFH'].includes(x)).length
      return {
        driver: d.full_name || 'Vacante',
        unit,
        total: vacation + sick + other,
        vacation,
        sick,
        other,
        wfh,
      }
    })
  }, [filteredDrivers, days, scheduleMap])

  const teams = Array.from(new Set(drivers.map((d) => String(d.team || '').trim()).filter(Boolean))).sort()
  const managers = Array.from(new Set(drivers.map((d) => String(d.manager || '').trim()).filter(Boolean))).sort()

  return (
    <section className="panel" style={{ padding: 10 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Driver / Vacation Scheduler</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={() => setMonthDate((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)))}>Previous</button>
          <strong style={{ alignSelf: 'center' }}>{monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
          <button type="button" className="btn sm" onClick={() => setMonthDate((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))}>Next</button>
          <button type="button" className="btn sm ghost" onClick={exportExcel}>Export to Excel</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)}>
          <option value="">All managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="button" className="btn sm ghost" onClick={() => void load()}>{loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      {error ? <p className="nm-banner nm-banner--err">{error}</p> : null}

      <div className="table-wrap" style={{ maxHeight: '58vh' }}>
        <table>
          <thead>
            <tr>
              <th>Unit / Driver</th>
              {days.map((d) => (
                <th key={toIsoDay(d)}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredDrivers.map((driver) => {
              const duty = hosByUnit.get(driver.unit_number) || 'off_duty'
              const dutyColor = HOS_COLORS[duty] || HOS_COLORS.off_duty
              return (
                <tr key={driver.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn sm ghost" onClick={() => onOpenDriverProfile(driver.unit_number)}>
                      {driver.unit_number} · {driver.full_name || 'Vacante'}
                    </button>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: dutyColor, marginLeft: 6 }} />
                  </td>
                  {days.map((d) => {
                    const dayIso = toIsoDay(d)
                    const cur = scheduleMap.get(`${driver.unit_number}|${dayIso}`)
                    const leaveType = cur?.leave_type || ''
                    return (
                      <td key={dayIso}>
                        <select
                          value={leaveType}
                          onChange={(e) => {
                            void updateCell(driver.unit_number, dayIso, e.target.value)
                          }}
                          style={{
                            minWidth: 92,
                            background: leaveType ? `${LEAVE_COLORS[leaveType] || '#f3f4f6'}22` : undefined,
                            borderColor: leaveType ? LEAVE_COLORS[leaveType] || '#d1d5db' : undefined,
                          }}
                        >
                          {LEAVE_TYPES.map((t) => (
                            <option key={t || 'working'} value={t}>{t || 'Working'}</option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 14 }}>Monthly totals</h3>
      <div className="table-wrap" style={{ maxHeight: '28vh' }}>
        <table>
          <thead><tr><th>Driver</th><th>Unit</th><th>Total Absence</th><th>Vacation</th><th>Sick</th><th>Other</th><th>WFH</th></tr></thead>
          <tbody>
            {summaryRows.map((r) => (
              <tr key={`${r.unit}-sum`}>
                <td>{r.driver}</td>
                <td>{r.unit}</td>
                <td>{r.total}</td>
                <td>{r.vacation}</td>
                <td>{r.sick}</td>
                <td>{r.other}</td>
                <td>{r.wfh}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
