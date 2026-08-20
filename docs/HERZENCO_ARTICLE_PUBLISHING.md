# Herzenco article publishing integration

This contract applies only to Herzen Co. blogs (`herzen-co` inside OCC, exposed as `herzenco` to the website). OCC remains authoritative. The website webhook receives identifiers only and must pull the complete published set before rebuilding `/resources/{slug}/` pages.

## Published content API

`GET https://operations.herzenco.co/api/v1/content?property=herzenco&status=published`

Authenticate with `Authorization: Bearer $HERZENCO_CONTENT_API_TOKEN`. The token is a dedicated server-to-server secret and must never be exposed to browser JavaScript. The endpoint is unpaginated so every successful response is the complete current set. It returns `Cache-Control: no-store`.

Success (`200`):

```json
{"data":[{"id":"uuid","property":"herzenco","status":"published","slug":"example-article","title":"Example article","excerpt":"A concise summary.","body":"Markdown body.","published_at":"2026-08-14T14:00:00.000Z","updated_at":"2026-08-14T14:00:00.000Z","seo":{"title":"Example article | Herzen Co.","description":"Search description."},"hero_image":{"url":"https://...","alt":"Alternative text"},"canonical_url":"https://herzenco.co/resources/example-article/","author":"Herzen Co.","category":"Operations"}]}
```

The first nine fields are always present and non-empty. Optional objects/fields are omitted when unavailable. Only effective published website blogs are returned; editorial fields and credentials are never selected. Errors consistently use `{"error":{"code":"...","message":"..."}}`.

## Webhook

OCC sends `POST $HERZENCO_PUBLISH_WEBHOOK_URL` (production value `https://herzenco.co/api/publish`) with `Authorization: Bearer $HERZENCO_PUBLISH_WEBHOOK_SECRET` and JSON:

```json
{"event_id":"uuid","event":"content.published","property":"herzenco","content_id":"uuid","slug":"example-article","occurred_at":"2026-08-14T14:00:00.000Z"}
```

Events are `content.published`, `content.updated`, `content.unpublished`, and `content.archived`. Updates are queued only when a public field changes. The unique `event_id` is the website's idempotency key and remains in OCC's `website_publication_events` audit table.

Deleting an effectively published article also records `content.unpublished`. The event intentionally retains the deleted content ID without a foreign key so the website receives a durable rebuild signal and removes the stale generated page.

The existing authenticated OCC scheduler route dispatches this outbox; `/api/cron/herzenco-publishing` is also available for a dedicated scheduler if operations chooses one. No new Vercel cron is enabled by this change. The worker uses a 10-second timeout and makes up to five total attempts. Network failures, `429`, and `5xx` are retried with bounded exponential delays of 30 seconds, 1, 2, and 4 minutes. Other `4xx` responses are permanent. Audit rows retain attempt number, timestamps, response status, and sanitized error category/name; request bodies, authorization headers, secrets, and provider response bodies are not stored.

Editorial state commits independently of delivery. An owner/operator can safely queue a complete notification refresh with authenticated `POST /api/v1/content/sync`; the website still pulls the authoritative set. This is also the manual recovery action after correcting configuration or website availability.

## Configuration and deployment

- `HERZENCO_PUBLISH_WEBHOOK_URL=https://herzenco.co/api/publish`
- `HERZENCO_PUBLISH_WEBHOOK_SECRET` — shared server-only website secret
- `HERZENCO_CONTENT_API_TOKEN` — dedicated server-only pull API token
- Existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or service-role fallback), and `CRON_SECRET`

This pull-based webhook is not the legacy synchronous website publishing provider. Do not point `HERZEN_WEBSITE_PUBLISH_URL` at `/api/publish`; that older worker expects an immediate canonical-URL response, while the new endpoint correctly returns `202` and starts a deployment. Keep the legacy provider variables unset for this article flow unless a separate compatible provider is still intentionally in use.

Apply migration `20260814140000_herzenco_article_pull_publishing.sql` in a controlled non-production environment first, configure environment-specific secrets, deploy OCC, and verify the existing scheduler route (or explicitly configure a dedicated scheduler for `/api/cron/herzenco-publishing`). This task does not apply the migration, change production scheduling, or deploy.

For testing without production publication: apply the migration to a development Supabase project, point the webhook URL at an HTTPS test receiver, create a `herzen-co` website blog in published state, verify the identifier payload, then use the content token to pull it. Unpublish/delete the fixture afterward. The website team can also replay a captured identifier payload against a preview deployment and point that preview at the development OCC API.
