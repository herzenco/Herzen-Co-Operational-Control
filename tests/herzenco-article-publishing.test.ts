import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bearerToken, isPublishedHerzencoBlog, sanitizedWebhookFailure, sendHerzencoWebhook, serializePublishedArticle, shouldRetryWebhook, tokensMatch, validatePublishedArticle, webhookBackoffMs } from "../utils/content-publishing/herzenco";
import { validateHerzencoPublicationCandidate } from "../utils/content-publishing/lifecycle";

const route = readFileSync("app/api/v1/content/route.ts", "utf8");
const syncRoute = readFileSync("app/api/v1/content/sync/route.ts", "utf8");
const dispatcher = readFileSync("utils/content-publishing/dispatcher.ts", "utf8");
const lifecycle = readFileSync("utils/content-publishing/lifecycle.ts", "utf8");
const cronRoute = readFileSync("app/api/cron/content-automation/route.ts", "utf8");
const publishingCronRoute = readFileSync("app/api/cron/herzenco-publishing/route.ts", "utf8");
const middleware = readFileSync("utils/supabase/middleware.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const migration = readFileSync("supabase/migrations/20260814140000_herzenco_article_pull_publishing.sql", "utf8");

const published = {
  id: "6a0cf862-e750-4a0e-8441-1511954fc461", title: "Example article", brief: "Summary", body: "# Markdown", slug: "example-article",
  status: "published", publication_state: "published", published_at: "2026-08-14T14:00:00-04:00", updated_at: "2026-08-14T18:01:00Z",
  seo_title: "Example article | Herzen Co.", meta_description: "Search description", final_url: "https://herzenco.co/resources/example-article/",
  metadata: { content_role: "blog", internal_notes: "never serialize", prompt: "private", author: "Herzen Co.", category: "Operations" },
  property: { slug: "herzen-co" }, channel: { platform: "website" }, content_type: { slug: "blog" },
  content_assets: [{ asset_role: "hero", is_current: true, external_url: "https://cdn.example/hero.jpg", metadata: { alt: "A team at work", private: "hidden" } }],
};

test("authorized content API uses a constant-time dedicated bearer token and strict scope", () => {
  const request = new Request("https://operations.test/api/v1/content", { headers: { Authorization: "Bearer test-token" } });
  assert.equal(bearerToken(request), "test-token");
  assert.equal(tokensMatch("test-token", "test-token"), true);
  assert.equal(tokensMatch("wrong", "test-token"), false);
  assert.equal(tokensMatch("", "test-token"), false);
  assert.match(route, /HERZENCO_CONTENT_API_TOKEN/);
  assert.match(route, /property.*HERZENCO_PUBLIC_PROPERTY/);
  assert.match(route, /status.*"published"/);
  assert.match(route, /eq\("property\.slug", HERZENCO_OCC_PROPERTY\)/);
  assert.match(route, /eq\("channel\.platform", "website"\)/);
  assert.match(route, /content_assets!content_assets_content_item_id_fkey/);
});

test("published content is filtered to the exact Herzen property, website channel, blog type, and effective state", () => {
  assert.equal(isPublishedHerzencoBlog(published), true);
  assert.equal(isPublishedHerzencoBlog({ ...published, status: "draft" }), false);
  assert.equal(isPublishedHerzencoBlog({ ...published, status: "archived" }), false);
  assert.equal(isPublishedHerzencoBlog({ ...published, property: { slug: "other" } }), false);
  assert.equal(isPublishedHerzencoBlog({ ...published, channel: { platform: "linkedin" } }), false);
});

test("publication readiness blocks incomplete approvals but accepts a fully audited article", () => {
  const candidate = {
    ...published,
    status: "approved",
    approval_state: "approved",
    publication_state: "unpublished",
    review_approved_at: "2026-08-14T18:00:00.000Z",
    publish_at: "2026-09-03T14:00:00.000Z",
    audit_status: "passed",
    seo_score: 82,
    aeo_score: 88,
  };
  assert.deepEqual(validateHerzencoPublicationCandidate(candidate), []);
  const errors = validateHerzencoPublicationCandidate({
    ...candidate,
    slug: null,
    seo_title: null,
    audit_status: "pending",
    seo_score: null,
  });
  assert.match(errors.join(" "), /slug|SEO title|audit must pass|SEO score/i);
});

test("public serializer returns required fields and excludes editorial/private data", () => {
  const article = serializePublishedArticle(published);
  assert.deepEqual(validatePublishedArticle(article), []);
  assert.equal(article.property, "herzenco");
  assert.equal(article.published_at, "2026-08-14T18:00:00.000Z");
  assert.equal((article.hero_image as { alt: string }).alt, "A team at work");
  const json = JSON.stringify(article);
  assert.doesNotMatch(json, /internal_notes|prompt|private|credentials|review/);
});

test("migration creates traceable events for publish, public update, unpublish, and archive only", () => {
  for (const event of ["content.published", "content.updated", "content.unpublished", "content.archived"]) assert.match(migration, new RegExp(event.replace(".", "\\.")));
  assert.match(migration, /event_id uuid not null default gen_random_uuid\(\) unique/);
  assert.match(migration, /old\.body is distinct from new\.body/);
  assert.match(migration, /old\.metadata->'excerpt'/);
  assert.doesNotMatch(migration, /old\.metadata is distinct from new\.metadata/);
  assert.match(syncRoute, /source: "manual_sync"/);
  assert.match(migration, /after insert or update or delete/);
  assert.match(migration, /tg_op = 'DELETE'/);
  assert.match(migration, /values \('content\.unpublished', 'herzenco', old\.id, old\.slug\)/);
  assert.doesNotMatch(migration, /content_id uuid not null references/);
});

test("transient webhook failures retry with bounded exponential backoff; permanent 4xx do not", () => {
  assert.equal(shouldRetryWebhook(null), true);
  assert.equal(shouldRetryWebhook(429), true);
  assert.equal(shouldRetryWebhook(503), true);
  assert.equal(shouldRetryWebhook(400), false);
  assert.deepEqual([1, 2, 3, 20].map(webhookBackoffMs), [30_000, 60_000, 120_000, 3_600_000]);
  assert.match(dispatcher, /attempt < event\.max_attempts/);
  assert.match(dispatcher, /stale_delivery_lease/);
});

test("the production cron schedules, publishes, then dispatches identifier events without login redirects", () => {
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/content-automation", schedule: "* * * * *" }]);
  assert.match(cronRoute, /runHerzencoPublishingCycle/);
  assert.match(publishingCronRoute, /runHerzencoPublishingCycle/);
  assert.match(lifecycle, /reconcileApprovedHerzencoArticles[\s\S]*publishDueHerzencoArticles[\s\S]*dispatchHerzencoEvents/);
  assert.match(lifecycle, /\.eq\("status", "approved"\)[\s\S]*\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(lifecycle, /\.eq\("status", "scheduled"\)[\s\S]*\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(lifecycle, /posting_instructions: text\(item\.posting_instructions\) \|\| websitePostingInstructions/);
  assert.match(lifecycle, /status: "recovery_required"[\s\S]*publication_state: "failed"/);
  assert.match(middleware, /\/api\/cron\/herzenco-publishing/);
});

test("webhook payload is identifier-only and failure details are sanitized", async () => {
  let requestBody = "";
  let authorization = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    authorization = String(new Headers(init?.headers).get("authorization"));
    return new Response("provider body must not be logged", { status: 503 });
  };
  try {
    const payload = { event_id: "event-1", event: "content.updated", property: "herzenco", content_id: "content-1", slug: "article", occurred_at: "2026-08-14T18:00:00.000Z" };
    const result = await sendHerzencoWebhook(payload, { url: "https://herzenco.co/api/publish", secret: "shared-secret" });
    assert.equal(result.retryable, true);
    assert.deepEqual(JSON.parse(requestBody), payload);
    assert.equal(authorization, "Bearer shared-secret");
    const logged = JSON.stringify(sanitizedWebhookFailure(new Error("shared-secret article body"), 503));
    assert.doesNotMatch(logged, /shared-secret|article body|authorization/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhook enforces HTTPS", async () => {
  await assert.rejects(sendHerzencoWebhook({}, { url: "http://example.test/hook", secret: "secret" }), /HTTPS/);
});
