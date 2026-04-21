import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

type Props = {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  allowCustom?: boolean
  /** Shown in “+ Add custom …” (e.g. “unit”, “service type”). */
  customHint?: string
  listPlaceholder?: string
}

export function MultiSelectField({
  label,
  options,
  value,
  onChange,
  allowCustom = false,
  customHint: _customHint = 'value',
  listPlaceholder = 'Search or add...',
}: Props) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  const mergedOptions = useMemo(() => {
    const base = [...options]
    for (const v of value) {
      if (v && !base.includes(v)) base.push(v)
    }
    return base
  }, [options, value])

  /** Options matching search, plus any selected row so chips stay uncheckable while filtering. */
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return mergedOptions
    return mergedOptions.filter(
      (o) => o.toLowerCase().includes(n) || value.includes(o),
    )
  }, [mergedOptions, q, value])

  const showAddCustom =
    allowCustom &&
    q.trim() &&
    !mergedOptions.some((o) => o.toLowerCase() === q.trim().toLowerCase())

  const toggle = (opt: string) => {
    const next = value.includes(opt) ? value.filter((x) => x !== opt) : [...value, opt]
    onChange(next)
  }

  const remove = (opt: string) => {
    onChange(value.filter((x) => x !== opt))
  }

  const addCustom = () => {
    const t = q.trim()
    if (!t) return
    if (!value.includes(t)) onChange([...value, t])
    setQ('')
  }

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (showAddCustom) {
      addCustom()
      return
    }
    const t = q.trim()
    if (!allowCustom || !t) return
    if (mergedOptions.some((o) => o.toLowerCase() === t.toLowerCase())) return
    if (!value.includes(t)) onChange([...value, t])
    setQ('')
  }

  return (
    <div className="fr-ms" ref={rootRef}>
      <span className="fr-ms__label" id={id + '-lbl'}>
        {label}
      </span>
      <div className="fr-ms__box">
        {value.length > 0 ? (
          <div className="fr-ms__chips" aria-label={`Selected: ${label}`}>
            {value.map((v) => (
              <span key={v} className="fr-ms__chip">
                {v}
                <button
                  type="button"
                  className="fr-ms__chip-x"
                  aria-label={`Remove ${v}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => remove(v)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          className="fr-ms__search"
          aria-labelledby={id + '-lbl'}
          placeholder={listPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <div className="fr-ms__list" role="listbox" aria-label={`${label} options`}>
          {filtered.length === 0 && !showAddCustom ? (
            <div className="fr-ms__empty muted">No matches</div>
          ) : (
            filtered.map((opt) => (
              <label key={opt} className="fr-ms__row">
                <input
                  type="checkbox"
                  className="fr-ms__cb"
                  checked={value.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{opt}</span>
              </label>
            ))
          )}
          {showAddCustom ? (
            <button
              type="button"
              className="fr-ms__add-custom"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addCustom}
            >
              {`+ Add custom [${q.trim()}]`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
