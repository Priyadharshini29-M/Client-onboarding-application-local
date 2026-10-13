import { useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/hooks'
import { formatDate, ROLE_LABEL } from '../lib/format'
import type { ClientTeamRow, User } from '../lib/types'
import { Avatar, Loading } from './ui'
import { TeamIcon } from '../lib/teamIcons'
import { useToast } from './toast'
import { HandoffChain } from './HandoffChain'

/** One lead per team for this client: who the account manager, creative lead, tech lead... are. */
export function ClientTeam({ clientId, initial, onChanged }: { clientId: number; initial: ClientTeamRow[]; onChanged: () => void }) {
  const toast = useToast()
  const { isAdmin, user } = useAuth()
  const { data: people } = useApi<User[]>('/users')
  const [rows, setRows] = useState(initial)
  const [tick, setTick] = useState(0)
  const canAssign = isAdmin || user?.role === 'project_manager'

  if (!people) return <Loading />

  async function assign(teamId: number, userId: string) {
    try {
      setRows(await api<ClientTeamRow[]>(`/clients/${clientId}/team/${teamId}`, { method: 'PUT', body: { user_id: userId ? Number(userId) : null } }))
      toast.success(userId ? 'Lead assigned. Open tasks in their stage are now theirs.' : 'Lead removed')
      setTick(t => t + 1)
      onChanged()
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
    <HandoffChain clientId={clientId} refreshKey={tick} />
    <div>
      <div className="section-title team-sec" style={{ marginTop: 4 }}><h2>Who looks after this client</h2></div>
    <div className="team-grid">
      {rows.map(r => {
        const teamPeople = people.filter(p => p.team_id === r.team_id)
        const others = people.filter(p => p.team_id !== r.team_id)
        return (
          <section key={r.team_id} className="panel" style={{ padding: 18, display: 'grid', gap: 14 }}>
            <div className="between">
              <span className="tag" style={{ fontSize: 13.5 }}><span className="dept-ico xs"><TeamIcon name={r.icon} size={14} /></span>{r.team_name}</span>
              {r.assigned_at && <span className="muted" style={{ fontSize: 12 }}>since {formatDate(r.assigned_at)}</span>}
            </div>
            {r.user_name ? (
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={r.user_name} />
                <div><b style={{ fontWeight: 600 }}>{r.user_name}</b><div className="muted" style={{ fontSize: 12.5 }}>{ROLE_LABEL[people.find(p => p.id === r.user_id)?.role ?? 'member']}</div></div>
              </div>
            ) : <p className="muted">Nobody assigned yet</p>}
            {canAssign && (
              <select className="select sm" value={r.user_id ?? ''} aria-label={`${r.team_name} lead`} onChange={e => void assign(r.team_id, e.target.value)}>
                <option value="">No lead</option>
                {teamPeople.length > 0 && <optgroup label={r.team_name}>{teamPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
                <optgroup label="Everyone else">{others.map(p => <option key={p.id} value={p.id}>{p.name}{p.team_name ? ` · ${p.team_name}` : ''}</option>)}</optgroup>
              </select>
            )}
          </section>
        )
      })}
    </div>
    </div>
    </div>
  )
}
