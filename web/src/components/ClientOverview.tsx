import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { BRAND_TYPE, CLIENT_STATUS, formatDate, formatDateTime, FORM_STATUS, pad2, timeAgo } from '../lib/format'
import { HealthBadge } from './HealthBadge'
import { TeamIcon } from '../lib/teamIcons'
import { CLIENT_TYPES, formatProfileValue } from '../lib/clientTypes'
import { useToast } from './toast'
import type { ClientDetail, Project } from '../lib/types'
import { Avatar, Bar, Button, Pill, TeamTag, Track } from './ui'

type Go = (view: 'project' | 'team' | 'onboarding' | 'setup' | 'content' | 'assets' | 'history') => void

/** The brand at a glance: where the project is, onboarding, setup, assets, the next step and recent history. */
export function ClientOverview({ client, project, go, onEdit }: { client: ClientDetail; project: Project | null; go: Go; onEdit: () => void }) {
  const next = nextStep(client, project)
  const stage = project?.stages.find(s => s.position === project.current_stage)
  const setupPct = Number(client.setup_total) ? Math.round((Number(client.setup_done) / Number(client.setup_total)) * 100) : 0

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="ov-grid">
        <button className="ov-card" onClick={() => go('project')}>
          <span className="label">Project · {pad2(client.current_stage ?? 1)}/{pad2(client.stage_count)}</span>
          <b style={{ fontSize: 20 }}>{client.project_status === 'completed' ? 'Complete' : client.stage_name ?? '—'}</b>
          {client.project_id && <Track total={client.stage_count} current={client.current_stage ?? 1} done={client.project_status === 'completed'} />}
          <span className="muted" style={{ fontSize: 13 }}>{client.approved}/{client.deliverable_count} tasks done{Number(client.in_review) ? ` · ${client.in_review} awaiting approval` : ''}</span>
        </button>
        <button className="ov-card" onClick={() => go('onboarding')}>
          <span className="label">Onboarding</span>
          <b style={{ fontSize: 20 }}>{FORM_STATUS[client.intake_status ?? 'not_sent'].label}</b>
          <span className="muted" style={{ fontSize: 13 }}>{client.intake_submitted_at ? `Form submitted ${formatDateTime(client.intake_submitted_at)}` : 'Form not submitted yet'}</span>
          <span className="muted" style={{ fontSize: 13 }}>Documents: {Number(client.docs_total) - Number(client.docs_pending)}/{client.docs_total} received</span>
        </button>
        <button className="ov-card" onClick={() => go('setup')}>
          <span className="label">Setup checklist</span>
          <b>{client.setup_done}<span className="muted" style={{ fontSize: 18 }}>/{client.setup_total}</span></b>
          <Bar value={setupPct} />
          <span className="muted" style={{ fontSize: 13 }}>{client.status === 'retainer' ? 'On retainer' : Number(client.setup_total) ? `${Number(client.setup_total) - Number(client.setup_done)} left before retainer` : 'Not started'}</span>
        </button>
        <button className="ov-card" onClick={() => go('assets')}>
          <span className="label">Assets</span>
          <b>{client.asset_count}</b>
          <span className="muted" style={{ fontSize: 13 }}>Drive links and documents</span>
        </button>
      </div>

      <div className="cols">
        <div className="stack" style={{ gap: 22 }}>
          <section className="panel" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="grow">
              <span className="label">Next step</span>
              <h2 style={{ fontSize: 21, marginTop: 6 }}>{next.title}</h2>
              <p className="soft" style={{ marginTop: 4 }}>{next.body}</p>
            </div>
            {next.view && <Button variant="primary" icon={<ArrowRight size={15} />} onClick={() => go(next.view!)}>{next.cta}</Button>}
          </section>

          {stage && (
            <section className="panel">
              <div className="panel-head"><div><span className="label">Current stage</span><h2 style={{ marginTop: 6 }}>{stage.name}</h2><p>{stage.summary}</p></div><TeamTag name={stage.team_name} icon={stage.team_icon} /></div>
              <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
                {stage.deliverables.map(d => (
                  <button key={d.id} className="row-item" onClick={() => go('project')}>
                    <span className="grow t">{d.title}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{d.assignee_name ?? 'Not assigned'}</span>
                    <span className={`pill ${d.status === 'approved' ? 'ok' : d.status === 'in_review' ? 'review' : d.status === 'changes_requested' ? 'change' : d.status === 'in_progress' ? 'progress' : ''}`}>
                      {{ not_started: 'Not started', in_progress: 'In progress', in_review: 'Waiting for approval', changes_requested: 'Needs changes', approved: 'Approved' }[d.status]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="stack" style={{ gap: 22 }}>
          <section className="panel">
            <div className="panel-head"><h2>Brand details</h2><Pill map={CLIENT_STATUS} value={client.status} /></div>
            <div className="panel-body kv">
              <div><span>Health</span><span><HealthBadge score={client.health} reasons={client.health_reasons} /></span></div>
              <div><span>Industry</span><span>{client.industry ?? '—'}</span></div>
              <div><span>Client type</span><span>{BRAND_TYPE[client.brand_type]}</span></div>
              <div><span>Main contact</span><span>{client.contact_name ?? '—'}</span></div>
              <div><span>Email</span><span className="truncate">{client.email ?? '—'}</span></div>
              <div><span>Phone</span><span>{client.phone ?? '—'}</span></div>
              <div><span>Website</span><span className="truncate">{client.website ? <a href={client.website} target="_blank" rel="noreferrer">{client.website.replace(/^https?:\/\//, '')}</a> : '—'}</span></div>
              <div><span>Project manager</span><span>{client.owner_name ?? '—'}</span></div>
              <div><span>Project type</span><span>{client.project_name ?? '—'}</span></div>
              <div><span>Target launch</span><span>{formatDate(client.target_date, true)}</span></div>
              <div><span>Client since</span><span>{formatDate(client.created_at, true)}</span></div>
              <div><span>Onboarding started</span><span>{formatDate(client.onboarding_started_at, true)}</span></div>
              <div><span>On retainer since</span><span>{formatDate(client.retainer_at, true)}</span></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>{CLIENT_TYPES[client.brand_type].label} details</h2><Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button></div>
            <div className="panel-body kv">
              {CLIENT_TYPES[client.brand_type].fields.map(f => (
                <div key={f.key}><span>{f.label}</span><span className="truncate" style={{ maxWidth: '60%' }}>
                  {f.kind === 'url' && client.profile[f.key] ? <a href={client.profile[f.key]} target="_blank" rel="noreferrer">{formatProfileValue(f, client.profile[f.key])}</a> : formatProfileValue(f, client.profile[f.key])}
                </span></div>
              ))}
            </div>
          </section>
          <Tags client={client} />
          <section className="panel">
            <div className="panel-head"><h2>Team</h2><Button size="sm" variant="ghost" onClick={() => go('team')}>Manage</Button></div>
            <div className="panel-body kv">
              {client.team.map(t => (
                <div key={t.team_id}><span className="row" style={{ gap: 8 }}><TeamIcon name={t.icon} size={14} className="muted" />{t.team_name}</span>
                  <span>{t.user_name ? <span className="row" style={{ gap: 6 }}><Avatar name={t.user_name} size="sm" />{t.user_name}</span> : <span className="muted">Unassigned</span>}</span></div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Recent</h2><Button size="sm" variant="ghost" onClick={() => go('history')}>All history</Button></div>
            <div className="panel-body feed">
              {client.activity.length === 0 && <p className="muted">Nothing yet.</p>}
              {client.activity.slice(0, 6).map(a => (
                <div key={a.id} className="feed-item"><div>
                  <b style={{ fontWeight: 600 }}>{a.user_name ?? 'Client'}</b> <span className="soft">{a.message.charAt(0).toLowerCase() + a.message.slice(1)}</span>
                  <div className="when">{timeAgo(a.created_at)}</div>
                </div></div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function nextStep(c: ClientDetail, p: Project | null): { title: string; body: string; view?: Parameters<Go>[0]; cta?: string } {
  if (c.intake_status === 'not_sent') return { title: 'Send the onboarding form', body: 'Copy the private link and share it with the client.', view: 'onboarding', cta: 'Open onboarding' }
  if (c.intake_status === 'sent' || c.intake_status === 'in_progress') return { title: 'Waiting for the client to finish their form', body: 'You can see their answers so far on the Onboarding tab.', view: 'onboarding', cta: 'See answers' }
  if (Number(c.in_review) > 0) return { title: `${c.in_review} task${Number(c.in_review) > 1 ? 's are' : ' is'} waiting for approval`, body: 'Open it and approve it, or send it back with changes.', view: 'project', cta: 'Open project' }
  if (p && p.status === 'on_hold') return { title: 'The project is on hold', body: 'Resume it when the client is ready to continue.', view: 'project', cta: 'Open project' }
  if (p && p.status === 'active') return { title: `Keep ${p.stages.find(s => s.position === p.current_stage)?.name ?? 'the current stage'} moving`, body: 'Assign people to each task and get the first work submitted.', view: 'project', cta: 'Open project' }
  if (c.status !== 'retainer') return { title: 'Finish setup and move to retainer', body: 'Tick every setup item, attaching proof where you can.', view: 'setup', cta: 'Open setup' }
  return { title: 'All on track', body: 'This client is on retainer. Nothing needs you right now.' }
}

/** Lowercase tags used to group and filter clients (e.g. premium, shopify). */
function Tags({ client }: { client: ClientDetail }) {
  const toast = useToast()
  const [tags, setTags] = useState(client.tags)
  const [text, setText] = useState('')
  async function save(next: string[]) {
    try { const c = await api<ClientDetail>(`/clients/${client.id}`, { method: 'PATCH', body: { tags: next } }); setTags(c.tags) } catch (e) { toast.error(e) }
  }
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Tags</h2><p>Lowercase words to group clients, like premium or shopify.</p></div></div>
      <div className="panel-body stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {tags.length === 0 && <span className="muted" style={{ fontSize: 13.5 }}>No tags yet</span>}
          {tags.map(t => (
            <span key={t} className="chip-link" style={{ cursor: 'default' }}>{t}
              <button onClick={() => void save(tags.filter(x => x !== t))} aria-label={`Remove ${t}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <form className="row" onSubmit={e => { e.preventDefault(); const t = text.trim().toLowerCase(); if (t) { void save([...tags, t]); setText('') } }}>
          <input className="input sm grow" placeholder="Add a tag" value={text} onChange={e => setText(e.target.value)} aria-label="New tag" />
          <Button size="sm" type="submit" disabled={!text.trim()}>Add</Button>
        </form>
      </div>
    </section>
  )
}
