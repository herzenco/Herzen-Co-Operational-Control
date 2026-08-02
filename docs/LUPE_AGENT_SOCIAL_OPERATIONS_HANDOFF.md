# Lupe Handoff — Agent-Driven Social Operations

**Prepared for:** Lupe  
**Prepared:** August 1, 2026  
**System:** Herzen Co. Operations Control Center (OCC)  
**Review status:** Ready for Lupe review; database migration not yet applied

## Review objective

Confirm that OCC should become the only trusted source for agent-created social-media research, packages, proposals, feedback, handoffs, and final delivery assets.

The implementation is complete in the local codebase. It has not been deployed or applied to the production Supabase database. Lupe should review the operating model and acceptance checklist below before authorizing rollout.

## Decision requested from Lupe

Approve or return the implementation based on these questions:

1. Should every C-3PO publish-ready package require a linked, final K2 research artifact?
2. Should every Rex paid-media proposal require both final research and a final organic or creative package?
3. Should OCC block delivery whenever the caption, source asset, exported delivery asset, posting instructions, approval, or required feedback is incomplete?
4. Is a one-hour signed download link appropriate for Lupe's final asset retrieval?
5. Should existing content be backfilled into the new canonical model before the migration is deployed?

## What changed

### Agent workspaces

OCC now models agent-owned work as first-class records. Each artifact includes:

- agent identity;
- work type;
- title, body, and summary;
- attachments or asset references;
- status;
- linked post, campaign, project, or lane;
- notes, creator, and timestamps.

Supported work includes research, optimization, organic packages, creative proposals, paid-media proposals, review, delivery, and handoff artifacts.

### Canonical content packages

The existing `content_items` model now carries the final operational package:

- brand/property and platform;
- planned publication time;
- final caption, hashtags, tags, CTA, and posting instructions;
- exact source asset and exact exported delivery asset;
- approval and publication states;
- feedback version;
- linked research, creative, and paid-media work;
- an approved package manifest used to detect caption or asset disagreement;
- delivery actor and timestamp.

### Structured feedback

Herzen feedback is now a versioned record attached to a post, campaign, or agent artifact. Its state is one of:

- `received`;
- `applied`;
- `blocked`;
- `superseded`.

Required feedback in `received` or `blocked` state prevents final advancement.

### Handoff chain

The intended chain is:

1. K2 creates and finalizes research in OCC.
2. C-3PO uses that OCC research to build the organic package.
3. Rex uses the same research plus the organic/creative package to build paid-media proposals.
4. Lupe reviews the chain, approval state, exact assets, and unresolved feedback.
5. Lupe retrieves the final delivery package directly from OCC.

K2 remains a research provider rather than an approver. The new rule makes K2's artifact a required upstream production dependency for C-3PO; it does not grant K2 approval authority.

## Enforcement behavior

Database triggers reject advancement when:

- a required upstream work item is not final;
- C-3PO has no linked final K2 research;
- Rex lacks final research or a final creative/organic package;
- required feedback is unresolved;
- the final caption is missing;
- the exact source or delivery asset is missing, belongs to another record, or is no longer current;
- posting instructions are missing before scheduling or publishing;
- structured approval is not approved;
- the caption or asset IDs disagree with the canonical package manifest;
- delivery lacks the exact OCC delivery asset or the delivering agent.

These gates execute in PostgreSQL, so an agent or API client cannot bypass them by skipping the interface.

## OCC operator view

The new **Agent Ops** view provides filters for:

- agent;
- brand/property;
- platform;
- content status;
- dependency-blocked state;
- publication date;
- unresolved feedback;
- ready-to-deliver state.

Each package card shows its agent handoff chain and whether it is ready or gated.

## How Lupe retrieves a final package

### From the OCC interface

1. Open **Agent Ops**.
2. Select a brand or publication date if needed.
3. Set **Signal** to **Ready to deliver**.
4. Review the displayed handoff chain.
5. Click **Download final package**.

The downloaded JSON package contains:

- final caption;
- hashtags;
- posting instructions;
- tags;
- CTA;
- approval state;
- feedback version;
- exact source asset metadata;
- exact delivery asset metadata and a one-hour signed download URL;
- `source_of_truth: "OCC"`.

### Through the authenticated API

```http
GET /api/v1/content-items/{content-item-id}/deliverable
Authorization: Bearer {access-token}
```

Incomplete packages return HTTP `409` with code `package_blocked`. An unavailable canonical asset returns `delivery_asset_unavailable`.

## Rollout prerequisites

Before production rollout:

1. Review and approve this operating model.
2. Back up the production Supabase database.
3. Decide whether existing publish-ready content must be backfilled first.
4. Apply `20260802000000_agent_social_operations.sql` to the target Supabase project.
5. Verify K2, C-3PO, Rex, and Lupe agent identities are correctly mapped to authenticated users where direct agent writes are expected.
6. Backfill source assets, delivery assets, linked research, posting instructions, and approvals for any existing item that must continue advancing.
7. Deploy the OCC application.
8. Run the acceptance review below against representative organic and paid packages.

## Lupe acceptance review

### K2 → C-3PO

- [ ] K2 can create a research artifact tied to a post or project.
- [ ] C-3PO can see and link the artifact.
- [ ] C-3PO is blocked while required K2 research is unfinished.
- [ ] C-3PO can advance after the research becomes final.

### Rex

- [ ] Rex can reuse the same research.
- [ ] Rex is blocked without final research.
- [ ] Rex is blocked without a final creative or organic package.
- [ ] Rex can finalize after both dependencies are complete.

### Feedback

- [ ] Herzen feedback can be attached to a post, campaign, or work item.
- [ ] Required `received` feedback blocks final advancement.
- [ ] Applying or superseding feedback clears the gate.
- [ ] The feedback change appears in the audit history.

### Source of truth

- [ ] Source and delivery assets are exact OCC asset records.
- [ ] A mismatched or obsolete asset blocks delivery.
- [ ] A caption or asset mismatch against the approved manifest blocks advancement.
- [ ] The final download points to the OCC delivery asset.

### Lupe delivery

- [ ] The Agent Ops date and readiness filters return the expected package.
- [ ] The final package contains every required posting field.
- [ ] The signed asset URL downloads the expected exported file.
- [ ] A gated package cannot be downloaded through the interface or API.

## Validation completed

- Full automated suite: **65 tests passed**.
- Social-operations enforcement suite: **5 tests passed**.
- TypeScript check: passed.
- ESLint: passed.
- Production build: passed.
- Build advisory: the existing client bundle reports a chunk larger than 500 kB; this did not fail the build.

The migration has been validated through automated source and behavior tests, but it has not yet been exercised against the production Supabase database.

## Implementation map

- Database model and enforcement: `supabase/migrations/20260802000000_agent_social_operations.sql`
- Resource API definitions: `utils/api/resources.ts`
- Agent write authorization: `utils/api/auth.ts`
- Readiness logic: `utils/social-operations.ts`
- Final-package endpoint: `app/api/v1/content-items/[id]/deliverable/route.ts`
- Agent Ops interface: `app/command-center.tsx`
- Interface styling: `app/globals.css`
- Tests: `tests/social-operations-migration.test.ts`

## Review outcome

Lupe should record one of the following:

- **Approved for migration and deployment**
- **Approved after existing-content backfill**
- **Changes requested** — document the required operating or enforcement changes
- **Blocked** — document the dependency or decision preventing rollout

