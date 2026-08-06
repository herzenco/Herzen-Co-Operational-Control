import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260806113000_content_delivery_job_leases.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../utils/content-automation/delivery.ts", import.meta.url), "utf8");
const cronRoute = readFileSync(new URL("../app/api/cron/content-automation/route.ts", import.meta.url), "utf8");

test("legacy sending jobs are quarantined instead of replayed", () => {
  assert.match(migration, /set status = 'recovery_required'/);
  assert.match(migration, /where status = 'sending' and lease_token is null/);
  assert.doesNotMatch(migration, /where status = 'sending'[\s\S]{0,200}set status = 'queued'/);
});

test("delivery claims and completions are lease-token guarded and audited", () => {
  assert.match(migration, /function public\.claim_content_delivery_job/);
  assert.match(migration, /function public\.complete_content_delivery_job/);
  assert.match(migration, /create table if not exists public\.content_delivery_attempts/);
  assert.match(migration, /status = 'sending' and lease_token = p_lease_token/);
  assert.match(migration, /provider_message_id_required_for_confirmation/);
  assert.match(runner, /claim_content_delivery_job/);
  assert.match(runner, /complete_content_delivery_job/);
});

test("delivery requires explicit provider confirmation", () => {
  assert.match(delivery, /provider\.delivered !== true/);
  assert.match(delivery, /provider\.id/);
  assert.doesNotMatch(delivery, /if \(!endpoint\) return/);
});

test("scheduler is paused by default and runs are idempotent", () => {
  assert.match(cronRoute, /CONTENT_AUTOMATION_ENABLED !== "true"/);
  assert.match(migration, /workflow_runs_run_key_uidx/);
  assert.match(runner, /skipped_duplicate/);
  assert.match(runner, /eq\("next_run_at", scheduledFor\)/);
});
