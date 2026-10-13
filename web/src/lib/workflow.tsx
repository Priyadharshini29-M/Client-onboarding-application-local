import { Bell, ClipboardCheck, Globe, Hourglass, Mail, MessageCircle, MessageSquareText, PlayCircle, ShieldCheck, Split } from 'lucide-react'
import { ROLE_LABEL } from './format'
import type { RunStatus, StepConfig, StepType, WorkflowMeta, WorkflowStep } from './types'

/** Each card type: label, one-line hint, icon, and which group it sits in on the palette. */
export const STEP_META: Record<StepType, { label: string; hint: string; icon: typeof Bell; group: 'Work' | 'Messages' | 'Logic' }> = {
  task: { label: 'Task', hint: 'Give a department work to do', icon: ClipboardCheck, group: 'Work' },
  approval: { label: 'Approval', hint: 'Someone approves the task above', icon: ShieldCheck, group: 'Work' },
  notify: { label: 'Notify', hint: 'Alert a team or person in the app', icon: Bell, group: 'Messages' },
  email: { label: 'Email', hint: 'Email the team through Brevo', icon: Mail, group: 'Messages' },
  sms: { label: 'SMS', hint: 'Text a teammate through Brevo', icon: MessageSquareText, group: 'Messages' },
  whatsapp: { label: 'WhatsApp', hint: 'WhatsApp a teammate through Brevo', icon: MessageCircle, group: 'Messages' },
  wait: { label: 'Wait', hint: 'Pause before carrying on', icon: Hourglass, group: 'Logic' },
  condition: { label: 'Condition', hint: 'Split into Yes and No paths', icon: Split, group: 'Logic' },
  api: { label: 'API call', hint: 'Send data to another tool', icon: Globe, group: 'Logic' },
  start_workflow: { label: 'Start workflow', hint: 'Kick off another workflow', icon: PlayCircle, group: 'Logic' },
}
export const STEP_GROUPS: { name: string; types: StepType[] }[] = [
  { name: 'Work', types: ['task', 'approval'] },
  { name: 'Messages', types: ['notify', 'email', 'sms', 'whatsapp'] },
  { name: 'Logic', types: ['wait', 'condition', 'api', 'start_workflow'] },
]

export function StepIcon({ type, size = 16 }: { type: StepType; size?: number }) {
  const Icon = STEP_META[type]?.icon ?? ClipboardCheck
  return <Icon size={size} aria-hidden="true" />
}

export const APPROVERS: Record<string, string> = {
  project_manager: 'Project Manager', creative_head: 'Creative Head', tech_lead: 'Tech Lead', admin: 'Admin', super_admin: 'Owner',
}
export const approverLabel = (role: string | null | undefined) =>
  role === 'auto' ? 'No approval needed' : role ? APPROVERS[role] ?? ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role : ''

export const RUN_STATUS: Record<RunStatus, { label: string; tone: '' | 'review' | 'change' | 'progress' | 'ok' }> = {
  running: { label: 'Running', tone: 'progress' },
  waiting: { label: 'In progress', tone: 'progress' },
  done: { label: 'Finished', tone: 'ok' },
  stopped: { label: 'Stopped', tone: '' },
  failed: { label: 'Failed', tone: 'change' },
}

export const PLACEHOLDERS = '{client} {contact} {period} {date} {link}'

/** Shows card names the way a run sees them: {client} and {period} filled in. */
export const fillText = (text: string | null | undefined, run: { client_name: string; period: string | null }) =>
  (text ?? '').replace(/\{client\}/g, run.client_name).replace(/\{period\}/g, run.period ?? '')

function who(c: StepConfig, meta?: WorkflowMeta | null): string {
  const team = meta?.teams.find(t => t.id === Number(c.team_id))?.name
  switch (c.to) {
    case 'client': return 'the client'
    case 'role': return c.role ? `every ${approverLabel(String(c.role))}` : 'a role'
    case 'client_lead': return team ? `the client's ${team} lead` : "the client's lead"
    case 'person': return meta?.people.find(p => p.id === Number(c.user_id))?.name ?? 'a person'
    case 'custom': return String(c.emails || c.numbers || 'addresses you typed')
    default: return team ? `the ${team} team` : 'a department'
  }
}

/** One plain line on each card. */
export function stepSummary(s: Pick<WorkflowStep, 'type' | 'config'>, meta?: WorkflowMeta | null): string {
  const c = s.config ?? {}
  switch (s.type) {
    case 'task': {
      const team = meta?.teams.find(t => t.id === Number(c.team_id))?.name ?? 'No department yet'
      const by = c.assignee === 'person' ? meta?.people.find(p => p.id === Number(c.assignee_id))?.name : c.assignee === 'least_busy' ? 'least busy' : c.assignee === '' ? 'anyone' : 'client’s lead'
      return `${team}${by ? ` (${by})` : ''} · due in ${c.due_days ?? 3} days`
    }
    case 'approval': return approverLabel(String(c.approver_role ?? 'project_manager'))
    case 'notify': return `To ${who(c, meta)}`
    case 'email': return `To ${who({ ...c, to: c.to ?? 'team' }, meta)}`
    case 'sms': case 'whatsapp': return `To ${who({ ...c, to: c.to ?? 'person' }, meta)}`
    case 'api': return c.url ? `${c.method ?? 'POST'} ${String(c.url).replace(/^https?:\/\//, '')}` : 'No URL yet'
    case 'wait': return `${c.amount ?? 1} ${c.unit ?? 'days'}`
    case 'condition': {
      const field = { 'client.type': 'Client type', 'client.status': 'Client status', 'client.industry': 'Industry', 'client.tags': 'Tags' }[String(c.field ?? 'client.type')]
      const op = { is: 'is', is_not: 'is not', contains: 'contains' }[String(c.op ?? 'is')]
      return `${field} ${op} “${c.value ?? ''}”`
    }
    case 'start_workflow': {
      const w = meta?.workflows.find(x => x.id === Number(c.workflow_id))
      return w ? `Starts “${w.name}”` : 'No workflow chosen'
    }
  }
  return ''
}

export function newStepDefaults(type: StepType): { title: string; config: StepConfig } {
  const d: Record<StepType, [string, StepConfig]> = {
    task: ['New task', { due_days: 3, assignee: 'client_lead', priority: 'medium' }],
    approval: ['Approval', { approver_role: 'project_manager' }],
    notify: ['Heads up: {client}', { to: 'team', message: '' }],
    email: ['Email the team', { to: 'team', subject: '', body: '' }],
    sms: ['Text a teammate', { to: 'person', message: '' }],
    whatsapp: ['WhatsApp a teammate', { to: 'person', message: '' }],
    api: ['Send to another tool', { method: 'POST', url: '', retries: 1, on_fail: 'continue' }],
    wait: ['Wait', { amount: 1, unit: 'days' }],
    condition: ['Is it…?', { field: 'client.type', op: 'is', value: 'ecommerce' }],
    start_workflow: ['Start another workflow', {}],
  }
  return { title: d[type][0], config: d[type][1] }
}
