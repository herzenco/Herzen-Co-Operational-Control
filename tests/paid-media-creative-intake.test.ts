import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canTransition, validateCreative } from "../utils/paid-media";

const migration = readFileSync(new URL("../supabase/migrations/20260810120000_paid_media_creative_intake.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260810120000_paid_media_creative_intake.rollback.sql", import.meta.url), "utf8");

test("migration defines normalized creative, variant, file, and revision records", () => {
  for (const table of ["paid_media_campaigns", "paid_media_creatives", "paid_media_creative_variants", "paid_media_creative_files", "paid_media_creative_revisions"]) assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, /security_invoker = true/);
  assert.match(migration, /where a\.workflow_state = 'approved'/);
  assert.match(migration, /paid-media-creative-assets/);
  assert.match(migration, /A replacement must supersede an approved creative/);
});

test("migration is additive and has a scoped recovery script", () => {
  assert.doesNotMatch(migration, /\b(drop|truncate|rename)\b/i);
  assert.doesNotMatch(migration, /\b(delete from|update public\.agent_work_items)\b/i);
  assert.match(rollback, /Removes only objects introduced/);
  assert.doesNotMatch(rollback, /agent_work_items|content_items/);
});

test("bootstrap links the existing work item and preserves every supplied RSA variant", () => {
  assert.match(migration, /46a40266-cd0d-48d5-a71a-41b63d88f43d/);
  assert.equal((migration.match(/\('headline',\d+/g) || []).length, 12);
  assert.equal((migration.match(/\('description',\d+/g) || []).length, 4);
  assert.doesNotMatch(migration, /insert into public\.agent_work_items/i);
});

test("review transitions are explicit and terminal superseded records cannot return", () => {
  assert.equal(canTransition("draft", "approved"), false);
  assert.equal(canTransition("draft", "ready_for_review"), true);
  assert.equal(canTransition("ready_for_review", "approved"), true);
  assert.equal(canTransition("approved", "superseded"), true);
  assert.equal(canTransition("superseded", "draft"), false);
});

test("RSA and snippet validation require normalized variants", () => {
  const base = { campaign_id: "campaign", work_item_id: "work", asset_type: "RSA", ad_group_name: "Group", destination_url: "https://example.com", cta: "Book a meeting" };
  assert.deepEqual(validateCreative({ ...base, variants: [{ variant_type: "headline", value: "Headline" }] }), []);
  assert.match(validateCreative({ ...base, variants: [] }).join(" "), /headline/);
  assert.match(validateCreative({ ...base, cta: "Buy now", variants: [{ variant_type: "headline", value: "Headline" }] }).join(" "), /Calendly/);
  assert.match(validateCreative({ ...base, variants: [{ variant_type: "headline", position: 1, value: "This headline is definitely too long" }] }).join(" "), /30 characters/);
  assert.deepEqual(validateCreative({ ...base, variants: [{ variant_type: "headline", position: 1, value: "Short corrected headline", original_value: "This original headline was much too long", original_character_count: 40, corrected_character_count: 24, meaning_change_label: "compliance-only" }] }), []);
  assert.match(validateCreative({ ...base, variants: [{ variant_type: "headline", position: 1, value: "Short corrected headline", original_value: "This original headline was much too long", original_character_count: 39, corrected_character_count: 24, meaning_change_label: "compliance-only" }] }).join(" "), /counts/);
});
