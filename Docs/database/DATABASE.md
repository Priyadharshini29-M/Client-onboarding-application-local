# Brand OS database

All tables and fields the app saves. Types are MySQL types; **Required** means the column can't be empty (NOT NULL). Columns with a default fill themselves in when left out.

## Setting up your own database

Run these two files, in this order, in phpMyAdmin (Import tab), MySQL Workbench or the `mysql` command line:

1. **`01_schema.sql`** creates all 37 tables. It never drops or empties anything, so it is safe on a database that already has data.
2. **`02_starter_data.sql`** adds what the app needs to be usable: 5 departments, 2 intake forms, 2 project types, 10 asset formats and one admin login. **Edit `@admin_name` and `@admin_email` at the top first.** The first password is `ChangeMe-2026!`. After signing in, invite yourself (and your team) from Settings → People; each person chooses their own password from their invite link.

Then point the app at the database: copy `api/config.example.php` to `api/config.php` and set `db.host`, `db.port`, `db.name`, `db.user` and `db.pass`. Also set a long random `app_key`, and never change it later, or saved secrets (form passwords, the Brevo key) become unreadable.

The database must use **utf8mb4** (both files set it). MySQL 5.7+ or MariaDB 10.4+.

Want the sample clients and people as well, for trying things out? Point `api/config.php` at an **empty** database and run `php api/bin/setup.php` instead of the two files.

## Tables at a glance

| Area | Table | What it stores |
|---|---|---|
| People and sign-in | [`users`](#users) | Everyone who signs in. Role decides what they can approve; team_id is their department. |
| People and sign-in | [`api_tokens`](#api_tokens) | Sign-in sessions. One row per signed-in browser; only a SHA-256 hash of the token is stored. |
| People and sign-in | [`user_invites`](#user_invites) | Invite and password-reset links. Only a hash is stored; a link works once and expires after 7 days. users.joined_at stays empty until the person sets their password. |
| People and sign-in | [`teams`](#teams) | Departments (Project Management, Creative, Shoot, Digital, Tech...). Icon is the department icon. |
| Clients | [`brands`](#brands) | Clients. brand_type is ecommerce or lead_gen; profile holds the type-specific details as JSON; auto_handoff switches automatic handoff on the Team tab. |
| Clients | [`client_team`](#client_team) | Who looks after each client in each department (the Team tab). One person per client per department. |
| Clients | [`client_documents`](#client_documents) | Documents requested from a client (GST, PAN, logo files...) and the files they upload through their private link. |
| Clients | [`setup_items`](#setup_items) | The internal setup checklist for a client (before moving to retainer). |
| Clients | [`assets`](#assets) | Drive links and uploaded documents kept for a client (Assets → Files & links). |
| Clients | [`content_items`](#content_items) | The content calendar: one row per planned post. |
| Clients | [`activity_log`](#activity_log) | The History tab: everything that happened to a client, newest first. |
| Intake forms | [`templates`](#templates) | Intake forms (Settings → Intake forms). category ties a form to a client type. |
| Intake forms | [`template_sections`](#template_sections) | Parts of a form. |
| Intake forms | [`template_fields`](#template_fields) | Questions in a form. Secret fields are stored encrypted. |
| Intake forms | [`form_submissions`](#form_submissions) | A client's copy of the intake form; token is the private link they fill it in with. |
| Intake forms | [`form_values`](#form_values) | The answers a client gave, one row per question. |
| Project types and projects | [`blueprints`](#blueprints) | Project types (Settings → Project types), e.g. E-commerce brand, Lead generation. |
| Project types and projects | [`blueprint_stages`](#blueprint_stages) | The stages of a project type, each owned by a department, with who approves it. |
| Project types and projects | [`blueprint_deliverables`](#blueprint_deliverables) | The tasks each stage starts with. |
| Project types and projects | [`projects`](#projects) | A client's project. kind = onboarding for the main project, workflow for the tasks of one workflow run. |
| Project types and projects | [`project_stages`](#project_stages) | The stages of one project: locked → open → done. A stage is done when all its tasks are approved. |
| Project types and projects | [`deliverables`](#deliverables) | Tasks. Status goes not_started → in_progress → in_review (waiting for approval) → changes_requested (needs changes) → approved. |
| Project types and projects | [`deliverable_versions`](#deliverable_versions) | Each version submitted for a task: what changed, link or file, and the approval or rework decision. |
| Project types and projects | [`comments`](#comments) | Team comments on a version. |
| Asset formats | [`asset_formats`](#asset_formats) | Formats the team fills in (Content Calendar, Shoot Requirements, checklists...). |
| Asset formats | [`asset_format_fields`](#asset_format_fields) | The fields of a format. |
| Asset formats | [`asset_entries`](#asset_entries) | A format filled in for a client, with its approval status. answers holds the values as JSON. |
| Workflows | [`workflows`](#workflows) | Workflows (Workflows page). is_live lets triggers start them. |
| Workflows | [`workflow_steps`](#workflow_steps) | The cards on the canvas: task, approval, notify, email, sms, whatsapp, api, wait, condition, start_workflow. config holds the card settings as JSON. |
| Workflows | [`workflow_edges`](#workflow_edges) | The arrows between cards. from_step_id NULL means from Start; branch is next, or yes / no out of a condition. |
| Workflows | [`workflow_triggers`](#workflow_triggers) | What starts a workflow: a schedule (daily, weekly, monthly, once) or an event (client added, intake submitted...). |
| Workflows | [`workflow_runs`](#workflow_runs) | One workflow running for one client. |
| Workflows | [`workflow_run_nodes`](#workflow_run_nodes) | Where each card is in a run: pending, active (now), done, skipped or failed. |
| Workflows | [`workflow_run_logs`](#workflow_run_logs) | "What happened" in a run, line by line. |
| Messages and settings | [`notifications`](#notifications) | In-app notifications (the bell and the pop-up toasts), one row per person. |
| Messages and settings | [`email_outbox`](#email_outbox) | Every email, SMS and WhatsApp message the app sends, sent or not (Workflows → Messages). |
| Messages and settings | [`app_settings`](#app_settings) | App-wide settings such as the Brevo connection. Secret values (the API key) are stored encrypted. |

## People and sign-in

### users

Everyone who signs in. Role decides what they can approve; team_id is their department.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(120) | yes |  |  |
| `email` | varchar(190) | yes |  | unique |
| `phone` | varchar(40) |  |  |  |
| `password_hash` | varchar(255) | yes |  |  |
| `role` | enum('super_admin','admin','creative_head','project_manager','tech_lead','member') | yes | member |  |
| `team_id` | int(10) unsigned |  |  | → `teams.id` |
| `is_active` | tinyint(1) | yes | 1 |  |
| `joined_at` | datetime |  |  |  |
| `created_at` | datetime | yes | now |  |

### api_tokens

Sign-in sessions. One row per signed-in browser; only a SHA-256 hash of the token is stored.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `user_id` | int(10) unsigned | yes |  | → `users.id` |
| `token_hash` | char(64) | yes |  | unique |
| `expires_at` | datetime | yes |  |  |
| `created_at` | datetime | yes | now |  |

### user_invites

Invite and password-reset links. Only a hash is stored; a link works once and expires after 7 days. users.joined_at stays empty until the person sets their password.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `user_id` | int(10) unsigned | yes |  | → `users.id` |
| `token_hash` | char(64) | yes |  | unique |
| `purpose` | enum('join','reset') | yes | join |  |
| `expires_at` | datetime | yes |  |  |
| `used_at` | datetime |  |  |  |
| `created_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |

### teams

Departments (Project Management, Creative, Shoot, Digital, Tech...). Icon is the department icon.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(80) | yes |  |  |
| `slug` | varchar(80) | yes |  | unique |
| `color` | varchar(9) | yes | #5B6472 |  |
| `icon` | varchar(40) | yes | users |  |
| `position` | int(11) | yes | 0 |  |

## Clients

### brands

Clients. brand_type is ecommerce or lead_gen; profile holds the type-specific details as JSON; auto_handoff switches automatic handoff on the Team tab.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(160) | yes |  |  |
| `email` | varchar(190) |  |  |  |
| `contact_name` | varchar(120) |  |  |  |
| `phone` | varchar(40) |  |  |  |
| `website` | varchar(255) |  |  |  |
| `industry` | varchar(120) |  |  |  |
| `brand_type` | enum('ecommerce','lead_gen') | yes | ecommerce |  |
| `profile` | text |  |  |  |
| `logo_url` | varchar(500) |  |  |  |
| `tags` | text |  |  |  |
| `docs_token` | char(40) |  |  | unique |
| `status` | enum('new','in_progress','on_hold','live','retainer') | yes | new |  |
| `auto_handoff` | tinyint(1) | yes | 1 |  |
| `onboarding_started_at` | datetime |  |  |  |
| `retainer_at` | datetime |  |  |  |
| `template_id` | int(10) unsigned |  |  | → `templates.id` |
| `owner_id` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

### client_team

Who looks after each client in each department (the Team tab). One person per client per department.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `brand_id` | int(10) unsigned | yes |  | Primary key, → `brands.id` |
| `team_id` | int(10) unsigned | yes |  | Primary key, → `teams.id` |
| `user_id` | int(10) unsigned | yes |  | → `users.id` |
| `assigned_at` | datetime | yes | now |  |

### client_documents

Documents requested from a client (GST, PAN, logo files...) and the files they upload through their private link.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `name` | varchar(200) | yes |  |  |
| `status` | enum('pending','uploaded','approved') | yes | pending |  |
| `due_date` | date |  |  |  |
| `file_name` | varchar(200) |  |  |  |
| `file_path` | varchar(255) |  |  |  |
| `file_size` | int(10) unsigned |  |  |  |
| `uploaded_at` | datetime |  |  |  |
| `position` | int(11) | yes | 0 |  |

### setup_items

The internal setup checklist for a client (before moving to retainer).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `title` | varchar(255) | yes |  |  |
| `status` | enum('pending','in_progress','done') | yes | pending |  |
| `done` | tinyint(1) | yes | 0 |  |
| `owner_id` | int(10) unsigned |  |  | → `users.id` |
| `due_date` | date |  |  |  |
| `note` | varchar(500) |  |  |  |
| `position` | int(11) | yes | 0 |  |
| `done_at` | datetime |  |  |  |

### assets

Drive links and uploaded documents kept for a client (Assets → Files & links).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `setup_item_id` | int(10) unsigned |  |  | → `setup_items.id` |
| `kind` | enum('link','file') | yes |  |  |
| `title` | varchar(200) | yes |  |  |
| `category` | enum('brand','legal','product','access','other') | yes | other |  |
| `url` | varchar(500) |  |  |  |
| `file_name` | varchar(200) |  |  |  |
| `file_path` | varchar(255) |  |  |  |
| `file_size` | int(10) unsigned |  |  |  |
| `added_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |

### content_items

The content calendar: one row per planned post.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `month` | char(7) | yes |  |  |
| `post_date` | date |  |  |  |
| `funnel` | enum('top','mid','bot') |  |  |  |
| `one_liner` | varchar(255) |  |  |  |
| `concept` | varchar(120) |  |  |  |
| `post_type` | varchar(60) |  |  |  |
| `concept_idea` | text |  |  |  |
| `copy` | text |  |  |  |
| `caption` | text |  |  |  |
| `channels` | varchar(200) |  |  |  |
| `status` | enum('pending','in_progress','ready','approved','live') | yes | pending |  |
| `assignee_id` | int(10) unsigned |  |  | → `users.id` |
| `output_due` | date |  |  |  |
| `live_date` | date |  |  |  |
| `position` | int(11) | yes | 0 |  |
| `created_at` | datetime | yes | now |  |

### activity_log

The History tab: everything that happened to a client, newest first.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint(20) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned |  |  | → `brands.id` |
| `user_id` | int(10) unsigned |  |  | → `users.id` |
| `action` | varchar(60) | yes |  |  |
| `message` | varchar(500) | yes |  |  |
| `created_at` | datetime | yes | now |  |

## Intake forms

### templates

Intake forms (Settings → Intake forms). category ties a form to a client type.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(160) | yes |  |  |
| `category` | varchar(60) | yes | general |  |
| `description` | varchar(255) |  |  |  |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

### template_sections

Parts of a form.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `template_id` | int(10) unsigned | yes |  | → `templates.id` |
| `title` | varchar(160) | yes |  |  |
| `position` | int(11) | yes | 0 |  |

### template_fields

Questions in a form. Secret fields are stored encrypted.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `section_id` | int(10) unsigned | yes |  | → `template_sections.id` |
| `label` | varchar(255) | yes |  |  |
| `type` | enum('text','textarea','email','phone','url','date','number','select','file','secret') | yes | text |  |
| `placeholder` | varchar(255) |  |  |  |
| `options` | text |  |  |  |
| `required` | tinyint(1) | yes | 0 |  |
| `position` | int(11) | yes | 0 |  |

### form_submissions

A client's copy of the intake form; token is the private link they fill it in with.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `template_id` | int(10) unsigned | yes |  | → `templates.id` |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `kind` | enum('intake') | yes | intake |  |
| `token` | char(40) | yes |  | unique |
| `status` | enum('not_sent','sent','in_progress','submitted') | yes | not_sent |  |
| `submitted_at` | datetime |  |  |  |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

### form_values

The answers a client gave, one row per question.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `submission_id` | int(10) unsigned | yes |  | Primary key, → `form_submissions.id` |
| `field_id` | int(10) unsigned | yes |  | Primary key, → `template_fields.id` |
| `value` | mediumtext |  |  |  |
| `updated_at` | datetime | yes | now | updates itself on change |

## Project types and projects

### blueprints

Project types (Settings → Project types), e.g. E-commerce brand, Lead generation.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `client_type` | enum('ecommerce','lead_gen') | yes |  |  |
| `name` | varchar(160) | yes |  |  |
| `description` | varchar(255) |  |  |  |
| `position` | int(11) | yes | 0 |  |

### blueprint_stages

The stages of a project type, each owned by a department, with who approves it.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `blueprint_id` | int(10) unsigned | yes |  | → `blueprints.id` |
| `position` | int(11) | yes |  |  |
| `name` | varchar(120) | yes |  |  |
| `summary` | varchar(255) |  |  |  |
| `team_id` | int(10) unsigned |  |  | → `teams.id` |
| `approver_role` | varchar(40) | yes | creative_head |  |
| `duration_days` | int(11) | yes | 5 |  |

### blueprint_deliverables

The tasks each stage starts with.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `stage_id` | int(10) unsigned | yes |  | → `blueprint_stages.id` |
| `position` | int(11) | yes |  |  |
| `kind` | enum('work','intake') | yes | work |  |
| `title` | varchar(200) | yes |  |  |
| `asset_format_id` | int(10) unsigned |  |  |  |
| `brief` | varchar(500) |  |  |  |

### projects

A client's project. kind = onboarding for the main project, workflow for the tasks of one workflow run.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `blueprint_id` | int(10) unsigned |  |  | → `blueprints.id` |
| `name` | varchar(160) | yes |  |  |
| `status` | enum('active','on_hold','completed') | yes | active |  |
| `kind` | enum('onboarding','workflow') | yes | onboarding |  |
| `run_id` | int(10) unsigned |  |  |  |
| `current_stage` | int(11) | yes | 1 |  |
| `owner_id` | int(10) unsigned |  |  | → `users.id` |
| `started_at` | datetime | yes | now |  |
| `target_date` | date |  |  |  |
| `completed_at` | datetime |  |  |  |

### project_stages

The stages of one project: locked → open → done. A stage is done when all its tasks are approved.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `project_id` | int(10) unsigned | yes |  | → `projects.id` |
| `position` | int(11) | yes |  |  |
| `name` | varchar(120) | yes |  |  |
| `summary` | varchar(255) |  |  |  |
| `team_id` | int(10) unsigned |  |  | → `teams.id` |
| `approver_role` | varchar(40) | yes | creative_head |  |
| `status` | enum('locked','open','done') | yes | locked |  |
| `opened_at` | datetime |  |  |  |
| `due_date` | date |  |  |  |
| `done_at` | datetime |  |  |  |

### deliverables

Tasks. Status goes not_started → in_progress → in_review (waiting for approval) → changes_requested (needs changes) → approved.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `project_id` | int(10) unsigned | yes |  | → `projects.id` |
| `stage_id` | int(10) unsigned | yes |  | → `project_stages.id` |
| `position` | int(11) | yes | 0 |  |
| `kind` | enum('work','intake') | yes | work |  |
| `title` | varchar(200) | yes |  |  |
| `asset_format_id` | int(10) unsigned |  |  |  |
| `brief` | text |  |  |  |
| `assignee_id` | int(10) unsigned |  |  | → `users.id` |
| `due_date` | date |  |  |  |
| `status` | enum('not_started','in_progress','in_review','changes_requested','approved') | yes | not_started |  |
| `version_count` | int(11) | yes | 0 |  |
| `priority` | enum('low','medium','high','urgent') | yes | medium |  |
| `tags` | text |  |  |  |
| `blocked` | tinyint(1) | yes | 0 |  |
| `block_who` | varchar(60) |  |  |  |
| `block_type` | enum('text','document','link','action') |  |  |  |
| `block_reason` | text |  |  |  |
| `block_response` | text |  |  |  |
| `blocked_by` | int(10) unsigned |  |  |  |
| `blocked_at` | datetime |  |  |  |
| `approved_at` | datetime |  |  |  |
| `approved_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

### deliverable_versions

Each version submitted for a task: what changed, link or file, and the approval or rework decision.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `deliverable_id` | int(10) unsigned | yes |  | → `deliverables.id` |
| `version_no` | int(11) | yes |  |  |
| `note` | text |  |  |  |
| `link_url` | varchar(500) |  |  |  |
| `file_name` | varchar(200) |  |  |  |
| `file_path` | varchar(255) |  |  |  |
| `file_size` | int(10) unsigned |  |  |  |
| `status` | enum('in_review','approved','changes_requested') | yes | in_review |  |
| `created_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |
| `decided_by` | int(10) unsigned |  |  | → `users.id` |
| `decided_at` | datetime |  |  |  |
| `decision_note` | text |  |  |  |

### comments

Team comments on a version.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `version_id` | int(10) unsigned | yes |  | → `deliverable_versions.id` |
| `user_id` | int(10) unsigned |  |  | → `users.id` |
| `body` | text | yes |  |  |
| `created_at` | datetime | yes | now |  |

## Asset formats

### asset_formats

Formats the team fills in (Content Calendar, Shoot Requirements, checklists...).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(120) | yes |  |  |
| `slug` | varchar(120) | yes |  | unique |
| `kind` | enum('form','checklist','calendar') | yes | form |  |
| `description` | varchar(255) |  |  |  |
| `is_active` | tinyint(1) | yes | 1 |  |
| `position` | int(11) | yes | 0 |  |
| `created_at` | datetime | yes | now |  |

### asset_format_fields

The fields of a format.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `format_id` | int(10) unsigned | yes |  | → `asset_formats.id` |
| `label` | varchar(160) | yes |  |  |
| `field_key` | varchar(80) | yes |  |  |
| `type` | enum('text','textarea','number','date','select','link','checkbox') | yes | text |  |
| `options` | text |  |  |  |
| `placeholder` | varchar(200) |  |  |  |
| `required` | tinyint(1) | yes | 0 |  |
| `position` | int(11) | yes | 0 |  |

### asset_entries

A format filled in for a client, with its approval status. answers holds the values as JSON.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `format_id` | int(10) unsigned | yes |  | → `asset_formats.id` |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `title` | varchar(200) | yes |  |  |
| `answers` | mediumtext |  |  |  |
| `status` | enum('waiting','needs_changes','approved') | yes | waiting |  |
| `review_note` | varchar(500) |  |  |  |
| `created_by` | int(10) unsigned |  |  | → `users.id` |
| `reviewed_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

## Workflows

### workflows

Workflows (Workflows page). is_live lets triggers start them.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `name` | varchar(160) | yes |  |  |
| `description` | varchar(255) |  |  |  |
| `is_live` | tinyint(1) | yes | 0 |  |
| `start_x` | int(11) | yes | 160 |  |
| `start_y` | int(11) | yes | 0 |  |
| `created_by` | int(10) unsigned |  |  | → `users.id` |
| `created_at` | datetime | yes | now |  |
| `updated_at` | datetime | yes | now | updates itself on change |

### workflow_steps

The cards on the canvas: task, approval, notify, email, sms, whatsapp, api, wait, condition, start_workflow. config holds the card settings as JSON.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `workflow_id` | int(10) unsigned | yes |  | → `workflows.id` |
| `position` | int(11) | yes | 0 |  |
| `type` | enum('task','approval','notify','email','sms','whatsapp','api','wait','condition','start_workflow') | yes |  |  |
| `title` | varchar(200) | yes |  |  |
| `config` | text |  |  |  |
| `pos_x` | int(11) | yes | 0 |  |
| `pos_y` | int(11) | yes | 0 |  |

### workflow_edges

The arrows between cards. from_step_id NULL means from Start; branch is next, or yes / no out of a condition.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `workflow_id` | int(10) unsigned | yes |  | → `workflows.id` |
| `from_step_id` | int(10) unsigned |  |  | → `workflow_steps.id` |
| `to_step_id` | int(10) unsigned | yes |  | → `workflow_steps.id` |
| `branch` | enum('next','yes','no') | yes | next |  |

### workflow_triggers

What starts a workflow: a schedule (daily, weekly, monthly, once) or an event (client added, intake submitted...).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `workflow_id` | int(10) unsigned | yes |  | → `workflows.id` |
| `name` | varchar(160) | yes |  |  |
| `type` | enum('schedule','event') | yes |  |  |
| `frequency` | enum('daily','weekly','monthly','once') |  |  |  |
| `weekday` | tinyint(4) |  |  |  |
| `month_day` | tinyint(4) |  |  |  |
| `at_time` | char(5) |  |  |  |
| `run_at` | datetime |  |  |  |
| `event` | varchar(60) |  |  |  |
| `client_type` | varchar(20) |  |  |  |
| `client_status` | varchar(20) |  |  |  |
| `brand_id` | int(10) unsigned |  |  | → `brands.id` |
| `active_from` | date |  |  |  |
| `active_until` | date |  |  |  |
| `is_active` | tinyint(1) | yes | 1 |  |
| `last_fired_at` | datetime |  |  |  |
| `created_at` | datetime | yes | now |  |

### workflow_runs

One workflow running for one client.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `workflow_id` | int(10) unsigned | yes |  | → `workflows.id` |
| `brand_id` | int(10) unsigned | yes |  | → `brands.id` |
| `trigger_id` | int(10) unsigned |  |  | → `workflow_triggers.id` |
| `project_id` | int(10) unsigned |  |  |  |
| `period` | varchar(20) |  |  |  |
| `status` | enum('running','waiting','done','stopped','failed') | yes | running |  |
| `started_by` | int(10) unsigned |  |  | → `users.id` |
| `started_at` | datetime | yes | now |  |
| `finished_at` | datetime |  |  |  |

### workflow_run_nodes

Where each card is in a run: pending, active (now), done, skipped or failed.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `run_id` | int(10) unsigned | yes |  | → `workflow_runs.id` |
| `step_id` | int(10) unsigned | yes |  | → `workflow_steps.id` |
| `status` | enum('pending','active','done','skipped','failed') | yes | pending |  |
| `arrivals` | int(11) | yes | 0 |  |
| `waiting_for` | enum('task','time') |  |  |  |
| `wait_until` | datetime |  |  |  |
| `deliverable_id` | int(10) unsigned |  |  |  |
| `started_at` | datetime |  |  |  |
| `finished_at` | datetime |  |  |  |

### workflow_run_logs

"What happened" in a run, line by line.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `run_id` | int(10) unsigned | yes |  | → `workflow_runs.id` |
| `step_id` | int(10) unsigned |  |  |  |
| `step_no` | int(11) |  |  |  |
| `step_title` | varchar(200) |  |  |  |
| `type` | varchar(30) | yes |  |  |
| `status` | enum('done','waiting','skipped','failed','info') | yes | done |  |
| `message` | varchar(1000) | yes |  |  |
| `created_at` | datetime | yes | now |  |

## Messages and settings

### notifications

In-app notifications (the bell and the pop-up toasts), one row per person.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `user_id` | int(10) unsigned | yes |  | → `users.id` |
| `brand_id` | int(10) unsigned |  |  |  |
| `title` | varchar(200) | yes |  |  |
| `body` | varchar(1000) |  |  |  |
| `link` | varchar(255) |  |  |  |
| `read_at` | datetime |  |  |  |
| `created_at` | datetime | yes | now |  |

### email_outbox

Every email, SMS and WhatsApp message the app sends, sent or not (Workflows → Messages).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned |  |  | Primary key, auto number |
| `run_id` | int(10) unsigned |  |  | → `workflow_runs.id` |
| `brand_id` | int(10) unsigned |  |  |  |
| `channel` | enum('email','sms','whatsapp') | yes | email |  |
| `kind` | varchar(40) | yes | workflow |  |
| `provider` | varchar(20) |  |  |  |
| `provider_id` | varchar(120) |  |  |  |
| `to_email` | varchar(500) | yes |  |  |
| `cc` | varchar(500) |  |  |  |
| `subject` | varchar(255) | yes |  |  |
| `body` | text | yes |  |  |
| `status` | enum('sent','not_sent','failed') | yes | not_sent |  |
| `error` | varchar(500) |  |  |  |
| `created_at` | datetime | yes | now |  |

### app_settings

App-wide settings such as the Brevo connection. Secret values (the API key) are stored encrypted.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | varchar(80) | yes |  | Primary key |
| `value` | text |  |  |  |
| `is_secret` | tinyint(1) | yes | 0 |  |
| `updated_at` | datetime | yes | now | updates itself on change |

