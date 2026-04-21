import { useMemo, useState } from 'react'
import { exportDomTableToXlsx } from '../../lib/tableExportXlsx'
import { useColumnResize } from '../../hooks/useColumnResize'
// Open alerts: MaintenanceWorkspace polls the store every 60s for the snapshot KPI strip; this view uses refreshKey.
import type { IntegrityAlert } from '../../types/integrity'
import { loadStoredAlerts, markAlertReviewed } from '../../api/postIntegrityCheck'
import { INTEGRITY_RULE_DOCS } from '../../data/integrityCheckDocs'
import { MaintModalShell, MaintModalSaveButton, type MaintSaveVisualState } from './MaintModalShell'

type Tab =
  | 'all'
  | 'tires'
  | 'drivers'
  | 'accidents'
  | 'fuel'
  | 'maintenance'
  | 'predictive'
  | 'resolved'

type Props = {
  refreshKey: number
  onAlertsChanged?: () => void
}

export function IntegrityDashboard({ refreshKey, onAlertsChanged }: Props) {
  const triggerCol = useColumnResize([88, 160, 96, 88, 120, 88, 220])
  const [tab, setTab] = useState<Tab>('all')
  const [detail, setDetail] = useState<IntegrityAlert | null>(null)
  const [reviewVis, setReviewVis] = useState<MaintSaveVisualState>('idle')
  const [tick, setTick] = useState(0)

  const alerts = useMemo(() => {
    void refreshKey
    void tick
    return loadStoredAlerts()
  }, [refreshKey, tick])

  const filtered = useMemo(() => {
    if (tab === 'resolved') return alerts.filter((a) => a.reviewedAt)
    if (tab === 'all') return alerts.filter((a) => !a.reviewedAt)
    return alerts.filter((a) => !a.reviewedAt && a.category === tab)
  }, [alerts, tab])

  const kpis = useMemo(() => {
    const open = alerts.filter((a) => !a.reviewedAt)
    return {
      open: open.length,
      tires: open.filter((a) => a.category === 'tires').length,
      drivers: open.filter((a) => a.category === 'drivers').length,
      accidents: open.filter((a) => a.category === 'accidents').length,
      fuel: open.filter((a) => a.category === 'fuel').length,
      maintenance: open.filter((a) => a.category === 'maintenance').length,
      predictive: open.filter((a) => a.category === 'predictive').length,
      resolved: alerts.filter((a) => a.reviewedAt).length,
    }
  }, [alerts])

  const CATEGORY_TAB_SRC: { id: Tab; label: string }[] = [
    { id: 'accidents', label: 'Accidents' },
    { id: 'drivers', label: 'Drivers' },
    { id: 'fuel', label: 'Fuel' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'predictive', label: 'Predictive' },
    { id: 'tires', label: 'Tires' },
  ]
  const categoryTabs: { id: Tab; label: string }[] = [...CATEGORY_TAB_SRC].sort((a, b) =>
    a.label.localeCompare(b.label),
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'All' },
    ...categoryTabs,
    { id: 'resolved', label: 'Resolved' },
  ]

  const review = (a: IntegrityAlert) => {
    markAlertReviewed(a.id)
    setTick((x) => x + 1)
    onAlertsChanged?.()
    if (detail?.id === a.id) setDetail(null)
  }

  const reviewFromModal = async () => {
    if (!detail) return
    setReviewVis('loading')
    try {
      await new Promise((r) => setTimeout(r, 220))
      markAlertReviewed(detail.id)
      setTick((x) => x + 1)
      onAlertsChanged?.()
      setReviewVis('success')
      window.setTimeout(() => {
        setDetail(null)
        setReviewVis('idle')
      }, 500)
    } catch {
      setReviewVis('error')
      window.setTimeout(() => setReviewVis('idle'), 1600)
    }
  }

  const modalUnitInfo = detail
    ? [
        detail.triggeringRecords.map((r) => r.unit).find(Boolean),
        detail.triggeringRecords.map((r) => r.driver).find(Boolean),
      ]
        .filter(Boolean)
        .join(' · ') || null
    : null

  const borderClass = (a: IntegrityAlert) =>
    `integrity-card integrity-card--${a.category} integrity-card--${a.severity}`

  return (
    <div className="integrity-dash">
      <h3>Integrity dashboard</h3>
      <p className="muted small">
        Rules: {INTEGRITY_RULE_DOCS.T1}, {INTEGRITY_RULE_DOCS.D1},{' '}
        {INTEGRITY_RULE_DOCS.A3}, … (full list in Settings).
      </p>

      <div className="integrity-kpis" aria-label="Integrity KPIs">
        <div className="integrity-kpi">
          <span className="muted tiny">Open</span>
          <strong>{kpis.open}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Tires</span>
          <strong>{kpis.tires}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Drivers</span>
          <strong>{kpis.drivers}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Accidents</span>
          <strong>{kpis.accidents}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Fuel</span>
          <strong>{kpis.fuel}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Maint.</span>
          <strong>{kpis.maintenance}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Predictive</span>
          <strong>{kpis.predictive}</strong>
        </div>
        <div className="integrity-kpi">
          <span className="muted tiny">Resolved</span>
          <strong>{kpis.resolved}</strong>
        </div>
      </div>

      <div className="integrity-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'integrity-tab active' : 'integrity-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="integrity-cards">
        {filtered.length === 0 ? (
          <p className="empty small">No alerts in this view.</p>
        ) : (
          filtered.map((a) => (
            <article key={a.id} className={borderClass(a)}>
              <header className="integrity-card__head">
                <span className="integrity-card__code">{a.checkCode}</span>
                {INTEGRITY_RULE_DOCS[a.checkCode] && (
                  <span className="muted tiny integrity-card__rule">
                    {INTEGRITY_RULE_DOCS[a.checkCode]}
                  </span>
                )}
              </header>
              <h4>{a.title}</h4>
              <p className="muted small">{a.message}</p>
              <footer className="integrity-card__foot">
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setDetail(a)}
                >
                  Investigate
                </button>
                {!a.reviewedAt && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => review(a)}
                  >
                    Mark reviewed
                  </button>
                )}
              </footer>
            </article>
          ))
        )}
      </div>

      {detail && (
        <MaintModalShell
          open
          onClose={() => {
            setDetail(null)
            setReviewVis('idle')
          }}
          documentTypePill="Integrity alert"
          unitInfo={modalUnitInfo}
          className="maint-modal--drawerish"
          saveBar={
            !detail.reviewedAt ? (
              <MaintModalSaveButton
                label="Mark reviewed"
                state={reviewVis}
                onClick={() => void reviewFromModal()}
              />
            ) : (
              <span className="muted small">Resolved</span>
            )
          }
        >
          <h2 className="maint-modal__h2">{detail.title}</h2>
          <p className="mono small muted">{detail.id}</p>
          <p className="small">{detail.message}</p>
          <h3 className="integrity-drawer__sub">Triggering records</h3>
          <div className="bill-pay__table-toolbar">
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                exportDomTableToXlsx(
                  triggerCol.tableRef.current,
                  detail ? `IntegrityTrigger-${detail.id}` : 'IntegrityTrigger',
                )
              }
            >
              Export to Excel
            </button>
          </div>
          <div className="integrity-drawer__tablewrap">
            <table
              ref={triggerCol.tableRef}
              className="bill-pay__table fr-data-table integrity-drawer__data-table"
              style={{ tableLayout: 'fixed', width: '100%' }}
            >
              <colgroup>
                {triggerCol.widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {(
                    [
                      ['ID', ''],
                      ['Label', ''],
                      ['Date', ''],
                      ['Unit', ''],
                      ['Driver', ''],
                      ['Amount', 'num'],
                      ['Detail', ''],
                    ] as const
                  ).map(([label, cls], i) => (
                    <th
                      key={label}
                      className={`fr-th-resizable ${cls || ''}`.trim()}
                      style={{ width: triggerCol.widths[i] }}
                    >
                      {label}
                      {i < triggerCol.widths.length - 1 ? (
                        <span
                          className="fr-col-resize"
                          role="separator"
                          aria-hidden
                          onMouseDown={triggerCol.onResizeMouseDown(i)}
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.triggeringRecords.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>{r.label}</td>
                    <td>{r.date ?? '—'}</td>
                    <td>{r.unit ?? '—'}</td>
                    <td>{r.driver ?? '—'}</td>
                    <td className="num">
                      {r.amount != null ? r.amount.toFixed(2) : '—'}
                    </td>
                    <td>{r.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted tiny" style={{ marginTop: 6 }}>
              Drag column edges to resize
            </p>
          </div>
        </MaintModalShell>
      )}
    </div>
  )
}
