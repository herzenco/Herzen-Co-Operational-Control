import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260814120102_lupe_send_to_tito.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/v1/content-items/[id]/send-to-tito/route.ts", import.meta.url), "utf8");
const approvalRoute = readFileSync(new URL("../app/api/v1/[resource]/[id]/route.ts", import.meta.url), "utf8");

test("Send to Tito is a Lupe-machine-only content-write action", () => {
  assert.match(route, /requireMember\(request, \{ write: true, allowAgentWrite: true \}\)/);
  assert.match(route, /!context\.agentId \|\| context\.user/);
  assert.match(route, /agent_code \|\| ""\)\.toLowerCase\(\) !== "lupe"/);
  assert.match(route, /allowedFields = new Set\(\["idempotency_key"\]\)/);
  assert.doesNotMatch(route, /allowedFields[^\n]+target_status|allowedFields[^\n]+approval_state|allowedFields[^\n]+publish_at|allowedFields[^\n]+publication_state/);
});

test("transaction locks the key and item before validating the complete handoff context", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where id = target_content_item_id for update/);
  assert.match(migration, /item\.status <> 'ready_for_lupe'/);
  assert.match(migration, /owner_agent_id is null/);
  assert.match(migration, /owner_agent_id and status = 'active'/);
  assert.match(migration, /publish_at is null or not pg_catalog\.isfinite/);
  assert.match(migration, /current_anthropic_audit_required/);
  assert.match(migration, /provider = 'anthropic'/);
  assert.match(migration, /not audit\.passed/);
  assert.match(migration, /review_package_revision_mismatch/);
  assert.match(migration, /review_package_asset_revision_mismatch/);
  assert.match(migration, /active_lupe_review_work_item_required/);
  assert.match(migration, /agent_id = requesting_agent_id/);
});

test("one transaction creates approval provenance, transition, and finalizes Lupe work", () => {
  assert.match(migration, /insert into public\.approvals/);
  for (const field of ["content_item_id", "revision_id", "source_asset_id", "delivery_asset_id", "review_package", "origin_work_item_id"]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /approval_id = created_approval\.id/);
  assert.match(migration, /approval_state = 'pending'/);
  assert.match(migration, /insert into public\.monthly_content_transition_events/);
  assert.match(migration, /'ready_for_lupe', 'ready_for_tito'/);
  assert.match(migration, /update public\.agent_work_items set[\s\S]+status = 'final'/);
  assert.doesNotMatch(migration, /insert into public\.content_publish_jobs|insert into public\.content_delivery_jobs/);
});

test("idempotency reuses the successful approval and conflicts on changed context", () => {
  assert.match(migration, /evidence_item ->> 'idempotency_key' = btrim\(request_key\)/);
  assert.match(migration, /'duplicate', true/);
  assert.match(migration, /idempotency_key_conflict/);
  assert.match(migration, /pending_tito_approval_conflict/);
});

test("handoff does not mutate stable planning, revision, package, or publication fields", () => {
  const itemUpdate = migration.slice(migration.indexOf("update public.content_items set"), migration.indexOf("insert into public.monthly_content_transition_events"));
  assert.doesNotMatch(itemUpdate, /\n\s+owner_agent_id\s*=/);
  assert.doesNotMatch(itemUpdate, /\n\s+publish_at\s*=/);
  assert.doesNotMatch(itemUpdate, /\n\s+package_manifest\s*=/);
  assert.doesNotMatch(itemUpdate, /\n\s+source_asset_id\s*=/);
  assert.doesNotMatch(itemUpdate, /\n\s+delivery_asset_id\s*=/);
  assert.doesNotMatch(itemUpdate, /\n\s+publication_state\s*=/);
});

test("machine approval decisions remain forbidden", () => {
  assert.match(approvalRoute, /if \(!context\.user\) return fail\(403, "human_approval_required"/);
  assert.doesNotMatch(route, /status:\s*"approved"|status:\s*"changes_requested"|decided_by|decided_at/);
});

test("restricted grants expose the transaction only to the service role", () => {
  assert.match(migration, /revoke all on function public\.send_monthly_content_to_tito\(uuid, uuid, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.send_monthly_content_to_tito\(uuid, uuid, text\) to service_role/);
});
