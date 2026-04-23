import React from 'react'

type ErrorBoundaryProps = {
  children: React.ReactNode
  name?: string
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name || 'Component'}]`, error, info)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div
        style={{
          padding: '24px',
          background: '#fff8f8',
          border: '1px solid #ffc0c0',
          borderRadius: '8px',
          margin: '12px',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#cf222e',
            marginBottom: '8px',
          }}
        >
          {this.props.name || 'Section'} failed to load
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#57606a',
            marginBottom: '12px',
          }}
        >
          {this.state.error?.message || 'Unknown error'}
        </div>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            height: '28px',
            padding: '0 14px',
            background: '#0969da',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
