import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Upload } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import type { ClientDocument } from '../lib/types'
import { Bar, Button, Loading, Note } from '../components/ui'

/** What the client sees from their document link: a list of what we need, with an upload button for each. */
export function ClientDocumentsPublic() {
  const { token } = useParams()
  const [data, setData] = useState<{ brand: { name: string }; items: ClientDocument[] } | null>(null)
  const [fatal, setFatal] = useState('')
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const target = useRef<number | null>(null)

  useEffect(() => {
    api<typeof data>(`/public/documents/${token}`, { auth: false })
      .then(d => { setData(d); if (d) document.title = `${d.brand.name} · Documents` })
      .catch(e => setFatal(e instanceof ApiError && e.status === 404 ? "This link doesn't work. Ask your project manager for a new one." : 'The page did not load. Please refresh.'))
  }, [token])

  if (fatal) return <div className="public"><div className="public-head"><Note tone="error">{fatal}</Note></div></div>
  if (!data) return <div className="public"><Loading /></div>
  const done = data.items.filter(i => i.status !== 'pending').length

  return (
    <div className="public">
      <div className="public-head">
        <span className="label">Digifyce · Documents</span>
        <h1 style={{ fontSize: 'clamp(30px, 6vw, 44px)', fontWeight: 700, letterSpacing: '-.03em', marginTop: 14 }}>Documents for {data.brand.name}</h1>
        <p className="soft" style={{ marginTop: 10, maxWidth: '58ch', fontSize: 16 }}>Upload each document below. You can come back to this link any time; files you've already sent stay here.</p>
        <div style={{ maxWidth: 360, marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 6 }}>{done} of {data.items.length} sent</div>
          <Bar value={data.items.length ? (done / data.items.length) * 100 : 0} />
        </div>
      </div>
      <div className="public-body">
        <section className="form-card" style={{ padding: 0 }}>
          <div className="rows">
            {data.items.map(d => (
              <div key={d.id} className="row-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <span className={`asset-ico ${d.status === 'pending' ? '' : 'link'}`}>{d.status === 'pending' ? <Upload size={16} /> : <Check size={16} />}</span>
                <div className="grow" style={{ minWidth: 180 }}>
                  <div className="t">{d.name}</div>
                  <div className="s">
                    {d.status === 'approved' ? 'Accepted by our team' : d.file_name ? `${d.file_name} · ${formatBytes(d.file_size ?? 0)}` : d.due_date ? `Needed by ${formatDate(d.due_date)}` : 'Not sent yet'}
                  </div>
                  {errors[d.id] && <div style={{ color: 'var(--change)', fontSize: 13, marginTop: 4 }}>{errors[d.id]}</div>}
                </div>
                {d.status !== 'approved' && (
                  <Button size="sm" variant={d.file_name ? 'secondary' : 'primary'} loading={busy === d.id} icon={<Upload size={14} />}
                    onClick={() => { target.current = d.id; picker.current?.click() }}>{d.file_name ? 'Replace' : 'Upload'}</Button>
                )}
              </div>
            ))}
          </div>
        </section>
        <p className="muted" style={{ fontSize: 13 }}>PDF, images, Word, Excel, CSV, AI/EPS or ZIP, up to 15 MB each.</p>
      </div>
      <input ref={picker} type="file" hidden onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = ''
        const id = target.current
        if (!f || !id) return
        setBusy(id); setErrors(x => ({ ...x, [id]: '' }))
        const form = new FormData(); form.append('file', f)
        try { setData(await api(`/public/documents/${token}/${id}`, { form, auth: false })) }
        catch (err) { setErrors(x => ({ ...x, [id]: err instanceof Error ? err.message : 'Upload failed.' })) }
        finally { setBusy(null) }
      }} />
    </div>
  )
}
