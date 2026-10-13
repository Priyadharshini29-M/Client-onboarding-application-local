import { useRef, useState } from 'react'
import { Download, Eye, EyeOff, Lock, Paperclip, FileText, Upload } from 'lucide-react'
import { formatBytes, pad2 } from '../lib/format'
import type { FileValue, FormPayload, TemplateField } from '../lib/types'
import { Button } from './ui'

export type FormValues = Record<string, string | FileValue | null>

interface Props {
  payload: FormPayload
  values: FormValues
  onChange: (fieldId: number, value: string) => void
  errors?: Record<string, string>
  readOnly?: boolean
  audience: 'client' | 'team'
  onUpload: (field: TemplateField, file: File) => Promise<void>
  onDownload?: (field: TemplateField, file: FileValue) => void
  /** Answers filled from a document that nobody has checked or changed yet. */
  fromDoc?: ReadonlySet<number>
}

export function FormRenderer({ payload, values, onChange, errors = {}, readOnly, audience, onUpload, onDownload, fromDoc }: Props) {
  return (
    <>
      {payload.template.sections.map((section, i) => (
        <section key={section.id} id={`part-${section.id}`} className="form-card">
          <h3><span className="mono">{pad2(i + 1)}</span>{section.title}</h3>
          <div className="form-grid">
            {section.fields.map(field => (
              <div key={field.id} className={field.type === 'textarea' || field.type === 'file' || field.label.length > 46 ? 'full' : ''}>
                <Question field={field} value={values[field.id] ?? null} secretSaved={!!payload.secrets_set[field.id]}
                  error={errors[field.id]} readOnly={readOnly} audience={audience} fromDoc={!!fromDoc?.has(field.id)}
                  onChange={v => onChange(field.id, v)} onUpload={f => onUpload(field, f)}
                  onDownload={onDownload ? f => onDownload(field, f) : undefined} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function Question({ field, value, secretSaved, error, readOnly, audience, fromDoc, onChange, onUpload, onDownload }: {
  field: TemplateField; value: string | FileValue | null; secretSaved: boolean; error?: string; readOnly?: boolean; fromDoc?: boolean
  audience: 'client' | 'team'; onChange: (v: string) => void; onUpload: (f: File) => Promise<void>; onDownload?: (f: FileValue) => void
}) {
  const id = `q-${field.id}`
  const text = typeof value === 'string' ? value : ''
  const bad = error ? 'invalid' : ''
  const [show, setShow] = useState(false)
  const [uploading, setUploading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  let control
  if (field.type === 'textarea') {
    control = <textarea id={id} className={`textarea ${bad}`} placeholder={field.placeholder ?? ''} value={text} disabled={readOnly} onChange={e => onChange(e.target.value)} />
  } else if (field.type === 'select') {
    control = (
      <select id={id} className={`select ${bad}`} value={text} disabled={readOnly} onChange={e => onChange(e.target.value)}>
        <option value="">Choose one</option>
        {field.options.map(o => <option key={o}>{o}</option>)}
      </select>
    )
  } else if (field.type === 'secret') {
    const ph = audience === 'client' && secretSaved ? 'Saved safely. Type to replace it.' : field.placeholder ?? ''
    control = (
      <div style={{ position: 'relative' }}>
        <input id={id} className={`input ${bad}`} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={ph}
          value={text} disabled={readOnly} onChange={e => onChange(e.target.value)} style={{ paddingRight: 44 }} />
        <button type="button" className="icon-btn" style={{ position: 'absolute', right: 4, top: 4 }} aria-label={show ? 'Hide' : 'Show'} onClick={() => setShow(!show)}>
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    )
  } else if (field.type === 'file') {
    const f = value && typeof value === 'object' ? value : null
    control = (
      <div className="filebox">
        <Paperclip size={16} className="muted" />
        <div className="grow">
          {f ? <><div className="truncate" style={{ fontWeight: 500 }}>{f.name}</div><div className="muted" style={{ fontSize: 12.5 }}>{formatBytes(f.size)}</div></>
            : <div className="muted" style={{ fontSize: 13.5 }}>PDF, image, Word, Excel or ZIP · up to 15 MB</div>}
        </div>
        {f && onDownload && <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => onDownload(f)}>Download</Button>}
        {!readOnly && <>
          <input ref={picker} id={id} type="file" hidden onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ''
            if (!file) return
            setUploading(true)
            try { await onUpload(file) } finally { setUploading(false) }
          }} />
          <Button size="sm" loading={uploading} icon={<Upload size={14} />} onClick={() => picker.current?.click()}>{f ? 'Replace' : 'Choose file'}</Button>
        </>}
      </div>
    )
  } else {
    const type = field.type === 'phone' ? 'tel' : field.type
    control = <input id={id} className={`input ${bad}`} type={type} placeholder={field.placeholder ?? ''} value={text} disabled={readOnly} onChange={e => onChange(e.target.value)} />
  }

  return (
    <div className={`field ${fromDoc ? 'is-from-doc' : ''}`}>
      <label htmlFor={id}>
        {field.label}{field.required && <span className="req">*</span>}
        {field.type === 'secret' && <Lock size={12} className="muted" style={{ marginLeft: 6, verticalAlign: -1 }} />}
        {fromDoc && <span className="from-doc"><FileText size={11} /> From document</span>}
      </label>
      {control}
      {error && <span className="error">{error}</span>}
    </div>
  )
}
