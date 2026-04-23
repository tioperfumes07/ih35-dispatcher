import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type ComboOption = { value: string; label: string; subtitle?: string }

type Props = {
  label: string
  value: string
  onChange: (next: string) => void
  options: ComboOption[]
  placeholder?: string
  /** When true, empty query shows all options; otherwise cap list length for performance */
  maxVisible?: number
  tabIndex?: number
}

export function SearchableCombo({
  label,
  value,
  onChange,
  options,
  placeholder = 'Type to search or enter a value…',
  maxVisible = 80,
  tabIndex,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    const o = options.find((x) => x.value === value)
    setDraft(o?.label ?? value)
  }, [value, options])

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const base = !q
      ? options
      : options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
        )
    return base.slice(0, maxVisible)
  }, [draft, options, maxVisible])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (v: string) => {
    onChange(v)
    const o = options.find((x) => x.value === v)
    setDraft(o?.label ?? v)
    setOpen(false)
  }

  const commitCustom = () => {
    const t = draft.trim()
    onChange(t)
    setOpen(false)
  }

  return (
    <div className="maint-combo" ref={rootRef}>
      <label className="field maint-combo__label">
        <span>{label}</span>
        <input
          className="maint-combo__input"
          value={draft}
          placeholder={placeholder}
          tabIndex={tabIndex}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitCustom()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
          onBlur={() => {
            window.setTimeout(() => {
              const t = draft.trim()
              const byLabel = options.find((o) => o.label.trim() === t)
              if (byLabel) {
                if (byLabel.value !== value) onChange(byLabel.value)
                return
              }
              if (t !== value) onChange(t)
            }, 120)
          }}
        />
      </label>
      {open && (
        <ul id={listId} className="maint-combo__list dropdown-layer" role="listbox">
          {filtered.length === 0 ? (
            <li className="maint-combo__empty muted small">No matches — Enter to use typed value</li>
          ) : (
            filtered.map((o) => (
              <li key={o.value + o.label} role="option">
                <button
                  type="button"
                  className={'maint-combo__opt' + (o.value === '__add' ? ' maint-combo__opt--addnew' : '')}
                  onMouseDown={() => pick(o.value)}
                >
                  <span className="maint-combo__opt-label">{o.label}</span>
                  {o.subtitle ? (
                    <span className="muted tiny" style={{ fontStyle: 'italic' }}>
                      {' '}
                      {o.subtitle}
                    </span>
                  ) : null}
                  {o.label !== o.value ? (
                    <span className="maint-combo__opt-val muted tiny">{o.value}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
