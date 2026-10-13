import { useRef, useState } from 'react'
import { ArrowRight, FileText, Link2, ListPlus, Paperclip, Plus, Trash2, Upload, X } from 'lucide-react'
import { api, ApiError, downloadFile } from '../lib/api'
import { useApi } from '../lib/hooks'
import { formatDate, pct } from '../lib/format'
import type { ClientDetail, SetupItem, User } from '../lib/types'
import { Bar, Button, Confirm, Empty, IconButton, Loading, Note } from './ui'
import { useToast } from './toast'

/**
 * Internal setup before a client goes on retainer: access checks, files, scope.
 * Each item can carry proof (a Drive link or a document). Retainer unlocks when every item is ticked.
 */
export function SetupChecklist({ client, onChanged }: { client: ClientDetail; onChanged: () => void }) {
  const toast = useToast()
  const { data: items, setData, reload } = useApi<SetupItem[]>(`/clients/${client.id}/setup`)
  const { data: people } = useApi<User[]>('/users')
  const [title, setTitle] = useState('')
  const [attachTo, setAttachTo] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)

  if (!items) return <Loading />
  const done = items.filter(i => i.done).length
  const complete = items.length > 0 && done === items.length
  const onRetainer = client.status === 'retainer'

  async function patch(item: SetupItem, body: Record<string, unknown>) {
    try { setData(await api<SetupItem[]>(`/setup/${item.id}`, { method: 'PATCH', body })) } catch (e) { toast.error(e) }
  }

  return (
    <div className="cols">
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2>Setup checklist</h2>
            <p>What our team needs in place before {client.name} moves to monthly retainer work. Attach proof as you go.</p>
          </div>
          <Button size="sm" icon={<ListPlus size={14} />} onClick={async () => {
            try { setData(await api<SetupItem[]>(`/clients/${client.id}/setup/standard`, { method: 'POST' })); toast.success('Standard items added') } catch (e) { toast.error(e) }
          }}>Add standard items</Button>
        </div>
        <div style={{ padding: '0 20px 14px' }}>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>{done} of {items.length} done</div>
          <Bar value={pct(done, items.length)} />
        </div>

        {items.length === 0 ? <Empty title="No setup items yet">Add the standard items, or write your own below.</Empty> : (
          <div className="rows" style={{ borderTop: '1px solid var(--line)' }}>
            {items.map(item => (
              <div key={item.id} style={{ borderTop: '1px solid var(--line)' }} className="setup-row">
                <div className="row-item" style={{ cursor: 'default', flexWrap: 'wrap', rowGap: 8, borderTop: 0 }}>
                  <label className="check grow" style={{ minWidth: 220 }}>
                    <input type="checkbox" checked={!!item.done} onChange={e => void patch(item, { status: e.target.checked ? 'done' : 'pending' })} />
                    <span style={{ textDecoration: item.done ? 'line-through' : undefined, color: item.done ? 'var(--ink-3)' : undefined }}>{item.title}</span>
                  </label>
                  <select className="select sm" style={{ width: 130 }} value={item.status} aria-label="Status"
                    onChange={e => void patch(item, { status: e.target.value })}>
                    <option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option>
                  </select>
                  <select className="select sm" style={{ width: 140 }} value={item.owner_id ?? ''} aria-label="Owner"
                    onChange={e => void patch(item, { owner_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Not assigned</option>
                    {people?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="date" className="input sm" style={{ width: 146 }} value={item.due_date ?? ''} aria-label="Due date"
                    onChange={e => void patch(item, { due_date: e.target.value || null })} />
                  <IconButton label="Attach a link or document" className={attachTo === item.id ? 'line' : ''} onClick={() => setAttachTo(attachTo === item.id ? null : item.id)}><Paperclip size={15} /></IconButton>
                  <IconButton label="Remove item" className="danger" onClick={async () => {
                    try { await api(`/setup/${item.id}`, { method: 'DELETE' }); setData(items.filter(x => x.id !== item.id)) } catch (e) { toast.error(e) }
                  }}><Trash2 size={15} /></IconButton>
                </div>
                <div style={{ padding: '0 20px 12px 46px' }}>
                  <input className="input sm" style={{ width: '100%' }} placeholder="Add a note" defaultValue={item.note ?? ''} aria-label="Note"
                    onBlur={e => { if (e.target.value !== (item.note ?? '')) void patch(item, { note: e.target.value }) }} />
                </div>
                {(item.attachments.length > 0 || attachTo === item.id) && (
                  <div style={{ padding: '0 20px 14px 46px', display: 'grid', gap: 8 }}>
                    {item.attachments.length > 0 && (
                      <div className="row wrap" style={{ gap: 6 }}>
                        {item.attachments.map(a => a.kind === 'link'
                          ? <a key={a.id} className="chip-link" href={a.url!} target="_blank" rel="noreferrer"><Link2 size={13} />{a.title}</a>
                          : <button key={a.id} className="chip-link" onClick={() => void downloadFile(`/assets/${a.id}/file`, a.file_name!).catch(e => toast.error(e))}><FileText size={13} />{a.title}</button>)}
                      </div>
                    )}
                    {attachTo === item.id && <AttachForm clientId={client.id} itemId={item.id} onDone={() => { setAttachTo(null); void reload(); onChanged() }} onCancel={() => setAttachTo(null)} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <form className="row" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }} onSubmit={async e => {
          e.preventDefault()
          if (!title.trim()) return
          try { setData(await api<SetupItem[]>(`/clients/${client.id}/setup`, { body: { title } })); setTitle('') } catch (err) { toast.error(err) }
        }}>
          <input className="input sm grow" placeholder="Add an item, e.g. Shopify staff account created" value={title} onChange={e => setTitle(e.target.value)} aria-label="New setup item" />
          <Button size="sm" type="submit" icon={<Plus size={14} />} disabled={!title.trim()}>Add</Button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Retainer</h2></div>
        <div className="panel-body stack" style={{ gap: 14 }}>
          {onRetainer ? <Note tone="ok">{client.name} is on retainer.</Note> : <>
            <p className="soft">Once setup is complete, move {client.name} to retainer for ongoing monthly work.</p>
            {!complete && <Note>{items.length === 0 ? 'Add the setup checklist first.' : `${items.length - done} item${items.length - done > 1 ? 's' : ''} left before you can move them.`}</Note>}
            <Button variant="primary" icon={<ArrowRight size={15} />} disabled={!complete} onClick={() => setConfirm(true)}>Move to retainer</Button>
          </>}
          <div className="kv" style={{ marginTop: 6 }}>
            <div><span>Status</span><span>{onRetainer ? 'Retainer' : 'Onboarding'}</span></div>
            <div><span>Proof attached</span><span>{items.filter(i => i.attachments.length).length} of {items.length} items</span></div>
            <div><span>Last item ticked</span><span>{formatDate(items.filter(i => i.done_at).map(i => i.done_at!).sort().pop())}</span></div>
          </div>
        </div>
      </section>

      {confirm && <Confirm title={`Move ${client.name} to retainer?`} message="Their status changes to Retainer. Projects and history stay as they are." action="Move to retainer"
        onClose={() => setConfirm(false)} onConfirm={async () => {
          try { await api(`/clients/${client.id}/retainer`, { method: 'POST' }); toast.success(`${client.name} is now on retainer`); onChanged() } catch (e) { toast.error(e); throw e }
        }} />}
    </div>
  )
}

function AttachForm({ clientId, itemId, onDone, onCancel }: { clientId: number; itemId: number; onDone: () => void; onCancel: () => void }) {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null)

  async function send(body: { url?: string; file?: File }) {
    const form = new FormData()
    form.append('setup_item_id', String(itemId)); form.append('category', 'access')
    if (body.url) form.append('url', body.url)
    if (body.file) form.append('file', body.file)
    setBusy(true); setError('')
    try { await api(`/clients/${clientId}/assets`, { form }); toast.success('Attached'); onDone() }
    catch (e) { setError(e instanceof ApiError ? (e.details ? Object.values(e.details)[0] : e.message) : 'Upload failed.') }
    finally { setBusy(false) }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <form className="row wrap" onSubmit={e => { e.preventDefault(); if (url.trim()) void send({ url }) }}>
        <input className="input sm grow" style={{ minWidth: 220 }} placeholder="Paste a Drive link" value={url} onChange={e => setUrl(e.target.value)} aria-label="Drive link" />
        <Button size="sm" type="submit" loading={busy} disabled={!url.trim()}>Attach link</Button>
        <span className="muted" style={{ fontSize: 13 }}>or</span>
        <input ref={picker} type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send({ file: f }) }} />
        <Button size="sm" icon={<Upload size={14} />} disabled={busy} onClick={() => picker.current?.click()}>Upload document</Button>
        <IconButton label="Cancel" onClick={onCancel}><X size={15} /></IconButton>
      </form>
      {error && <span style={{ color: 'var(--change)', fontSize: 13 }}>{error}</span>}
    </div>
  )
}
