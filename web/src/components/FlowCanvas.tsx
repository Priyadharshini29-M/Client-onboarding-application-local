import { memo, useMemo, useRef, type ReactElement } from 'react'
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, Background, Controls, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { CalendarClock, Check, Clock, X, AlertTriangle } from 'lucide-react'
import { STEP_META, StepIcon, fillText } from '../lib/workflow'
import type { StepType, WorkflowEdge } from '../lib/types'

export type CardState = 'not_reached' | 'pending' | 'active' | 'done' | 'skipped' | 'failed'
export type CardData = { type: StepType; title: string; summary: string; warn?: string | null; state?: CardState; waiting?: string | null }
export type StartData = { summary: string; state?: CardState }
export type CardNode = Node<CardData, 'card'>
export type StartNode = Node<StartData, 'start'>
export type FlowNode = CardNode | StartNode
export type FlowEdgeData = { branch: 'next' | 'yes' | 'no'; onDelete?: (id: string) => void; active?: boolean }
export type FlowEdge = Edge<FlowEdgeData, 'flow'>

const STATE_ICON: Partial<Record<CardState, ReactElement>> = {
  done: <Check size={12} />, active: <Clock size={12} />, failed: <X size={12} />,
}
const STATE_LABEL: Partial<Record<CardState, string>> = { done: 'Done', active: 'Now', skipped: 'Skipped', failed: 'Failed', pending: 'Waiting' }

export const CardNodeView = memo(function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  const meta = STEP_META[data.type]
  return (
    <div className={`fc-card t-${data.type} ${selected ? 'sel' : ''} ${data.state ? `st-${data.state}` : ''} ${data.warn ? 'has-warn' : ''}`}>
      <Handle type="target" position={Position.Top} className="fc-handle" />
      <div className="fc-head">
        <span className={`fc-ico t-${data.type}`}><StepIcon type={data.type} size={14} /></span>
        <span className="fc-type">{meta.label}</span>
        {data.state && STATE_LABEL[data.state] && <span className={`fc-state st-${data.state}`}>{STATE_ICON[data.state]}{STATE_LABEL[data.state]}</span>}
      </div>
      <div className="fc-title">{data.title}</div>
      {data.summary && <div className="fc-sum">{data.summary}</div>}
      {data.waiting && <div className="fc-sum fc-waiting">{data.waiting}</div>}
      {data.warn && <div className="fc-warn"><AlertTriangle size={12} />{data.warn}</div>}
      {data.type === 'condition' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="yes" className="fc-handle yes" style={{ left: '28%' }} />
          <Handle type="source" position={Position.Bottom} id="no" className="fc-handle no" style={{ left: '72%' }} />
          <span className="fc-branch yes" style={{ left: '28%' }}>Yes</span>
          <span className="fc-branch no" style={{ left: '72%' }}>No</span>
        </>
      ) : <Handle type="source" position={Position.Bottom} id="next" className="fc-handle" />}
    </div>
  )
})

export const StartNodeView = memo(function StartNodeView({ data, selected }: NodeProps<StartNode>) {
  return (
    <div className={`fc-start ${selected ? 'sel' : ''}`}>
      <span className="fc-start-ico"><CalendarClock size={15} /></span>
      <span className="fc-start-text"><b>Start</b><small>{data.summary}</small></span>
      <Handle type="source" position={Position.Bottom} id="next" className="fc-handle" />
    </div>
  )
})

export function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data, selected }: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 22 })
  const branch = data?.branch ?? 'next'
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className={`fc-edge b-${branch} ${selected ? 'sel' : ''} ${data?.active ? 'active' : ''}`} />
      {(branch !== 'next' || (selected && data?.onDelete)) && (
        <EdgeLabelRenderer>
          <div className="fc-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {branch !== 'next' && <span className={`fc-edge-tag ${branch}`}>{branch === 'yes' ? 'Yes' : 'No'}</span>}
            {selected && data?.onDelete && <button type="button" className="fc-edge-del" onClick={() => data.onDelete!(id)} aria-label="Remove arrow"><X size={12} /></button>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const nodeTypes = { card: CardNodeView, start: StartNodeView }
export const edgeTypes = { flow: FlowEdgeView }
export const arrow = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--fc-line)' }

export const edgeId = (e: WorkflowEdge) => `${e.from}:${e.branch}:${e.to}`

/** A run drawn on the workflow's canvas: which cards are done, which is active now. Read-only. */
export function RunCanvas({ run }: {
  run: { client_name: string; period: string | null; steps: { id: number; type: StepType; title: string; x: number; y: number; state: CardState; waiting_for: string | null; wait_until: string | null }[]; edges: WorkflowEdge[] }
}) {
  const { nodes, edges } = useMemo(() => {
    const minY = Math.min(...run.steps.map(s => s.y), 120)
    const entries = run.edges.filter(e => e.from === 'start').map(e => run.steps.find(s => String(s.id) === e.to)).filter(Boolean)
    const startX = entries.length ? entries.reduce((a, s) => a + s!.x, 0) / entries.length : 160
    const nodes: FlowNode[] = [
      { id: 'start', type: 'start', position: { x: startX + 20, y: minY - 120 }, data: { summary: 'Run started', state: 'done' }, draggable: false, selectable: false },
      ...run.steps.map(s => ({
        id: String(s.id), type: 'card' as const, position: { x: s.x, y: s.y }, draggable: false, selectable: false,
        data: { type: s.type, title: fillText(s.title, run), summary: '', state: s.state,
          waiting: s.state === 'active' ? (s.waiting_for === 'time' && s.wait_until ? `Until ${new Date(s.wait_until.replace(' ', 'T')).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : s.waiting_for === 'task' ? 'Waiting for the task' : null) : null },
      })),
    ]
    const stateOf = (id: string) => run.steps.find(s => String(s.id) === id)?.state
    const edges: FlowEdge[] = run.edges.map(e => ({
      id: edgeId(e), source: e.from, target: e.to, sourceHandle: e.branch, type: 'flow', markerEnd: arrow,
      data: { branch: e.branch, active: (e.from === 'start' || ['done', 'skipped'].includes(stateOf(e.from) ?? '')) && ['active', 'done', 'skipped', 'failed'].includes(stateOf(e.to) ?? '') },
      selectable: false,
    }))
    return { nodes, edges }
  }, [run])

  return (
    <div className="fc-wrap run">
      <ReactFlowProvider>
        <RunFlow nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  )
}

/** Opens centred on the active card at a readable zoom, instead of shrinking the whole flow. */
function RunFlow({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  const flow = useReactFlow()
  const box = useRef<HTMLDivElement>(null)
  function focus() {
    const w = box.current?.clientWidth ?? 600
    const h = box.current?.clientHeight ?? 420
    const cards = nodes.filter(n => n.type === 'card')
    const target = cards.find(n => (n.data as CardData).state === 'active') ?? nodes[0]
    const minX = Math.min(...nodes.map(n => n.position.x)), maxX = Math.max(...nodes.map(n => n.position.x)) + 260
    const zoom = Math.max(0.5, Math.min(0.85, (w - 60) / Math.max(1, maxX - minX)))
    flow.setViewport({ x: w / 2 - ((minX + maxX) / 2) * zoom, y: h * 0.35 - (target.position.y + 50) * zoom, zoom })
  }
  return (
    <div ref={box} style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={() => setTimeout(focus, 30)}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.3} maxZoom={1.4}>
        <Background gap={20} size={1.2} color="var(--fc-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
