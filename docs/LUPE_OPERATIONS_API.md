# Lupe Operations API

The Herzen Co. Operations API gives Lupe complete programmatic visibility and
operator control over the Operations Control Center.

## Security model

- Lupe has a dedicated Supabase Auth identity: `lupe@herzenco.co`.
- The API uses short-lived Supabase bearer tokens and renewable refresh tokens.
- Every request is checked against `operations_members`.
- Lupe is assigned the `operator` role with complete read and write access.
- Anonymous database access is revoked.
- Row-level security is enabled on every exposed table.
- Every create, update, and delete operation is captured in `activity_log`.
- Never put Lupe's password, access token, or refresh token in a URL, source
  file, log, issue, or chat transcript.

Local credentials are stored only in `.env.local` and are intentionally ignored
by Git. Production credentials should be placed in Lupe's secret manager.

## Base URLs

Local:

```text
http://localhost:3000/api/v1
```

Production:

```text
https://operations.herzenco.co/api/v1
```

## Authenticate

Exchange Lupe's company identity for a short-lived access token:

```http
POST /api/v1/auth/token
Content-Type: application/json

{
  "email": "lupe@herzenco.co",
  "password": "<from secret manager>"
}
```

The response includes `access_token`, `refresh_token`, `expires_at`, and Lupe's
operator membership. All other requests must include:

```http
Authorization: Bearer <access_token>
```

Refresh an expired session:

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "<refresh_token>"
}
```

## Complete visibility

`GET /api/v1/overview` returns the complete operational picture in one request:

- authenticated viewer and permission level
- all agents
- all projects
- all tasks
- recent daily updates
- all approvals
- the 50 most recent audit events
- headline counts for active work and pending decisions

`GET /api/v1` returns the API catalog and the caller's active role.

## Resources

| Resource | Collection endpoint | Lupe can |
|---|---|---|
| Agents | `/api/v1/agents` | Create, inspect, revise, pause, retire, or delete agents |
| Projects | `/api/v1/projects` | Create and manage projects and objectives |
| Tasks | `/api/v1/tasks` | Create, assign, prioritize, schedule, advance, complete, or delete tasks |
| Work logs | `/api/v1/work-logs` | Document progress, decisions, blockers, evidence, and deliverables |
| Daily updates | `/api/v1/daily-updates` | Submit and revise each agent's daily report |
| Approvals | `/api/v1/approvals` | Package, approve, decline, or request changes |
| Content properties | `/api/v1/content-properties` | Manage brands and pause or activate their content operation |
| Content channels | `/api/v1/content-channels` | Manage platform accounts and their publishing mode |
| Content types | `/api/v1/content-types` | Propose and activate the formats recommended by K2 |
| Content items | `/api/v1/content-items` | Create, document, approve, schedule, publish, and verify content |
| Content status history | `/api/v1/content-status-history` | Read the append-only content workflow history |
| Activity | `/api/v1/activity` | Read the immutable audit trail |

Every mutable resource supports:

```text
GET    /api/v1/{resource}
POST   /api/v1/{resource}
GET    /api/v1/{resource}/{id}
PATCH  /api/v1/{resource}/{id}
DELETE /api/v1/{resource}/{id}
```

`activity` is intentionally read-only.

## List, filter, and paginate

Collections accept `limit` from 1 to 500 and a zero-based `offset`.

```http
GET /api/v1/tasks?status=in_progress&owner_agent_id=<uuid>&limit=50&offset=0
```

Supported filters:

- Agents: `code`, `status`, `auth_user_id`, `reports_to`
- Projects: `slug`, `status`, `owner_agent_id`
- Tasks: `project_id`, `owner_agent_id`, `status`, `priority`
- Work logs: `task_id`, `agent_id`, `entry_type`
- Daily updates: `agent_id`, `update_date`, `health`
- Approvals: `task_id`, `project_id`, `requested_by_agent_id`,
  `content_item_id`, `reviewer_agent_id`, `status`
- Content properties: `slug`, `status`
- Content channels: `property_id`, `platform`, `status`, `publishing_mode`
- Content types: `slug`, `status`, `recommended_by_agent_id`
- Content items: `property_id`, `channel_id`, `content_type_id`,
  `owner_agent_id`, `distribution_mode`, `status`, `legacy_content_item_id`,
  `source_system`
- Content status history: `content_item_id`, `from_status`, `to_status`,
  `changed_by`
- Activity: `actor_user_id`, `action`, `entity_type`, `entity_id`

## Content operating model

The Operations Control Center is the intended system of record for content
operations. During the migration window, content items may also keep the legacy
Herzen Content Engine identifier and review URL so older drafts and schedules
can be reconciled here.

Supported bridge fields:

- `legacy_content_item_id`
- `legacy_review_url`
- `source_system`

Use `source_system = legacy_content_engine` only when importing or reconciling
older Content Engine records into the Control Center.

The initial properties and channels are:

- Herzen Co.: Instagram (`manual`), LinkedIn (`lupe_automated`), and Website
  (`occ_automated`).
- Humanismo Evolutivo: Website, paused.
- Bubbles n Salt: Instagram (`manual`).

Skydeo is not a content property.

Every content item uses this day-one governance:

1. K2 supplies research and format recommendations.
2. C-3PO creates organic social and website content, or Rex creates paid media.
3. Lupe reviews and assembles the approval package.
4. Tito must approve every item.
5. The approved item is scheduled and handed to the configured publisher.
6. Lupe records the final URL, result, and required evidence.

The database rejects `approved`, `scheduled`, `publishing`, and `published`
states until an approval decision has recorded both `approved_by` and
`approved_at`. Instagram also requires a final URL and screenshot path before
it can be marked `published`.

Content status values:

```text
idea
research_ready
drafting
ready_for_lupe
awaiting_tito
revision_requested
approved
scheduled
publishing
published
blocked
failed
cancelled
```

### Create a content item

```http
POST /api/v1/content-items
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "Founder operating note",
  "brief": "Turn K2's research into a concise LinkedIn post.",
  "property_id": "<Herzen Co. property uuid>",
  "channel_id": "<Herzen Co. LinkedIn channel uuid>",
  "owner_agent_id": "<C-3PO uuid>",
  "research_owner_agent_id": "<K2 uuid>",
  "distribution_mode": "organic",
  "status": "idea",
  "source_system": "operations_control_center"
}
```

### Send content to Tito

Lupe first creates an approval linked through `content_item_id`, then updates
the content item to `awaiting_tito` with the returned `approval_id`.

Approving the linked approval automatically records Tito as `approved_by`,
records `approved_at`, and moves the item to `approved`. Requesting changes
moves it to `revision_requested`.

### Record publication

LinkedIn publishing occurs through Lupe's external automation. The Control
Center tracks its external job/status and final URL. Website publishing is
OCC-managed. Instagram starts as manual.

```http
PATCH /api/v1/content-items/<content uuid>
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "status": "published",
  "final_url": "https://www.instagram.com/p/example/",
  "screenshot_path": "<private Supabase Storage object path>",
  "published_at": "2026-07-30T21:00:00Z"
}
```

Screenshots belong in the private `content-publication-evidence` bucket.
Authenticated owners/operators may upload JPEG, PNG, or WebP files up to 10 MB
under a folder named with their Supabase user ID.

### Import a legacy Content Engine item

```http
POST /api/v1/content-items
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "AI Speeds Up Clear Teams, Not Confused Ones",
  "property_id": "<Herzen Co. property uuid>",
  "channel_id": "<Herzen Co. Website channel uuid>",
  "owner_agent_id": "<C-3PO uuid>",
  "distribution_mode": "organic",
  "status": "scheduled",
  "source_system": "legacy_content_engine",
  "legacy_content_item_id": "41e91159-2284-4e17-aead-10c8c3adafc9",
  "legacy_review_url": "https://content.herzenco.co/review/41e91159-2284-4e17-aead-10c8c3adafc9",
  "publish_at": "2026-07-31T14:00:00Z"
}
```

## Common operations

### Create an agent

```http
POST /api/v1/agents
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "code": "r2",
  "name": "R2",
  "role": "Lifecycle marketing specialist",
  "lane": "Lifecycle",
  "status": "active",
  "charter": "Own lifecycle messaging, automation, and retention.",
  "capabilities": ["email", "automation", "retention"]
}
```

### Create and assign a task

```http
POST /api/v1/tasks
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "Prepare the Monday operating brief",
  "description": "Summarize every lane, blocker, and decision.",
  "project_id": "<project uuid>",
  "owner_agent_id": "<agent uuid>",
  "status": "inbox",
  "priority": "high",
  "due_at": "2026-08-03T13:00:00Z",
  "definition_of_done": "Tito receives a decision-ready brief."
}
```

### Advance a task

```http
PATCH /api/v1/tasks/<task uuid>
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "status": "review"
}
```

When status changes to `done`, the API automatically records `completed_at`.

### Document work

```http
POST /api/v1/work-logs
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "task_id": "<task uuid>",
  "agent_id": "<agent uuid>",
  "entry_type": "evidence",
  "title": "Release rehearsal complete",
  "body": "The migration completed twice without errors.",
  "artifacts": [
    {
      "label": "Run log",
      "url": "https://example.com/internal-artifact"
    }
  ]
}
```

### Submit a daily update

```http
POST /api/v1/daily-updates
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "agent_id": "<agent uuid>",
  "update_date": "2026-07-30",
  "summary": "Release readiness is on track.",
  "completed": ["Migration rehearsal", "Documentation review"],
  "blockers": [],
  "next_steps": ["Final smoke test"],
  "asks": [],
  "health": "on_track"
}
```

Only one daily update is allowed per agent per date. Revise the existing record
with `PATCH` when new information arrives.

### Package an approval

```http
POST /api/v1/approvals
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "task_id": "<task uuid>",
  "requested_by_agent_id": "<agent uuid>",
  "reviewer_agent_id": "<K2 uuid>",
  "title": "Ship Skydeo 2.4",
  "summary": "All release checks are complete.",
  "evidence": ["Two clean rehearsals", "Rollback tested"],
  "risk": "One API rate-limit question remains.",
  "recommendation": "Approve with monitoring.",
  "status": "pending"
}
```

When an approval is decided, the API automatically records `decided_by` and
`decided_at`.

## Status values

Tasks:

```text
inbox | in_progress | blocked | review | done | cancelled
```

Priority:

```text
urgent | high | medium | low
```

Agents:

```text
active | paused | retired
```

Projects:

```text
planned | active | paused | completed | archived
```

Daily-update health:

```text
on_track | at_risk | blocked
```

Approvals:

```text
pending | approved | changes_requested | declined | withdrawn
```

Work-log types:

```text
note | progress | decision | blocker | deliverable | evidence
```

## Response format

Successful responses:

```json
{
  "data": {}
}
```

Collection responses:

```json
{
  "data": {
    "items": [],
    "count": 0,
    "limit": 100,
    "offset": 0
  }
}
```

Errors:

```json
{
  "error": {
    "code": "write_failed",
    "message": "Human-readable error",
    "details": {}
  }
}
```

## Operating guidance for Lupe

1. Call `/auth/token` once, store tokens only in memory or a secret manager, and
   refresh before expiry.
2. Start each work cycle with `/overview`.
3. Resolve agents and projects by their stable UUID before creating related
   records.
4. Create every instruction as a task; never keep work only in conversational
   memory.
5. Record meaningful progress, evidence, decisions, and blockers as work logs.
6. Require a daily update from every active agent.
7. Use approvals for decisions that require Tito; include evidence, risk, and a
   recommendation.
8. Read the activity feed when reconciling state or investigating a change.
9. Never delete records merely to hide history. Prefer `cancelled`, `retired`,
   or `archived` unless deletion is genuinely required.
