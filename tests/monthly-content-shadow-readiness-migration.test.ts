import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeAudit } from "../utils/content-automation/auditors";
import { MONTHLY_SHADOW_MAX_ITERATIONS, validateMonthlyShadowInput } from "../utils/content-automation/shadow";

const migration = readFileSync("supabase/migrations/20260808010545_monthly_content_shadow_readiness.sql", "utf8");
const runner = readFileSync("utils/content-automation/shadow.ts", "utf8");
const route = readFileSync("app/api/v1/monthly-content-operations/shadow-run/route.ts", "utf8");
const reviewRoute = readFileSync("app/api/v1/content-items/[id]/lupe-review/route.ts", "utf8");

const audit = (seo: number, aeo: number) => normalizeAudit("anthropic", {
  seo_score: seo,
  aeo_score: aeo,
  seo_explanation: "SEO evidence",
  aeo_explanation: "AEO evidence",
  summary: "Independent QA",
  blockers: [],
  rewrite_guidance: "Revise precisely.",
  model: "anthropic/claude-sonnet-4.6",
  rubric_version: "monthly-shadow-qa-v1",
  trace_id: "trace-1",
  evaluated_at: "2026-08-07T20:03:33.000Z",
});

test("QA floors fractional scores and requires each threshold independently", () => {
  assert.deepEqual({ seo: audit(79.9, 90).seo_score, passed: audit(79.9, 90).passed }, { seo: 79, passed: false });
  assert.equal(audit(80, 80).passed, true);
  assert.throws(() => normalizeAudit("anthropic", { ...audit(80, 80), seo_explanation: "" }), /separate SEO\/AEO explanations/);
});

test("manual shadow input is complete and bounded", () => {
  const parsed = validateMonthlyShadowInput({
    request_id: "REQ-20260807-200333-monthly-content-operations-readiness-audit",
    idempotency_key: "monday-shadow-2026-08-10",
    k2_research_record_id: "research-id",
    editorial_brief: "Create one unpublished pair.",
    month_start: "2026-08-01",
    max_iterations: 99,
    topic: { topic_key: "topic", title: "Title", rationale: "Why", timely: false, target_audience: "Founders", conversion_goal: "Trust", cta: "Read", source_links: [] },
  });
  assert.equal(parsed.ok, true);
  assert.equal(MONTHLY_SHADOW_MAX_ITERATIONS, 3);
  assert.equal(validateMonthlyShadowInput({}).ok, false);
});

test("migration adds traceability and idempotency without creating automation", () => {
  for (const fragment of ["request_id text", "idempotency_key text", "run_kind text", "provider text", "model text", "prompt_version text", "trace_id text", "seo_explanation text", "aeo_explanation text", "rubric_version text", "evaluated_at timestamptz", "content_generation_runs_idempotency_uidx", "agent_work_items_idempotency_uidx", "content_review_events_idempotency_uidx"]) {
    assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(migration, /content_automation_schedules|cron\.schedule|content_delivery_jobs|content_publish_jobs|insert\s+into\s+public\.approvals/i);
});

test("shadow runner is manual, idempotent, unpublished, and has no outbound side effects", () => {
  assert.match(runner, /monthly-shadow:\$\{input\.idempotencyKey\}/);
  assert.match(runner, /max_attempts:\s*1/);
  assert.match(runner, /trigger_source:\s*"manual"/);
  assert.match(runner, /approval_state:\s*"not_requested"/);
  assert.match(runner, /publication_state:\s*"unpublished"/);
  assert.match(runner, /publish_at:\s*null/);
  assert.match(runner, /new AnthropicAuditor/);
  assert.doesNotMatch(runner, /content_delivery_jobs|content_publish_jobs|\.from\("approvals"\)|deliverWithLease|publishWebsiteContent/);
});

test("shadow route is fail closed and Lupe review cannot create approvals", () => {
  assert.match(route, /OCC_MONTHLY_CONTENT_SHADOW_ENABLED !== "true"/);
  assert.match(route, /trigger_source|runMonthlyContentShadow/);
  assert.match(reviewRoute, /lupe_machine_auth_required/);
  assert.match(reviewRoute, /authoritative_decision_missing/);
  assert.match(reviewRoute, /content_review_events/);
  assert.doesNotMatch(reviewRoute, /\.from\("approvals"\)\.insert|\.from\("approvals"\)\.update/);
});
