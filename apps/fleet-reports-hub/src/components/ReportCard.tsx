import { useEffect, useId, useState } from 'react'
import type { ReportCategory, ReportDef } from '../types'

type Props = {
  report: ReportDef
  title?: string
  onOpen: () => void
  onRename?: (nextTitle: string) => void
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

export function ReportCard({ report, title, onOpen, onRename }: Props) {
  const pm = report.id === 'A4'
  const catLabel = CATEGORY_LABEL[report.category] ?? report.category
  const titleId = useId()
  const displayTitle = String(title || report.title || '').trim() || report.title
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(displayTitle)

  useEffect(() => {
    if (!isEditing) setDraftTitle(displayTitle)
  }, [displayTitle, isEditing])

  const canRename = typeof onRename === 'function'

  const saveRename = () => {
    if (!canRename) return
    const next = draftTitle.trim()
    if (!next) {
      setDraftTitle(displayTitle)
      setIsEditing(false)
      return
    }
    onRename(next)
    setIsEditing(false)
  }

  const cancelRename = () => {
    setDraftTitle(displayTitle)
    setIsEditing(false)
  }

  return (
    <article
      className="fr-report-card"
      aria-labelledby={titleId}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!isEditing) onOpen()
      }}
      onKeyDown={(e) => {
        if (isEditing) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="fr-report-card__top">
        <span className="fr-report-card__cat">{catLabel}</span>
        {canRename ? (
          <button
            type="button"
            className="fr-report-card__edit"
            onClick={(e) => {
              e.stopPropagation()
              if (isEditing) saveRename()
              else setIsEditing(true)
            }}
          >
            {isEditing ? 'Save' : 'Edit'}
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div
          className="fr-report-card__rename"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            className="fr-report-card__rename-input"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                saveRename()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelRename()
              }
            }}
            autoFocus
            aria-label="Rename report"
          />
          <button
            type="button"
            className="fr-report-card__rename-cancel"
            onClick={(e) => {
              e.stopPropagation()
              cancelRename()
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <h3 id={titleId} className="fr-report-card__title">
          {displayTitle}
        </h3>
      )}

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
