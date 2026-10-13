import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, tokenStore } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  startSession: (token: string, user: User) => void
  logout: () => Promise<void>
  isAdmin: boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!tokenStore.get()) { setReady(true); return }
    api<{ user: User }>('/auth/me')
      .then(r => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    const onExpired = () => { tokenStore.clear(); setUser(null) }
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { body: { email, password }, auth: false })
    tokenStore.set(r.token)
    setUser(r.user)
  }, [])

  const startSession = useCallback((token: string, u: User) => { tokenStore.set(token); setUser(u) }, [])

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* token may already be gone */ }
    tokenStore.clear()
    setUser(null)
  }, [])

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  return <AuthContext.Provider value={{ user, ready, login, startSession, logout, isAdmin }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
