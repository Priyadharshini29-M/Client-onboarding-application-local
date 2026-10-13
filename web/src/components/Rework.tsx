import { Plus, X } from 'lucide-react'
import { IconButton } from './ui'

/** Rework notes are saved as "• point" lines, so they read fine anywhere. */
export const reworkNote = (points: string[]) => points.map(p => p.trim()).filter(Boolean).map(p => `• ${p}`).join('\n')

export function reworkPoints(note: string | null | undefined): string[] | null {
  if (!note) return null
  const lines = note.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length && lines.every(l => /^[•-]\s+/.test(l)) ? lines.map(l => l.replace(/^[•-]\s+/, '')) : null
}

/** Shows what the approver asked to change: a numbered list, or the plain note for older entries. */
export function ReworkList({ note }: { note: string | null }) {
  if (!note) return null
  const points = reworkPoints(note)
  if (!points) return <p className="rework-text">{note}</p>
  return (
    <ol className="rework-list">
      {points.map((p, i) => <li key={i}><span className="n">{i + 1}</span><span>{p}</span></li>)}
    </ol>
  )
}

/** A numbered list of changes. Enter adds the next point. */
export function ReworkEditor({ points, onChange }: { points: string[]; onChange: (p: string[]) => void }) {
  return (
    <div className="rework-inputs">
      {points.map((p, i) => (
        <div key={i} className="rework-input">
          <span className="n">{i + 1}</span>
          <input className="input sm grow" value={p} autoFocus={i === points.length - 1} placeholder={i === 0 ? 'e.g. Make the logo bigger' : 'Another change'}
            onChange={e => onChange(points.map((x, j) => (j === i ? e.target.value : x)))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onChange([...points.slice(0, i + 1), '', ...points.slice(i + 1)]) } }}
            aria-label={`Change ${i + 1}`} />
          {points.length > 1 && <IconButton label={`Remove change ${i + 1}`} onClick={() => onChange(points.filter((_, j) => j !== i))}><X size={14} /></IconButton>}
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...points, ''])}><Plus size={14} /> Add another point</button>
    </div>
  )
}
