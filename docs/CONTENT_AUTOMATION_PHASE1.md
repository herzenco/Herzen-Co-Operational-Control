# Herzen Co. content automation — Phase 1

Phase 1 adds a persisted monthly generation, audit, review, delivery, and publishing loop to OCC. Blog and LinkedIn assets are always separate `content_items` joined by `content_pairs`; each receives its own audit history, approval state, secure review URL, publishing job, and final URL.

## Jobs and scheduling

`automation_schedules` stores five America/New_York schedules:

- last-Monday 9:00 AM monthly generation;
- Monday 9:00 AM weekly review pack;
- daily 8:00 AM publish-day notice;
- Monday 7:00 AM K2 context refresh;
- every-15-minute audit retry and publishing reconciliation pass.

The sole scheduler is the Vercel Cron configured in `vercel.json` for the production OCC project. It invokes `GET /api/cron/content-automation` every minute with `Authorization: Bearer $CRON_SECRET`. Keep `CONTENT_AUTOMATION_ENABLED=false` until migration and canary validation are complete. Database conditional claims and unique run keys prevent concurrent calls from executing the same cycle; duplicate invocations add a `skipped_duplicate` run log. Manual runs require both a Supabase member bearer token and an `Idempotency-Key` header.

## Generation and learning context

The monthly run finds the `herzen-co` property plus active website and LinkedIn channels. K2 planning uses approved, rejected, revision-requested, and failed assets together with review comments and audit history. OpenAI then creates a 400–1500 word blog and a LinkedIn companion that links to the planned website URL. Evergreen fallback ideas are recorded as title and rationale only and are not drafted automatically.

Required server variables:

- `OPENAI_API_KEY` and optionally `OPENAI_CONTENT_MODEL`;
- `MANUS_AUDIT_URL` plus `MANUS_API_KEY`, or `ANTHROPIC_API_KEY` plus optionally `ANTHROPIC_AUDIT_MODEL`;
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`;
- `OCC_PUBLIC_URL`, `HERZEN_WEBSITE_URL`, `CRON_SECRET`, and `CONTENT_AUTOMATION_ENABLED`.

## Audit gate

`content_audits` stores every immutable attempt with separate SEO and AEO scores, blockers, summary, and rewrite guidance. A database trigger prevents any asset from entering review or a later state unless both scores are at least 80. Failed content is regenerated from audit guidance. Attempt 5 queues a Lupe check-in and pauses the item as `check_in_required`.

Manus is selected only when both Manus variables are configured. Otherwise the normalized Anthropic adapter is used. Both adapters return the same audit contract.

## Review URLs

Each passing asset receives a random 256-bit review token. Only its SHA-256 hash is stored in `content_review_links`. `/review/content/:token` shows that one asset and supports approve, request changes, decline, and comment. Events are appended to `content_review_events`. Decisions affect only the selected content item, so the blog and LinkedIn companion can proceed independently. Comments remain available to Lupe for triage and to future generation context.

## Delivery

Weekly packs select only the coming week's assets. Publish-day notices select that day's assets. Both use `titlesAndLinksOnly`, so delivery payloads contain no draft copy. An unapproved day-of item is labeled `final_checkpoint`; an approved item is labeled `heads_up`. Every job is queued with an idempotency key and atomically claimed with a lease. It becomes `sent` only when the authenticated webhook returns `delivered: true` and a provider message ID. Failures retain attempt/error/retry data. Expired or legacy `sending` rows become `recovery_required`, never automatic retries, because the provider may already have accepted the message.

## Publishing and reconciliation

Website approval freezes the final website payload and queues its OCC-managed publish job. LinkedIn approval records the independent decision only; it does not notify or trigger Lupe. When Herzen asks Lupe to publish a specific approved LinkedIn item, Lupe claims `POST /api/v1/content-items/:id/linkedin-publication`, publishes the returned final copy and media through Lupe's own connection, and writes the result back with `PATCH` on the same URL. The content ID is the stable dedupe key, concurrent or repeated claims cannot publish again, and every claim/result remains in `content_publish_jobs` and `content_publish_attempts`. The OCC retry worker is website-only.

## Operations

1. Leave `CONTENT_AUTOMATION_ENABLED=false`; manual OCC use remains available.
2. Validate and apply `20260806113000_content_delivery_job_leases.sql` after a production snapshot.
3. In Vercel, confirm the production project, cron path, UTC schedule, `CRON_SECRET`, retry/timeout policy, and owner. Remove any other provider targeting this endpoint.
4. Reconcile every `recovery_required` delivery against WhatsApp provider message IDs. Mark confirmed messages sent; only explicitly requeue rows proven not delivered.
5. Verify production/preview separation for `CRON_SECRET`, `LUPE_DELIVERY_WEBHOOK_URL`, `LUPE_DELIVERY_WEBHOOK_SECRET`, and `SUPABASE_SECRET_KEY` without printing values.
6. Run one generation/review canary, one WhatsApp canary, and one approved website-publish canary. Confirm destination state and audit records.
7. Set `CONTENT_AUTOMATION_ENABLED=true` only after canaries pass; pause safely by returning it to `false`.

## Ownership and source-of-truth contract

- Provider: Vercel Cron; account/project and named human owner must be recorded in the production change ticket.
- Schedule/timezone: `* * * * *` in UTC; application schedules are interpreted in America/New_York.
- Endpoint/authentication: production `/api/cron/content-automation`, bearer `CRON_SECRET`.
- Retry/timeout: confirm the deployed Vercel plan's current behavior in the production change ticket; database idempotency makes retries safe.
- OCC owns working state, runs, jobs, drafts, and reports. The Lupe folder owns canonical business context.
- OCC output is a proposal until Lupe validates and files it. Sync code must never overwrite canonical Lupe records automatically.
- Filesystem automation receives `LUPE_CANONICAL_ROOT` or `BUBBLES_INSTAGRAM_ROOT`; the canonical Bubbles path is `02 Projects/Bubbles n Salt/Active/Instagram Brand/` under the Lupe root.

Phase 1 intentionally creates no images.
