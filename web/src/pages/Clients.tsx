import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Layers, Plus, Search, ShoppingBag, Target } from 'lucide-react'
import { useApi, useDebounced } from '../lib/hooks'
import { CLIENT_STATUS, FORM_STATUS, healthTone, pad2 } from '../lib/format'
import type { ClientRow, ClientStatus } from '../lib/types'
import { useShell } from '../components/Shell'
import { StartProject } from '../components/StartProject'
import { Avatar, Button, Empty, Loading, PageHead, Pill, Tabs, TeamTag, Track } from '../components/ui'

type Filter = 'all' | ClientStatus

export function Clients() {
  const { addClient } = useShell()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? 'all') as Filter
  const type = params.get('type') ?? ''
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const qs = new URLSearchParams()
  if (status !== 'all') qs.set('status', status)
  if (dq) qs.set('q', dq)
  if (type) qs.set('type', type)
  const [starting, setStarting] = useState(false)
  const { data, loading, reload } = useApi<{ clients: ClientRow[]; counts: Partial<Record<ClientStatus, number>>; types: Record<string, number> }>(`/clients?${qs}`)
  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + Number(b), 0)

  return (
    <div className="page">
      <PageHead title="Clients" sub="Every brand we're working with and the stage they're at."
        actions={<>
          <Button icon={<Layers size={15} />} onClick={() => setStarting(true)}>Start a project</Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={addClient}>Add client</Button>
        </>} />

      <div className="team-chips" style={{ marginBottom: 18 }}>
        {[['', 'All clients'], ['ecommerce', 'E-commerce brands'], ['lead_gen', 'Lead generation']].map(([k, label]) => (
          <button key={k} className={`team-chip ${type === k ? 'active' : ''}`} onClick={() => { const n = new URLSearchParams(params); if (k) n.set('type', k); else n.delete('type'); setParams(n) }}>
            {k === 'ecommerce' ? <ShoppingBag size={14} /> : k === 'lead_gen' ? <Target size={14} /> : null}{label}
            <span className="count">{k ? Number(data?.types?.[k] ?? 0) : Object.values(data?.types ?? {}).reduce((a, b) => a + Number(b), 0)}</span>
          </button>
        ))}
      </div>
      <div className="between wrap" style={{ alignItems: 'flex-end' }}>
        <Tabs value={status} onChange={k => { const n = new URLSearchParams(params); if (k === 'all') n.delete('status'); else n.set('status', k); setParams(n) }} tabs={[
          { key: 'all', label: 'All', count: total },
          ...(['new', 'in_progress', 'on_hold', 'live', 'retainer'] as ClientStatus[]).map(k => ({ key: k, label: CLIENT_STATUS[k].label, count: Number(data?.counts[k] ?? 0) })),
        ]} />
        <div className="search" style={{ width: 280, maxWidth: '100%', marginBottom: 16 }}>
          <Search size={15} />
          <input className="input sm" placeholder="Find a client" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a client" />
        </div>
      </div>

      <div className="panel">
        {loading && !data ? <Loading /> : !data?.clients.length ? (
          <Empty title={q ? 'No clients match' : 'No clients here'} action={!q && <Button variant="primary" onClick={addClient}>Add client</Button>}>
            {q ? 'Try another name.' : 'Add a client to set up their project and intake form.'}
          </Empty>
        ) : (
          <div className="rows">
            {data.clients.map(c => (
              <Link key={c.id} to={`/clients/${c.id}`} className="row-item" style={{ flexWrap: 'wrap', rowGap: 10 }}>
                {c.logo_url ? <img src={c.logo_url} alt="" className="brand-logo sm" /> : <Avatar name={c.name} />}
                <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <div className="t" style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 600 }}>{c.name}</div>
                  <div className="s">{c.brand_type === 'ecommerce' ? 'E-commerce' : 'Lead generation'}{c.industry ? ` · ${c.industry}` : ''}</div>
                </div>
                <div style={{ flex: '2 1 260px', display: 'grid', gap: 7 }}>
                  {c.project_id ? <>
                    <Track total={c.stage_count} current={c.current_stage ?? 1} done={c.project_status === 'completed'} />
                    <div className="between">
                      <TeamTag name={c.project_status === 'completed' ? 'Complete' : c.stage_name} icon={c.project_status === 'completed' ? null : c.stage_icon} />
                      <span className="mono muted" style={{ fontSize: 12 }}>{pad2(c.current_stage ?? 1)}/{pad2(c.stage_count)}</span>
                    </div>
                  </> : <span className="muted">—</span>}
                </div>
                <div style={{ flex: '0 0 120px', display: 'grid', gap: 4, justifyItems: 'center' }} title={c.health_reasons.join(', ') || 'Nothing needs attention'}>
                  <b style={{ fontFamily: 'var(--display)', fontSize: 20, color: healthTone(c.health) }}>{c.health}<span className="muted" style={{ fontSize: 12 }}>/100</span></b>
                  <span className="muted" style={{ fontSize: 12 }}>{Number(c.open_work)} open{Number(c.blocked_count) ? ` · ` : ''}{Number(c.blocked_count) ? <span className="late">{c.blocked_count} blocked</span> : ''}</span>
                </div>
                <div style={{ flex: '0 0 170px', display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <Pill map={CLIENT_STATUS} value={c.status} />
                  {c.status === 'retainer' ? <span className="muted" style={{ fontSize: 12.5 }}>Monthly work</span>
                    : Number(c.setup_total) > 0 && c.project_status === 'completed' ? <span className="muted" style={{ fontSize: 12.5 }}>Setup {c.setup_done}/{c.setup_total}</span>
                    : c.intake_status !== 'submitted' ? <span className="muted" style={{ fontSize: 12.5 }}>Form: {FORM_STATUS[c.intake_status ?? 'not_sent'].label.toLowerCase()}</span>
                    : Number(c.in_review) > 0 ? <span style={{ fontSize: 12.5, color: 'var(--review)' }}>{c.in_review} awaiting approval</span>
                      : <span className="muted" style={{ fontSize: 12.5 }}>{c.approved}/{c.deliverable_count} tasks done</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {starting && <StartProject onClose={() => setStarting(false)} onDone={() => void reload()} />}
    </div>
  )
}
