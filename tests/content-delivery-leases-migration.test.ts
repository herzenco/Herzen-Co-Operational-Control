import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260806113000_content_delivery_job_leases.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../utils/content-automation/delivery.ts", import.meta.url), "utf8");
const whatsappRoute = readFileSync(new URL("../app/api/integrations/delivery/whatsapp/route.ts", import.meta.url), "utf8");
const cronRoute = readFileSync(new URL("../app/api/cron/content-automation/route.ts", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260806113000_content_delivery_job_leases.rollback.sql", import.meta.url), "utf8");

test("legacy sending jobs are quarantined instead of replayed", () => {
  assert.match(migration, /set status = 'recovery_required'/);
  assert.match(migration, /where status = 'sending' and lease_token is null/);
  assert.match(migration, /where status = 'sent'/);
  assert.match(migration, /nullif\(trim\(provider_message_id\)/);
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
  assert.match(runner, /eq\("idempotency_key", input\.key\)/);
});

test("direct delivery remains fail-closed after provider-confirmation retirement", () => {
  assert.match(delivery, /disabledAutomationResult\("whatsapp_delivery"/);
  assert.doesNotMatch(delivery, /await fetch/);
  assert.match(whatsappRoute, /status: 410/);
});

test("replacement scheduler is executable while historical run keys remain idempotent", () => {
  assert.match(cronRoute, /runDueSchedules/);
  assert.match(migration, /workflow_runs_run_key_uidx/);
  assert.match(runner, /skipped_duplicate/);
});

test("workflow retries replace the incompatible Phase 1 uniqueness rule", () => {
  assert.match(migration, /drop constraint if exists workflow_runs_schedule_id_scheduled_for_key/);
  assert.match(migration, /workflow_runs_run_key_uidx/);
});

test("an executable rollback removes delivery leases without deleting retry history", () => {
  assert.match(rollback, /drop function if exists public\.claim_content_delivery_job/);
  assert.match(rollback, /drop table if exists public\.content_delivery_attempts/);
  assert.match(rollback, /drop column if exists lease_token/);
  assert.doesNotMatch(rollback, /drop column if exists run_key/);
  assert.doesNotMatch(rollback, /add constraint workflow_runs_schedule_id_scheduled_for_key/);
});

test("historical generation canary remains isolated while direct WhatsApp canaries are retired", () => {
  assert.match(runner, /generation_only_canary/);
  assert.match(runner, /generationOnlyCanary \? \{ passed: false, generation_only: true \}/);
  assert.match(runner, /deliverWhatsAppCanary/);
  assert.match(delivery, /disabledAutomationResult\("whatsapp_delivery"/);
  assert.doesNotMatch(whatsappRoute, /OCC TEST — DO NOT POST/);
});
