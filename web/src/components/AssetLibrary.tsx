import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileDown, FileText, FolderOpen, Link2, Search, Trash2, Upload } from 'lucide-react'
import { api, ApiError, downloadFile } from '../lib/api'
import { useApi, useDebounced } from '../lib/hooks'
import { formatBytes, formatDate } from '../lib/format'
import type { Asset, AssetCategory, ClientRow } from '../lib/types'
import { Button, Confirm, Empty, IconButton, Loading } from './ui'
import { useToast } from './toast'

export const CATEGORY: Record<AssetCategory, string> = {
  brand: 'Brand', legal: 'Legal & finance', product: 'Product', access: 'Access & logins', other: 'Other',
}
const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'

/** Drive links and uploaded documents. With clientId it's one client's library; without, every client's. */
export function AssetLibrary({ clientId }: { clientId?: number }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<AssetCategory | ''>('')
  const dq = useDebounced(q)
  const qs = new URLSearchParams()
  if (clientId) qs.set('client_id', String(clientId))
  if (cat) qs.set('category', cat)
  if (dq) qs.set('q', dq)
  const { data, loading, reload } = useApi<Asset[]>(`/assets?${qs}`)
  const [removing, setRemoving] = useState<Asset | null>(null)

  return (
    <div className="stack" style={{ gap: 18 }}>
      <AddAsset clientId={clientId} onAdded={() => void reload()} />

      <div className="between wrap">
        <div className="team-chips">
          <button className={`team-chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>All</button>
          {(Object.keys(CATEGORY) as AssetCategory[]).map(k => (
            <button key={k} className={`team-chip ${cat === k ? 'active' : ''}`} onClick={() => setCat(k)}>{CATEGORY[k]}</button>
          ))}
        </div>
        <div className="search" style={{ width: 240 }}><Search size={15} /><input className="input sm" placeholder="Search assets" value={q} onChange={e => setQ(e.target.value)} aria-label="Search assets" /></div>
      </div>

      <section className="panel">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No assets yet">Add a Google Drive link or upload a document above.</Empty> : (
          <div className="rows">
            {data.map(a => (
              <div key={a.id} className="row-item" style={{ cursor: 'default' }}>
                <span className={`asset-ico ${a.kind}`}>{a.kind === 'link' ? (a.url?.includes('drive.google') ? <FolderOpen size={17} /> : <Link2 size={17} />) : <FileText size={17} />}</span>
                <div className="grow">
                  <div className="t truncate">{a.title}</div>
                  <div className="s">
                    {!clientId && <><Link to={`/clients/${a.brand_id}?view=assets`}>{a.brand_name}</Link> · </>}
                    {CATEGORY[a.category]} · {a.kind === 'file' ? `${a.file_name} · ${formatBytes(a.file_size ?? 0)}` : a.url?.replace(/^https?:\/\//, '').slice(0, 48)}
                    {a.setup_item_id ? ' · from setup checklist' : ''}
                  </div>
                </div>
                <span className="muted only-desktop" style={{ fontSize: 12.5, textAlign: 'right' }}>{a.added_by_name}<br />{formatDate(a.created_at)}</span>
                {a.kind === 'link'
                  ? <a className="btn btn-secondary btn-sm" href={a.url!} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
                  : <Button size="sm" icon={<FileDown size={14} />} onClick={() => void downloadFile(`/assets/${a.id}/file`, a.file_name!).catch(e => toast.error(e))}>Download</Button>}
                <IconButton label="Remove" className="danger" onClick={() => setRemoving(a)}><Trash2 size={15} /></IconButton>
              </div>
            ))}
          </div>
        )}
      </section>

      {removing && <Confirm title={`Remove ${removing.title}?`} message={removing.kind === 'file' ? 'The uploaded document will be deleted.' : 'Only the link is removed here. Nothing changes in Google Drive.'} action="Remove"
        onClose={() => setRemoving(null)} onConfirm={async () => {
          try { await api(`/assets/${removing.id}`, { method: 'DELETE' }); toast.success('Removed'); void reload() } catch (e) { toast.error(e); throw e }
        }} />}
    </div>
  )
}

function AddAsset({ clientId, onAdded }: { clientId?: number; onAdded: () => void }) {
  const toast = useToast()
  const { data: clients } = useApi<{ clients: ClientRow[] }>(clientId ? null : '/clients')
  const [mode, setMode] = useState<'link' | 'file'>('link')
  const [client, setClient] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<AssetCategory>('brand')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const target = clientId ?? (client ? Number(client) : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!target) { setError('Choose which client this is for.'); return }
    const form = new FormData()
    form.append('title', title); form.append('category', category)
    if (mode === 'link') form.append('url', url); else if (file) form.append('file', file)
    setBusy(true)
    try {
      await api(`/clients/${target}/assets`, { form })
      toast.success(mode === 'link' ? 'Link added' : 'Document uploaded')
      setTitle(''); setUrl(''); setFile(null)
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? (err.details ? Object.values(err.details)[0] : err.message) : 'Something went wrong.')
    } finally { setBusy(false) }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="between wrap">
        <b style={{ fontFamily: 'var(--display)', fontSize: 17 }}>Add an asset</b>
        <div className="seg" role="tablist">
          <button type="button" className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}><Link2 size={14} /> Drive link</button>
          <button type="button" className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}><Upload size={14} /> Document</button>
        </div>
      </div>
      <div className="asset-form">
        {!clientId && (
          <select className="select sm" value={client} onChange={e => setClient(e.target.value)} aria-label="Client">
            <option value="">Which client?</option>
            {clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {mode === 'link'
          ? <input className="input sm" style={{ gridColumn: 'span 2' }} placeholder="https://drive.google.com/…" value={url} onChange={e => setUrl(e.target.value)} aria-label="Link" />
          : <div className="row" style={{ gridColumn: 'span 2' }}>
              <input ref={picker} type="file" hidden accept={DOC_ACCEPT} onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <Button size="sm" icon={<Upload size={14} />} onClick={() => picker.current?.click()}>{file ? 'Change' : 'Choose document'}</Button>
              <span className="muted truncate" style={{ fontSize: 13 }}>{file ? `${file.name} · ${formatBytes(file.size)}` : 'PDF, Word, Excel, PowerPoint, TXT or CSV'}</span>
            </div>}
        <input className="input sm" placeholder="Name (optional)" value={title} onChange={e => setTitle(e.target.value)} aria-label="Name" />
        <select className="select sm" value={category} onChange={e => setCategory(e.target.value as AssetCategory)} aria-label="Category">
          {(Object.keys(CATEGORY) as AssetCategory[]).map(k => <option key={k} value={k}>{CATEGORY[k]}</option>)}
        </select>
        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={mode === 'link' ? !url.trim() : !file}>Add</Button>
      </div>
      {error && <span style={{ color: 'var(--change)', fontSize: 13 }}>{error}</span>}
    </form>
  )
}
