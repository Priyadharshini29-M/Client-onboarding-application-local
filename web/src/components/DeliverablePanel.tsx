import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Ban, Check, FileText, ExternalLink, FileDown, Link2, MessageSquare, Paperclip, RotateCcw, Send, Upload } from 'lucide-react'
import { api, ApiError, downloadFile } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { BLOCK_TYPE, DELIVERABLE_STATUS, PRIORITY, dueText, formatBytes, formatDate, formatDateTime, FORM_STATUS, isLate, timeAgo } from '../lib/format'
import type { DeliverableDetail, User, Version } from '../lib/types'
import { Avatar, Button, Drawer, Loading, Note, Pill, TeamTag } from './ui'
import { useToast } from './toast'
import { ReworkEditor, ReworkList, reworkNote } from './Rework'
import { approverLabel } from '../lib/workflow'

type Tab = 'review' | 'versions' | 'details'

/**
 * One task. Three tabs:
 *  Review   — the latest version, what changed, and approve / ask for rework (or submit the next version).
 *  Versions — every version: what the team changed and what the approver asked for.
 *  Details  — brief, who it's assigned to, due date, priority, tags, blocked.
 */
export function DeliverablePanel({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { user } = useAuth()
  const { data: d, setData, loading } = useApi<DeliverableDetail>(`/deliverables/${id}`)
  const { data: people } = useApi<User[]>('/users')
  const [tab, setTab] = useState<Tab>('review')
  useEffect(() => setTab('review'), [id])

  const apply = (next: DeliverableDetail) => { setData(next); onChanged() }

  if (loading || !d) return <Drawer onClose={onClose} head={<span className="label">Loading…</span>}><Loading /></Drawer>

  const latest = d.versions[0]
  const locked = d.stage_status === 'locked'
  const approved = d.status === 'approved'
  const canShare = d.kind === 'work' && !locked && !approved && d.status !== 'in_review'
  const canDecide = d.can_review && !locked && !approved && d.status === 'in_review'
  const tabs: [Tab, string, number?][] = d.kind === 'intake'
    ? [['review', 'Review'], ['details', 'Details']]
    : [['review', 'Review'], ['versions', 'Versions', d.versions.length], ['details', 'Details']]

  async function patch(body: Record<string, unknown>) {
    try { apply(await api<DeliverableDetail>(`/deliverables/${id}`, { method: 'PATCH', body })) } catch (e) { toast.error(e) }
  }

  return (
    <Drawer onClose={onClose} head={
      <div className="stack" style={{ gap: 10 }}>
        <span className="label">{d.project_kind === 'workflow' ? `${d.brand_name} · Workflow: ${d.project_name}` : `${d.brand_name} · Stage ${d.stage_no} · ${d.stage_name}`}</span>
        <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-.01em' }}>{d.title}</h2>
        <div className="row wrap" style={{ gap: 10 }}>
          <Pill map={DELIVERABLE_STATUS} value={d.status} />
          {d.kind === 'work' && d.version_count > 0 && <span className="vbadge">Version {d.version_count}</span>}
          {d.blocked && <span className="pill change"><Ban size={11} /> Blocked</span>}
          {d.priority !== 'medium' && <Pill map={PRIORITY} value={d.priority} />}
          <TeamTag name={d.team_name} icon={d.team_icon} />
          <span className="tag">Approver: {approverLabel(d.approver_role)}</span>
        </div>
        <div className="seg panel-tabs" role="tablist" aria-label="Task">
          {tabs.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {label}{n !== undefined && n > 0 && <span className="n">{n}</span>}
            </button>
          ))}
        </div>
      </div>
    }>
      {tab === 'review' && <>
        {locked && <Note>This opens when the stage before it is finished.</Note>}
        {approved && <Note tone="ok">Approved{d.approved_by_name ? ` by ${d.approved_by_name}` : ''} {formatDateTime(d.approved_at)}. Nothing more to do here.</Note>}
        {d.asset_format_id && d.asset_format_name && (
          <Link to={`/assets?format=${d.asset_format_id}`} className="format-link"><span className="af-ico sm"><FileText size={15} /></span>
            <span className="grow"><b>Fill in the {d.asset_format_name} format</b><small>Open it in Assets, fill it for {d.brand_name}, then submit this task.</small></span><ArrowRight size={15} /></Link>
        )}
        {d.brief && d.versions.length === 0 && d.kind === 'work' && <div className="brief-box"><div className="label" style={{ marginBottom: 4 }}>What needs to be done</div><p style={{ whiteSpace: 'pre-wrap' }}>{d.brief}</p></div>}
        {d.blocked && <Note tone="error"><b>Blocked:</b> {d.block_reason} <button className="link-btn" onClick={() => setTab('details')}>See details</button></Note>}

        {d.kind === 'intake' ? <IntakeReview d={d} onDone={apply} /> : <>
          {d.status === 'not_started' && !locked && d.assignee_id === user?.id && (
            <Button variant="secondary" onClick={() => void patch({ status: 'in_progress' })}>Start working on this</Button>
          )}

          {/* Sent back: show exactly what to rework, then the form for the next version. */}
          {d.status === 'changes_requested' && latest && (
            <div className="rework-card">
              <div className="between">
                <b><RotateCcw size={15} /> Rework needed on version {latest.version_no}</b>
                <span className="muted" style={{ fontSize: 12.5 }}>{latest.decided_by_name} · {timeAgo(latest.decided_at)}</span>
              </div>
              <ReworkList note={latest.decision_note} />
            </div>
          )}

          {latest && d.status !== 'changes_requested' && (
            <VersionCard v={latest} current onComment={apply} title={d.status === 'in_review' ? `Version ${latest.version_no} · waiting for approval` : `Version ${latest.version_no}`} />
          )}

          {canDecide && latest && <Decide d={d} version={latest} onDone={apply} />}
          {d.status === 'in_review' && !d.can_review && <Note>Waiting for the {approverLabel(d.approver_role)} to approve version {latest?.version_no}.</Note>}
          {canShare && <ShareVersion d={d} onDone={apply} />}

          {d.versions.length > 1 && (
            <button className="link-btn" style={{ justifySelf: 'start' }} onClick={() => setTab('versions')}>
              See all {d.versions.length} versions and what changed <ArrowRight size={14} />
            </button>
          )}
        </>}
      </>}

      {tab === 'versions' && (
        d.versions.length === 0 ? <p className="muted">Nothing submitted yet. Versions show up here once the team submits work.</p> : (
          <div className="timeline">
            {d.versions.map((v, i) => (
              <div key={v.id} className={`tl-item ${v.status}`}>
                <span className="tl-dot" aria-hidden="true" />
                <VersionCard v={v} current={i === 0} onComment={apply} title={`Version ${v.version_no}${i === 0 ? ' · latest' : ''}`} />
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'details' && <>
        {d.brief && <div><div className="label" style={{ marginBottom: 6 }}>What needs to be done</div><p className="soft" style={{ whiteSpace: 'pre-wrap' }}>{d.brief}</p></div>}

        <div className="two">
          <div className="field">
            <label htmlFor="owner">Assigned to</label>
            <select id="owner" className="select sm" value={d.assignee_id ?? ''} disabled={approved} onChange={e => void patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Not assigned</option>
              {people?.map(p => <option key={p.id} value={p.id}>{p.name}{p.team_name ? ` · ${p.team_name}` : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="due">Due <span className={isLate(d.due_date, d.status) ? 'late' : 'muted'} style={{ fontWeight: 400 }}>· {dueText(d.due_date)}</span></label>
            <input id="due" type="date" className="input sm" value={d.due_date ?? ''} disabled={approved} onChange={e => void patch({ due_date: e.target.value || null })} />
          </div>
        </div>

        <div className="two">
          <div className="field">
            <label htmlFor="prio">Priority</label>
            <select id="prio" className="select sm" value={d.priority} disabled={approved} onChange={e => void patch({ priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <TagEditor tags={d.tags} disabled={approved} onChange={tags => void patch({ tags })} />
        </div>

        {!approved && !locked && <BlockBox d={d} onDone={apply} />}
      </>}
    </Drawer>
  )
}

const VERSION_STATUS = { in_review: { label: 'Waiting for approval', tone: 'review' }, approved: { label: 'Approved', tone: 'ok' }, changes_requested: { label: 'Sent back for rework', tone: 'change' } }

function VersionCard({ v, current, onComment, title }: { v: Version; current: boolean; onComment: (d: DeliverableDetail) => void; title: string }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className={`version ${current ? 'current' : ''}`}>
      <div className="version-head">
        <b className="grow" style={{ fontWeight: 600 }}>{title}</b>
        <Pill map={VERSION_STATUS} value={v.status} />
      </div>
      <div className="version-body">
        <div className="muted" style={{ fontSize: 12.5 }}>Submitted by {v.created_by_name ?? 'someone'} · {formatDateTime(v.created_at)}</div>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>{v.version_no === 1 ? 'What was done' : 'What changed'}</div>
          {v.note ? <p style={{ whiteSpace: 'pre-wrap' }}>{v.note}</p> : <p className="muted">No description.</p>}
        </div>
        {v.link_url && <a className="attach" href={v.link_url} target="_blank" rel="noreferrer"><Link2 size={15} /><span className="truncate grow">{v.link_url}</span><ExternalLink size={14} className="muted" /></a>}
        {v.file_name && (
          <button className="attach" onClick={() => void downloadFile(`/versions/${v.id}/file`, v.file_name!).catch(e => toast.error(e))}>
            <Paperclip size={15} /><span className="truncate grow">{v.file_name}</span><span className="muted" style={{ fontSize: 12 }}>{formatBytes(v.file_size ?? 0)}</span><FileDown size={15} className="muted" />
          </button>
        )}
        {v.decided_at && (
          <div className={`decision ${v.status === 'approved' ? 'ok' : 'change'}`}>
            <div><b>{v.status === 'approved' ? 'Approved' : 'Asked for rework'}</b> by {v.decided_by_name} · {timeAgo(v.decided_at)}</div>
            <ReworkList note={v.decision_note} />
          </div>
        )}
        {(v.comments.length > 0 || current) && (
          <div className="comments" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {v.comments.map(c => (
              <div key={c.id} className="comment">
                <Avatar name={c.user_name} size="sm" />
                <div><b style={{ fontWeight: 600 }}>{c.user_name}</b> <span className="when">{timeAgo(c.created_at)}</span><p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p></div>
              </div>
            ))}
            {current && (
              <form className="row" onSubmit={async e => {
                e.preventDefault()
                if (!text.trim()) return
                setBusy(true)
                try { onComment(await api<DeliverableDetail>(`/versions/${v.id}/comments`, { body: { body: text } })); setText('') } catch (err) { toast.error(err) } finally { setBusy(false) }
              }}>
                <MessageSquare size={15} className="muted" />
                <input className="input sm grow" placeholder="Add a comment for the team" value={text} onChange={e => setText(e.target.value)} aria-label="Comment" />
                <Button size="sm" type="submit" loading={busy} disabled={!text.trim()}>Post</Button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ShareVersion({ d, onDone }: { d: DeliverableDetail; onDone: (d: DeliverableDetail) => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const next = d.version_count + 1
  const rework = d.status === 'changes_requested'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErrors({})
    const form = new FormData()
    form.append('note', note); form.append('link_url', link)
    if (file) form.append('file', file)
    try {
      onDone(await api<DeliverableDetail>(`/deliverables/${d.id}/versions`, { form }))
      toast.success(`Version ${next} submitted for approval`)
      setNote(''); setLink(''); setFile(null)
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details); else toast.error(err)
    } finally { setBusy(false) }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <b style={{ fontSize: 15.5 }}>Submit version {next}</b>
      <div className="field">
        <label htmlFor="v-note">{rework ? 'What did you change?' : 'What did you do?'}</label>
        <textarea id="v-note" className={`textarea ${errors.note ? 'invalid' : ''}`} style={{ minHeight: 84 }}
          placeholder={rework ? 'e.g. Made the logo bigger, changed the headline, used the warmer colours' : 'Describe the work so the approver knows what to look at'}
          value={note} onChange={e => setNote(e.target.value)} />
        {errors.note && <span className="error">{errors.note}</span>}
      </div>
      <input className={`input sm ${errors.link_url ? 'invalid' : ''}`} placeholder="Link to Figma, Drive or a preview (optional)" value={link} onChange={e => setLink(e.target.value)} aria-label="Link" />
      {errors.link_url && <span className="error" style={{ color: 'var(--change)', fontSize: 12.5 }}>{errors.link_url}</span>}
      <div className="row wrap">
        <input ref={picker} type="file" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <Button size="sm" icon={<Upload size={14} />} onClick={() => picker.current?.click()}>{file ? 'Change file' : 'Attach file'}</Button>
        {file && <span className="muted truncate" style={{ fontSize: 13, maxWidth: 240 }}>{file.name} · {formatBytes(file.size)}</span>}
        <Button variant="primary" size="sm" type="submit" icon={<Send size={14} />} loading={busy} style={{ marginLeft: 'auto' }}>Submit for approval</Button>
      </div>
    </form>
  )
}

/** Approve, or ask for rework with a clear list of what to change. */
function Decide({ d, version, onDone }: { d: DeliverableDetail; version: Version; onDone: (d: DeliverableDetail) => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'choose' | 'rework'>('choose')
  const [points, setPoints] = useState<string[]>([''])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'approved' | 'changes_requested' | null>(null)
  const filled = points.map(p => p.trim()).filter(Boolean)

  async function decide(decision: 'approved' | 'changes_requested') {
    if (decision === 'changes_requested' && !filled.length) { setError('Add at least one thing to change.'); return }
    setBusy(decision); setError('')
    const note = decision === 'changes_requested' ? reworkNote(points) : ''
    try {
      onDone(await api<DeliverableDetail>(`/deliverables/${d.id}/decision`, { body: { decision, note } }))
      toast.success(decision === 'approved' ? `${d.title} approved` : 'Sent back for rework')
    } catch (e) { toast.error(e) } finally { setBusy(null) }
  }

  if (mode === 'choose') return (
    <div className="review-box">
      <b style={{ fontSize: 15.5 }}>Is version {version.version_no} good to go?</b>
      <div className="decide-btns">
        <Button variant="approve" icon={<Check size={15} />} loading={busy === 'approved'} disabled={!!busy} onClick={() => decide('approved')}>Approve</Button>
        <Button variant="change" icon={<RotateCcw size={15} />} disabled={!!busy} onClick={() => setMode('rework')}>Ask for rework</Button>
      </div>
    </div>
  )

  return (
    <div className="review-box rework">
      <div className="between"><b style={{ fontSize: 15.5 }}>What needs to change?</b><span className="muted" style={{ fontSize: 12.5 }}>One point per line</span></div>
      <ReworkEditor points={points} onChange={p => { setPoints(p); setError('') }} />
      {error && <span style={{ color: 'var(--change)', fontSize: 12.5 }}>{error}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" disabled={!!busy} onClick={() => { setMode('choose'); setError('') }}>Cancel</Button>
        <Button variant="change" icon={<RotateCcw size={15} />} loading={busy === 'changes_requested'} disabled={!!busy} onClick={() => decide('changes_requested')}>
          Send back{filled.length ? ` with ${filled.length} ${filled.length === 1 ? 'change' : 'changes'}` : ''}
        </Button>
      </div>
    </div>
  )
}

function IntakeReview({ d, onDone }: { d: DeliverableDetail; onDone: (d: DeliverableDetail) => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const status = d.intake_status ?? 'not_sent'

  async function decide(decision: 'approved' | 'changes_requested') {
    if (decision === 'changes_requested' && !note.trim()) { toast.error('Tell the client what is missing.'); return }
    setBusy(true)
    try { onDone(await api<DeliverableDetail>(`/deliverables/${d.id}/decision`, { body: { decision, note } })); toast.success(decision === 'approved' ? 'Intake accepted' : 'Form reopened for the client') }
    catch (e) { toast.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="version"><div className="version-body">
        <div className="between"><span>Client's form</span><Pill map={FORM_STATUS} value={status} /></div>
        <Link to={`/clients/${d.brand_id}?view=onboarding`} className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }}>See their answers</Link>
      </div></div>
      {status !== 'submitted' && d.status !== 'approved' && <Note>Share the form link from the client's page. It comes here for sign-off once they submit.</Note>}
      {status === 'submitted' && d.status !== 'approved' && d.can_review && (
        <div className="review-box">
          <b style={{ fontFamily: 'var(--display)', fontSize: 17 }}>Is everything there?</b>
          <textarea className="textarea" style={{ minHeight: 64 }} placeholder="If something is missing, note it here before reopening the form" value={note} onChange={e => setNote(e.target.value)} aria-label="Note" />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="change" disabled={busy} onClick={() => decide('changes_requested')}>Reopen for the client</Button>
            <Button variant="approve" icon={<Check size={15} />} loading={busy} onClick={() => decide('approved')}>Accept intake</Button>
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>Due {formatDate(d.due_date)}</p>
    </div>
  )
}

function TagEditor({ tags, disabled, onChange }: { tags: string[]; disabled?: boolean; onChange: (t: string[]) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="field">
      <label htmlFor="tag-in">Tags</label>
      <div className="row wrap" style={{ gap: 6 }}>
        {tags.map(t => (
          <span key={t} className="chip-link" style={{ cursor: 'default' }}>{t}
            {!disabled && <button onClick={() => onChange(tags.filter(x => x !== t))} aria-label={`Remove ${t}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}>×</button>}
          </span>
        ))}
        {!disabled && (
          <input id="tag-in" className="input sm" style={{ width: 120 }} placeholder="Add tag" value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); onChange([...tags, text.trim()]); setText('') } }} />
        )}
      </div>
    </div>
  )
}

/** Blocked: who is needed, what kind of help, and what exactly. Anyone can resolve it with a note. */
function BlockBox({ d, onDone }: { d: DeliverableDetail; onDone: (d: DeliverableDetail) => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [type, setType] = useState('text')
  const [reason, setReason] = useState('')
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)

  if (d.blocked) {
    return (
      <div className="note error" style={{ display: 'grid', gap: 10 }}>
        <div><b>Blocked</b> · {BLOCK_TYPE[d.block_type ?? 'text']}{d.block_who ? ` · needs ${d.block_who}` : ''}<br />
          <span style={{ whiteSpace: 'pre-wrap' }}>{d.block_reason}</span>
          <div style={{ fontSize: 12.5, opacity: .8, marginTop: 4 }}>Marked by {d.blocked_by_name ?? 'someone'} {timeAgo(d.blocked_at)}</div></div>
        <div className="row wrap">
          <input className="input sm grow" style={{ minWidth: 200 }} placeholder="How was it resolved? (optional)" value={response} onChange={e => setResponse(e.target.value)} aria-label="Resolution" />
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true)
            try { onDone(await api<DeliverableDetail>(`/deliverables/${d.id}/unblock`, { body: { response } })); toast.success('Unblocked') } catch (e) { toast.error(e) } finally { setBusy(false) }
          }}>Mark unblocked</Button>
        </div>
      </div>
    )
  }
  if (!open) return <div><Button size="sm" variant="ghost" icon={<Ban size={14} />} onClick={() => setOpen(true)}>Mark as blocked</Button>
    {d.block_response && <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>Last block resolved: {d.block_response}</span>}</div>
  return (
    <form className="composer" onSubmit={async e => {
      e.preventDefault()
      if (!reason.trim()) { toast.error('Say what is needed to unblock it.'); return }
      setBusy(true)
      try { onDone(await api<DeliverableDetail>(`/deliverables/${d.id}/block`, { body: { who, type, reason } })); setOpen(false); toast.success('Marked as blocked') } catch (err) { toast.error(err) } finally { setBusy(false) }
    }}>
      <b style={{ fontFamily: 'var(--display)', fontSize: 17 }}>What's blocking this?</b>
      <div className="two">
        <select className="select sm" value={who} onChange={e => setWho(e.target.value)} aria-label="Who is needed">
          <option value="">Who is needed? (anyone)</option>
          <option value="client">The client</option>
          <option value="Project Management">Project Management</option>
          <option value="Creative">Creative</option>
          <option value="Shoot">Shoot</option>
          <option value="Digital">Digital</option>
          <option value="Tech">Tech</option>
          <option value="external">An outside party</option>
        </select>
        <select className="select sm" value={type} onChange={e => setType(e.target.value)} aria-label="Type of request">
          {Object.entries(BLOCK_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <textarea className="textarea" style={{ minHeight: 64 }} placeholder="What exactly is needed to unblock this?" value={reason} onChange={e => setReason(e.target.value)} aria-label="What is needed" />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit" loading={busy}>Mark as blocked</Button>
      </div>
    </form>
  )
}
