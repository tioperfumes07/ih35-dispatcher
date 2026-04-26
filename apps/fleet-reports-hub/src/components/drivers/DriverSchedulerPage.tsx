import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  deleteDriverScheduleEntry,
  fetchDriverHosStatus,
  fetchDriverProfiles,
  fetchDriverSchedule,
  saveDriverScheduleEntry,
  upsertDriverProfile,
  type DriverProfile,
  type DriverScheduleRow,
} from '../../lib/fleetRegistriesApi'

type Props = {
  focusUnit?: string | null
  onOpenDriverProfile: (unitNumber: string) => void
}

type SchedulerDriverRow = {
  id: number
  full_name: string | null
  unit_number: string
  team: string | null
  manager: string | null
  status: string | null
  phone?: string | null
  email?: string | null
  cdl_number?: string | null
  cdl_expiry?: string | null
  medical_expiry?: string | null
  notes?: string | null
}

type ScheduleEntry = { id?: number; leave_type: string }
type LeavePickerState = { key: string; unit_number: string; driver_id?: number | null; date: string; left: number; top: number }
type AddDriverDraft = {
  full_name: string; unit_number: string; team: string; manager: string; phone: string; email: string;
  cdl_number: string; cdl_expiry: string; medical_expiry: string; status: string; notes: string
}

const LEAVE_COLORS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  Vacacion: { bg: '#1e3a5f', text: '#93c5fd', dot: '#3b82f6', label: 'Vac' },
  Vacation: { bg: '#1e3a5f', text: '#93c5fd', dot: '#3b82f6', label: 'Vac' },
  Sick: { bg: '#431407', text: '#fed7aa', dot: '#f97316', label: 'Sick' },
  Personal: { bg: '#422006', text: '#fde68a', dot: '#eab308', label: 'Per' },
  'Sin Aviso': { bg: '#450a0a', text: '#fca5a5', dot: '#ef4444', label: 'SA' },
  'Bank Holiday': { bg: '#1f2937', text: '#9ca3af', dot: '#6b7280', label: 'Hol' },
  WFH: { bg: '#052e16', text: '#86efac', dot: '#22c55e', label: 'WFH' },
}

const LEAVE_PICKER_ROWS: Array<{ label: string; value: string; dot?: string; outlined?: boolean }> = [
  { label: 'Working', value: '', outlined: true },
  { label: 'Vacacion', value: 'Vacacion', dot: LEAVE_COLORS.Vacacion.dot },
  { label: 'Sick', value: 'Sick', dot: LEAVE_COLORS.Sick.dot },
  { label: 'Personal', value: 'Personal', dot: LEAVE_COLORS.Personal.dot },
  { label: 'Sin Aviso', value: 'Sin Aviso', dot: LEAVE_COLORS['Sin Aviso'].dot },
  { label: 'Bank Holiday', value: 'Bank Holiday', dot: LEAVE_COLORS['Bank Holiday'].dot },
  { label: 'WFH', value: 'WFH', dot: LEAVE_COLORS.WFH.dot },
]

const HOS_DOT_COLORS: Record<string, string> = {
  driving: '#22c55e', onduty: '#eab308', offduty: '#6b7280', sleeperberth: '#a855f7', outofservice: '#ef4444',
}

const inputStyle: CSSProperties = {
  width: '100%', background: '#0f1219', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '8px 10px', color: '#e2e8f0', fontSize: 13,
}

function fallbackDrivers(): SchedulerDriverRow[] {
  return Array.from({ length: 58 }, (_, i) => ({ id: -(i + 1), unit_number: `T${120 + i}`, full_name: 'Vacante', team: '', manager: '', status: 'Vacante' }))
}
const dayAbbrevIso = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${iso}T00:00:00`))
const fmtRangePart = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00`))
const fmtRangeYear = (iso: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
const normalizeDutyStatus = (raw: unknown) => String(raw || '').replace(/[_\s-]+/g, '').trim().toLowerCase()
type ApprovedLeaveRequest = {
  id?: number
  unit_number?: string | null
  start_date?: string | null
  end_date?: string | null
  leave_type?: string | null
  status?: string | null
}

const normalizeLeaveType = (raw: unknown): string => {
  const value = String(raw || '').trim()
  const k = value.toLowerCase().replace(/[_\-]+/g, ' ')
  if (k === 'vacation' || k === 'vacacion') return 'Vacacion'
  if (k === 'sick') return 'Sick'
  if (k === 'personal' || k === 'other' || k === 'leave') return 'Personal'
  if (k === 'sin aviso') return 'Sin Aviso'
  if (k === 'bank holiday' || k === 'holiday') return 'Bank Holiday'
  if (k === 'wfh' || k === 'work from home') return 'WFH'
  return value
}

async function fetchApprovedLeaveRequests(startIso: string, endIso: string): Promise<ApprovedLeaveRequest[]> {
  const res = await fetch('/api/drivers/leave-request?status=approved')
  if (!res.ok) throw new Error('Failed to fetch approved leave requests')
  const data = (await res.json()) as { requests?: ApprovedLeaveRequest[]; leaveRequests?: ApprovedLeaveRequest[] }
  const rows = Array.isArray(data?.requests)
    ? data.requests
    : Array.isArray(data?.leaveRequests)
      ? data.leaveRequests
      : []
  return rows.filter((r) => {
    if (String(r?.status || '').toLowerCase() !== 'approved') return false
    const start = String(r?.start_date || '').slice(0, 10)
    const end = String(r?.end_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false
    return !(end < startIso || start > endIso)
  })
}

const emptyAddDriverDraft = (): AddDriverDraft => ({ full_name: '', unit_number: '', team: '', manager: '', phone: '', email: '', cdl_number: '', cdl_expiry: '', medical_expiry: '', status: 'Active', notes: '' })
const sortByUnit = (a: SchedulerDriverRow, b: SchedulerDriverRow) => String(a.unit_number || '').localeCompare(String(b.unit_number || ''))

function normalizeProfilesToRows(drivers: DriverProfile[]): SchedulerDriverRow[] {
  return drivers.map((d) => ({
    id: d.id, full_name: d.full_name, unit_number: d.unit_number, team: d.team, manager: d.manager, status: d.status,
    phone: d.phone, email: d.email, cdl_number: d.cdl_number, cdl_expiry: d.cdl_expiry, medical_expiry: d.medical_expiry, notes: d.notes,
  })).sort(sortByUnit)
}

export function DriverSchedulerPage({ focusUnit, onOpenDriverProfile }: Props) {
  const [drivers, setDrivers] = useState<SchedulerDriverRow[]>([])
  const [scheduleMap, setScheduleMap] = useState<Record<string, ScheduleEntry>>({})
  const [hosRows, setHosRows] = useState<Array<Record<string, unknown>>>([])
  const [teamFilter, setTeamFilter] = useState('')
  const [managerFilter, setManagerFilter] = useState('')
  const [hoverKey, setHoverKey] = useState('')
  const [leavePicker, setLeavePicker] = useState<LeavePickerState | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDriverDraft, setAddDriverDraft] = useState<AddDriverDraft>(emptyAddDriverDraft())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  const todayIso = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString().slice(0, 10)
  }, [])

  const [windowStartIso, setWindowStartIso] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - 3)
    return d.toISOString().slice(0, 10)
  })

  const days = useMemo(() => {
    const out: Array<{ iso: string; day: number; isToday: boolean; isPast: boolean; isFuture: boolean }> = []
    const start = new Date(`${windowStartIso}T00:00:00`)
    for (let i = 0; i < 34; i += 1) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const iso = d.toISOString().slice(0, 10)
      out.push({
        iso,
        day: d.getDate(),
        isToday: iso === todayIso,
        isPast: iso < todayIso,
        isFuture: iso > todayIso,
      })
    }
    return out
  }, [windowStartIso, todayIso])

  const windowLabel = useMemo(() => {
    if (!days.length) return ''
    const start = days[0].iso
    const end = days[days.length - 1].iso
    return `${fmtRangePart(start)} — ${fmtRangePart(end)}, ${fmtRangeYear(end)}`
  }, [days])

  const teams = useMemo(() => Array.from(new Set(drivers.map((d) => String(d.team || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [drivers])
  const managers = useMemo(() => Array.from(new Set(drivers.map((d) => String(d.manager || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [drivers])

  const filteredDrivers = useMemo(() => drivers.filter((d) => (!teamFilter || String(d.team || '') === teamFilter) && (!managerFilter || String(d.manager || '') === managerFilter)), [drivers, teamFilter, managerFilter])

  useEffect(() => {
    if (!focusUnit) return
    const el = document.getElementById(`sched-row-${String(focusUnit)}`)
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [focusUnit, filteredDrivers.length])

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!leavePicker) return
      const node = popupRef.current
      if (!node || !(e.target instanceof Node) || !node.contains(e.target)) setLeavePicker(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [leavePicker])

  const loadDrivers = async () => {
    const assignmentByUnit = new Map<string, string>()
    try {
      const assetsPayload = await fetch('/api/fleet/assets', { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .catch(() => ({ assets: [] }))
      const assets = Array.isArray(assetsPayload?.assets) ? assetsPayload.assets : []
      assets.forEach((asset: any) => {
        const unit = String(asset?.unit_number || '').trim().toUpperCase()
        const driverName = String(
          asset?.currentDriver || asset?.currentDriverName || asset?.current_driver_name || asset?.driver_name || ''
        ).trim()
        if (unit && driverName) assignmentByUnit.set(unit, driverName)
      })
    } catch {
      // leave assignment map empty
    }

    try {
      const data = await fetchDriverProfiles()
      const list = Array.isArray(data.drivers) ? data.drivers : []
      const baseRows = list.length ? normalizeProfilesToRows(list) : fallbackDrivers()
      const mergedRows = baseRows.map((row) => {
        const unitKey = String(row.unit_number || '').trim().toUpperCase()
        const assigned = assignmentByUnit.get(unitKey)
        const rowName = String(row.full_name || '').trim().toLowerCase()
        const shouldUseAssigned = Boolean(assigned) && (!rowName || rowName === 'unassigned' || rowName === 'vacante')
        if (!shouldUseAssigned) return row
        return { ...row, full_name: assigned || row.full_name }
      })
      setDrivers(mergedRows)
    } catch {
      const baseRows = fallbackDrivers()
      const mergedRows = baseRows.map((row) => {
        const unitKey = String(row.unit_number || '').trim().toUpperCase()
        const assigned = assignmentByUnit.get(unitKey)
        if (!assigned) return row
        return { ...row, full_name: assigned }
      })
      setDrivers(mergedRows)
    }
  }

  const loadSchedule = async () => {
    try {
      const startIso = days[0]?.iso
      const endIso = days[days.length - 1]?.iso
      if (!startIso || !endIso) {
        setScheduleMap({})
        return
      }

      const months = Array.from(new Set(days.map((d) => d.iso.slice(0, 7))))
      const [monthlySchedules, approvedLeaveRows] = await Promise.all([
        Promise.all(months.map((month) => fetchDriverSchedule(month).catch(() => ({ ok: true, rows: [] as DriverScheduleRow[] })))),
        fetchApprovedLeaveRequests(startIso, endIso).catch(() => []),
      ])

      const scheduleRows = monthlySchedules.flatMap((m) => (Array.isArray(m.rows) ? m.rows : []))
      const next: Record<string, ScheduleEntry> = {}

      scheduleRows.forEach((r: DriverScheduleRow) => {
        const iso = String(r.date).slice(0, 10)
        if (iso < startIso || iso > endIso) return
        const key = `${String(r.unit_number)}_${iso}`
        next[key] = { id: r.id, leave_type: normalizeLeaveType(r.leave_type || '') }
      })

      approvedLeaveRows.forEach((reqRow) => {
        const unit = String(reqRow?.unit_number || '').trim()
        const start = String(reqRow?.start_date || '').slice(0, 10)
        const end = String(reqRow?.end_date || '').slice(0, 10)
        if (!unit || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return
        const leaveType = normalizeLeaveType(reqRow?.leave_type || 'Leave')
        let d = new Date(`${start}T00:00:00Z`)
        const until = new Date(`${end}T00:00:00Z`)
        while (d <= until) {
          const iso = d.toISOString().slice(0, 10)
          if (iso >= startIso && iso <= endIso) {
            const key = `${unit}_${iso}`
            if (!next[key]) next[key] = { id: reqRow?.id, leave_type: leaveType }
          }
          d.setUTCDate(d.getUTCDate() + 1)
        }
      })

      setScheduleMap(next)
    } catch {
      setScheduleMap({})
    }
  }

  const loadHos = async () => {
    try {
      const data = await fetchDriverHosStatus()
      setHosRows(Array.isArray(data.rows) ? data.rows : [])
    } catch {
      setHosRows([])
    }
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([loadDrivers(), loadSchedule(), loadHos()]).catch((e) => setError(String((e as Error).message || e))).finally(() => setLoading(false))
  }, [windowStartIso])

  useEffect(() => {
    const t = window.setInterval(() => void loadHos(), 60000)
    return () => window.clearInterval(t)
  }, [])

  const hosColorForDriver = (driver: SchedulerDriverRow): string | null => {
    const unitNeedle = String(driver.unit_number || '').trim().toLowerCase()
    const nameNeedle = String(driver.full_name || '').trim().toLowerCase()
    const row = hosRows.find((r) => {
      const units = [r.unit_number, r.unitNumber, r.vehicleName, r.vehicle, r.name].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
      const names = [r.driverName, r.driver, r.name].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
      return units.includes(unitNeedle) || (nameNeedle ? names.includes(nameNeedle) : false)
    })
    if (!row) return null
    return HOS_DOT_COLORS[normalizeDutyStatus((row as Record<string, unknown>).dutyStatus)] || null
  }

  const totals = useMemo(() => filteredDrivers.map((d) => {
    let vac = 0, sick = 0, personal = 0, sinAviso = 0, holiday = 0, wfh = 0
    for (const col of days) {
      const leave = scheduleMap[`${d.unit_number}_${col.iso}`]?.leave_type || ''
      if (leave === 'Vacacion') vac += 1
      if (leave === 'Sick') sick += 1
      if (leave === 'Personal') personal += 1
      if (leave === 'Sin Aviso') sinAviso += 1
      if (leave === 'Bank Holiday') holiday += 1
      if (leave === 'WFH') wfh += 1
    }
    return { unit: d.unit_number, driver: d.full_name || 'Vacante', vac, sick, personal, sinAviso, holiday, wfh, totalAbsence: vac + sick + personal + sinAviso + holiday }
  }), [filteredDrivers, scheduleMap, days])

  const shiftWindowDays = (deltaDays: number) => {
    const base = new Date(`${windowStartIso}T00:00:00`)
    base.setDate(base.getDate() + deltaDays)
    setWindowStartIso(base.toISOString().slice(0, 10))
  }

  const resetWindowToToday = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - 3)
    setWindowStartIso(d.toISOString().slice(0, 10))
  }

  const openLeavePicker = (e: React.MouseEvent<HTMLTableCellElement>, unit_number: string, driver_id: number | null | undefined, date: string) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setLeavePicker({ key: `${unit_number}_${date}`, unit_number, driver_id, date, left: Math.min(window.innerWidth - 150, rect.left), top: Math.min(window.innerHeight - 220, rect.bottom + 6) })
  }

  const applyLeaveSelection = async (leaveType: string) => {
    if (!leavePicker) return
    const key = leavePicker.key
    const existing = scheduleMap[key]
    if (!leaveType) {
      if (existing?.id) {
        try { await deleteDriverScheduleEntry(existing.id) } catch { /* noop */ }
      }
      setScheduleMap((prev) => { const next = { ...prev }; delete next[key]; return next })
      setLeavePicker(null)
      return
    }
    try {
      const res = await saveDriverScheduleEntry({ unit_number: leavePicker.unit_number, driver_id: leavePicker.driver_id || null, date: leavePicker.date, leave_type: leaveType })
      setScheduleMap((prev) => ({ ...prev, [key]: { id: res?.row?.id || existing?.id, leave_type: leaveType } }))
    } catch {
      setScheduleMap((prev) => ({ ...prev, [key]: { id: existing?.id, leave_type: leaveType } }))
    } finally {
      setLeavePicker(null)
    }
  }

  const saveNewDriver = async () => {
    if (!addDriverDraft.full_name.trim() || !addDriverDraft.unit_number.trim()) { setError('Full name and unit number are required'); return }
    setError(null)
    try {
      await upsertDriverProfile({
        full_name: addDriverDraft.full_name.trim(), unit_number: addDriverDraft.unit_number.trim(),
        team: addDriverDraft.team.trim() || null, manager: addDriverDraft.manager.trim() || null,
        phone: addDriverDraft.phone.trim() || null, email: addDriverDraft.email.trim() || null,
        cdl_number: addDriverDraft.cdl_number.trim() || null, cdl_expiry: addDriverDraft.cdl_expiry || null,
        medical_expiry: addDriverDraft.medical_expiry || null, status: (addDriverDraft.status || 'Active') as DriverProfile['status'],
        notes: addDriverDraft.notes.trim() || null,
      })
      setShowAddModal(false)
      setAddDriverDraft(emptyAddDriverDraft())
      await loadDrivers()
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: '#c8d0dc', fontFamily: 'inherit' }}>
      <style>{`@media print { @page { size: landscape; margin: 8mm; } .ds-no-print, nav, aside { display: none !important; } .ds-grid-wrap { max-height: none !important; overflow: visible !important; } .ds-table th, .ds-table td { font-size: 8px !important; border: 0.5px solid rgba(0,0,0,0.28) !important; } .ds-left-col { position: static !important; } }`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '8px 12px' }}>
        <div><div style={{ fontWeight: 600, fontSize: 16 }}>Driver / Vacation Scheduler</div><div style={{ color: '#8892a4', fontSize: 12 }}>IH 35 Transportation LLC</div></div>
        <div className="ds-no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ ...inputStyle, minWidth: 140 }}><option value="">All teams</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} style={{ ...inputStyle, minWidth: 150 }}><option value="">All managers</option>{managers.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <button type="button" onClick={() => window.print()} style={{ border: '1px solid rgba(255,255,255,0.12)', background: '#111827', color: '#c8d0dc', borderRadius: 4, padding: '8px 12px', fontSize: 12 }}>Export PDF</button>
          <button type="button" onClick={() => { setAddDriverDraft(emptyAddDriverDraft()); setShowAddModal(true) }} style={{ border: '1px solid #2563eb', background: '#3b82f6', color: 'white', borderRadius: 4, padding: '8px 12px', fontSize: 12 }}>+ Add Driver</button>
        </div>
      </div>

      <div className="ds-no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => shiftWindowDays(-7)} style={{ border: '1px solid rgba(255,255,255,0.12)', background: '#111827', color: '#c8d0dc', borderRadius: 4, padding: '5px 10px' }}>‹ Back 7 days</button>
          <button type="button" onClick={resetWindowToToday} style={{ border: '1px solid #2563eb', background: '#3b82f6', color: '#fff', borderRadius: 4, padding: '5px 10px', fontWeight: 600 }}>Today</button>
          <button type="button" onClick={() => shiftWindowDays(7)} style={{ border: '1px solid rgba(255,255,255,0.12)', background: '#111827', color: '#c8d0dc', borderRadius: 4, padding: '5px 10px' }}>Next 7 days ›</button>
          <span style={{ minWidth: 180, textAlign: 'center', fontWeight: 600 }}>{windowLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>{Object.entries(LEAVE_COLORS).map(([label, color]) => <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#aeb7c5' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: color.dot }} />{label}</span>)}</div>
      </div>
      <div className="ds-grid-wrap" style={{ flex: '1 1 auto', overflowX: 'auto', overflowY: 'auto', minHeight: '300px', maxHeight: 'calc(100vh - 280px)', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <table className="ds-table" style={{ borderCollapse: 'collapse', minWidth: `${190 + days.length * 38}px`, width: 'max-content' }}>
          <thead><tr>
            <th className="ds-left-col" style={{ position: 'sticky', left: 0, top: 0, zIndex: 3, minWidth: 150, padding: '8px 12px', background: '#1e2433', color: '#8892a4', fontSize: 11, textAlign: 'left' }}>Unit / Driver</th>
            {days.map((col) => {
              const headerColor = col.isToday ? '#ffffff' : (col.isPast ? '#9ca3af' : '#8892a4')
              const headerBg = col.isToday ? '#3b82f6' : '#1e2433'
              return <th key={col.iso} style={{ position: 'sticky', top: 0, zIndex: 2, minWidth: 36, padding: '4px 2px', textAlign: 'center', fontSize: 10, color: headerColor, background: headerBg, whiteSpace: 'pre-line', fontWeight: col.isToday ? 700 : 500 }}><div>{dayAbbrevIso(col.iso)}</div><div>{col.day}</div></th>
            })}
          </tr></thead>
          <tbody>
            {filteredDrivers.map((driver, rowIdx) => {
              const rowBg = rowIdx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)'
              const hosColor = hosColorForDriver(driver)
              const isVacant = String(driver.full_name || '').trim().toLowerCase() === 'vacante'
              return <tr id={`sched-row-${driver.unit_number}`} key={`${driver.unit_number}-${driver.id}`} style={{ height: 30, background: rowBg }}>
                <td className="ds-left-col" style={{ position: 'sticky', left: 0, zIndex: 2, background: rowBg, padding: '4px 12px', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, background: '#2a3148', color: '#8892a4', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>{driver.unit_number}</span>
                    <button type="button" onClick={() => onOpenDriverProfile(driver.unit_number)} style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, fontSize: 11, color: isVacant ? '#4a5568' : '#c8d0dc', fontStyle: isVacant ? 'italic' : 'normal', cursor: 'pointer' }}>{driver.full_name || 'Vacante'}</button>
                    {hosColor ? <span style={{ width: 7, height: 7, borderRadius: '50%', marginLeft: 4, background: hosColor }} /> : null}
                  </div>
                </td>
                {days.map((col) => {
                  const date = col.iso
                  const key = `${driver.unit_number}_${date}`
                  const entry = scheduleMap[key]
                  const leaveType = normalizeLeaveType(String(entry?.leave_type || ''))
                  const leaveStyle = LEAVE_COLORS[leaveType]
                  const isHover = hoverKey === key
                  const colBg = col.isToday ? 'rgba(59,130,246,0.08)' : (col.isPast ? 'rgba(0,0,0,0.03)' : 'transparent')
                  return <td key={key} onMouseEnter={() => setHoverKey(key)} onMouseLeave={() => setHoverKey('')} onClick={(e) => openLeavePicker(e, driver.unit_number, driver.id > 0 ? driver.id : null, date)} style={{ height: 30, textAlign: 'center', verticalAlign: 'middle', border: '0.5px solid rgba(255,255,255,0.06)', cursor: 'pointer', padding: 2, background: isHover ? 'rgba(59,130,246,0.15)' : colBg }}>
                    {leaveStyle ? <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3, background: leaveStyle.bg, color: leaveStyle.text }}>{leaveStyle.label}</span> : null}
                  </td>
                })}
              </tr>
            })}
          </tbody>
        </table>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '8px 0', flex: '0 0 auto' }}>
        <div style={{ fontSize: 12, color: '#8892a4', padding: '4px 12px' }}>Monthly totals</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr style={{ color: '#6b7280', fontSize: 10 }}><th style={{ textAlign: 'left', padding: '4px 10px' }}>Driver</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Unit</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Total Absence</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Vacacion</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Sick</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Personal</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>Sin Aviso</th><th style={{ textAlign: 'left', padding: '4px 10px' }}>WFH</th></tr></thead>
          <tbody>
            {totals.map((r) => <tr key={`total-${r.unit}`} style={{ color: '#c8d0dc' }}><td style={{ padding: '4px 10px' }}>{r.driver || 'Vacante'}</td><td style={{ padding: '4px 10px' }}>{r.unit}</td><td style={{ padding: '4px 10px' }}>{r.totalAbsence > 0 ? <span style={{ background: '#450a0a', color: '#fca5a5', padding: '1px 6px', borderRadius: 8 }}>{r.totalAbsence}</span> : '—'}</td><td style={{ padding: '4px 10px' }}>{r.vac || '—'}</td><td style={{ padding: '4px 10px' }}>{r.sick || '—'}</td><td style={{ padding: '4px 10px' }}>{r.personal || '—'}</td><td style={{ padding: '4px 10px' }}>{r.sinAviso || '—'}</td><td style={{ padding: '4px 10px' }}>{r.wfh || '—'}</td></tr>)}
            {!totals.length ? <tr><td colSpan={8} style={{ padding: '8px 10px', color: '#6b7280' }}>No rows to summarize.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {leavePicker ? <div ref={popupRef} style={{ position: 'fixed', left: leavePicker.left, top: leavePicker.top, background: '#1e2433', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: 4, minWidth: 130, zIndex: 1000, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        {LEAVE_PICKER_ROWS.map((opt) => <button key={opt.label} type="button" onClick={() => void applyLeaveSelection(opt.value)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontSize: 12, color: '#c8d0dc', textAlign: 'left' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.dot || 'transparent', border: opt.outlined ? '1px solid rgba(255,255,255,0.9)' : 'none' }} />{opt.label}</button>)}
      </div> : null}

      {showAddModal ? <div className="ds-no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
        <div style={{ background: '#1a1f2e', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 24, maxWidth: 480, width: '90%' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>Add Driver</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {[['full_name', 'Full name', 'text'], ['team', 'Team', 'text'], ['manager', 'Manager', 'text'], ['phone', 'Phone', 'text'], ['email', 'Email', 'email'], ['cdl_number', 'CDL number', 'text'], ['cdl_expiry', 'CDL expiry', 'date'], ['medical_expiry', 'Medical card expiry', 'date']].map(([field, label, type]) => <label key={field} style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11, color: '#8892a4' }}>{label}</span><input type={type} value={(addDriverDraft as Record<string, string>)[field] || ''} onChange={(e) => setAddDriverDraft((prev) => ({ ...prev, [field]: e.target.value }))} style={inputStyle} /></label>)}
            <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11, color: '#8892a4' }}>Unit number</span><select value={addDriverDraft.unit_number} onChange={(e) => setAddDriverDraft((prev) => ({ ...prev, unit_number: e.target.value }))} style={inputStyle}><option value="">Select unit</option>{Array.from({ length: 58 }, (_, i) => `T${120 + i}`).map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11, color: '#8892a4' }}>Status</span><select value={addDriverDraft.status} onChange={(e) => setAddDriverDraft((prev) => ({ ...prev, status: e.target.value }))} style={inputStyle}>{['Active', 'Vacante', 'On Vacation', 'Sick', 'Terminated'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 11, color: '#8892a4' }}>Notes</span><textarea rows={3} value={addDriverDraft.notes} onChange={(e) => setAddDriverDraft((prev) => ({ ...prev, notes: e.target.value }))} style={inputStyle} /></label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setShowAddModal(false)} style={{ border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: '#c8d0dc', borderRadius: 4, padding: '8px 12px' }}>Cancel</button>
            <button type="button" onClick={() => void saveNewDriver()} style={{ border: '1px solid #2563eb', background: '#3b82f6', color: '#ffffff', borderRadius: 4, padding: '8px 12px' }}>Save</button>
          </div>
        </div>
      </div> : null}

      {loading ? <div style={{ fontSize: 12, color: '#8892a4', padding: '6px 12px' }}>Loading scheduler…</div> : null}
      {error ? <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 12px' }}>{error}</div> : null}
    </section>
  )
}
