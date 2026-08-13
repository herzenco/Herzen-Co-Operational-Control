import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260813225403_lupe_request_revision.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/v1/content-items/[id]/request-revision/route.ts", import.meta.url), "utf8");
const executor = readFileSync(new URL("../utils/monthly-content/executor.ts", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../utils/monthly-content/lifecycle.ts", import.meta.url), "utf8");
const approvalRoute = readFileSync(new URL("../app/api/v1/[resource]/[id]/route.ts", import.meta.url), "utf8");

test("request-revision endpoint is Lupe-machine-only and accepts no lifecycle target", () => {
  assert.match(route, /requireMember\(request, \{ write: true, allowAgentWrite: true \}\)/);
  assert.match(route, /!context\.agentId \|\| context\.user/);
  assert.match(route, /agent_code \|\| ""\)\.toLowerCase\(\) !== "lupe"/);
  assert.match(route, /allowedFields = new Set\(\["feedback", "idempotency_key"\]\)/);
  assert.match(route, /review_feedback_required/);
  assert.match(route, /idempotency_key_required/);
  assert.doesNotMatch(route, /target_status|approval_state|publish_at|publication_state/);
});

test("transactional action validates state and Lupe's active review assignment", () => {
  assert.match(migration, /create or replace function public\.request_monthly_content_revision/);
  assert.match(migration, /lower\(code\) = 'lupe' and status = 'active'/);
  assert.match(migration, /item\.status <> 'ready_for_lupe'/);
  assert.match(migration, /lane = 'monthly_content_lupe'[\s\S]+agent_id = requesting_agent_id[\s\S]+status in \('draft', 'in_progress', 'blocked', 'ready'\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /content_item_id = target_content_item_id[\s\S]+request_revision_key = request_key/);
  assert.match(migration, /'duplicate', true/);
  assert.match(migration, /idempotency_key_conflict/);
});

test("one action atomically persists feedback, transition, and work completion", () => {
  assert.match(migration, /insert into public\.content_feedback/);
  assert.match(migration, /true, 'received'/);
  assert.match(migration, /provided_by_agent_id, origin_work_item_id, request_revision_key/);
  assert.match(migration, /status = 'revision_required'/);
  assert.match(migration, /insert into public\.monthly_content_transition_events/);
  assert.match(migration, /'ready_for_lupe', 'revision_required'/);
  assert.match(migration, /update public\.agent_work_items set[\s\S]+status = 'final'/);
  assert.doesNotMatch(migration, /public\.approvals|content_publish_jobs|content_delivery_jobs|approval_state/);
});

test("work-item uniqueness preserves history and limits active Lupe reviews", () => {
  assert.match(migration, /drop index if exists public\.agent_work_items_monthly_lupe_uidx/);
  assert.match(migration, /create unique index agent_work_items_monthly_lupe_active_uidx/);
  assert.match(migration, /lane = 'monthly_content_lupe'[\s\S]+status in \('draft', 'in_progress', 'blocked', 'ready'\)/);
  assert.match(executor, /\.eq\("lane", "monthly_content_lupe"\)\.in\("status", \["draft", "in_progress", "blocked", "ready"\]\)/);
  assert.match(executor, /existing[\s\S]+update\(payload\)[\s\S]+insert\(payload\)/);
});

test("rewrite consumes received Lupe feedback only after revision persistence", () => {
  const feedbackRead = executor.indexOf('const { data: lupeFeedback');
  const generation = executor.indexOf('const asset = await generateIndependentAsset', feedbackRead);
  const revisionWrite = executor.indexOf('const { error: revisionError }', generation);
  const appliedWrite = executor.indexOf('status: "applied"', revisionWrite);
  assert.ok(feedbackRead > -1 && generation > feedbackRead && revisionWrite > generation && appliedWrite > revisionWrite);
  assert.match(executor.slice(feedbackRead, generation), /eq\("status", "received"\)/);
  assert.match(executor.slice(feedbackRead, generation), /Lupe editorial review feedback/);
  assert.match(executor.slice(revisionWrite, appliedWrite), /if \(revisionError\) throw revisionError/);
  assert.match(executor.slice(appliedWrite), /application_evidence: \{ applying_agent: "OpenAI", revision, revision_job_id: job\.id \}/);
  assert.match(executor, /applied_feedback_ids/);
});

test("QA creates a Lupe work item only on pass and never invokes publishing", () => {
  const qaBranch = executor.slice(executor.indexOf('} else if (stage === "qa_in_progress")'));
  const failureBranch = qaBranch.slice(0, qaBranch.indexOf('} else {'));
  const successBranch = qaBranch.slice(qaBranch.indexOf('} else {'));
  assert.doesNotMatch(failureBranch, /ensureLupeWorkItem/);
  assert.match(successBranch, /ensureLupeWorkItem/);
  assert.doesNotMatch(executor, /content_publish_jobs|content_delivery_jobs/);
});

test("human approval decisions remain machine-forbidden", () => {
  assert.match(approvalRoute, /if \(!context\.user\) return fail\(403, "human_approval_required"/);
  assert.doesNotMatch(route, /approvals/);
  assert.match(lifecycle, /from === "ready_for_lupe" && to === "revision_required"/);
});
