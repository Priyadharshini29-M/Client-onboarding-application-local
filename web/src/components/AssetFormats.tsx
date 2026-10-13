import { useMemo, useRef, useState } from 'react'
import {
  CalendarDays, CheckCircle2, ChevronDown, ExternalLink, FileText, GripVertical, ListChecks, Pencil, Plus, Power, RotateCcw, Trash2,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { ASSET_KIND, ENTRY_STATUS, FIELD_TYPE, formatDate, timeAgo } from '../lib/format'
import type { AssetEntry, AssetField, AssetFieldType, AssetFormat, AssetKind, ClientRow, EntryValues } from '../lib/types'
import { Button, Confirm, Drawer, Empty, Field, IconButton, Loading, Modal, Note, Pill } from './ui'
import { useToast } from './toast'
import { ReworkEditor, ReworkList, reworkNote } from './Rework'

export function KindIcon({ kind, size = 16 }: { kind: AssetKind; size?: number }) {
  const Icon = kind === 'calendar' ? CalendarDays : kind === 'checklist' ? ListChecks : FileText
  return <Icon size={size} aria-hidden="true" />
}

const errText = (e: unknown) => e instanceof ApiError && e.details ? Object.values(e.details)[0] : e

// ============================================================================ one format

/** Right-hand side of the Assets page for one format: what has been filled in, and the fields it asks for. */
export function FormatDetail({ id, onChanged, onDeleted }: { id: number; onChanged: () => void; onDeleted: () => void }) {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const { data: format, setData, reload } = useApi<AssetFormat>(`/asset-formats/${id}`)
  const [tab, setTab] = useState<'filled' | 'fields'>('filled')
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (!format || format.id !== id) return <Loading />
  const changed = (f: AssetFormat) => { setData(f); onChanged() }

  return (
    <div className="af-detail">
      <div className="af-head">
        <span className="af-ico"><KindIcon kind={format.kind} size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2>{format.name}{!format.is_active && <span className="pill" style={{ marginLeft: 10, verticalAlign: 'middle' }}>Turned off</span>}</h2>
          <p className="muted">{ASSET_KIND[format.kind].label} · {format.fields.length} {format.fields.length === 1 ? 'field' : 'fields'}</p>
        </div>
        {isAdmin && (
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
            <IconButton label={format.is_active ? 'Turn off' : 'Turn on'} className="line" onClick={async () => {
              try { changed(await api<AssetFormat>(`/asset-formats/${id}`, { method: 'PATCH', body: { is_active: !format.is_active } })); toast.success(format.is_active ? 'Format turned off' : 'Format turned on') }
              catch (e) { toast.error(e) }
            }}><Power size={15} /></IconButton>
            <IconButton label="Delete format" className="line danger" onClick={() => setRemoving(true)}><Trash2 size={15} /></IconButton>
          </div>
        )}
      </div>
      {format.description && <p className="af-desc">{format.description}</p>}

      <div className="seg af-seg" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === 'filled'} className={tab === 'filled' ? 'on' : ''} onClick={() => setTab('filled')}>Filled <span className="muted">{format.entry_count}</span></button>
        <button role="tab" aria-selected={tab === 'fields'} className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>Fields <span className="muted">{format.fields.length}</span></button>
      </div>

      {tab === 'filled'
        ? <EntryList format={format} onChanged={() => { void reload(); onChanged() }} />
        : <FieldsTable format={format} onChanged={changed} />}

      {editing && <FormatModal format={format} onClose={() => setEditing(false)} onSaved={f => { changed(f as AssetFormat); setEditing(false) }} />}
      {removing && <Confirm title={`Delete ${format.name}?`}
        message={format.entry_count ? `It has been filled in ${format.entry_count} times, so it can't be deleted. Turn it off instead.` : 'The format and its fields will be deleted.'}
        onClose={() => setRemoving(false)}
        onConfirm={async () => { try { await api(`/asset-formats/${id}`, { method: 'DELETE' }); toast.success('Format deleted'); onDeleted() } catch (e) { toast.error(e); throw e } }} />}
    </div>
  )
}

// ============================================================================ fields

function FieldsTable({ format, onChanged }: { format: AssetFormat; onChanged: (f: AssetFormat) => void }) {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [edit, setEdit] = useState<AssetField | 'new' | null>(null)
  const [removing, setRemoving] = useState<AssetField | null>(null)
  const drag = useRef<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  async function drop(targetId: number) {
    const from = drag.current
    drag.current = null; setOver(null)
    if (!from || from === targetId) return
    const ids = format.fields.map(f => f.id).filter(x => x !== from)
    ids.splice(ids.indexOf(targetId), 0, from)
    onChanged({ ...format, fields: ids.map(x => format.fields.find(f => f.id === x)!) })
    try { onChanged(await api<AssetFormat>(`/asset-formats/${format.id}/fields/order`, { body: { ids } })) } catch (e) { toast.error(e) }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Fields</h2><p>{format.kind === 'calendar' ? 'The columns of each row.' : format.kind === 'checklist' ? 'The items to tick off.' : 'The questions the team answers.'}</p></div>
        {isAdmin && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEdit('new')}>Add field</Button>}
      </div>
      {!format.fields.length ? <Empty title="No fields yet">{isAdmin ? 'Add the first field.' : 'An admin needs to add fields.'}</Empty> : (
        <div className="af-table" role="table">
          <div className="af-tr af-th" role="row">
            <span>#</span><span>Label</span><span>Key</span><span>Type</span><span>Required</span><span />
          </div>
          {format.fields.map((f, i) => (
            <div key={f.id} role="row" className={`af-tr ${over === f.id ? 'drop' : ''}`}
              draggable={isAdmin}
              onDragStart={e => { drag.current = f.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { drag.current = null; setOver(null) }}
              onDragOver={e => { if (drag.current && drag.current !== f.id) { e.preventDefault(); setOver(f.id) } }}
              onDrop={e => { e.preventDefault(); void drop(f.id) }}>
              <span className="af-num">{isAdmin && <GripVertical size={14} className="af-grip" />}{i + 1}</span>
              <span className="af-label"><b>{f.label}</b>{f.placeholder && <small>{f.placeholder}</small>}</span>
              <span className="af-key mono">{f.field_key}</span>
              <span className="af-type"><span className="tag-box">{FIELD_TYPE[f.type]}</span>{f.options.length > 0 && <small>{f.options.join(', ')}</small>}</span>
              <span className="af-req">{f.required ? <span className="pill review">Yes</span> : <span className="muted">No</span>}</span>
              <span className="af-act">
                {isAdmin && <>
                  <IconButton label={`Edit ${f.label}`} onClick={() => setEdit(f)}><Pencil size={15} /></IconButton>
                  <IconButton label={`Delete ${f.label}`} className="danger" onClick={() => setRemoving(f)}><Trash2 size={15} /></IconButton>
                </>}
              </span>
            </div>
          ))}
        </div>
      )}
      {edit && <FieldModal format={format} field={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={f => { onChanged(f); setEdit(null) }} />}
      {removing && <Confirm title={`Delete ${removing.label}?`} message="Answers already saved for this field stay in old entries but won't show any more."
        onClose={() => setRemoving(null)}
        onConfirm={async () => { try { onChanged(await api<AssetFormat>(`/asset-fields/${removing.id}`, { method: 'DELETE' })); toast.success('Field deleted') } catch (e) { toast.error(e); throw e } }} />}
    </section>
  )
}

function FieldModal({ format, field, onClose, onSaved }: { format: AssetFormat; field: AssetField | null; onClose: () => void; onSaved: (f: AssetFormat) => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(field?.label ?? '')
  const [type, setType] = useState<AssetFieldType>(field?.type ?? (format.kind === 'checklist' ? 'checkbox' : 'text'))
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '')
  const [options, setOptions] = useState((field?.options ?? []).join('\n'))
  const [required, setRequired] = useState(field?.required ?? false)
  const [key, setKey] = useState(field?.field_key ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true); setErrors({})
    const body = {
      label, type, placeholder: type === 'checkbox' ? null : placeholder,
      options: type === 'select' ? options.split('\n').map(o => o.trim()).filter(Boolean) : [],
      required: type === 'checkbox' ? false : required, ...(key.trim() ? { field_key: key.trim() } : {}),
    }
    try {
      const f = field
        ? await api<AssetFormat>(`/asset-fields/${field.id}`, { method: 'PATCH', body })
        : await api<AssetFormat>(`/asset-formats/${format.id}/fields`, { body })
      toast.success(field ? 'Field saved' : 'Field added'); onSaved(f)
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details); else toast.error(e)
      setBusy(false)
    }
  }

  return (
    <Modal title={field ? 'Edit field' : 'Add a field'} sub={format.name} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={!label.trim()} onClick={save}>{field ? 'Save' : 'Add field'}</Button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Label" required error={errors.label}>{id => <input id={id} className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Shoot location" />}</Field>
        <div className="field">
          <label>Answer type</label>
          <div className="fb-type-grid">
            {Object.entries(FIELD_TYPE).map(([k, l]) => (
              <button key={k} type="button" className={`fb-type-opt ${type === k ? 'on' : ''}`} onClick={() => setType(k as AssetFieldType)}>{l}</button>
            ))}
          </div>
        </div>
        {type === 'select' && (
          <Field label="Choices" required error={errors.options} help="One per line">
            {id => <textarea id={id} className="textarea" rows={4} value={options} onChange={e => setOptions(e.target.value)} placeholder={'Only photos\nOnly videos\nBoth photos & videos'} />}
          </Field>
        )}
        {type !== 'checkbox' && type !== 'select' && (
          <Field label="Example answer" help="Shown faintly in the empty box">{id => <input id={id} className="input" value={placeholder} onChange={e => setPlaceholder(e.target.value)} />}</Field>
        )}
        {type !== 'checkbox' && (
          <label className="fb-switch">
            <span className="grow"><b>Required</b><small>Can't be saved without an answer</small></span>
            <button type="button" role="switch" aria-checked={required} className={`sw ${required ? 'on' : ''}`} onClick={() => setRequired(!required)} />
          </label>
        )}
        <Field label="Key" error={errors.field_key} help="Made from the label if you leave it empty. Used in exports.">
          {id => <input id={id} className="input mono" value={key} onChange={e => setKey(e.target.value)} placeholder="shoot_location" />}
        </Field>
      </div>
    </Modal>
  )
}

export function FormatModal({ format, onClose, onSaved }: { format?: AssetFormat; onClose: () => void; onSaved: (f: AssetFormat) => void }) {
  const toast = useToast()
  const [name, setName] = useState(format?.name ?? '')
  const [kind, setKind] = useState<AssetKind>(format?.kind ?? 'form')
  const [description, setDescription] = useState(format?.description ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const body = { name, kind, description }
      const f = format ? await api<AssetFormat>(`/asset-formats/${format.id}`, { method: 'PATCH', body }) : await api<AssetFormat>('/asset-formats', { body })
      toast.success(format ? 'Format saved' : 'Format created'); onSaved(f)
    } catch (e) { toast.error(errText(e)); setBusy(false) }
  }

  return (
    <Modal title={format ? 'Edit format' : 'New format'} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>{format ? 'Save' : 'Create format'}</Button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Name" required>{id => <input id={id} className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shoot Requirements" />}</Field>
        <div className="field">
          <label>Type</label>
          <div className="af-kinds">
            {(Object.keys(ASSET_KIND) as AssetKind[]).map(k => (
              <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                <KindIcon kind={k} size={18} /><b>{ASSET_KIND[k].label}</b><small>{ASSET_KIND[k].hint}</small>
              </button>
            ))}
          </div>
        </div>
        <Field label="Description" help="One line on when the team uses it">{id => <input id={id} className="input" value={description} onChange={e => setDescription(e.target.value)} />}</Field>
      </div>
    </Modal>
  )
}

// ============================================================================ filled entries

function summary(format: { kind: AssetKind; fields?: AssetField[] }, e: AssetEntry): string {
  if (Array.isArray(e.values)) return `${e.values.length} ${e.values.length === 1 ? 'row' : 'rows'}`
  const v = e.values
  if (format.kind === 'checklist') {
    const items = format.fields?.filter(f => f.type === 'checkbox') ?? []
    return `${items.filter(f => v[f.field_key]).length} of ${items.length} done`
  }
  const answered = Object.values(v).filter(x => x !== null && x !== '' && x !== false).length
  return format.fields ? `${answered} of ${format.fields.length} answered` : `${answered} answered`
}

/** Entries of one format (format given) or of one client across formats (clientId given). */
export function EntryList({ format, clientId, onChanged }: { format?: AssetFormat; clientId?: number; onChanged?: () => void }) {
  const [client, setClient] = useState('')
  const [status, setStatus] = useState('')
  const qs = new URLSearchParams()
  if (format) qs.set('format_id', String(format.id))
  if (clientId) qs.set('client_id', String(clientId)); else if (client) qs.set('client_id', client)
  if (status) qs.set('status', status)
  const { data: entries, reload } = useApi<AssetEntry[]>(`/asset-entries?${qs}`)
  const { data: clients } = useApi<{ clients: ClientRow[] }>(clientId ? null : '/clients')
  const { data: formats } = useApi<{ id: number; name: string; kind: AssetKind; is_active: number | boolean }[]>(format ? null : '/asset-formats')
  const [open, setOpen] = useState<number | 'new' | null>(null)
  const [newFormat, setNewFormat] = useState<number | null>(null)

  const done = () => { void reload(); onChanged?.() }

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>{format ? 'Filled for clients' : 'Filled formats'}</h2><p>{format ? `Every ${format.name} the team has filled in.` : 'Shoot briefs, calendars and checklists for this client.'}</p></div>
        {format ? (format.is_active && format.fields.length > 0 && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setOpen('new')}>Fill for a client</Button>)
          : (
            <select className="select sm" style={{ width: 220 }} value="" aria-label="Fill a format" onChange={e => { if (e.target.value) { setNewFormat(Number(e.target.value)); setOpen('new') } }}>
              <option value="">+ Fill a format…</option>
              {formats?.filter(f => f.is_active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
      </div>
      {!clientId && (
        <div className="row wrap" style={{ gap: 10, padding: '0 20px 14px' }}>
          <select className="select sm" style={{ width: 200 }} value={client} onChange={e => setClient(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select sm" style={{ width: 200 }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(ENTRY_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </div>
      )}
      {!entries ? <Loading /> : !entries.length ? (
        <Empty title="Nothing filled in yet">{format ? `Use “Fill for a client” to add the first ${format.name}.` : 'Pick a format above to fill one in.'}</Empty>
      ) : (
        <div className="rows">
          {entries.map(e => (
            <button key={e.id} className="row-item af-entry" onClick={() => setOpen(e.id)}>
              <span className="af-ico sm"><KindIcon kind={e.kind} size={15} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{e.title}</div>
                <div className="s">{format ? e.brand_name : e.format_name} · {summary({ kind: e.kind, fields: format?.fields }, e)} · {e.created_by_name ?? 'Someone'}, {timeAgo(e.updated_at)}</div>
              </div>
              <Pill map={ENTRY_STATUS} value={e.status} />
            </button>
          ))}
        </div>
      )}
      {open !== null && (
        <EntryDrawer
          formatId={format?.id ?? (open === 'new' ? newFormat! : entries?.find(x => x.id === open)?.format_id ?? 0)}
          entryId={open === 'new' ? null : open}
          clientId={clientId}
          onClose={() => { setOpen(null); setNewFormat(null) }}
          onSaved={() => done()}
        />
      )}
    </section>
  )
}

function emptyRow(fields: AssetField[]): EntryValues {
  return Object.fromEntries(fields.map(f => [f.field_key, f.type === 'checkbox' ? false : '']))
}

export function EntryDrawer({ formatId, entryId, clientId, onClose, onSaved }: {
  formatId: number; entryId: number | null; clientId?: number; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const { data: format } = useApi<AssetFormat>(`/asset-formats/${formatId}`)
  const { data: entry, setData: setEntry } = useApi<AssetEntry>(entryId ? `/asset-entries/${entryId}` : null)
  const { data: clients } = useApi<{ clients: ClientRow[] }>(clientId ? null : '/clients')
  const [draft, setDraft] = useState<{ title: string; client: string; values: EntryValues | EntryValues[] } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [points, setPoints] = useState<string[]>([''])
  const [reworking, setReworking] = useState(false)
  const [removing, setRemoving] = useState(false)

  const ready = format && (!entryId || entry)
  if (ready && !draft) {
    const values = entry ? entry.values : format.kind === 'calendar' ? [emptyRow(format.fields)] : emptyRow(format.fields)
    setDraft({ title: entry?.title ?? '', client: String(clientId ?? entry?.brand_id ?? ''), values })
  }
  const canReview = user?.role !== 'member'

  async function save() {
    if (!format || !draft) return
    setBusy(true); setErrors({})
    try {
      if (entry) {
        const saved = await api<AssetEntry>(`/asset-entries/${entry.id}`, { method: 'PATCH', body: { title: draft.title, values: draft.values } })
        setEntry(saved); toast.success(entry.status !== 'waiting' ? 'Saved and sent for approval again' : 'Saved')
      } else {
        await api<AssetEntry>(`/asset-formats/${format.id}/entries`, { body: { client_id: Number(draft.client), title: draft.title, values: draft.values } })
        toast.success('Saved. It is now waiting for approval.'); onClose()
      }
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.details) { setErrors(e.details); toast.error('Please fix the highlighted fields.') } else toast.error(e)
    } finally { setBusy(false) }
  }

  async function review(status: 'approved' | 'needs_changes') {
    if (!entry) return
    try {
      const saved = await api<AssetEntry>(`/asset-entries/${entry.id}/review`, { body: { status, note: status === 'needs_changes' ? reworkNote(points) : '' } })
      setEntry(saved); setPoints(['']); setReworking(false); toast.success(status === 'approved' ? 'Approved' : 'Sent back for rework'); onSaved()
    } catch (e) { toast.error(errText(e)) }
  }

  return (
    <Drawer onClose={onClose} head={
      <div className="stack" style={{ gap: 6 }}>
        <span className="label row" style={{ gap: 6 }}>{format && <KindIcon kind={format.kind} size={13} />}{format?.name ?? ''}</span>
        <h2 style={{ fontSize: 20 }}>{entry ? entry.title : `Fill in ${format?.name ?? ''}`}</h2>
        {entry && <div className="row wrap" style={{ gap: 8 }}><Pill map={ENTRY_STATUS} value={entry.status} /><span className="muted" style={{ fontSize: 13 }}>{entry.brand_name} · by {entry.created_by_name ?? 'someone'} · updated {timeAgo(entry.updated_at)}</span></div>}
      </div>
    }>
      {!ready || !draft ? <Loading /> : (
        <div className="stack" style={{ gap: 18 }}>
          {entry?.status === 'needs_changes' && entry.review_note && (
            <div className="rework-card">
              <b>Rework needed · {entry.reviewed_by_name ?? 'the approver'} asked for:</b>
              <ReworkList note={entry.review_note} />
            </div>
          )}

          {!entry && !clientId && (
            <Field label="Client" required error={errors.client_id}>
              {id => <select id={id} className="select" value={draft.client} onChange={e => setDraft({ ...draft, client: e.target.value })}>
                <option value="">Choose a client</option>
                {clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
            </Field>
          )}
          <Field label="Title" help={entry ? undefined : 'Leave empty to use the format and client name'}>
            {id => <input id={id} className="input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. October product shoot" />}
          </Field>

          <EntryForm format={format} values={draft.values} errors={errors} onChange={values => setDraft({ ...draft, values })} />

          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="primary" loading={busy} disabled={!entry && !draft.client} onClick={save}>{entry ? 'Save changes' : 'Save and send for approval'}</Button>
            {entry && (isAdmin || entry.status !== 'approved') && <Button variant="ghost" className="danger-text" icon={<Trash2 size={14} />} onClick={() => setRemoving(true)}>Delete</Button>}
          </div>

          {entry && canReview && entry.status === 'waiting' && (!reworking ? (
            <div className="review-box">
              <b style={{ fontSize: 15.5 }}>Is this {format.name} good to go?</b>
              <div className="decide-btns">
                <Button variant="approve" icon={<CheckCircle2 size={14} />} onClick={() => review('approved')}>Approve</Button>
                <Button variant="change" icon={<RotateCcw size={14} />} onClick={() => setReworking(true)}>Ask for rework</Button>
              </div>
            </div>
          ) : (
            <div className="review-box rework">
              <b style={{ fontSize: 15.5 }}>What needs to change?</b>
              <ReworkEditor points={points} onChange={setPoints} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setReworking(false)}>Cancel</Button>
                <Button variant="change" icon={<RotateCcw size={14} />} disabled={!points.some(p => p.trim())} onClick={() => review('needs_changes')}>Send back</Button>
              </div>
            </div>
          ))}
          {entry?.status === 'approved' && <p className="muted" style={{ fontSize: 13 }}>Approved by {entry.reviewed_by_name ?? 'an approver'}. Saving changes sends it for approval again.</p>}
        </div>
      )}
      {removing && entry && <Confirm title={`Delete ${entry.title}?`} message="This can't be undone." onClose={() => setRemoving(false)}
        onConfirm={async () => { try { await api(`/asset-entries/${entry.id}`, { method: 'DELETE' }); toast.success('Deleted'); onSaved(); onClose() } catch (e) { toast.error(e); throw e } }} />}
    </Drawer>
  )
}

// ============================================================================ the inputs

function Input({ field, value, onChange, id }: { field: AssetField; value: unknown; onChange: (v: string | boolean) => void; id: string }) {
  const v = value === null || value === undefined ? '' : String(value)
  const ph = field.placeholder ?? ''
  switch (field.type) {
    case 'textarea': return <textarea id={id} className="textarea" rows={3} value={v} placeholder={ph} onChange={e => onChange(e.target.value)} />
    case 'number': return <input id={id} className="input" type="number" inputMode="decimal" value={v} placeholder={ph} onChange={e => onChange(e.target.value)} />
    case 'date': return <input id={id} className="input" type="date" value={v} onChange={e => onChange(e.target.value)} />
    case 'link': return (
      <div className="af-link">
        <input id={id} className="input" type="url" value={v} placeholder={ph || 'https://'} onChange={e => onChange(e.target.value)} />
        {/^https?:\/\//i.test(v) && <a href={v} target="_blank" rel="noreferrer" className="icon-btn" aria-label="Open link"><ExternalLink size={14} /></a>}
      </div>
    )
    case 'select': return (
      <select id={id} className="select" value={v} onChange={e => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
    case 'checkbox': return <label className="check"><input id={id} type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} /> Done</label>
    default: return <input id={id} className="input" value={v} placeholder={ph} onChange={e => onChange(e.target.value)} />
  }
}

function EntryForm({ format, values, errors, onChange }: {
  format: AssetFormat; values: EntryValues | EntryValues[]; errors: Record<string, string>; onChange: (v: EntryValues | EntryValues[]) => void
}) {
  const [openRow, setOpenRow] = useState<number | null>(0)
  const rows = useMemo(() => (Array.isArray(values) ? values : []), [values])

  if (!format.fields.length) return <Note>This format has no fields yet.</Note>

  if (format.kind === 'checklist' && !Array.isArray(values)) {
    const items = format.fields
    const done = items.filter(f => f.type === 'checkbox' && values[f.field_key]).length
    return (
      <div className="af-check">
        <div className="between"><span className="label">Checklist</span><span className="muted" style={{ fontSize: 13 }}>{done} of {items.filter(f => f.type === 'checkbox').length} done</span></div>
        {items.map(f => f.type === 'checkbox' ? (
          <label key={f.id} className={`af-check-item ${values[f.field_key] ? 'on' : ''}`}>
            <input type="checkbox" checked={Boolean(values[f.field_key])} onChange={e => onChange({ ...values, [f.field_key]: e.target.checked })} />
            <span>{f.label}</span>
          </label>
        ) : (
          <Field key={f.id} label={f.label} required={f.required} error={errors[f.field_key]}>
            {id => <Input id={id} field={f} value={values[f.field_key]} onChange={v => onChange({ ...values, [f.field_key]: v })} />}
          </Field>
        ))}
      </div>
    )
  }

  if (format.kind === 'calendar') {
    const rowErrors = Object.values(errors)
    const head = (r: EntryValues) => {
      const date = format.fields.find(f => f.type === 'date')
      const picks = format.fields.filter(f => f.type === 'select').slice(0, 2)
      const text = format.fields.find(f => f.type === 'text')
      return [date && r[date.field_key] ? formatDate(String(r[date.field_key])) : null, ...picks.map(p => r[p.field_key]), text ? r[text.field_key] : null]
        .filter(x => x !== null && x !== '' && x !== undefined).join(' · ') || 'New row'
    }
    const setRow = (i: number, r: EntryValues) => onChange(rows.map((x, j) => (j === i ? r : x)))
    return (
      <div className="stack" style={{ gap: 10 }}>
        {rowErrors.length > 0 && <Note tone="error">{rowErrors.slice(0, 4).map((m, i) => <div key={i}>{m}</div>)}</Note>}
        {rows.map((r, i) => (
          <div key={i} className={`af-row ${openRow === i ? 'open' : ''}`}>
            <button type="button" className="af-row-head" onClick={() => setOpenRow(openRow === i ? null : i)} aria-expanded={openRow === i}>
              <span className="mono muted">{String(i + 1).padStart(2, '0')}</span><span className="grow truncate">{head(r)}</span><ChevronDown size={16} className="caret" />
            </button>
            {openRow === i && (
              <div className="af-row-body">
                <div className="form-2col">
                  {format.fields.map(f => (
                    <div key={f.id} className={f.type === 'textarea' ? 'span-2' : ''}>
                      <Field label={f.label} required={f.required}>
                        {id => <Input id={id} field={f} value={r[f.field_key]} onChange={v => setRow(i, { ...r, [f.field_key]: v })} />}
                      </Field>
                    </div>
                  ))}
                </div>
                {rows.length > 1 && <Button size="sm" variant="ghost" className="danger-text" icon={<Trash2 size={14} />} onClick={() => { onChange(rows.filter((_, j) => j !== i)); setOpenRow(null) }}>Remove row</Button>}
              </div>
            )}
          </div>
        ))}
        <Button icon={<Plus size={14} />} onClick={() => { onChange([...rows, emptyRow(format.fields)]); setOpenRow(rows.length) }}>Add row</Button>
      </div>
    )
  }

  const v = Array.isArray(values) ? {} : values
  return (
    <div className="form-2col">
      {format.fields.map(f => (
        <div key={f.id} className={f.type === 'textarea' ? 'span-2' : ''}>
          <Field label={f.label} required={f.required} error={errors[f.field_key]}>
            {id => <Input id={id} field={f} value={v[f.field_key]} onChange={x => onChange({ ...v, [f.field_key]: x })} />}
          </Field>
        </div>
      ))}
    </div>
  )
}
