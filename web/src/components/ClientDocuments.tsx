import { useRef, useState } from 'react'
import { Copy, ExternalLink, FileDown, ListPlus, Plus, Trash2, Upload } from 'lucide-react'
import { api, downloadFile } from '../lib/api'
import { useApi } from '../lib/hooks'
import { formatBytes, formatDate, timeAgo } from '../lib/format'
import type { ClientDocument } from '../lib/types'
import { Bar, Button, copyText, Empty, IconButton, Loading } from './ui'
import { useToast } from './toast'
import { EmailLinkButton } from './EmailLinkButton'

const STATUS = { pending: { label: 'Waiting for client', tone: '' }, uploaded: { label: 'Uploaded', tone: 'review' }, approved: { label: 'Accepted', tone: 'ok' } }

/** Documents we need from the client. They upload through their own private link; the team accepts each one. */
export function ClientDocuments({ clientId, onChanged }: { clientId: number; onChanged: () => void }) {
  const toast = useToast()
  const { data, setData } = useApi<{ link: string; items: ClientDocument[] }>(`/clients/${clientId}/documents`)
  const [name, setName] = useState('')
  const [uploadFor, setUploadFor] = useState<number | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  if (!data) return <section className="panel"><Loading /></section>
  const items = data.items
  const done = items.filter(i => i.status !== 'pending').length
  const apply = (next: { link: string; items: ClientDocument[] }) => { setData(next); onChanged() }

  async function patch(item: ClientDocument, body: Record<string, unknown>) {
    try { apply(await api(`/documents/${item.id}`, { method: 'PATCH', body })) } catch (e) { toast.error(e) }
  }

  return (
    <section className="panel">
      <div className="panel-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2>Documents from the client</h2>
          <p>GST, PAN, logo files and anything else we need. The client uploads them through their own link.</p>
        </div>
        <div className="row wrap">
          <EmailLinkButton clientId={clientId} what="documents" />
          <Button size="sm" icon={<Copy size={14} />} onClick={async () => { if (await copyText(data.link)) toast.success('Upload link copied') }}>Copy upload link</Button>
          <a className="btn btn-ghost btn-sm" href={data.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview</a>
        </div>
      </div>
      <div style={{ padding: '0 20px 14px' }}>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>{done} of {items.length} received</div>
        <Bar value={items.length ? (done / items.length) * 100 : 0} />
      </div>

      {items.length === 0 ? <Empty title="No documents requested yet">Add the standard list or your own below.</Empty> : (
        <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
          {items.map(d => (
            <div key={d.id} className="row-item" style={{ cursor: 'default', flexWrap: 'wrap', rowGap: 8 }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <div className="t">{d.name}</div>
                <div className="s">{d.file_name ? `${d.file_name} · ${formatBytes(d.file_size ?? 0)} · ${timeAgo(d.uploaded_at)}` : d.due_date ? `Needed by ${formatDate(d.due_date)}` : 'Not uploaded yet'}</div>
              </div>
              <select className="select sm" style={{ width: 170 }} value={d.status} aria-label="Status" onChange={e => void patch(d, { status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input type="date" className="input sm" style={{ width: 146 }} value={d.due_date ?? ''} aria-label="Needed by" onChange={e => void patch(d, { due_date: e.target.value || null })} />
              {d.file_name
                ? <IconButton label="Download" onClick={() => void downloadFile(`/documents/${d.id}/file`, d.file_name!).catch(e => toast.error(e))}><FileDown size={15} /></IconButton>
                : <IconButton label="Upload for the client" onClick={() => { setUploadFor(d.id); picker.current?.click() }}><Upload size={15} /></IconButton>}
              <IconButton label="Remove" className="danger" onClick={async () => {
                try { await api(`/documents/${d.id}`, { method: 'DELETE' }); apply({ ...data, items: items.filter(x => x.id !== d.id) }) } catch (e) { toast.error(e) }
              }}><Trash2 size={15} /></IconButton>
            </div>
          ))}
        </div>
      )}

      <input ref={picker} type="file" hidden onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f || !uploadFor) return
        const form = new FormData(); form.append('file', f)
        try { apply(await api(`/documents/${uploadFor}/file`, { form })); toast.success('Uploaded') } catch (err) { toast.error(err) }
      }} />

      <form className="row wrap" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }} onSubmit={async e => {
        e.preventDefault()
        if (!name.trim()) return
        try { apply(await api(`/clients/${clientId}/documents`, { body: { name } })); setName('') } catch (err) { toast.error(err) }
      }}>
        <input className="input sm grow" style={{ minWidth: 200 }} placeholder="Ask for a document, e.g. FSSAI licence" value={name} onChange={e => setName(e.target.value)} aria-label="Document name" />
        <Button size="sm" type="submit" icon={<Plus size={14} />} disabled={!name.trim()}>Add</Button>
        <Button size="sm" variant="ghost" icon={<ListPlus size={14} />} onClick={async () => {
          try { apply(await api(`/clients/${clientId}/documents/standard`, { method: 'POST' })); toast.success('Standard documents added') } catch (err) { toast.error(err) }
        }}>Add standard list</Button>
      </form>
    </section>
  )
}
