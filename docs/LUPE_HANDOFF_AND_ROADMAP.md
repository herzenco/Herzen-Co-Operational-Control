# Lupe Operations Control Center — Handoff and Roadmap

**Audience:** Lupe and any agent continuing development or operating the system

**Last updated:** July 31, 2026

**Local application:** `http://localhost:4000`

**Production target:** `https://operations.herzenco.co`

## Purpose

The Operations Control Center is Herzen Co.'s private system of record for
instructions, execution, daily reporting, approvals, and content operations.
Tito gives direction; Lupe turns that direction into assigned, documented,
auditable work and communicates decisions back to Tito.

This document answers four questions for Lupe:

1. What has already been built?
2. How should the system be operated today?
3. What important boundaries still exist?
4. What should be built next?

For endpoint-level instructions, use
[`LUPE_OPERATIONS_API.md`](./LUPE_OPERATIONS_API.md).

## Current operating authority

### Tito

- Company owner and final decision-maker.
- Must approve every content item during the day-one quality-control period.
- May request revisions, approve, or decline an approval package.
- Decides when Lupe has earned authority to approve content without escalation.

### Lupe

- Main operator and primary communicator with Tito.
- Has complete visibility across agents, tasks, projects, logs, reports,
  approvals, content, and audit history.
- Can create and manage agents, projects, instructions, reports, and content
  records through the authenticated API.
- Packages content for Tito, coordinates revisions, and records publishing
  outcomes.
- Operates the existing LinkedIn publishing automation outside this repository.

### Specialist agents

- **D8-A:** Skydeo product and technical operations. Skydeo is not a content
  property and must never enter the content-production system.
- **C-3PO:** Organic Instagram, LinkedIn, and website content. Uses K2 research
  when drafting.
- **K2:** Research, audience insight, optimization, and content-format
  recommendations. K2 is a research source, not a mandatory approval gate.
- **Rex:** Paid-media content and execution. Uses K2 research when creating
  campaigns and creative.

## What is implemented

### Authentication and permissions

- Company login backed by Supabase Auth.
- Access restricted to active Operations Control Center members.
- Company email validation for `@herzenco.co` identities.
- Owner and operator roles can write; other roles are restricted.
- Row Level Security is enabled on every exposed operational and content table.
- Anonymous database access is revoked.

### Command Center

- Live operational metrics for open work, due-today work, approvals, and daily
  reporting.
- Daily brief showing focus, Tito-attention items, blockers, overdue work, and
  missing reports.
- Snapshot of the Kanban board.
- Today's content publishing calendar, including account, platform, format, and
  time.
- Lupe appears first in the roster and agent spaces.

### Project-management workspace

- Navigation order: Command, Kanban, List, Work Logs, Content, Approvals.
- List and Kanban views read and write live Supabase records.
- Agent and project filtering.
- Search across instructions.
- Instruction creation, assignment, priority, due date, definition of done,
  status progression, and completion.
- Agent spaces showing charter, workload, and most recent daily update.
- Work logs for progress, decisions, blockers, evidence, and deliverables.
- Daily updates for completed work, blockers, next steps, asks, and health.
- Approval packages with summary, recommendation, risk, evidence, and decision.
- Immutable activity log for database changes.

### Content operations

Content is modeled separately from generic tasks so workflow rules can be
enforced consistently.

Implemented records:

- `content_properties`
- `content_channels`
- `content_types`
- `content_items`
- `content_status_history`
- linked `approvals`
- private `content-publication-evidence` Storage bucket

The Content workspace includes:

- Content schedule and operational metrics.
- Filters for platform, account, and content type.
- Property/channel cards and publishing modes.
- New-content form with brief, working copy, property, account, owner,
  distribution mode, publishing time, final URL, evidence, and failure detail.
- Workflow actions for research, drafting, Lupe review, Tito approval,
  scheduling, publishing, results, and revision.
- Append-only status history.
- Private screenshot uploads for publication evidence.

## Property and channel map

### Herzen Co.

- Instagram — active, manual on day one.
- LinkedIn — active, published through Lupe's existing external automation.
- Website — active, designated as OCC-managed.

### Humanismo Evolutivo

- Website — paused.
- Do not create, schedule, or publish content until Tito explicitly reactivates
  the property.

### Bubbles n Salt

- Instagram — active, manual on day one.

### Explicit exclusion

- Skydeo is a product/technical operations project, not a content property.
- Do not generate or schedule Skydeo content.

## Day-one content workflow

1. Tito or Lupe creates the content instruction.
2. K2 supplies relevant research, evidence, audience insight, and a recommended
   format.
3. C-3PO creates organic or website content; Rex creates paid content.
4. The creator documents the draft and supporting context in the content
   record.
5. The item moves to `ready_for_lupe`.
6. Lupe reviews completeness and sends a linked approval package to Tito.
7. The item moves to `awaiting_tito`.
8. Tito approves, requests revisions, or declines.
9. Approved content receives a publishing time and moves to `scheduled`.
10. Lupe or the configured publishing process moves it to `publishing`.
11. Lupe records the final URL, outcome, timestamp, and required evidence.
12. The item moves to `published`, or to `failed` with a documented reason.

Current statuses:

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

## Enforced rules

The database—not only the interface—enforces these requirements:

- Every content item requires Tito approval during the current quality-control
  period.
- An item cannot become `approved`, `scheduled`, `publishing`, or `published`
  without `approved_by` and `approved_at`.
- Scheduled content requires a publishing date.
- Published content requires a final public URL.
- Published Instagram content requires both a final URL and a screenshot.
- Failed publishing requires a failure explanation.
- A selected channel must belong to the selected property.
- Every content status change is preserved in append-only history.

## Publishing responsibilities

### LinkedIn

- Publishing is automated on Lupe's side, outside this repository.
- The Control Center is responsible for the approved handoff and operational
  record.
- Record external job/status information when available.
- Record the final LinkedIn URL and publishing timestamp.
- Record errors and retry state if Lupe's automation fails.

### Instagram

- Publishing is manual on day one.
- Lupe must record both the final post URL and a screenshot before marking the
  item published.
- Screenshots are private and belong in the Supabase evidence bucket.
- Instagram automation is a future integration.

### Website

- The channel is configured as `occ_automated`.
- Approval, scheduling, state, and final URL tracking exist now.
- The destination-site feed consumer, deploy/revalidation hook, canonical URL
  confirmation, and retry worker still need to be implemented or verified in
  the authoritative Herzen Co. website repository.
- Do not describe website publishing as end-to-end automated until that
  verification is complete.

## Lupe API access

Lupe can programmatically manage:

- Agents
- Projects
- Tasks
- Work logs
- Daily updates
- Approvals
- Content properties
- Content channels
- Content types
- Content items
- Content status history (read-only)
- Activity history (read-only)

The local API base is:

```text
http://localhost:4000/api/v1
```

The intended production API base is:

```text
https://operations.herzenco.co/api/v1
```

Lupe must use her Supabase access token as a bearer token. Passwords, access
tokens, and refresh tokens must remain in a secret manager or memory and must
never be committed, logged, or written into documentation.

## Current implementation boundary

The following are complete:

- Core database and RLS model.
- Content properties, channels, workflow, history, and evidence rules.
- Authenticated UI and generic Lupe CRUD API.
- Tito-linked approval decisions.
- Legacy Content Engine bridge fields on content items:
  `legacy_content_item_id`, `legacy_review_url`, and `source_system`.
- Migration helper scripts for importing the legacy local content schedule and
  generating tomorrow's OCC review pack.
- Local application and automated build/tests.

The following are modeled but not yet end-to-end integrations:

- Full cutover from the older Herzen Content Engine local state and review-pack
  scripts.
- Website feed delivery and destination-site confirmation.
- LinkedIn callback/webhook reconciliation with Lupe's automation.
- Instagram automated publishing.
- Automatic daily-update requests and scheduled brief generation.
- Automatic retry processing for failed publishing jobs.
- Rich media/version management for drafts and final creative assets.

## Recommended next build sequence

### Priority 1 — Stabilize content operation

- Move all daily review-pack and schedule reads from the old
  `herzenco-content-automation-state.json` file into OCC-backed content items.
- Import active and near-term Herzen Co. content from the legacy Content Engine
  into OCC and reconcile scheduled timestamps.
- Replace old WhatsApp content notices so they read OCC as the source of truth.

- Add a content-detail page or richer drawer with comments, versions, research
  references, attachments, and approval feedback.
- Add explicit research-reference records so C-3PO and Rex can cite the exact K2
  material used.
- Add content-type management for K2 to propose, test, activate, pause, and
  retire formats.
- Add transition-specific buttons and validation so operators see only valid
  next actions.
- Add edit and reschedule workflows with clear audit notes.

### Priority 2 — Close publishing loops

- Verify the authoritative Herzen Co. website repository.
- Implement the website content feed consumer and deploy/revalidation hook.
- Add canonical URL confirmation back to the Control Center.
- Define a secure callback or polling contract for Lupe's LinkedIn automation.
- Add publishing attempts, retries, idempotency keys, and failure alerts.
- Preserve the manual Instagram flow until Tito authorizes automation.

### Priority 3 — Improve daily operations

- Let every agent submit daily updates from its agent space.
- Automatically flag missing reports by cutoff time.
- Generate Lupe's daily brief from tasks, content, approvals, work logs, and
  blockers.
- Add calendar month/week/day views backed by content publishing dates and task
  due dates.
- Add notifications for overdue work, blocked items, Tito decisions, failed
  publishing, and silent agents.

### Priority 4 — Reporting and optimization

- Track performance metrics against published content.
- Connect K2 research to content outcomes.
- Compare organic and paid content by property, channel, account, and format.
- Build weekly operating summaries and recurring-blocker reports.
- Add approval-quality tracking so Tito can decide when Lupe may approve on his
  behalf.

## Conditions for expanded Lupe approval authority

Lupe must continue sending every content item to Tito until Tito explicitly
changes the policy. A future change should be deliberate and recorded as a
configuration value or permission—not inferred from elapsed time.

Useful signals for that decision:

- Revision-request rate is consistently low.
- Brand voice and factual accuracy are stable.
- K2 research is traceable in the final content.
- Published content reliably includes its evidence and URLs.
- Failures and exceptions are escalated correctly.

## Local development and verification

### Workflow designer status

The OCC now includes a definition-only workflow designer. Desktop operators can
compose and validate workflows with React Flow, save versioned definitions,
restore immutable snapshots, duplicate definitions, and import/export JSON.
Mobile remains a read-only workflow list. There is intentionally no execution
engine, scheduler, run history, or Run/Test control.

The additive workflow migration is
`supabase/migrations/20260731183050_workflow_definitions.sql`. It creates
`workflows` and `workflow_versions`, applies the existing active-member read and
owner/operator write model, and captures workflow changes in `activity_log`.

The production database migration must be applied and verified before the
workflow persistence UI can save remote records.

Run locally:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4000
```

Validate before handing off changes:

```bash
npm run lint
npm test
git diff --check
```

Do not push, deploy, or modify production configuration unless Tito explicitly
requests it.

## Continuation checklist for Lupe

Before starting development:

- Read this document and `LUPE_OPERATIONS_API.md`.
- Inspect `git status` and preserve all existing uncommitted work.
- Confirm which requirement is implemented versus planned.
- Use additive Supabase migrations and enable RLS on exposed tables.
- Keep credentials out of source and documentation.

Before finishing development:

- Run the build and tests.
- Test the affected flow locally at port 4000.
- Verify database rules, not only interface behavior.
- Update this handoff when responsibilities, workflows, properties, publishing
  modes, or roadmap priorities change.
- Do not push or deploy unless Tito has authorized it for that task.

## Key repository references

- [`LUPE_OPERATIONS_API.md`](./LUPE_OPERATIONS_API.md) — complete API contract.
- [`WORKLOG.md`](./WORKLOG.md) — chronological implementation notes.
- [`../supabase/schema.sql`](../supabase/schema.sql) — base operational schema.
- [`../supabase/migrations/20260730000000_content_operations_v1.sql`](../supabase/migrations/20260730000000_content_operations_v1.sql) — content operations schema and governance.
- [`../supabase/migrations/20260730000001_content_operations_indexes.sql`](../supabase/migrations/20260730000001_content_operations_indexes.sql) — content performance indexes.
- [`../app/command-center.tsx`](../app/command-center.tsx) — current operator interface.
- [`../utils/api/resources.ts`](../utils/api/resources.ts) — API resource allowlist and writable fields.
