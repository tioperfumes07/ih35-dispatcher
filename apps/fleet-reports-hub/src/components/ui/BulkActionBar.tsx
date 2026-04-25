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
}

const baseButtonStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '13px',
  border: 'none',
  color: '#fff',
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
}: BulkActionBarProps) {
  if (selectedCount <= 0) return null

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
        {actions.map((action) => (
          <button key={action.label} type="button" style={actionStyle(action.variant)} onClick={action.onClick}>
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
