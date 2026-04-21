import { useEffect, useMemo, useState } from 'react'
import { useServiceCatalogRows } from '../../hooks/useServiceCatalogRows'
import { WhatsDueSidebar } from './WhatsDueSidebar'
import { VEHICLE_MAKE_OPTIONS } from '../../data/maintenanceScheduleData'
import {
  mergeAlertsIntoStore,
  postIntegrityCheck,
} from '../../api/postIntegrityCheck'
import { appliesToMake, formatServiceCostLine, formatServiceSubtitle } from '../catalog/ServiceTypePicker'
import { ServiceWorkOrderInfoPanel } from '../catalog/ServiceWorkOrderInfoPanel'
import { MAINT_FLEET_CHIPS, MAINT_FLEET_UNITS } from '../../data/maintFleetUnits'
import type { MaintFleetCategory } from '../../data/maintFleetUnits'
import { MaintUnitListColumn } from './MaintUnitListColumn'
import { MaintUnitFleetTable } from './MaintUnitFleetTable'
import { SearchableCombo, type ComboOption } from './SearchableCombo'
import { MaintModalSaveButton, type MaintSaveVisualState } from './MaintModalShell'
import { IntegrityAlertsKpiWidget } from './IntegrityAlertsKpiWidget'
import {
  WorkOrderShell,
  type CategoryLine,
  type ItemLine,
  type PartLine,
  type PlannedLine,
  type WorkOrderShellKind,
} from '../workorder/WorkOrderShell'
import {
  bumpWorkOrderDupSeq,
  formatWorkOrderNumber,
  readWorkOrderDupSeq,
  workOrderDupStorageKey,
} from '../../lib/generateWorkOrderNumber'
import { fetchQboItems } from '../../lib/qboItemsApi'
import type { QboItemRow } from '../../lib/qboItemsApi'
import { useVendorComboOptions } from '../../hooks/useVendorComboOptions'

const UNIT_LIST_COLLAPSE_LS = 'fleet-reports:maint-unit-list-collapsed'

type Props = {
  onIntegrityBatch: (alerts: import('../../types/integrity').IntegrityAlert[]) => void
  onViewAllIntegrity?: () => void
  variant?: 'workspace' | 'modal'
  initialUnitId?: string
  /** Optional seed when embedding accident / other flows */
  initialDescription?: string
  initialEstimatedCost?: string
  onClose?: () => void
  /** Parent-controlled fleet unit id (Maintenance board). */
  unitId?: string
  onUnitIdChange?: (id: string) => void
  /** Opens focused work order modal (Create work order). */
  onRequestCreateWorkOrder?: () => void
  /** Double-click unit in list: select unit and open the same modal (Maintenance board). */
  onUnitOpenRecordModal?: (unitId: string) => void
  integritySaveType?:
    | 'repair_work_order'
    | 'accident_work_order'
    | 'maintenance_expense'
    | 'maintenance_bill'
  /** When opening from + New, maps to service location for WO prefix (IWO/EWO/RSWO). */
  initialShellKind?: WorkOrderShellKind
}

/** Canonical record types for WorkOrderShell (SearchableCombo allows add custom). */
const RECORD_OPTS: ComboOption[] = [
  { value: 'repair', label: 'Repair' },
  { value: 'work_order', label: 'Work order' },
  { value: 'preventive', label: 'PM service' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'accident', label: 'Accident report' },
  { value: 'tire_order', label: 'Tire order' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'roadside', label: 'Roadside' },
  { value: 'corrective', label: 'Corrective (catalog key)' },
]

const STATUS_OPTS: ComboOption[] = [
  { value: 'unset', label: 'Not set' },
  { value: 'open', label: 'In progress' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_parts', label: 'Waiting parts' },
  { value: 'complete', label: 'Complete' },
]

const LOCATION_OPTS: ComboOption[] = [
  { value: 'dealer', label: 'External shop' },
  { value: 'dallas-shop', label: 'In-house' },
  { value: 'houston-shop', label: 'In-house (Houston)' },
  { value: 'mobile-road', label: 'Roadside' },
]

export function RepairWorkOrderForm({
  onIntegrityBatch,
  onViewAllIntegrity,
  variant = 'workspace',
  initialUnitId,
  initialDescription,
  initialEstimatedCost,
  onClose,
  unitId: controlledUnitId,
  onUnitIdChange,
  onRequestCreateWorkOrder,
  onUnitOpenRecordModal,
  integritySaveType = 'repair_work_order',
  initialShellKind,
}: Props) {
  const isLedgerShell =
    integritySaveType === 'maintenance_expense' ||
    integritySaveType === 'maintenance_bill'
  const vendorOptions = useVendorComboOptions()
  const [qboItems, setQboItems] = useState<QboItemRow[]>([])
  const isUnitControlled =
    controlledUnitId !== undefined && typeof onUnitIdChange === 'function'
  const [internalUnitId, setInternalUnitId] = useState(() => {
    if (initialUnitId) return initialUnitId
    if (integritySaveType === 'maintenance_expense') return '118'
    if (integritySaveType === 'maintenance_bill') return '415'
    return '101'
  })
  const unitId = isUnitControlled ? controlledUnitId! : internalUnitId
  const setUnitId = (id: string) => {
    if (isUnitControlled) onUnitIdChange!(id)
    else setInternalUnitId(id)
  }
  const [fleetFilter, setFleetFilter] = useState<MaintFleetCategory | 'all'>('all')
  const [driverId, setDriverId] = useState('')
  const [driverName, setDriverName] = useState('') // payee vendor display name
  const [recordType, setRecordType] = useState(() => {
    if (integritySaveType === 'accident_work_order') return 'accident'
    if (isLedgerShell) return 'work_order'
    return 'repair'
  })
  const [serviceType, setServiceType] = useState(() => {
    if (integritySaveType === 'maintenance_expense') return 'oil_change'
    if (integritySaveType === 'maintenance_bill') return 'pm_b'
    return 'corrective'
  })
  const [repairStatus, setRepairStatus] = useState('open')
  const [serviceLocation, setServiceLocation] = useState('dallas-shop')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [estimatedCost, setEstimatedCost] = useState(() => {
    if (initialEstimatedCost != null && initialEstimatedCost !== '') return initialEstimatedCost
    if (integritySaveType === 'maintenance_expense') return '420'
    if (integritySaveType === 'maintenance_bill') return '6200'
    return '8500'
  })
  const [vehicleMakeKey, setVehicleMakeKey] = useState('freightliner_cascadia')
  const [currentOdometer, setCurrentOdometer] = useState(418200)
  const [saving, setSaving] = useState(false)
  const [saveVis, setSaveVis] = useState<MaintSaveVisualState>('idle')
  const { rows: catalog, error: catalogError } = useServiceCatalogRows(
    integritySaveType === 'accident_work_order' ? 'repair' : 'all',
  )
  const [shellFullScreen, setShellFullScreen] = useState(false)
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [locationDetail, setLocationDetail] = useState('')
  const [fleetMileage, setFleetMileage] = useState(String(418200))
  const [loadNumber, setLoadNumber] = useState('')
  const [odometerInput, setOdometerInput] = useState(String(418200))
  const [suggestedLoad] = useState('—')
  const [plannedLines, setPlannedLines] = useState<PlannedLine[]>([{ id: 'p1', text: '', tag: '' }])
  const [partLines, setPartLines] = useState<PartLine[]>([])
  const [categoryLines, setCategoryLines] = useState<CategoryLine[]>(() => {
    const amt =
      initialEstimatedCost != null && initialEstimatedCost !== ''
        ? initialEstimatedCost
        : integritySaveType === 'maintenance_expense'
          ? '420'
          : integritySaveType === 'maintenance_bill'
            ? '6200'
            : '8500'
    return [
      {
        id: 'c1',
        category: 'R&M',
        description: '',
        amount: amt,
        billable: true,
        customer: '',
      },
    ]
  })
  const [itemLines, setItemLines] = useState<ItemLine[]>([
    {
      id: 'i1',
      product: '',
      sku: '',
      description: '',
      qty: '1',
      rate: '',
      amount: '0',
      billable: true,
      customer: '',
    },
  ])
  const [txnType, setTxnType] = useState(() =>
    integritySaveType === 'maintenance_bill' ? 'bill' : 'expense',
  )
  const [expenseBillNo, setExpenseBillNo] = useState(() =>
    integritySaveType === 'maintenance_bill' ? 'VEND-9921' : '',
  )
  const [paymentMethod, setPaymentMethod] = useState('ACH')
  const [txnDate, setTxnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [payFromAccount, setPayFromAccount] = useState('Operating checking · …4401')
  const [notes, setNotes] = useState<[string, string, string, string, string]>(['', '', '', '', ''])
  const [additionalServices, setAdditionalServices] = useState('')
  const [memo, setMemo] = useState('')
  const [claimNumber, setClaimNumber] = useState('')

  const [unitListCollapsed, setUnitListCollapsed] = useState(() => {
    try {
      return localStorage.getItem(UNIT_LIST_COLLAPSE_LS) === '1'
    } catch {
      return false
    }
  })
  const [fleetTableOpen, setFleetTableOpen] = useState(false)

  useEffect(() => {
    if (initialUnitId && !isUnitControlled) setInternalUnitId(initialUnitId)
  }, [initialUnitId, isUnitControlled])

  useEffect(() => {
    if (integritySaveType === 'accident_work_order') setRecordType('accident')
  }, [integritySaveType])

  useEffect(() => {
    void fetchQboItems()
      .then(setQboItems)
      .catch(() => setQboItems([]))
  }, [])

  useEffect(() => {
    if (!initialShellKind) return
    if (initialShellKind === 'IWO') setServiceLocation('dallas-shop')
    if (initialShellKind === 'EWO') setServiceLocation('dealer')
    if (initialShellKind === 'RSWO') setServiceLocation('mobile-road')
  }, [initialShellKind])

  useEffect(() => {
    if (vendorOptions.length === 0) return
    setVendor((v) => {
      if (v && vendorOptions.some((o) => o.value === v)) return v
      return vendorOptions[0]!.value
    })
  }, [vendorOptions])

  useEffect(() => {
    if (qboItems.length === 0) return
    setItemLines((rows) => {
      if (rows.length !== 1) return rows
      const r = rows[0]!
      if (r.product && qboItems.some((i) => i.id === r.product)) return rows
      return [{ ...r, product: qboItems[0]!.id }]
    })
  }, [qboItems])

  useEffect(() => {
    try {
      localStorage.setItem(UNIT_LIST_COLLAPSE_LS, unitListCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [unitListCollapsed])

  const selectedUnit = useMemo(
    () => MAINT_FLEET_UNITS.find((u) => u.id === unitId) ?? MAINT_FLEET_UNITS[0]!,
    [unitId],
  )

  useEffect(() => {
    const u = MAINT_FLEET_UNITS.find((x) => x.id === unitId)
    if (u) {
      setVehicleMakeKey(u.vehicleMakeKey)
      setCurrentOdometer(u.mileage)
      setFleetMileage(String(u.mileage))
      setOdometerInput(String(u.mileage))
    }
  }, [unitId])

  const makeOptions: ComboOption[] = useMemo(
    () => VEHICLE_MAKE_OPTIONS.map((m) => ({ value: m.key, label: m.label })),
    [],
  )

  const serviceOptions: ComboOption[] = useMemo(() => {
    const base = catalog.filter((s) => appliesToMake(s, vehicleMakeKey))
    return base.map((s) => ({ value: s.service_key, label: s.service_name }))
  }, [catalog, vehicleMakeKey])

  useEffect(() => {
    if (serviceOptions.length === 0) return
    if (!serviceOptions.some((o) => o.value === serviceType)) {
      setServiceType(serviceOptions[0]!.value)
    }
  }, [serviceOptions, serviceType])

  const selectedService = catalog.find((s) => s.service_key === serviceType) ?? null

  const productOptions: ComboOption[] = useMemo(
    () => [
      { value: '__add', label: 'Add new' },
      ...qboItems.map((i) => ({
        value: i.id,
        label: i.name,
        subtitle: i.category,
      })),
    ],
    [qboItems],
  )

  const vendorDisplay =
    vendorOptions.find((o) => o.value === vendor)?.label ?? vendor

  const recordKind: WorkOrderShellKind = useMemo(() => {
    if (serviceLocation === 'mobile-road') return 'RSWO'
    if (serviceLocation === 'dealer') return 'EWO'
    return 'IWO'
  }, [serviceLocation])

  const woNumberDate = useMemo(() => {
    const parts = serviceDate.split('-').map((x) => Number(x))
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const [y, m, d] = parts
      const dt = new Date(y!, m! - 1, d!)
      if (!Number.isNaN(dt.getTime())) return dt
    }
    return new Date()
  }, [serviceDate])

  const woDupKey = useMemo(
    () => workOrderDupStorageKey(recordKind, selectedUnit.unitNo, woNumberDate),
    [recordKind, selectedUnit.unitNo, woNumberDate],
  )

  const [assignedWoDupIdx, setAssignedWoDupIdx] = useState(0)

  useEffect(() => {
    setAssignedWoDupIdx(readWorkOrderDupSeq(woDupKey))
  }, [woDupKey])

  const workOrderNumber = useMemo(
    () =>
      formatWorkOrderNumber(
        recordKind,
        selectedUnit.unitNo,
        woNumberDate,
        assignedWoDupIdx,
      ),
    [recordKind, selectedUnit.unitNo, woNumberDate, assignedWoDupIdx],
  )

  useEffect(() => {
    setCategoryLines((rows) => {
      if (!rows[0]) return rows
      const next = [...rows]
      next[0] = { ...next[0]!, amount: estimatedCost }
      return next
    })
  }, [estimatedCost])

  const save = async () => {
    if (integritySaveType === 'accident_work_order' && !driverId.trim()) {
      setSaveVis('error')
      window.setTimeout(() => setSaveVis('idle'), 2400)
      return
    }
    setSaving(true)
    setSaveVis('loading')
    try {
      const saveId = crypto.randomUUID()
      const payload: Record<string, unknown> =
        integritySaveType === 'accident_work_order'
          ? {
              unitId,
              driverId,
              driverName,
              description,
              estimatedCost: parseFloat(estimatedCost) || 0,
              claimNumber,
              serviceKey: serviceType,
              serviceName: selectedService?.service_name,
              workOrderNumber,
            }
          : integritySaveType === 'maintenance_expense'
            ? {
                unitId,
                driverId,
                driverName,
                category: selectedService?.service_name ?? serviceType,
                serviceKey: serviceType,
                serviceName: selectedService?.service_name,
                amount: parseFloat(estimatedCost) || 0,
                expenseDate: serviceDate,
                vendor: vendorDisplay,
                vendorPartyId: vendor,
              }
            : integritySaveType === 'maintenance_bill'
              ? {
                  unitId,
                  driverId,
                  driverName,
                  billNumber: expenseBillNo,
                  amount: parseFloat(estimatedCost) || 0,
                  billDate: serviceDate,
                  vendor: vendorDisplay,
                  vendorPartyId: vendor,
                  serviceKey: serviceType,
                  serviceName: selectedService?.service_name,
                  billedServiceLabel: selectedService?.service_name ?? serviceType,
                }
              : {
                  unitId,
                  driverId,
                  driverName,
                  serviceType,
                  serviceName: selectedService?.service_name ?? serviceType,
                  description,
                  estimatedCost: parseFloat(estimatedCost) || 0,
                  recordType,
                  serviceLocation,
                  repairStatus,
                  workOrderNumber,
                  vendor: vendorDisplay,
                  vendorPartyId: vendor,
                }
      await new Promise((r) => setTimeout(r, 200))
      const res = await postIntegrityCheck({
        saveType: integritySaveType,
        saveId,
        payload,
      })
      mergeAlertsIntoStore(res.alerts)
      onIntegrityBatch(res.alerts)
      if (!isLedgerShell) bumpWorkOrderDupSeq(woDupKey)
      setSaveVis('success')
      window.setTimeout(() => setSaveVis('idle'), 1600)
    } catch {
      setSaveVis('error')
      window.setTimeout(() => setSaveVis('idle'), 2400)
    } finally {
      setSaving(false)
    }
  }

  const locLabel =
    LOCATION_OPTS.find((o) => o.value === serviceLocation)?.label ?? serviceLocation
  const recordLabel =
    RECORD_OPTS.find((o) => o.value === recordType)?.label ?? recordType
  const repairSummary = description.trim() || selectedService?.service_name || serviceType

  const pills = useMemo(() => {
    const total = `$${(parseFloat(estimatedCost) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    if (integritySaveType === 'maintenance_expense') {
      return { recordType: 'Expense', location: locLabel, total }
    }
    if (integritySaveType === 'maintenance_bill') {
      return { recordType: 'Bill', location: locLabel, total }
    }
    return { recordType: recordLabel, location: locLabel, total }
  }, [integritySaveType, recordLabel, locLabel, estimatedCost])

  const servicePanel = (
    <div>
      <div className="wo-grid3" style={{ marginBottom: 8 }}>
        <div>
          <SearchableCombo
            label="Vehicle make (schedule)"
            value={vehicleMakeKey}
            onChange={setVehicleMakeKey}
            options={makeOptions}
          />
        </div>
        <label className="field">
          <span className="wo-field-lbl">Current odometer (mi)</span>
          <input
            className="wo-input"
            inputMode="numeric"
            value={currentOdometer}
            onChange={(e) => setCurrentOdometer(parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <label className="field">
          <span className="wo-field-lbl">Est. cost ($)</span>
          <input
            className="wo-input"
            inputMode="decimal"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
          />
        </label>
      </div>
      {selectedService ? (
        <div className="field maint-form__full" style={{ marginBottom: 8 }}>
          <span className="wo-field-lbl">
            {isLedgerShell
              ? integritySaveType === 'maintenance_bill'
                ? 'Service line (bill)'
                : 'Service line (expense)'
              : 'Service catalog'}
          </span>
          <div className="maint-rwo__svc-readout muted small">
            {selectedService.service_name} · {formatServiceSubtitle(selectedService)} ·{' '}
            {formatServiceCostLine(selectedService)}
          </div>
        </div>
      ) : null}
      <div className="svc-wo-info-wrap">
        <ServiceWorkOrderInfoPanel
          service={selectedService}
          unitId={unitId}
          vehicleMakeKey={vehicleMakeKey}
          currentOdometer={currentOdometer}
        />
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <span className="wo-field-lbl">Description</span>
        <input className="wo-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {integritySaveType === 'accident_work_order' ? (
        <label className="field" style={{ marginTop: 8 }}>
          <span className="wo-field-lbl">Claim #</span>
          <input
            className="wo-input"
            value={claimNumber}
            onChange={(e) => setClaimNumber(e.target.value)}
          />
        </label>
      ) : null}
    </div>
  )

  const shell = (
    <WorkOrderShell
      recordKind={recordKind}
      ledgerMode={
        isLedgerShell
          ? integritySaveType === 'maintenance_bill'
            ? 'bill'
            : 'expense'
          : undefined
      }
      workOrderNumber={workOrderNumber}
      unitNo={selectedUnit.unitNo}
      unitTitle={selectedUnit.makeModel}
      vehicleTypeLabel={vehicleMakeKey.replace(/_/g, ' ')}
      pills={pills}
      unitStats={{
        odometer: selectedUnit.mileage,
        pastDue: selectedUnit.pastDue ? 1 : 0,
        dueSoon: selectedUnit.dueSoon ? 1 : 0,
        savedOdoDisplay: fleetMileage || '—',
      }}
      shellFullScreen={shellFullScreen}
      onToggleShellFullScreen={() => setShellFullScreen((v) => !v)}
      onClose={variant === 'modal' ? onClose : undefined}
      integrity={{
        showDriverBar: !driverName.trim(),
        onViewAllIntegrity,
      }}
      catalogError={catalogError}
      servicePanel={servicePanel}
      recordTypeOptions={RECORD_OPTS}
      serviceTypeOptions={serviceOptions}
      serviceLocationOptions={LOCATION_OPTS}
      repairStatusOptions={STATUS_OPTS}
      recordType={recordType}
      onRecordType={setRecordType}
      serviceType={serviceType}
      onServiceType={setServiceType}
      serviceLocation={serviceLocation}
      onServiceLocation={setServiceLocation}
      repairStatus={repairStatus}
      onRepairStatus={setRepairStatus}
      serviceDate={serviceDate}
      onServiceDate={setServiceDate}
      vendor={vendor}
      onVendor={setVendor}
      vendorOptions={vendorOptions}
      fleetMileage={fleetMileage}
      onFleetMileage={setFleetMileage}
      onFleetMileageSave={() => setFleetMileage(String(currentOdometer))}
      locationDetail={locationDetail}
      onLocationDetail={setLocationDetail}
      driverId={driverId}
      driverName={driverName}
      onDriverChange={(id, name) => {
        setDriverId(id)
        setDriverName(name)
      }}
      loadNumber={loadNumber}
      onLoadNumber={setLoadNumber}
      odometerInput={odometerInput}
      onOdometerInput={setOdometerInput}
      samsaraOdoHint={`Samsara live: ${selectedUnit.mileage.toLocaleString()} mi`}
      suggestedLoad={suggestedLoad}
      plannedLines={plannedLines}
      onPlannedLines={setPlannedLines}
      partLines={partLines}
      onPartLines={setPartLines}
      categoryLines={categoryLines}
      onCategoryLines={setCategoryLines}
      itemLines={itemLines}
      onItemLines={setItemLines}
      productOptions={productOptions}
      txnType={txnType}
      onTxnType={setTxnType}
      expenseBillNo={expenseBillNo}
      onExpenseBillNo={setExpenseBillNo}
      paymentMethod={paymentMethod}
      onPaymentMethod={setPaymentMethod}
      txnDate={txnDate}
      onTxnDate={setTxnDate}
      payFromAccount={payFromAccount}
      onPayFromAccount={setPayFromAccount}
      notes={notes}
      onNotes={setNotes}
      additionalServices={additionalServices}
      onAdditionalServices={setAdditionalServices}
      memo={memo}
      onMemo={setMemo}
      saveBar={
        <>
          <MaintModalSaveButton
            state={saveVis}
            disabled={saving}
            label="Save"
            onClick={() => void save()}
          />
          <button type="button" className="wo-bar-btn">
            ▾
          </button>
        </>
      }
    />
  )

  if (isLedgerShell) {
    return (
      <div
        className={
          'maint-rwo maint-rwo--ledger-shell' +
          (variant === 'modal' ? ' maint-rwo--modal-shell' : '')
        }
        aria-label={
          integritySaveType === 'maintenance_expense'
            ? 'Maintenance expense'
            : 'Maintenance bill'
        }
      >
        <div
          className="maint-rwo__scroll"
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {shell}
        </div>
      </div>
    )
  }

  if (variant === 'modal') {
    return (
      <div className="maint-rwo maint-rwo--modal-shell">
        {shell}
      </div>
    )
  }

  return (
    <div className="maint-rwo">
      <header className="maint-rwo__L1" aria-label="Work order actions">
        <button
          type="button"
          className="maint-rwo__create btn primary"
          onClick={() => onRequestCreateWorkOrder?.()}
        >
          Create work order
        </button>
        <span className="maint-rwo__L1-sep" aria-hidden />
        <button
          type="button"
          className={'maint-rwo__link' + (fleetTableOpen ? ' is-active' : '')}
          aria-pressed={fleetTableOpen}
          onClick={() => setFleetTableOpen((o) => !o)}
        >
          Fleet table
        </button>
        <button type="button" className="maint-rwo__link">
          R&amp;M status
        </button>
        <button type="button" className="maint-rwo__link">
          Shop / location
        </button>
      </header>

      <div className="maint-rwo__L2" role="toolbar" aria-label="Fleet type">
        {MAINT_FLEET_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={
              'maint-rwo__chip' + (fleetFilter === c.id ? ' maint-rwo__chip--active' : '')
            }
            onClick={() => {
              setFleetFilter(c.id)
              const nextUnits =
                c.id === 'all'
                  ? MAINT_FLEET_UNITS
                  : MAINT_FLEET_UNITS.filter((u) => u.fleet === c.id)
              if (!nextUnits.some((u) => u.id === unitId) && nextUnits[0]) {
                setUnitId(nextUnits[0].id)
              }
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {fleetTableOpen ? (
        <MaintUnitFleetTable
          units={MAINT_FLEET_UNITS}
          fleetFilter={fleetFilter}
          selectedId={unitId}
          onSelect={setUnitId}
          onOpenRecordModal={onUnitOpenRecordModal}
        />
      ) : null}

      <div
        className={
          'maint-rwo__L3' + (unitListCollapsed ? ' maint-rwo__L3--collapsed' : '')
        }
      >
        <MaintUnitListColumn
          units={MAINT_FLEET_UNITS}
          fleetFilter={fleetFilter}
          selectedId={unitId}
          onSelect={setUnitId}
          collapsed={unitListCollapsed}
          onCollapsedChange={setUnitListCollapsed}
          onOpenRecordModal={onUnitOpenRecordModal}
        />

        <div className="maint-rwo__right">
          <div className="maint-rwo__snapband">
            <div className="maint-rwo__snap" aria-label="Workspace snapshot">
              <span className="maint-rwo__pill">Unit {selectedUnit.unitNo}</span>
              <span className="maint-rwo__pill mono">{workOrderNumber}</span>
              <span className="maint-rwo__pill">
                ${(parseFloat(estimatedCost) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="maint-rwo__pill">{locLabel}</span>
              <span className="maint-rwo__pill maint-rwo__pill--grow">{repairSummary}</span>
            </div>
            {onViewAllIntegrity ? (
              <IntegrityAlertsKpiWidget onViewAll={onViewAllIntegrity} />
            ) : null}
          </div>

          <div className="maint-rwo__scroll" style={{ display: 'flex', flexDirection: 'column' }}>
            {shell}
            <div className="maint-rwo__due-wrap">
              <WhatsDueSidebar
                unitId={unitId}
                vehicleMakeKey={vehicleMakeKey}
                currentOdometer={currentOdometer}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
