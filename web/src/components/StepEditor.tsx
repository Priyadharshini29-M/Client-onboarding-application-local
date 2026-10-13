import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { BRAND_TYPE, CLIENT_STATUS } from '../lib/format'
import { APPROVERS, PLACEHOLDERS, STEP_META, StepIcon } from '../lib/workflow'
import type { StepConfig, StepType, WorkflowMeta } from '../lib/types'
import { Button, Field, Note } from './ui'

type Card = { type: StepType; title: string; config: StepConfig }

/** Settings for one card on the canvas. */
export function StepEditor({ card, meta, workflowId, incoming, disabled, onChange, onDelete }: {
  card: Card; meta: WorkflowMeta | null | undefined; workflowId: number; incoming: number; disabled: boolean
  onChange: (p: Partial<Card>) => void; onDelete: () => void
}) {
  const c = card.config ?? {}
  const set = (k: string, v: string | number | boolean | null) => onChange({ config: { ...c, [k]: v } })
  const str = (k: string) => (c[k] === null || c[k] === undefined ? '' : String(c[k]))
  const num = (v: string) => (v ? Number(v) : null)
  const teams = meta?.teams ?? []
  const people = meta?.people ?? []

  const brevoNote = meta && !meta.brevo && (
    <Note>Brevo isn't connected yet, so this is saved in Workflows → Messages but not sent. <Link to="/settings/integrations">Connect Brevo</Link></Note>
  )

  const recipient = (allow: string[]) => {
    const to = allow.includes(str('to')) ? str('to') : allow[0]
    return (
      <>
        <Field label="Send to">
          {id => <select id={id} className="select" value={to} disabled={disabled} onChange={e => set('to', e.target.value)}>
            {allow.includes('client') && <option value="client">The client</option>}
            {allow.includes('team') && <option value="team">Everyone in a department</option>}
            {allow.includes('client_lead') && <option value="client_lead">The client's lead in a department</option>}
            {allow.includes('role') && <option value="role">Everyone with a role</option>}
            {allow.includes('person') && <option value="person">One person</option>}
            {allow.includes('custom') && <option value="custom">Addresses I type</option>}
          </select>}
        </Field>
        {['team', 'client_lead'].includes(to) && (
          <Field label="Department">{id => <select id={id} className="select" value={str('team_id')} disabled={disabled} onChange={e => set('team_id', num(e.target.value))}>
            <option value="">Choose…</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>}</Field>
        )}
        {to === 'role' && (
          <Field label="Role">{id => <select id={id} className="select" value={str('role')} disabled={disabled} onChange={e => set('role', e.target.value)}>
            <option value="">Choose…</option>{Object.entries(APPROVERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="member">Team member</option>
          </select>}</Field>
        )}
        {to === 'person' && (
          <Field label="Person">{id => <select id={id} className="select" value={str('user_id')} disabled={disabled} onChange={e => set('user_id', num(e.target.value))}>
            <option value="">Choose…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}</Field>
        )}
        {to === 'custom' && card.type === 'email' && (
          <Field label="Email addresses" help="Separate with commas">{id => <input id={id} className="input" value={str('emails')} disabled={disabled} onChange={e => set('emails', e.target.value)} placeholder="name@company.com, other@company.com" />}</Field>
        )}
        {to === 'custom' && card.type !== 'email' && (
          <Field label="Phone numbers" help="With country code, separate with commas">{id => <input id={id} className="input" value={str('numbers')} disabled={disabled} onChange={e => set('numbers', e.target.value)} placeholder="+91 98765 43210" />}</Field>
        )}
      </>
    )
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="between">
        <span className="label row" style={{ gap: 8 }}><span className={`fc-ico t-${card.type}`}><StepIcon type={card.type} size={13} /></span>{STEP_META[card.type].label}</span>
        {!disabled && <Button size="sm" variant="ghost" className="danger-text" icon={<Trash2 size={14} />} onClick={onDelete}>Remove</Button>}
      </div>

      <Field label={card.type === 'task' ? 'Task name' : card.type === 'notify' ? 'Notification title' : card.type === 'condition' ? 'Question' : 'Card name'}>
        {id => <input id={id} className="input" value={card.title} disabled={disabled} onChange={e => onChange({ title: e.target.value })} />}
      </Field>

      {card.type === 'task' && <>
        <Field label="Department">{id => <select id={id} className="select" value={str('team_id')} disabled={disabled} onChange={e => set('team_id', num(e.target.value))}>
          <option value="">Choose…</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>}</Field>
        <Field label="Assign to">{id => <select id={id} className="select" value={str('assignee')} disabled={disabled} onChange={e => set('assignee', e.target.value)}>
          <option value="client_lead">The client's lead in this department</option>
          <option value="least_busy">The least busy person in this department</option>
          <option value="person">One person</option>
          <option value="">Nobody yet (the department picks it up)</option>
        </select>}</Field>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>
          {str('assignee') === 'least_busy' ? 'Goes to whoever in the department has the fewest open tasks.'
            : str('assignee') === 'person' ? 'Always goes to the same person, whatever the client.'
            : str('assignee') === '' ? 'Everyone in the department is told; one of them picks it up.'
            : "Set each client's leads on their Team tab. If a client has no lead here, it goes to the least busy person in the department."}
        </p>
        {str('assignee') === 'person' && (
          <Field label="Person">{id => <select id={id} className="select" value={str('assignee_id')} disabled={disabled} onChange={e => set('assignee_id', num(e.target.value))}>
            <option value="">Choose…</option>{people.filter(p => !c.team_id || p.team_id === Number(c.team_id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}</Field>
        )}
        <div className="two">
          <Field label="Due in (days)">{id => <input id={id} className="input" type="number" min={0} max={365} value={str('due_days')} disabled={disabled} onChange={e => set('due_days', e.target.value === '' ? null : Number(e.target.value))} />}</Field>
          <Field label="Priority">{id => <select id={id} className="select" value={str('priority') || 'medium'} disabled={disabled} onChange={e => set('priority', e.target.value)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>}</Field>
        </div>
        <Field label="Format to fill in" help="Optional. Links the task to a format in Assets.">{id => <select id={id} className="select" value={str('asset_format_id')} disabled={disabled} onChange={e => set('asset_format_id', num(e.target.value))}>
          <option value="">None</option>{meta?.formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>}</Field>
        <Field label="What needs to be done" help={`You can use ${PLACEHOLDERS}`}>{id => <textarea id={id} className="textarea" rows={3} value={str('description')} disabled={disabled} onChange={e => set('description', e.target.value)} />}</Field>
        <Note>The flow waits here until the task is done. To have it approved first, connect an <b>Approval</b> card right after it.</Note>
      </>}

      {card.type === 'approval' && <>
        <Field label="Who approves">{id => <select id={id} className="select" value={str('approver_role') || 'project_manager'} disabled={disabled} onChange={e => set('approver_role', e.target.value)}>
          {Object.entries(APPROVERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>}</Field>
        <Note>Put this right after a <b>Task</b> card. The task then goes to Approvals, and the flow moves on once it is approved. Rework happens inside the task.</Note>
      </>}

      {card.type === 'notify' && <>
        {recipient(['team', 'client_lead', 'role', 'person'])}
        <Field label="Message" help={`You can use ${PLACEHOLDERS}`}>{id => <textarea id={id} className="textarea" rows={3} value={str('message')} disabled={disabled} onChange={e => set('message', e.target.value)} placeholder="e.g. The calendar is approved. Plan the shoot for {client}." />}</Field>
        <label className="check"><input type="checkbox" checked={Boolean(c.also_email)} disabled={disabled} onChange={e => set('also_email', e.target.checked)} /> Also send it by email</label>
      </>}

      {card.type === 'email' && <>
        {recipient(['team', 'client_lead', 'role', 'person', 'custom'])}
        <Field label="CC" help="Optional, separate with commas">{id => <input id={id} className="input" value={str('cc')} disabled={disabled} onChange={e => set('cc', e.target.value)} />}</Field>
        <Field label="Subject">{id => <input id={id} className="input" value={str('subject')} disabled={disabled} onChange={e => set('subject', e.target.value)} placeholder="Your {period} content is ready" />}</Field>
        <Field label="Message" help={`You can use ${PLACEHOLDERS}`}>{id => <textarea id={id} className="textarea" rows={6} value={str('body')} disabled={disabled} onChange={e => set('body', e.target.value)} />}</Field>
        {brevoNote}
      </>}

      {(card.type === 'sms' || card.type === 'whatsapp') && <>
        {recipient(['person', 'team', 'client_lead', 'role', 'custom'])}
        <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>Uses the phone numbers in Settings → People.</p>
        {card.type === 'whatsapp' && (
          <Field label="Template ID" help="Needed to message someone who hasn't written to you in the last 24 hours. Leave empty to send the text below.">
            {id => <input id={id} className="input" type="number" value={str('template_id')} disabled={disabled} onChange={e => set('template_id', num(e.target.value))} placeholder="e.g. 12" />}
          </Field>
        )}
        <Field label="Message" help={card.type === 'sms' ? `Up to 160 characters per SMS. You can use ${PLACEHOLDERS}` : `You can use ${PLACEHOLDERS}`}>
          {id => <textarea id={id} className="textarea" rows={4} value={str('message')} disabled={disabled} onChange={e => set('message', e.target.value)} />}
        </Field>
        {card.type === 'sms' && <span className="muted" style={{ fontSize: 12.5, marginTop: -10 }}>{str('message').length} characters</span>}
        {brevoNote}
      </>}

      {card.type === 'api' && <>
        <div className="api-url">
          <select className="select" value={str('method') || 'POST'} disabled={disabled} onChange={e => set('method', e.target.value)} aria-label="Method">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}
          </select>
          <input className="input mono" value={str('url')} disabled={disabled} onChange={e => set('url', e.target.value)} placeholder="https://hooks.example.com/new-client" aria-label="URL" />
        </div>
        <Field label="Headers" help="One per line, e.g. Authorization: Bearer abc123">{id => <textarea id={id} className="textarea mono" rows={2} value={str('headers')} disabled={disabled} onChange={e => set('headers', e.target.value)} />}</Field>
        <Field label="Body (JSON)" help={`You can use ${PLACEHOLDERS}`}>{id => <textarea id={id} className="textarea mono" rows={4} value={str('body')} disabled={disabled} onChange={e => set('body', e.target.value)} placeholder={'{"client": "{client}"}'} />}</Field>
        <Field label="Try again">{id => <select id={id} className="select" value={str('retries') || '1'} disabled={disabled} onChange={e => set('retries', Number(e.target.value))}>
          <option value="0">Don't retry</option><option value="1">Once</option><option value="2">Twice</option><option value="3">3 times</option>
        </select>}</Field>
      </>}

      {['email', 'sms', 'whatsapp', 'api'].includes(card.type) && (
        <Field label="If it fails">{id => <select id={id} className="select" value={str('on_fail') || 'continue'} disabled={disabled} onChange={e => set('on_fail', e.target.value)}>
          <option value="continue">Carry on with the flow</option><option value="stop">Stop the whole flow</option>
        </select>}</Field>
      )}

      {card.type === 'wait' && (
        <div className="two">
          <Field label="Wait for">{id => <input id={id} className="input" type="number" min={0} max={365} value={str('amount')} disabled={disabled} onChange={e => set('amount', e.target.value === '' ? null : Number(e.target.value))} />}</Field>
          <Field label="Unit">{id => <select id={id} className="select" value={str('unit') || 'days'} disabled={disabled} onChange={e => set('unit', e.target.value)}>
            <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option>
          </select>}</Field>
        </div>
      )}

      {card.type === 'condition' && <>
        <div className="two">
          <Field label="If">{id => <select id={id} className="select" value={str('field') || 'client.type'} disabled={disabled} onChange={e => onChange({ config: { ...c, field: e.target.value, value: '' } })}>
            <option value="client.type">Client type</option><option value="client.status">Client status</option><option value="client.industry">Industry</option><option value="client.tags">Tags</option>
          </select>}</Field>
          <Field label="Is">{id => <select id={id} className="select" value={str('op') || 'is'} disabled={disabled} onChange={e => set('op', e.target.value)}>
            <option value="is">is</option><option value="is_not">is not</option><option value="contains">contains</option>
          </select>}</Field>
        </div>
        <Field label="Value">{id => (str('field') || 'client.type') === 'client.type'
          ? <select id={id} className="select" value={str('value')} disabled={disabled} onChange={e => set('value', e.target.value)}><option value="">Choose…</option>{Object.entries(BRAND_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          : str('field') === 'client.status'
            ? <select id={id} className="select" value={str('value')} disabled={disabled} onChange={e => set('value', e.target.value)}><option value="">Choose…</option>{Object.entries(CLIENT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
            : <input id={id} className="input" value={str('value')} disabled={disabled} onChange={e => set('value', e.target.value)} />}
        </Field>
        <Note>Drag from the green <b>Yes</b> dot to the card for “yes”, and from the red <b>No</b> dot for “no”. Leave one empty to end that path.</Note>
      </>}

      {card.type === 'start_workflow' && (
        <Field label="Workflow to start" help="It starts for the same client.">{id => <select id={id} className="select" value={str('workflow_id')} disabled={disabled} onChange={e => set('workflow_id', num(e.target.value))}>
          <option value="">Choose…</option>{meta?.workflows.filter(w => w.id !== workflowId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>}</Field>
      )}

      {incoming > 1 && (
        <Field label={`${incoming} arrows come into this card`}>{id => <select id={id} className="select" value={str('join') || 'any'} disabled={disabled} onChange={e => set('join', e.target.value)}>
          <option value="any">Start when the first one arrives</option>
          <option value="all">Wait until all of them arrive</option>
        </select>}</Field>
      )}
    </div>
  )
}
