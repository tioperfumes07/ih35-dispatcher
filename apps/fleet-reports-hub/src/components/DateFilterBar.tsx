import { useEffect, useId, useState } from 'react'
import type { DateFilterRange } from '../lib/dateFilterQuickRanges'
import type { DateQuickPickId } from '../lib/dateFilterQuickRanges'
import { rangeForQuickPick } from '../lib/dateFilterQuickRanges'

export type { DateFilterRange } from '../lib/dateFilterQuickRanges'

const CHIPS: { id: DateQuickPickId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'this-week', label: 'This week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-3mo', label: 'Last 3mo' },
  { id: 'last-year', label: 'Last year' },
]

type Props = {
  /** Applied range (drives table). Updated when user clicks Apply. */
  value: DateFilterRange
  onApply: (next: DateFilterRange) => void
  /** Number of rows matching `value`. */
  recordCount: number
}

export function DateFilterBar({ value, onApply, recordCount }: Props) {
  const baseId = useId()
  const [draftFrom, setDraftFrom] = useState(value.from)
  const [draftTo, setDraftTo] = useState(value.to)

  useEffect(() => {
    setDraftFrom(value.from)
    setDraftTo(value.to)
  }, [value.from, value.to])

  const apply = () => {
    if (draftFrom <= draftTo) onApply({ from: draftFrom, to: draftTo })
    else onApply({ from: draftTo, to: draftFrom })
  }

  const pickChip = (id: DateQuickPickId) => {
    const r = rangeForQuickPick(id)
    setDraftFrom(r.from)
    setDraftTo(r.to)
  }

  return (
    <div className="date-filter-bar" role="group" aria-label="Date filter">
      <div className="date-range-pair">
        <label className="date-filter-bar__field">
          <span className="muted tiny" id={`${baseId}-from-l`}>
            From
          </span>
          <input
            type="date"
            aria-labelledby={`${baseId}-from-l`}
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
        </label>
        <label className="date-filter-bar__field">
          <span className="muted tiny" id={`${baseId}-to-l`}>
            To
          </span>
          <input
            type="date"
            aria-labelledby={`${baseId}-to-l`}
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
          />
        </label>
      </div>
      <div className="date-filter-bar__chips" role="toolbar" aria-label="Quick ranges">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="date-filter-bar__chip"
            onClick={() => pickChip(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="date-filter-bar__actions">
        <button type="button" className="btn sm primary" onClick={apply}>
          Apply
        </button>
        <span className="date-filter-bar__count muted small">
          <strong>{recordCount}</strong> {recordCount === 1 ? 'record' : 'records'}
        </span>
      </div>
    </div>
  )
}
