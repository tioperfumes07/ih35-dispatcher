import { useEffect, useState } from 'react'
import { ModalFullscreenToggle } from '../ModalFullscreenToggle'
import { MODAL_FULLSCREEN_STYLE, useFullScreen } from '../../hooks/useFullScreen'
import { useColumnResize } from '../../hooks/useColumnResize'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import type { ServiceRecordType, ServiceTypeRow } from '../../types/serviceCatalog'
import { VEHICLE_MAKE_OPTIONS } from '../../data/maintenanceScheduleData'

type Props = {
  open: boolean
  initial: ServiceTypeRow | null
  recordTypeDefault: ServiceRecordType
  onClose: () => void
  onSave: (row: Partial<ServiceTypeRow> & { service_key: string; service_name: string }) => void
}

const empty = (rt: ServiceRecordType): ServiceTypeRow => ({
  id: '',
  service_key: '',
  service_name: '',
  interval_miles: null,
  interval_months: null,
  uses_position_map: false,
  position_map_type: null,
  service_category: 'General',
  record_type: rt,
  avg_cost_low: null,
  avg_cost_high: null,
  applies_to_makes: ['all'],
  notes: '',
  is_manufacturer_required: false,
  display_order: 0,
})

export function ServiceTypeEditorModal({
  open,
  initial,
  recordTypeDefault,
  onClose,
  onSave,
}: Props) {
  const { isFullScreen, toggle } = useFullScreen()
  const makesCol = useColumnResize([120, 240, 100])
  const [f, setF] = useState<ServiceTypeRow>(empty(recordTypeDefault))

  useEffect(() => {
    if (!open) return
    setF(initial ? { ...initial } : empty(recordTypeDefault))
  }, [open, initial, recordTypeDefault])

  if (!open) return null

  const set = (patch: Partial<ServiceTypeRow>) => setF((p) => ({ ...p, ...patch }))

  const toggleMake = (key: string) => {
    const cur = f.applies_to_makes || ['all']
    if (key === 'all') {
      set({ applies_to_makes: ['all'] })
      return
    }
    const next = cur.filter((x) => x !== 'all')
    if (next.includes(key)) set({ applies_to_makes: next.filter((x) => x !== key) || ['all'] })
    else set({ applies_to_makes: [...next, key] })
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal svc-modal"
        style={isFullScreen ? MODAL_FULLSCREEN_STYLE : undefined}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-generic-head">
          <h3>{initial ? 'Edit service' : 'Add service'}</h3>
          <div className="modal-generic-head__actions">
            <ModalFullscreenToggle
              isFullScreen={isFullScreen}
              onToggle={toggle}
              title="Full screen"
            />
            <button type="button" className="modal-fs-toggle" onClick={onClose} aria-label="Close">
              <span className="modal-fs-toggle__icon" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </header>
        <div className="svc-modal__grid">
          <label className="field">
            <span>Service key (slug)</span>
            <input
              value={f.service_key}
              disabled={Boolean(initial)}
              onChange={(e) => set({ service_key: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
            />
          </label>
          <label className="field">
            <span>Service name</span>
            <input value={f.service_name} onChange={(e) => set({ service_name: e.target.value })} />
          </label>
          <label className="field">
            <span>Record type</span>
            <select
              value={f.record_type}
              onChange={(e) => set({ record_type: e.target.value as ServiceRecordType })}
            >
              <option value="maintenance">Maintenance</option>
              <option value="repair">Repair</option>
            </select>
          </label>
          <label className="field">
            <span>Service category</span>
            <input value={f.service_category} onChange={(e) => set({ service_category: e.target.value })} />
          </label>
          <label className="field">
            <span>Interval miles (blank = as-needed)</span>
            <input
              inputMode="numeric"
              value={f.interval_miles ?? ''}
              onChange={(e) =>
                set({
                  interval_miles: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </label>
          <label className="field">
            <span>Interval months (blank = derive from miles ÷ 12,000)</span>
            <input
              inputMode="numeric"
              value={f.interval_months ?? ''}
              onChange={(e) =>
                set({
                  interval_months: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0,
                })
              }
            />
          </label>
          <label className="field svc-modal__full">
            <span>Uses position map</span>
            <input
              type="checkbox"
              checked={f.uses_position_map}
              onChange={(e) => set({ uses_position_map: e.target.checked })}
            />
          </label>
          <label className="field">
            <span>Position map type</span>
            <select
              value={f.position_map_type || ''}
              onChange={(e) => set({ position_map_type: e.target.value || null })}
            >
              <option value="">—</option>
              <option value="tire_steer_axle">tire_steer_axle</option>
              <option value="tire_drive_axles">tire_drive_axles</option>
            </select>
          </label>
          <label className="field">
            <span>Avg cost low</span>
            <input
              inputMode="decimal"
              value={f.avg_cost_low ?? ''}
              onChange={(e) =>
                set({ avg_cost_low: e.target.value === '' ? null : parseFloat(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Avg cost high</span>
            <input
              inputMode="decimal"
              value={f.avg_cost_high ?? ''}
              onChange={(e) =>
                set({ avg_cost_high: e.target.value === '' ? null : parseFloat(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Display order</span>
            <input
              inputMode="numeric"
              value={f.display_order}
              onChange={(e) => set({ display_order: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="field svc-modal__full">
            <span>Manufacturer required</span>
            <input
              type="checkbox"
              checked={f.is_manufacturer_required}
              onChange={(e) => set({ is_manufacturer_required: e.target.checked })}
            />
          </label>
          <div className="field svc-modal__full">
            <span>Applies to makes</span>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  exportDomTableToXlsx(
                    makesCol.tableRef.current,
                    `ServiceTypeMakes-${f.service_key || 'new'}-${new Date().toISOString().slice(0, 10)}`,
                  )
                }
              >
                Export to Excel
              </button>
            </div>
            <div
              style={{
                overflow: 'auto',
                maxHeight: 280,
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              <table
                ref={makesCol.tableRef}
                className="bill-pay__table fr-data-table"
                style={{ tableLayout: 'fixed', width: '100%' }}
              >
                <colgroup>
                  {makesCol.widths.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {['Make key', 'Label', 'Applies'].map((h, i) => (
                      <th
                        key={h}
                        className="fr-th-resizable"
                        style={{ width: makesCol.widths[i] }}
                      >
                        {h}
                        {i < 2 ? (
                          <span
                            className="fr-col-resize"
                            role="separator"
                            aria-hidden
                            onMouseDown={makesCol.onResizeMouseDown(i)}
                          />
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono">all</td>
                    <td>All makes</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={f.applies_to_makes?.includes('all')}
                        onChange={() => toggleMake('all')}
                        aria-label="Applies to all makes"
                      />
                    </td>
                  </tr>
                  {VEHICLE_MAKE_OPTIONS.filter((m) => m.key !== 'generic').map((m) => (
                    <tr key={m.key}>
                      <td className="mono">{m.key}</td>
                      <td>{m.label}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={f.applies_to_makes?.includes(m.key)}
                          onChange={() => toggleMake(m.key)}
                          aria-label={`Applies to ${m.label}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted tiny" style={{ marginTop: 6 }}>
              Drag column edges to resize · Tab follows row order
            </p>
          </div>
          <label className="field svc-modal__full">
            <span>Notes</span>
            <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        <div className="svc-modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (!f.service_key.trim() || !f.service_name.trim()) return
              onSave(f)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
