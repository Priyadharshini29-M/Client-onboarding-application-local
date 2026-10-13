import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useApi, useDebounced } from '../lib/hooks'
import { dueText, isLate } from '../lib/format'
import type { ClientRow, Deliverable, DeliverableStatus } from '../lib/types'
import { DeliverablePanel } from '../components/DeliverablePanel'
import { useShell } from '../components/Shell'
import { Avatar, Loading } from '../components/ui'

const LANES: { key: DeliverableStatus; title: string; hint: string }[] = [
  { key: 'not_started', title: 'Not started', hint: 'Nobody has started yet' },
  { key: 'in_progress', title: 'In progress', hint: 'Being worked on' },
  { key: 'changes_requested', title: 'Needs changes', hint: 'Sent back with feedback' },
  { key: 'in_review', title: 'Waiting for approval', hint: 'Submitted, not approved yet' },
]

/** The task board: everything in open stages, from not started to waiting for approval.
 *  Shown inside the Teams page, either for all departments or for one. */
export function Work({ teamId = '' }: { teamId?: string }) {
  const { refreshCounts } = useShell()
  const [params, setParams] = useSearchParams()
  const team = teamId
  const client = params.get('client') ?? ''
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [open, setOpen] = useState<number | null>(null)

  const { data: clients } = useApi<{ clients: ClientRow[] }>('/clients')
  const qs = new URLSearchParams()
  if (client) qs.set('client_id', client)
  if (mine) qs.set('mine', '1')
  if (dq) qs.set('q', dq)
  const { data: all, loading, reload } = useApi<Deliverable[]>(`/work?${qs}`)

  const items = useMemo(() => (all ?? []).filter(d => !team || String(d.team_id) === team), [all, team])
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }) }

  return (
    <div>

      <div className="stack" style={{ gap: 14, marginBottom: 22 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <select className="select sm" style={{ width: 200 }} value={client} onChange={e => set('client', e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="search" style={{ width: 240 }}><Search size={15} /><input className="input sm" placeholder="Search tasks" value={q} onChange={e => setQ(e.target.value)} aria-label="Search tasks" /></div>
          <label className="check"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Only mine</label>
        </div>
      </div>

      {loading && !all ? <Loading /> : (
        <div className="lanes">
          {LANES.map(lane => {
            const cards = items.filter(d => d.status === lane.key)
            return (
              <div key={lane.key} className="lane">
                <div className="lane-head"><div><b>{lane.title}</b><div className="muted" style={{ fontSize: 12 }}>{lane.hint}</div></div><span className="mono muted" style={{ fontSize: 13 }}>{cards.length}</span></div>
                {cards.length === 0 && <div className="lane-empty">Nothing here</div>}
                {cards.map(d => (
                  <button key={d.id} className="card" onClick={() => setOpen(d.id)}>
                    <div className="between"><span className="cl">{d.brand_name} · {d.stage_name}</span>
                      <span className="row" style={{ gap: 4 }}>{d.blocked && <span className="pill change" style={{ height: 20, fontSize: 11 }}>Blocked</span>}
                        {(d.priority === 'high' || d.priority === 'urgent') && <span className={`pill ${d.priority === 'urgent' ? 'change' : 'review'} plain`} style={{ height: 20, fontSize: 11 }}>{d.priority === 'urgent' ? 'Urgent' : 'High'}</span>}</span></div>
                    <div className="t">{d.version_count > 0 && <span className="vtag" style={{ marginRight: 6 }}>V{d.version_count}</span>}{d.title}</div>
                    <div className="between">
                      <span className={isLate(d.due_date, d.status) ? 'late' : 'muted'} style={{ fontSize: 12.5 }}>{dueText(d.due_date)}</span>
                      {d.assignee_name ? <Avatar name={d.assignee_name} size="sm" /> : <span className="muted" style={{ fontSize: 12 }}>Not assigned</span>}
                    </div>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {open && <DeliverablePanel id={open} onClose={() => setOpen(null)} onChanged={() => { void reload(); refreshCounts() }} />}
    </div>
  )
}
