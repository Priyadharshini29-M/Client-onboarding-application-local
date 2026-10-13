import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type EdgeChange, type NodeChange,
} from '@xyflow/react'
import { ArrowLeft, CalendarClock, Check, LayoutGrid, Pencil, Play, Plus, Trash2, X, Zap } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { BRAND_TYPE, CLIENT_STATUS, formatDate } from '../lib/format'
import { STEP_GROUPS, STEP_META, StepIcon, newStepDefaults, stepSummary } from '../lib/workflow'
import type { StepConfig, StepType, Workflow, WorkflowMeta, WorkflowTrigger } from '../lib/types'
import { Button, Confirm, Empty, Field, IconButton, Loading, Modal } from '../components/ui'
import { StepEditor } from '../components/StepEditor'
import { arrow, edgeId, edgeTypes, nodeTypes, type CardNode, type FlowEdge, type FlowNode } from '../components/FlowCanvas'
import { useToast } from '../components/toast'
import { RunList } from './Workflows'

type Tab = 'flow' | 'triggers' | 'runs'
type Card = { type: StepType; title: string; config: StepConfig }

export function WorkflowEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user, isAdmin } = useAuth()
  const canEdit = isAdmin || user?.role === 'project_manager'
  const { data: wf, setData } = useApi<Workflow>(`/workflows/${id}`)
  const { data: meta } = useApi<WorkflowMeta>('/workflow-meta')
  const [tab, setTab] = useState<Tab>('flow')
  const [running, setRunning] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function patchWorkflow(body: Partial<Workflow>) {
    try { setData(await api<Workflow>(`/workflows/${wf!.id}`, { method: 'PATCH', body })) } catch (e) { toast.error(e instanceof ApiError && e.details ? Object.values(e.details)[0] : e) }
  }

  if (!wf) return <div className="page"><Loading /></div>

  return (
    <div className="page wfe-page">
      <Link to="/workflows" className="back-link"><ArrowLeft size={15} /> Workflows</Link>

      <div className="wfe-head">
        <span className="af-ico"><Zap size={20} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <input className="fb-title wfe-title" defaultValue={wf.name} key={`n${wf.id}`} disabled={!canEdit} aria-label="Workflow name"
            onBlur={e => { if (e.target.value.trim() && e.target.value !== wf.name) void patchWorkflow({ name: e.target.value.trim() }) }} />
          <input className="fb-desc" defaultValue={wf.description ?? ''} key={`d${wf.id}`} disabled={!canEdit} placeholder="Add a line on what this workflow is for" aria-label="Description"
            onBlur={e => { if (e.target.value !== (wf.description ?? '')) void patchWorkflow({ description: e.target.value }) }} />
        </div>
        <div className="wfe-actions">
          {canEdit && (
            <label className="live-switch">
              <button type="button" role="switch" aria-checked={wf.is_live} className={`sw ${wf.is_live ? 'on' : ''}`} onClick={() => void patchWorkflow({ is_live: !wf.is_live })} />
              <span><b>{wf.is_live ? 'Live' : 'Off'}</b><small>{wf.is_live ? 'Triggers can start it' : 'Only runs by hand'}</small></span>
            </label>
          )}
          {canEdit && <Button variant="primary" icon={<Play size={14} />} disabled={!wf.steps.length} onClick={() => setRunning(true)}>Run now</Button>}
          {canEdit && <IconButton label="Delete workflow" className="line danger" onClick={() => setRemoving(true)}><Trash2 size={15} /></IconButton>}
        </div>
      </div>

      <div className="dept-tabs" role="tablist" aria-label="Workflow">
        <button role="tab" aria-selected={tab === 'flow'} className={tab === 'flow' ? 'on' : ''} onClick={() => setTab('flow')}>Flow<span className="count">{wf.steps.length}</span></button>
        <button role="tab" aria-selected={tab === 'triggers'} className={tab === 'triggers' ? 'on' : ''} onClick={() => setTab('triggers')}>Triggers<span className="count">{wf.triggers.length}</span></button>
        <button role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}>Runs{wf.active_runs > 0 && <span className="count">{wf.active_runs}</span>}</button>
      </div>

      {tab === 'flow' && (
        <ReactFlowProvider>
          <Canvas wf={wf} meta={meta} canEdit={canEdit} onSaved={w => setData(w)} onTriggers={() => setTab('triggers')} />
        </ReactFlowProvider>
      )}
      {tab === 'triggers' && <Triggers wf={wf} meta={meta} canEdit={canEdit} onChange={setData} />}
      {tab === 'runs' && <RunList workflowId={wf.id} />}

      {running && meta && <RunNow wf={wf} meta={meta} onClose={() => setRunning(false)} onStarted={() => { setRunning(false); setTab('runs') }} />}
      {removing && <Confirm title={`Delete ${wf.name}?`} message="Workflows that have already run are kept for the record. Turn those off instead."
        onClose={() => setRemoving(false)}
        onConfirm={async () => { try { await api(`/workflows/${wf.id}`, { method: 'DELETE' }); toast.success('Workflow deleted'); navigate('/workflows') } catch (e) { toast.error(e); throw e } }} />}
    </div>
  )
}

// ============================================================================ the canvas

let seq = 0
const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

function Canvas({ wf, meta, canEdit, onSaved, onTriggers }: {
  wf: Workflow; meta: WorkflowMeta | null | undefined; canEdit: boolean; onSaved: (w: Workflow) => void; onTriggers: () => void
}) {
  const toast = useToast()
  const flow = useReactFlow()
  const wrap = useRef<HTMLDivElement>(null)
  const dbIds = useRef<Record<string, number>>({})
  const [cards, setCards] = useState<Record<string, Card>>({})
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [edges, setEdges] = useState<FlowEdge[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dirty, setDirty] = useState(0)
  const loaded = useRef(false)

  const deleteEdge = useCallback((eid: string) => { setEdges(es => es.filter(e => e.id !== eid)); setDirty(d => d + 1) }, [])

  // Load once.
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    const c: Record<string, Card> = {}
    for (const s of wf.steps) { c[String(s.id)] = { type: s.type, title: s.title, config: s.config ?? {} }; dbIds.current[String(s.id)] = s.id }
    setCards(c)
    setNodes([
      { id: 'start', type: 'start', position: { x: wf.start?.x ?? 160, y: wf.start?.y ?? 0 }, data: { summary: '' }, deletable: false },
      ...wf.steps.map(s => ({ id: String(s.id), type: 'card' as const, position: { x: s.x, y: s.y }, data: { type: s.type, title: s.title, summary: '' } })),
    ])
    setEdges(wf.edges.map(e => ({ id: edgeId(e), source: e.from, target: e.to, sourceHandle: e.branch, type: 'flow', markerEnd: arrow, data: { branch: e.branch } })))
  }, [wf])

  // Card text, warnings and the Start summary follow the data.
  const incomingOf = useCallback((nid: string) => edges.filter(e => e.target === nid).length, [edges])
  const viewNodes = useMemo<FlowNode[]>(() => nodes.map(n => {
    if (n.type === 'start') {
      const summary = wf.triggers.length ? wf.triggers.map(t => t.summary).join(' · ') : 'By hand (add a trigger to automate)'
      return { ...n, data: { summary }, selected: n.id === sel }
    }
    const card = cards[n.id]
    if (!card) return n
    let warn: string | null = null
    const inc = edges.filter(e => e.target === n.id)
    if (!inc.length) warn = 'Not connected yet'
    else if (card.type === 'approval' && inc.some(e => cards[e.source]?.type !== 'task')) warn = 'Put this right after a Task'
    else if (card.type === 'task' && !card.config.team_id) warn = 'Choose a department'
    else if (card.type === 'condition' && !edges.some(e => e.source === n.id)) warn = 'Connect the Yes and No paths'
    return { ...n, selected: n.id === sel, data: { type: card.type, title: card.title, summary: stepSummary(card, meta), warn } } as CardNode
  }), [nodes, cards, edges, sel, meta, wf.triggers])
  const viewEdges = useMemo<FlowEdge[]>(() => edges.map(e => ({ ...e, data: { branch: e.data?.branch ?? 'next', onDelete: canEdit ? deleteEdge : undefined } })), [edges, canEdit, deleteEdge])

  // Save a moment after the last real change.
  useEffect(() => {
    if (!dirty || !canEdit) return
    setSave('saving')
    const t = setTimeout(async () => {
      const payload = {
        start: nodes.find(n => n.id === 'start')?.position ?? { x: 160, y: 0 },
        nodes: nodes.filter(n => n.id !== 'start' && cards[n.id]).map(n => ({ id: dbIds.current[n.id] ?? 0, key: n.id, ...cards[n.id], x: n.position.x, y: n.position.y })),
        edges: edges.map(e => ({ from: e.source, to: e.target, branch: e.data?.branch ?? 'next' })),
      }
      try {
        const saved = await api<Workflow>(`/workflows/${wf.id}/graph`, { method: 'PUT', body: payload })
        Object.assign(dbIds.current, saved.key_map ?? {})
        onSaved({ ...saved, key_map: undefined })
        setSave('saved')
      } catch (e) {
        setSave('error')
        toast.error(e instanceof ApiError && e.details ? Object.values(e.details)[0] : e)
      }
    }, 700)
    return () => clearTimeout(t)
  }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes(ns => applyNodeChanges(changes.filter(c => c.type !== 'select'), ns))
    for (const c of changes) {
      if (c.type === 'select' && c.selected) setSel(c.id)
      if (c.type === 'remove') { setCards(cs => { const n = { ...cs }; delete n[c.id]; return n }); setEdges(es => es.filter(e => e.source !== c.id && e.target !== c.id)); if (sel === c.id) setSel(null) }
    }
    if (changes.some(c => (c.type === 'position' && c.dragging === false) || c.type === 'remove')) setDirty(d => d + 1)
  }, [sel])
  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges(es => applyEdgeChanges(changes, es))
    if (changes.some(c => c.type === 'remove')) setDirty(d => d + 1)
  }, [])
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || c.target === 'start') return
    const branch = (c.sourceHandle === 'yes' || c.sourceHandle === 'no' ? c.sourceHandle : 'next') as 'next' | 'yes' | 'no'
    const e = { from: c.source, to: c.target, branch }
    setEdges(es => es.some(x => x.id === edgeId(e)) ? es : [...es, { id: edgeId(e), source: c.source, target: c.target, sourceHandle: branch, type: 'flow', markerEnd: arrow, data: { branch } }])
    setDirty(d => d + 1)
  }, [])

  function addCard(type: StepType, at?: { x: number; y: number }) {
    const key = newKey()
    const box = wrap.current?.getBoundingClientRect()
    const pos = at ?? flow.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 800) / 2 - 130, y: (box?.top ?? 0) + (box?.height ?? 600) / 2 - 40 })
    const d = newStepDefaults(type)
    setCards(cs => ({ ...cs, [key]: { type, title: d.title, config: d.config } }))
    setNodes(ns => [...ns, { id: key, type: 'card', position: { x: Math.round(pos.x), y: Math.round(pos.y) }, data: { type, title: d.title, summary: '' } }])
    // Connect it under the selected card, so building a flow is click, click, click.
    if (sel && (sel === 'start' || cards[sel]?.type !== 'condition')) {
      const e = { from: sel, to: key, branch: 'next' as const }
      setEdges(es => [...es, { id: edgeId(e), source: sel, target: key, sourceHandle: 'next', type: 'flow', markerEnd: arrow, data: { branch: 'next' } }])
      const from = nodes.find(n => n.id === sel)
      if (from && !at) setNodes(ns => ns.map(n => (n.id === key ? { ...n, position: { x: from.position.x + (sel === 'start' ? -20 : 0), y: from.position.y + 180 } } : n)))
    }
    setSel(key)
    setPaletteOpen(false)
    setDirty(d => d + 1)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/brandos-card') as StepType
    if (!type || !STEP_META[type]) return
    addCard(type, flow.screenToFlowPosition({ x: e.clientX - 130, y: e.clientY - 30 }))
  }

  function tidy() {
    // Layered layout: each card goes one row below the furthest card pointing to it.
    const depth: Record<string, number> = { start: 0 }
    for (let pass = 0; pass < nodes.length + 2; pass++) {
      for (const e of edges) {
        if (depth[e.source] !== undefined && (depth[e.target] ?? -1) < depth[e.source] + 1) depth[e.target] = depth[e.source] + 1
      }
    }
    const maxDepth = Math.max(0, ...Object.values(depth))
    nodes.forEach(n => { if (depth[n.id] === undefined) depth[n.id] = maxDepth + 1 })
    const rows: Record<number, FlowNode[]> = {}
    ;[...nodes].sort((a, b) => a.position.x - b.position.x).forEach(n => { (rows[depth[n.id]] ??= []).push(n) })
    const pos: Record<string, { x: number; y: number }> = {}
    Object.entries(rows).forEach(([d, row]) => row.forEach((n, i) => { pos[n.id] = { x: 160 + (i - (row.length - 1) / 2) * 340 + (n.id === 'start' ? 20 : 0), y: Number(d) * 180 } }))
    setNodes(ns => ns.map(n => ({ ...n, position: pos[n.id] ?? n.position })))
    setDirty(d => d + 1)
    setTimeout(() => showTop(pos), 50)
  }

  /** Opens at a readable zoom, centred, with the Start card near the top (instead of shrinking everything to fit). */
  function showTop(pos?: Record<string, { x: number; y: number }>) {
    const pts = nodes.map(n => pos?.[n.id] ?? n.position)
    if (!pts.length || !wrap.current) return
    const w = wrap.current.clientWidth
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)) + 260, minY = Math.min(...pts.map(p => p.y))
    const zoom = Math.max(0.55, Math.min(1, (w - 120) / Math.max(1, maxX - minX)))
    flow.setViewport({ x: w / 2 - ((minX + maxX) / 2) * zoom, y: 80 - minY * zoom, zoom }, { duration: pos ? 300 : 0 })
  }

  const current = sel && sel !== 'start' ? cards[sel] : null

  return (
    <div className="fc-shell">
      <div className="fc-wrap" ref={wrap} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }} onDrop={onDrop}>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={viewNodes} edges={viewEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={canEdit ? onNodesChange : undefined} onEdgesChange={canEdit ? onEdgesChange : undefined} onConnect={canEdit ? onConnect : undefined}
          onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => { setSel(null); setPaletteOpen(false) }}
          nodesDraggable={canEdit} nodesConnectable={canEdit} deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          defaultEdgeOptions={{ type: 'flow', markerEnd: arrow }} connectionRadius={28}
          onInit={() => setTimeout(() => showTop(), 30)} minZoom={0.25} maxZoom={1.6}>
          <Background gap={20} size={1.2} color="var(--fc-dot)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable className="fc-minimap" nodeBorderRadius={8} maskColor="var(--fc-mask)" nodeColor="var(--fc-mini)" />
        </ReactFlow>

        {canEdit && (
          <div className={`fc-palette ${paletteOpen ? 'open' : ''}`}>
            <button type="button" className="fc-palette-toggle" onClick={() => setPaletteOpen(!paletteOpen)} aria-expanded={paletteOpen}>
              {paletteOpen ? <X size={15} /> : <Plus size={15} />} Add a card
            </button>
            <div className="fc-palette-body">
              <p className="fc-palette-hint">{sel ? 'Click to add below the selected card, or drag onto the canvas.' : 'Click to add, or drag onto the canvas.'}</p>
              {STEP_GROUPS.map(g => (
                <div key={g.name} className="fc-palette-group">
                  <span className="label">{g.name}</span>
                  {g.types.map(t => (
                    <button key={t} type="button" className="fc-palette-item" draggable
                      onDragStart={e => { e.dataTransfer.setData('application/brandos-card', t); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => addCard(t)}>
                      <span className={`fc-ico t-${t}`}><StepIcon type={t} size={14} /></span>
                      <span className="grow"><b>{STEP_META[t].label}</b><small>{STEP_META[t].hint}</small></span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="fc-toolbar">
          <span className={`save-state ${save}`}>{save === 'saving' ? 'Saving…' : save === 'saved' ? <><Check size={13} /> Saved</> : save === 'error' ? 'Not saved' : canEdit ? 'Changes save by themselves' : 'View only'}</span>
          {canEdit && <Button size="sm" icon={<LayoutGrid size={14} />} onClick={tidy}>Tidy up</Button>}
        </div>

        {(current || sel === 'start') && (
          <aside className="fc-inspector">
            <button type="button" className="fc-inspector-close icon-btn" onClick={() => setSel(null)} aria-label="Close"><X size={16} /></button>
            {sel === 'start' ? (
              <div className="stack" style={{ gap: 14 }}>
                <span className="label row" style={{ gap: 8 }}><CalendarClock size={14} /> Start</span>
                <p className="soft" style={{ fontSize: 14 }}>The flow starts here. Draw arrows from Start to the first cards; several arrows run in parallel.</p>
                {wf.triggers.length ? wf.triggers.map(t => <div key={t.id} className="fc-trigger"><b>{t.name}</b><small>{t.summary}</small></div>) : <p className="muted" style={{ fontSize: 13.5 }}>No triggers yet, so it only runs when someone presses Run now.</p>}
                <Button icon={<Pencil size={14} />} onClick={onTriggers}>Manage triggers</Button>
              </div>
            ) : current && (
              <StepEditor card={current} meta={meta} workflowId={wf.id} incoming={incomingOf(sel!)} disabled={!canEdit}
                onChange={p => { setCards(cs => ({ ...cs, [sel!]: { ...cs[sel!], ...p, config: p.config ?? cs[sel!].config } })); setDirty(d => d + 1) }}
                onDelete={() => { onNodesChange([{ type: 'remove', id: sel! }]) }} />
            )}
          </aside>
        )}

        {nodes.length <= 1 && canEdit && (
          <div className="fc-empty">
            <b>Build your flow</b>
            <span>Select <b>Start</b>, then add cards from <b>Add a card</b>. Drag from a card's bottom dot to another card to connect them.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================ triggers

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function Triggers({ wf, meta, canEdit, onChange }: { wf: Workflow; meta: WorkflowMeta | null | undefined; canEdit: boolean; onChange: (w: Workflow) => void }) {
  const toast = useToast()
  const [edit, setEdit] = useState<WorkflowTrigger | 'new' | null>(null)
  const [removing, setRemoving] = useState<WorkflowTrigger | null>(null)
  const filters = (t: WorkflowTrigger) => [
    t.client_type && BRAND_TYPE[t.client_type], t.client_status && CLIENT_STATUS[t.client_status as keyof typeof CLIENT_STATUS]?.label,
    t.brand_id && meta?.clients.find(c => c.id === t.brand_id)?.name,
    t.active_from && `from ${formatDate(t.active_from)}`, t.active_until && `until ${formatDate(t.active_until)}`,
  ].filter(Boolean).join(' · ')

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Triggers</h2><p>What starts this workflow. {!wf.is_live && <b>It's off, so triggers wait until you turn it on.</b>}</p></div>
        {canEdit && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEdit('new')}>Add trigger</Button>}
      </div>
      {!wf.triggers.length ? <Empty title="No triggers">Without one, the workflow only runs when someone presses Run now.</Empty> : (
        <div className="rows">
          {wf.triggers.map(t => (
            <div key={t.id} className="row-item" style={{ cursor: 'default' }}>
              <span className="af-ico sm">{t.type === 'event' ? <Zap size={15} /> : <CalendarClock size={15} />}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t">{t.name}{!t.is_active && <span className="pill" style={{ marginLeft: 8 }}>Paused</span>}</div>
                <div className="s">{t.summary}{filters(t) ? ` · ${filters(t)}` : ' · all clients'}</div>
              </div>
              {canEdit && <>
                <IconButton label="Edit trigger" onClick={() => setEdit(t)}><Pencil size={15} /></IconButton>
                <IconButton label="Delete trigger" className="danger" onClick={() => setRemoving(t)}><Trash2 size={15} /></IconButton>
              </>}
            </div>
          ))}
        </div>
      )}
      {edit && meta && <TriggerModal wf={wf} meta={meta} trigger={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={w => { onChange(w); setEdit(null) }} />}
      {removing && <Confirm title={`Delete “${removing.name}”?`} message="The workflow won't start this way any more." onClose={() => setRemoving(null)}
        onConfirm={async () => { try { onChange(await api<Workflow>(`/workflow-triggers/${removing.id}`, { method: 'DELETE' })); toast.success('Trigger deleted') } catch (e) { toast.error(e); throw e } }} />}
    </section>
  )
}

function TriggerModal({ wf, meta, trigger, onClose, onSaved }: { wf: Workflow; meta: WorkflowMeta; trigger: WorkflowTrigger | null; onClose: () => void; onSaved: (w: Workflow) => void }) {
  const toast = useToast()
  const [f, setF] = useState({
    name: trigger?.name ?? '', type: trigger?.type ?? 'schedule', frequency: trigger?.frequency ?? 'monthly',
    weekday: trigger?.weekday ?? 1, month_day: trigger?.month_day ?? 1, at_time: trigger?.at_time ?? '09:00',
    run_at: trigger?.run_at ? trigger.run_at.slice(0, 16).replace(' ', 'T') : '', event: trigger?.event ?? 'client.added',
    client_type: trigger?.client_type ?? '', client_status: trigger?.client_status ?? '', brand_id: trigger?.brand_id ? String(trigger.brand_id) : '',
    active_from: trigger?.active_from ?? '', active_until: trigger?.active_until ?? '', is_active: trigger?.is_active ?? true,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string | number | boolean) => setF({ ...f, [k]: v })
  const autoName = f.type === 'event'
    ? meta.events.find(e => e.key === f.event)?.label ?? ''
    : { daily: `Every day at ${f.at_time}`, weekly: `Every ${WEEKDAYS[Number(f.weekday) - 1]} at ${f.at_time}`, monthly: `Every month on day ${f.month_day} at ${f.at_time}`, once: 'Once' }[f.frequency as string] ?? ''

  async function save() {
    setBusy(true); setErrors({})
    const body = { ...f, name: f.name.trim() || autoName, brand_id: f.brand_id ? Number(f.brand_id) : null, run_at: f.run_at ? f.run_at.replace('T', ' ') : null }
    try {
      const w = trigger ? await api<Workflow>(`/workflow-triggers/${trigger.id}`, { method: 'PATCH', body }) : await api<Workflow>(`/workflows/${wf.id}/triggers`, { body })
      toast.success(trigger ? 'Trigger saved' : 'Trigger added'); onSaved(w)
    } catch (e) { if (e instanceof ApiError && e.details) setErrors(e.details); else toast.error(e); setBusy(false) }
  }

  return (
    <Modal title={trigger ? 'Edit trigger' : 'Add a trigger'} sub={wf.name} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" loading={busy} onClick={save}>{trigger ? 'Save' : 'Add trigger'}</Button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="af-kinds two-kinds">
          <button type="button" className={f.type === 'schedule' ? 'on' : ''} onClick={() => set('type', 'schedule')}><CalendarClock size={18} /><b>On a schedule</b><small>Every day, week or month, or once</small></button>
          <button type="button" className={f.type === 'event' ? 'on' : ''} onClick={() => set('type', 'event')}><Zap size={18} /><b>When something happens</b><small>A client is added, onboarding ends…</small></button>
        </div>

        {f.type === 'schedule' ? <>
          <div className="two">
            <Field label="How often" error={errors.frequency}>{id => <select id={id} className="select" value={f.frequency ?? 'monthly'} onChange={e => set('frequency', e.target.value)}>
              <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="once">Once</option>
            </select>}</Field>
            {f.frequency !== 'once' && <Field label="At" error={errors.at_time}>{id => <input id={id} className="input" type="time" value={f.at_time} onChange={e => set('at_time', e.target.value)} />}</Field>}
          </div>
          {f.frequency === 'weekly' && <Field label="On">{id => <select id={id} className="select" value={f.weekday} onChange={e => set('weekday', Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>}</Field>}
          {f.frequency === 'monthly' && <Field label="On day" error={errors.month_day} help="1 to 28, so it works in every month">{id => <input id={id} className="input" type="number" min={1} max={28} value={f.month_day} onChange={e => set('month_day', Number(e.target.value))} />}</Field>}
          {f.frequency === 'once' && <Field label="Date and time" error={errors.run_at}>{id => <input id={id} className="input" type="datetime-local" value={f.run_at} onChange={e => set('run_at', e.target.value)} />}</Field>}
        </> : (
          <Field label="When" error={errors.event}>{id => <select id={id} className="select" value={f.event} onChange={e => set('event', e.target.value)}>
            {meta.events.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>}</Field>
        )}

        <div className="section-rule">For which clients</div>
        <div className="two">
          <Field label="Client type">{id => <select id={id} className="select" value={f.client_type} onChange={e => set('client_type', e.target.value)}>
            <option value="">Any</option>{Object.entries(BRAND_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>}</Field>
          <Field label="Client status">{id => <select id={id} className="select" value={f.client_status} onChange={e => set('client_status', e.target.value)}>
            <option value="">Any</option>{Object.entries(CLIENT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>}</Field>
        </div>
        <Field label="Only this client" help="Optional">{id => <select id={id} className="select" value={f.brand_id} onChange={e => set('brand_id', e.target.value)}>
          <option value="">All matching clients</option>{meta.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>}</Field>
        <div className="two">
          <Field label="Active from" error={errors.active_from}>{id => <input id={id} className="input" type="date" value={f.active_from} onChange={e => set('active_from', e.target.value)} />}</Field>
          <Field label="Until" error={errors.active_until}>{id => <input id={id} className="input" type="date" value={f.active_until} onChange={e => set('active_until', e.target.value)} />}</Field>
        </div>
        <Field label="Name" help={`Leave empty to call it “${autoName}”`}>{id => <input id={id} className="input" value={f.name} onChange={e => set('name', e.target.value)} placeholder={autoName} />}</Field>
        <label className="fb-switch">
          <span className="grow"><b>Active</b><small>Pause it without deleting it</small></span>
          <button type="button" role="switch" aria-checked={f.is_active} className={`sw ${f.is_active ? 'on' : ''}`} onClick={() => set('is_active', !f.is_active)} />
        </label>
      </div>
    </Modal>
  )
}

// ============================================================================ run by hand

function RunNow({ wf, meta, onClose, onStarted }: { wf: Workflow; meta: WorkflowMeta; onClose: () => void; onStarted: () => void }) {
  const toast = useToast()
  const [picked, setPicked] = useState<number[]>([])
  const [type, setType] = useState('')
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [busy, setBusy] = useState(false)
  const clients = meta.clients.filter(c => !type || c.brand_type === type)
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id])

  return (
    <Modal title={`Run ${wf.name}`} sub="Starts now for each client you pick." onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" icon={<Play size={14} />} loading={busy} disabled={!picked.length} onClick={async () => {
        setBusy(true)
        try {
          const r = await api<{ started: string[]; skipped: string[] }>(`/workflows/${wf.id}/run`, { body: { client_ids: picked, period } })
          if (r.started.length) toast.success(`Started for ${r.started.join(', ')}`)
          if (r.skipped.length) toast.error(`Already ran for ${period}: ${r.skipped.join(', ')}`)
          onStarted()
        } catch (e) { toast.error(e); setBusy(false) }
      }}>Start for {picked.length || ''} {picked.length === 1 ? 'client' : 'clients'}</Button>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="between wrap" style={{ gap: 10 }}>
          <div className="seg" role="tablist" aria-label="Client type">
            {[['', 'All'], ['ecommerce', 'E-commerce'], ['lead_gen', 'Lead generation']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={type === k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>
            ))}
          </div>
          <button type="button" className="link-btn" onClick={() => setPicked(picked.length === clients.length ? [] : clients.map(c => c.id))}>{picked.length === clients.length && clients.length ? 'Clear' : 'Select all'}</button>
        </div>
        <div className="pick-list">
          {clients.map(c => (
            <label key={c.id} className={`pick-item ${picked.includes(c.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
              <span className="grow"><b>{c.name}</b><small>{BRAND_TYPE[c.brand_type]} · {CLIENT_STATUS[c.status as keyof typeof CLIENT_STATUS]?.label ?? c.status}</small></span>
            </label>
          ))}
        </div>
        <Field label="Period" help="Stops the same workflow running twice for a client in the same period. Leave empty to allow repeats.">
          {id => <input id={id} className="input" value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026-10" />}
        </Field>
      </div>
    </Modal>
  )
}
