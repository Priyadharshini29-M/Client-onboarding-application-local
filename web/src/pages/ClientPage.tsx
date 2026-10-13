import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, ExternalLink, Pause, Pencil, Play, Plus, Save, Send, Trash2, Undo2 } from 'lucide-react'
import { api, ApiError, downloadFile } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/hooks'
import {
  CLIENT_STATUS, DELIVERABLE_STATUS, dueText, formatDate, formatDateTime, FORM_STATUS, isLate, pad2, pct, timeAgo,
} from '../lib/format'
import type { ClientDetail, FormPayload, Project, Stage, User } from '../lib/types'
import { DeliverablePanel } from '../components/DeliverablePanel'
import { SetupChecklist } from '../components/SetupChecklist'
import { ClientOverview } from '../components/ClientOverview'
import { AssetLibrary } from '../components/AssetLibrary'
import { EntryList } from '../components/AssetFormats'
import { approverLabel } from '../lib/workflow'
import { EmailLinkButton } from '../components/EmailLinkButton'
import { ClientTeam } from '../components/ClientTeam'
import { ClientDocuments } from '../components/ClientDocuments'
import { ContentCalendar } from '../components/ContentCalendar'
import { HealthBadge } from '../components/HealthBadge'
import { ProfileFields } from '../components/ProfileFields'
import { CLIENT_TYPES } from '../lib/clientTypes'
import { FormRenderer, type FormValues } from '../components/FormRenderer'
import { DocAutofill } from '../components/DocAutofill'
import { useShell } from '../components/Shell'
import { Avatar, Bar, Button, Confirm, copyText, Empty, Field, Loading, Modal, Note, Pill, Tabs, TeamTag } from '../components/ui'
import { useToast } from '../components/toast'

type View = 'overview' | 'project' | 'team' | 'onboarding' | 'setup' | 'content' | 'assets' | 'history'

export function ClientPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view = (raw === 'intake' ? 'onboarding' : raw ?? 'overview') as View
  const { refreshCounts } = useShell()
  const { data: client, loading, error, reload } = useApi<ClientDetail>(`/clients/${id}`)
  const [projectId, setProjectId] = useState<number | null>(null)
  const shownProject = (projectId && client?.projects.some(p => p.id === projectId) ? projectId : client?.project_id) ?? null
  const projectPath = shownProject ? `/projects/${shownProject}` : null
  const { data: project, reload: reloadProject, setData: setProject } = useApi<Project>(projectPath)
  const [editing, setEditing] = useState(false)

  if (loading && !client) return <div className="page"><Loading /></div>
  if (error || !client) return <div className="page"><Empty title="We couldn't find this client">{error?.message}</Empty></div>

  const refresh = () => { void reload(); void reloadProject(); refreshCounts() }
  const go = (k: View) => setParams(k === 'overview' ? {} : { view: k }, { replace: true })

  return (
    <div className="page">
      <Link to="/clients" className="btn btn-ghost btn-sm" style={{ marginLeft: -12, marginBottom: 14 }}><ArrowLeft size={14} /> Clients</Link>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 16 }}>
          {client.logo_url ? <img src={client.logo_url} alt="" className="brand-logo" /> : <Avatar name={client.name} size="lg" />}
          <div>
            <div className="row wrap" style={{ gap: 12 }}><h1>{client.name}</h1><Pill map={CLIENT_STATUS} value={client.status} /></div>
            <p>{[CLIENT_TYPES[client.brand_type].label, client.industry, client.contact_name].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="row wrap">
          <HealthBadge score={client.health} reasons={client.health_reasons} />
          <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit details</Button>
          {project && project.status !== 'completed' && (
            <Button icon={project.status === 'on_hold' ? <Play size={14} /> : <Pause size={14} />} onClick={async () => {
              setProject(await api<Project>(`/projects/${project.id}`, { method: 'PATCH', body: { status: project.status === 'on_hold' ? 'active' : 'on_hold' } }))
              void reload()
            }}>{project.status === 'on_hold' ? 'Resume project' : 'Put on hold'}</Button>
          )}
        </div>
      </div>

      <Tabs value={view} onChange={go} tabs={[
        { key: 'overview', label: 'Overview' },
        { key: 'project', label: 'Project' },
        { key: 'team', label: 'Team' },
        { key: 'onboarding', label: 'Onboarding', count: Number(client.docs_pending) || undefined },
        { key: 'setup', label: 'Setup' },
        { key: 'content', label: 'Content' },
        { key: 'assets', label: 'Assets', count: Number(client.asset_count) || undefined },
        { key: 'history', label: 'History' },
      ]} />

      {view === 'project' && client.projects.length > 1 && (
        <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
          {client.projects.map(p => (
            <button key={p.id} className={`team-chip ${p.id === shownProject ? 'active' : ''}`} onClick={() => setProjectId(p.id)}>
              {p.name}<span className="count">{p.status === 'completed' ? 'done' : p.status === 'on_hold' ? 'on hold' : 'active'}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'project' && (project ? <ProjectView key={project.id} project={project} client={client} onChanged={refresh} /> : <Loading />)}
      {view === 'overview' && <ClientOverview client={client} project={project} go={go} onEdit={() => setEditing(true)} />}
      {view === 'setup' && <SetupChecklist client={client} onChanged={refresh} />}
      {view === 'onboarding' && <IntakeView client={client} onChanged={refresh} />}
      {view === 'assets' && <div className="stack" style={{ gap: 20 }}><EntryList clientId={client.id} /><AssetLibrary clientId={client.id} /></div>}
      {view === 'team' && <ClientTeam key={client.id} clientId={client.id} initial={client.team} onChanged={refresh} />}
      {view === 'content' && <ContentCalendar clientId={client.id} />}
      {view === 'history' && <HistoryView clientId={client.id} />}
      {editing && <EditClient client={client} onClose={() => setEditing(false)} onSaved={refresh} />}
    </div>
  )
}

// Project: stage tracker + the selected stage's deliverables --------------------------------------------

function ProjectView({ project, client, onChanged }: { project: Project; client: ClientDetail; onChanged: () => void }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState<Stage | null>(null)
  const current = project.stages.find(s => s.position === project.current_stage) ?? project.stages[0]
  const stage = project.stages.find(s => s.id === picked) ?? current
  const done = stage.deliverables.filter(d => d.status === 'approved').length

  return (
    <div className="stack" style={{ gap: 22 }}>
      {project.status === 'on_hold' && <Note tone="warn">This project is on hold. Nobody can share or approve work until it's resumed.</Note>}
      {project.status === 'completed' && <Note tone="ok">Project complete {formatDate(project.completed_at, true)}. Everything below is kept as the record.</Note>}

      <div className="stages" role="tablist" aria-label="Stages">
        {project.stages.map(s => (
          <button key={s.id} role="tab" aria-selected={s.id === stage.id} className={`stage-btn ${s.status} ${s.id === stage.id ? 'selected' : ''}`}
            onClick={() => setPicked(s.id)}>
            <span className="n">{pad2(s.position)}</span>
            <span className="nm">{s.name}</span>
            <span className="st">{s.status === 'done' ? `Done ${formatDate(s.done_at)}` : s.status === 'open' ? `${s.deliverables.filter(d => d.status === 'approved').length}/${s.deliverables.length} approved` : 'Not open yet'}</span>
          </button>
        ))}
      </div>

      <div className="cols">
        <section className="panel">
          <div className="panel-head" style={{ alignItems: 'flex-start' }}>
            <div>
              <span className="label">Stage {pad2(stage.position)} of {pad2(project.stages.length)}</span>
              <h2 style={{ fontSize: 24, marginTop: 6 }}>{stage.name}</h2>
              <p>{stage.summary}</p>
              <div className="row wrap" style={{ gap: 14, marginTop: 10 }}>
                <TeamTag name={stage.team_name} icon={stage.team_icon} />
                <span className="tag">Approver: {approverLabel(stage.approver_role)}</span>
                <span className="tag">Due {formatDate(stage.due_date)}</span>
              </div>
            </div>
            {stage.status !== 'done' && (stage.can_review) && <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(stage)}>Add task</Button>}
          </div>
          <div style={{ padding: '0 20px 14px' }}><Bar value={pct(done, stage.deliverables.length)} /></div>
          <div className="dl">
            {stage.deliverables.length === 0 && <Empty title="No tasks in this stage" />}
            {stage.deliverables.map(d => (
              <button key={d.id} className="dl-item" onClick={() => setOpenId(d.id)}>
                <div>
                  <div className="t">{d.version_count > 0 && <span className="vtag">V{d.version_count}</span>}{d.title}</div>
                  <div className="meta">
                    {d.assignee_name ? <span className="row" style={{ gap: 6 }}><Avatar name={d.assignee_name} size="sm" />{d.assignee_name}</span> : <span>Not assigned yet</span>}
                    {d.status !== 'approved' && <span className={isLate(d.due_date, d.status) && stage.status === 'open' ? 'late' : ''}>{dueText(d.due_date)}</span>}
                  </div>
                </div>
                {stage.status === 'locked' ? <span className="pill plain">Opens later</span> : <Pill map={DELIVERABLE_STATUS} value={d.status} />}
              </button>
            ))}
          </div>
        </section>

        <div className="stack" style={{ gap: 20 }}>
          <IntakeCard client={client} onChanged={onChanged} />
          <section className="panel">
            <div className="panel-head"><h2>Project</h2></div>
            <div className="panel-body kv">
              <div><span>Type</span><span>{project.name}</span></div>
              <div><span>Started</span><span>{formatDate(project.started_at, true)}</span></div>
              <div><span>Target</span><span>{formatDate(project.target_date, true)}</span></div>
              <div><span>Project manager</span><span>{project.owner_name ?? '—'}</span></div>
              <div><span>Approved</span><span className="tnum">{project.progress.done} of {project.progress.total} tasks</span></div>
            </div>
          </section>
        </div>
      </div>

      {openId && <DeliverablePanel id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
      {adding && <AddDeliverable stage={adding} onClose={() => setAdding(null)} onAdded={onChanged} />}
    </div>
  )
}

function IntakeCard({ client, onChanged }: { client: ClientDetail; onChanged: () => void }) {
  const toast = useToast()
  const { data, setData } = useApi<FormPayload>(`/clients/${client.id}/intake`)
  if (!data) return <section className="panel"><Loading /></section>
  const sub = data.submission

  async function share() {
    try {
      const next = await api<FormPayload>(`/clients/${client.id}/intake/share`, { method: 'POST' })
      setData(next); onChanged()
      toast.success((await copyText(next.submission.link)) ? 'Link copied. Send it to the client by email or WhatsApp.' : 'Marked as shared. Copy the link below.')
    } catch (e) { toast.error(e) }
  }

  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Intake form</h2><p>{data.template.name}</p></div><Pill map={FORM_STATUS} value={sub.status} /></div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        <div className="between" style={{ fontSize: 13.5 }}><span className="muted">{sub.filled} of {sub.total} answered</span><span className="muted">{sub.submitted_at ? `Submitted ${timeAgo(sub.submitted_at)}` : ''}</span></div>
        <Bar value={pct(sub.filled, sub.total)} />
        <div className="row wrap">
          {sub.status === 'not_sent'
            ? <Button variant="primary" size="sm" icon={<Send size={14} />} onClick={share}>Copy link to share</Button>
            : <Button size="sm" icon={<Copy size={14} />} onClick={async () => { if (await copyText(sub.link)) toast.success('Link copied') }}>Copy link</Button>}
          {sub.status !== 'submitted' && <EmailLinkButton clientId={client.id} what="form" onSent={() => { void api<FormPayload>(`/clients/${client.id}/intake`).then(setData); onChanged() }} />}
          <a className="btn btn-ghost btn-sm" href={sub.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview</a>
          <Link className="btn btn-ghost btn-sm" to={`/clients/${client.id}?view=onboarding`}>Answers</Link>
        </div>
      </div>
    </section>
  )
}

function AddDeliverable({ stage, onClose, onAdded }: { stage: Stage; onClose: () => void; onAdded: () => void }) {
  const toast = useToast()
  const { data: people } = useApi<User[]>('/users')
  const [f, setF] = useState({ title: '', brief: '', assignee_id: '' })
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add a task" sub={`To ${stage.name}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-d" loading={busy}>Add</Button></>}>
      <form id="add-d" className="stack" style={{ gap: 14 }} onSubmit={async e => {
        e.preventDefault(); setBusy(true)
        try { await api(`/stages/${stage.id}/deliverables`, { body: { ...f, assignee_id: f.assignee_id || null } }); toast.success('Task added'); onAdded(); onClose() }
        catch (x) { if (x instanceof ApiError && x.details) setErr(x.details); else toast.error(x) } finally { setBusy(false) }
      }}>
        <Field label="What is it?" required error={err.title}>{id => <input id={id} className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Packaging label" />}</Field>
        <Field label="Details">{id => <textarea id={id} className="textarea" value={f.brief} onChange={e => setF({ ...f, brief: e.target.value })} placeholder="What needs to be done" />}</Field>
        <Field label="Assigned to">{id => (
          <select id={id} className="select" value={f.assignee_id} onChange={e => setF({ ...f, assignee_id: e.target.value })}>
            <option value="">Nobody yet</option>
            {people?.map(p => <option key={p.id} value={p.id}>{p.name}{p.team_name ? ` · ${p.team_name}` : ''}</option>)}
          </select>
        )}</Field>
      </form>
    </Modal>
  )
}

// Intake answers ---------------------------------------------------------------------------------------

function IntakeView({ client, onChanged }: { client: ClientDetail; onChanged: () => void }) {
  const toast = useToast()
  const { data, loading, setData } = useApi<FormPayload>(`/clients/${client.id}/intake`)
  const [edits, setEdits] = useState<FormValues | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [fromDoc, setFromDoc] = useState<Set<number>>(new Set())
  const editing = edits !== null
  const values = useMemo(() => ({ ...(data?.values ?? {}), ...(edits ?? {}) }), [data, edits])

  /** Puts answers found in a document into edit mode, filling only empty questions. The team then checks and saves. */
  function fillFromDoc(found: Record<string, string>) {
    let filled = 0, kept = 0
    const next: FormValues = {}
    for (const [k, v] of Object.entries(found)) {
      const cur = values[k]
      if (typeof cur === 'string' && cur.trim() !== '') { if (cur.trim() !== v.trim()) kept++; continue }
      next[k] = v; filled++
    }
    if (filled) {
      setEdits(e => ({ ...(e ?? {}), ...next }))
      setFromDoc(s => new Set([...s, ...Object.keys(next).map(Number)]))
    }
    return { filled, kept }
  }

  if (loading || !data) return <Loading />
  const sub = data.submission

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 900 }}>
      <IntakeCard client={client} onChanged={onChanged} />
      <ClientDocuments clientId={client.id} onChanged={onChanged} />
      <h2 style={{ fontSize: 20, marginTop: 8 }}>Intake answers</h2>
      <div className="between wrap">
        <div className="row wrap" style={{ gap: 12 }}>
          <Pill map={FORM_STATUS} value={sub.status} />
          <span className="muted">{sub.filled} of {sub.total} answered{sub.submitted_at ? ` · submitted ${formatDateTime(sub.submitted_at)}` : ''}</span>
        </div>
        <div className="row wrap">
          <DocAutofill variant="button" endpoint={`/forms/${sub.id}/autofill`} onFound={fillFromDoc} />
          {sub.status === 'submitted' && !editing && <Button size="sm" icon={<Undo2 size={14} />} onClick={async () => {
            try { setData(await api<FormPayload>(`/forms/${sub.id}/reopen`, { method: 'POST' })); onChanged(); toast.success('The client can edit their answers again') } catch (e) { toast.error(e) }
          }}>Let the client edit again</Button>}
          {!editing ? <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEdits({})}>Edit answers</Button> : <>
            <Button size="sm" variant="ghost" onClick={() => { setEdits(null); setErrors({}); setFromDoc(new Set()) }}>Cancel</Button>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={busy} onClick={async () => {
              setBusy(true); setErrors({})
              const body: Record<string, string> = {}
              for (const [k, v] of Object.entries(edits ?? {})) if (typeof v === 'string') body[k] = v
              try { setData(await api<FormPayload>(`/forms/${sub.id}`, { method: 'PUT', body: { values: body } })); setEdits(null); setFromDoc(new Set()); toast.success('Answers saved') }
              catch (e) { if (e instanceof ApiError && e.details) setErrors(e.details); toast.error(e) } finally { setBusy(false) }
            }}>Save</Button>
          </>}
        </div>
      </div>
      <Note>Passwords are stored encrypted. Only signed-in team members can see them here.</Note>
      {fromDoc.size > 0 && editing && <Note>Answers marked “From document” were filled from the uploaded document. Check them, then click Save.</Note>}
      <FormRenderer payload={data} values={values} errors={errors} audience="team" readOnly={!editing} fromDoc={editing ? fromDoc : undefined}
        onChange={(fid, v) => { setEdits(e => ({ ...(e ?? {}), [fid]: v })); setFromDoc(s => { if (!s.has(fid)) return s; const n = new Set(s); n.delete(fid); return n }) }}
        onUpload={async (field, file) => {
          const form = new FormData(); form.append('file', file)
          try { const meta = await api(`/forms/${sub.id}/files/${field.id}`, { form }); setData({ ...data, values: { ...data.values, [field.id]: meta as never } }); toast.success('File uploaded') } catch (e) { toast.error(e) }
        }}
        onDownload={(field, f) => void downloadFile(`/forms/${sub.id}/files/${field.id}`, f.name).catch(e => toast.error(e))} />
    </div>
  )
}

// History -------------------------------------------------------------------------------------------------

function HistoryView({ clientId }: { clientId: number }) {
  const { data } = useApi<ClientDetail['activity']>(`/activity?client_id=${clientId}`)
  if (!data) return <Loading />
  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      <div className="panel-body feed" style={{ paddingTop: 20 }}>
        {data.length === 0 && <p className="muted">Nothing has happened yet.</p>}
        {data.map(a => (
          <div key={a.id} className="feed-item">
            <div><b style={{ fontWeight: 600 }}>{a.user_name ?? 'Client'}</b> <span className="soft">{a.message.charAt(0).toLowerCase() + a.message.slice(1)}</span>
              <div className="when">{formatDateTime(a.created_at)}</div></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function EditClient({ client, onClose, onSaved }: { client: ClientDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const def = CLIENT_TYPES[client.brand_type]
  const [f, setF] = useState({
    name: client.name, contact_name: client.contact_name ?? '', email: client.email ?? '', phone: client.phone ?? '',
    website: client.website ?? '', industry: client.industry ?? '', logo_url: client.logo_url ?? '',
  })
  const [profile, setProfile] = useState<Record<string, string>>({ ...client.profile })
  const [err, setErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <Modal title="Client details" sub={def.label} onClose={onClose} size="lg" footer={<>
        {isAdmin && <Button variant="ghost" icon={<Trash2 size={14} />} style={{ marginRight: 'auto', color: 'var(--change)' }} onClick={() => setConfirm(true)}>Delete client</Button>}
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="edit-c" loading={busy}>Save changes</Button>
      </>}>
        <form id="edit-c" className="stack" style={{ gap: 20 }} onSubmit={async e => {
          e.preventDefault(); setBusy(true)
          try { await api(`/clients/${client.id}`, { method: 'PATCH', body: { ...f, profile } }); toast.success('Saved'); onSaved(); onClose() }
          catch (x) { if (x instanceof ApiError && x.details) setErr(x.details); else toast.error(x) } finally { setBusy(false) }
        }}>
          <div className="section-rule"><span>Contact</span></div>
          <div className="form-2col">
            <Field label={client.brand_type === 'ecommerce' ? 'Brand name' : 'Business name'} required error={err.name}>{id => <input id={id} className="input" value={f.name} onChange={set('name')} />}</Field>
            <Field label="Industry">{id => <input id={id} className="input" value={f.industry} onChange={set('industry')} placeholder={def.industryHint} />}</Field>
            <Field label="Main contact">{id => <input id={id} className="input" value={f.contact_name} onChange={set('contact_name')} />}</Field>
            <Field label="Phone">{id => <input id={id} className="input" value={f.phone} onChange={set('phone')} />}</Field>
            <Field label="Email" error={err.email}>{id => <input id={id} type="email" className="input" value={f.email} onChange={set('email')} />}</Field>
            <Field label="Website">{id => <input id={id} className="input" value={f.website} onChange={set('website')} placeholder="https://" />}</Field>
          </div>
          <Field label="Logo" error={err.logo_url} help="Paste a link to the logo image (https://…).">
            {id => <div className="row"><input id={id} className="input grow" value={f.logo_url} onChange={set('logo_url')} placeholder="https://…/logo.png" />{f.logo_url && <img src={f.logo_url} alt="" className="brand-logo sm" />}</div>}
          </Field>
          <div className="section-rule"><span>{def.label} details</span></div>
          <ProfileFields fields={def.fields} values={profile} onChange={(k, v) => setProfile(p => ({ ...p, [k]: v }))} />
        </form>
      </Modal>
      {confirm && <Confirm title={`Delete ${client.name}?`} message="Their project, every version and file, and the onboarding answers will be deleted. This can't be undone."
        onClose={() => setConfirm(false)} onConfirm={async () => {
          try { await api(`/clients/${client.id}`, { method: 'DELETE' }); toast.success('Client deleted'); navigate('/clients') } catch (e) { toast.error(e); throw e }
        }} />}
    </>
  )
}
