import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Bell, CheckCircle2, X } from 'lucide-react'
import { ApiError } from '../lib/api'

type ToastItem = { id: number; message: string; tone: 'success' | 'error' }
type NoticeItem = { id: number; title: string; body?: string | null; link?: string | null; onOpen?: () => void }

interface ToastApi {
  success: (message: string) => void
  error: (err: unknown) => void
  /** A notification card at the top right; clicking it opens `link`. */
  notify: (n: { title: string; body?: string | null; link?: string | null; onOpen?: () => void }) => void
}

const ToastContext = createContext<ToastApi | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<ToastItem[]>([])
  const [notices, setNotices] = useState<NoticeItem[]>([])

  const push = useCallback((message: string, tone: ToastItem['tone']) => {
    const id = nextId++
    setItems(list => [...list.slice(-3), { id, message, tone }])
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), tone === 'error' ? 6000 : 3500)
  }, [])

  const dismiss = useCallback((id: number) => setNotices(list => list.filter(n => n.id !== id)), [])
  const notify = useCallback((n: Omit<NoticeItem, 'id'>) => {
    const id = nextId++
    setNotices(list => [...list.slice(-2), { id, ...n }])
    setTimeout(() => dismiss(id), 8000)
  }, [dismiss])

  const value = useMemo<ToastApi>(() => ({
    success: (m: string) => push(m, 'success'),
    error: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
      push(message, 'error')
    },
    notify,
  }), [push, notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} color="#4ADE80" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <div className="notices" aria-live="polite">
        {notices.map(n => (
          <div key={n.id} className={`notice ${n.link || n.onOpen ? 'has-link' : ''}`} role="status"
            onClick={() => { if (n.onOpen) n.onOpen(); else if (n.link) navigate(n.link); if (n.link || n.onOpen) dismiss(n.id) }}>
            <span className="notice-ico"><Bell size={16} /></span>
            <span className="notice-text"><b>{n.title}</b>{n.body && <small>{n.body}</small>}</span>
            <button type="button" className="notice-close" aria-label="Dismiss" onClick={e => { e.stopPropagation(); dismiss(n.id) }}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
