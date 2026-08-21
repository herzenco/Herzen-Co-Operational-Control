# Herzen Co. website publishing handoff

Date: 2026-08-14

## Objective

Complete the website half of the OCC-owned article publishing pipeline. OCC is the source of truth. A signed OCC webhook asks the website to rebuild; the website then pulls the complete published article set from OCC and generates `/resources/{slug}/` pages.

## Current OCC status

- Vercel project: `herzens-projects/herzen-co-operational-control`
- Supabase project: `Herzen Co Operational Control` (`wduvdzruqjcyqlqrturj`)
- Migration `20260814140000_herzenco_article_pull_publishing.sql` is applied and recorded in production.
- Database verification passed for the outbox table, RLS, read policy, dispatch index, trigger, and revoked API-role function execution.
- Supabase security advisors reported no errors.
- OCC production deployment: `dpl_12cvJRJM6j6sfopQP6udJqgzt8sE`
- Production alias: `https://operations.herzenco.co`
- Production webhook destination: `https://herzenco.co/api/publish`
- Production `HERZENCO_PUBLISH_WEBHOOK_URL` is configured.
- Production `HERZENCO_PUBLISH_WEBHOOK_SECRET` is configured as a sensitive Vercel value.
- Production `HERZENCO_CONTENT_API_TOKEN` is configured as a sensitive Vercel value.
- OCC contract is live: `GET https://operations.herzenco.co/api/v1/content?property=herzenco&status=published`
- An unauthenticated live request returns `401` as required.
- OCC sends identifier-only events: `content.published`, `content.updated`, `content.unpublished`, and `content.archived`.

Do not create replacement secrets. The website must use the exact matching OCC values.

## Website Vercel variables

These Production variables are already configured on the website Vercel project (`herzen-co-unified`):

```dotenv
OCC_CONTENT_API_URL=https://operations.herzenco.co/api/v1/content
OCC_CONTENT_API_TOKEN=<configured; matches OCC HERZENCO_CONTENT_API_TOKEN>
HERZENCO_PUBLISH_WEBHOOK_SECRET=<configured; matches OCC HERZENCO_PUBLISH_WEBHOOK_SECRET>
VERCEL_DEPLOY_HOOK_URL=<configured from existing Content-Engine main-branch hook>
SITE_URL=https://herzenco.co
```

The token and webhook secret were rotated in memory and written directly to both projects, guaranteeing that they match without exposing their values. Vercel sensitive values are intentionally not retrievable with `vercel env pull`; do not rotate or replace either value from only one project.

All tokens and secrets are server-only. Never prefix them with `NEXT_PUBLIC_`, print them, add them to a tracked `.env` file, or include them in a ticket/chat.

## Deployment note

The website is intentionally static and uses Vercel's **Other** framework preset with `npm run build` and output directory `public`. Do not install Next.js or change the framework preset. Sensitive Vercel values are intentionally not retrievable with `vercel env pull`; validate the real token through a remote build, where Vercel injects the production value.

## Deployment order

1. Correct the website deployment's false Next.js framework selection without adding Next.js.
2. Deploy the website implementation containing `/api/publish` and the build-time content sync.
3. Verify the remote build authenticates to OCC and completes successfully.
4. Confirm an unauthenticated content API request returns `401`; the deployed website build proves the matching token receives `200`.
5. POST a signed identifier-only test event to the website webhook; expect `202`.
6. Publish one test article and confirm its `/resources/{slug}/` page is generated.
7. Unpublish the same article and confirm the generated page and sitemap entry are removed.
8. Verify a replay of the same `event_id` is harmless.

## Important compatibility warning

Do not point the legacy OCC `HERZEN_WEBSITE_PUBLISH_URL` at the new website `/api/publish` endpoint. The legacy integration expects a synchronous canonical URL; the new endpoint returns `202` and initiates an asynchronous deployment.

## Acceptance criteria

- Unauthorized OCC content API requests return `401`.
- Authorized requests return only effectively published Herzen Co. website articles.
- Unauthorized website webhook requests return `401`.
- Authorized webhook requests return `202` and trigger a deployment.
- Published, updated, unpublished, archived, and deleted-public-article events converge the website to OCC's complete published set.
- Raw Markdown/HTML tags are not rendered as visible text on published pages.
- No secret appears in logs, generated pages, browser JavaScript, Git diff, or deployment output.
