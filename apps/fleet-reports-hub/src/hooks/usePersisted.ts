import { useCallback, useEffect, useState } from 'react'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function usePersistedIdSet(key: string) {
  const [value, setValue] = useState<string[]>(() =>
    readJson<string[]>(key, []),
  )

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  const toggle = useCallback((id: string) => {
    setValue((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }, [])

  const has = useCallback((id: string) => value.includes(id), [value])

  return { value, toggle, has }
}

export function useRecentReports(key: string, max = 12) {
  const [value, setValue] = useState<string[]>(() =>
    readJson<string[]>(key, []),
  )

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value.slice(0, max)))
  }, [key, max, value])

  const recordOpen = useCallback(
    (id: string) => {
      setValue((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)]
        return next.slice(0, max)
      })
    },
    [max],
  )

  return { value, recordOpen }
}
