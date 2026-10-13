import { useEffect } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { formatDate } from '../lib/format'
import { approverLabel } from '../lib/workflow'
import { TeamIcon } from '../lib/teamIcons'
import { Loading } from './ui'
import { useToast } from './toast'

type Step = {
  id: number; position: number; name: string; status: 'locked' | 'open' | 'done'; team_name: string | null; team_icon: string | null
  approver_role: string; tasks: number; approved: number; people: string | null; lead_name: string | null
  next_person: string | null; next_why?: string; done_at: string | null
}

/** The client's project as a relay between departments, with the automatic handoff switch. */
export function HandoffChain({ clientId, refreshKey }: { clientId: number; refreshKey: number }) {
  const toast = useToast()
  const { isAdmin, user } = useAuth()
  const canEdit = isAdmin || user?.role === 'project_manager'
  const { data, setData, reload } = useApi<{ auto_handoff: boolean; chain: Step[] }>(`/clients/${clientId}/handoff`)
  useEffect(() => { void reload() }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <section className="panel"><Loading /></section>
  const steps = data.chain.filter(s => s.tasks > 0)

  async function toggle() {
    try {
      setData(await api(`/clients/${clientId}/handoff`, { method: 'PUT', body: { auto_handoff: !data!.auto_handoff } }))
      toast.success(data!.auto_handoff ? 'Automatic handoff is off' : 'Automatic handoff is on')
    } catch (e) { toast.error(e) }
  }

  return (
    <section className="panel ho-panel">
      <div className="panel-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2>Handoff</h2>
          <p>When a stage is approved, the next stage's tasks go to the client's lead in that department and they're notified. No lead? It goes to the least busy person there.</p>
        </div>
        <label className="live-switch">
          <button type="button" role="switch" aria-checked={data.auto_handoff} disabled={!canEdit} className={`sw ${data.auto_handoff ? 'on' : ''}`} onClick={() => void toggle()} />
          <span><b>{data.auto_handoff ? 'Automatic' : 'Off'}</b><small>{data.auto_handoff ? 'Next person is told' : 'Assign by hand'}</small></span>
        </label>
      </div>

      {!steps.length ? <p className="muted" style={{ padding: '0 20px 20px' }}>This client has no project yet.</p> : (
        <ol className="ho-chain">
          {steps.map((s, i) => {
            const who = s.status === 'locked' ? s.next_person : s.people
            return (
              <li key={s.id} className={`ho-step ${s.status}`}>
                <span className="ho-dot">{s.status === 'done' ? <Check size={13} /> : s.position}</span>
                <div className="ho-body">
                  <div className="ho-top">
                    <span className="tag"><TeamIcon name={s.team_icon} size={13} />{s.team_name ?? 'No department'}</span>
                    <span className={`ho-state ${s.status}`}>{s.status === 'done' ? `Approved${s.done_at ? ` ${formatDate(s.done_at)}` : ''}` : s.status === 'open' ? 'Working on it now' : i > 0 && steps[i - 1].status === 'open' ? 'Next' : 'Later'}</span>
                  </div>
                  <b className="ho-name">{s.name}</b>
                  <span className="ho-who">
                    {who ? <>{s.status === 'locked' ? 'Will go to ' : ''}<b>{who}</b>{s.status === 'locked' && s.next_why?.includes('least busy') ? ' (least busy, no lead set)' : ''}</> : <span className="late">Nobody in this department</span>}
                    <span className="muted"> · {s.approved}/{s.tasks} tasks approved · approver: {approverLabel(s.approver_role)}</span>
                  </span>
                </div>
                {i < steps.length - 1 && <ArrowRight size={14} className="ho-arrow" aria-hidden="true" />}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
