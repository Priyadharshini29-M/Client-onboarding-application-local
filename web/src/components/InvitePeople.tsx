import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, MailCheck, MailWarning, Plus, Send, X } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDate, ROLE_LABEL } from '../lib/format'
import type { Role, Team } from '../lib/types'
import { Button, copyText, IconButton, Modal } from './ui'
import { useToast } from './toast'
import type { InviteResult } from './InviteLink'

type Row = { key: number; name: string; email: string; team_id: string; role: Role; errors?: Record<string, string> }
type Done = { name: string; result: InviteResult }

let seq = 1
const blank = (team_id = '', role: Role = 'member'): Row => ({ key: seq++, name: '', email: '', team_id, role })

/** Invite one or many people at once. Each gets their own link to choose a password (emailed through Brevo). */
export function InvitePeople({ teams, onClose, onDone }: { teams: Team[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const { user: me } = useAuth()
  const roles: Role[] = me?.role === 'super_admin' ? ['member', 'creative_head', 'project_manager', 'tech_lead', 'admin', 'super_admin'] : ['member', 'creative_head', 'project_manager', 'tech_lead', 'admin']
  const [rows, setRows] = useState<Row[]>([blank()])
  const [done, setDone] = useState<Done[]>([])
  const [busy, setBusy] = useState(false)
  const [showResults, setShowResults] = useState(false)

  const filled = rows.filter(r => r.name.trim() || r.email.trim())
  const set = (key: number, p: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p, errors: undefined } : r)))

  async function send() {
    setBusy(true)
    const left: Row[] = []
    const sent: Done[] = []
    for (const r of rows) {
      if (!r.name.trim() && !r.email.trim()) continue
      try {
        const res = await api<{ invite: InviteResult }>('/users', { body: { name: r.name.trim(), email: r.email.trim(), team_id: r.team_id || null, role: r.role } })
        sent.push({ name: r.name.trim(), result: res.invite })
      } catch (e) {
        left.push({ ...r, errors: e instanceof ApiError && e.details ? e.details : { email: e instanceof Error ? e.message : 'Could not invite' } })
      }
    }
    setBusy(false)
    setDone(d => [...d, ...sent])
    if (sent.length) onDone()
    if (left.length) {
      setRows(left)
      toast.error(sent.length ? `Invited ${sent.length}. ${left.length} need fixing.` : 'Please fix the highlighted fields.')
    } else {
      setShowResults(true)
    }
  }

  if (showResults) return <InviteResults done={done} onClose={onClose} />

  return (
    <Modal title="Invite people" sub="Each person gets their own link to choose a password." size="lg" onClose={onClose} footer={<>
      {done.length > 0 && <Button variant="ghost" onClick={() => setShowResults(true)} style={{ marginRight: 'auto' }}>See {done.length} sent</Button>}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={<Send size={14} />} loading={busy} disabled={!filled.length} onClick={send}>
        {filled.length > 1 ? `Send ${filled.length} invites` : 'Send invite'}
      </Button>
    </>}>
      <div className="inv-rows">
        <div className="inv-row inv-head" aria-hidden="true"><span>Name</span><span>Work email</span><span>Department</span><span>Role</span><span /></div>
        {rows.map((r, i) => (
          <div key={r.key} className={`inv-row ${r.errors ? 'bad' : ''}`}>
            <input className={`input ${r.errors?.name ? 'invalid' : ''}`} placeholder="Full name" value={r.name} autoFocus={i === rows.length - 1 && i > 0} onChange={e => set(r.key, { name: e.target.value })} aria-label={`Name ${i + 1}`} />
            <input className={`input ${r.errors?.email ? 'invalid' : ''}`} type="email" placeholder="name@company.com" value={r.email} onChange={e => set(r.key, { email: e.target.value })} aria-label={`Email ${i + 1}`} />
            <select className="select" value={r.team_id} onChange={e => set(r.key, { team_id: e.target.value })} aria-label={`Department ${i + 1}`}>
              <option value="">No department</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="select" value={r.role} onChange={e => set(r.key, { role: e.target.value as Role })} aria-label={`Role ${i + 1}`}>
              {roles.map(x => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
            </select>
            <span>{rows.length > 1 && <IconButton label={`Remove row ${i + 1}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><X size={15} /></IconButton>}</span>
            {r.errors && <p className="inv-error">{Object.values(r.errors).join(' ')}</p>}
          </div>
        ))}
        <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => { const last = rows[rows.length - 1]; setRows([...rows, blank(last?.team_id, last?.role)]) }}>
          <Plus size={14} /> Add another person
        </button>
        <p className="muted" style={{ fontSize: 12.5 }}>You can add a phone number later by clicking the person in People.</p>
      </div>
    </Modal>
  )
}

/** What happened to each invite: emailed, or a link to send yourself. */
function InviteResults({ done, onClose }: { done: Done[]; onClose: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState<number | 'all' | null>(null)
  const unsent = done.filter(d => d.result.email_status !== 'sent')
  const copy = async (text: string, which: number | 'all') => { if (await copyText(text)) { setCopied(which); toast.success(which === 'all' ? 'All links copied' : 'Link copied') } }

  return (
    <Modal title={done.length === 1 ? `${done[0].name.split(' ')[0]} is invited` : `${done.length} people invited`} size="lg" onClose={onClose} footer={<>
      {done.length > 1 && <Button icon={copied === 'all' ? <Check size={14} /> : <Copy size={14} />} onClick={() => copy(done.map(d => `${d.name}: ${d.result.link}`).join('\n'), 'all')} style={{ marginRight: 'auto' }}>Copy all links</Button>}
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        {unsent.length > 0 ? (
          <div className="invite-status warn"><MailWarning size={18} /><span>
            {unsent.some(d => d.result.email_status === 'failed') ? 'Some emails could not be sent. ' : 'No emails went out because Brevo isn’t connected. '}
            Copy each link and send it to that person yourself (WhatsApp or email). <Link to="/settings/integrations" onClick={onClose}>Connect Brevo</Link> to email invites automatically.
          </span></div>
        ) : (
          <div className="invite-status ok"><MailCheck size={18} /><span>Everyone got an email with their link.</span></div>
        )}
        <div className="inv-results">
          {done.map((d, i) => (
            <div key={i} className="inv-result">
              <div className="grow" style={{ minWidth: 0 }}>
                <b>{d.name}</b>
                <small>{d.result.email} · {d.result.email_status === 'sent' ? 'emailed' : d.result.email_status === 'failed' ? `email failed${d.result.email_error ? `: ${d.result.email_error}` : ''}` : 'not emailed'} · expires {formatDate(d.result.expires_at)}</small>
              </div>
              <Button size="sm" icon={copied === i ? <Check size={14} /> : <Copy size={14} />} onClick={() => copy(d.result.link, i)}>{copied === i ? 'Copied' : 'Copy link'}</Button>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>Each link works once. Send it only to that person.</p>
      </div>
    </Modal>
  )
}
