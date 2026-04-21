import { useEffect, useId, useRef, useState } from 'react'
import { searchCatalogParties } from '../../lib/accountingDedupApi'
import type { CatalogParty } from '../../lib/accountingDedupApi'

type Props = {
  driverId: string
  driverName: string
  onChange: (id: string, name: string) => void
  required?: boolean
  disabled?: boolean
}

/**
 * Driver assignment uses **QBO vendors** from the live accounting catalog (same payee entity).
 */
export function DriverField({
  driverId,
  driverName,
  onChange,
  required,
  disabled,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(driverName)
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<CatalogParty[]>([])

  useEffect(() => {
    setText(driverName)
  }, [driverName])

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    const t = window.setTimeout(() => {
      void searchCatalogParties('vendor', text)
        .then(({ parties }) => {
          if (!cancelled) setHits(parties.slice(0, 40))
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [text, disabled])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (p: CatalogParty) => {
    onChange(p.id, p.name)
    setText(p.name)
    setOpen(false)
  }

  return (
    <div className="driver-field maint-combo" ref={rootRef}>
      <label className="field maint-combo__label">
        <span>
          Driver / payee vendor
          {required && <span className="req"> *</span>}
        </span>
        <input
          className="maint-combo__input"
          disabled={disabled}
          value={text}
          placeholder="Type vendor name (QBO)…"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && hits[0]) {
              e.preventDefault()
              pick(hits[0]!)
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              const t = text.trim()
              if (t === driverName.trim() && driverId) return
              const match = hits.find((p) => p.name === t)
              if (match) onChange(match.id, match.name)
              else onChange('', t)
            }, 150)
          }}
        />
      </label>
      {open && !disabled && hits.length > 0 && (
        <ul id={listId} className="maint-combo__list dropdown-layer" role="listbox">
          {hits.map((p) => (
            <li key={p.id} role="option">
              <button type="button" className="maint-combo__opt" onMouseDown={() => pick(p)}>
                <span className="maint-combo__opt-label">{p.name}</span>
                {p.qboId ? (
                  <span className="maint-combo__opt-val muted tiny">{p.qboId}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
