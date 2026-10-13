-- =====================================================================================
-- Brand OS: database schema (all tables)
-- MySQL 5.7+ / MariaDB 10.4+, utf8mb4
--
-- Safe to run on an existing database: it never drops or empties anything, and every
-- table is created only if it does not exist yet. Run this first, then 02_starter_data.sql.
--
-- Generated from api/database/schema.sql. If you change that file, regenerate this one.
-- =====================================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET FOREIGN_KEY_CHECKS = 0;


CREATE TABLE IF NOT EXISTS teams (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  color VARCHAR(9) NOT NULL DEFAULT '#5B6472',
  icon VARCHAR(40) NOT NULL DEFAULT 'users',
  position INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin','admin','creative_head','project_manager','tech_lead','member') NOT NULL DEFAULT 'member',
  team_id INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  -- NULL until the person opens their invite link and sets a password
  joined_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invite and password-reset links. Only a hash of the link is stored; a link works once and expires.
CREATE TABLE IF NOT EXISTS user_invites (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose ENUM('join','reset') NOT NULL DEFAULT 'join',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client intake forms ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'general',
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS template_sections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS template_fields (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section_id INT UNSIGNED NOT NULL,
  label VARCHAR(255) NOT NULL,
  type ENUM('text','textarea','email','phone','url','date','number','select','file','secret') NOT NULL DEFAULT 'text',
  placeholder VARCHAR(255) NULL,
  options TEXT NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  FOREIGN KEY (section_id) REFERENCES template_sections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Clients ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NULL,
  contact_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  website VARCHAR(255) NULL,
  industry VARCHAR(120) NULL,
  brand_type ENUM('ecommerce','lead_gen') NOT NULL DEFAULT 'ecommerce',
  profile TEXT NULL,                       -- JSON: details specific to the client type
  logo_url VARCHAR(500) NULL,
  tags TEXT NULL,                          -- JSON array of lowercase tags
  docs_token CHAR(40) NULL UNIQUE,         -- private link for the client to upload documents
  status ENUM('new','in_progress','on_hold','live','retainer') NOT NULL DEFAULT 'new',
  auto_handoff TINYINT(1) NOT NULL DEFAULT 1,
  onboarding_started_at DATETIME NULL,
  retainer_at DATETIME NULL,
  template_id INT UNSIGNED NULL,
  owner_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS form_submissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id INT UNSIGNED NOT NULL,
  brand_id INT UNSIGNED NOT NULL,
  kind ENUM('intake') NOT NULL DEFAULT 'intake',
  token CHAR(40) NOT NULL UNIQUE,
  status ENUM('not_sent','sent','in_progress','submitted') NOT NULL DEFAULT 'not_sent',
  submitted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS form_values (
  submission_id INT UNSIGNED NOT NULL,
  field_id INT UNSIGNED NOT NULL,
  value MEDIUMTEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (submission_id, field_id),
  FOREIGN KEY (submission_id) REFERENCES form_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES template_fields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Blueprints: reusable project types (Shopify website, Branding only, Product shoot) -------
CREATE TABLE IF NOT EXISTS blueprints (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_type ENUM('ecommerce','lead_gen') NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(255) NULL,
  position INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blueprint_stages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  blueprint_id INT UNSIGNED NOT NULL,
  position INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  summary VARCHAR(255) NULL,
  team_id INT UNSIGNED NULL,
  approver_role VARCHAR(40) NOT NULL DEFAULT 'creative_head',
  duration_days INT NOT NULL DEFAULT 5,
  FOREIGN KEY (blueprint_id) REFERENCES blueprints(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blueprint_deliverables (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stage_id INT UNSIGNED NOT NULL,
  position INT NOT NULL,
  kind ENUM('work','intake') NOT NULL DEFAULT 'work',
  title VARCHAR(200) NOT NULL,
  asset_format_id INT UNSIGNED NULL,
  brief VARCHAR(500) NULL,
  FOREIGN KEY (stage_id) REFERENCES blueprint_stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projects: one client moving through its stages ----------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NOT NULL,
  blueprint_id INT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  status ENUM('active','on_hold','completed') NOT NULL DEFAULT 'active',
  -- onboarding = a client's main project; workflow = the tasks of one workflow run.
  kind ENUM('onboarding','workflow') NOT NULL DEFAULT 'onboarding',
  run_id INT UNSIGNED NULL,
  current_stage INT NOT NULL DEFAULT 1,
  owner_id INT UNSIGNED NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  target_date DATE NULL,
  completed_at DATETIME NULL,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (blueprint_id) REFERENCES blueprints(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- locked -> open -> done. A stage is done when every deliverable in it is approved.
CREATE TABLE IF NOT EXISTS project_stages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  position INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  summary VARCHAR(255) NULL,
  team_id INT UNSIGNED NULL,
  approver_role VARCHAR(40) NOT NULL DEFAULT 'creative_head',
  status ENUM('locked','open','done') NOT NULL DEFAULT 'locked',
  opened_at DATETIME NULL,
  due_date DATE NULL,
  done_at DATETIME NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  INDEX idx_stage_project (project_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A deliverable is reviewed version by version. An approved deliverable is locked.
CREATE TABLE IF NOT EXISTS deliverables (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL,
  stage_id INT UNSIGNED NOT NULL,
  position INT NOT NULL DEFAULT 0,
  kind ENUM('work','intake') NOT NULL DEFAULT 'work',
  title VARCHAR(200) NOT NULL,
  asset_format_id INT UNSIGNED NULL,
  brief TEXT NULL,
  assignee_id INT UNSIGNED NULL,
  due_date DATE NULL,
  status ENUM('not_started','in_progress','in_review','changes_requested','approved') NOT NULL DEFAULT 'not_started',
  version_count INT NOT NULL DEFAULT 0,
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  tags TEXT NULL,
  blocked TINYINT(1) NOT NULL DEFAULT 0,
  block_who VARCHAR(60) NULL,
  block_type ENUM('text','document','link','action') NULL,
  block_reason TEXT NULL,
  block_response TEXT NULL,
  blocked_by INT UNSIGNED NULL,
  blocked_at DATETIME NULL,
  approved_at DATETIME NULL,
  approved_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES project_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_deliverable_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deliverable_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  deliverable_id INT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  note TEXT NULL,
  link_url VARCHAR(500) NULL,
  file_name VARCHAR(200) NULL,
  file_path VARCHAR(255) NULL,
  file_size INT UNSIGNED NULL,
  status ENUM('in_review','approved','changes_requested') NOT NULL DEFAULT 'in_review',
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  decision_note TEXT NULL,
  FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_version (deliverable_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Internal team feedback on a version. Never shown to clients.
CREATE TABLE IF NOT EXISTS comments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (version_id) REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Internal setup checklist. Every item must be done before a client moves to retainer.
CREATE TABLE IF NOT EXISTS setup_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  status ENUM('pending','in_progress','done') NOT NULL DEFAULT 'pending',
  done TINYINT(1) NOT NULL DEFAULT 0,
  owner_id INT UNSIGNED NULL,
  due_date DATE NULL,
  note VARCHAR(500) NULL,
  position INT NOT NULL DEFAULT 0,
  done_at DATETIME NULL,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Client assets: links (Google Drive etc.) and uploaded documents only.
CREATE TABLE IF NOT EXISTS assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NOT NULL,
  setup_item_id INT UNSIGNED NULL,
  kind ENUM('link','file') NOT NULL,
  title VARCHAR(200) NOT NULL,
  category ENUM('brand','legal','product','access','other') NOT NULL DEFAULT 'other',
  url VARCHAR(500) NULL,
  file_name VARCHAR(200) NULL,
  file_path VARCHAR(255) NULL,
  file_size INT UNSIGNED NULL,
  added_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (setup_item_id) REFERENCES setup_items(id) ON DELETE SET NULL,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One person per team for each client (their account manager, creative lead, tech lead...).
CREATE TABLE IF NOT EXISTS client_team (
  brand_id INT UNSIGNED NOT NULL,
  team_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (brand_id, team_id),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Documents we need from the client (GST certificate, PAN...). The client uploads them through a private link.
CREATE TABLE IF NOT EXISTS client_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  status ENUM('pending','uploaded','approved') NOT NULL DEFAULT 'pending',
  due_date DATE NULL,
  file_name VARCHAR(200) NULL,
  file_path VARCHAR(255) NULL,
  file_size INT UNSIGNED NULL,
  uploaded_at DATETIME NULL,
  position INT NOT NULL DEFAULT 0,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monthly content calendar rows.
CREATE TABLE IF NOT EXISTS content_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,
  post_date DATE NULL,
  funnel ENUM('top','mid','bot') NULL,
  one_liner VARCHAR(255) NULL,
  concept VARCHAR(120) NULL,
  post_type VARCHAR(60) NULL,
  concept_idea TEXT NULL,
  copy TEXT NULL,
  caption TEXT NULL,
  channels VARCHAR(200) NULL,
  status ENUM('pending','in_progress','ready','approved','live') NOT NULL DEFAULT 'pending',
  assignee_id INT UNSIGNED NULL,
  output_due DATE NULL,
  live_date DATE NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_content_month (brand_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_activity_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Asset formats: reusable templates for the work the team hands over (shoot brief, content calendar, SEO checklist...).
-- form = one answer per field, checklist = tick-box items, calendar = one row per post.
CREATE TABLE IF NOT EXISTS asset_formats (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  kind ENUM('form','checklist','calendar') NOT NULL DEFAULT 'form',
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS asset_format_fields (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  format_id INT UNSIGNED NOT NULL,
  label VARCHAR(160) NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  type ENUM('text','textarea','number','date','select','link','checkbox') NOT NULL DEFAULT 'text',
  options TEXT NULL,
  placeholder VARCHAR(200) NULL,
  required TINYINT(1) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  FOREIGN KEY (format_id) REFERENCES asset_formats(id) ON DELETE CASCADE,
  UNIQUE KEY uq_format_key (format_id, field_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A format filled in for one client. answers = {key: value} for forms and checklists, [{key: value}, ...] rows for calendars.
CREATE TABLE IF NOT EXISTS asset_entries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  format_id INT UNSIGNED NOT NULL,
  brand_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  answers MEDIUMTEXT NULL,
  status ENUM('waiting','needs_changes','approved') NOT NULL DEFAULT 'waiting',
  review_note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  reviewed_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (format_id) REFERENCES asset_formats(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workflows: a list of steps (task, notify, email, API call, wait, condition, start another workflow)
-- started by a trigger (schedule, event or by hand) for one client at a time.
CREATE TABLE IF NOT EXISTS workflows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(255) NULL,
  is_live TINYINT(1) NOT NULL DEFAULT 0,
  start_x INT NOT NULL DEFAULT 160,
  start_y INT NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_steps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NOT NULL,
  position INT NOT NULL DEFAULT 0,
  type ENUM('task','approval','notify','email','sms','whatsapp','api','wait','condition','start_workflow') NOT NULL,
  title VARCHAR(200) NOT NULL,
  config TEXT NULL,
  pos_x INT NOT NULL DEFAULT 0,
  pos_y INT NOT NULL DEFAULT 0,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_triggers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  type ENUM('schedule','event') NOT NULL,
  frequency ENUM('daily','weekly','monthly','once') NULL,
  weekday TINYINT NULL,
  month_day TINYINT NULL,
  at_time CHAR(5) NULL,
  run_at DATETIME NULL,
  event VARCHAR(60) NULL,
  client_type VARCHAR(20) NULL,
  client_status VARCHAR(20) NULL,
  brand_id INT UNSIGNED NULL,
  active_from DATE NULL,
  active_until DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_fired_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NOT NULL,
  brand_id INT UNSIGNED NOT NULL,
  trigger_id INT UNSIGNED NULL,
  project_id INT UNSIGNED NULL,
  period VARCHAR(20) NULL,
  status ENUM('running','waiting','done','stopped','failed') NOT NULL DEFAULT 'running',
  started_by INT UNSIGNED NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_id) REFERENCES workflow_triggers(id) ON DELETE SET NULL,
  FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_run_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The arrows on the canvas. from_step_id NULL = from the Start card. branch: next, or yes / no out of a condition.
CREATE TABLE IF NOT EXISTS workflow_edges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NOT NULL,
  from_step_id INT UNSIGNED NULL,
  to_step_id INT UNSIGNED NOT NULL,
  branch ENUM('next','yes','no') NOT NULL DEFAULT 'next',
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (from_step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE,
  FOREIGN KEY (to_step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Where each card is in one run. Several cards can be active at once (parallel paths).
CREATE TABLE IF NOT EXISTS workflow_run_nodes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id INT UNSIGNED NOT NULL,
  step_id INT UNSIGNED NOT NULL,
  status ENUM('pending','active','done','skipped','failed') NOT NULL DEFAULT 'pending',
  arrivals INT NOT NULL DEFAULT 0,
  waiting_for ENUM('task','time') NULL,
  wait_until DATETIME NULL,
  deliverable_id INT UNSIGNED NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  UNIQUE KEY uq_run_step (run_id, step_id),
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE,
  INDEX idx_run_node_wait (status, waiting_for, wait_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_run_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id INT UNSIGNED NOT NULL,
  step_id INT UNSIGNED NULL,
  step_no INT NULL,
  step_title VARCHAR(200) NULL,
  type VARCHAR(30) NOT NULL,
  status ENUM('done','waiting','skipped','failed','info') NOT NULL DEFAULT 'done',
  message VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- In-app notifications, one row per person.
CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  brand_id INT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  body VARCHAR(1000) NULL,
  link VARCHAR(255) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every email, SMS and WhatsApp message the app sends (workflows, form links, approval alerts...).
-- Sent through Brevo when it is connected in Settings → Integrations; kept here either way.
CREATE TABLE IF NOT EXISTS email_outbox (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id INT UNSIGNED NULL,
  brand_id INT UNSIGNED NULL,
  channel ENUM('email','sms','whatsapp') NOT NULL DEFAULT 'email',
  kind VARCHAR(40) NOT NULL DEFAULT 'workflow',
  provider VARCHAR(20) NULL,
  provider_id VARCHAR(120) NULL,
  to_email VARCHAR(500) NOT NULL,
  cc VARCHAR(500) NULL,
  subject VARCHAR(255) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status ENUM('sent','not_sent','failed') NOT NULL DEFAULT 'not_sent',
  error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App-wide settings (integrations). Secrets are encrypted with app_key.
CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(80) PRIMARY KEY,
  value TEXT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
