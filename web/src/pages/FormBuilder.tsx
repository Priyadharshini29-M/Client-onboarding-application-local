import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeft, Calendar, CheckCircle2, ChevronDown, ChevronUp, CircleDot, Copy, Eye, GripVertical, Hash, KeyRound, Link2, Mail,
  Paperclip, Pencil, Phone, Plus, Trash2, Type, X,
} from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { pad2 } from '../lib/format'
import type { FieldType, FormPayload, Template, TemplateField, TemplateSection, TemplateSummary } from '../lib/types'
import { FormRenderer } from '../components/FormRenderer'
import { Button, Confirm, Field, IconButton, Loading, Modal, PageHead } from '../components/ui'
import { useToast } from '../components/toast'
import { SettingsNav } from './Settings'

const TYPES: { value: FieldType; label: string; icon: typeof Type; hint: string }[] = [
  { value: 'text', label: 'Short answer', icon: Type, hint: 'A name, a number, one line' },
  { value: 'textarea', label: 'Paragraph', icon: AlignLeft, hint: 'Longer answers' },
  { value: 'select', label: 'Pick one', icon: CircleDot, hint: 'A list of choices' },
  { value: 'email', label: 'Email', icon: Mail, hint: 'Checked for a valid address' },
  { value: 'phone', label: 'Phone', icon: Phone, hint: 'Phone number' },
  { value: 'url', label: 'Link', icon: Link2, hint: 'Must start with https://' },
  { value: 'number', label: 'Number', icon: Hash, hint: 'Digits only' },
  { value: 'date', label: 'Date', icon: Calendar, hint: 'Date picker' },
  { value: 'file', label: 'File upload', icon: Paperclip, hint: 'PDF, image, Word, Excel…' },
  { value: 'secret', label: 'Password', icon: KeyRound, hint: 'Encrypted, hidden after saving' },
]
const typeOf = (t: FieldType) => TYPES.find(x => x.value === t) ?? TYPES[0]

type Selection = { kind: 'field'; id: number } | { kind: 'section'; id: number } | null

export function FormsSettings() {
  const toast = useToast()
  const { data: list, reload: reloadList } = useApi<TemplateSummary[]>('/templates')
  const [activeId, setActiveId] = useState<number | null>(null)
  const current = activeId ?? list?.[0]?.id ?? null
  const { data: tpl, setData: setTpl } = useApi<Template>(current ? `/templates/${current}` : null)
  const [sel, setSel] = useState<Selection>(null)
  const [preview, setPreview] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null)
  const [adding, setAdding] = useState<number | null>(null)
  const drag = useRef<{ fieldId: number; fromSection: number } | null>(null)
  const [dropAt, setDropAt] = useState<string | null>(null)

  useEffect(() => { setSel(null); setPreview(false) }, [current])

  const call = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    try {
      const next = await api<Template>(path, { method, body })
      setTpl(next)
      void reloadList()
      return next
    } catch (e) {
      toast.error(e instanceof ApiError && e.details ? Object.values(e.details)[0] : e)
      throw e
    }
  }

  const fields = useMemo(() => tpl?.sections.flatMap(s => s.fields.map(f => ({ ...f, section: s }))) ?? [], [tpl])
  const selField = sel?.kind === 'field' ? fields.find(f => f.id === sel.id) : undefined
  const selSection = sel?.kind === 'section' ? tpl?.sections.find(s => s.id === sel.id) : undefined

  async function addQuestion(section: TemplateSection, type: FieldType) {
    setAdding(null)
    const before = new Set(fields.map(f => f.id))
    const next = await call(`/sections/${section.id}/fields`, 'POST', {
      label: 'Untitled question', type, required: false, placeholder: '', options: type === 'select' ? ['Option 1', 'Option 2'] : [],
    }).catch(() => null)
    const created = next?.sections.flatMap(s => s.fields).find(f => !before.has(f.id))
    if (created) {
      setSel({ kind: 'field', id: created.id })
      setTimeout(() => document.getElementById(`fb-q-${created.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    }
  }

  async function drop(target: TemplateSection, beforeId: number | null) {
    const d = drag.current
    drag.current = null
    setDropAt(null)
    if (!d) return
    const ids = target.fields.map(f => f.id).filter(id => id !== d.fieldId)
    const at = beforeId === null ? ids.length : Math.max(0, ids.indexOf(beforeId))
    ids.splice(at, 0, d.fieldId)
    await call(`/sections/${target.id}/order`, 'POST', { ids }).catch(() => {})
  }

  const previewPayload: FormPayload | null = tpl ? {
    submission: { id: 0, kind: 'intake', status: 'in_progress', submitted_at: null, updated_at: '', link: '', filled: 0, total: fields.length },
    brand: { id: 0, name: 'Your client' }, template: tpl, values: {}, secrets_set: {},
  } : null

  return (
    <div className="page" style={{ maxWidth: 1480 }}>
      <PageHead title="Settings" />
      <SettingsNav />

      <div className="fb-forms">
        {list?.map(t => (
          <button key={t.id} className={`fb-form-chip ${t.id === current ? 'on' : ''}`} onClick={() => setActiveId(t.id)}>
            <b>{t.name}</b><small>{t.field_count} questions · {t.brand_count} client{Number(t.brand_count) === 1 ? '' : 's'}</small>
          </button>
        ))}
        <button className="fb-form-chip add" onClick={() => setCreating(true)}><Plus size={16} /> New form</button>
      </div>

      {!tpl ? <Loading /> : (
        <>
          <div className="fb-head">
            <div className="grow">
              <input className="fb-title" defaultValue={tpl.name} key={`n${tpl.id}`} aria-label="Form name"
                onBlur={e => { if (e.target.value.trim() && e.target.value !== tpl.name) void call(`/templates/${tpl.id}`, 'PATCH', { name: e.target.value.trim() }) }} />
              <input className="fb-desc" defaultValue={tpl.description ?? ''} key={`d${tpl.id}`} placeholder="Add a short description, e.g. who this form is for" aria-label="Description"
                onBlur={e => { if (e.target.value !== (tpl.description ?? '')) void call(`/templates/${tpl.id}`, 'PATCH', { description: e.target.value }) }} />
            </div>
            <div className="row">
              <div className="seg">
                <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}><Pencil size={14} /> Build</button>
                <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}><Eye size={14} /> Preview as client</button>
              </div>
              <IconButton label="Duplicate form" onClick={async () => {
                try { const t = await api<Template>(`/templates/${tpl.id}/duplicate`, { method: 'POST' }); await reloadList(); setActiveId(t.id); toast.success('Copy created') } catch (e) { toast.error(e) }
              }}><Copy size={16} /></IconButton>
              <IconButton label="Delete form" className="danger" onClick={() => setConfirm({
                title: `Delete ${tpl.name}?`, message: 'Forms that clients have already started cannot be deleted.',
                run: async () => { await api(`/templates/${tpl.id}`, { method: 'DELETE' }); setActiveId(null); await reloadList(); toast.success('Form deleted') },
              })}><Trash2 size={16} /></IconButton>
            </div>
          </div>

          {preview && previewPayload ? (
            <div className="fb-preview">
              <div className="public-head" style={{ padding: '8px 0 20px' }}>
                <span className="label">Digifyce · {tpl.name}</span>
                <h1 style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-.03em', marginTop: 10 }}>Let's get your brand started.</h1>
                <p className="soft" style={{ marginTop: 8 }}>This is exactly what clients see. Answers here aren't saved.</p>
              </div>
              <div className="stack" style={{ gap: 18 }}>
                <FormRenderer payload={previewPayload} values={{}} audience="client" onChange={() => {}} onUpload={async () => {}} />
              </div>
            </div>
          ) : (
            <div className="fb">
              {/* Outline */}
              <aside className="fb-outline">
                <span className="label">Parts</span>
                {tpl.sections.map((s, i) => (
                  <button key={s.id} className={`fb-out-item ${sel?.kind === 'section' && sel.id === s.id ? 'on' : ''}`}
                    onClick={() => { setSel({ kind: 'section', id: s.id }); document.getElementById(`fb-s-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
                    <span className="mono muted">{pad2(i + 1)}</span><span className="grow truncate">{s.title}</span><span className="mono muted">{s.fields.length}</span>
                  </button>
                ))}
                <button className="fb-out-item add" onClick={async () => {
                  const next = await call(`/templates/${tpl.id}/sections`, 'POST', { title: `Part ${tpl.sections.length + 1}` }).catch(() => null)
                  const s = next?.sections[next.sections.length - 1]
                  if (s) { setSel({ kind: 'section', id: s.id }); setTimeout(() => document.getElementById(`fb-s-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }), 50) }
                }}><Plus size={14} /> Add a part</button>
                <div className="fb-stats">
                  <div><b>{fields.length}</b><span>questions</span></div>
                  <div><b>{fields.filter(f => f.required).length}</b><span>required</span></div>
                  <div><b>{fields.filter(f => f.type === 'secret').length}</b><span>encrypted</span></div>
                </div>
              </aside>

              {/* Canvas */}
              <div className="fb-canvas">
                {tpl.sections.map((s, i) => (
                  <section key={s.id} id={`fb-s-${s.id}`} className={`fb-part ${sel?.kind === 'section' && sel.id === s.id ? 'on' : ''}`}
                    onDragOver={e => { if (drag.current) { e.preventDefault(); if (!s.fields.length) setDropAt(`end-${s.id}`) } }}
                    onDrop={e => { e.preventDefault(); if (!s.fields.length) void drop(s, null) }}>
                    <button className="fb-part-head" onClick={() => setSel({ kind: 'section', id: s.id })}>
                      <span className="mono">{pad2(i + 1)}</span><h3>{s.title}</h3><span className="muted" style={{ fontSize: 13 }}>{s.fields.length} question{s.fields.length === 1 ? '' : 's'}</span>
                    </button>
                    <div className="fb-qs">
                      {s.fields.map(f => {
                        const T = typeOf(f.type)
                        const on = sel?.kind === 'field' && sel.id === f.id
                        return (
                          <div key={f.id} id={`fb-q-${f.id}`}
                            className={`fb-q ${on ? 'on' : ''} ${dropAt === `q-${f.id}` ? 'drop' : ''}`}
                            draggable
                            onDragStart={e => { drag.current = { fieldId: f.id, fromSection: s.id }; e.dataTransfer.effectAllowed = 'move' }}
                            onDragEnd={() => { drag.current = null; setDropAt(null) }}
                            onDragOver={e => { if (drag.current && drag.current.fieldId !== f.id) { e.preventDefault(); e.stopPropagation(); setDropAt(`q-${f.id}`) } }}
                            onDrop={e => { e.preventDefault(); e.stopPropagation(); void drop(s, f.id) }}
                            onClick={() => setSel({ kind: 'field', id: f.id })}
                            role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSel({ kind: 'field', id: f.id }) }}>
                            <span className="fb-grip" aria-hidden="true"><GripVertical size={16} /></span>
                            <div className="fb-q-main">
                              <div className="fb-q-top">
                                <div className="fb-q-label">{f.label}{f.required && <span className="req"> *</span>}</div>
                                <span className="fb-type"><T.icon size={13} />{T.label}</span>
                              </div>
                              <MockInput field={f} />
                            </div>
                          </div>
                        )
                      })}
                      <div className={`fb-add ${dropAt === `end-${s.id}` ? 'drop' : ''}`}
                        onDragOver={e => { if (drag.current) { e.preventDefault(); e.stopPropagation(); setDropAt(`end-${s.id}`) } }}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); void drop(s, null) }}>
                        {adding === s.id ? (
                          <div className="fb-types">
                            {TYPES.map(t => (
                              <button key={t.value} className="fb-type-tile" onClick={() => void addQuestion(s, t.value)}>
                                <t.icon size={18} /><b>{t.label}</b><small>{t.hint}</small>
                              </button>
                            ))}
                            <IconButton label="Cancel" onClick={() => setAdding(null)}><X size={16} /></IconButton>
                          </div>
                        ) : (
                          <button className="fb-add-btn" onClick={() => setAdding(s.id)}><Plus size={16} /> Add a question</button>
                        )}
                      </div>
                    </div>
                  </section>
                ))}
              </div>

              {/* Inspector */}
              <aside className="fb-inspector">
                {selField ? (
                  <QuestionInspector key={selField.id} field={selField} sections={tpl.sections}
                    onPatch={body => call(`/fields/${selField.id}`, 'PATCH', body).then(() => {}, () => {})}
                    onMove={async (sectionId) => {
                      const target = tpl.sections.find(s => s.id === sectionId)
                      if (target) await call(`/sections/${sectionId}/order`, 'POST', { ids: [...target.fields.map(f => f.id), selField.id] }).catch(() => {})
                    }}
                    onDuplicate={async () => {
                      await call(`/sections/${selField.section_id}/fields`, 'POST', {
                        label: `${selField.label} (copy)`, type: selField.type, placeholder: selField.placeholder ?? '', required: selField.required, options: selField.options,
                      }).catch(() => {})
                    }}
                    onDelete={() => setConfirm({
                      title: 'Delete this question?', message: `"${selField.label}" and any answers to it will be removed.`,
                      run: async () => { await call(`/fields/${selField.id}`, 'DELETE'); setSel(null) },
                    })} />
                ) : selSection ? (
                  <PartInspector key={selSection.id} section={selSection} index={tpl.sections.findIndex(s => s.id === selSection.id)} total={tpl.sections.length}
                    onRename={title => call(`/sections/${selSection.id}`, 'PATCH', { title }).then(() => {}, () => {})}
                    onMove={dir => call(`/sections/${selSection.id}/move`, 'POST', { direction: dir }).then(() => {}, () => {})}
                    onDelete={() => setConfirm({
                      title: `Delete "${selSection.title}"?`, message: `${selSection.fields.length} questions and their answers will be removed.`,
                      run: async () => { await call(`/sections/${selSection.id}`, 'DELETE'); setSel(null) },
                    })} />
                ) : (
                  <div className="fb-empty">
                    <CheckCircle2 size={22} />
                    <b>Select a question to edit it</b>
                    <p>Click any question or part. Drag the ⋮⋮ handle to reorder, even into another part. Changes save as you type.</p>
                  </div>
                )}
              </aside>
            </div>
          )}
        </>
      )}

      {creating && <NewForm onClose={() => setCreating(false)} onCreated={async t => { await reloadList(); setActiveId(t.id) }} />}
      {confirm && <Confirm title={confirm.title} message={confirm.message} onClose={() => setConfirm(null)}
        onConfirm={async () => { try { await confirm.run() } catch (e) { toast.error(e); throw e } }} />}
    </div>
  )
}

/** A faint, non-interactive version of the answer box, so the canvas reads like the real form. */
function MockInput({ field }: { field: TemplateField }) {
  const ph = field.placeholder || ''
  switch (field.type) {
    case 'textarea': return <div className="fb-mock tall">{ph}</div>
    case 'select': return <div className="fb-chips">{field.options.map(o => <span key={o} className="fb-chip">{o}</span>)}{!field.options.length && <span className="muted">No choices yet</span>}</div>
    case 'file': return <div className="fb-mock dashed"><Paperclip size={13} /> Client uploads a file</div>
    case 'secret': return <div className="fb-mock">•••••••• <KeyRound size={12} style={{ marginLeft: 'auto' }} /></div>
    case 'date': return <div className="fb-mock">dd-mm-yyyy <Calendar size={12} style={{ marginLeft: 'auto' }} /></div>
    default: return <div className="fb-mock">{ph}</div>
  }
}

function QuestionInspector({ field, sections, onPatch, onMove, onDuplicate, onDelete }: {
  field: TemplateField & { section: TemplateSection }; sections: TemplateSection[]
  onPatch: (body: Record<string, unknown>) => Promise<void>; onMove: (sectionId: number) => Promise<void>
  onDuplicate: () => Promise<void>; onDelete: () => void
}) {
  const [label, setLabel] = useState(field.label)
  const [hint, setHint] = useState(field.placeholder ?? '')
  const [options, setOptions] = useState<string[]>(field.options.length ? field.options : ['Option 1'])
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<number | undefined>(undefined)

  const save = (body: Record<string, unknown>, delay = 0) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setSaved('saving')
      await onPatch(body)
      setSaved('saved')
    }, delay)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const T = typeOf(field.type)
  const setOpts = (next: string[]) => { setOptions(next); const clean = next.map(o => o.trim()).filter(Boolean); if (clean.length) save({ options: clean }, 600) }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="between">
        <span className="label">Question · {field.section.title}</span>
        <span className="muted" style={{ fontSize: 12 }}>{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
      </div>

      <Field label="Question">
        {id => <textarea id={id} className="textarea" style={{ minHeight: 70 }} value={label}
          onChange={e => { setLabel(e.target.value); if (e.target.value.trim()) save({ label: e.target.value.trim() }, 600) }} />}
      </Field>

      <div className="field">
        <label>Answer type</label>
        <div className="fb-type-grid">
          {TYPES.map(t => (
            <button key={t.value} type="button" className={`fb-type-opt ${t.value === field.type ? 'on' : ''}`} title={t.hint}
              onClick={() => save(t.value === 'select' ? { type: t.value, options: options.filter(Boolean).length ? options.filter(Boolean) : ['Option 1', 'Option 2'] } : { type: t.value })}>
              <t.icon size={16} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        <span className="help">{T.hint}</span>
      </div>

      {field.type === 'select' ? (
        <div className="field">
          <label>Choices</label>
          <div className="stack" style={{ gap: 6 }}>
            {options.map((o, i) => (
              <div key={i} className="row">
                <CircleDot size={14} className="muted" />
                <input className="input sm grow" value={o} aria-label={`Choice ${i + 1}`} onChange={e => setOpts(options.map((x, j) => j === i ? e.target.value : x))} />
                <IconButton label="Remove choice" disabled={options.length <= 1} onClick={() => setOpts(options.filter((_, j) => j !== i))}><X size={14} /></IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setOptions([...options, `Option ${options.length + 1}`])} style={{ justifySelf: 'start' }}>Add a choice</Button>
          </div>
        </div>
      ) : field.type !== 'file' && (
        <Field label="Example answer" help="Shown faintly in the empty box to guide the client.">
          {id => <input id={id} className="input" value={hint} onChange={e => { setHint(e.target.value); save({ placeholder: e.target.value }, 600) }} />}
        </Field>
      )}

      <label className="fb-switch">
        <span className="grow"><b>Required</b><small>The client can't send the form without answering</small></span>
        <button type="button" role="switch" aria-checked={field.required} className={`sw ${field.required ? 'on' : ''}`} onClick={() => save({ required: !field.required })} />
      </label>

      {sections.length > 1 && (
        <Field label="Move to part">
          {id => (
            <select id={id} className="select sm" value={field.section_id} onChange={e => void onMove(Number(e.target.value))}>
              {sections.map((s, i) => <option key={s.id} value={s.id}>{pad2(i + 1)} · {s.title}</option>)}
            </select>
          )}
        </Field>
      )}

      <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <Button size="sm" icon={<Copy size={14} />} onClick={() => void onDuplicate()}>Duplicate</Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} style={{ color: 'var(--change)', marginLeft: 'auto' }} onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}

function PartInspector({ section, index, total, onRename, onMove, onDelete }: {
  section: TemplateSection; index: number; total: number
  onRename: (t: string) => Promise<void>; onMove: (d: 'up' | 'down') => Promise<void>; onDelete: () => void
}) {
  const [title, setTitle] = useState(section.title)
  return (
    <div className="stack" style={{ gap: 18 }}>
      <span className="label">Part {pad2(index + 1)} of {pad2(total)}</span>
      <Field label="Title" help="Clients see this as a heading and in the jump links at the top.">
        {id => <input id={id} className="input" value={title} onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== section.title) void onRename(title.trim()) }} />}
      </Field>
      <div className="kv">
        <div><span>Questions</span><span>{section.fields.length}</span></div>
        <div><span>Required</span><span>{section.fields.filter(f => f.required).length}</span></div>
      </div>
      <div className="row">
        <Button size="sm" icon={<ChevronUp size={14} />} disabled={index === 0} onClick={() => void onMove('up')}>Move up</Button>
        <Button size="sm" icon={<ChevronDown size={14} />} disabled={index === total - 1} onClick={() => void onMove('down')}>Move down</Button>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} style={{ color: 'var(--change)' }} onClick={onDelete}>Delete this part</Button>
      </div>
    </div>
  )
}

function NewForm({ onClose, onCreated }: { onClose: () => void; onCreated: (t: Template) => Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="New intake form" sub="You'll add questions on the canvas next." onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="nf" loading={busy} disabled={!name.trim()}>Create form</Button></>}>
      <form id="nf" className="stack" style={{ gap: 14 }} onSubmit={async e => {
        e.preventDefault(); setBusy(true)
        try { const t = await api<Template>('/templates', { body: { name, description, category: 'general' } }); await onCreated(t); onClose() }
        catch (x) { toast.error(x) } finally { setBusy(false) }
      }}>
        <Field label="Name" required>{id => <input id={id} className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Restaurant questionnaire" />}</Field>
        <Field label="Who is it for?">{id => <input id={id} className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Cafés and cloud kitchens" />}</Field>
      </form>
    </Modal>
  )
}
