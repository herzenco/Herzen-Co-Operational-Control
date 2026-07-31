import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260731205330_add_content_caption_picture_link.sql",
  "utf8",
);
const resources = readFileSync("utils/api/resources.ts", "utf8");

test("content items store a final caption and creative asset path", () => {
  assert.match(migration, /add column if not exists caption text/i);
  assert.match(migration, /add column if not exists creative_asset_path text/i);
});

test("content item API accepts caption and creative asset writes", () => {
  const contentResource = resources.match(/"content-items":\s*\{[\s\S]*?defaultOrder: "created_at"/i)?.[0] || "";
  assert.match(contentResource, /"caption"/);
  assert.match(contentResource, /"creative_asset_path"/);
});

test("Bubbles n Salt content owned by C-3PO requires both publishing fields", () => {
  assert.match(migration, /property\.slug = 'bubbles-n-salt'/i);
  assert.match(migration, /lower\(agent\.code\) = 'c-3po'/i);
  assert.match(migration, /requires a caption/i);
  assert.match(migration, /requires an uploaded post image/i);
});

test("creative assets use a separate private bucket with operator policies", () => {
  assert.match(migration, /'content-creative-assets'/i);
  assert.match(migration, /false,\s*26214400/i);
  assert.match(migration, /operators read content creative assets/i);
  assert.match(migration, /operators upload content creative assets/i);
  assert.doesNotMatch(migration, /content-publication-evidence/i);
});
