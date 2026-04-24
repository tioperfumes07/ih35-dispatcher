import { useId } from 'react'
import type { ReportCategory, ReportDef } from '../types'

type Props = {
  report: ReportDef
  onOpen: () => void
}

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  overview: 'Overview',
  maintenance: 'Maintenance',
  accounting: 'Accounting',
  compliance: 'Compliance',
  safety: 'Safety & HOS',
  fuel: 'Fuel & Energy',
  operations: 'Operations',
  dot: 'DOT Compliance',
  custom: 'Custom',
}

export function ReportCard({ report, onOpen }: Props) {
  const pm = report.id === 'A4'
  const catLabel = CATEGORY_LABEL[report.category] ?? report.category
  const titleId = useId()

  return (
    <article
      className="fr-report-card"
      aria-labelledby={titleId}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="fr-report-card__cat">{catLabel}</span>
      <h3 id={titleId} className="fr-report-card__title">
        {report.title}
      </h3>
      <p className="fr-report-card__desc">{report.description}</p>
      {pm && (
        <div className="pm-legend fr-report-card__pm" aria-hidden="true">
          <span className="dot ok" /> Current
          <span className="dot soon" /> Due soon
          <span className="dot late" /> Overdue
        </div>
      )}
      <div className="tags fr-report-card__tags">
        {report.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      {(report.qboReportName || report.apiHint) && (
        <p className="mono hint fr-report-card__hint">
          {report.qboReportName
            ? `GET /api/reports/qbo/${report.qboReportName}`
            : report.apiHint}
        </p>
      )}
    </article>
  )
}
