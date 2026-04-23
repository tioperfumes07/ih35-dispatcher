import { useMemo } from 'react'
import type { MaintFleetCategory, MaintFleetUnit } from '../../data/maintFleetUnits'
import { useColumnResize } from '../../hooks/useColumnResize'
import { useTableTabOrder } from '../../hooks/useTableTabOrder'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { ResizeTableTh } from '../table/ResizeTableTh'
import { TableResizeHintFooter } from '../table/TableResizeHintFooter'

type Props = {
  units: MaintFleetUnit[]
  fleetFilter: MaintFleetCategory | 'all'
  selectedId: string
  onSelect: (unitId: string) => void
  /** Double-click a row to open the work order shell for that unit. */
  onOpenRecordModal?: (unitId: string) => void
}

const FLEET_LABEL: Record<MaintFleetCategory, string> = {
  trucks: 'Trucks',
  ref_vans: 'Ref vans',
  flatbeds: 'Flatbeds',
  dry_vans: 'Dry vans',
  company: 'Company',
}

export function MaintUnitFleetTable({
  units,
  fleetFilter,
  selectedId,
  onSelect,
  onOpenRecordModal,
}: Props) {
  const col = useColumnResize([72, 200, 96, 100, 88, 88])

  const rows = useMemo(() => {
    const base = fleetFilter === 'all' ? units : units.filter((u) => u.fleet === fleetFilter)
    return base
  }, [units, fleetFilter])

  useTableTabOrder(col.tableRef, [rows])

  return (
    <div className="maint-fleet-table" role="region" aria-label="Fleet units table">
      <div className="maint-fleet-table__toolbar">
        <span className="acct-kicker">Fleet table</span>
        <button
          type="button"
          className="fr-table-excel-export"
          onClick={() => exportDomTableToXlsx(col.tableRef.current, 'FleetUnits')}
        >
          Export to Excel
        </button>
      </div>
      <div className="maint-fleet-table__wrap">
        <table
          ref={col.tableRef}
          className="fr-data-table maint-fleet-table__grid"
          style={{ tableLayout: 'fixed', width: '100%' }}
        >
          <colgroup>
            {col.widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <ResizeTableTh colIndex={0} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Unit
              </ResizeTableTh>
              <ResizeTableTh colIndex={1} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Make / model
              </ResizeTableTh>
              <ResizeTableTh colIndex={2} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Odometer
              </ResizeTableTh>
              <ResizeTableTh colIndex={3} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Fleet
              </ResizeTableTh>
              <ResizeTableTh colIndex={4} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Past due
              </ResizeTableTh>
              <ResizeTableTh colIndex={5} widths={col.widths} onResizeMouseDown={col.onResizeMouseDown}>
                Due soon
              </ResizeTableTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr
                key={u.id}
                className={u.id === selectedId ? 'maint-fleet-table__tr--selected' : undefined}
                onClick={() => onSelect(u.id)}
                onDoubleClick={(e) => {
                  e.preventDefault()
                  onOpenRecordModal?.(u.id)
                }}
              >
                <td>{u.unitNo}</td>
                <td>{u.makeModel}</td>
                <td className="num">{u.mileage.toLocaleString()}</td>
                <td>{FLEET_LABEL[u.fleet]}</td>
                <td>{u.pastDue ? 'Yes' : '—'}</td>
                <td>{u.dueSoon ? 'Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableResizeHintFooter extra="Double-click a row to open work order" />
    </div>
  )
}
