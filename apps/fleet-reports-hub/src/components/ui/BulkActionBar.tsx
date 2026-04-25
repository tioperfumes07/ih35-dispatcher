import type { CSSProperties } from 'react'

export interface BulkActionBarAction {
  label: string
  icon?: string
  variant?: 'danger' | 'warning' | 'default'
  onClick: () => void
}

export interface BulkActionBarProps {
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClearSelection: () => void
  actions: BulkActionBarAction[]
  onStatusChange?: (status: string) => void
  onTypeChange?: (type: string) => void
}

const baseButtonStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '13px',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
}

const STATUS_BUTTON_LABELS = new Set([
  'set active',
  'set inactive',
  'out of service',
  'sold',
  'in shop',
  'accident',
])

const dropdownStyle: CSSProperties = {
  padding: '6px 10px',
  background: '#1a1f2e',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '6px',
  color: '#e2e8f0',
  fontSize: '13px',
  cursor: 'pointer',
}

function actionStyle(variant: BulkActionBarAction['variant']): CSSProperties {
  if (variant === 'danger') return { ...baseButtonStyle, background: '#dc2626' }
  if (variant === 'warning') return { ...baseButtonStyle, background: '#d97706' }
  return { ...baseButtonStyle, background: '#3b82f6' }
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  actions,
  onStatusChange,
  onTypeChange,
}: BulkActionBarProps) {
  if (selectedCount <= 0) return null

  const renderedActions = actions.filter(
    (action) => !STATUS_BUTTON_LABELS.has(String(action.label || '').trim().toLowerCase()),
  )

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        background: '#1e3a5f',
        border: '1px solid #3b82f6',
        borderRadius: '8px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dbeafe', fontWeight: 600 }}>
        <span aria-hidden>☑</span>
        <span>{selectedCount} selected</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <select
          defaultValue=""
          onChange={(e) => {
            const status = e.target.value
            if (!status) return
            if (window.confirm('Set ' + selectedCount + ' selected unit(s) to "' + status + '"?')) {
              onStatusChange && onStatusChange(status)
            }
            e.target.selectedIndex = 0
          }}
          style={dropdownStyle}
        >
          <option value="">Change status...</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Out of Service">Out of Service</option>
          <option value="In Shop">In Shop</option>
          <option value="Accident">Accident</option>
          <option value="Sold">Sold</option>
        </select>

        <select
          defaultValue=""
          onChange={(e) => {
            const type = e.target.value
            if (!type) return
            if (window.confirm('Set ' + selectedCount + ' selected unit(s) type to "' + type + '"?')) {
              onTypeChange && onTypeChange(type)
            }
            e.target.selectedIndex = 0
          }}
          style={dropdownStyle}
        >
          <option value="">Change type...</option>
          <option value="Truck">Truck</option>
          <option value="Trailer">Trailer</option>
          <option value="Flatbed">Flatbed</option>
          <option value="Reefer">Reefer</option>
          <option value="Dry Van">Dry Van</option>
          <option value="Step Deck">Step Deck</option>
          <option value="Lowboy">Lowboy</option>
          <option value="Tanker">Tanker</option>
          <option value="Van">Van</option>
          <option value="Company Vehicle">Company Vehicle</option>
          <option value="Other">Other</option>
        </select>

        {renderedActions.map((action) => (
          <button
            key={action.label}
            type="button"
            style={actionStyle(action.variant)}
            onClick={() => {
              const ok = window.confirm(
                'Apply "' + action.label + '" to ' + selectedCount + ' selected record(s)? This cannot be undone.',
              )
              if (!ok) return
              action.onClick()
            }}
          >
            {action.icon ? `${action.icon} ` : ''}
            {action.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={onSelectAll}
          style={{ background: 'transparent', border: 'none', color: '#bfdbfe', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Select all {totalCount}
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          style={{ background: 'transparent', border: 'none', color: '#bfdbfe', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
