import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalAssetLocation, deliverableBlockers } from "../utils/social-operations";

const migration = readFileSync("supabase/migrations/20260802000000_agent_social_operations.sql", "utf8");
const resources = readFileSync("utils/api/resources.ts", "utf8");
const deliverableRoute = readFileSync("app/api/v1/content-items/[id]/deliverable/route.ts", "utf8");
const commandCenter = readFileSync("app/command-center.tsx", "utf8");

test("migration adds normalized agent artifacts, dependencies, assets, and feedback", () => {
  for (const table of ["content_assets", "agent_work_items", "agent_work_dependencies", "content_feedback"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /work_item_type in \('research'[\s\S]*'paid_media_proposal'[\s\S]*'delivery'/);
  assert.match(migration, /status in \('received', 'applied', 'blocked', 'superseded'\)/);
  assert.match(migration, /create or replace view public\.social_operations_queue/);
  assert.match(migration, /\('K2'[\s\S]*\('C-3PO'[\s\S]*\('Rex'[\s\S]*\('Lupe'/);
});

test("database functions hard-gate dependencies, feedback, exact assets, and approval", () => {
  assert.match(migration, /Required upstream agent work must be final/);
  assert.match(migration, /C-3PO packages require linked final K2 research/);
  assert.match(migration, /paid-media proposal requires final research and creative package dependencies/);
  assert.match(migration, /Required feedback must be applied or superseded/);
  assert.match(migration, /source_asset\.content_item_id is distinct from new\.id/);
  assert.match(migration, /delivery_asset\.content_item_id is distinct from new\.id/);
  assert.match(migration, /new\.approval_state <> 'approved'/);
  assert.match(migration, /disagree with the canonical OCC package manifest/);
  assert.match(migration, /new\.delivered_at is not null[\s\S]*new\.delivery_asset_id is null/);
});

test("deliverable readiness reports every unresolved canonical requirement", () => {
  assert.deepEqual(deliverableBlockers({}, [{ required: true, status: "received" }]), [
    "final_caption_missing",
    "source_asset_missing",
    "delivery_asset_missing",
    "posting_instructions_missing",
    "approval_missing",
    "k2_research_final_missing",
    "approval_request_missing",
    "qa_checklist_incomplete",
    "required_feedback_unresolved",
  ]);
  assert.deepEqual(deliverableBlockers({
    caption: "Final copy", source_asset_id: "source", delivery_asset_id: "delivery",
    posting_instructions: "Publish at 9", approval_state: "approved", research_record_id: "research", approval_id: "approval",
    qa_checklist: { image_matches_assigned_day: true, bordered_monthly_source_export: true, caption_matches_image: true, k2_feed_fit_note_present: true, hashtags_within_limit: true, suggested_posting_time_present: true, whatsapp_packet_matches_occ: true },
  }, [{ required: true, status: "applied" }]), []);
});

test("deliverable generator returns only canonical OCC assets", () => {
  assert.equal(canonicalAssetLocation({ storage_bucket: "content-creative-assets", storage_path: "posts/final.png" }), "storage://content-creative-assets/posts/final.png");
  assert.match(deliverableRoute, /package_blocked/);
  assert.match(deliverableRoute, /source_of_truth: "OCC"/);
  assert.match(deliverableRoute, /delivery_assets:/);
});

test("resource API and Agent Ops UI expose operational records and views", () => {
  for (const resource of ["content-assets", "agent-work-items", "agent-work-dependencies", "content-feedback", "social-operations-queue"]) {
    assert.match(resources, new RegExp(`"${resource}"`));
  }
  assert.match(commandCenter, /Agent Ops/);
  assert.match(commandCenter, /Dependency blocked/);
  assert.match(commandCenter, /Feedback unresolved/);
  assert.match(commandCenter, /Ready to deliver/);
  assert.match(commandCenter, /Download final package/);
});
