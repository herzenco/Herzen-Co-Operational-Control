import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260801032854_normalize_bubbles_c3po_content_ownership.sql",
  "utf8",
);

test("Bubbles validator accepts canonical or compatible metadata content fields", () => {
  assert.match(migration, /new\.caption[\s\S]*new\.metadata ->> 'caption'/);
  assert.match(migration, /new\.metadata ->> 'image_url'[\s\S]*new\.creative_asset_path/);
  assert.match(migration, /create or replace function private\.validate_bubbles_c3po_content/);
  assert.match(migration, /storage:\/\/content-creative-assets/);
  assert.match(migration, /local Assets\/\.\.\. paths are not accepted/);
});

test("ownership backfill fails closed unless exactly 31 compliant rows exist", () => {
  assert.match(migration, /if target_count <> 31/);
  assert.match(migration, /if compliant_count <> 31/);
  assert.match(migration, /status = 'ready_for_lupe'/);
  assert.match(migration, /nullif\(btrim\(metadata ->> 'caption'\), ''\) is not null/);
  assert.match(migration, /nullif\(btrim\(metadata ->> 'image_url'\), ''\) is not null/);
  assert.match(migration, /hosted_count <> 31/);
});

test("ownership backfill targets only the requested property channel month and agent", () => {
  assert.match(migration, /28c377e7-0f86-4b69-909f-5b0e1f467fc2/);
  assert.match(migration, /5ec5b70d-1aa7-45f5-adde-1189c95d38ca/);
  assert.match(migration, /59dabf9a-4e4a-497f-9561-7ebb0663c147/);
  assert.match(migration, /2026-08-01T00:00:00Z/);
  assert.match(migration, /2026-09-01T00:00:00Z/);
  assert.match(migration, /source_image_path/);
  assert.match(migration, /creative_asset_path = hosted\.object_path/);
});
