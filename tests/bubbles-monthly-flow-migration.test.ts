import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260802223000_bubbles_monthly_source_truth.sql", "utf8");
const resources = readFileSync("utils/api/resources.ts", "utf8");

test("K2 research template contains every required field", () => {
  for (const field of ["what_is_happening", "why_it_fits_account", "how_and_why_it_fits_feed", "current_trend_or_context", "caption_angle", "suggested_posting_time"]) assert.match(migration, new RegExp(field));
});

test("Bubbles readiness enforces bordered monthly source, approval request, and seven QA checks", () => {
  assert.match(migration, /monthly_content_folders/);
  assert.match(migration, /bordered_export/);
  assert.match(migration, /approval_id is null/);
  for (const check of ["image_matches_assigned_day", "bordered_monthly_source_export", "caption_matches_image", "k2_feed_fit_note_present", "hashtags_within_limit", "suggested_posting_time_present", "whatsapp_packet_matches_occ"]) assert.match(migration, new RegExp(check));
  assert.match(migration, /at most 5 hashtags/);
});

test("posting template, audit trail, queues, RLS and explicit grants are present", () => {
  assert.match(migration, /Instagram only/);
  assert.match(migration, /Actual posting is done by Herzen/);
  assert.match(migration, /create table public\.asset_remap_audit/);
  assert.match(migration, /create table public\.approval_delivery_packets/);
  assert.match(migration, /create or replace function public\.c3po_build_bubbles_package/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /with \(security_invoker = true\)/);
  for (const resource of ["content-research-records", "monthly-content-folders", "posting-instruction-templates", "asset-remap-audit", "bubbles-daily-operating-queue", "approval-delivery-packets"]) assert.match(resources, new RegExp(`"${resource}"`));
});
