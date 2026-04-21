import { useEffect, useMemo, useState } from 'react'
import { DriverField } from './DriverField'
import { SearchableCombo } from './SearchableCombo'
import { useVendorComboOptions } from '../../hooks/useVendorComboOptions'
import {
  mergeAlertsIntoStore,
  postIntegrityCheck,
} from '../../api/postIntegrityCheck'
import { VEHICLE_MAKE_OPTIONS } from '../../data/maintenanceScheduleData'
import { useServiceCatalogRows } from '../../hooks/useServiceCatalogRows'
import { ServiceTypePicker } from '../catalog/ServiceTypePicker'

type Props = {
  onIntegrityBatch: (alerts: import('../../types/integrity').IntegrityAlert[]) => void
}

export function MaintenanceBillForm({ onIntegrityBatch }: Props) {
  const vendorOptions = useVendorComboOptions()
  const [unitId, setUnitId] = useState('412')
  const [driverId, setDriverId] = useState('')
  const [driverName, setDriverName] = useState('')
  const [vehicleMakeKey, setVehicleMakeKey] = useState('freightliner_cascadia')
  const [serviceKey, setServiceKey] = useState('pm_b')
  const [billNumber, setBillNumber] = useState('VEND-9921')
  const [amount, setAmount] = useState('6200')
  const [billDate, setBillDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [vendorPartyId, setVendorPartyId] = useState('')
  const [saving, setSaving] = useState(false)
  const { rows: catalogRows, error: catalogError } = useServiceCatalogRows('all')

  useEffect(() => {
    if (catalogRows.length === 0) return
    if (!catalogRows.some((s) => s.service_key === serviceKey)) {
      setServiceKey(catalogRows[0]!.service_key)
    }
  }, [catalogRows, serviceKey])

  useEffect(() => {
    if (vendorOptions.length === 0) return
    setVendorPartyId((v) => {
      if (v && vendorOptions.some((o) => o.value === v)) return v
      return vendorOptions[0]!.value
    })
  }, [vendorOptions])

  const selectedService = catalogRows.find((s) => s.service_key === serviceKey)

  const vendorLabel = useMemo(
    () => vendorOptions.find((o) => o.value === vendorPartyId)?.label ?? vendorPartyId,
    [vendorOptions, vendorPartyId],
  )

  const save = async () => {
    setSaving(true)
    try {
      const saveId = crypto.randomUUID()
      const payload = {
        unitId,
        driverId,
        driverName,
        billNumber,
        amount: parseFloat(amount) || 0,
        billDate,
        vendor: vendorLabel,
        vendorPartyId,
        serviceKey,
        serviceName: selectedService?.service_name,
        billedServiceLabel: selectedService?.service_name ?? serviceKey,
      }
      await new Promise((r) => setTimeout(r, 200))
      const res = await postIntegrityCheck({
        saveType: 'maintenance_bill',
        saveId,
        payload,
      })
      mergeAlertsIntoStore(res.alerts)
      onIntegrityBatch(res.alerts)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="maint-form">
      <h3>Maintenance bill</h3>
      {catalogError && (
        <p className="maint-form__err" role="alert">
          {catalogError}
        </p>
      )}
      <div className="maint-form__grid">
        <label className="field">
          <span>Unit</span>
          <input value={unitId} onChange={(e) => setUnitId(e.target.value)} />
        </label>
        <DriverField
          driverId={driverId}
          driverName={driverName}
          onChange={(id, name) => {
            setDriverId(id)
            setDriverName(name)
          }}
        />
        <label className="field">
          <span>Vehicle make (catalog filter)</span>
          <select
            value={vehicleMakeKey}
            onChange={(e) => setVehicleMakeKey(e.target.value)}
          >
            {VEHICLE_MAKE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field maint-form__full">
          <ServiceTypePicker
            vehicleMakeKey={vehicleMakeKey}
            value={serviceKey}
            onChange={setServiceKey}
            services={catalogRows}
          />
        </div>
        <label className="field">
          <span>Bill #</span>
          <input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        </label>
        <label className="field">
          <span>Amount ($)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Bill date</span>
          <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </label>
        <SearchableCombo
          label="Vendor (QuickBooks)"
          value={vendorPartyId}
          onChange={setVendorPartyId}
          options={vendorOptions}
          placeholder="Type to search vendors…"
        />
      </div>
      <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save (runs integrity check after)'}
      </button>
    </div>
  )
}
