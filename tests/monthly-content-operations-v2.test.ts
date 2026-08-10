import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertTransition, isStale, stageIdempotencyKey } from "../utils/monthly-content/lifecycle";

const migration = readFileSync(new URL("../supabase/migrations/20260810164541_monthly_content_operations_v2.sql", import.meta.url), "utf8");
const executor = readFileSync(new URL("../utils/monthly-content/executor.ts", import.meta.url), "utf8");
const approval = readFileSync(new URL("../utils/content-automation/approve-publication.ts", import.meta.url), "utf8");

test("authoritative lifecycle permits only declared forward and exception transitions", () => {
  assert.doesNotThrow(() => assertTransition("planned", "research_pending"));
  assert.doesNotThrow(() => assertTransition("ready_for_tito", "approved"));
  assert.doesNotThrow(() => assertTransition("qa_in_progress", "revision_required"));
  assert.doesNotThrow(() => assertTransition("drafting", "recovery_required"));
  assert.throws(() => assertTransition("planned", "ready_for_lupe"));
});

test("stage jobs use stable revision-scoped idempotency keys", () => {
  assert.equal(stageIdempotencyKey("item-1", "drafting", 2), "monthly-content:v2:item-1:drafting:r2");
  assert.equal(stageIdempotencyKey("item-1", "drafting", 2), stageIdempotencyKey("item-1", "drafting", 2));
});

test("watchdog staleness is deterministic", () => {
  const now = new Date("2026-08-10T16:00:00Z");
  assert.equal(isStale("2026-08-10T15:45:01Z", now, 15), false);
  assert.equal(isStale("2026-08-10T15:44:59Z", now, 15), true);
});

test("migration adds durable jobs, events, revisions, RLS, and disabled schedules", () => {
  assert.match(migration, /create table public\.monthly_content_stage_jobs/);
  assert.match(migration, /create table public\.monthly_content_transition_events/);
  assert.match(migration, /create table public\.monthly_content_revisions/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /monthly_content_watchdog[\s\S]+false/);
  assert.match(migration, /publishing_enabled":false/);
});

test("executor separates platform generation and uses independent Anthropic QA", () => {
  assert.match(executor, /generateIndependentAsset/);
  assert.match(executor, /new AnthropicAuditor/);
  assert.match(executor, /seo_score: result\.seo_score/);
  assert.match(executor, /aeo_score: result\.aeo_score/);
  assert.match(executor, /monthly_content_revisions/);
  assert.match(executor, /monthly_content_lupe/);
  assert.match(executor, /while \(steps\+\+ < 1\)/);
});

test("monthly approval cannot create a publishing job", () => {
  const branch = approval.slice(approval.indexOf("Monthly Content Operations"), approval.indexOf("const [channelResult"));
  assert.match(branch, /status: "approved"/);
  assert.match(branch, /publication_state: "unpublished"/);
  assert.doesNotMatch(branch, /content_publish_jobs|approve_content_publication/);
});
