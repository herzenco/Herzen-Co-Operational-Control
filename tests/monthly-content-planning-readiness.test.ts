import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MonthlyContentPlanningReadinessError,
  missingPlanningFields,
  requireMonthlyContentPlanningReady,
} from "../utils/monthly-content/planning-readiness";

const executor = readFileSync(new URL("../utils/monthly-content/executor.ts", import.meta.url), "utf8");
const createRoute = readFileSync(new URL("../app/api/v1/[resource]/route.ts", import.meta.url), "utf8");
const updateRoute = readFileSync(new URL("../app/api/v1/[resource]/[id]/route.ts", import.meta.url), "utf8");

const owner = { id: "c3po", status: "active" };
const planned = { owner_agent_id: "c3po", publish_at: "2026-09-01T14:00:00.000Z" };

test("planning readiness requires an active stable owner and an explicit publish time", () => {
  assert.deepEqual(missingPlanningFields(planned, owner), []);
  assert.deepEqual(missingPlanningFields({ ...planned, owner_agent_id: null }, null), ["owner_agent_id"]);
  assert.deepEqual(missingPlanningFields({ ...planned, publish_at: null }, owner), ["publish_at"]);
  assert.deepEqual(missingPlanningFields({ owner_agent_id: "c3po", publish_at: null }, { ...owner, status: "paused" }), ["owner_agent_id", "publish_at"]);
});

test("planning readiness fails closed without writing lifecycle artifacts", async () => {
  const tables: string[] = [];
  const supabase = {
    from(table: string) {
      tables.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
      };
    },
  };
  await assert.rejects(
    requireMonthlyContentPlanningReady(supabase as never, { owner_agent_id: "missing", publish_at: null }),
    (failure: unknown) => failure instanceof MonthlyContentPlanningReadinessError
      && failure.code === "monthly_content_planning_incomplete"
      && failure.missingFields.join(",") === "owner_agent_id,publish_at",
  );
  assert.deepEqual(tables, ["agents"]);
});

test("v2 validates planning before stage-job claiming for every executable pre-review stage", () => {
  const guard = executor.indexOf("await requireMonthlyContentPlanningReady(supabase, item)");
  const claim = executor.indexOf("await claimJob(supabase, item, stage, ownerId)");
  assert.ok(guard > -1 && guard < claim);
  assert.match(executor, /PLANNING_REQUIRED_STAGES\.has\(item\.status as MonthlyContentStatus\)/);
  for (const stage of ["planned", "research_pending", "research_ready", "editorial_ready", "drafting", "qa_in_progress", "revision_required"]) {
    assert.match(executor, new RegExp(`"${stage}"`));
  }
  assert.doesNotMatch(executor.slice(guard, claim), /\.update\(|\.insert\(|\.upsert\(/);
});

test("Send to Tito validates v2 planning before approval insertion and status update", () => {
  const approvalGuard = createRoute.indexOf("await requireMonthlyContentPlanningReady(context.supabase, contentItem)");
  const existingApproval = createRoute.indexOf("const { data: existingApproval");
  const approvalInsert = createRoute.indexOf(".insert(payload)");
  assert.ok(approvalGuard > -1 && approvalGuard < existingApproval && existingApproval < approvalInsert);
  assert.match(createRoute, /contentItem\.status === "ready_for_lupe" && Number\(contentItem\.monthly_ops_version \|\| 0\) === 2/);
  assert.match(createRoute, /if \(existingApproval\) return ok\(serializeApiResource\(resourceName, existingApproval\)\)/);

  const handoffGuard = updateRoute.indexOf("await requireMonthlyContentPlanningReady(context.supabase, { ...current, ...payload })");
  const statusUpdate = updateRoute.indexOf(".update(payload)");
  assert.ok(handoffGuard > -1 && handoffGuard < statusUpdate);
  assert.match(updateRoute, /body\.status === "ready_for_tito" && Number\(current\.monthly_ops_version \|\| 0\) === 2/);
});

test("lifecycle code never rewrites stable owner or publication timing", () => {
  const lifecycle = executor.slice(executor.indexOf("export async function executeMonthlyContentItem"));
  assert.doesNotMatch(lifecycle, /owner_agent_id\s*:/);
  assert.doesNotMatch(lifecycle, /publish_at\s*:/);
  assert.match(executor, /stage_owner_agent_id: input\.ownerAgentId \|\| null/);
});
