import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useApi, useDebounced, useLocalState } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { ENTRY_STATUS, formatDateTime, timeAgo } from '../lib/format'
import type { ApprovalItem, ApprovalSummary } from '../lib/types'
import { DeliverablePanel } from '../components/DeliverablePanel'
import { EntryDrawer, KindIcon } from '../components/AssetFormats'
import { useShell } from '../components/Shell'
import { reworkPoints } from '../components/Rework'
import { Empty, Loading, PageHead, Pill, Tabs, TeamTag } from '../components/ui'

type View = 'pending' | 'approved' | 'mine'
type Kind = 'all' | 'task' | 'asset'

const noteText = (note: string) => {
  const p = reworkPoints(note)
  return p ? `${p.length} ${p.length === 1 ? 'change' : 'changes'} asked: ${p.join(' · ')}` : `“${note}”`
}

const waited = (h: number) => (h < 1 ? 'under 1 h' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`)

/** Approvals: everything that needs a yes (task versions, intake forms, filled asset formats), with progress at a glance. */
export function Reviews() {
  const { refreshCounts } = useShell()
  const { user } = useAuth()
  const [view, setView] = useState<View>('pending')
  const [kind, setKind] = useState<Kind>('all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [onlyMine, setOnlyMine] = useLocalState('brandos.approvals.onlyMine', user?.role !== 'member')

  const qs = new URLSearchParams({ view })
  if (dq) qs.set('q', dq)
  if (view === 'pending' && onlyMine) qs.set('only_mine', '1')
  const { data: items, loading, reload } = useApi<ApprovalItem[]>(`/approvals?${qs}`)
  const { data: sum, reload: reloadSum } = useApi<ApprovalSummary>('/approvals/summary')
  const [open, setOpen] = useState<ApprovalItem | null>(null)

  const shown = (items ?? []).filter(i => kind === 'all' || i.type === kind)
  const changed = () => { void reload(); void reloadSum(); refreshCounts() }
  const decided = sum ? sum.approved_week + sum.sent_back_week : 0
  const rate = sum && decided ? Math.round((sum.approved_week / decided) * 100) : null

  return (
    <div className="page">
      <PageHead title="Approvals" sub="Approve submitted work, or send it back with a note on what to change." />

      <div className="ap-stats">
        <button className="ap-stat" onClick={() => { setView('pending'); setOnlyMine(true) }}>
          <span className="label">Waiting for you</span>
          <b>{sum?.waiting_for_me ?? '–'}</b>
          <small>{sum ? `${sum.waiting} waiting in total` : ''}</small>
        </button>
        <button className={`ap-stat ${sum?.waiting_long ? 'bad' : ''}`} onClick={() => { setView('pending'); setOnlyMine(false) }}>
          <span className="label">Waiting over 2 days</span>
          <b>{sum?.waiting_long ?? '–'}</b>
          <small>{sum?.waiting_long ? 'Look at these first' : 'Nothing is stuck'}</small>
        </button>
        <button className="ap-stat" onClick={() => setView('approved')}>
          <span className="label">This week</span>
          <b>{sum?.approved_week ?? '–'} <span>approved</span></b>
          <div className="ap-split" aria-label={`${sum?.approved_week ?? 0} approved, ${sum?.sent_back_week ?? 0} sent back`}>
            <i className="ok" style={{ flex: sum?.approved_week || 0 }} /><i className="change" style={{ flex: sum?.sent_back_week || 0 }} />{!decided && <i style={{ flex: 1 }} />}
          </div>
          <small>{sum ? `${sum.sent_back_week} sent back${rate !== null ? ` · ${rate}% approved` : ''}` : ''}</small>
        </button>
      </div>

      <Tabs value={view} onChange={v => setView(v)} tabs={[
        { key: 'pending', label: 'Waiting', count: sum ? (onlyMine ? sum.waiting_for_me : sum.waiting) : undefined },
        { key: 'approved', label: 'Recently approved' },
        { key: 'mine', label: 'My submissions', count: sum?.mine_waiting || undefined },
      ]} />

      <div className="ap-tools">
        <div className="search grow" style={{ maxWidth: 380 }}><Search size={15} />
          <input className="input sm" placeholder="Search task, client or who submitted it" value={q} onChange={e => setQ(e.target.value)} aria-label="Search approvals" />
        </div>
        <div className="seg" role="tablist" aria-label="Type">
          {([['all', 'All'], ['task', 'Tasks'], ['asset', 'Asset formats']] as [Kind, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {view === 'pending' && <label className="check"><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> Only ones I can approve</label>}
      </div>

      <section className="panel">
        {loading && !items ? <Loading /> : !shown.length ? (
          <Empty title={view === 'pending' ? (dq ? 'No matches' : "You're all caught up") : view === 'approved' ? 'Nothing approved in the last 30 days' : "You haven't submitted anything yet"}>
            {view === 'pending' && !dq ? 'New work shows up here as soon as it is submitted.' : null}
          </Empty>
        ) : (
          <div className="rows">
            {shown.map(i => <Row key={i.key} item={i} view={view} onOpen={() => setOpen(i)} />)}
          </div>
        )}
      </section>

      {open?.type === 'task' && <DeliverablePanel id={open.id} onClose={() => setOpen(null)} onChanged={changed} />}
      {open?.type === 'asset' && <EntryDrawer formatId={open.format_id!} entryId={open.id} onClose={() => setOpen(null)} onSaved={changed} />}
    </div>
  )
}

function Row({ item: i, view, onOpen }: { item: ApprovalItem; view: View; onOpen: () => void }) {
  const pct = i.progress.total ? Math.round((i.progress.done / i.progress.total) * 100) : 0
  const tone = i.waiting_hours === null ? '' : i.waiting_hours >= 48 ? 'change' : i.waiting_hours >= 24 ? 'review' : ''

  return (
    <button className="row-item ap-row" onClick={onOpen}>
      <span className="vtag">{i.type === 'asset' && i.kind ? <KindIcon kind={i.kind} size={13} /> : i.label}</span>

      <div className="ap-main">
        <div className="t">{i.title}</div>
        <div className="s">
          <Link to={`/clients/${i.client_id}`} onClick={e => e.stopPropagation()}>{i.client_name}</Link> · {i.context}
          {i.submitted_by ? ` · by ${i.submitted_by}` : ''}
        </div>
        {view === 'pending' && i.change_note && <div className="ap-note"><b>{i.revision && i.revision.no > 1 ? 'What changed:' : 'Note:'}</b> {i.change_note}</div>}
        {view !== 'pending' && i.note && <div className={`ap-note ${i.status === 'needs_changes' ? 'rework' : ''}`}>{noteText(i.note)}</div>}
      </div>

      <div className="ap-progress" title={`${i.progress.done} of ${i.progress.total} ${i.progress.label}`}>
        {i.revision && (
          <div className="ap-rev"><span className="vbadge">Version {i.revision.no}</span>{i.revision.no > 1 && <span>{i.revision.no - 1} earlier {i.revision.no === 2 ? 'version' : 'versions'}</span>}</div>
        )}
        {i.kind !== 'calendar' && <div className="ap-bar"><i style={{ width: `${pct}%` }} /></div>}
        <span className="ap-plabel">{i.kind === 'calendar' ? `${i.progress.total} ${i.progress.label} planned` : `${i.progress.done}/${i.progress.total} ${i.progress.label}`}</span>
      </div>

      <div className="ap-side">
        {i.team_name ? <TeamTag name={i.team_name} icon={i.team_icon} /> : <span className="tag">Asset format</span>}
        {view === 'pending' ? (
          <span className={`pill ${tone}`} title={formatDateTime(i.submitted_at)}>Waiting {waited(i.waiting_hours ?? 0)}</span>
        ) : view === 'approved' ? (
          <span className="muted ap-when" title={formatDateTime(i.decided_at)}>{i.decided_by ?? 'Approved'} · {timeAgo(i.decided_at)}</span>
        ) : (
          <Pill map={ENTRY_STATUS} value={i.status} />
        )}
      </div>

      <span className={`btn btn-sm ${view === 'pending' && i.can_approve ? 'btn-primary' : 'btn-ghost'}`}>{view === 'pending' && i.can_approve ? 'Review' : 'View'}</span>
    </button>
  )
}
