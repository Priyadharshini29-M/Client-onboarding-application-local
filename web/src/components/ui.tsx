import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { avatarColor, initials } from '../lib/format'
import { TeamIcon } from '../lib/teamIcons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'approve' | 'change' | 'danger'

export function Button({ variant = 'secondary', size, loading, icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14, borderColor: 'currentColor', borderTopColor: 'transparent' }} /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>{children}</button>
}

export function Pill<K extends string>({ map, value }: { map: Record<K, { label: string; tone: string }>; value: K | null | undefined }) {
  if (!value || !map[value]) return <span className="muted">—</span>
  return <span className={`pill ${map[value].tone}`}>{map[value].label}</span>
}

export function TeamTag({ name, icon }: { name: string | null; icon?: string | null }) {
  if (!name) return null
  return <span className="tag">{icon !== undefined && <TeamIcon name={icon} size={13} />}{name}</span>
}

export function Avatar({ name, size }: { name: string | null | undefined; size?: 'sm' | 'lg' }) {
  return <span className={`avatar ${size ?? ''}`} style={{ background: avatarColor(name) }} title={name ?? ''}>{initials(name)}</span>
}

/** Segmented tracker: one bar per stage. */
export function Track({ total, current, done, large }: { total: number; current: number; done?: boolean; large?: boolean }) {
  return (
    <div className={`track ${large ? 'lg' : ''}`} aria-label={`Stage ${current} of ${total}`}>
      {Array.from({ length: Number(total) }, (_, i) => (
        <i key={i} className={done || i + 1 < current ? 'done' : i + 1 === Number(current) ? 'open' : ''} />
      ))}
    </div>
  )
}

export function Bar({ value }: { value: number }) {
  return <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

export function Loading() {
  return <div className="loading"><div className="spinner" /></div>
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><h4>{title}</h4>{children && <p>{children}</p>}{action}</div>
}

export function Note({ tone, children }: { tone?: 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone ? AlertTriangle : Info
  return <div className={`note ${tone ?? ''}`} role={tone === 'error' ? 'alert' : undefined}><Icon size={16} /><div>{children}</div></div>
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  )
}

export function Field({ label, required, error, help, children }: {
  label: ReactNode; required?: boolean; error?: string; help?: ReactNode; children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span className="req">*</span>}</label>
      {children(id)}
      {error ? <span className="error">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  )
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// Overlays: Escape closes only the top-most one. -----------------------------------------------

const layers: object[] = []

function useLayer(onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const token = {}
    layers.push(token)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && layers[layers.length - 1] === token) closeRef.current() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=file]), textarea, select')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      layers.splice(layers.indexOf(token), 1)
      if (!layers.length) document.body.style.overflow = ''
    }
  }, [ref])
}

export function Modal({ title, sub, onClose, children, footer, size }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayer(onClose, ref)
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <IconButton label="Close" className="line" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ onClose, head, children }: { onClose: () => void; head: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayer(onClose, ref)
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" ref={ref}>
        <div className="drawer-head">
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div className="grow">{head}</div>
            <IconButton label="Close" className="line" onClick={onClose}><X size={16} /></IconButton>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}

export function Confirm({ title, message, action = 'Delete', onConfirm, onClose }: {
  title: string; message: ReactNode; action?: string; onConfirm: () => Promise<void>; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>Keep it</Button>
      <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose() } catch { setBusy(false) } }}>{action}</Button>
    </>}>
      <p className="soft">{message}</p>
    </Modal>
  )
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false)
}
