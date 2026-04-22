import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'

type Props = {
  label: string
  /** Canonical option ids from data (e.g. "101", "PM-A") */
  optionValues: string[]
  formatLabel: (value: string) => string
  selected: string[]
  onChange: (next: string[]) => void
  listPlaceholder?: string
}

function norm(s: string) {
  return s.trim().toLowerCase()
}

export function MultiSelectFilterField({
  label,
  optionValues,
  formatLabel,
  selected,
  onChange,
  listPlaceholder = 'Type to filter…',
}: Props) {
  const [search, setSearch] = useState('')

  const displayPool = useMemo(() => {
    const m = new Set<string>()
    for (const v of optionValues) m.add(String(v))
    for (const v of selected) m.add(String(v))
    return [...m].sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)))
  }, [optionValues, selected, formatLabel])

  const q = norm(search)
  const filtered = useMemo(() => {
    if (!q) return displayPool
    return displayPool.filter(
      (v) =>
        norm(formatLabel(v)).includes(q) ||
        norm(String(v)).includes(q),
    )
  }, [displayPool, q, formatLabel])

  const trimmed = search.trim()
  const canAdd =
    trimmed.length > 0 &&
    !displayPool.some((v) => norm(String(v)) === norm(trimmed)) &&
    !selected.some((v) => norm(String(v)) === norm(trimmed))

  const toggle = useCallback(
    (value: string) => {
      const v = String(value)
      if (selected.includes(v)) onChange(selected.filter((x) => x !== v))
      else onChange([...selected, v])
    },
    [selected, onChange],
  )

  const remove = useCallback(
    (value: string) => {
      onChange(selected.filter((x) => x !== value))
    },
    [selected, onChange],
  )

  const addCustom = useCallback(() => {
    if (!canAdd) return
    onChange([...selected, trimmed])
    setSearch('')
  }, [canAdd, trimmed, selected, onChange])

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  return (
    <div className="multi-select-field">
      <span className="multi-select-field__label">{label}</span>
      <div className="multi-select-field__chips" aria-label={`Selected ${label}`}>
        {selected.length === 0 ? (
          <span className="multi-select-field__empty muted">None selected</span>
        ) : (
          selected.map((v) => (
            <span key={v} className="multi-select-field__chip">
              <span className="multi-select-field__chip-text">{formatLabel(v)}</span>
              <button
                type="button"
                className="multi-select-field__chip-remove"
                aria-label={`Remove ${formatLabel(v)}`}
                onClick={() => remove(v)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <input
        type="search"
        className="multi-select-field__search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder={listPlaceholder}
        autoComplete="off"
      />
      <div className="multi-select-field__list" role="listbox" aria-multiselectable="true">
        {filtered.map((v) => {
          const checked = selected.includes(v)
          return (
            <label key={v} className="multi-select-field__row">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(v)}
              />
              <span>{formatLabel(v)}</span>
            </label>
          )
        })}
        {canAdd && (
          <button type="button" className="multi-select-field__add" onClick={addCustom}>
            Add &quot;{trimmed}&quot;
          </button>
        )}
        {filtered.length === 0 && !canAdd && (
          <span className="multi-select-field__empty muted">No matches</span>
        )}
      </div>
    </div>
  )
}
