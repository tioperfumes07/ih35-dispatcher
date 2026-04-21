import type {
  IntegrityAlert,
  IntegrityCheckCode,
  IntegrityCheckRequest,
} from '../types/integrity'
import type { IntegrityThresholds } from './integrityThresholds'

function catFromCode(code: IntegrityCheckCode): IntegrityAlert['category'] {
  if (code.startsWith('T')) return 'tires'
  if (code.startsWith('D')) return 'drivers'
  if (code.startsWith('A')) return 'accidents'
  if (code.startsWith('F')) return 'fuel'
  if (code.startsWith('M')) return 'maintenance'
  return 'predictive'
}

/** Catalog keys (and aliases) that always count as fuel-linked for expense checks. */
const FUEL_LINKED_SERVICE_KEYS = new Set([
  'diesel_fuel',
  'def_fluid',
  'reefer_fuel',
])

function isFuelLinkedMaintenanceExpense(p: Record<string, unknown>): boolean {
  const cat = String(p.category ?? '').toLowerCase()
  const key = String(p.serviceKey ?? '').toLowerCase()
  const name = String(p.serviceName ?? '').toLowerCase()
  if (FUEL_LINKED_SERVICE_KEYS.has(key)) return true
  const blob = `${cat} ${key} ${name}`
  if (/\bfuel\b/.test(blob) || /\bdiesel\b/.test(blob)) return true
  if (/\bdef\b/.test(blob) || blob.includes('reefer')) return true
  return false
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function alert(
  code: IntegrityCheckCode,
  title: string,
  message: string,
  records: IntegrityAlert['triggeringRecords'],
  severity: IntegrityAlert['severity'] = 'amber',
): IntegrityAlert {
  return {
    id: `${code}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    checkCode: code,
    category: catFromCode(code),
    severity,
    title,
    message,
    triggeringRecords: records,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Evaluator: thresholds + payload heuristics. POST /api/integrity/check mirrors this
 * server-side and persists to `integrity_alerts` (SQLite).
 */
export function evaluateIntegrityChecks(
  req: IntegrityCheckRequest,
  thresholds: IntegrityThresholds,
): IntegrityAlert[] {
  const out: IntegrityAlert[] = []
  const p = req.payload
  const unit = String(p.unitId ?? p.unit ?? 'UNK')
  const driver = String(p.driverName ?? p.driver ?? '')
  const cost = Number(p.estimatedCost ?? p.amount ?? 0)
  const seed = hashStr(`${unit}|${driver}|${req.saveType}|${req.saveId ?? ''}`)
  const unitSeed = hashStr(unit)

  const baseRec = (extra?: Partial<IntegrityAlert['triggeringRecords'][0]>) => [
    {
      id: '1',
      label: `${req.saveType} · ${unit}`,
      unit,
      driver: driver || undefined,
      amount: cost || undefined,
      ...extra,
    },
  ]

  /** Tires — demo signals when fleet/position pattern hash crosses bands (replace with tire DB). */
  if ((unitSeed % 100) > 92) {
    out.push(
      alert(
        'T1',
        `Tire purchase frequency elevated (T1 >${thresholds.t1_max_tires_per_unit_90d} / unit / 90d)`,
        `Unit ${unit}: rolling tire invoices suggest reviewing replacement cadence vs policy.`,
        [
          { id: 't1', label: `Unit ${unit} tire events`, unit, detail: 'Demo rule — wire tire history API.' },
        ],
      ),
    )
  }
  if ((seed % 23) === 4) {
    out.push(
      alert(
        'T2',
        `Same tire position replaced ${thresholds.t2_same_position_max_180d}× / 180 days`,
        'Steer position (demo) — verify warranty & alignment.',
        [
          { id: 't2a', label: 'Position LF', unit },
          { id: 't2b', label: 'Position LF prior', unit },
        ],
      ),
    )
  }
  if (cost > 800 && (seed % 19) === 2) {
    out.push(
      alert(
        'T3',
        `Tire / wheel job cost >${thresholds.t3_cost_vs_avg_multiplier}× fleet average`,
        `Recorded amount ${cost.toFixed(0)} vs segment mean.`,
        baseRec({ label: 'Tire RO', detail: 'Position-level detail in production.' }),
      ),
    )
  }
  if ((seed % 41) === 7) {
    out.push(
      alert(
        'T4',
        `Fleet tire volume >${thresholds.t4_fleet_tires_per_month} units/month (fleet-wide)`,
        'Fleet procurement spike — check for retread batches vs new inventory.',
        [{ id: 'f4', label: 'Fleet pool', detail: 'Yard / vendor aggregate (demo).' }],
      ),
    )
  }

  /** Drivers */
  if (req.saveType === 'repair_work_order' && driver && (seed % 29) < 6) {
    out.push(
      alert(
        'D1',
        `Repair frequency >${thresholds.d1_repairs_per_driver_90d} / driver / 90 days`,
        `Driver ${driver}: repair touches exceed threshold (demo roll-up).`,
        [{ id: 'd1', label: driver, driver, unit }],
      ),
    )
  }
  if (req.saveType === 'accident_work_order' && driver && (seed % 31) < 8) {
    out.push(
      alert(
        'D2',
        `Accident frequency >${thresholds.d2_accidents_per_driver_year} / driver / year`,
        'Annualized accident count on this driver profile (demo).',
        [{ id: 'd2', label: driver, driver, unit }],
      ),
    )
  }
  if (driver && driver.length > 2 && cost > thresholds.d3_driver_spend_90d * 0.15) {
    out.push(
      alert(
        'D3',
        `Driver-linked spend >$${thresholds.d3_driver_spend_90d} / 90 days (policy slice)`,
        `Attribution demo — amount on this save ${cost.toFixed(0)} with driver context.`,
        [{ id: '1', label: driver, driver, amount: cost }],
      ),
    )
  }
  if (driver && (seed % 37) === 11) {
    out.push(
      alert(
        'D4',
        `Same driver + unit service combo ≥${thresholds.d4_same_driver_unit_60d}× / 60 days`,
        `${driver} on ${unit}: repeated pairing in window (demo).`,
        [{ id: 'd4', label: `${driver} · ${unit}`, driver, unit }],
      ),
    )
  }

  /** Accidents */
  if (req.saveType === 'accident_work_order') {
    out.push(
      alert(
        'A3',
        'DOT reportable — verification',
        'Accident work orders are always checked for DOT reportability and retention.',
        [
          {
            id: '1',
            label: `Accident WO · ${unit}`,
            unit,
            driver,
            detail: 'Review FMCSA crash criteria & carrier policy.',
          },
        ],
        'red',
      ),
    )
    if (unit === '204' || unit.endsWith('4') || (seed % 17) === 3) {
      out.push(
        alert(
          'A1',
          'Multiple accidents same unit (pattern)',
          'Unit appears in more than one accident WO in the lookback window.',
          [
            { id: '1', label: `Accident WO #1 · ${unit}`, unit },
            { id: '2', label: `Accident WO #2 · ${unit}`, unit },
          ],
        ),
      )
    }
    if (cost > 15000 || (seed % 13) === 0) {
      out.push(
        alert(
          'A2',
          'High quarterly accident cost',
          `Loss run trend: ${cost.toFixed(0)} on this event vs carrier quarterly mean (demo).`,
          [{ id: 'a2', label: 'Carrier loss pool', amount: cost, unit }],
        ),
      )
    }
  }

  /** Fuel */
  const amt = Number(p.amount ?? 0)
  if (req.saveType === 'maintenance_expense' && isFuelLinkedMaintenanceExpense(p)) {
    if ((seed % 11) !== 10)
      out.push(
        alert(
          'F1',
          `Consumption >${thresholds.f1_consumption_pct_above_avg}% above fleet mpg baseline`,
          'Route and idle model (demo) — verify ECM gallons vs purchase.',
          [{ id: 'f1', label: 'MPG variance', unit, driver, detail: String(p.serviceKey ?? '') }],
        ),
      )
    out.push(
      alert(
        'F2',
        'Driver fuel anomaly (cross-check)',
        'Fuel-linked expense with driver variance vs fleet mean (demo).',
        [
          {
            id: '1',
            label: String(p.category ?? 'Fuel'),
            driver,
            unit,
            detail: p.serviceKey ? String(p.serviceKey) : undefined,
          },
        ],
      ),
    )
    if (amt > 900 || (seed % 7) === 0) {
      out.push(
        alert(
          'F3',
          'Unusual gallons vs distance',
          'Gallons per mile outside band for this lane/unit (demo).',
          [{ id: 'f3', label: 'Fuel ticket', unit, amount: amt }],
        ),
      )
    }
    if (amt > 400 && (seed % 5) === 0) {
      out.push(
        alert(
          'F4',
          `Fuel price >${thresholds.f4_price_spike_pct}% vs 30d rack`,
          'Pump price vs OPIS low (demo).',
          [{ id: 'f4', label: 'Fuel price', unit, amount: amt }],
        ),
      )
    }
    if ((seed % 43) === 5) {
      out.push(
        alert(
          'F5',
          'Same unit multiple fuel entries same day',
          'Card swipes or bills >1 for same calendar day (demo).',
          [{ id: 'f5', label: `${unit} same-day fuel`, unit }],
        ),
      )
    }
  }

  /** Maintenance */
  if (req.saveType === 'repair_work_order' && cost > 2000 * thresholds.m1_single_repair_vs_avg) {
    out.push(
      alert(
        'M1',
        'Single repair far above rolling average',
        `Repair cost ${cost.toFixed(0)} exceeds ~${thresholds.m1_single_repair_vs_avg}× typical labor+parts.`,
        [{ id: '1', label: `WO · ${unit}`, amount: cost, unit, driver }],
      ),
    )
  }
  if (
    (req.saveType === 'maintenance_bill' || req.saveType === 'maintenance_expense') &&
    cost > thresholds.m2_monthly_spend_per_unit
  ) {
    out.push(
      alert(
        'M2',
        `Spend >$${thresholds.m2_monthly_spend_per_unit} / month / unit (rolling)`,
        `Amount ${cost.toFixed(0)} on this save trips monthly cap (demo slice).`,
        [{ id: 'm2', label: 'Unit roll-up', unit, amount: cost }],
      ),
    )
  }
  if ((seed % 53) === 9) {
    out.push(
      alert(
        'M3',
        `Record volume >${thresholds.m3_records_per_unit_60d} / unit / 60 days`,
        `Unit ${unit}: transaction count elevated (demo).`,
        [{ id: 'm3', label: unit, unit }],
      ),
    )
  }
  if (req.saveType === 'maintenance_bill' && cost > 5000) {
    out.push(
      alert(
        'M4',
        'Vendor invoice above segment average',
        `Bill amount ${cost.toFixed(0)} is ~${thresholds.m4_vendor_invoice_pct_above_avg}%+ above rolling vendor mean (demo).`,
        [{ id: '1', label: String(p.billNumber ?? 'BILL'), amount: cost, unit }],
      ),
    )
  }

  if (out.length === 0) {
    out.push(
      alert(
        'P1',
        'Predictive — no hard hits; monitor trend',
        'Save recorded. No threshold breach on this payload (demo default).',
        [{ id: '1', label: 'Model output', detail: 'No action required.' }],
      ),
    )
  }

  const src = req.saveType
  const sid = req.saveId
  return out.map((a) =>
    src || sid ? { ...a, sourceSaveType: src, sourceSaveId: sid } : a,
  )
}
