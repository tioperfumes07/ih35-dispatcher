import { useEffect, useRef, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let addToastFn: ((msg: string, type: ToastType) => void) | null = null
let fetchInterceptorInstalled = false

export function showToast(message: string, type: ToastType = 'success') {
  if (addToastFn) addToastFn(message, type)
}

function toAction(url: string): string {
  const u = String(url || '').toLowerCase()
  if (u.includes('work-order') || u.includes('/wo')) return 'Work order'
  if (u.includes('bill')) return 'Bill'
  if (u.includes('expense')) return 'Expense'
  if (u.includes('leave')) return 'Leave request'
  if (u.includes('driver')) return 'Driver'
  if (u.includes('schedule')) return 'Schedule'
  if (u.includes('checklist')) return 'Checklist'
  if (u.includes('fuel')) return 'Fuel'
  if (u.includes('qbo') || u.includes('quickbooks')) return 'QuickBooks action'
  if (u.includes('load')) return 'Load'
  if (u.includes('equipment')) return 'Equipment'
  return 'Action'
}

function isMutation(method: string): boolean {
  const m = String(method || 'GET').toUpperCase()
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

export function installGlobalSaveFeedback() {
  if (typeof window === 'undefined' || fetchInterceptorInstalled) return
  fetchInterceptorInstalled = true
  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url || '')

    try {
      const response = await nativeFetch(input as any, init)
      if (isMutation(method)) {
        let body: any = null
        try {
          body = await response.clone().json()
        } catch {
          body = null
        }
        if (response.ok && !(body && body.ok === false)) {
          showToast(`✅ ${toAction(url)} successful`, 'success')
        } else {
          const reason = String(body?.error || body?.message || response.statusText || 'Unknown error').trim()
          showToast(`❌ ${toAction(url)} failed - ${reason}`, 'error')
        }
      }
      return response
    } catch (err: any) {
      if (isMutation(method)) {
        const reason = String(err?.message || err || 'Network error')
        showToast(`❌ ${toAction(url)} failed - ${reason}`, 'error')
      }
      throw err
    }
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(1)

  useEffect(() => {
    addToastFn = (message, type) => {
      const id = idRef.current++
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    }
    return () => {
      addToastFn = null
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            padding: '12px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            color: '#fff',
            minWidth: '280px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            background:
              t.type === 'success' ? '#16a34a' : t.type === 'error' ? '#dc2626' : '#2563eb',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}
          {t.message}
        </div>
      ))}
    </div>
  )
}
