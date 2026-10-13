export type Role = 'super_admin' | 'admin' | 'creative_head' | 'project_manager' | 'tech_lead' | 'member'
export type BrandType = 'ecommerce' | 'lead_gen'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface ClientTeamRow { team_id: number; team_name: string; icon: string; user_id: number | null; user_name: string | null; assigned_at: string | null }

export interface ClientDocument { id: number; name: string; status: 'pending' | 'uploaded' | 'approved'; due_date: string | null; file_name: string | null; file_size: number | null; uploaded_at: string | null }

export type ContentStatus = 'pending' | 'in_progress' | 'ready' | 'approved' | 'live'
export interface ContentRow {
  id: number; brand_id: number; brand_name: string; month: string; post_date: string | null; funnel: 'top' | 'mid' | 'bot' | null
  one_liner: string | null; concept: string | null; post_type: string | null; concept_idea: string | null; copy: string | null
  caption: string | null; channels: string | null; status: ContentStatus; assignee_id: number | null; assignee_name: string | null
  output_due: string | null; live_date: string | null
}

export type ClientStatus = 'new' | 'in_progress' | 'on_hold' | 'live' | 'retainer'
export type ProjectStatus = 'active' | 'on_hold' | 'completed'
export type StageStatus = 'locked' | 'open' | 'done'
export type DeliverableStatus = 'not_started' | 'in_progress' | 'in_review' | 'changes_requested' | 'approved'
export type FormStatus = 'not_sent' | 'sent' | 'in_progress' | 'submitted'
export type FieldType = 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'date' | 'number' | 'select' | 'file' | 'secret'

export interface User {
  id: number
  name: string
  email: string
  phone?: string | null
  role: Role
  team_id: number | null
  team_name: string | null
  is_active?: number
  created_at?: string
  joined_at?: string | null
  invite_expires_at?: string | null
  invited_at?: string | null
}

export interface Team { id: number; name: string; slug: string; icon: string; member_count: number }

export interface ClientRow {
  id: number
  name: string
  email: string | null
  contact_name: string | null
  phone: string | null
  website: string | null
  industry: string | null
  brand_type: BrandType
  profile: Record<string, string>
  logo_url: string | null
  tags: string[]
  status: ClientStatus
  onboarding_started_at: string | null
  retainer_at: string | null
  open_work: number
  late_count: number
  blocked_count: number
  docs_total: number
  docs_pending: number
  health: number
  health_reasons: string[]
  created_at: string
  updated_at: string
  owner_id: number | null
  owner_name: string | null
  intake_status: FormStatus | null
  project_id: number | null
  project_name: string | null
  project_status: ProjectStatus | null
  current_stage: number | null
  target_date: string | null
  stage_count: number
  stage_name: string | null
  stage_icon: string | null
  in_review: number
  approved: number
  deliverable_count: number
  setup_total: number
  setup_done: number
  asset_count: number
  intake_submitted_at: string | null
}

export interface SetupItem {
  id: number
  title: string
  status: 'pending' | 'in_progress' | 'done'
  done: number
  owner_id: number | null
  owner_name: string | null
  due_date: string | null
  note: string | null
  done_at: string | null
  attachments: Pick<Asset, 'id' | 'kind' | 'title' | 'url' | 'file_name' | 'file_size'>[]
}

export type AssetCategory = 'brand' | 'legal' | 'product' | 'access' | 'other'

export interface Asset {
  id: number
  brand_id: number
  brand_name: string
  setup_item_id: number | null
  kind: 'link' | 'file'
  title: string
  category: AssetCategory
  url: string | null
  file_name: string | null
  file_size: number | null
  created_at: string
  added_by_name: string | null
}

export interface ActivityItem {
  id: number
  action: string
  message: string
  created_at: string
  brand_id: number | null
  brand_name: string | null
  user_name: string | null
}

export interface ClientDetail extends ClientRow {
  team: ClientTeamRow[]
  projects: { id: number; name: string; status: ProjectStatus; started_at: string; completed_at: string | null }[]
  activity: ActivityItem[]
}

export interface Deliverable {
  id: number
  project_id: number
  stage_id: number
  kind: 'work' | 'intake'
  title: string
  brief: string | null
  assignee_id: number | null
  assignee_name: string | null
  due_date: string | null
  status: DeliverableStatus
  version_count: number
  priority: Priority
  tags: string[]
  blocked: boolean
  block_who: string | null
  block_type: 'text' | 'document' | 'link' | 'action' | null
  block_reason: string | null
  block_response: string | null
  blocked_at: string | null
  blocked_by_name: string | null
  approved_at: string | null
  approved_by_name: string | null
  updated_at: string
  stage_name: string
  stage_no: number
  stage_status: StageStatus
  approver_role: Role
  team_id: number | null
  team_name: string | null
  team_icon: string | null
  brand_id: number
  brand_name: string
  can_review?: boolean
  project_kind?: 'onboarding' | 'workflow'; project_name?: string; asset_format_id?: number | null; asset_format_name?: string | null
}

export interface Comment { id: number; version_id: number; body: string; created_at: string; user_name: string | null }

export interface Version {
  id: number
  version_no: number
  note: string | null
  link_url: string | null
  file_name: string | null
  file_size: number | null
  status: 'in_review' | 'approved' | 'changes_requested'
  created_at: string
  created_by_name: string | null
  decided_at: string | null
  decided_by_name: string | null
  decision_note: string | null
  comments: Comment[]
}

export interface DeliverableDetail extends Deliverable {
  versions: Version[]
  can_review: boolean
  intake_status?: FormStatus
}

export interface Stage {
  id: number
  position: number
  name: string
  summary: string | null
  team_id: number | null
  team_name: string | null
  team_icon: string | null
  approver_role: Role
  status: StageStatus
  opened_at: string | null
  due_date: string | null
  done_at: string | null
  deliverables: Deliverable[]
  can_review: boolean
}

export interface Project {
  id: number
  brand_id: number
  brand_name: string
  name: string
  status: ProjectStatus
  current_stage: number
  owner_name: string | null
  started_at: string
  target_date: string | null
  completed_at: string | null
  stages: Stage[]
  progress: { done: number; total: number }
}

export interface Blueprint {
  id: number
  client_type: BrandType
  name: string
  description: string | null
  stages: { id: number; position: number; name: string; summary: string | null; approver_role: Role; duration_days: number; team_name: string | null; team_icon: string | null; deliverable_count: number }[]
}

export interface TemplateField {
  id: number
  section_id: number
  label: string
  type: FieldType
  placeholder: string | null
  options: string[]
  required: boolean
  position: number
}
export interface TemplateSection { id: number; title: string; position: number; fields: TemplateField[] }
export interface Template { id: number; name: string; category: string; description: string | null; sections: TemplateSection[] }
export interface TemplateSummary { id: number; name: string; category: string; description: string | null; section_count: number; field_count: number; brand_count: number }

export interface FileValue { name: string; size: number; uploaded_at: string }

export interface FormPayload {
  submission: { id: number; kind: 'intake'; status: FormStatus; submitted_at: string | null; updated_at: string; link: string; filled: number; total: number }
  brand: { id: number; name: string }
  template: Template
  values: Record<string, string | FileValue | null>
  secrets_set: Record<string, boolean>
}

export interface HomeData {
  reviews: Deliverable[]
  work: Deliverable[]
  projects: {
    id: number; name: string; status: ProjectStatus; current_stage: number; target_date: string | null
    client_id: number; client_name: string; stage_count: number; stage_name: string | null; stage_icon: string | null
    team_name: string | null; in_review: number; late: number
  }[]
  counts: { active_projects: number; late: number; forms_out: number; approved_week: number }
  activity: ActivityItem[]
}

export interface DecidedReview {
  version_id: number; version_no: number; status: 'approved' | 'changes_requested'; decided_at: string; decision_note: string | null
  decided_by_name: string | null; id: number; title: string; kind: 'work' | 'intake'; stage_name: string; brand_name: string; brand_id: number
}

// Asset formats ------------------------------------------------------------------------------
export type AssetKind = 'form' | 'checklist' | 'calendar'
export type AssetFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'link' | 'checkbox'
export type EntryStatus = 'waiting' | 'needs_changes' | 'approved'
export interface AssetFormatRow {
  id: number; name: string; slug: string; kind: AssetKind; description: string | null; is_active: number | boolean
  field_count: number; entry_count: number; waiting_count: number
}
export interface AssetField {
  id: number; label: string; field_key: string; type: AssetFieldType; options: string[]; placeholder: string | null; required: boolean; position: number
}
export interface AssetFormat {
  id: number; name: string; slug: string; kind: AssetKind; description: string | null; is_active: boolean; entry_count: number; fields: AssetField[]
}
export type EntryValues = Record<string, string | number | boolean | null>
export interface AssetEntry {
  id: number; format_id: number; format_name: string; kind: AssetKind; brand_id: number; brand_name: string; title: string
  values: EntryValues | EntryValues[]; status: EntryStatus; review_note: string | null
  created_at: string; updated_at: string; created_by_name: string | null; reviewed_by_name: string | null
}

export interface ApprovalItem {
  type: 'task' | 'asset'; key: string; id: number; format_id?: number; title: string
  client_id: number; client_name: string; context: string; label: string; kind?: AssetKind
  team_name: string | null; team_icon: string | null; approver: string; can_approve: boolean
  status: 'waiting' | 'needs_changes' | 'approved'
  submitted_at: string; submitted_by: string | null; decided_at: string | null; decided_by: string | null; note: string | null; change_note: string | null
  waiting_hours: number | null; revision: { no: number } | null
  progress: { done: number; total: number; label: string }
}
export interface ApprovalSummary {
  waiting: number; waiting_for_me: number; waiting_long: number; approved_week: number; sent_back_week: number; avg_hours: number | null; mine_waiting: number
}

// Workflows ------------------------------------------------------------------------------------
export type StepType = 'task' | 'approval' | 'notify' | 'email' | 'sms' | 'whatsapp' | 'api' | 'wait' | 'condition' | 'start_workflow'
export type StepConfig = Record<string, string | number | boolean | null | undefined>
export interface WorkflowStep { id: number; type: StepType; title: string; config: StepConfig; x: number; y: number }
export interface WorkflowEdge { from: string; to: string; branch: 'next' | 'yes' | 'no' }
export interface WorkflowTrigger {
  id: number; workflow_id: number; name: string; type: 'schedule' | 'event'; frequency: 'daily' | 'weekly' | 'monthly' | 'once' | null
  weekday: number | null; month_day: number | null; at_time: string | null; run_at: string | null; event: string | null
  client_type: string | null; client_status: string | null; brand_id: number | null; active_from: string | null; active_until: string | null
  is_active: boolean; last_fired_at: string | null; summary: string
}
export interface Workflow {
  id: number; name: string; description: string | null; is_live: boolean; steps: WorkflowStep[]; edges: WorkflowEdge[]; triggers: WorkflowTrigger[]; active_runs: number
  key_map?: Record<string, number>; start: { x: number; y: number }
}
export interface WorkflowRow {
  id: number; name: string; description: string | null; is_live: boolean; step_count: number; step_types: string | null
  active_runs: number; total_runs: number; last_run_at: string | null; triggers: string[]
}
export interface WorkflowMeta {
  events: { key: string; label: string }[]; teams: { id: number; name: string; icon: string }[]
  people: { id: number; name: string; role: Role; team_id: number | null }[]; formats: { id: number; name: string; kind: AssetKind }[]
  workflows: { id: number; name: string }[]; clients: { id: number; name: string; brand_type: string; status: string }[]; mail_enabled: boolean; brevo: boolean
}
export type RunStatus = 'running' | 'waiting' | 'done' | 'stopped' | 'failed'
export interface WorkflowRun {
  id: number; workflow_id: number; workflow_name: string; brand_id: number; client_name: string; period: string | null; status: RunStatus
  done_count: number; step_count: number; current_title: string | null; current_type: StepType | null
  started_at: string; finished_at: string | null; started_by_name: string | null
}
export interface RunLog { id: number; step_title: string | null; type: string; status: 'done' | 'waiting' | 'skipped' | 'failed' | 'info'; message: string; created_at: string }
export interface WorkflowRunDetail extends WorkflowRun {
  steps: { id: number; type: StepType; title: string; x: number; y: number; state: 'not_reached' | 'pending' | 'active' | 'done' | 'skipped' | 'failed'; waiting_for: 'task' | 'time' | null; wait_until: string | null }[]
  edges: WorkflowEdge[]; log: RunLog[]
  tasks: { id: number; title: string; status: DeliverableStatus; due_date: string | null; assignee_name: string | null; team_name: string | null; team_icon: string | null }[]
}
export interface OutboxEmail { id: number; channel: 'email' | 'sms' | 'whatsapp'; kind: string; provider: string | null; to_email: string; cc: string | null; subject: string; body: string; status: 'sent' | 'not_sent' | 'failed'; error: string | null; created_at: string; client_name: string | null; workflow_name: string | null }
export interface AppNotification { id: number; title: string; body: string | null; link: string | null; type: 'general' | 'task_assigned'; read_at: string | null; created_at: string }

export interface IntegrationState {
  connected: boolean; key_hint: string | null
  account: { email?: string | null; company?: string | null; plans?: string[]; error?: string } | null
  senders: { name: string; email: string; active: boolean }[]; lists: { id: number; name: string }[]
  settings: {
    brevo_sender_name: string; brevo_sender_email: string; brevo_sms_sender: string; brevo_whatsapp_number: string; brevo_list_id: string
    default_country_code: string; brevo_emails: boolean; notify_emails: boolean; sync_clients: boolean
  }
  stats: { sent_30: number; failed_30: number; unsent_30: number }
}
