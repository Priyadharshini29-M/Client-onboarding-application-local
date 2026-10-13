import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/hooks'
import { DELIVERABLE_STATUS, dueText, greeting, isLate, pad2, timeAgo } from '../lib/format'
import type { HomeData } from '../lib/types'
import { DeliverablePanel } from '../components/DeliverablePanel'
import { useShell } from '../components/Shell'
import { Button, Empty, Loading, Pill, TeamTag, Track } from '../components/ui'

export function Home() {
  const { user } = useAuth()
  const { addClient, refreshCounts } = useShell()
  const { data, loading, reload } = useApi<HomeData>('/home')
  const [open, setOpen] = useState<number | null>(null)
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="label">{today}</span>
          <h1 style={{ marginTop: 8 }}>{greeting()}, {user?.name.split(' ')[0]}.</h1>
        </div>
      </div>

      {loading || !data ? <Loading /> : <>
        <div className="figures">
          <Link to="/reviews" className="figure"><b>{data.reviews.length}</b><span>waiting for your approval</span></Link>
          <Link to="/clients" className="figure"><b>{data.counts.active_projects}</b><span>active projects</span></Link>
          <Link to="/teams" className="figure"><b style={{ color: Number(data.counts.late) ? 'var(--change)' : undefined }}>{data.counts.late}</b><span>overdue tasks</span></Link>
          <div className="figure"><b>{data.counts.approved_week}</b><span>approved this week</span></div>
        </div>

        <div className="cols" style={{ marginTop: 36 }}>
          <div className="stack" style={{ gap: 28 }}>
            <section className="panel">
              <div className="panel-head"><div><h2>Needs your approval</h2><p>Work submitted by the team</p></div>
                <Link to="/reviews" className="btn btn-ghost btn-sm">All approvals <ArrowRight size={14} /></Link></div>
              {data.reviews.length === 0 ? <Empty title="Nothing to approve">Work submitted by the team shows up here.</Empty> : (
                <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
                  {data.reviews.map(r => (
                    <button key={r.id} className="row-item" onClick={() => setOpen(r.id)}>
                      <span className="vtag">{r.kind === 'intake' ? 'Form' : `V${r.version_count}`}</span>
                      <div className="grow"><div className="t">{r.title}</div><div className="s">{r.brand_name} · {r.stage_name} · submitted {timeAgo(r.updated_at)}</div></div>
                      <span className="btn btn-primary btn-sm">Open</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="section-title" style={{ marginTop: 0 }}><h2>Active clients</h2><Link to="/clients" className="btn btn-ghost btn-sm">All clients <ArrowRight size={14} /></Link></div>
              {data.projects.length === 0 ? (
                <div className="panel"><Empty title="No projects yet" action={<Button variant="primary" onClick={addClient}>Add your first client</Button>}>Add a client to start their project.</Empty></div>
              ) : (
                <div className="client-cards">
                  {data.projects.map(p => (
                    <Link key={p.id} to={`/clients/${p.client_id}`} className="client-card">
                      <div className="between"><span className="label">{p.name}</span><span className="mono muted" style={{ fontSize: 12 }}>{pad2(p.current_stage)}/{pad2(p.stage_count)}</span></div>
                      <h3>{p.client_name}</h3>
                      <Track total={p.stage_count} current={p.current_stage} />
                      <div className="between">
                        <TeamTag name={p.stage_name} icon={p.stage_icon} />
                        {p.status === 'on_hold' ? <span className="pill change">On hold</span>
                          : Number(p.in_review) > 0 ? <span className="pill review">{p.in_review} awaiting approval</span>
                            : Number(p.late) > 0 ? <span className="pill change">{p.late} late</span> : null}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="stack" style={{ gap: 28 }}>
            <section className="panel">
              <div className="panel-head"><div><h2>My tasks</h2><p>Assigned to you or your department</p></div></div>
              {data.work.length === 0 ? <Empty title="All clear">You have no open tasks.</Empty> : (
                <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
                  {data.work.map(w => (
                    <button key={w.id} className="row-item" onClick={() => setOpen(w.id)}>
                      <div className="grow"><div className="t truncate">{w.title}</div><div className="s">{w.brand_name}</div></div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: 4, justifyItems: 'end' }}>
                        <Pill map={DELIVERABLE_STATUS} value={w.status} />
                        <span className={isLate(w.due_date, w.status) ? 'late' : 'muted'} style={{ fontSize: 12.5 }}>{dueText(w.due_date)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head"><h2>Recent activity</h2></div>
              <div className="panel-body feed">
                {data.activity.length === 0 && <p className="muted">Nothing yet.</p>}
                {data.activity.map(a => (
                  <div key={a.id} className="feed-item">
                    <div>
                      <div><b style={{ fontWeight: 600 }}>{a.user_name ?? 'Client'}</b> <span className="soft">{a.message.charAt(0).toLowerCase() + a.message.slice(1)}</span></div>
                      <div className="when">{a.brand_name && <><Link to={`/clients/${a.brand_id}`}>{a.brand_name}</Link> · </>}{timeAgo(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </>}

      {open && <DeliverablePanel id={open} onClose={() => setOpen(null)} onChanged={() => { void reload(); refreshCounts() }} />}
    </div>
  )
}
