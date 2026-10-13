import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, ChevronRight, Hand, Mail, MessageCircle, MessageSquareText, Plus, RefreshCw, Search, Zap } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { formatDateTime, timeAgo } from '../lib/format'
import { fillText, RUN_STATUS, StepIcon } from '../lib/workflow'
import type { OutboxEmail, StepType, Workflow, WorkflowMeta, WorkflowRow, WorkflowRun } from '../lib/types'
import { Button, Empty, Field, Loading, Modal, PageHead, Pill } from '../components/ui'
import { RunDrawer } from '../components/RunDrawer'
import { useToast } from '../components/toast'

type View = 'workflows' | 'runs' | 'messages'

/** Workflows: move work between departments automatically, with approvals, messages and API calls on the way. */
export function Workflows() {
  const { user, isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'workflows'
  const [creating, setCreating] = useState(false)
  const canManage = isAdmin || user?.role === 'project_manager'

  return (
    <div className="page">
      <PageHead title="Workflows" sub="Move work from one department to the next automatically, with approvals, messages and API calls along the way."
        actions={canManage ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New workflow</Button> : undefined} />

      <div className="dept-tabs" role="tablist" aria-label="Workflows">
        <button role="tab" aria-selected={view === 'workflows'} className={view === 'workflows' ? 'on' : ''} onClick={() => setParams({}, { replace: true })}><Zap size={16} />Workflows</button>
        <button role="tab" aria-selected={view === 'runs'} className={view === 'runs' ? 'on' : ''} onClick={() => setParams({ view: 'runs' }, { replace: true })}><RefreshCw size={16} />Runs</button>
        {canManage && <button role="tab" aria-selected={view === 'messages'} className={view === 'messages' ? 'on' : ''} onClick={() => setParams({ view: 'messages' }, { replace: true })}><Mail size={16} />Messages</button>}
      </div>

      {view === 'workflows' && <WorkflowList canManage={canManage} />}
      {view === 'runs' && <RunList />}
      {view === 'messages' && canManage && <Messages />}
      {creating && <NewWorkflow onClose={() => setCreating(false)} />}
    </div>
  )
}

function breakdown(types: StepType[]): string {
  const n = (t: StepType[]) => types.filter(x => t.includes(x)).length
  const parts = [
    [n(['task']), 'task'], [n(['approval']), 'approval'], [n(['notify', 'email', 'sms', 'whatsapp']), 'message'], [n(['condition']), 'branch'],
  ].filter(([c]) => c) as [number, string][]
  return parts.map(([c, w]) => `${c} ${w}${c === 1 ? '' : 's'}`).join(' · ') || 'Empty'
}

function WorkflowList({ canManage }: { canManage: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: list, setData } = useApi<WorkflowRow[]>('/workflows')
  const { data: meta } = useApi<WorkflowMeta>('/workflow-meta')
  const [filter, setFilter] = useState<'all' | 'live' | 'off'>('all')
  const [q, setQ] = useState('')

  const shown = useMemo(() => (list ?? []).filter(w =>
    (filter === 'all' || (filter === 'live') === w.is_live) && (!q || `${w.name} ${w.description ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list, filter, q])

  if (!list) return <Loading />
  const live = list.filter(w => w.is_live).length
  const running = list.reduce((a, w) => a + Number(w.active_runs), 0)
  const total = list.reduce((a, w) => a + Number(w.total_runs), 0)

  async function toggle(w: WorkflowRow) {
    try {
      await api<Workflow>(`/workflows/${w.id}`, { method: 'PATCH', body: { is_live: !w.is_live } })
      setData(list!.map(x => (x.id === w.id ? { ...x, is_live: !w.is_live } : x)))
      toast.success(w.is_live ? `${w.name} is off` : `${w.name} is live`)
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="wfl-stats">
        <div className="wfl-stat"><span className="label">Live workflows</span><b>{live}<small> of {list.length}</small></b></div>
        <button className="wfl-stat" onClick={() => navigate('/workflows?view=runs')}><span className="label">Running now</span><b>{running}</b></button>
        <div className="wfl-stat"><span className="label">Runs so far</span><b>{total}</b></div>
        <Link className={`wfl-stat brevo ${meta?.brevo ? 'on' : ''}`} to="/settings/integrations">
          <span className="label">Brevo</span>
          <b className="wfl-brevo">{meta ? (meta.brevo ? 'Connected' : 'Not connected') : '…'}</b>
          <small>{meta?.brevo ? 'Emails, SMS and WhatsApp go out' : 'Connect to send emails, SMS, WhatsApp'}</small>
        </Link>
      </div>

      <section className="panel">
        <div className="wfl-tools">
          <div className="search grow" style={{ maxWidth: 340 }}><Search size={15} /><input className="input sm" placeholder="Search workflows" value={q} onChange={e => setQ(e.target.value)} aria-label="Search workflows" /></div>
          <div className="seg" role="tablist" aria-label="Filter">
            {([['all', 'All'], ['live', 'Live'], ['off', 'Off']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!shown.length ? <Empty title={list.length ? 'No matches' : 'No workflows yet'}>{list.length ? 'Try another search.' : 'Create one to move work between departments automatically.'}</Empty> : (
          <div className="wfl-table" role="table">
            <div className="wfl-row wfl-th" role="row"><span>Workflow</span><span>Starts</span><span>Flow</span><span>Runs</span><span>Live</span><span /></div>
            {shown.map(w => {
              const types = (w.step_types ?? '').split(',').filter(Boolean) as StepType[]
              return (
                <div key={w.id} className="wfl-row" role="row" tabIndex={0} onClick={() => navigate(`/workflows/${w.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/workflows/${w.id}`) }}>
                  <span className="wfl-name">
                    <span className={`wfl-dot ${w.is_live ? 'on' : ''}`} aria-hidden="true" />
                    <span className="grow" style={{ minWidth: 0 }}><b>{w.name}</b>{w.description && <small>{w.description}</small>}</span>
                  </span>
                  <span className="wfl-start">{w.triggers.length ? <CalendarClock size={14} /> : <Hand size={14} />}<span>{w.triggers.length ? w.triggers[0] + (w.triggers.length > 1 ? ` +${w.triggers.length - 1}` : '') : 'By hand'}</span></span>
                  <span className="wfl-flow">
                    <span className="wfl-icons">{[...new Set(types)].slice(0, 6).map(t => <span key={t} className={`fc-ico t-${t}`}><StepIcon type={t} size={12} /></span>)}</span>
                    <small>{breakdown(types)}</small>
                  </span>
                  <span className="wfl-runs">{Number(w.active_runs) > 0 ? <b>{w.active_runs} running</b> : <span className="muted">{w.last_run_at ? `Last ${timeAgo(w.last_run_at)}` : 'Never run'}</span>}<small className="muted">{w.total_runs} total</small></span>
                  <span className="wfl-live" onClick={e => e.stopPropagation()}>
                    <button type="button" role="switch" aria-checked={w.is_live} aria-label={`${w.name} live`} className={`sw ${w.is_live ? 'on' : ''}`} disabled={!canManage} onClick={() => void toggle(w)} />
                  </span>
                  <ChevronRight size={16} className="wfl-chev" />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/** Runs across all workflows (or one). */
export function RunList({ workflowId }: { workflowId?: number }) {
  const [status, setStatus] = useState<'active' | 'finished' | ''>('active')
  const qs = new URLSearchParams()
  if (workflowId) qs.set('workflow_id', String(workflowId))
  if (status) qs.set('status', status)
  const { data: runs, reload } = useApi<WorkflowRun[]>(`/workflow-runs?${qs}`)
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Runs</h2><p>Each run is one workflow for one client.</p></div>
        <div className="seg" role="tablist" aria-label="Status">
          {([['active', 'In progress'], ['finished', 'Finished'], ['', 'All']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      {!runs ? <Loading /> : !runs.length ? <Empty title={status === 'active' ? 'Nothing running' : 'No runs yet'}>Runs appear when a trigger fires or someone runs a workflow by hand.</Empty> : (
        <div className="rows">
          {runs.map(r => {
            const active = r.status === 'running' || r.status === 'waiting'
            const pct = r.step_count ? Math.min(100, ((active ? r.done_count : r.step_count) / r.step_count) * 100) : 0
            return (
              <button key={r.id} className="row-item run-row" onClick={() => setOpen(r.id)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t">{r.client_name}</div>
                  <div className="s">{workflowId ? '' : `${r.workflow_name} · `}{r.period ? `${r.period} · ` : ''}started {timeAgo(r.started_at)}</div>
                </div>
                <div className="run-now">
                  {active && r.current_type ? <><StepIcon type={r.current_type} size={14} /><span className="truncate">{fillText(r.current_title, r)}</span></> : <span className="muted">{r.finished_at ? `Ended ${timeAgo(r.finished_at)}` : ''}</span>}
                  <div className="run-bar sm"><i style={{ width: `${pct}%` }} /></div>
                  <small className="muted">{r.done_count} of {r.step_count} cards done</small>
                </div>
                <Pill map={RUN_STATUS} value={r.status} />
              </button>
            )
          })}
        </div>
      )}
      {open && <RunDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
    </section>
  )
}

const KIND_LABEL: Record<string, string> = {
  workflow: 'Workflow', notification: 'Alert', form_link: 'Form link', documents_link: 'Documents link', test: 'Test', app: 'App',
}

function Messages() {
  const { data: msgs } = useApi<OutboxEmail[]>('/email-outbox')
  const { data: meta } = useApi<WorkflowMeta>('/workflow-meta')
  const [open, setOpen] = useState<number | null>(null)
  const [channel, setChannel] = useState<'' | 'email' | 'sms' | 'whatsapp'>('')
  const tone = { sent: { label: 'Sent', tone: 'ok' }, not_sent: { label: 'Not sent', tone: '' }, failed: { label: 'Failed', tone: 'change' } } as const
  const icon = (c: string) => c === 'sms' ? <MessageSquareText size={16} /> : c === 'whatsapp' ? <MessageCircle size={16} /> : <Mail size={16} />
  const shown = (msgs ?? []).filter(m => !channel || m.channel === channel)

  return (
    <div className="stack" style={{ gap: 14 }}>
      {meta && !meta.brevo && (
        <div className="note">Brevo isn't connected, so messages are saved here but not sent. <Link to="/settings/integrations">Connect Brevo</Link></div>
      )}
      <section className="panel">
        <div className="panel-head">
          <div><h2>Messages</h2><p>Every email, SMS and WhatsApp message the app sends.</p></div>
          <div className="seg" role="tablist" aria-label="Channel">
            {([['', 'All'], ['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={channel === k} className={channel === k ? 'on' : ''} onClick={() => setChannel(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!msgs ? <Loading /> : !shown.length ? <Empty title="Nothing sent yet">Messages from workflows, form links and approval alerts show up here.</Empty> : (
          <div className="rows">
            {shown.map(e => (
              <div key={e.id} className="outbox-item">
                <button className="row-item" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <span className={`msg-ico ${e.channel}`}>{icon(e.channel)}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="t truncate">{e.subject || e.body.slice(0, 80)}</div>
                    <div className="s truncate">To {e.to_email}{e.client_name ? ` · ${e.client_name}` : ''} · {KIND_LABEL[e.kind] ?? e.kind}{e.workflow_name ? ` · ${e.workflow_name}` : ''}</div>
                  </div>
                  <span className="muted only-desktop" style={{ fontSize: 12.5 }} title={formatDateTime(e.created_at)}>{timeAgo(e.created_at)}</span>
                  <Pill map={tone} value={e.status} />
                </button>
                {open === e.id && <pre className="outbox-body">{e.body}{e.error ? `\n\n${e.status === 'not_sent' ? 'Not sent' : 'Error'}: ${e.error}` : ''}{e.provider ? `\n\nVia ${e.provider === 'brevo' ? 'Brevo' : 'PHP mail'}` : ''}</pre>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function NewWorkflow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="New workflow" sub="Name it now; you'll build the flow on the canvas next." onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={async () => {
        setBusy(true)
        try { const w = await api<Workflow>('/workflows', { body: { name, description } }); navigate(`/workflows/${w.id}`) } catch (e) { toast.error(e); setBusy(false) }
      }}>Create and open the canvas</Button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Name" required>{id => <input id={id} className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly content cycle" />}</Field>
        <Field label="What it's for">{id => <input id={id} className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="One line the team will understand" />}</Field>
      </div>
    </Modal>
  )
}
