import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { CLIENT_STATUS } from '../lib/format'
import type { Blueprint, ClientRow } from '../lib/types'
import { Button, Modal, Note, Pill } from './ui'
import { useToast } from './toast'

/** Start one project type for several clients in one go. Clients already running that type are skipped. */
export function StartProject({ blueprintId, onClose, onDone }: { blueprintId?: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { data: blueprints } = useApi<Blueprint[]>('/blueprints')
  const { data } = useApi<{ clients: ClientRow[] }>('/clients')
  const [bp, setBp] = useState(blueprintId ? String(blueprintId) : '')
  const [picked, setPicked] = useState<number[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ started: string[]; skipped: string[] } | null>(null)

  const bpId = bp || String(blueprints?.[0]?.id ?? '')
  const type = blueprints?.find(b => String(b.id) === bpId)
  const clients = useMemo(() => (data?.clients ?? []).filter(c => c.name.toLowerCase().includes(q.toLowerCase())), [data, q])
  const byId = new Map(data?.clients.map(c => [c.id, c.name]))
  const toggle = (id: number) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function start() {
    setBusy(true)
    try {
      const r = await api<{ started: string[]; skipped: string[] }>('/projects/start', { body: { blueprint_id: bpId, client_ids: picked } })
      setResult(r)
      if (r.started.length) toast.success(`${type?.name} started for ${r.started.length} client${r.started.length > 1 ? 's' : ''}`)
      onDone()
    } catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  if (result) {
    return (
      <Modal title="Done" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
        <div className="stack">
          {result.started.length > 0 && <Note tone="ok">Started {type?.name} for {result.started.join(', ')}.</Note>}
          {result.skipped.length > 0 && <Note tone="warn">Skipped {result.skipped.join(', ')}: they already have a {type?.name} project running.</Note>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Start a project" sub="Pick a project type and every client it's for. Each client gets their own stages and tasks." onClose={onClose} size="lg"
      footer={<>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 14 }}>{picked.length} client{picked.length === 1 ? '' : 's'} chosen</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!picked.length || !bpId} onClick={start}>
          Start for {picked.length || ''} client{picked.length === 1 ? '' : 's'}
        </Button>
      </>}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Project type</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {blueprints?.map(b => (
              <button key={b.id} type="button" className={`team-chip ${String(b.id) === bpId ? 'active' : ''}`} onClick={() => setBp(String(b.id))}>
                {b.name}<span className="count">{b.stages.length} stages</span>
              </button>
            ))}
          </div>
          {type && <p className="muted" style={{ fontSize: 13 }}>{type.stages.map(s => s.name).join(' → ')}</p>}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="between">
            <span className="label">Clients</span>
            <div className="row">
              <Button size="sm" variant="ghost" onClick={() => setPicked(Array.from(new Set([...picked, ...clients.map(c => c.id)])))}>Choose all</Button>
              <Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => setPicked([])}>Clear</Button>
            </div>
          </div>
          <div className="search"><Search size={15} /><input className="input sm" placeholder="Find a client" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a client" /></div>
          <div className="panel" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {clients.length === 0 && <p className="muted" style={{ padding: 16 }}>No clients match.</p>}
            <div className="rows">
              {clients.map(c => {
                const on = picked.includes(c.id)
                return (
                  <button key={c.id} type="button" className="row-item" onClick={() => toggle(c.id)} style={{ background: on ? 'var(--paper)' : undefined }} aria-pressed={on}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--line-strong)'}`, background: on ? 'var(--ink)' : 'var(--surface)', display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}>
                      {on && <Check size={13} />}
                    </span>
                    <span className="grow t">{c.name}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>{c.project_name ?? 'No project'}</span>
                    <Pill map={CLIENT_STATUS} value={c.status} />
                  </button>
                )
              })}
            </div>
          </div>
          {picked.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {picked.map(id => (
                <span key={id} className="pill plain" style={{ background: 'var(--sunk)', color: 'var(--ink)', paddingRight: 4 }}>
                  {byId.get(id)}
                  <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id)}`} style={{ border: 0, background: 'none', cursor: 'pointer', display: 'grid', color: 'inherit' }}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
