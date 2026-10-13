# DigiOps field inventory → Brand OS

Source: the public front-end of https://digiops.digifyce.com (app.html and assets/*.js, read 24 Sep 2026). Data was not visible (login required), so this lists every page, tab, form field, table column and option the app defines.

Legend: **✅ in Brand OS** · **🟡 partly** · **❌ missing**

---

## Roles & navigation

| DigiOps | Brand OS |
|---|---|
| Senior roles: superadmin, ceo, digital_head, tech_head, account_manager, creative_head, admin, manager | 🟡 owner, admin, creative_head, project_manager, tech_lead, member |
| Executive role with per-feature permissions (view_tasks, approve_workflows, admin_panel…) | ❌ |
| Nav: Dashboard, New Brand, Brands, Tasks, Workflows, Approvals, Actions, Admin | ✅ Dashboard, Add client, Clients, Teams, Work board, Reviews, Assets, Settings |
| Collapsible sidebar, notifications bell, dark mode, logout | ✅ |
| Push notifications (Firebase) | ❌ |

## Dashboard

| Field | Brand OS |
|---|---|
| Greeting | ✅ |
| Stats: Active Brands, Open Tasks, Blocked, New Leads | 🟡 (waiting sign-off, projects, late, approved this week) |
| Brand Health list | ❌ |
| Recent Activity | ✅ |

## New Brand (client onboarding pipeline)

| Field | Brand OS |
|---|---|
| Pipeline stage pills with colour and count (admin-defined stages) | 🟡 client status tabs |
| Table: Client, Stage, Template, Assigned To, Last Update, Actions | 🟡 |
| Actions: copy form link, share view-only link, convert to brand, delete | 🟡 copy link ✅, view-only share link ❌ |
| Create: Client Name*, Email, Template* | ✅ (+ contact, phone, project type) |
| Submission detail tabs: Form Data, Stage History, Documents, Advance Stage | 🟡 answers ✅, stage history ❌, advance stage with notes ❌ |
| Share link: Label, Sections to include, revoke | ❌ |
| Template builder: Name*, Type, Description, Active; Section name; Field label*, type (text, textarea, date, select, file, number), options, placeholder | ✅ (more field types) |

## Brands list

| Field | Brand OS |
|---|---|
| Phase tabs: All, Client Onboarding, Brand Onboarding, Retainer, Paused | 🟡 New, In progress, On hold, Live, Retainer |
| Columns: Brand (logo), Status, Industry, Health /100, Open Tasks, Blocked, Activated, Workflows (Active / Done) | 🟡 |
| Pause / activate toggle | 🟡 project on hold |
| Bulk edit: Logo, Name, Status, Type, Industry, Set Logo, Team, Tags; bulk delete | ❌ |
| Create brand: Brand Name*, Industry, Website, Logo | 🟡 |

## Brand profile

**Header:** logo, name, industry, status, health ring, pause toggle, Edit.
**Edit:** Brand Name, Brand Type, Logo / Icon (upload or URL), Status, Industry, Website.

| Tab | Fields | Brand OS |
|---|---|---|
| Overview | Website, Industry, Status, Health Score, Onboarding started, Activated; Team per role; Tags (lowercase, used in workflow conditions) | 🟡 |
| Client Intake | Linked submissions with stage; **Start Brand Onboarding** button | ✅ Onboarding tab |
| Team | One person per role (Account Manager, Creative, Digital, Tech…), assign / reassign from HRMS | ❌ |
| Brand Setup | Internal checklist: Item, Status (pending / in progress / done), Due Date, Assigned To, Notes; Apply Template; Add Item; **Move to Retainer** | 🟡 no status or notes yet |
| Client documents | Client-side items: Item, Status (pending / uploaded / approved), Due Date, File; public upload link | ❌ |
| Tasks | Board by role; Add Task; assign monthly tasks | ✅ Work board |
| Assets | Task outputs by month, format filter, approval badge (Pending / In Review / Rework / Approved) | 🟡 Drive links + documents |
| Workflows | Runs per brand, brand switcher, Start Flow, Stop | 🟡 projects |
| Strategy (monthly) | Title, Goals / Notes, strategy document, submit for review, approve / revise with notes | ❌ |
| Content calendar | Date, Funnel (Top / Mid / Bot), One Liner, Concept, Type, Concept Idea, Copy, Caption & Hashtag, Channels, Status (Pending / In Progress / Ready / Approved / Live), Assign To, Output Due, Live Date; bulk status and delete; templates | ❌ |

## Tasks

| Field | Brand OS |
|---|---|
| Create: Title*, Description, Category* (role), Priority (low, medium, high, urgent), Due Date, Tags | 🟡 deliverables have title, brief, owner, due |
| Status: todo, in progress, review, done, blocked | ✅ (to start, working, in review, changes asked, approved) |
| Comments | ✅ per version |
| Assign from HRMS employee search | 🟡 people list |
| **Block request:** Who is needed (role / client / external), Type (information, document, link, action required), Description*; response; history | ❌ |
| Submit for review; approve; reject with reason | ✅ |
| Clear done tasks; sync status | ❌ |

## Workflows & Actions

| Field | Brand OS |
|---|---|
| Workflow templates: Name*, Slug*, Description, Live toggle, publish / versions | 🟡 fixed project types |
| Visual builder nodes: trigger, task, approval, delay, email, notify, API call, condition, chain (start another flow) | ❌ |
| Task node: Task Title, Asset Format, Assigned Roles, Due (days from trigger), show earlier outputs | 🟡 |
| Delay node: Duration, Unit (hours / days / weeks) | ❌ |
| Email node: To Role or custom email, Subject, Body, CC | ❌ |
| API node: URL, Method, Retry, Body JSON, response mapping | ❌ |
| Condition node: Label, field (brand.tag, brand.status, brand.type, brand.industry…), value | ❌ |
| Triggers: Name, Workflow, Type (recurring monthly / weekly / daily, specific date-time, event), Day, Time, Brand type, Brand status, Active from / until, specific brand, Status; Fire now (Target brand, Period YYYY-MM) | ❌ |
| Fire flow for one or many brands | ✅ Start a project for several clients |
| Runs: Brand, Period, Current Step, Started; stop; recycle bin (restore / purge), archived documents, run log | 🟡 |

## Approvals

| Field | Brand OS |
|---|---|
| Tabs: Pending, Recently Approved, My Submissions | ✅ Waiting for me, Everything waiting, Decided |
| Columns: Task, Brand, Collateral, Submitted, Reviewed By | ✅ |
| Approve with notes; reject with reason | ✅ |

## Admin

| Section | Fields | Brand OS |
|---|---|---|
| Users | Name, Email, Password, Role (executor, manager, admin, super admin), Status, Feature permissions, brand access | 🟡 no feature permissions or brand access |
| Invites | Person (HRMS search), Email, Permissions, Invited by, Expires, revoke | ❌ |
| Roles (teams) | Label, Slug, Icon, reorder | ❌ teams are fixed |
| Asset formats | Name, Type (form, calendar, checklist, upload), Description, Active; fields: label, key, type, required, options, placeholder | ❌ |
| Onboarding task templates | Task Title, Description, Category, Due (days from start) | 🟡 project types |
| Monthly task templates | Title, Category, Due (days from month start), Linked workflow step | ❌ |
| Deliverable templates | Template Name, items; import client items from onboarding template | 🟡 standard setup items |
| Settings | Brewvo API key, integrations | ❌ |

---

## Build order

1. **Now (this round):** brand fields (industry, type, logo, tags, health), brand team per role, client documents checklist with a client upload link, setup item status and notes, deliverable priority, tags and block requests, content calendar, editable teams.
2. **Next:** monthly strategy, onboarding pipeline stages with history, view-only share links, bulk edit, invites and feature permissions.
3. **Later:** visual workflow builder (delay, email, API, condition and chain nodes), scheduled and event triggers, asset formats, Brewvo and HRMS integrations, push notifications.
