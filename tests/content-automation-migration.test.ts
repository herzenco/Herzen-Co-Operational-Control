import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enforcePair } from "../utils/content-automation/generation";
import { isLastMonday, nextMonthStart, shouldRun } from "../utils/content-automation/schedule";

const migration = readFileSync(new URL("../supabase/migrations/20260803103000_content_automation_phase1.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const reviewRoute = readFileSync(new URL("../app/api/review/content/route.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../utils/supabase/middleware.ts", import.meta.url), "utf8");
const models = readFileSync(new URL("../utils/content-automation/models.ts", import.meta.url), "utf8");
const publishing = readFileSync(new URL("../utils/content-automation/publishing.ts", import.meta.url), "utf8");
const linkedinAdapter = readFileSync(new URL("../app/api/integrations/publishing/linkedin/route.ts", import.meta.url), "utf8");
const whatsappAdapter = readFileSync(new URL("../app/api/integrations/delivery/whatsapp/route.ts", import.meta.url), "utf8");

test("Phase 1 persists execution, pairs, audits, reviews, delivery, and publishing", () => {
  for (const table of ["content_generation_runs","content_pairs","content_audits","content_review_links","content_review_events","automation_schedules","workflow_runs","workflow_run_logs","content_delivery_jobs","content_publish_jobs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("SEO and AEO scores independently hard-gate review status", () => {
  assert.match(migration, /seo_score, 0\) < 80/);
  assert.match(migration, /aeo_score, 0\) < 80/);
  assert.match(migration, /Content requires SEO and AEO scores of at least 80 before review/);
});

test("last-Monday generation and ET delivery schedules are deterministic", () => {
  const lastMondayAtNineEt = new Date("2026-08-31T13:00:00.000Z");
  assert.equal(isLastMonday(lastMondayAtNineEt), true);
  assert.equal(shouldRun("monthly_generation", lastMondayAtNineEt), true);
  assert.equal(nextMonthStart(lastMondayAtNineEt), "2026-09-01");
  assert.equal(shouldRun("publish_day_notice", new Date("2026-08-03T12:00:00.000Z")), true);
});

test("generation enforces blog length and a website link in LinkedIn", () => {
  const body = Array.from({ length: 400 }, () => "word").join(" ");
  assert.doesNotThrow(() => enforcePair({ blog: { title: "Blog", body, slug: "blog", seo_title: "Blog", meta_description: "Meta", reasoning_summary: "Reason" }, linkedin: { title: "LinkedIn", body: "Read https://herzen.co/blog", slug: "linkedin", seo_title: "LinkedIn", meta_description: "Meta", reasoning_summary: "Reason" } }));
  assert.throws(() => enforcePair({ blog: { title: "Blog", body: "too short", slug: "blog", seo_title: "Blog", meta_description: "Meta", reasoning_summary: "Reason" }, linkedin: { title: "LinkedIn", body: "No link", slug: "linkedin", seo_title: "LinkedIn", meta_description: "Meta", reasoning_summary: "Reason" } }), /400-1500/);
});

test("runner rewrites failures and triggers a Lupe check-in every five attempts", () => {
  assert.match(runner, /iteration % 5 === 0/);
  assert.match(runner, /generatePair\(writer, topic, context, result\.rewrite_guidance\)/);
  assert.match(runner, /type: "lupe_check_in"/);
  assert.match(runner, /deliverWithLease/);
});

test("an explicitly approved pilot can promote one evergreen fallback", () => {
  assert.match(runner, /allow_evergreen_fallback === true/);
  assert.match(runner, /completeEvergreenTopic/);
  assert.match(runner, /promoteEvergreenFallback/);
});

test("review decisions remain asset-specific without auto-triggering LinkedIn publishing", () => {
  assert.match(reviewRoute, /eq\("id", link\.content_item_id\)/);
  assert.doesNotMatch(reviewRoute, /content_publish_jobs/);
  assert.doesNotMatch(reviewRoute, /paired_content_item_id/);
});

test("weekly and day-of deliveries are titles and links only", () => {
  assert.match(runner, /titlesAndLinksOnly/);
  assert.match(runner, /final_checkpoint/);
  assert.match(runner, /heads_up/);
});

test("cron-secret and tokenized review routes bypass browser-session redirects", () => {
  assert.match(middleware, /\/api\/cron\/content-automation/);
  assert.match(middleware, /\/api\/review\/content/);
  assert.match(middleware, /\/review\/content\//);
  assert.match(middleware, /\/api\/integrations\//);
  assert.match(middleware, /isOperationsApi \|\| isPublicAutomationRoute/);
});

test("OCC publishes websites only and leaves LinkedIn publication to Lupe", () => {
  assert.match(publishing, /WEBSITE_PUBLISHING_WEBHOOK_SECRET/);
  assert.match(publishing, /approvedPayload/);
  assert.match(publishing, /Idempotency-Key/);
  assert.doesNotMatch(publishing, /LUPE_LINKEDIN_PUBLISH_URL/);
  assert.match(linkedinAdapter, /linkedin_publishing_is_lupe_managed/);
  assert.doesNotMatch(linkedinAdapter, /api\.linkedin\.com/);
});

test("direct OCC-to-WhatsApp delivery is retired", () => {
  assert.match(whatsappAdapter, /disabledAutomationResult\("whatsapp_delivery"\)/);
  assert.doesNotMatch(whatsappAdapter, /graph\.facebook\.com/);
  assert.doesNotMatch(whatsappAdapter, /WHATSAPP_ACCESS_TOKEN/);
});

test("writer and independent auditor can use Vercel deployment identity", () => {
  assert.match(models, /process\.env\.VERCEL_OIDC_TOKEN/);
  assert.match(models, /getVercelOidcToken/);
  assert.match(models, /openai\/gpt-5\.6-terra/);
  assert.match(models, /anthropic\/claude-sonnet-4\.6/);
  assert.match(models, /ai-gateway\.vercel\.sh\/v1\/chat\/completions/);
});
