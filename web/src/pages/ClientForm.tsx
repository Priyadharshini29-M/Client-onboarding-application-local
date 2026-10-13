import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, CloudOff, Send } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { formatDateTime, pct } from '../lib/format'
import type { FileValue, FormPayload } from '../lib/types'
import { FormRenderer, type FormValues } from '../components/FormRenderer'
import { Bar, Button, Loading, Note } from '../components/ui'
import { DocAutofill } from '../components/DocAutofill'

type Save = 'idle' | 'saving' | 'saved' | 'error'

/** What the client sees from their private link. No sign-in; answers save as they type. */
export function ClientForm() {
  const { token } = useParams()
  const [payload, setPayload] = useState<FormPayload | null>(null)
  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [fatal, setFatal] = useState('')
  const [save, setSave] = useState<Save>('idle')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState('')
  const [fromDoc, setFromDoc] = useState<Set<number>>(new Set())
  const queue = useRef<Record<string, string>>({})
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    api<FormPayload>(`/public/forms/${token}`, { auth: false })
      .then(p => { setPayload(p); setValues(p.values); document.title = `${p.brand.name} · Getting started` })
      .catch(e => setFatal(e instanceof ApiError && e.status === 404 ? "This link doesn't work. Ask your project manager for a new one." : 'The form did not load. Please refresh the page.'))
  }, [token])

  async function flush(): Promise<boolean> {
    window.clearTimeout(timer.current)
    const batch = queue.current
    if (!Object.keys(batch).length) return true
    queue.current = {}
    setSave('saving')
    try {
      const next = await api<FormPayload>(`/public/forms/${token}`, { method: 'PUT', body: { values: batch }, auth: false })
      setPayload(p => p ? { ...p, submission: next.submission, secrets_set: next.secrets_set } : next)
      setValues(v => {
        const copy = { ...v }
        for (const f of next.template.sections.flatMap(s => s.fields)) if (f.type === 'secret' && batch[f.id] !== undefined) copy[f.id] = ''
        return copy
      })
      setSave('saved')
      return true
    } catch (e) {
      queue.current = { ...batch, ...queue.current }
      if (e instanceof ApiError && e.details) setErrors(x => ({ ...x, ...e.details }))
      setSave('error')
      return false
    }
  }

  /** Fills only empty questions from a document, so nothing the client typed is overwritten. */
  function fillFromDoc(found: Record<string, string>) {
    let filled = 0, kept = 0
    const marked: number[] = []
    for (const [k, v] of Object.entries(found)) {
      const id = Number(k), cur = values[id]
      if (typeof cur === 'string' && cur.trim() !== '') { if (cur.trim() !== v.trim()) kept++; continue }
      answer(id, v); marked.push(id); filled++
    }
    if (marked.length) setFromDoc(s => new Set([...s, ...marked]))
    return { filled, kept }
  }

  function change(id: number, v: string) {
    setFromDoc(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n })
    answer(id, v)
  }

  function answer(id: number, v: string) {
    setValues(x => ({ ...x, [id]: v }))
    setErrors(({ [id]: _gone, ...rest }) => rest)
    queue.current[id] = v
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 900)
  }

  async function submit() {
    setProblem(''); setSending(true)
    if (!(await flush())) { setSending(false); setProblem('Some answers did not save. Check the ones marked in red.'); return }
    try {
      setPayload(await api<FormPayload>(`/public/forms/${token}/submit`, { body: { values: {} }, auth: false }))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        const n = Object.keys(e.details).length
        setErrors(e.details)
        setProblem(`${n} required question${n > 1 ? 's' : ''} still need an answer.`)
        document.getElementById(`q-${Object.keys(e.details)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else setProblem(e instanceof Error ? e.message : 'Sending failed. Please try again.')
    } finally { setSending(false) }
  }

  if (fatal) return <div className="public"><div className="public-head"><Note tone="error">{fatal}</Note></div></div>
  if (!payload) return <div className="public"><Loading /></div>

  const sub = payload.submission
  const done = sub.status === 'submitted'

  return (
    <div className="public">
      <div className="public-head">
        <span className="label">Digifyce · {payload.template.name}</span>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 48px)', fontWeight: 700, letterSpacing: '-.03em', marginTop: 14 }}>
          {done ? `Thank you, ${payload.brand.name}.` : `Let's get ${payload.brand.name} started.`}
        </h1>
        <p className="soft" style={{ marginTop: 12, maxWidth: '58ch', fontSize: 16 }}>
          {done ? 'We have everything we need to begin. Your project manager will be in touch with next steps.'
            : 'Tell us about your brand in your own words. Everything saves as you go, so you can close this page and come back to the same link later.'}
        </p>
        {!done && <div className="jump">{payload.template.sections.map(s => <a key={s.id} href={`#part-${s.id}`}>{s.title}</a>)}</div>}
      </div>

      <div className="public-body">
        {done && <Note tone="ok">Sent {formatDateTime(sub.submitted_at)}. Need to change something? Ask your project manager to reopen the form.</Note>}
        {!done && <Note>Passwords are encrypted as soon as you type them, and only your Digifyce team can read them.</Note>}
        {!done && <DocAutofill variant="card" endpoint={`/public/forms/${token}/autofill`} auth={false} onFound={fillFromDoc} />}
        {problem && <Note tone="error">{problem}</Note>}
        <FormRenderer payload={payload} values={values} errors={errors} readOnly={done} audience="client" onChange={change} fromDoc={fromDoc}
          onUpload={async (field, file) => {
            const form = new FormData(); form.append('file', file)
            try {
              const meta = await api<FileValue>(`/public/forms/${token}/files/${field.id}`, { form, auth: false })
              setValues(v => ({ ...v, [field.id]: meta }))
              setErrors(({ [field.id]: _gone, ...rest }) => rest)
            } catch (e) { setErrors(x => ({ ...x, [field.id]: e instanceof Error ? e.message : 'Upload failed.' })) }
          }} />
      </div>

      {!done && (
        <div className="savebar">
          <div className="savebar-in">
            <div className="grow">
              <div className="row" style={{ fontSize: 13.5, gap: 8 }}>
                {save === 'saving' ? <><span className="spinner" style={{ width: 14, height: 14 }} />Saving</>
                  : save === 'error' ? <><CloudOff size={15} color="var(--change)" /><span style={{ color: 'var(--change)' }}>Not saved. Check your connection.</span></>
                    : save === 'saved' ? <><Check size={15} color="var(--ok)" />Saved</>
                      : <span className="muted">Saves automatically</span>}
                <span className="muted save-count">· {sub.filled} of {sub.total} answered</span>
              </div>
              <div style={{ maxWidth: 300, marginTop: 7 }}><Bar value={pct(sub.filled, sub.total)} /></div>
            </div>
            <Button variant="primary" size="lg" icon={<Send size={16} />} loading={sending} onClick={submit}>Send to our team</Button>
          </div>
        </div>
      )}
    </div>
  )
}
