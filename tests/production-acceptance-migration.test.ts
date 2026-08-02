import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260802020150_fix_production_acceptance_blockers.sql", "utf8");
const recoverRoute = readFileSync("app/api/auth/recover/route.ts", "utf8");
const dedupeMigration = readFileSync("supabase/migrations/20260802020625_deduplicate_social_agents_and_work.sql", "utf8");

test("status history is written by a private trigger function without direct API insert grants", () => {
  assert.match(migration, /create or replace function private\.capture_content_status\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function private\.capture_content_status\(\) from anon, authenticated/);
  assert.doesNotMatch(migration, /grant insert on public\.content_status_history/);
});

test("legacy Bubbles backfill preserves facts and blocks incomplete packages", () => {
  assert.match(migration, /'provenance', 'legacy_creative_asset_path'/);
  assert.match(migration, /no research content was invented/i);
  assert.match(migration, /set status = 'blocked'/);
  assert.match(migration, /linked_research_work_item_id = research\.id/);
  assert.match(migration, /linked_creative_work_item_id = package\.id/);
  assert.doesNotMatch(migration, /source_asset_id\s*=/);
  assert.doesNotMatch(migration, /approval_state\s*=\s*'approved'/);
});

test("production recovery derives its callback from trusted forwarded hosts", () => {
  assert.match(recoverRoute, /x-forwarded-host/);
  assert.match(recoverRoute, /forwardedHost === "operations\.herzenco\.co"/);
  assert.match(recoverRoute, /new URL\("\/auth\/callback", origin\)/);
});

test("case-only seeded agent duplicates are consolidated onto the original roster", () => {
  assert.match(dedupeMigration, /agent\.code = 'k2'/);
  assert.match(dedupeMigration, /agent\.code = 'c-3po'/);
  assert.match(dedupeMigration, /delete from public\.agents/);
  assert.match(dedupeMigration, /create unique index agents_code_case_insensitive_idx/);
});
