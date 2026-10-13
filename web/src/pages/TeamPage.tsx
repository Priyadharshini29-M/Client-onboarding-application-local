import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LayoutGrid, Mail } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { BRAND_TYPE, ROLE_LABEL, formatDate } from '../lib/format'
import { TeamIcon } from '../lib/teamIcons'
import type { Deliverable, Role, Team } from '../lib/types'
import { Avatar, Button, Empty, Loading, PageHead } from '../components/ui'
import { Work } from './Work'

interface Person {
  id: number; name: string; email: string; role: Role
  open_tasks: number; in_progress: number; waiting: number; needs_changes: number; overdue: number; done_30: number
  clients: { id: number; name: string }[]
}
interface ClientNow {
  id: number; name: string; brand_type: string; stage_name: string; due_date: string | null
  tasks: number; done: number; waiting: number; unassigned: number; lead_name: string | null
}
interface Overview {
  team: { id: number; name: string; icon: string }
  people: Person[]
  clients: ClientNow[]
  totals: { open_tasks: number; unassigned: number; waiting: number; overdue: number }
}

/** Teams: one module for departments and their work.
 *  Tabs pick "All" or a department; inside a department, switch between its tasks and its people. */
export function TeamPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data: teams, error, reload } = useApi<Team[]>('/teams')
  const { data: work } = useApi<Deliverable[]>('/work')
  const team = id && teams ? teams.find(t => String(t.id) === id) ?? null : null
  const view = team && params.get('view') === 'people' ? 'people' : 'tasks'
  useEffect(() => {
    document.querySelector('.dept-tabs .on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [team?.id, teams])
  const taskCount = (teamId?: number) => (work ?? []).filter(w => teamId === undefined || w.team_id === teamId).length

  if (error && !teams) return <div className="page"><PageHead title="Teams" /><Empty title="Couldn't load the departments" action={<Button size="sm" onClick={reload}>Try again</Button>}>{error.message}</Empty></div>
  if (!teams) return <div className="page"><PageHead title="Teams" /><Loading /></div>

  return (
    <div className="page">
      <PageHead title="Teams" sub="Every department's tasks and people in one place." />

      <div className="dept-tabs" role="tablist" aria-label="Departments">
        <button role="tab" aria-selected={!team} className={!team ? 'on' : ''} onClick={() => navigate('/teams', { replace: true })}>
          <LayoutGrid size={16} />All{work && <span className="count">{taskCount()}</span>}
        </button>
        {teams.map(t => (
          <button key={t.id} role="tab" aria-selected={t.id === team?.id} className={t.id === team?.id ? 'on' : ''}
            onClick={() => navigate(`/teams/${t.id}${view === 'people' ? '?view=people' : ''}`, { replace: true })}>
            <TeamIcon name={t.icon} size={16} />{t.name}{work && <span className="count">{taskCount(t.id)}</span>}
          </button>
        ))}
      </div>

      {team && (
        <div className="dept-head">
          <span className="dept-ico"><TeamIcon name={team.icon} size={22} /></span>
          <div className="grow">
            <h2>{team.name}</h2>
            <p className="muted">{team.member_count} {Number(team.member_count) === 1 ? 'person' : 'people'} · {taskCount(team.id)} open {taskCount(team.id) === 1 ? 'task' : 'tasks'}</p>
          </div>
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'tasks'} className={view === 'tasks' ? 'on' : ''} onClick={() => setParams({}, { replace: true })}>Tasks</button>
            <button role="tab" aria-selected={view === 'people'} className={view === 'people' ? 'on' : ''} onClick={() => setParams({ view: 'people' }, { replace: true })}>People</button>
          </div>
        </div>
      )}

      {view === 'people' && team ? <People team={team} /> : <Work key={team?.id ?? 'all'} teamId={team ? String(team.id) : ''} />}
    </div>
  )
}

/** A department's people: how busy each one is, the clients they lead, and the clients at this department's stage. */
function People({ team }: { team: Team }) {
  const { user } = useAuth()
  const { data: ov } = useApi<Overview>(`/teams/${team.id}/overview`)
  const ready = ov && ov.team.id === team.id
  const busiest = ready ? Math.max(1, ...ov.people.map(p => Number(p.open_tasks))) : 1
  if (!ready) return <Loading />

  return (
    <>
        <div className="ov-grid tight">
          <div className="ov-card"><span className="label">Clients right now</span><b>{ov.clients.length}</b></div>
          <div className="ov-card"><span className="label">Open tasks</span><b>{ov.totals.open_tasks}</b></div>
          <div className="ov-card"><span className="label">Not assigned</span><b style={{ color: Number(ov.totals.unassigned) ? 'var(--review)' : undefined }}>{ov.totals.unassigned}</b></div>
          <div className="ov-card"><span className="label">Overdue</span><b style={{ color: Number(ov.totals.overdue) ? 'var(--change)' : undefined }}>{ov.totals.overdue}</b></div>
        </div>

        <div className="section-title team-sec"><h2>People</h2></div>
        {!ov.people.length ? <section className="panel"><Empty title="Nobody in this department yet">Add people in Settings → People.</Empty></section> : (
          <div className="people-grid">
            {ov.people.map(p => (
              <div key={p.id} className="person-card">
                <div className="row" style={{ gap: 12 }}>
                  <Avatar name={p.name} />
                  <div className="grow person-name">
                    <b>{p.name}{p.id === user?.id && <span className="muted"> (you)</span>}</b>
                    <span className="muted">{ROLE_LABEL[p.role]}</span>
                  </div>
                  <a className="icon-btn" href={`mailto:${p.email}`} title={`Email ${p.name}`} aria-label={`Email ${p.name}`}><Mail size={15} /></a>
                </div>

                <div className="load">
                  <div className="between"><span className="label">Workload</span><span className="muted">{p.open_tasks} open {Number(p.open_tasks) === 1 ? 'task' : 'tasks'}</span></div>
                  <div className="load-bar"><i style={{ width: `${(Number(p.open_tasks) / busiest) * 100}%` }} /></div>
                </div>

                <div className="person-stats">
                  <span><b>{p.in_progress}</b>In progress</span>
                  <span><b>{p.waiting}</b>Waiting for approval</span>
                  <span className={Number(p.needs_changes) ? 'warn' : ''}><b>{p.needs_changes}</b>Needs changes</span>
                  <span className={Number(p.overdue) ? 'bad' : ''}><b>{p.overdue}</b>Overdue</span>
                </div>

                <div className="person-clients">
                  <span className="label">Lead for</span>
                  {p.clients.length ? p.clients.map(c => <Link key={c.id} className="chip" to={`/clients/${c.id}`}>{c.name}</Link>)
                    : <span className="muted">No clients yet</span>}
                </div>
                <div className="muted person-foot">{p.done_30} approved in the last 30 days</div>
              </div>
            ))}
          </div>
        )}

        <div className="section-title team-sec"><h2>Clients at a {team.name} stage</h2></div>
        <section className="panel">
          {!ov.clients.length ? <Empty title="No clients here right now">Clients show up when their project reaches a {team.name} stage.</Empty> : (
            <div className="rows">
              {ov.clients.map(c => (
                <Link key={c.id} to={`/clients/${c.id}`} className="row-item team-client">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t">{c.name}</div>
                    <div className="s">{BRAND_TYPE[c.brand_type] ?? ''} · {c.stage_name}{c.due_date ? ` · due ${formatDate(c.due_date)}` : ''}</div>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>Lead: {c.lead_name ?? 'not set'}</span>
                  <span className="tag">{c.done}/{c.tasks} done</span>
                  {Number(c.waiting) > 0 && <span className="pill review">{c.waiting} waiting for approval</span>}
                  {Number(c.unassigned) > 0 && <span className="pill">{c.unassigned} not assigned</span>}
                </Link>
              ))}
            </div>
          )}
        </section>
    </>
  )
}
