import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MONTHLY_CONTENT_OPERATIONS_FLAG,
  MONTHLY_CONTENT_OPERATIONS_NAME,
  disabledAutomationResult,
  isLegacyContentAutomationJobType,
  legacyContentAutomationJobTypes,
  monthlyContentOperationsEnabled,
} from "../utils/content-automation/retirement";

const cronRoute = readFileSync(new URL("../app/api/cron/content-automation/route.ts", import.meta.url), "utf8");
const manualRoute = readFileSync(new URL("../app/api/v1/content-automation/run/route.ts", import.meta.url), "utf8");
const whatsappRoute = readFileSync(new URL("../app/api/integrations/delivery/whatsapp/route.ts", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const vercelConfig = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260807104500_retire_legacy_monthly_content_engine.sql", import.meta.url), "utf8");

test("legacy content automation job types remain explicitly enumerated", () => {
  assert.deepEqual(legacyContentAutomationJobTypes, [
    "monthly_generation",
    "weekly_review_pack",
    "publish_day_notice",
    "weekly_k2_refresh",
    "audit_retry",
  ]);
  for (const jobType of legacyContentAutomationJobTypes) assert.equal(isLegacyContentAutomationJobType(jobType), true);
  assert.equal(isLegacyContentAutomationJobType("not_a_job"), false);
});

test("monthly content operations stays disabled by default", () => {
  assert.equal(monthlyContentOperationsEnabled({}), false);
  assert.equal(monthlyContentOperationsEnabled({ [MONTHLY_CONTENT_OPERATIONS_FLAG]: "true" }), true);
});

test("disabled automation result points to the replacement workflow", () => {
  const result = disabledAutomationResult("manual_route", "monthly_generation");
  assert.equal(result.code, "monthly_content_operations_not_activated");
  assert.equal(result.job_type, "monthly_generation");
  assert.equal(result.replacement, MONTHLY_CONTENT_OPERATIONS_NAME);
  assert.equal(result.activation_flag, MONTHLY_CONTENT_OPERATIONS_FLAG);
});

test("legacy jobs fail closed while the replacement cron is executable", () => {
  assert.match(cronRoute, /runDueSchedules/);
  assert.match(manualRoute, /disabledAutomationResult\("manual_route"/);
  assert.match(whatsappRoute, /disabledAutomationResult\("whatsapp_delivery"\)/);
  assert.match(runner, /LegacyContentAutomationDisabledError/);
  assert.match(runner, /const published: Array<Record<string, unknown>> = \[\]/);
});

test("retirement migration disables every legacy schedule without deleting history", () => {
  assert.match(migration, /update public\.automation_schedules/);
  assert.match(migration, /enabled = false/);
  assert.match(migration, /update public\.workflow_runs/);
  assert.match(migration, /status = 'cancelled'/);
  assert.doesNotMatch(migration, /\bdelete\b/i);
  for (const jobType of legacyContentAutomationJobTypes) assert.match(migration, new RegExp(`'${jobType}'`));
});

test("only the canonical website scheduler is advertised and direct OCC WhatsApp remains retired", () => {
  assert.deepEqual(JSON.parse(vercelConfig).crons, [{ path: "/api/cron/content-automation", schedule: "* * * * *" }]);
  assert.match(envExample, /OCC_MONTHLY_CONTENT_OPERATIONS_ENABLED=false/);
  assert.doesNotMatch(envExample, /^WHATSAPP_ACCESS_TOKEN=/m);
  assert.doesNotMatch(envExample, /^WHATSAPP_PHONE_NUMBER_ID=/m);
  assert.doesNotMatch(envExample, /^LUPE_WHATSAPP_TO=/m);
  assert.doesNotMatch(envExample, /^WHATSAPP_API_VERSION=/m);
});
