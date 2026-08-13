# OCC Product and Operations Handoff to Lupe

Date: August 12, 2026
System: Herzen Co. Operational Command Center (OCC)
Primary production origin: `https://operations.herzenco.co`

## Purpose

This document hands off the OCC product changes made during Tito's review and defines the operating behavior Lupe must maintain. Use it as both a regression checklist and an operating contract.

Do not treat a visible card, count, status, feed, or report as correct merely because the interface rendered it. Confirm that it reflects the canonical OCC records and current operating reality.

## Canonical Navigation

The active OCC view is now determined by the URL. Every major tab must be directly loadable, shareable, and compatible with normal browser Back and Forward navigation.

| OCC view | Canonical path |
| --- | --- |
| Command | `/command` |
| Kanban | `/kanban` |
| Ticket detail | `/kanban/[ticket-id]` |
| List | `/list` |
| Work Logs | `/work-logs` |
| Content | `/content` |
| Creative Intake / asset library | `/creative-intake` |
| Agent Ops | `/agent-ops` |
| Leads | `/leads` |
| Approvals | `/approvals` |
| Workflows | `/workflows` |

Additional routing rules:

- `/` redirects to `/command`.
- Legacy `/tasks/[ticket-id]` links redirect to `/kanban/[ticket-id]` so previously shared links continue to work.
- Ticket **Copy link** and **Open stable link** actions must use `/kanban/[ticket-id]`.
- Closing a ticket detail returns to `/kanban`.
- Existing content-review query links are canonicalized onto `/content?content_item=[content-id]`.
- Authentication redirects must preserve the requested OCC path so the user lands on the intended page after signing in.

### Navigation acceptance checks

- Directly load every canonical path while authenticated and confirm the correct tab is active.
- Open a Kanban ticket and confirm the URL becomes `/kanban/[ticket-id]`.
- Copy the ticket link into a new authenticated tab and confirm the exact ticket opens.
- Use Back from a ticket to return to the board and use Back/Forward between OCC tabs.
- Confirm desktop navigation, mobile navigation, Command shortcuts, approval shortcuts, and agent-drawer shortcuts all update the URL.
- Confirm no UI share action produces a new `/tasks/[id]` link.

## Command and Daily Brief

The Daily Brief is now an agent stand-up report rather than four generic summary boxes.

For every active agent, show:

- what the agent completed yesterday;
- what the agent is doing today;
- blockers or an explicit `None reported` state.

The former standalone roster-state panel was consolidated into this report. The stand-up must be useful without requiring Tito to inspect a separate roster panel.

The publishing portion of Command is split into:

- **You post** — Instagram and other publishing that requires Tito's manual action;
- **Agents post** — automated or delegated publishing handled by Lupe or another agent.

Lupe must keep these assignments accurate. A scheduled item must not appear under Tito merely because it lacks an owner, and an Instagram item must not appear under agent publishing if Tito must manually publish it.

## Required Morning Due-Date Routine

Every active task must have a due date.

Every morning, Lupe must:

1. Query all active, non-completed tasks that have no due date.
2. Present Tito with the missing-date list before assigning new work.
3. Ask Tito for a due date for each item.
4. Record the supplied date on the canonical task record.
5. Continue asking on subsequent mornings until every active task has a due date.
6. Never invent, infer, or silently assign a deadline unless Tito has explicitly authorized a default rule.

The List view displays a Lupe prompt when missing due dates exist and allows Tito to assign the first missing deadline. This interface prompt supplements the morning routine; it does not replace Lupe's responsibility to ask.

## Kanban

Kanban tickets now support drag and drop between workflow columns. A successful drop must update the canonical task status, not only the visual column.

Tickets also display:

- project identity;
- task tags;
- assignee and priority;
- the existing ticket information needed to understand the work.

Kanban filtering includes project and tag filters. Lupe may create and maintain tags when doing so improves project organization. Tags must be concise, reusable, and applied consistently; do not create near-duplicates for spelling or capitalization variants.

Every ticket is directly openable at `/kanban/[ticket-id]`. Lupe should use that canonical URL when sharing a ticket with Tito or another operator.

### Kanban acceptance checks

- Drag one safe test ticket between columns and confirm the status persists after refresh.
- Filter by project and tag and confirm only matching tickets remain.
- Click the ticket body and confirm its detail opens at the canonical ticket URL.
- Confirm **Copy link** copies the canonical `/kanban/[ticket-id]` URL.

## List View

The instruction ledger now supports sorting by:

- instruction;
- owner;
- priority;
- status;
- due date;
- project.

Clicking a row opens the corresponding ticket detail. Owner text must stay inside its column and may not overlap the description.

For blocked items, hovering or focusing the blocked status shows the blocker reason. Lupe must ensure blocker details are documented on the task itself; the interface falls back to the task description only when no explicit blocker field exists.

Items without a due date are visually identified and included in the due-date prompt described above.

## Content Operations

The Content page no longer displays Humanismo Evolutivo in the active property switcher. Herzen Co. and Bubbles n Salt remain the active publishing properties shown there.

Full feed previews are collapsed by default. The user opens them with **Feed Preview** rather than loading the entire feed immediately.

### Lupe's monthly feed responsibility

At the start of each month, and whenever the publishing plan changes, Lupe must update each property feed preview so it reflects what is actually planned for that month.

The feed must not contain stale mockups, last month's posts, or aspirational items that are absent from the canonical content calendar. Reconcile the preview against current content records, scheduled dates, platforms, accounts, and final creative assets.

### Scheduling investigation required

The Content metrics showed `Scheduled 00` even though content should already be moving toward publication. Lupe must investigate and report to Tito:

- why the scheduled count is zero;
- whether content records are missing dates, approval, ownership, channels, or a scheduling transition;
- which items should already be scheduled;
- the exact remediation for each item;
- whether the issue is data quality, workflow behavior, automation failure, or genuinely missing work.

Do not resolve this by changing the displayed count. Correct the underlying records or workflow and provide evidence.

## Content Preview and Approval

Content preview drawers are approval-first:

- Tito can quickly read the full publishing copy.
- Platform, account, publication date, and owner are visible before approval.
- **Approve content** and **Request changes** are available near the decision context.
- Content without a publication date directs the user to add a date before approval.
- Empty creative placeholders are not shown merely to say that no creative exists.

Every content item must have an owner. Apply the operating lane that matches the work:

- research: K2;
- paid media: Rex;
- social planning, packaging, and publishing coordination: C-3PO;
- operational review, routing, and delivery: Lupe;
- Tito: owner when Tito's approval or direct decision is the active responsibility;
- product and technical operations: D8-A where applicable.

Do not leave content unassigned. If a record crosses lanes, assign the owner responsible for the current stage and document the next handoff.

Tito must be able to see the publication platform and date before approving. If either is missing, the item is not approval-ready.

## Creative Intake / Asset Library

Creative Intake has been refocused as an upload-first asset bucket. Tito should not have to draft or classify every item before handing it off. The primary interaction is:

1. Tito selects the campaign and drops one or more raw creative assets into Creative Intake.
2. OCC stores each file as a campaign-linked draft asset.
3. Lupe takes responsibility for organizing the intake, including classification, naming, grouping, and routing.
4. Lupe sends the creative assets to both C-3PO and K2 for review.
5. C-3PO reviews creative execution, messaging, format, and production readiness. K2 reviews research alignment, audience fit, and optimization implications.
6. Lupe reconciles their feedback and keeps the assets in the creative workflow until the ads are ready to be created.
7. At that point, ownership transfers to Rex. Rex sets up and operates the paid-media campaigns using the reviewed assets and the linked campaign context.

In shorthand, the operating sequence is:

> Tito drops creative assets → Lupe organizes and routes them → C-3PO and K2 review → ads become build-ready → Rex takes ownership and sets up the paid-media campaigns.

Manual copy drafting remains available as an exception workflow, not the default intake requirement. The asset collection remains organized and filterable by:

- campaign;
- platform;
- ad group;
- asset type;
- workflow state.

Each asset card surfaces platform, type, version, campaign, status, destination, variant count, and update time.

Workflow-state badges use explicit high-contrast colors. Card actions share a consistent baseline, including **Upload file**.

The former **Supersede** action is now **Mark as replaced**, with an explanation that it marks the current version as replaced by a newer asset.

### Asset preview and approval rules

Tito must never be asked to approve an asset he cannot inspect.

- Clicking a card or **View asset** opens an asset preview drawer.
- Image and logo files are displayed using signed private URLs.
- Text assets display their actual variants, not only metadata.
- Approval and rejection controls appear alongside the asset preview.
- A visual asset with no uploaded file cannot be requested for review or approved.
- Missing visual files must be uploaded before approval.

### Asset-library acceptance checks

- Select a campaign and drop multiple supported image assets in one intake action.
- Confirm each file becomes a campaign-linked draft without requiring manual copy fields.
- Confirm Lupe can identify the intake as awaiting C-3PO and K2 review.
- Confirm Rex does not take ownership until the assets are ready for ad creation.
- Open an image or logo asset and confirm the actual file renders.
- Open an RSA or other text asset and confirm every variant is readable.
- Confirm visual approval is disabled when no file exists.
- Approve or reject only after verifying the asset, campaign, platform, destination, and current version.
- Confirm all five filters produce accurate results.

## Operational Data Standards

Lupe must maintain the following invariants:

- Every active task has a due date or is actively awaiting Tito's answer that morning.
- Every task and asset has the correct project or campaign association.
- Tags describe real, reusable classifications.
- Every blocked task has a specific blocker reason.
- Every content item has an owner.
- Every approval-ready content item has a platform and publication date.
- Feed previews match the current month's actual publishing plan.
- Agent stand-up data reflects canonical work logs and daily updates.
- Shared ticket links use `/kanban/[ticket-id]`.
- UI counts are consequences of canonical data, never manually adjusted substitutes for it.

## Validation Already Completed

The following checks passed during implementation:

- the complete automated suite passed: 126 tests, 0 failures;
- production build completed with all canonical routes recognized;
- the configured Vercel production build (`npx next build`) completed successfully, including TypeScript and all routed pages;
- targeted ESLint completed without routing errors;
- Git diff whitespace checks passed;
- `/command` loaded directly with Command active;
- `/content` loaded directly with Content active;
- UI navigation from `/command` to `/kanban` updated the URL and active view;
- a real `/kanban/[ticket-id]` direct load opened the full authenticated ticket dialog;
- private asset preview URLs loaded uploaded SVG assets successfully;
- asset status colors and action alignment were checked in the rendered interface;
- creative filters and preview approval controls were present in the rendered interface.

Known non-blocking implementation advisories:

- The build reports a bundle-size advisory for large generated client chunks.
- The broader command-center file contains a pre-existing unused `advanceContent` warning.
- Signed asset previews use a normal image element because the URL is generated dynamically; lint may report the standard image-optimization advisory.

## Lupe's Post-Handoff Verification

Lupe must run this checklist in the deployed OCC at `https://operations.herzenco.co` after the changes are deployed:

1. Verify every canonical path in the route table.
2. Verify direct authenticated ticket links and legacy ticket redirects.
3. Verify Back and Forward across at least three OCC tabs and one ticket.
4. Verify a Kanban drag persists after refresh.
5. Verify project and tag filters.
6. Verify List sorting for every column.
7. Verify a blocked-item tooltip contains the documented blocker.
8. Identify all active tasks without due dates and ask Tito for each date.
9. Verify the Daily Brief has yesterday, today, and blockers for every active agent.
10. Verify today's publishing is correctly split between Tito and agents.
11. Reconcile the visible monthly feeds against the canonical current-month publishing plan.
12. Investigate and report why scheduled content is zero; repair underlying records or workflow as authorized.
13. Verify every content item has an owner appropriate to its current lane.
14. Verify content cannot be approved without knowing its platform and publication date.
15. Verify visual creative cannot be approved without an inspectable file.

## Completion Standard

Lupe may report this handoff as operational only when:

- all deployed routes and direct links work;
- Back and Forward behavior is verified in production;
- the current-month content feed is reconciled;
- the scheduled-content discrepancy has a documented cause and remediation;
- every active task missing a due date has been presented to Tito;
- no approval-ready content or creative lacks the information or asset Tito needs to make the decision.

If any check fails, create or update the canonical OCC ticket, include the failing URL and exact reproduction steps, assign the correct owner, set a due date with Tito, and report the blocker in the next Daily Brief.

## Primary Implementation Files

- `app/command-center.tsx`
- `app/creative-assets.tsx`
- `app/task-detail-dialog.tsx`
- `app/occ-page.tsx`
- `app/page.tsx`
- `app/command/page.tsx`
- `app/kanban/page.tsx`
- `app/kanban/[id]/page.tsx`
- `app/list/page.tsx`
- `app/work-logs/page.tsx`
- `app/content/page.tsx`
- `app/creative-intake/page.tsx`
- `app/agent-ops/page.tsx`
- `app/leads/page.tsx`
- `app/approvals/page.tsx`
- `app/workflows/page.tsx`
- `app/tasks/[id]/page.tsx`
- `app/globals.css`
