import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contentCreativeDownloadName, contentCreativeExternalUrl, contentCreativePath, isLocalContentAsset, serializeApiResource } from "../utils/content-assets";
import { normalizeContentWrite } from "../utils/content-write";
import { parsePostManifest } from "../scripts/backfill-bubbles-creatives.mjs";

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

test("content API serializes a stable creative attachment for save-fetch-preview", () => {
  const path = "operator/bubbles-n-salt/2026-08/day-24.jpg";
  const saved = { id: "content-24", creative_asset_path: path };
  const fetched = serializeApiResource("content-items", [saved]) as Array<Record<string, unknown>>;
  assert.deepEqual(fetched[0].creative_attachment, {
    bucket: "content-creative-assets",
    path,
    attached: true,
  });
  assert.equal(contentCreativePath(fetched[0]), path);
});

test("hosted metadata references resolve while local Assets paths do not", () => {
  const path = "operator/bubbles-n-salt/2026-08/day-12.jpg";
  assert.equal(contentCreativePath({ metadata: { image_url: `storage://content-creative-assets/${path}` } }), path);
  assert.equal(contentCreativePath({ metadata: { image_url: "Assets/day-12.jpg" } }), "");
  assert.equal(contentCreativeExternalUrl({ metadata: { image_url: "https://images.example.com/day-12.jpg" } }), "https://images.example.com/day-12.jpg");
  assert.equal(isLocalContentAsset("Assets/day-12.jpg"), true);
});

test("creative downloads preserve a safe original filename and extension", () => {
  assert.equal(contentCreativeDownloadName({ creative_asset_path: "operator/bubbles/day 12.webp" }), "day-12.webp");
  assert.equal(contentCreativeDownloadName({ metadata: { image_url: "https://images.example.com/posts/day%2013.png?size=large" } }), "day-13.png");
  assert.equal(contentCreativeDownloadName({ title: "A Salty Summer Post" }), "a-salty-summer-post.jpg");
});

test("content writes reject unresolved local files but preserve hosted URLs", () => {
  const broken = normalizeContentWrite({ metadata: { caption: "Caption", image_url: "Assets/day-12.jpg" } });
  assert.match(broken.error || "", /cannot be rendered/i);
  const hosted = normalizeContentWrite({ metadata: { caption: "Caption", image_url: "https://images.example.com/day-12.jpg" } });
  assert.equal(hosted.error, undefined);
  assert.equal(hosted.payload.caption, "Caption");
});

test("bulk backfill parser finds every dated primary creative", () => {
  const manifest = `# August posts
## 2026-08-01
- Primary asset: Assets/day-01.jpg

## 2026-08-31
- Primary asset: Assets/day-31.JPG`;
  const posts = parsePostManifest(manifest);
  assert.equal(posts.length, 2);
  assert.ok(posts.every((post) => post.primary.startsWith("Assets/")));
  assert.equal(posts.at(-1)?.date, "2026-08-31");
});
