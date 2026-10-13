import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Octagon } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { DELIVERABLE_STATUS, formatDate, formatDateTime, timeAgo } from '../lib/format'
import { fillText, RUN_STATUS } from '../lib/workflow'
import type { WorkflowRunDetail } from '../lib/types'
import { Button, Confirm, Drawer, Loading, Pill, TeamTag } from './ui'
import { DeliverablePanel } from './DeliverablePanel'
import { RunCanvas } from './FlowCanvas'
import { useToast } from './toast'

/** One run: the flow with where it is now, the tasks it created, and everything that happened. */
export function RunDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const { data: run, setData, reload } = useApi<WorkflowRunDetail>(`/workflow-runs/${id}`)
  const [stopping, setStopping] = useState(false)
  const [task, setTask] = useState<number | null>(null)
  const [view, setView] = useState<'flow' | 'log'>('flow')
  const canManage = isAdmin || user?.role === 'project_manager'

  if (!run) return <Drawer onClose={onClose} head={<span className="label">Loading…</span>}><Loading /></Drawer>
  const active = run.status === 'running' || run.status === 'waiting'
  const now = run.steps.filter(s => s.state === 'active')
  const done = run.steps.filter(s => s.state === 'done' || s.state === 'skipped').length

  return (
    <Drawer onClose={onClose} head={
      <div className="stack" style={{ gap: 8 }}>
        <span className="label">{run.workflow_name}{run.period ? ` · ${run.period}` : ''}</span>
        <h2 style={{ fontSize: 22, fontWeight: 600 }}><Link to={`/clients/${run.brand_id}`} onClick={onClose}>{run.client_name}</Link></h2>
        <div className="row wrap" style={{ gap: 10 }}>
          <Pill map={RUN_STATUS} value={run.status} />
          <span className="muted" style={{ fontSize: 13 }}>Started {formatDateTime(run.started_at)}{run.started_by_name ? ` by ${run.started_by_name}` : ' automatically'}</span>
        </div>
        <div className="run-bar"><i style={{ width: `${run.steps.length ? (done / run.steps.length) * 100 : 0}%` }} /></div>
        <span className="muted" style={{ fontSize: 12.5 }}>{done} of {run.steps.length} cards done{now.length ? ` · now: ${now.map(s => fillText(s.title, run)).join(', ')}` : ''}</span>
      </div>
    }>
      {active && now.length > 0 && (
        <div className="note"><Clock size={14} /> {now.length > 1 ? `${now.length} cards are running at the same time.` : now[0].waiting_for === 'time' ? `Waiting until ${formatDateTime(now[0].wait_until)}, then it carries on by itself.` : 'Waiting for the task below to be finished.'}</div>
      )}

      <div className="seg" role="tablist" aria-label="View" style={{ alignSelf: 'start' }}>
        <button role="tab" aria-selected={view === 'flow'} className={view === 'flow' ? 'on' : ''} onClick={() => setView('flow')}>Flow</button>
        <button role="tab" aria-selected={view === 'log'} className={view === 'log' ? 'on' : ''} onClick={() => setView('log')}>What happened <span className="muted">{run.log.length}</span></button>
      </div>

      {view === 'flow' ? (
        <>
          <RunCanvas run={run} />
          <div className="run-legend"><span className="lg done">Done</span><span className="lg active">Now</span><span className="lg skipped">Skipped</span><span className="lg failed">Failed</span><span className="lg next">Not reached</span></div>
        </>
      ) : (
        <ul className="run-log">
          {run.log.map(l => (
            <li key={l.id} className={l.status}>
              <span className="rl-when">{timeAgo(l.created_at)}</span>
              <span className="rl-msg">{l.step_title ? <b>{fillText(l.step_title, run)}. </b> : null}{l.message}</span>
            </li>
          ))}
        </ul>
      )}

      {run.tasks.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 10 }}>Tasks it created</div>
          <div className="stack" style={{ gap: 8 }}>
            {run.tasks.map(t => (
              <button key={t.id} className="run-task" onClick={() => setTask(t.id)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b>{t.title}</b>
                  <small>{t.assignee_name ?? 'Not assigned'}{t.due_date ? ` · due ${formatDate(t.due_date)}` : ''}</small>
                </span>
                <TeamTag name={t.team_name} icon={t.team_icon} />
                <Pill map={DELIVERABLE_STATUS} value={t.status} />
              </button>
            ))}
          </div>
        </div>
      )}

      {active && canManage && (
        <div><Button variant="ghost" className="danger-text" icon={<Octagon size={14} />} onClick={() => setStopping(true)}>Stop this run</Button></div>
      )}

      {stopping && <Confirm title="Stop this run?" message="Its open tasks are put on hold and no more cards run. This can't be undone." action="Stop run"
        onClose={() => setStopping(false)}
        onConfirm={async () => { try { setData(await api<WorkflowRunDetail>(`/workflow-runs/${id}/stop`, { body: {} })); toast.success('Run stopped'); onChanged?.() } catch (e) { toast.error(e); throw e } }} />}
      {task && <DeliverablePanel id={task} onClose={() => setTask(null)} onChanged={() => { void reload(); onChanged?.() }} />}
    </Drawer>
  )
}
