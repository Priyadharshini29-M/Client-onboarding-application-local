import type { ClientStatus, DeliverableStatus, FormStatus, Role } from './types'

type Tone = '' | 'review' | 'ok' | 'change' | 'progress'

export const DELIVERABLE_STATUS: Record<DeliverableStatus, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: '' },
  in_progress: { label: 'In progress', tone: 'progress' },
  in_review: { label: 'Waiting for approval', tone: 'review' },
  changes_requested: { label: 'Needs changes', tone: 'change' },
  approved: { label: 'Approved', tone: 'ok' },
}

export const CLIENT_STATUS: Record<ClientStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: '' },
  in_progress: { label: 'In progress', tone: 'progress' },
  on_hold: { label: 'On hold', tone: 'change' },
  live: { label: 'Live', tone: 'ok' },
  retainer: { label: 'Retainer', tone: 'ok' },
}

export const FORM_STATUS: Record<FormStatus, { label: string; tone: Tone }> = {
  not_sent: { label: 'Not shared yet', tone: '' },
  sent: { label: 'Shared, not opened', tone: 'progress' },
  in_progress: { label: 'Client is filling it', tone: 'review' },
  submitted: { label: 'Submitted', tone: 'ok' },
}

export const BRAND_TYPE: Record<string, string> = {
  ecommerce: 'E-commerce brand', lead_gen: 'Lead generation',
}

export const PRIORITY: Record<string, { label: string; tone: '' | 'review' | 'change' | 'progress' | 'ok' }> = {
  low: { label: 'Low', tone: '' }, medium: { label: 'Medium', tone: 'progress' }, high: { label: 'High', tone: 'review' }, urgent: { label: 'Urgent', tone: 'change' },
}

export const BLOCK_TYPE: Record<string, string> = {
  text: 'Information', document: 'Document or file', link: 'Link', action: 'Action required',
}

export const CONTENT_STATUS: Record<string, { label: string; tone: '' | 'review' | 'change' | 'progress' | 'ok' }> = {
  pending: { label: 'Pending', tone: '' }, in_progress: { label: 'In progress', tone: 'progress' }, ready: { label: 'Ready', tone: 'review' },
  approved: { label: 'Approved', tone: 'ok' }, live: { label: 'Live', tone: 'ok' },
}

export function healthTone(n: number): string {
  return n >= 80 ? 'var(--ok)' : n >= 55 ? 'var(--review)' : 'var(--change)'
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  creative_head: 'Creative Head',
  project_manager: 'Project Manager',
  tech_lead: 'Tech Lead',
  member: 'Team member',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const parse = (v: string) => new Date(v.length <= 10 ? `${v}T00:00:00` : v.replace(' ', 'T'))

export function formatDate(value: string | null | undefined, withYear = false): string {
  if (!value) return '—'
  const d = parse(value)
  if (Number.isNaN(d.getTime())) return '—'
  const s = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return withYear || d.getFullYear() !== new Date().getFullYear() ? `${s} ${d.getFullYear()}` : s
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = parse(value)
  const h = d.getHours() % 12 || 12
  return `${formatDate(value)}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return ''
  const s = (Date.now() - parse(value).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return formatDate(value)
}

function daysFromToday(due: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((parse(due).getTime() - today.getTime()) / 86400000)
}

export function isLate(due: string | null, status?: string): boolean {
  if (!due || status === 'approved') return false
  return daysFromToday(due) < 0
}

export function dueText(due: string | null): string {
  if (!due) return 'No date'
  const d = daysFromToday(due)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d < 0) return `${-d}d late`
  if (d < 7) return `In ${d} days`
  return formatDate(due)
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

const AVATAR = ['#8A3FA8', '#B8532A', '#12807A', '#1D6A9E', '#5A6478', '#A86A12', '#2B7A4B']
export function avatarColor(seed: string | null | undefined): string {
  let h = 0
  for (const c of String(seed ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR[h % AVATAR.length]
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const pct = (done: number, total: number) => (total ? Math.round((Number(done) / Number(total)) * 100) : 0)

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export const ENTRY_STATUS: Record<string, { label: string; tone: '' | 'review' | 'change' | 'progress' | 'ok' }> = {
  waiting: { label: 'Waiting for approval', tone: 'review' },
  needs_changes: { label: 'Needs changes', tone: 'change' },
  approved: { label: 'Approved', tone: 'ok' },
}
export const ASSET_KIND: Record<string, { label: string; hint: string }> = {
  form: { label: 'Form', hint: 'One answer per field' },
  checklist: { label: 'Checklist', hint: 'Items to tick off' },
  calendar: { label: 'Calendar', hint: 'One row per post or date' },
}
export const FIELD_TYPE: Record<string, string> = {
  text: 'Short answer', textarea: 'Paragraph', number: 'Number', date: 'Date', select: 'Pick one', link: 'Link', checkbox: 'Tick box',
}
