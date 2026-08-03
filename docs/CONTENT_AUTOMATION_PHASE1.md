# Herzen Co. content automation — Phase 1

Phase 1 adds a persisted monthly generation, audit, review, delivery, and publishing loop to OCC. Blog and LinkedIn assets are always separate `content_items` joined by `content_pairs`; each receives its own audit history, approval state, secure review URL, publishing job, and final URL.

## Jobs and scheduling

`automation_schedules` stores five America/New_York schedules:

- last-Monday 9:00 AM monthly generation;
- Monday 9:00 AM weekly review pack;
- daily 8:00 AM publish-day notice;
- Monday 7:00 AM K2 context refresh;
- every-15-minute audit retry and publishing reconciliation pass.

Invoke `GET /api/cron/content-automation` with `Authorization: Bearer $CRON_SECRET` every minute. The route executes due schedules, persists `workflow_runs` and `workflow_run_logs`, and advances each schedule's `next_run_at`. Operators can manually run a job with `POST /api/v1/content-automation/run` and a Supabase member bearer token.

## Generation and learning context

The monthly run finds the `herzen-co` property plus active website and LinkedIn channels. K2 planning uses approved, rejected, revision-requested, and failed assets together with review comments and audit history. OpenAI then creates a 400–1500 word blog and a LinkedIn companion that links to the planned website URL. Evergreen fallback ideas are recorded as title and rationale only and are not drafted automatically.

Required server variables:

- `OPENAI_API_KEY` and optionally `OPENAI_CONTENT_MODEL`;
- `MANUS_AUDIT_URL` plus `MANUS_API_KEY`, or `ANTHROPIC_API_KEY` plus optionally `ANTHROPIC_AUDIT_MODEL`;
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`;
- `OCC_PUBLIC_URL`, `HERZEN_WEBSITE_URL`, and `CRON_SECRET`.

## Audit gate

`content_audits` stores every immutable attempt with separate SEO and AEO scores, blockers, summary, and rewrite guidance. A database trigger prevents any asset from entering review or a later state unless both scores are at least 80. Failed content is regenerated from audit guidance. Attempt 5 queues a Lupe check-in and pauses the item as `check_in_required`.

Manus is selected only when both Manus variables are configured. Otherwise the normalized Anthropic adapter is used. Both adapters return the same audit contract.

## Review URLs

Each passing asset receives a random 256-bit review token. Only its SHA-256 hash is stored in `content_review_links`. `/review/content/:token` shows that one asset and supports approve, request changes, decline, and comment. Events are appended to `content_review_events`. Decisions affect only the selected content item, so the blog and LinkedIn companion can proceed independently. Comments remain available to Lupe for triage and to future generation context.

## Delivery

Weekly packs select only the coming week's assets. Publish-day notices select that day's assets. Both use `titlesAndLinksOnly`, so delivery payloads contain no draft copy. An unapproved day-of item is labeled `final_checkpoint`; an approved item is labeled `heads_up`. Configure `LUPE_DELIVERY_WEBHOOK_URL` and optionally `LUPE_DELIVERY_WEBHOOK_SECRET` to send immediately; without a webhook the durable job remains available for Lupe's worker.

## Publishing and reconciliation

Approval queues one `content_publish_jobs` row for the selected asset. The retry worker dispatches website items to `HERZEN_WEBSITE_PUBLISH_URL` and LinkedIn items to `LUPE_LINKEDIN_PUBLISH_URL`. Both may use `PUBLISHING_WEBHOOK_SECRET`. A successful adapter response must include `final_url` or `url`; OCC writes it back to the content item and marks both the item and publish job as published.

## Operations

1. Apply `20260803103000_content_automation_phase1.sql`.
2. Configure the server variables above.
3. Configure an external scheduler to call the cron route every minute.
4. Monitor `workflow_runs`, `workflow_run_logs`, `content_delivery_jobs`, and `content_publish_jobs` through `/api/v1/:resource`.
5. Resolve `check_in_required` items after Lupe confirms direction with Herzen, then return them to `failed` for the next audit retry.

Phase 1 intentionally creates no images.
