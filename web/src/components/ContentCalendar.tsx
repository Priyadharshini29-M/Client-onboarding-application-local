import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { CONTENT_STATUS } from '../lib/format'
import type { ClientRow, ContentRow, ContentStatus, User } from '../lib/types'
import { Button, Empty, Loading } from './ui'
import { useToast } from './toast'

type Col = { key: keyof ContentRow; label: string; w: number; kind: 'date' | 'text' | 'long' | 'funnel' | 'status' | 'person' }
const COLS: Col[] = [
  { key: 'post_date', label: 'Date', w: 130, kind: 'date' },
  { key: 'funnel', label: 'Funnel', w: 90, kind: 'funnel' },
  { key: 'one_liner', label: 'One liner', w: 220, kind: 'text' },
  { key: 'concept', label: 'Concept', w: 130, kind: 'text' },
  { key: 'post_type', label: 'Type', w: 110, kind: 'text' },
  { key: 'concept_idea', label: 'Concept idea', w: 220, kind: 'long' },
  { key: 'copy', label: 'Copy', w: 220, kind: 'long' },
  { key: 'caption', label: 'Caption & hashtags', w: 240, kind: 'long' },
  { key: 'channels', label: 'Channels', w: 160, kind: 'text' },
  { key: 'status', label: 'Status', w: 130, kind: 'status' },
  { key: 'assignee_id', label: 'Assign to', w: 150, kind: 'person' },
  { key: 'output_due', label: 'Output due', w: 130, kind: 'date' },
  { key: 'live_date', label: 'Live date', w: 130, kind: 'date' },
]

const thisMonth = () => new Date().toISOString().slice(0, 7)
function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Monthly content plan. With clientId it's that client's calendar; without, any client can be picked. */
export function ContentCalendar({ clientId }: { clientId?: number }) {
  const toast = useToast()
  const [month, setMonth] = useState(thisMonth())
  const [picked, setPicked] = useState<number | ''>('')
  const target = clientId ?? (picked || undefined)
  const { data: clients } = useApi<{ clients: ClientRow[] }>(clientId ? null : '/clients')
  const { data: people } = useApi<User[]>('/users')
  const path = target ? `/clients/${target}/content?month=${month}` : `/content?month=${month}`
  const { data, setData, loading } = useApi<{ month: string; rows: ContentRow[]; summary: Record<ContentStatus, number> }>(path)
  const [selected, setSelected] = useState<number[]>([])
  useEffect(() => { setSelected([]) }, [path])

  const rows = data?.rows ?? []
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  async function save(row: ContentRow, key: keyof ContentRow, value: string) {
    const body = { [key]: value === '' ? null : key === 'assignee_id' ? Number(value) : value }
    try {
      const next = await api<ContentRow>(`/content/${row.id}`, { method: 'PATCH', body })
      setData(d => d ? { ...d, rows: d.rows.map(r => r.id === row.id ? next : r) } : d)
    } catch (e) { toast.error(e) }
  }

  async function add(count: number) {
    if (!target) { toast.error('Choose a client first.'); return }
    try { setData(await api(`/clients/${target}/content`, { body: { month, count } })) } catch (e) { toast.error(e) }
  }

  async function bulk(body: Record<string, unknown>) {
    try {
      await api('/content/bulk', { body: { ids: selected, ...body } })
      setData(d => d ? { ...d, rows: body.delete ? d.rows.filter(r => !selected.includes(r.id)) : d.rows.map(r => selected.includes(r.id) ? { ...r, status: body.status as ContentStatus } : r) } : d)
      setSelected([])
    } catch (e) { toast.error(e) }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="between wrap">
        <div className="row wrap" style={{ gap: 10 }}>
          {!clientId && (
            <select className="select sm" style={{ width: 200 }} value={picked} onChange={e => setPicked(e.target.value ? Number(e.target.value) : '')} aria-label="Client">
              <option value="">All clients</option>
              {clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn line" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))}><ChevronLeft size={16} /></button>
            <b style={{ fontFamily: 'var(--display)', fontSize: 18, minWidth: 150, textAlign: 'center' }}>{label}</b>
            <button className="icon-btn line" aria-label="Next month" onClick={() => setMonth(shift(month, 1))}><ChevronRight size={16} /></button>
          </div>
          {data && <span className="muted" style={{ fontSize: 13 }}>{rows.length} posts · {data.summary.live} live · {data.summary.approved} approved · {data.summary.ready} ready</span>}
        </div>
        <div className="row">
          <Button size="sm" icon={<Plus size={14} />} disabled={!target} onClick={() => void add(1)}>Add post</Button>
          <Button size="sm" variant="ghost" disabled={!target} onClick={() => void add(4)}>Add 4 rows</Button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="row wrap" style={{ padding: '10px 14px', background: 'var(--sunk)', borderRadius: 12 }}>
          <b style={{ fontSize: 14 }}>{selected.length} selected</b>
          <select className="select sm" style={{ width: 170 }} defaultValue="" aria-label="Set status" onChange={e => { if (e.target.value) void bulk({ status: e.target.value }) }}>
            <option value="">Set status…</option>
            {Object.entries(CONTENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} style={{ color: 'var(--change)' }} onClick={() => void bulk({ delete: true })}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <section className="panel"><Empty title={`Nothing planned for ${label}`}>{target ? 'Add posts to start the month’s plan.' : 'Pick a client to start planning.'}</Empty></section>
      ) : (
        <div className="panel cc-wrap">
          <table className="cc">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={selected.length === rows.length} onChange={e => setSelected(e.target.checked ? rows.map(r => r.id) : [])} /></th>
                {!target && <th style={{ minWidth: 130 }}>Client</th>}
                {COLS.map(c => <th key={c.key} style={{ minWidth: c.w }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={selected.includes(r.id) ? 'sel' : ''}>
                  <td><input type="checkbox" aria-label="Select row" checked={selected.includes(r.id)} onChange={e => setSelected(s => e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id))} /></td>
                  {!target && <td style={{ fontWeight: 500 }}>{r.brand_name}</td>}
                  {COLS.map(c => <td key={c.key}><Cell col={c} row={r} people={people ?? []} onSave={v => void save(r, c.key, v)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Cell({ col, row, people, onSave }: { col: Col; row: ContentRow; people: User[]; onSave: (v: string) => void }) {
  const initial = row[col.key] == null ? '' : String(row[col.key])
  const [v, setV] = useState(initial)
  useEffect(() => { setV(initial) }, [initial])
  const commit = (next = v) => { if (next !== initial) onSave(next) }

  if (col.kind === 'status') {
    return (
      <select className={`cc-in cc-status ${CONTENT_STATUS[v]?.tone ?? ''}`} value={v} aria-label={col.label} onChange={e => { setV(e.target.value); commit(e.target.value) }}>
        {Object.entries(CONTENT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
      </select>
    )
  }
  if (col.kind === 'funnel') {
    return (
      <select className="cc-in" value={v} aria-label={col.label} onChange={e => { setV(e.target.value); commit(e.target.value) }}>
        <option value="">—</option><option value="top">Top</option><option value="mid">Mid</option><option value="bot">Bottom</option>
      </select>
    )
  }
  if (col.kind === 'person') {
    return (
      <select className="cc-in" value={v} aria-label={col.label} onChange={e => { setV(e.target.value); commit(e.target.value) }}>
        <option value="">—</option>
        {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    )
  }
  if (col.kind === 'long') {
    return <textarea className="cc-in" rows={1} value={v} aria-label={col.label} onChange={e => setV(e.target.value)} onBlur={() => commit()} />
  }
  return <input className="cc-in" type={col.kind === 'date' ? 'date' : 'text'} value={v} aria-label={col.label}
    onChange={e => setV(e.target.value)} onBlur={() => commit()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}
