import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

/** Loads `path` and reloads when it changes. Pass null to skip. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const seq = useRef(0)

  const load = useCallback(async (quiet = false) => {
    if (path === null) return
    const id = ++seq.current
    if (!quiet) setLoading(true)
    try {
      const result = await api<T>(path)
      if (id === seq.current) { setData(result); setError(null) }
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'Something went wrong.'))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [path])

  useEffect(() => { void load() }, [load])

  return { data, setData, error, loading, reload: () => load(true) }
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
  }, [key, value])
  return [value, setValue] as const
}
