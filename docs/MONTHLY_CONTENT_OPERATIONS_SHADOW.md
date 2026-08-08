# Monthly Content Operations — unpublished shadow lane

Request: `REQ-20260807-200333-monthly-content-operations-readiness-audit`

This is a manual-only validation lane. It creates one unpublished website blog and one related, independently reviewable LinkedIn post. It creates no schedule, approval, delivery job, publication job, or review link. The retired Content Engine and all recurring schedules remain disabled.

## Invocation and traceability

`POST /api/v1/monthly-content-operations/shadow-run` requires an OCC owner/operator session or Lupe's existing scoped machine credential, plus `OCC_MONTHLY_CONTENT_SHADOW_ENABLED=true`. The request requires:

- request ID and idempotency key;
- a final K2-owned research-record ID;
- C-3PO's editorial brief;
- target month and complete topic fields.

The workflow stores the request, workflow run, generation run, provider, model, prompt version, timestamps, trace ID, independent content IDs, every QA result, and each failed-draft rewrite. Retrying the idempotency key returns the original run and cannot create a second pair.

K2 research, C-3PO packaging, and Lupe acceptance work are represented as dependent OCC work items. Lupe can read the content, audits, rewrite history, and assigned review item through the existing machine-auth API. `POST /api/v1/content-items/{id}/lupe-review` records an idempotent acceptance result. It can only observe an existing authoritative Tito decision; it cannot create or change an approval.

## QA boundary

Anthropic QA records independent integer SEO and AEO scores, separate explanations, rewrite instructions, model, rubric version, iteration, evaluation time, and trace ID. Both scores must be at least 80. Fractional values are floored, never rounded upward. Failed drafts remain in drafting/blocked states and are never exposed as approval-ready. OpenAI receives the recorded rewrite guidance, and the loop stops after three iterations. Provider, persistence, or validation failures mark the run and any created content as blocked/failed; they are never scheduled for retry.

## Website publishing consumer audit

Target: the Herzen Co. website consumer configured by `HERZEN_WEBSITE_PUBLISH_URL`.

Required frozen payload fields include content item ID, idempotency key, approved-content hash, title, body, destination, slug, canonical path, SEO title/description/keywords, media, author, publish date, tags/categories, and the recorded approval identity and time.

State contract:

- draft: content item remains unpublished and has no publish job;
- scheduled: an approved frozen job is queued for a future time;
- published: the consumer returns a canonical final URL, which OCC records with provider evidence;
- failed: validation/provider evidence is retained with bounded retry metadata.

Approval and idempotency are enforced before the consumer is called. The consumer must return the canonical publication URL. A verified unpublish/rollback endpoint and procedure are not currently represented in OCC, so website publishing remains blocked for this readiness batch.

## LinkedIn boundary

LinkedIn remains a manual Lupe handoff. The claim endpoint requires a passed QA gate and an authoritative Tito approval before returning publish input. OCC has no direct LinkedIn publishing adapter. LinkedIn metrics retrieval is not implemented and remains a separate engineering lane.
