import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ClipboardList, Plug, Plus, Trash2, UserCog, UsersRound, Workflow } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/hooks'
import { formatDate, pad2, ROLE_LABEL } from '../lib/format'
import type { Blueprint, Role, Team, User } from '../lib/types'
import { Avatar, Button, Empty, Field, IconButton, Loading, Modal, PageHead, TeamTag } from '../components/ui'
import { useToast } from '../components/toast'
import { StartProject } from '../components/StartProject'
import { RemovePerson } from '../components/RemovePerson'
import { InviteLinkModal, SendLinkButton, type InviteResult } from '../components/InviteLink'
import { InvitePeople } from '../components/InvitePeople'

export function SettingsNav() {
  return (
    <nav className="dept-tabs" aria-label="Settings">
      <NavLink to="/settings/forms"><ClipboardList size={16} />Intake forms</NavLink>
      <NavLink to="/settings/project-types"><Workflow size={16} />Project types</NavLink>
      <NavLink to="/settings/people"><UserCog size={16} />People</NavLink>
      <NavLink to="/settings/teams"><UsersRound size={16} />Departments</NavLink>
      <NavLink to="/settings/integrations"><Plug size={16} />Integrations</NavLink>
    </nav>
  )
}

// Project types -------------------------------------------------------------------------------------------

export function ProjectTypes() {
  const { data } = useApi<Blueprint[]>('/blueprints')
  const [startFor, setStartFor] = useState<number | null>(null)
  return (
    <div className="page">
      <PageHead title="Settings" />
      <SettingsNav />
      <p className="soft" style={{ maxWidth: '64ch', marginBottom: 20 }}>Each project type is a set of stages. A stage opens when the one before it is finished, and it's finished when every task in it is approved by the person shown.</p>
      {!data ? <Loading /> : (
        <div className="stack" style={{ gap: 20 }}>
          {data.map(b => (
            <section key={b.id} className="panel">
              <div className="panel-head"><div><h2>{b.name}</h2><p>{b.description} · about {b.stages.reduce((a, s) => a + Number(s.duration_days), 0)} days</p></div>
                <Button size="sm" onClick={() => setStartFor(b.id)}>Start for clients</Button></div>
              <div>
                {b.stages.map(s => (
                  <div key={s.id} className="bp-stage">
                    <span className="num">{pad2(s.position)}</span>
                    <div><b>{s.name}</b><div className="muted" style={{ fontSize: 13.5 }}>{s.summary}</div></div>
                    <div className="row wrap" style={{ gap: 14, justifyContent: 'flex-end' }}>
                      <TeamTag name={s.team_name} icon={s.team_icon} />
                      <span className="tag">{s.deliverable_count} tasks</span>
                      <span className="tag">Approver: {ROLE_LABEL[s.approver_role]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {startFor && <StartProject blueprintId={startFor} onClose={() => setStartFor(null)} onDone={() => {}} />}
    </div>
  )
}

// People ---------------------------------------------------------------------------------------------------

type PersonStatus = 'accepted' | 'pending' | 'expired' | 'off'
const STATUS: Record<PersonStatus, { label: string; tone: string }> = {
  accepted: { label: 'Accepted', tone: 'ok' },
  pending: { label: 'Pending', tone: 'review' },
  expired: { label: 'Expired', tone: 'change' },
  off: { label: 'No access', tone: '' },
}
const toDate = (v?: string | null) => (v ? new Date(v.replace(' ', 'T')) : null)
/** Where someone is with their invite: accepted (joined), pending (link still valid), expired, or no access. */
function personStatus(u: User): { key: PersonStatus; detail: string } {
  if (!u.is_active) return { key: 'off', detail: 'Access turned off' }
  if (u.joined_at) return { key: 'accepted', detail: `Joined ${formatDate(u.joined_at)}` }
  const exp = toDate(u.invite_expires_at)
  if (exp && exp > new Date()) return { key: 'pending', detail: `${u.invited_at ? `Invited ${formatDate(u.invited_at)} · ` : ''}expires ${formatDate(u.invite_expires_at)}` }
  return { key: 'expired', detail: u.invite_expires_at ? `Link expired ${formatDate(u.invite_expires_at)}` : 'No valid link' }
}

export function People() {
  const { data: users, reload } = useApi<User[]>('/users?all=1')
  const { data: teams } = useApi<Team[]>('/teams')
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const [link, setLink] = useState<{ name: string; result: InviteResult } | null>(null)
  const [inviting, setInviting] = useState(false)
  const { user: me } = useAuth()
  const canRemove = (u: User) => u.id !== me?.id && (u.role !== 'super_admin' || me?.role === 'super_admin')
  const [filter, setFilter] = useState<'all' | PersonStatus>('all')
  const counts = (users ?? []).reduce<Record<string, number>>((c, u) => { const k = personStatus(u).key; c[k] = (c[k] ?? 0) + 1; return c }, {})
  const shown = (users ?? []).filter(u => filter === 'all' || personStatus(u).key === filter)
  return (
    <div className="page">
      <PageHead title="Settings" actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setInviting(true)}>Invite people</Button>} />
      <SettingsNav />
      <section className="panel">
        {users && users.length > 0 && (
          <div className="people-tools">
            <div className="seg" role="tablist" aria-label="Status">
              {(['all', 'accepted', 'pending', 'expired', 'off'] as const).filter(k => k === 'all' || counts[k]).map(k => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {k === 'all' ? 'All' : STATUS[k].label} <span className="muted">{k === 'all' ? users.length : counts[k]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!users ? <Loading /> : !users.length ? <Empty title="No one yet" /> : !shown.length ? <Empty title="No one here" /> : (
          <div className="rows">
            {shown.map(u => { const st = personStatus(u); return (
              <div key={u.id} className="row-item" role="button" tabIndex={0} onClick={() => setEdit(u)} onKeyDown={e => { if (e.key === 'Enter') setEdit(u) }} style={{ opacity: st.key === 'off' ? .5 : 1 }}>
                <Avatar name={u.name} />
                <div className="grow" style={{ minWidth: 0 }}><div className="t">{u.name}<span className={`pill ${STATUS[st.key].tone}`} style={{ marginLeft: 8 }}>{STATUS[st.key].label}</span></div><div className="s">{u.email}<span className="only-mobile"> · {st.detail}</span></div></div>
                <TeamTag name={u.team_name} icon={teams?.find(t => t.id === u.team_id)?.icon ?? null} />
                <span className="soft only-desktop" style={{ width: 150, fontSize: 14 }}>{ROLE_LABEL[u.role]}</span>
                <span className="muted only-desktop" style={{ width: 190, fontSize: 13, textAlign: 'right' }}>{st.detail}</span>
                <span style={{ width: 36, display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                  {canRemove(u) && <IconButton label={`Remove ${u.name}`} className="danger" onClick={() => setRemoving(u.id)}><Trash2 size={15} /></IconButton>}
                </span>
              </div>
            ) })}
          </div>
        )}
      </section>
      {edit && <PersonModal person={edit === 'new' ? undefined : edit} teams={teams ?? []} onClose={() => setEdit(null)} onSaved={() => void reload()}
        onLink={(name, result) => { setLink({ name, result }); setEdit(null); void reload() }}
        onRemove={edit !== 'new' && canRemove(edit) ? () => { setRemoving(edit.id); setEdit(null) } : undefined} />}
      {removing && <RemovePerson userId={removing} onClose={() => setRemoving(null)} onRemoved={() => void reload()} />}
      {link && <InviteLinkModal name={link.name} result={link.result} onClose={() => setLink(null)} />}
      {inviting && <InvitePeople teams={teams ?? []} onClose={() => setInviting(false)} onDone={() => void reload()} />}
    </div>
  )
}

function PersonModal({ person, teams, onClose, onSaved, onRemove, onLink }: { person?: User; teams: Team[]; onClose: () => void; onSaved: () => void; onRemove?: () => void; onLink: (name: string, r: InviteResult) => void }) {
  const toast = useToast()
  const { user: me } = useAuth()
  const [f, setF] = useState({ name: person?.name ?? '', email: person?.email ?? '', role: (person?.role ?? 'member') as Role, team_id: String(person?.team_id ?? ''), password: '', phone: person?.phone ?? '', is_active: person ? !!person.is_active : true })
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const roles: Role[] = me?.role === 'super_admin' ? ['super_admin', 'admin', 'creative_head', 'project_manager', 'tech_lead', 'member'] : ['admin', 'creative_head', 'project_manager', 'tech_lead', 'member']
  return (
    <Modal title={person ? person.name : 'Invite someone'} sub={person ? person.email : 'They get a link to choose their own password.'} onClose={onClose}
      footer={<>{onRemove && <Button variant="ghost" className="danger-text" icon={<Trash2 size={14} />} onClick={onRemove} style={{ marginRight: 'auto' }}>Remove person</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="pp" loading={busy}>{person ? 'Save' : 'Send invite'}</Button></>}>
      <form id="pp" className="stack" style={{ gap: 14 }} onSubmit={async e => {
        e.preventDefault(); setBusy(true); setErr({})
        const body: Record<string, unknown> = { name: f.name, role: f.role, team_id: f.team_id || null, phone: f.phone }
        if (person) { body.is_active = f.is_active; if (f.password) body.password = f.password } else { body.email = f.email }
        try {
          const r = await api<{ id?: number; invite?: InviteResult | null }>(person ? `/users/${person.id}` : '/users', { method: person ? 'PATCH' : 'POST', body })
          if (!person && r.invite) { onLink(f.name, r.invite); return }
          toast.success('Saved'); onSaved(); onClose()
        }
        catch (x) { if (x instanceof ApiError && x.details) setErr(x.details); else toast.error(x) } finally { setBusy(false) }
      }}>
        <Field label="Name" required error={err.name}>{id => <input id={id} className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}</Field>
        {!person && <Field label="Email" required error={err.email}>{id => <input id={id} type="email" className="input" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />}</Field>}
        <Field label="Phone" error={err.phone} help="For SMS and WhatsApp messages from workflows">{id => <input id={id} type="tel" className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="+91 98765 43210" />}</Field>
        <div className="two">
          <Field label="Department">{id => <select id={id} className="select" value={f.team_id} onChange={e => setF({ ...f, team_id: e.target.value })}><option value="">No department</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</Field>
          <Field label="Role" help="Decides which work they can approve.">{id => <select id={id} className="select" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>{roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>}</Field>
        </div>
        {person && person.id === me?.id && (
          <Field label="New password" error={err.password} help="Leave blank to keep it. Changing it signs you out on other devices.">
            {id => <input id={id} type="password" autoComplete="new-password" className="input" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />}
          </Field>
        )}
        {person && person.id !== me?.id && !!person.is_active && <SendLinkButton userId={person.id} joined={!!person.joined_at} name={person.name} onResult={r => onLink(person.name, r)} />}
        {!person && <p className="muted" style={{ fontSize: 13 }}>They'll get an email with a link to choose their own password (through Brevo). If Brevo isn't connected, you'll get the link to send them yourself.</p>}
        {person && person.id !== me?.id && <label className="check"><input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} /> Can sign in</label>}
      </form>
    </Modal>
  )
}
