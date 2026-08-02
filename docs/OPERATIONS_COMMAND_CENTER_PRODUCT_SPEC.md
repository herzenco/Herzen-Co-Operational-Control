# Herzen Co. Operations Command Center — Product and Technical Specification

**Document status:** Working product specification  
**Version:** 1.0  
**Last updated:** July 31, 2026  
**Product owner:** Tito, Herzen Co.  
**Primary operator:** Lupe  
**Production:** `https://operations.herzenco.co`  
**Local development:** `http://localhost:4000`

## 1. Purpose

The Herzen Co. Operations Command Center (OCC) is the private operating system
for Tito and the Herzen Co. agent roster. It converts direction into assigned
work, preserves the record of execution, collects daily updates, packages
decisions for approval, and coordinates content from research through verified
publication.

The product must let Tito understand what requires his attention without
managing individual agents directly. Lupe is the operating layer between Tito
and the specialist agents: she receives direction, coordinates execution,
maintains the system of record, and communicates decisions and daily outcomes
to Tito.

### 1.1 Product promise

> Direction enters once. Ownership is explicit. Execution is documented.
> Decisions arrive with context. Outcomes remain auditable.

### 1.2 Primary outcomes

- Tito receives a concise daily operational picture and a focused decision
  queue.
- Lupe can see and manage the entire operation through both the interface and
  API.
- Every instruction has an owner, status, priority, definition of done, and
  documented outcome.
- Agent progress and blockers are visible without requiring separate status
  conversations.
- Content follows a consistent, enforceable path from research to publication.
- Sensitive company operations remain restricted to authorized Herzen Co.
  identities.

## 2. Scope

### 2.1 Included

- Company authentication and membership authorization
- Agent roster and agent spaces
- Projects and operating workstreams
- Instructions/tasks
- List and Kanban work views
- Work logs and execution evidence
- Daily agent updates and Lupe's daily brief
- Approval packages and decision history
- Content properties, accounts, formats, workflow, schedule, and evidence
- Lead and inquiry intake across company properties
- Programmatic access for Lupe
- Database-level validation and audit history
- Responsive desktop and mobile interfaces

### 2.2 Explicitly excluded from the current scope

- Public registration or external customer access
- Skydeo content generation or publishing
- Humanismo Evolutivo content while that property is paused
- Automated Instagram publishing on day one
- Replacing Lupe's existing LinkedIn publishing automation
- A second migration from the legacy Content Generator as a product
  requirement; OCC is intended to operate from its own Supabase database
- ChatGPT-branded authentication as the company login experience

## 3. Users, authority, and responsibilities

### 3.1 Tito — owner

- Final decision-maker and product owner.
- Has complete read and write authority.
- Approves every content item during the day-one quality-control period.
- Can approve, request revisions, decline, pause, or redirect work.
- Decides when Lupe may approve content without escalation.

### 3.2 Lupe — main operator

- Primary communicator with Tito.
- Has complete visibility across agents, projects, tasks, logs, updates,
  approvals, content, and activity history.
- Can create and manage agents, projects, tasks, updates, approval packages,
  and content records.
- Coordinates cross-agent dependencies and escalates conflicts or blockers.
- Reviews content packages for completeness before communicating with Tito.
- May approve operational work on Tito's behalf when authorized.
- Operates LinkedIn publishing through her existing external automation.

### 3.3 D8-A — product and technical operations

- Owns the Skydeo product and technical operations lane.
- Manages release readiness, onboarding, documentation, and technical work.
- Skydeo must not appear as a content property or publishing destination.

### 3.4 C-3PO — organic content and social

- Owns organic Instagram, LinkedIn, and website content production.
- Manages the content calendar and publishing coordination.
- References K2's research when creating content.
- Documents drafts, revisions, deliverables, and publishing outcomes.

### 3.5 K2 — research and optimization

- Supplies research, evidence, audience insight, optimization guidance, and
  content-format recommendations.
- Provides source material for C-3PO and Rex.
- Is not a mandatory approval gate for every content item.
- Helps determine which content types should be proposed, tested, activated,
  paused, or retired.

### 3.6 Rex — paid media

- Owns paid-media strategy, creative, campaign structure, tests, pacing, and
  optimization.
- References K2's research when producing paid content.
- Documents campaign execution and outcomes.

## 4. Permission model

The application uses four membership roles:

| Role | Read access | Write access | Intended user |
|---|---|---|---|
| `owner` | All operational records | All mutable resources and decisions | Tito |
| `operator` | All operational records | All mutable resources and decisions | Lupe |
| `agent` | Authorized operational records | Restricted by future policy | Specialist agents |
| `viewer` | Authorized operational records | None | Read-only stakeholder |

Current database policies permit active `owner` and `operator` members to
create, update, and delete operational records. All active members may read the
shared operation. Anonymous database access is revoked.

### 4.1 Authentication requirements

- Authentication is provided by Supabase Auth.
- Access requires an active record in `operations_members`.
- The company login accepts approved Herzen Co. identities; there is no public
  registration route.
- Browser sessions are refreshed through Supabase SSR cookie middleware.
- API clients authenticate with a short-lived Supabase bearer token.
- Passwords, access tokens, refresh tokens, service-role keys, and private
  publication evidence must never be committed or logged.

## 5. Information architecture

### 5.1 Desktop navigation

The desktop rail appears in this order:

1. Command
2. Kanban
3. List
4. Work Logs
5. Content
6. Leads
7. Approvals

The rail also contains agent spaces, the authenticated viewer identity, access
role, and sign-out action. Lupe appears first in the roster.

### 5.2 Mobile navigation

The mobile interface follows the Ink command deck design language:

- Sticky status and identity header
- Current-view title and prominent New action
- Horizontally scrollable selector for all seven operational views
- Fixed bottom navigation for Today, Work, Content, and Queue
- Touch targets of approximately 44 pixels where practical
- Dense tables reformatted as readable mobile cards
- Horizontal snap navigation for Kanban lanes
- Right-side desktop drawers converted into bottom sheets
- Safe-area-aware fixed navigation and no page-level horizontal overflow

## 6. Command view

The Command view is the default operational dashboard.

### 6.1 Required metrics

- Open instructions
- Work due today
- Pending approval packages
- Daily updates received versus expected

### 6.2 Daily brief

The daily brief must summarize:

- Today's primary focus
- Work or publication due today
- Decisions requiring Tito's attention
- Blocked or overdue work
- Missing agent updates
- Reporting health across the roster
- Recommended next actions when sufficient data exists

### 6.3 Operational snapshots

- A compact Kanban snapshot shows work in Inbox, In Progress, Review, and Done.
- Today's content calendar shows publishing time, content title, account,
  platform, and content type.
- Agent operating lanes show current workload and whether each agent has
  reported.
- The approval queue shows pending decisions and due dates.

### 6.4 Acceptance criteria

- The view must be usable without opening another screen for the day's basic
  operating picture.
- Every headline number must derive from live Supabase records.
- Empty states must explain what data will appear and how it gets there.
- Dates shown as “today” must use `America/New_York` business time.

## 7. Task and project management

### 7.1 Projects

A project groups instructions under a shared objective or workstream.

Project statuses:

```text
planned → active → paused → completed → archived
```

Project data includes name, slug, description, owner, objectives, status, and
metadata.

### 7.2 Instructions/tasks

Every task can contain:

- Title
- Context/description
- Project
- Owner agent
- Priority
- Due date and time
- Definition of done
- Dependencies
- Tags
- Current status
- Completion timestamp
- Extensible metadata

Task priorities:

```text
urgent | high | medium | low
```

Task statuses:

```text
inbox | in_progress | blocked | review | done | cancelled
```

Nominal workflow:

```text
Inbox → In Progress → Review → Done
                   ↘ Blocked
Any active state → Cancelled
```

### 7.3 List view

The List view provides a complete instruction ledger with:

- Completion control
- Instruction and context
- Owner
- Priority
- Status
- Due date
- Project
- Search and agent filtering inherited from the application header

On mobile, each ledger row becomes a card; horizontal table scrolling is not
required for ordinary task review.

### 7.4 Kanban view

The Kanban board groups work into Inbox, In Progress, Review, and Done. Blocked
work appears within the active work lane until a dedicated blocked-lane design
is introduced.

Each card shows project, priority, title, context, owner, and the available
advance action. Operators can create a new instruction directly in a lane.

### 7.5 Filtering and search

Tasks must be filterable by agent. Search should match the task record's
meaningful fields. Future versions should add explicit filters for project,
status, priority, due window, and tags instead of relying on free-text matching.

## 8. Agent spaces and reporting

### 8.1 Agent records

Each agent has:

- Stable code and display name
- Role and operating lane
- Active, paused, or retired status
- Charter and standing instructions
- Capability list
- Optional authenticated user identity
- Reporting relationship
- Extensible metadata

Lupe can create new agents and modify the roster through the API. Future UI
work should expose full agent creation and editing directly in the agent space.

### 8.2 Agent space

Selecting an agent opens a detailed surface containing:

- Identity, role, and lane
- Charter
- Current work and workload counts
- Latest daily update
- Current focus and assignments

### 8.3 Work logs

Work logs document execution against a task or agent lane.

Entry types:

```text
note | progress | decision | blocker | deliverable | evidence
```

Each log may contain a title, narrative body, task, agent, artifact references,
metadata, creator, and timestamps.

### 8.4 Daily updates

Each agent submits no more than one update per business date. The report
contains:

- Summary
- Completed work
- Blockers
- Next steps
- Asks
- Health: `on_track`, `at_risk`, or `blocked`

The Command view identifies missing reports. A future scheduled process should
request reports, enforce a cutoff, and generate Lupe's brief automatically.

## 9. Approval system

### 9.1 Approval package

An approval package must provide Tito enough context to make one decision. It
can link to a task, project, or content item and includes:

- Requested decision/title
- Executive summary
- Evidence or deliverable links
- Risks and tradeoffs
- Recommendation
- Requesting agent
- Optional reviewing agent
- Decision deadline
- Status and decision note

Approval statuses:

```text
pending | approved | changes_requested | declined | withdrawn
```

### 9.2 Decision behavior

- Tito or an authorized operator can approve, request changes, or decline.
- The decision records the authenticated user and decision timestamp.
- Content approval decisions update the linked content workflow.
- Decided packages remain visible as historical records.

## 10. Content operations

Content uses a dedicated domain model so publishing rules can be enforced
independently of generic tasks.

### 10.1 Properties and channels

| Property | Channel/account | Status | Publishing mode |
|---|---|---|---|
| Herzen Co. | Instagram | Active | Manual on day one |
| Herzen Co. | LinkedIn | Active | Lupe automated externally |
| Herzen Co. | Website | Active | OCC-managed target |
| Humanismo Evolutivo | Website | Paused | No activity until reactivated |
| Bubbles n Salt | Instagram | Active | Manual on day one |

Skydeo is explicitly excluded from the content property map.

### 10.2 Content types

Content types are intentionally configurable rather than permanently hard
coded. K2 may propose formats based on research and performance evidence.

Content type statuses:

```text
proposed | active | paused | archived
```

### 10.3 Content item data

A content record can contain:

- Title, brief, and working/final body
- Property and publishing channel/account
- Content type
- Organic or paid distribution mode
- Owner and research owner
- Linked task and approval package
- Research brief and metadata
- Workflow status
- Approval requirement and approval metadata
- Planned and actual publishing timestamps
- External automation job/status identifiers
- Final public URL
- Private screenshot evidence path
- Publishing failure detail
- Source-system and optional legacy cross-reference fields

### 10.4 Content workflow

```text
Idea
  → Research Ready
  → Drafting
  → Ready for Lupe
  → Awaiting Tito
  → Approved
  → Scheduled
  → Publishing
  → Published
```

Exception paths:

```text
Awaiting Tito → Revision Requested → Research Ready or Drafting
Any working state → Blocked
Publishing → Failed → Publishing or Cancelled
Any appropriate state → Cancelled
```

Day-one responsibility flow:

1. Tito or Lupe creates the content instruction.
2. K2 supplies relevant research and recommends the format.
3. C-3PO creates organic/website content or Rex creates paid content using that
   research.
4. The creator documents the draft and supporting context.
5. Lupe reviews completeness and assembles the approval package.
6. Lupe communicates the package to Tito.
7. Tito approves, requests revisions, or declines.
8. Approved content receives its publishing time.
9. The responsible automation or operator publishes it.
10. Lupe records the result, final URL, timestamp, and required evidence.

### 10.5 Database-enforced publishing rules

- Every content item requires Tito approval during the day-one control period.
- `approved`, `scheduled`, `publishing`, and `published` require both
  `approved_by` and `approved_at` when approval is required.
- `scheduled` requires `publish_at`.
- `published` requires `final_url`.
- Published Instagram content additionally requires private screenshot
  evidence.
- `failed` requires a failure explanation.
- A channel must belong to the selected property.
- Every status change is recorded in append-only content status history.

### 10.6 Content workspace

The content interface provides:

- Scheduled, with-Tito, published, and active-property metrics
- Filters by platform, account, content type, agent, and free-text search
- Schedule records containing date, content, platform, account, owner, stage,
  and valid next action
- Property cards showing channel status and publishing mode
- Create/edit bottom sheet or drawer
- Workflow progression actions
- Private evidence upload
- Final URL and publishing-result recording
- Status history for the selected item

### 10.7 Publishing integration boundaries

**LinkedIn:** OCC owns approval, schedule, and system-of-record tracking. Lupe's
external automation owns the actual post. A secure callback or polling contract
should eventually reconcile job state and final URL.

**Instagram:** Publishing is manual. Lupe records the URL and screenshot. Do not
automate until Tito authorizes the workflow.

**Website:** The channel is modeled as OCC-managed, but the authoritative
website feed consumer, deployment/revalidation hook, canonical URL callback,
and retry processing must be completed and verified before this is described as
fully automated.

## 11. API specification

### 11.1 Base URLs

```text
Local:      http://localhost:4000/api/v1
Production: https://operations.herzenco.co/api/v1
```

### 11.2 Authentication

```http
POST /api/v1/auth/token
Content-Type: application/json

{
  "email": "lupe@herzenco.co",
  "password": "<secret-manager-value>"
}
```

Authenticated requests include:

```http
Authorization: Bearer <supabase-access-token>
```

Refresh occurs through `POST /api/v1/auth/refresh` with the refresh token in the
JSON request body.

### 11.3 Resources

| Resource | Endpoint | Write access |
|---|---|---|
| Agents | `/api/v1/agents` | Owner/operator |
| Projects | `/api/v1/projects` | Owner/operator |
| Tasks | `/api/v1/tasks` | Owner/operator |
| Work logs | `/api/v1/work-logs` | Owner/operator |
| Daily updates | `/api/v1/daily-updates` | Owner/operator |
| Approvals | `/api/v1/approvals` | Owner/operator |
| Content properties | `/api/v1/content-properties` | Owner/operator |
| Content channels | `/api/v1/content-channels` | Owner/operator |
| Content types | `/api/v1/content-types` | Owner/operator |
| Content items | `/api/v1/content-items` | Owner/operator |
| Content status history | `/api/v1/content-status-history` | Read-only |
| Leads | `/api/v1/leads` | Owner/operator |
| Activity | `/api/v1/activity` | Read-only |

Mutable resources support collection `GET`/`POST` and item
`GET`/`PATCH`/`DELETE`. Collections support `limit` from 1–500 and zero-based
`offset`, along with resource-specific equality filters.

### 11.4 Overview endpoint

`GET /api/v1/overview` returns the authenticated viewer, permission level,
agents, projects, tasks, recent daily updates, approvals, recent activity, and
headline operational counts in one request.

### 11.5 API response behavior

- Successful collection responses include data and pagination metadata.
- Create requests return the created resource.
- Patch requests return the updated resource.
- Validation, authentication, authorization, not-found, and server failures use
  explicit HTTP status codes and JSON error messages.
- Write operations are also protected by database RLS and captured in the
  activity log.

## 12. Data architecture

### 12.1 Core tables

```text
operations_members
agents
projects
tasks
work_logs
daily_updates
approvals
activity_log
```

### 12.2 Content tables

```text
content_properties
content_channels
content_types
content_items
content_status_history
leads
```

### 12.3 Primary relationships

```text
Agent ──owns──> Project
Agent ──owns──> Task ──has──> Work Log
Agent ──submits──> Daily Update
Task/Project/Content Item ──requests──> Approval
Property ──has──> Channel
Content Item ──targets──> Property + Channel
Content Item ──uses──> Content Type
Content Item ──records──> Content Status History
Authenticated user ──produces──> Activity Log
```

### 12.4 Audit and history

- Inserts, updates, and deletes on mutable operational tables are copied into
  `activity_log` by database trigger.
- Content status changes are copied into `content_status_history`.
- Status history is append-only to authenticated application users.
- Evidence storage is private, limited to approved image MIME types, and capped
  at 10 MB per object.

## 13. Design system requirements

The OCC uses the Herzen Co. design system and Ink command deck visual language.

### 13.1 Visual principles

- Near-black operating field with restrained warm panels
- Ivory primary type, dim sandstone secondary type, muted metadata
- Copper/live accent for active state, focus, priority, and primary actions
- Editorial serif typography for major titles and numeric readouts
- Geometric sans serif for controls, labels, metadata, and operational text
- Fine rules, square geometry, restrained radius, and minimal decoration
- High information density without sacrificing scanability

### 13.2 Interaction principles

- Primary actions are visually singular and explicit.
- Status is communicated through text and shape, not color alone.
- Empty states explain the operational precondition for displaying data.
- Destructive behavior requires intentional controls and future confirmation.
- Mobile surfaces prioritize cards, scroll snapping, and bottom sheets.
- Desktop surfaces prioritize persistent navigation and comparative density.

### 13.3 Responsive breakpoints

- Desktop: above 1100 px
- Compact desktop/tablet: 761–1100 px
- Mobile: 760 px and below

## 14. Non-functional requirements

### 14.1 Security

- All operational pages require a valid company session.
- API requests require bearer-token authentication except token/refresh routes.
- Membership and role authorization must be checked server-side.
- RLS remains the final authorization boundary.
- Service-role credentials are limited to trusted server or operator scripts.
- Secrets never appear in source, query strings, logs, or documentation.

### 14.2 Reliability and integrity

- Business-critical workflow rules belong in database validation, not only UI
  logic.
- Writes must either complete successfully or return an actionable error.
- Publishing operations require idempotency before automated retries are added.
- Business-date calculations use `America/New_York`, including daylight-saving
  transitions.

### 14.3 Performance

- The first operational overview should load from a bounded number of API
  requests.
- Collection endpoints are paginated and indexed on common filters.
- UI lists must remain responsive with at least 500 returned records.
- Media evidence stays out of row payloads and is stored in private object
  storage.

### 14.4 Accessibility

- Interactive elements must have accessible names.
- Keyboard focus must remain visible.
- Touch controls should be approximately 44 × 44 px where practical.
- Text and essential status indicators must meet usable contrast requirements.
- Drawers and bottom sheets should gain focus, preserve reading order, and
  support keyboard dismissal in a future accessibility hardening pass.

### 14.5 Observability

- Deployment status is visible through Vercel.
- Operational mutations are available through `activity_log`.
- Publishing integrations should record external job ID, external status,
  attempts, failures, and final URL.
- Future automation must emit structured error information without exposing
  secrets.

## 15. Current implementation status

### 15.1 Implemented

- Supabase company authentication and session refresh
- Membership authorization and RLS
- Desktop Command, Kanban, List, Work Logs, Content, and Approvals views
- Mobile command-deck navigation, cards, snap lanes, and bottom sheets
- Agent roster and agent inspection
- Agent create/edit management, work-log entry, and daily-update submission
- Task creation and workflow progression
- Command metrics, daily brief, Kanban snapshot, and today's content calendar
- Content property/channel map and content workflow
- Cross-property lead intake, ownership, follow-up, and pipeline tracking
- Tito-linked content approval packages
- Publication URL, Instagram screenshot, and failure validation
- Private publication-evidence storage rules
- Lupe CRUD API and overview endpoint
- Activity and content-status history
- Vercel production deployment at `operations.herzenco.co`

### 15.2 Partially implemented

- Daily updates are modeled, displayed, and manually submitted, but automatic collection is absent.
- Website publishing is modeled as automated, but the destination integration
  is not verified end to end.
- LinkedIn publishing occurs externally without a completed reconciliation
  callback.
- Content history exists, but comments, formal versions, research-reference
  records, and richer asset management are not yet modeled.
- Calendar information appears in Command; full day/week/month calendar views
  are not yet implemented.

### 15.3 Legacy bridge note

The repository contains optional legacy cross-reference fields and helper
scripts. They are not required for the intended from-scratch OCC database.
Before anyone runs the importer, it must be reconciled with current approval,
published-URL, and timezone rules. It should otherwise remain unused or be
removed after the final migration decision.

## 16. Delivery roadmap

### Phase 1 — Finish the operating loop

- Add complete create/edit screens for projects; extend work logs and daily
  updates with historical edit controls beyond same-day report replacement.
- Add a full calendar with day, week, and month modes.
- Add explicit task detail, comments, dependencies, attachments, and audit
  context.
- Add content comments, version history, research references, and asset records.
- Restrict UI actions to valid next workflow transitions.
- Add explicit change notes for rescheduling and revisions.

### Phase 2 — Close publishing integrations

- Implement and verify the Herzen Co. website feed consumer.
- Add deployment/revalidation and canonical URL confirmation.
- Define LinkedIn callback or polling reconciliation with Lupe's automation.
- Model publishing attempts with idempotency keys, retry state, and alerts.
- Preserve manual Instagram publishing until Tito authorizes automation.

### Phase 3 — Automate daily operations

- Request daily updates automatically at a configured time.
- Flag silent agents after the reporting cutoff.
- Generate Lupe's daily brief on schedule.
- Notify Lupe of blocked work, overdue items, failed publications, and approval
  decisions.
- Deliver a concise daily brief and approval digest to Tito through the agreed
  communication channel.

### Phase 4 — Operational intelligence

- Add cycle-time, throughput, aging, blocker, approval-latency, publishing
  reliability, and reporting-compliance metrics.
- Give K2 a structured research library connected to content performance.
- Recommend content formats based on research and observed outcomes.
- Add capacity and dependency warnings across agent lanes.

## 17. Release acceptance criteria

A production release is acceptable when:

1. `npm run lint` has no errors.
2. `npm test` completes a successful production build and all automated tests
   pass.
3. Company login and unauthenticated redirect behavior work in production.
4. Owner and operator sessions can load the operational overview.
5. The release does not weaken RLS or expose anonymous database access.
6. Desktop navigation and all seven operational views remain usable.
7. A 390 × 844 mobile viewport has no page-level horizontal overflow, shows the
   mobile header and bottom navigation, and hides the desktop rail.
8. Content cannot bypass approval or required publication evidence.
9. The production deployment reaches Vercel `READY` and
   `operations.herzenco.co` resolves to it.

## 18. Open product decisions

- What exact authority will Lupe receive after the day-one content approval
  period ends?
- Which communication channel should receive the automated daily brief and
  decision queue?
- What reporting cutoff and timezone rules should apply to each agent?
- Which Herzen Co. website repository and publishing contract are
  authoritative?
- What secure callback contract can Lupe's LinkedIn automation support?
- When should Instagram move from manual to automated publishing?
- Which first content types should K2 activate, and what evidence retires an
  underperforming type?
- Should specialist agents receive direct authenticated UI access or operate
  exclusively through Lupe/API automation?

## 19. Source-of-truth files

- Product implementation: `app/command-center.tsx`
- Design and responsive behavior: `app/globals.css`
- Authentication middleware: `utils/supabase/middleware.ts`
- API resource contract: `utils/api/resources.ts`
- Core database: `supabase/schema.sql`
- Content database: `supabase/migrations/20260730000000_content_operations_v1.sql`
- Content indexes: `supabase/migrations/20260730000001_content_operations_indexes.sql`
- Lupe API guide: `docs/LUPE_OPERATIONS_API.md`
- Lupe handoff and roadmap: `docs/LUPE_HANDOFF_AND_ROADMAP.md`

When this specification conflicts with enforced database behavior, the
database is authoritative for current runtime behavior and this document must
be updated. When it conflicts with a later explicit decision from Tito, Tito's
decision becomes the product requirement and both implementation and
documentation must be reconciled.
